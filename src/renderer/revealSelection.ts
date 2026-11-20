const REVEAL_MARGIN = 12;

/**
 * Scrolls `scroller` until `target` is visible.
 * A block taller than the canvas stays put when its top is already on screen,
 * so selecting a long section does not jump to the section's end.
 */
export function scrollToReveal(
  scroller: HTMLElement,
  target: HTMLElement,
  margin = REVEAL_MARGIN,
): void {
  const scrollerRect = scroller.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const visibleTop = scrollerRect.top + margin;
  const visibleBottom = scrollerRect.bottom - margin;
  if (targetRect.top < visibleTop) {
    scroller.scrollTop -= visibleTop - targetRect.top;
    return;
  }
  const height = targetRect.bottom - targetRect.top;
  const visibleHeight = visibleBottom - visibleTop;
  if (targetRect.top <= visibleBottom) {
    if (height <= visibleHeight && targetRect.bottom > visibleBottom) {
      scroller.scrollTop += targetRect.bottom - visibleBottom;
    }
    return;
  }
  scroller.scrollTop += targetRect.top - visibleTop;
}

/** Brings the selected block, or the selected section, into the canvas pane. */
export function revealCanvasSelection(root: ParentNode = document): void {
  const canvas = root.querySelector("#canvas");
  if (!canvas) return;
  const selected =
    canvas.querySelector<HTMLElement>(".block.selected") ??
    canvas.querySelector<HTMLElement>(".canvas-section.selected");
  if (!selected) return;
  const scroller = selected.closest(".canvas-wrap");
  if (!(scroller instanceof HTMLElement)) return;
  scrollToReveal(scroller, selected);
}

/**
 * A newly opened page starts at the top of the canvas and the inspector.
 * The page list moves just enough to show the page that opened.
 */
export function resetInspectorScroll(root: ParentNode = document): void {
  const inspector = root.querySelector("#workspace-right-inspect");
  if (!(inspector instanceof HTMLElement)) return;
  inspector.scrollTop = 0;
  inspector.scrollLeft = 0;
}

export function resetPageSwitchScroll(root: ParentNode = document): void {
  const canvas = root.querySelector(".canvas-wrap");
  if (canvas instanceof HTMLElement) {
    canvas.scrollTop = 0;
    canvas.scrollLeft = 0;
  }
  resetInspectorScroll(root);
  const active = root.querySelector<HTMLElement>("#page-list li.active");
  const pages = active?.closest(".workspace-tab-panel");
  if (active && pages instanceof HTMLElement) scrollToReveal(pages, active, 8);
}

let lastRevealedLayerId: string | null = null;

/** Scrolls the page-structure list to the active row when the selection changes. */
export function revealActiveLayer(root: ParentNode = document): void {
  const active = root.querySelector<HTMLElement>(
    "#layers-list .layer-button[aria-current='true']",
  );
  const id = active?.dataset["layerId"] ?? null;
  if (!active || !id) {
    lastRevealedLayerId = null;
    return;
  }
  const scroller = active.closest(".workspace-tab-panel");
  // A hidden tab has no place to scroll. Leave the id unset so opening the
  // tab still brings the active row into view.
  if (!(scroller instanceof HTMLElement) || scroller.hidden) return;
  if (id === lastRevealedLayerId) return;
  lastRevealedLayerId = id;
  scrollToReveal(scroller, active, 8);
}

/** The selected block, or the selected section's body when no block is selected. */
export function canvasSelectionTarget(
  root: ParentNode = document,
): HTMLElement | null {
  const canvas = root.querySelector("#canvas");
  if (!canvas) return null;
  return (
    canvas.querySelector<HTMLElement>(".block.selected") ??
    canvas.querySelector<HTMLElement>(".canvas-section.selected .section-body")
  );
}

/**
 * Puts focus back on the canvas selection after a re-render removes the
 * focused control. A selected block is scrolled into the canvas pane. A
 * selected section keeps the current scroll, because its body is the whole
 * section and jumping to the top would leave the block the user was editing.
 */
export function focusCanvasSelection(root: ParentNode = document): void {
  const target = canvasSelectionTarget(root);
  if (!target) return;
  target.focus({ preventScroll: true });
  if (!target.classList.contains("block")) return;
  const scroller = target.closest(".canvas-wrap");
  if (scroller instanceof HTMLElement) scrollToReveal(scroller, target);
}
