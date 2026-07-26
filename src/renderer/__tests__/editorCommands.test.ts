import { describe, it, expect, vi } from "vitest";
import {
  formatPanelMountFailureStatus,
  isBlockTypeAllowed,
  shouldBlockManagedVisualSwitch,
  tryMountPanel,
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

  it("tryMountPanel skips missing containers and reports throws", () => {
    const onError = vi.fn();
    expect(tryMountPanel("Palette", null, () => undefined, onError)).toBe(true);
    expect(onError).not.toHaveBeenCalled();

    const el = {} as HTMLElement;
    expect(
      tryMountPanel(
        "Canvas",
        el,
        () => {
          throw new Error("boom");
        },
        onError,
      ),
    ).toBe(false);
    expect(onError).toHaveBeenCalledWith("Canvas", expect.any(Error));
  });

  it("formats mount failure status", () => {
    expect(formatPanelMountFailureStatus([])).toBe("");
    expect(formatPanelMountFailureStatus(["Canvas", "Layers"])).toBe(
      "Some editor panels failed to load: Canvas, Layers.",
    );
  });
});
