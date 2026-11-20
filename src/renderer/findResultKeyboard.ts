import { scrollToReveal } from "./revealSelection";

const FIND_RESULT_MOVE_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

export function isFindResultMoveKey(key: string): boolean {
  return FIND_RESULT_MOVE_KEYS.has(key);
}

/**
 * The result an arrow, Home, or End key should move to.
 * The page is not opened.
 */
export function findResultMoveTarget(
  buttons: readonly HTMLButtonElement[],
  current: HTMLElement,
  key: string,
): HTMLButtonElement | null {
  if (!isFindResultMoveKey(key)) return null;
  const index = buttons.indexOf(current as HTMLButtonElement);
  if (index < 0 || buttons.length === 0) return null;
  if (key === "Home") return index === 0 ? null : (buttons[0] ?? null);
  if (key === "End") {
    const last = buttons[buttons.length - 1] ?? null;
    return last === current ? null : last;
  }
  const next = buttons[index + (key === "ArrowDown" ? 1 : -1)];
  return next ?? null;
}

/** Moves focus through find results. Enter still opens the focused page. */
export function onFindResultKeyDown(event: KeyboardEvent): void {
  const current = event.currentTarget;
  if (!(current instanceof HTMLElement) || event.target !== current) return;
  if (!isFindResultMoveKey(event.key)) return;
  const list = current.closest(".find-replace-list");
  if (!(list instanceof HTMLElement)) return;
  const buttons = Array.from(
    list.querySelectorAll<HTMLButtonElement>("button.find-replace-page"),
  ).filter((button) => !button.disabled);
  const target = findResultMoveTarget(buttons, current, event.key);
  event.preventDefault();
  if (!target) return;
  for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
  target.focus({ preventScroll: true });
  const scroller = target.closest(".find-replace-results");
  if (scroller instanceof HTMLElement) scrollToReveal(scroller, target, 8);
}
