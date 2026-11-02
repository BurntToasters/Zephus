import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { GitStatus } from "../types";
import { relativePathIsSecret } from "./files";

const DEFAULT_GITIGNORE = `node_modules/
dist/
.env*
!.env.example
.DS_Store
`;

const execFileAsync = promisify(execFile);

async function git(
  projectPath: string,
  args: string[],
  options: { literalPathspecs?: boolean } = {},
): Promise<string> {
  // Timeout so a stalled network (or a hung credential prompt) cannot leave
  // the Git panel spinning forever or accumulate zombie git processes.
  // LC_ALL=C pins git's OUTPUT to English (localized git would otherwise
  // break the English-only error matching below), and core.quotePath=false
  // makes porcelain emit raw UTF-8 paths instead of C-escaped ones — the
  // parser never unquoted "M \"\303\274ber.md\"" and per-file commits of
  // non-ASCII filenames failed with "did not match any file(s)".
  const literal = options.literalPathspecs ? ["--literal-pathspecs"] : [];
  const { stdout } = await execFileAsync(
    "git",
    ["-c", "core.quotePath=false", ...literal, ...args],
    {
      cwd: projectPath,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
      env: { ...process.env, LC_ALL: "C" },
    },
  );
  return stdout;
}

/** True when git failed because the project has no `.git` directory. */
export function gitErrorLooksLikeMissingRepo(message: string): boolean {
  return /not a git repository/i.test(message);
}

/** Parses `git rev-list --left-right --count @{upstream}...HEAD` (behind, ahead). */
export function parseRevListAheadBehind(
  stdout: string,
): { ahead: number; behind: number } | null {
  const parts = stdout.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const behind = Number(parts[0]);
  const ahead = Number(parts[1]);
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return null;
  return { ahead, behind };
}

async function readUpstreamAheadBehind(
  projectPath: string,
  fetchRemote: boolean,
): Promise<{ ahead: number; behind: number } | null> {
  if (fetchRemote) {
    try {
      await git(projectPath, ["fetch", "--quiet", "--prune"]);
    } catch {
      // Fetch failed — omit ahead/behind so the UI does not show stale counts
      // as if the remote refresh succeeded.
      return null;
    }
  }
  try {
    const raw = await git(projectPath, [
      "rev-list",
      "--left-right",
      "--count",
      "@{upstream}...HEAD",
    ]);
    return parseRevListAheadBehind(raw);
  } catch {
    return null;
  }
}

export interface ParsedGitStatus {
  modified: string[];
  added: string[];
  deleted: string[];
}

/** Parses `git status --porcelain` into panel lists (excludes unmerged UU and copy C). */
export function parseStatusPorcelain(statusRaw: string): ParsedGitStatus {
  const modified: string[] = [];
  const added: string[] = [];
  const deleted: string[] = [];

  for (const line of statusRaw.split("\n")) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    // Unmerged conflicts and index/worktree copies are omitted — Commit All
    // must not stage paths the panel does not list.
    if (code.includes("U") || code[0] === "C" || code[1] === "C") continue;
    const isRename = code.includes("R");
    const arrow = isRename ? line.indexOf(" -> ") : -1;
    const file = (arrow >= 0 ? line.slice(arrow + 4) : line.slice(3)).trim();
    if (!file) continue;
    if (code.includes("D")) deleted.push(file);
    else if (code.includes("A") || code.includes("?")) added.push(file);
    else if (code.includes("M") || code.includes("R") || code.includes("T")) {
      modified.push(file);
    }
  }

  return { modified, added, deleted };
}

function listCommitPathsFromParsed(parsed: ParsedGitStatus): string[] {
  return [...parsed.modified, ...parsed.added, ...parsed.deleted];
}

/** Every committable file from porcelain with `-uall` (untracked dirs expanded). */
async function listCommitableFilePaths(projectPath: string): Promise<string[]> {
  const statusRaw = await git(projectPath, ["status", "--porcelain", "-uall"]);
  return listCommitPathsFromParsed(parseStatusPorcelain(statusRaw));
}

function refuseBroadCommitPaths(
  paths: string[],
): { ok: false; error: string } | null {
  for (const p of paths) {
    if (p === "." || p === "*") {
      return {
        ok: false,
        error: "Cannot commit with a broad path; select individual files.",
      };
    }
    if (p.endsWith("/")) {
      return {
        ok: false,
        error: "Cannot commit a directory; select individual files.",
      };
    }
  }
  return null;
}

