import { scrollToReveal } from "./revealSelection";

const ASSET_MOVE_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

const ASSET_CONTROLS = [
  "asset-tile",
  "asset-rename-btn",
  "asset-delete-btn",
] as const;

type AssetControl = (typeof ASSET_CONTROLS)[number];

export type AssetAction = "select" | "rename" | "delete";

export interface AssetStopEntry {
  webPath: string;
  canRename?: boolean;
  canDelete?: boolean;
}

export function isAssetMoveKey(key: string): boolean {
  return ASSET_MOVE_KEYS.has(key);
}

/** 0 when this control is the browser's single tab stop, otherwise -1. */
export function assetTabStop(
  webPath: string,
  kind: AssetAction,
  stopPath: string | null,
  stopKind: string | null,
): 0 | -1 {
  return webPath === stopPath && kind === stopKind ? 0 : -1;
}

function actionAvailable(entry: AssetStopEntry, kind: AssetAction): boolean {
  if (kind === "select") return true;
  if (kind === "rename") return !!entry.canRename;
  return !!entry.canDelete;
}

/**
 * The asset control that stays in the tab order. A stored rename or delete
 * stop is kept only while that action exists. Otherwise the first asset is used.
 */
export function assetStop(
  entries: readonly AssetStopEntry[],
  activePath: string | null,
  activeKind: string | null,
): { webPath: string; kind: AssetAction } | null {
  const kind =
    activeKind === "select" ||
    activeKind === "rename" ||
    activeKind === "delete"
      ? activeKind
      : null;
  const stored = entries.find((entry) => entry.webPath === activePath);
  if (stored && kind && actionAvailable(stored, kind)) {
    return { webPath: stored.webPath, kind };
  }
  const first = entries[0];
  if (!first) return null;
  return { webPath: first.webPath, kind: "select" };
}

function controlKind(button: HTMLElement): AssetControl | null {
  for (const kind of ASSET_CONTROLS) {
    if (button.classList.contains(kind)) return kind;
  }
  return null;
}

function controlButton(
  row: HTMLElement,
  kind: AssetControl,
): HTMLButtonElement | null {
  const button = row.querySelector(`button.${kind}`);
  if (!(button instanceof HTMLButtonElement) || button.disabled) return null;
  return button;
}

function firstControl(
  rows: readonly HTMLElement[],
  kind: AssetControl,
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
 * The asset control an arrow, Home, or End key should move to.
 * The asset is not selected, renamed, or deleted.
 */
export function assetMoveTarget(
  rows: readonly HTMLElement[],
  current: HTMLElement,
  key: string,
): HTMLButtonElement | null {
  if (!isAssetMoveKey(key)) return null;
  const kind = controlKind(current);
  if (!kind) return null;
  const rowIndex = rows.findIndex((row) => row.contains(current));
  if (rowIndex < 0) return null;
  const kindIndex = ASSET_CONTROLS.indexOf(kind);

  if (key === "ArrowRight" || key === "ArrowLeft") {
    const row = rows[rowIndex];
    if (!row) return null;
    const step = key === "ArrowRight" ? 1 : -1;
    for (
      let index = kindIndex + step;
      index >= 0 && index < ASSET_CONTROLS.length;
      index += step
    ) {
      const nextKind = ASSET_CONTROLS[index];
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

/** Moves focus through the asset browser. Enter still runs the focused action. */
export function onAssetKeyDown(event: KeyboardEvent): void {
  const current = event.currentTarget;
  if (!(current instanceof HTMLElement) || event.target !== current) return;
  if (!isAssetMoveKey(event.key) || !controlKind(current)) return;
  const root = current.ownerDocument;
  const rows = Array.from(
    root.querySelectorAll<HTMLElement>(".asset-grid > .asset-tile-wrap"),
  );
  const buttons = rows.flatMap((row) =>
    Array.from(row.querySelectorAll<HTMLButtonElement>("button")),
  );
  const target = assetMoveTarget(rows, current, event.key);
  event.preventDefault();
  if (!target) return;
  for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
  target.focus({ preventScroll: true });
  const scroller = target.closest(".asset-grid");
  if (scroller instanceof HTMLElement) scrollToReveal(scroller, target, 8);
}
