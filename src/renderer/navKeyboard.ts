import { scrollToReveal } from "./revealSelection";

const NAV_MOVE_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

export function isNavMoveKey(key: string): boolean {
  return NAV_MOVE_KEYS.has(key);
}

/**
 * The navigation entry an arrow, Home, or End key should move to.
 * A custom link is disabled and is skipped. The page is not opened.
 */
export function navMoveTarget(
  buttons: readonly HTMLButtonElement[],
  current: HTMLElement,
  key: string,
): HTMLButtonElement | null {
  if (!isNavMoveKey(key)) return null;
  const enabled = buttons.filter((button) => !button.disabled);
  const index = enabled.indexOf(current as HTMLButtonElement);
  if (index < 0 || enabled.length === 0) return null;
  let next: number;
  if (key === "ArrowDown") next = index + 1;
  else if (key === "ArrowUp") next = index - 1;
  else if (key === "Home") next = 0;
  else next = enabled.length - 1;
  if (next === index || next < 0 || next >= enabled.length) return null;
  return enabled[next] ?? null;
}

/** Moves focus through the navigation list. Enter still opens the focused page. */
export function onNavKeyDown(event: KeyboardEvent): void {
  const current = event.currentTarget;
  if (!(current instanceof HTMLElement) || event.target !== current) return;
  if (!isNavMoveKey(event.key)) return;
  const root = current.ownerDocument;
  const buttons = Array.from(
    root.querySelectorAll<HTMLButtonElement>("#nav-list .nav-entry"),
  );
  const target = navMoveTarget(buttons, current, event.key);
  event.preventDefault();
  if (!target) return;
  target.focus({ preventScroll: true });
  const scroller = target.closest(".workspace-tab-panel");
  if (scroller instanceof HTMLElement) scrollToReveal(scroller, target, 8);
}
