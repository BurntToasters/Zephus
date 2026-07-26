import { describe, it, expect } from "vitest";
import {
  normalizeCommitMessage,
  gitErrorLooksLikeMissingRepo,
  parseRevListAheadBehind,
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
      gitErrorLooksLikeMissingRepo("fatal: not a git repository (or any of the parent directories): .git"),
    ).toBe(true);
    expect(gitErrorLooksLikeMissingRepo("git: command not found")).toBe(false);
  });

  it("parses rev-list ahead/behind counts", () => {
    expect(parseRevListAheadBehind("0\t0")).toEqual({ ahead: 0, behind: 0 });
    expect(parseRevListAheadBehind("2\t5")).toEqual({ ahead: 5, behind: 2 });
    expect(parseRevListAheadBehind("")).toBeNull();
    expect(parseRevListAheadBehind("x y")).toBeNull();
  });
});
