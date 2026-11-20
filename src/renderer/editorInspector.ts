/** Inspector property panel: debounced canvas repaints and undo-on-first-edit latch. */

import type { EditorSnapshot } from "./editorSession";

export const INSPECTOR_CANVAS_REPAINT_MS = 140;

export function isInspectorTextInputFocused(active: Element | null): boolean {
  if (!active || !(active instanceof HTMLElement)) return false;
  const tag = active.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

export interface InspectorControlMark {
  tag: string;
  name: string;
}

/** The label a rebuilt inspector control can be found by. */
export function inspectorControlName(el: HTMLElement): string {
  const labelled = el.getAttribute("aria-label")?.trim();
  if (labelled) return labelled;
  const fromLabel = el
    .closest("label")
    ?.querySelector("span")
    ?.textContent?.trim();
  if (fromLabel) return fromLabel;
  return (el.textContent ?? "").trim();
}

export function captureInspectorControl(
  panel: HTMLElement,
  active: Element | null,
): InspectorControlMark | null {
  if (!(active instanceof HTMLElement) || !panel.contains(active)) return null;
  const name = inspectorControlName(active);
  if (!name) return null;
  return { tag: active.tagName, name };
}

function inspectorControlUsable(el: HTMLElement): boolean {
  if (!el.isConnected || el.tabIndex < 0) return false;
  if ("disabled" in el && Boolean((el as HTMLButtonElement).disabled)) {
    return false;
  }
  return true;
}

/**
 * After the inspector form is rebuilt, put the keyboard back on the control
 * that changed. A control that the rebuild disabled yields to the next one
 * that can still be used.
 */
export function restoreInspectorControl(
  panel: HTMLElement,
  mark: InspectorControlMark | null,
): void {
  if (!mark) return;
  const same = [...panel.querySelectorAll<HTMLElement>(mark.tag)].find(
    (el) =>
      inspectorControlName(el) === mark.name && inspectorControlUsable(el),
  );
  if (same) {
    same.focus();
    return;
  }
  const fallback = [
    ...panel.querySelectorAll<HTMLElement>("button, input, select, textarea"),
  ].find(inspectorControlUsable);
  fallback?.focus();
}

export function rerenderInspectorKeepingFocus(
  panel: HTMLElement,
  render: () => void,
): void {
  const mark = captureInspectorControl(panel, document.activeElement);
  render();
  restoreInspectorControl(panel, mark);
}

export type GalleryImageControl = "up" | "down" | "remove";

/**
 * After a gallery row moves or disappears, put the keyboard on that image's
 * control. A move that disables the button just used lands on the other
 * direction. An empty gallery lands on Add Image.
 */
export function focusGalleryImageControl(
  panel: ParentNode,
  index: number,
  kind: GalleryImageControl,
): void {
  const buttons = [...panel.querySelectorAll("button")];
  if (index < 0) {
    buttons
      .find(
        (button) =>
          (button.textContent ?? "").includes("Add Image") && !button.disabled,
      )
      ?.focus();
    return;
  }
  const labels =
    kind === "remove"
      ? [`Remove image ${index + 1}`]
      : [
          `Move image ${index + 1} ${kind}`,
          `Move image ${index + 1} ${kind === "up" ? "down" : "up"}`,
        ];
  for (const label of labels) {
    const button = buttons.find(
      (item) => item.getAttribute("aria-label") === label && !item.disabled,
    );
    if (button) {
      button.focus();
      return;
    }
  }
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
