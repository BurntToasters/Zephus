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
    expect(status.added).toEqual([]);
    expect(status.deleted).toEqual([]);
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
    expect(result.error).toContain("Select at least one file");
  });
});
