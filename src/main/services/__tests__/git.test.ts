import { describe, it, expect } from "vitest";
import { normalizeCommitMessage, gitErrorLooksLikeMissingRepo } from "../git";

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
});
