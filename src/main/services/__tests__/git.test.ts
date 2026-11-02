import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  normalizeCommitMessage,
  gitErrorLooksLikeMissingRepo,
  parseRevListAheadBehind,
  parseStatusPorcelain,
} from "../git";

describe("git helpers", () => {
  it("normalizes commit messages", () => {
    expect(normalizeCommitMessage("  Save work  ")).toBe("Save work");
    expect(normalizeCommitMessage("")).toBeNull();
    expect(normalizeCommitMessage("   ")).toBeNull();
    expect(normalizeCommitMessage("\n\t")).toBeNull();
  });

  it("detects missing-repo errors", () => {
    expect(
      gitErrorLooksLikeMissingRepo(
        "fatal: not a git repository (or any of the parent directories): .git",
      ),
    ).toBe(true);
    expect(gitErrorLooksLikeMissingRepo("git: command not found")).toBe(false);
  });

  it("parses porcelain without splitting arrows on non-renames", () => {
    const parsed = parseStatusPorcelain(" M notes -> draft.md\n");
    expect(parsed.modified).toEqual(["notes -> draft.md"]);
  });

  it("parses porcelain rename lines to the new path", () => {
    const parsed = parseStatusPorcelain("R  old.txt -> new.txt\n");
    expect(parsed.modified).toEqual(["new.txt"]);
  });

  it("refuses a literal asterisk as a selected commit path", async () => {
    const { commitProjectPaths } = await import("../git");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-git-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: tmp });
      execFileSync("git", ["config", "user.email", "t@e.c"], { cwd: tmp });
      execFileSync("git", ["config", "user.name", "T"], { cwd: tmp });
      fs.writeFileSync(path.join(tmp, "a.txt"), "x");
      const result = await commitProjectPaths(tmp, "msg", ["*"]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("broad path");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("parses rev-list ahead/behind counts", () => {
    expect(parseRevListAheadBehind("0\t0")).toEqual({ ahead: 0, behind: 0 });
    expect(parseRevListAheadBehind("2\t5")).toEqual({ ahead: 5, behind: 2 });
    expect(parseRevListAheadBehind("")).toBeNull();
    expect(parseRevListAheadBehind("x y")).toBeNull();
  });
});
