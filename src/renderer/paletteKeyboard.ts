import { scrollToReveal } from "./revealSelection";

const PALETTE_MOVE_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

export function isPaletteMoveKey(key: string): boolean {
  return PALETTE_MOVE_KEYS.has(key);
}

/** 0 when this block is the palette's single tab stop, otherwise -1. */
export function paletteTabStop(type: string, stop: string | null): 0 | -1 {
  return stop !== null && type === stop ? 0 : -1;
}

/**
 * The block an arrow, Home, or End key should move to.
 * The block is not inserted.
 */
export function paletteMoveTarget(
  items: readonly HTMLElement[],
  current: HTMLElement,
  key: string,
): HTMLElement | null {
  if (!isPaletteMoveKey(key)) return null;
  const index = items.indexOf(current);
  if (index < 0 || items.length === 0) return null;
  let next: number;
  if (key === "ArrowDown") next = index + 1;
  else if (key === "ArrowUp") next = index - 1;
  else if (key === "Home") next = 0;
  else next = items.length - 1;
  if (next === index || next < 0 || next >= items.length) return null;
  return items[next] ?? null;
}

/** Moves focus through the block palette. Enter and Space still insert. */
export function onPaletteKeyDown(event: KeyboardEvent): void {
  const current = event.currentTarget;
  if (!(current instanceof HTMLElement) || event.target !== current) return;
  if (!isPaletteMoveKey(event.key)) return;
  const root = current.ownerDocument;
  const items = Array.from(
    root.querySelectorAll<HTMLElement>("#block-palette [data-block]"),
  );
  const target = paletteMoveTarget(items, current, event.key);
  event.preventDefault();
  if (!target) return;
  for (const item of items) item.tabIndex = item === target ? 0 : -1;
  target.focus({ preventScroll: true });
  const scroller = target.closest(".workspace-tab-panel");
  if (scroller instanceof HTMLElement) scrollToReveal(scroller, target, 8);
}