function refuseInvalidSelectedCommitPaths(
  selected: string[],
  allowed: ReadonlySet<string>,
): { ok: false; error: string } | null {
  const broad = refuseBroadCommitPaths(selected);
  if (broad) return broad;
  for (const p of selected) {
    if (!allowed.has(p)) {
      return {
        ok: false,
        error: `Path is not a committable file: ${p}`,
      };
    }
  }
  return null;
}

function refuseSecretCommitPaths(
  paths: string[],
): { ok: false; error: string } | null {
  const secrets = paths.filter((p) => relativePathIsSecret(p));
  if (secrets.length === 0) return null;
  const listed = [...new Set(secrets)].join(", ");
  return {
    ok: false,
    error: `Cannot commit sensitive files: ${listed}`,
  };
}

async function refuseCommitInDetachedHead(
  projectPath: string,
): Promise<{ ok: false; error: string } | null> {
  let branchRaw: string;
  try {
    branchRaw = (
      await git(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"])
    ).trim();
  } catch {
    // Unborn HEAD (no commits yet): same fallback as getGitStatus.
    branchRaw = (
      await git(projectPath, ["symbolic-ref", "--short", "HEAD"]).catch(
        () => "HEAD",
      )
    ).trim();
  }
  if (branchRaw === "HEAD") {
    return {
      ok: false,
      error: "Cannot commit while in detached HEAD. Check out a branch first.",
    };
  }
  return null;
}

export interface GetGitStatusOptions {
  /** Run `git fetch` before ahead/behind (Git panel Refresh, after push/pull). */
  fetchRemote?: boolean;
}

/** Reports the git status of a project: branch (or detached HEAD) and the lists of modified, added, and deleted files in… */
export async function getGitStatus(
  projectPath: string,
  options: GetGitStatusOptions = {},
): Promise<GitStatus> {
  const empty: GitStatus = {
    available: false,
    branch: null,
    detachedHead: false,
    modified: [],
    added: [],
    deleted: [],
  };

  try {
    let branchRaw: string;
    try {
      branchRaw = (
        await git(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"])
      ).trim();
    } catch {
      // Unborn HEAD (fresh `git init`, no commits yet): `rev-parse HEAD`
      // fails, but the branch still has a symbolic ref.
      branchRaw = (
        await git(projectPath, ["symbolic-ref", "--short", "HEAD"]).catch(
          () => "HEAD",
        )
      ).trim();
    }
    const detachedHead = branchRaw === "HEAD";

    const statusRaw = await git(projectPath, ["status", "--porcelain"]);
    const { modified, added, deleted } = parseStatusPorcelain(statusRaw);

    const upstream = !detachedHead
      ? await readUpstreamAheadBehind(projectPath, options.fetchRemote ?? false)
      : null;

    const hasRemote = (await git(projectPath, ["remote"]).catch(() => ""))
      .split("\n")
      .some(Boolean);

    return {
      available: true,
      branch: detachedHead ? null : branchRaw,
      detachedHead,
      modified,
      added,
      deleted,
      hasRemote,
      zephusIgnored: await isZephusIgnored(projectPath),
      ...(upstream ? { ahead: upstream.ahead, behind: upstream.behind } : {}),
    };
  } catch (error) {
    log.warn("Git status unavailable for project", projectPath, error);
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ...empty,
      error: detail,
      notARepository: gitErrorLooksLikeMissingRepo(detail),
    };
  }
}

export async function initGitRepo(projectPath: string): Promise<void> {
  await git(projectPath, ["init"]);
  // A panel-initiated repo has no .gitignore (the wizard's is only written at
  // scaffold time): without one, "Commit All Changes" would stage
  // node_modules/, dist/ and possibly .env. Write a safe default when the
  // project has none — never overwrite an existing one.
  const gitignorePath = path.join(projectPath, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, DEFAULT_GITIGNORE);
  }
}

