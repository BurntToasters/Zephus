/**
 * Inspector property panel: debounced canvas repaints and undo-on-first-edit latch.
 */

export const INSPECTOR_CANVAS_REPAINT_MS = 140;

export function isInspectorTextInputFocused(active: Element | null): boolean {
  if (!active || !(active instanceof HTMLElement)) return false;
  const tag = active.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

export interface DebouncedRepaintHandle {
  schedule(debounce: boolean): void;
  flush(): void;
  cancel(): void;
}

export function createDebouncedCanvasRepaint(
  repaint: () => void,
  debounceMs = INSPECTOR_CANVAS_REPAINT_MS,
): DebouncedRepaintHandle {
  let timer: number | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(debounce: boolean): void {
      clearTimer();
      if (!debounce) {
        repaint();
        return;
      }
      timer = window.setTimeout(() => {
        timer = null;
        repaint();
      }, debounceMs);
    },
    flush(): void {
      if (timer === null) return;
      clearTimer();
      repaint();
    },
    cancel: clearTimer,
  };
}

export function createInspectorUndoLatch(pushUndo: () => void) {
  let active = false;
  return {
    begin(): void {
      if (active) return;
      pushUndo();
      active = true;
    },
    end(flushRepaint: () => void): void {
      active = false;
      flushRepaint();
    },
    /** For drag/resize flows that push undo explicitly before mutating. */
    markActive(): void {
      active = true;
    },
    isActive(): boolean {
      return active;
    },
  };
}
