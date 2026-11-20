const LAYER_MOVE_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

export function isLayerMoveKey(key: string): boolean {
  return LAYER_MOVE_KEYS.has(key);
}

/** 0 when this row is the list's single tab stop, otherwise -1. */
export function layerTabStop(active: boolean, fallback: boolean): 0 | -1 {
  return active || fallback ? 0 : -1;
}

/** The row an arrow, Home, or End key should move to, or null at a boundary. */
export function layerMoveTarget(
  buttons: readonly HTMLElement[],
  current: HTMLElement,
  key: string,
): HTMLElement | null {
  if (!isLayerMoveKey(key)) return null;
  const index = buttons.indexOf(current);
  if (index < 0 || buttons.length === 0) return null;
  let next: number;
  if (key === "ArrowDown") next = index + 1;
  else if (key === "ArrowUp") next = index - 1;
  else if (key === "Home") next = 0;
  else next = buttons.length - 1;
  if (next === index || next < 0 || next >= buttons.length) return null;
  return buttons[next] ?? null;
}

/** Focus a layer row without scrolling every ancestor around the list. */
export function focusLayerButton(
  id: string,
  root: ParentNode = document,
): void {
  if (!id) return;
  const buttons = root.querySelectorAll<HTMLElement>(
    "#layers-list .layer-button",
  );
  for (const button of buttons) {
    if (button.dataset["layerId"] !== id) continue;
    button.focus({ preventScroll: true });
    return;
  }
}

/**
 * Moves the page-structure selection from the focused row. The row's own
 * click handler updates the editor; focus follows the new row.
 */
export function onLayerKeyDown(event: KeyboardEvent): void {
  const current = event.currentTarget;
  if (!(current instanceof HTMLElement) || event.target !== current) return;
  if (!isLayerMoveKey(event.key)) return;
  const root = current.ownerDocument;
  const buttons = Array.from(
    root.querySelectorAll<HTMLElement>("#layers-list .layer-button"),
  );
  const target = layerMoveTarget(buttons, current, event.key);
  event.preventDefault();
  if (!target) return;
  const id = target.dataset["layerId"] ?? "";
  target.click();
  focusLayerButton(id, root);
}