/** Returns trimmed message or null when empty/whitespace-only. */
export function normalizeCommitMessage(message: string): string | null {
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Stages all changes and creates a commit. Requires a non-empty message. */
export async function commitAllChanges(
  projectPath: string,
  message: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = normalizeCommitMessage(message);
  if (!normalized) {
    return { ok: false, error: "Commit message is required." };
  }
  const detached = await refuseCommitInDetachedHead(projectPath);
  if (detached) return detached;

  try {
    const paths = await listCommitableFilePaths(projectPath);
    if (paths.length === 0) {
      return { ok: false, error: "Nothing to commit." };
    }
    const broad = refuseBroadCommitPaths(paths);
    if (broad) return broad;
    const secretRefusal = refuseSecretCommitPaths(paths);
    if (secretRefusal) return secretRefusal;
    await git(projectPath, ["add", "--", ...paths], { literalPathspecs: true });
    await git(projectPath, ["commit", "-m", normalized, "--", ...paths], {
      literalPathspecs: true,
    });
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.warn("Git commit failed", projectPath, error);
    return { ok: false, error: detail };
  }
}

/**
 * Stages the given paths (repo-relative) and commits. Empty list is an error.
 */
export async function commitProjectPaths(
  projectPath: string,
  message: string,
  paths: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = normalizeCommitMessage(message);
  if (!normalized) {
    return { ok: false, error: "Commit message is required." };
  }
  const unique = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return { ok: false, error: "Select at least one file to commit." };
  }
  const detached = await refuseCommitInDetachedHead(projectPath);
  if (detached) return detached;

  try {
    const allowed = new Set(await listCommitableFilePaths(projectPath));
    const invalid = refuseInvalidSelectedCommitPaths(unique, allowed);
    if (invalid) return invalid;
    const secretRefusal = refuseSecretCommitPaths(unique);
    if (secretRefusal) return secretRefusal;
    await git(projectPath, ["add", "--", ...unique], {
      literalPathspecs: true,
    });
    await git(projectPath, ["commit", "-m", normalized, "--", ...unique], {
      literalPathspecs: true,
    });
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.warn("Git commit failed", projectPath, error);
    return { ok: false, error: detail };
  }
}

/** Pushes the current branch to its configured upstream (git push). */
export async function pushCurrentBranch(
  projectPath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const status = await getGitStatus(projectPath);
    if (!status.available) {
      return { ok: false, error: "Git is not available for this project." };
    }
    if (status.detachedHead) {
      return {
        ok: false,
        error: "Cannot push while in detached HEAD. Check out a branch first.",
      };
    }
    try {
      await git(projectPath, ["push"]);
      return { ok: true };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // First push on a freshly initialized repo has no upstream; set it to
      // origin (or the first configured remote) so subsequent pushes behave
      // normally.
      if (detail.includes("no upstream branch") && status.branch) {
        const remotes = (await git(projectPath, ["remote"]))
          .split("\n")
          .filter(Boolean);
        const remote = remotes.includes("origin") ? "origin" : remotes[0];
        if (remote) {
          await git(projectPath, [
            "push",
            "--set-upstream",
            remote,
            status.branch,
          ]);
          return { ok: true };
        }
      }
      throw error;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.warn("Git push failed", projectPath, error);
    return { ok: false, error: detail };
  }
}

/** Fast-forward pull from the configured upstream (git pull --ff-only). */
export async function pullCurrentBranch(
  projectPath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const status = await getGitStatus(projectPath);
    if (!status.available) {
      return { ok: false, error: "Git is not available for this project." };
    }
    if (status.detachedHead) {
      return {
        ok: false,
        error: "Cannot pull while in detached HEAD. Check out a branch first.",
      };
    }
    await git(projectPath, ["pull", "--ff-only"]);
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.warn("Git pull failed", projectPath, error);
    return { ok: false, error: detail };
  }
}

/** Returns true if `.zephus/` is excluded by git in this project. */
export async function isZephusIgnored(projectPath: string): Promise<boolean> {
  // `git check-ignore` exits 0 when the path IS ignored, 1 when it is not.
  // --no-index makes the check work even when .zephus does not exist yet, and
  // both path forms are checked because `.zephus/` (dir pattern) vs `.zephus`
  // (file pattern) match different spellings of the path.
  const ignored = async (rel: string): Promise<boolean> => {
    try {
      await git(projectPath, ["check-ignore", "--no-index", "-q", rel]);
      return true;
    } catch {
      return false;
    }
  };
  return (await ignored(".zephus")) || (await ignored(".zephus/"));
}
