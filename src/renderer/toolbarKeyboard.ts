import { scrollToReveal } from "./revealSelection";

const TOOLBAR_MOVE_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

export function isToolbarMoveKey(key: string): boolean {
  return TOOLBAR_MOVE_KEYS.has(key);
}

function directButtons(toolbar: HTMLElement): HTMLButtonElement[] {
  const buttons: HTMLButtonElement[] = [];
  for (const child of toolbar.children) {
    if (child instanceof HTMLButtonElement) buttons.push(child);
  }
  return buttons;
}

/** Enabled actions in a toolbar, in visual order. */
export function toolbarButtons(toolbar: HTMLElement): HTMLButtonElement[] {
  return directButtons(toolbar).filter((button) => !button.disabled);
}

/**
 * The action an arrow, Home, or End key should move to.
 * Disabled actions are skipped. The action is not run.
 */
export function toolbarMoveTarget(
  buttons: readonly HTMLButtonElement[],
  current: HTMLElement,
  key: string,
): HTMLButtonElement | null {
  if (!isToolbarMoveKey(key)) return null;
  const index = buttons.indexOf(current as HTMLButtonElement);
  if (index < 0 || buttons.length === 0) return null;
  let next: number;
  if (key === "ArrowRight" || key === "ArrowDown") next = index + 1;
  else if (key === "ArrowLeft" || key === "ArrowUp") next = index - 1;
  else if (key === "Home") next = 0;
  else next = buttons.length - 1;
  if (next === index || next < 0 || next >= buttons.length) return null;
  return buttons[next] ?? null;
}

function focusToolbarButton(button: HTMLButtonElement): void {
  const toolbar = button.parentElement;
  if (toolbar instanceof HTMLElement) {
    for (const child of directButtons(toolbar)) {
      child.tabIndex = child === button ? 0 : -1;
    }
  }
  button.focus({ preventScroll: true });
  const scroller = button.closest(".canvas-wrap");
  if (scroller instanceof HTMLElement) scrollToReveal(scroller, button, 12);
}

/** Moves focus inside a block or section toolbar. Enter still runs the action. */
export function onToolbarKeyDown(event: KeyboardEvent): void {
  const current = event.currentTarget;
  if (!(current instanceof HTMLElement) || event.target !== current) return;
  if (!isToolbarMoveKey(event.key)) return;
  const toolbar = current.closest("[role='toolbar']");
  if (!(toolbar instanceof HTMLElement)) return;
  const target = toolbarMoveTarget(toolbarButtons(toolbar), current, event.key);
  event.preventDefault();
  if (!(target instanceof HTMLButtonElement)) return;
  focusToolbarButton(target);
}
