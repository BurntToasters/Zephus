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

  it("pushes undo once per inspector edit session", () => {
    const pushUndo = vi.fn();
    const latch = createInspectorUndoLatch(pushUndo);
    const flush = vi.fn();
    latch.begin();
    latch.begin();
    expect(pushUndo).toHaveBeenCalledTimes(1);
    latch.end(flush);
    expect(flush).toHaveBeenCalled();
    latch.begin();
    expect(pushUndo).toHaveBeenCalledTimes(2);
  });
});
