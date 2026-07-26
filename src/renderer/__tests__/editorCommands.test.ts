import { describe, it, expect } from "vitest";
import {
  isBlockTypeAllowed,
  shouldBlockManagedVisualSwitch,
} from "../editorCommands";

describe("editorCommands", () => {
  it("blocks managed visual switch when code diverges", () => {
    expect(
      shouldBlockManagedVisualSwitch("new", "old", "managed"),
    ).toBe(true);
    expect(
      shouldBlockManagedVisualSwitch("same", "same", "managed"),
    ).toBe(false);
    expect(
      shouldBlockManagedVisualSwitch("new", "old", "detached"),
    ).toBe(false);
  });

  it("respects allowed block lists", () => {
    expect(isBlockTypeAllowed("text", null)).toBe(true);
    expect(isBlockTypeAllowed("html", ["text", "heading"])).toBe(false);
    expect(isBlockTypeAllowed("text", ["text", "heading"])).toBe(true);
  });
});
