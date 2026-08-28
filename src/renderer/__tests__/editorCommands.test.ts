// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  formatPanelMountFailureStatus,
  handlePlainTextPaste,
  isBlockTypeAllowed,
  isNodeLocked,
  lockedMutationMessage,
  shouldBlockManagedVisualSwitch,
  syncUndoRedoToolbar,
  tryMountPanel,
} from "../editorCommands";

describe("editorCommands", () => {
  it("blocks managed visual switch when code diverges", () => {
    expect(shouldBlockManagedVisualSwitch("new", "old", "managed")).toBe(true);
    expect(shouldBlockManagedVisualSwitch("same", "same", "managed")).toBe(
      false,
    );
    expect(shouldBlockManagedVisualSwitch("new", "old", "detached")).toBe(
      false,
    );
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

  it("reports locked mutation messages", () => {
    expect(isNodeLocked({ locked: true })).toBe(true);
    expect(isNodeLocked({ locked: false })).toBe(false);
    expect(isNodeLocked(null)).toBe(false);
    expect(lockedMutationMessage("block")).toContain("block is locked");
    expect(lockedMutationMessage("section")).toContain("section is locked");
    expect(lockedMutationMessage("target-section")).toContain(
      "section is locked",
    );
  });

  it("syncUndoRedoToolbar reflects visual and code history", () => {
    const undo = document.createElement("button");
    const redo = document.createElement("button");
    const sync = (mode: "visual" | "code") =>
      syncUndoRedoToolbar({
        mode,
        visualUndoDepth: 2,
        visualRedoDepth: 0,
        codeCanUndo: true,
        codeCanRedo: false,
        undoButton: undo,
        redoButton: redo,
      });

    sync("visual");
    expect(undo.disabled).toBe(false);
    expect(redo.disabled).toBe(true);
    expect(undo.getAttribute("aria-disabled")).toBe("false");
    expect(redo.getAttribute("aria-disabled")).toBe("true");

    sync("code");
    expect(undo.disabled).toBe(false);
    expect(redo.disabled).toBe(true);
  });

  it("handlePlainTextPaste inserts plain text only", () => {
    const insertText = vi.fn();
    document.execCommand = vi.fn((_cmd, _ui, value) => {
      insertText(value);
      return true;
    }) as typeof document.execCommand;
    const event = {
      preventDefault: vi.fn(),
      clipboardData: { getData: vi.fn(() => "<b>rich</b> text") },
    } as unknown as ClipboardEvent;

    handlePlainTextPaste(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(insertText).toHaveBeenCalledWith("<b>rich</b> text");

    const empty = {
      preventDefault: vi.fn(),
      clipboardData: { getData: vi.fn(() => "") },
    } as unknown as ClipboardEvent;
    handlePlainTextPaste(empty);
    expect(insertText).toHaveBeenCalledTimes(1);
  });

  it("falls back to text/html when no plain text is exposed", () => {
    const insertText = vi.fn();
    document.execCommand = vi.fn((_cmd, _ui, value) => {
      insertText(value);
      return true;
    }) as typeof document.execCommand;
    const html = "<div><strong>Bold</strong> and <a href='/x'>link</a></div>";
    const event = {
      preventDefault: vi.fn(),
      clipboardData: {
        getData: vi.fn((kind: string) => (kind === "text/html" ? html : "")),
      },
    } as unknown as ClipboardEvent;

    handlePlainTextPaste(event);
    expect(insertText).toHaveBeenCalledWith("Bold and link");
  });

  it("maps br and block boundaries to newlines in text/html paste", () => {
    const insertText = vi.fn();
    document.execCommand = vi.fn((_cmd, _ui, value) => {
      insertText(value);
      return true;
    }) as typeof document.execCommand;
    const html = "<p>one<br>two</p><p>three</p>";
    const event = {
      preventDefault: vi.fn(),
      clipboardData: {
        getData: vi.fn((kind: string) => (kind === "text/html" ? html : "")),
      },
    } as unknown as ClipboardEvent;

    handlePlainTextPaste(event);
    // textContent would have fused "onetwothree"; br/block boundaries must
    // become line breaks.
    expect(insertText).toHaveBeenCalledWith("one\ntwo\nthree");
  });
});
