import { execFile } from "child_process";
import { promisify } from "util";
import log from "electron-log";
import { GitStatus } from "../types";

const execFileAsync = promisify(execFile);

async function git(projectPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: projectPath,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

/** True when git failed because the project has no `.git` directory. */
export function gitErrorLooksLikeMissingRepo(message: string): boolean {
  return /not a git repository/i.test(message);
}

/**
 * Reports the git status of a project: branch (or detached HEAD) and the
 * lists of modified, added, and deleted files in the working tree.
 */
export async function getGitStatus(projectPath: string): Promise<GitStatus> {
  const empty: GitStatus = {
    available: false,
    branch: null,
    detachedHead: false,
    modified: [],
    added: [],
    deleted: [],
  };

  try {
    const branchRaw = (
      await git(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"])
    ).trim();
    const detachedHead = branchRaw === "HEAD";

    const statusRaw = await git(projectPath, ["status", "--porcelain"]);
    const modified: string[] = [];
    const added: string[] = [];
    const deleted: string[] = [];

    for (const line of statusRaw.split("\n")) {
      if (!line.trim()) continue;
      const code = line.slice(0, 2);
      const file = line.slice(3).trim();
      if (code.includes("D")) deleted.push(file);
      else if (code.includes("A") || code.includes("?")) added.push(file);
      else if (code.includes("M") || code.includes("R")) modified.push(file);
    }

    return {
      available: true,
      branch: detachedHead ? null : branchRaw,
      detachedHead,
      modified,
      added,
      deleted,
      zephusIgnored: await isZephusIgnored(projectPath),
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
  try {
    await git(projectPath, ["add", "-A"]);
    await git(projectPath, ["commit", "-m", normalized]);
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
  try {
    await git(projectPath, ["add", "--", ...unique]);
    await git(projectPath, ["commit", "-m", normalized]);
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
    await git(projectPath, ["push"]);
    return { ok: true };
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

/**
 * Returns true if `.zephus/` is excluded by git in this project. That would be
 * a misconfiguration: the .zephus directory is the Zephus project save state
 * and must be committed so the project opens correctly on other machines.
 */
export async function isZephusIgnored(projectPath: string): Promise<boolean> {
  try {
    // `git check-ignore` exits 0 when the path IS ignored, 1 when it is not.
    await git(projectPath, ["check-ignore", "-q", ".zephus"]);
    return true;
  } catch {
    return false;
  }
}
