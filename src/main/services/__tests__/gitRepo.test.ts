import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  commitAllChanges,
  commitProjectPaths,
  getGitStatus,
  initGitRepo,
  isZephusIgnored,
  pullCurrentBranch,
  pushCurrentBranch,
} from "../git";

let tmpDir: string;
let repoDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-git-"));
  repoDir = path.join(tmpDir, "repo");
  fs.mkdirSync(repoDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf8" });
}

function expectFailure(result: {
  ok: boolean;
  error?: string;
}): asserts result is { ok: false; error: string } {
  expect(result.ok).toBe(false);
  expect(result.error).toBeTruthy();
}

describe("git service (real repository)", () => {
  it("reports git unavailable for a non-repository", async () => {
    const status = await getGitStatus(repoDir);
    expect(status.available).toBe(false);
    expect(status.notARepository).toBe(true);
  });

  it("initializes a repository and reports branch + clean tree", async () => {
    await initGitRepo(repoDir);
    const status = await getGitStatus(repoDir);
    expect(status.available).toBe(true);
    expect(status.detachedHead).toBe(false);
    expect(status.branch).toBeTruthy();
    expect(status.modified).toEqual([]);
    expect(status.deleted).toEqual([]);
    // initGitRepo writes a safe default .gitignore (node_modules/, dist/,
    // .env) so "Commit All" can never stage secrets or build output.
    expect(status.added).toEqual([".gitignore"]);
    expect(fs.readFileSync(path.join(repoDir, ".gitignore"), "utf8")).toContain(
      "node_modules/",
    );
  });

  it("classifies working-tree changes after a commit", async () => {
    git(["init", "-q", "-b", "main"]);
    fs.writeFileSync(path.join(repoDir, "a.txt"), "one\n");
    const before = await getGitStatus(repoDir);
    expect(before.added).toContain("a.txt");

    await commitAllChanges(repoDir, "add a.txt");
    const after = await getGitStatus(repoDir);
    expect(after.added).not.toContain("a.txt");
    expect(after.modified).toEqual([]);

    fs.writeFileSync(path.join(repoDir, "a.txt"), "two\n");
    fs.writeFileSync(path.join(repoDir, "b.txt"), "new\n");
    const dirty = await getGitStatus(repoDir);
    expect(dirty.modified).toContain("a.txt");
    expect(dirty.added).toContain("b.txt");
  });

  it("rejects empty commit messages", async () => {
    const result = await commitAllChanges(repoDir, "   ");
    expect(result.ok).toBe(false);
    expectFailure(result);
    expect(result.error).toContain("Commit message is required");
  });

  it("detects .zephus being git-ignored", async () => {
    git(["init", "-q", "-b", "main"]);
    expect(await isZephusIgnored(repoDir)).toBe(false);

    fs.writeFileSync(path.join(repoDir, ".gitignore"), ".zephus/\n");
    expect(await isZephusIgnored(repoDir)).toBe(true);
  });

  it("commits selected paths only", async () => {
    git(["init", "-q", "-b", "main"]);
    fs.writeFileSync(path.join(repoDir, "keep.txt"), "keep");
    fs.writeFileSync(path.join(repoDir, "skip.txt"), "skip");

    const result = await commitProjectPaths(repoDir, "partial", ["keep.txt"]);
    expect(result.ok).toBe(true);

    const status = await getGitStatus(repoDir);
    expect(status.added).toEqual(["skip.txt"]);
  });

  it("reports renamed files under their new path", async () => {
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "t@e.c"]);
    git(["config", "user.name", "T"]);
    fs.writeFileSync(path.join(repoDir, "old.txt"), "x");
    await commitAllChanges(repoDir, "first");
    fs.renameSync(path.join(repoDir, "old.txt"), path.join(repoDir, "new.txt"));
    // Stage the rename so porcelain v1 reports "R  old.txt -> new.txt"
    // (identical content so git's rename detection matches).
    execFileSync("git", ["-C", repoDir, "add", "-A"]);

    const status = await getGitStatus(repoDir);
    // Regression: porcelain v1 emits "R  old.txt -> new.txt" — the old
    // parsing kept the literal "old.txt -> new.txt" string, which per-path
    // commits then failed to stage.
    expect(status.modified).toContain("new.txt");
    expect(status.modified.some((p) => p.includes("->"))).toBe(false);
  });

  it("pushes and pulls through a bare remote", async () => {
    const bare = path.join(tmpDir, "bare.git");
    execFileSync("git", [
      "init",
      "-q",
      "--bare",
      "--initial-branch=main",
      bare,
    ]);
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Tester"]);
    fs.writeFileSync(path.join(repoDir, "a.txt"), "one");
    await commitAllChanges(repoDir, "first");
    git(["remote", "add", "origin", bare]);
    git(["branch", "-M", "main"]);

    const pushed = await pushCurrentBranch(repoDir);
    expect(pushed.ok).toBe(true);

    // A second clone working tree pulls the pushed commit, then pushes a new
    // one that the original repo fast-forwards to.
    const cloneDir = path.join(tmpDir, "clone");
    execFileSync("git", ["clone", "-q", bare, cloneDir]);
    fs.writeFileSync(path.join(cloneDir, "b.txt"), "two");
    execFileSync("git", [
      "-C",
      cloneDir,
      "config",
      "user.email",
      "t2@example.com",
    ]);
    execFileSync("git", ["-C", cloneDir, "config", "user.name", "T2"]);
    execFileSync("git", ["-C", cloneDir, "add", "b.txt"]);
    execFileSync("git", ["-C", cloneDir, "commit", "-q", "-m", "second"]);
    execFileSync("git", ["-C", cloneDir, "push", "-q", "-u", "origin", "main"]);

    const pulled = await pullCurrentBranch(repoDir);
    expect(pulled.ok).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "b.txt"))).toBe(true);
  });

  it("rejects push with no upstream configured", async () => {
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Tester"]);
    fs.writeFileSync(path.join(repoDir, "a.txt"), "x");
    await commitAllChanges(repoDir, "first");

    const pushed = await pushCurrentBranch(repoDir);
    expect(pushed.ok).toBe(false);
  });

  it("refuses to commit an empty selection", async () => {
    git(["init", "-q", "-b", "main"]);
    const result = await commitProjectPaths(repoDir, "msg", []);
    expect(result.ok).toBe(false);
    expectFailure(result);
    expect(result.error).toContain("Select at least one file");
  });

  it("refuses empty or whitespace commit messages", async () => {
    git(["init", "-q", "-b", "main"]);
    fs.writeFileSync(path.join(repoDir, "a.txt"), "x");
    const empty = await commitAllChanges(repoDir, "   ");
    expect(empty.ok).toBe(false);
    expectFailure(empty);
    expect(empty.error).toContain("Commit message is required");
    const bare = await commitProjectPaths(repoDir, "", ["a.txt"]);
    expect(bare.ok).toBe(false);
  });

  it("refuses push and pull in detached HEAD", async () => {
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "t@e.c"]);
    git(["config", "user.name", "T"]);
    fs.writeFileSync(path.join(repoDir, "a.txt"), "x");
    await commitAllChanges(repoDir, "first");
    execFileSync("git", ["-C", repoDir, "checkout", "-q", "--detach", "HEAD"]);

    const pushed = await pushCurrentBranch(repoDir);
    expect(pushed.ok).toBe(false);
    expectFailure(pushed);
    expect(pushed.error).toContain("detached HEAD");
    const pulled = await pullCurrentBranch(repoDir);
    expect(pulled.ok).toBe(false);
    expectFailure(pulled);
    expect(pulled.error).toContain("detached HEAD");
  });

  it("refuses push and pull when git is unavailable", async () => {
    // A non-repository directory reports available:false.
    const plain = path.join(tmpDir, "plain");
    fs.mkdirSync(plain, { recursive: true });
    const pushed = await pushCurrentBranch(plain);
    expect(pushed.ok).toBe(false);
    const pulled = await pullCurrentBranch(plain);
    expect(pulled.ok).toBe(false);
  });

  it("fails cleanly when no remote exists for a first push", async () => {
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "t@e.c"]);
    git(["config", "user.name", "T"]);
    fs.writeFileSync(path.join(repoDir, "a.txt"), "x");
    await commitAllChanges(repoDir, "first");

    const pushed = await pushCurrentBranch(repoDir);
    expect(pushed.ok).toBe(false);
  });

  it("commit fails cleanly when there is nothing to commit", async () => {
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "t@e.c"]);
    git(["config", "user.name", "T"]);
    fs.writeFileSync(path.join(repoDir, "a.txt"), "x");
    await commitAllChanges(repoDir, "first");

    const second = await commitAllChanges(repoDir, "nothing new");
    expect(second.ok).toBe(false);
    expectFailure(second);
    expect(second.error.length).toBeGreaterThan(0);
  });

  it("fetch failure still reports local ahead/behind", async () => {
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "t@e.c"]);
    git(["config", "user.name", "T"]);
    fs.writeFileSync(path.join(repoDir, "a.txt"), "x");
    await commitAllChanges(repoDir, "first");
    // No remote configured: fetch fails, status must still be available.
    const status = await getGitStatus(repoDir, { fetchRemote: true });
    expect(status.available).toBe(true);
  });
});
