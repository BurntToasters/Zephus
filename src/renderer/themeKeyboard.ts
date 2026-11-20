import { scrollToReveal } from "./revealSelection";

const THEME_MOVE_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

const THEME_CONTROLS = ["theme-preview-btn", "theme-select-btn"] as const;

type ThemeControl = (typeof THEME_CONTROLS)[number];

export type ThemeAction = "preview" | "select";

export interface ThemeStopEntry {
  id: string;
}

export function isThemeMoveKey(key: string): boolean {
  return THEME_MOVE_KEYS.has(key);
}

/** 0 when this control is the theme list's single tab stop, otherwise -1. */
export function themeTabStop(
  id: string,
  kind: ThemeAction,
  stopId: string | null,
  stopKind: string | null,
): 0 | -1 {
  return id === stopId && kind === stopKind ? 0 : -1;
}

/**
 * The theme control that stays in the tab order. A stored stop is kept
 * while that theme is still listed. Otherwise the first theme's preview is used.
 */
export function themeStop(
  entries: readonly ThemeStopEntry[],
  activeId: string | null,
  activeKind: string | null,
): { id: string; kind: ThemeAction } | null {
  const kind =
    activeKind === "preview" || activeKind === "select" ? activeKind : null;
  const stored = entries.find((entry) => entry.id === activeId);
  if (stored && kind) return { id: stored.id, kind };
  const first = entries[0];
  if (!first) return null;
  return { id: first.id, kind: "preview" };
}

function controlKind(button: HTMLElement): ThemeControl | null {
  for (const kind of THEME_CONTROLS) {
    if (button.classList.contains(kind)) return kind;
  }
  return null;
}

function controlButton(
  row: HTMLElement,
  kind: ThemeControl,
): HTMLButtonElement | null {
  const button = row.querySelector(`button.${kind}`);
  if (!(button instanceof HTMLButtonElement) || button.disabled) return null;
  return button;
}

function firstControl(
  rows: readonly HTMLElement[],
  kind: ThemeControl,
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
 * The theme control an arrow, Home, or End key should move to.
 * The theme is not previewed, selected, or created.
 */
export function themeMoveTarget(
  rows: readonly HTMLElement[],
  current: HTMLElement,
  key: string,
): HTMLButtonElement | null {
  if (!isThemeMoveKey(key)) return null;
  const kind = controlKind(current);
  if (!kind) return null;
  const rowIndex = rows.findIndex((row) => row.contains(current));
  if (rowIndex < 0) return null;
  const kindIndex = THEME_CONTROLS.indexOf(kind);

  if (key === "ArrowRight" || key === "ArrowLeft") {
    const row = rows[rowIndex];
    if (!row) return null;
    const step = key === "ArrowRight" ? 1 : -1;
    for (
      let index = kindIndex + step;
      index >= 0 && index < THEME_CONTROLS.length;
      index += step
    ) {
      const nextKind = THEME_CONTROLS[index];
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

/** Moves focus through starter themes. Enter still runs the focused action. */
export function onThemeKeyDown(event: KeyboardEvent): void {
  const current = event.currentTarget;
  if (!(current instanceof HTMLElement) || event.target !== current) return;
  if (!isThemeMoveKey(event.key) || !controlKind(current)) return;
  const root = current.ownerDocument;
  const rows = Array.from(
    root.querySelectorAll<HTMLElement>("#theme-list-container > .theme-card"),
  );
  const buttons = rows.flatMap((row) =>
    Array.from(
      row.querySelectorAll<HTMLButtonElement>(
        "button.theme-preview-btn, button.theme-select-btn",
      ),
    ),
  );
  const target = themeMoveTarget(rows, current, event.key);
  event.preventDefault();
  if (!target) return;
  for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
  target.focus({ preventScroll: true });
  const scroller = target.closest(".start-main");
  if (scroller instanceof HTMLElement) scrollToReveal(scroller, target, 8);
}
