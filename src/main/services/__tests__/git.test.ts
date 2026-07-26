import { describe, it, expect } from "vitest";
import { normalizeCommitMessage } from "../git";

describe("git helpers", () => {
  it("normalizes commit messages", () => {
    expect(normalizeCommitMessage("  Save work  ")).toBe("Save work");
    expect(normalizeCommitMessage("")).toBeNull();
    expect(normalizeCommitMessage("   ")).toBeNull();
    expect(normalizeCommitMessage("\n\t")).toBeNull();
  });
});
