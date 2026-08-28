/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDebouncedCanvasRepaint,
  createInspectorUndoLatch,
  INSPECTOR_CANVAS_REPAINT_MS,
  isInspectorTextInputFocused,
} from "../editorInspector";
import type { EditorSnapshot } from "../editorSession";

describe("editorInspector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects text inputs for debounced repaint", () => {
    const input = document.createElement("input");
    expect(isInspectorTextInputFocused(input)).toBe(true);
    expect(isInspectorTextInputFocused(document.createElement("select"))).toBe(
      false,
    );
    expect(isInspectorTextInputFocused(null)).toBe(false);
  });

  it("repaints immediately when not debouncing", () => {
    const repaint = vi.fn();
    const handle = createDebouncedCanvasRepaint(repaint);
    handle.schedule(false);
    expect(repaint).toHaveBeenCalledTimes(1);
  });

  it("debounces repaint while typing", async () => {
    const repaint = vi.fn();
    const handle = createDebouncedCanvasRepaint(repaint);
    handle.schedule(true);
    handle.schedule(true);
    expect(repaint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(INSPECTOR_CANVAS_REPAINT_MS);
    expect(repaint).toHaveBeenCalledTimes(1);
  });

  it("flushes pending debounced repaint", () => {
    const repaint = vi.fn();
    const handle = createDebouncedCanvasRepaint(repaint);
    handle.schedule(true);
    handle.flush();
    expect(repaint).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(INSPECTOR_CANVAS_REPAINT_MS);
    expect(repaint).toHaveBeenCalledTimes(1);
  });

  it("pushes undo once per inspector edit session, only when changed", () => {
    const pushSnapshot = vi.fn();
    let captured: EditorSnapshot = { sections: [], site: null };
    const latch = createInspectorUndoLatch({
      captureSnapshot: () => captured,
      pushSnapshot,
    });
    const flush = vi.fn();

    latch.begin();
    latch.begin();
    // No mutation between begin and end: nothing pushed, redo preserved.
    latch.end(flush);
    expect(flush).toHaveBeenCalled();
    expect(pushSnapshot).not.toHaveBeenCalled();

    // Changed during the session: the pre-change snapshot is pushed once.
    latch.begin();
    captured = { sections: [], site: null };
    latch.end(flush);
    expect(pushSnapshot).toHaveBeenCalledTimes(0);

    latch.begin();
    captured = {
      sections: [{ id: "s", type: "section" } as never],
      site: null,
    };
    latch.end(flush);
    expect(pushSnapshot).toHaveBeenCalledTimes(1);
    expect(pushSnapshot).toHaveBeenCalledWith({ sections: [], site: null });
  });

  it("markActive defers undo to the caller and never re-pushes", () => {
    const pushSnapshot = vi.fn();
    const latch = createInspectorUndoLatch({
      captureSnapshot: () => ({ sections: [], site: null }),
      pushSnapshot,
    });
    // Drag/resize flows push undo themselves before mutating.
    latch.markActive();
    latch.begin();
    expect(latch.isActive()).toBe(true);
    latch.end(() => undefined);
    expect(pushSnapshot).not.toHaveBeenCalled();
  });
});
