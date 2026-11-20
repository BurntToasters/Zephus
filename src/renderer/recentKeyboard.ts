import { scrollToReveal } from "./revealSelection";

const RECENT_MOVE_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

const RECENT_CONTROLS = ["recent-project", "recent-remove"] as const;

type RecentControl = (typeof RECENT_CONTROLS)[number];

export interface RecentStopEntry {
  path: string;
}

export function isRecentMoveKey(key: string): boolean {
  return RECENT_MOVE_KEYS.has(key);
}

/** 0 when this control is the list's single tab stop, otherwise -1. */
export function recentTabStop(
  path: string,
  kind: "open" | "remove",
  stopPath: string | null,
  stopKind: string | null,
): 0 | -1 {
  return path === stopPath && kind === stopKind ? 0 : -1;
}

/**
 * The recent-project control that stays in the tab order. A stored control
 * is kept while that project is still listed. Otherwise the first project
 * is used.
 */
export function recentStop(
  entries: readonly RecentStopEntry[],
  activePath: string | null,
  activeKind: string | null,
): { path: string; kind: "open" | "remove" } | null {
  const kind =
    activeKind === "open" || activeKind === "remove" ? activeKind : null;
  const stored = entries.find((entry) => entry.path === activePath);
  if (stored && kind) return { path: stored.path, kind };
  const first = entries[0];
  if (!first) return null;
  return { path: first.path, kind: "open" };
}

function controlKind(button: HTMLElement): RecentControl | null {
  for (const kind of RECENT_CONTROLS) {
    if (button.classList.contains(kind)) return kind;
  }
  return null;
}

function controlButton(
  row: HTMLElement,
  kind: RecentControl,
): HTMLButtonElement | null {
  const button = row.querySelector(`button.${kind}`);
  if (!(button instanceof HTMLButtonElement) || button.disabled) return null;
  return button;
}

function firstControl(
  rows: readonly HTMLElement[],
  kind: RecentControl,
  fromEnd: boolean,
): HTMLButtonElement | null {
  const start = fromEnd ? rows.length - 1 : 0;
  const step = fromEnd ? -1 : 1;
  for (let index = start; index >= 0 && index < rows.length; index += step) {
    const row = rows[index];
    if (!row) continue;
    const button = controlButton(row, kind);
    if (button) return button;
  }
  return null;
}

/**
 * The recent-project control an arrow, Home, or End key should move to.
 * The project is not opened or removed.
 */
export function recentMoveTarget(
  rows: readonly HTMLElement[],
  current: HTMLElement,
  key: string,
): HTMLButtonElement | null {
  if (!isRecentMoveKey(key)) return null;
  const kind = controlKind(current);
  if (!kind) return null;
  const rowIndex = rows.findIndex((row) => row.contains(current));
  if (rowIndex < 0) return null;
  const kindIndex = RECENT_CONTROLS.indexOf(kind);

  if (key === "ArrowRight" || key === "ArrowLeft") {
    const row = rows[rowIndex];
    if (!row) return null;
    const step = key === "ArrowRight" ? 1 : -1;
    for (
      let index = kindIndex + step;
      index >= 0 && index < RECENT_CONTROLS.length;
      index += step
    ) {
      const nextKind = RECENT_CONTROLS[index];
      if (!nextKind) continue;
      const button = controlButton(row, nextKind);
      if (button) return button;
    }
    return null;
  }

  if (key === "Home" || key === "End") {
    const button = firstControl(rows, kind, key === "End");
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
    const button = controlButton(row, kind);
    if (button) return button;
  }
  return null;
}

/** Moves focus through recent projects. Enter still opens or removes. */
export function onRecentKeyDown(event: KeyboardEvent): void {
  const current = event.currentTarget;
  if (!(current instanceof HTMLElement) || event.target !== current) return;
  if (!isRecentMoveKey(event.key) || !controlKind(current)) return;
  const root = current.ownerDocument;
  const rows = Array.from(
    root.querySelectorAll<HTMLElement>("#recent-list > li"),
  );
  const buttons = rows.flatMap((row) =>
    Array.from(row.querySelectorAll<HTMLButtonElement>("button")),
  );
  const target = recentMoveTarget(rows, current, event.key);
  event.preventDefault();
  if (!target) return;
  for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
  target.focus({ preventScroll: true });
  const scroller = target.closest(".start-main");
  if (scroller instanceof HTMLElement) scrollToReveal(scroller, target, 8);
}
