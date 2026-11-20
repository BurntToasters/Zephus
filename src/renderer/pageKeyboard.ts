import { scrollToReveal } from "./revealSelection";

const PAGE_MOVE_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

const PAGE_CONTROLS = [
  "page-main",
  "page-nav-toggle",
  "page-manage-button",
] as const;

type PageControl = (typeof PAGE_CONTROLS)[number];

export function isPageMoveKey(key: string): boolean {
  return PAGE_MOVE_KEYS.has(key);
}

export type PageAction = "main" | "nav" | "manage";

export interface PageStopEntry {
  page: string;
  active?: boolean;
  loading?: boolean;
  interactionDisabled?: boolean;
}

/** 0 when this control is the list's single tab stop, otherwise -1. */
export function pageTabStop(
  page: string,
  kind: PageAction,
  stopPage: string | null,
  stopKind: string | null,
): 0 | -1 {
  return page === stopPage && kind === stopKind ? 0 : -1;
}

function actionEnabled(entry: PageStopEntry, kind: PageAction): boolean {
  if (entry.loading) return false;
  if (kind !== "main" && entry.interactionDisabled) return false;
  return true;
}

/**
 * The page control that stays in the tab order. A stored control is kept
 * only while it can still be used. Otherwise the open page is used, then
 * the first page that can be opened.
 */
export function pageStop(
  entries: readonly PageStopEntry[],
  activePage: string | null,
  activeKind: string | null,
): { page: string; kind: PageAction } | null {
  const kind =
    activeKind === "main" || activeKind === "nav" || activeKind === "manage"
      ? activeKind
      : null;
  const stored = entries.find((entry) => entry.page === activePage);
  if (stored && kind && actionEnabled(stored, kind)) {
    return { page: stored.page, kind };
  }
  const current = entries.find(
    (entry) => entry.active && actionEnabled(entry, "main"),
  );
  if (current) return { page: current.page, kind: "main" };
  const first = entries.find((entry) => actionEnabled(entry, "main"));
  if (first) return { page: first.page, kind: "main" };
  return null;
}

function pageControlKind(button: HTMLElement): PageControl | null {
  for (const kind of PAGE_CONTROLS) {
    if (button.classList.contains(kind)) return kind;
  }
  return null;
}

function enabledControl(
  row: HTMLElement,
  kind: PageControl,
): HTMLButtonElement | null {
  const button = row.querySelector(`button.${kind}`);
  if (!(button instanceof HTMLButtonElement) || button.disabled) return null;
  return button;
}

function firstEnabled(
  rows: readonly HTMLElement[],
  kind: PageControl,
  fromEnd: boolean,
): HTMLButtonElement | null {
  const start = fromEnd ? rows.length - 1 : 0;
  const step = fromEnd ? -1 : 1;
  for (let index = start; index >= 0 && index < rows.length; index += step) {
    const row = rows[index];
    if (!row) continue;
    const button = enabledControl(row, kind);
    if (button) return button;
  }
  return null;
}

/**
 * The page-list control an arrow, Home, or End key should move to.
 * A disabled action is skipped. The page itself is not opened.
 */
export function pageMoveTarget(
  rows: readonly HTMLElement[],
  current: HTMLElement,
  key: string,
): HTMLElement | null {
  if (!isPageMoveKey(key)) return null;
  const kind = pageControlKind(current);
  if (!kind) return null;
  const rowIndex = rows.findIndex((row) => row.contains(current));
  if (rowIndex < 0) return null;
  const kindIndex = PAGE_CONTROLS.indexOf(kind);

  if (key === "ArrowRight" || key === "ArrowLeft") {
    const row = rows[rowIndex];
    if (!row) return null;
    const step = key === "ArrowRight" ? 1 : -1;
    for (
      let index = kindIndex + step;
      index >= 0 && index < PAGE_CONTROLS.length;
      index += step
    ) {
      const nextKind = PAGE_CONTROLS[index];
      if (!nextKind) continue;
      const button = enabledControl(row, nextKind);
      if (button) return button;
    }
    return null;
  }

  if (key === "Home" || key === "End") {
    const button = firstEnabled(rows, kind, key === "End");
    if (!button || button === current) return null;
    return button;
  }

  const step = key === "ArrowDown" ? 1 : -1;
  for (
    let index = rowIndex + step;
    index >= 0 && index < rows.length;
    index += step
  ) {
    const row = rows[index];
    if (!row) continue;
    const button = enabledControl(row, kind);
    if (button) return button;
  }
  return null;
}

/** Moves focus through the page list. Enter still opens the focused page. */
export function onPageKeyDown(event: KeyboardEvent): void {
  const current = event.currentTarget;
  if (!(current instanceof HTMLElement) || event.target !== current) return;
  if (!isPageMoveKey(event.key) || !pageControlKind(current)) return;
  const root = current.ownerDocument;
  const rows = Array.from(
    root.querySelectorAll<HTMLElement>("#page-list > li.page-item"),
  );
  const buttons = rows.flatMap((row) =>
    Array.from(row.querySelectorAll<HTMLButtonElement>("button")),
  );
  const target = pageMoveTarget(rows, current, event.key);
  event.preventDefault();
  if (!target) return;
  for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
  target.focus({ preventScroll: true });
  const scroller = target.closest(".workspace-tab-panel");
  if (scroller instanceof HTMLElement) scrollToReveal(scroller, target, 8);
}
