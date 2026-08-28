/** Inspector property panel: debounced canvas repaints and undo-on-first-edit latch. */

import type { EditorSnapshot } from "./editorSession";

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

/** Undo-on-first-edit latch for the inspector. */
export function createInspectorUndoLatch(deps: {
  captureSnapshot: () => EditorSnapshot;
  pushSnapshot: (snapshot: EditorSnapshot) => void;
}) {
  let active = false;
  let snapshot: EditorSnapshot | null = null;
  return {
    begin(): void {
      if (active) return;
      active = true;
      snapshot = deps.captureSnapshot();
    },
    end(flushRepaint: () => void): void {
      active = false;
      if (snapshot) {
        const current = deps.captureSnapshot();
        if (JSON.stringify(current) !== JSON.stringify(snapshot)) {
          deps.pushSnapshot(snapshot);
        }
        snapshot = null;
      }
      flushRepaint();
    },
    /** For drag/resize flows that push undo explicitly before mutating. */
    markActive(): void {
      active = true;
      snapshot = null;
    },
    isActive(): boolean {
      return active;
    },
  };
}
