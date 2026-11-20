import { scrollToReveal } from "./revealSelection";

const TEMPLATE_MOVE_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

const TEMPLATE_CONTROLS = [
  "template-insert-btn",
  "template-delete-btn",
] as const;

type TemplateControl = (typeof TEMPLATE_CONTROLS)[number];

export interface TemplateStopEntry {
  id: string;
  deletable?: boolean;
}

export function isTemplateMoveKey(key: string): boolean {
  return TEMPLATE_MOVE_KEYS.has(key);
}

/** 0 when this control is the list's single tab stop, otherwise -1. */
export function templateTabStop(
  id: string,
  kind: "insert" | "delete",
  stopId: string | null,
  stopKind: string | null,
): 0 | -1 {
  return id === stopId && kind === stopKind ? 0 : -1;
}

/**
 * The control that stays in the tab order. A stored delete stop is kept only
 * while that section can still be deleted. Otherwise the first insert is used.
 */
export function templateStop(
  templates: readonly TemplateStopEntry[],
  activeId: string | null,
  activeKind: string | null,
): { id: string; kind: "insert" | "delete" } | null {
  const active = templates.find((entry) => entry.id === activeId);
  const kind =
    activeKind === "insert" || activeKind === "delete" ? activeKind : null;
  if (active && kind && (kind === "insert" || active.deletable)) {
    return { id: active.id, kind };
  }
  const first = templates[0];
  if (!first) return null;
  return { id: first.id, kind: "insert" };
}

function controlKind(button: HTMLElement): TemplateControl | null {
  for (const kind of TEMPLATE_CONTROLS) {
    if (button.classList.contains(kind)) return kind;
  }
  return null;
}

function controlButton(
  row: HTMLElement,
  kind: TemplateControl,
): HTMLButtonElement | null {
  const button = row.querySelector(`button.${kind}`);
  if (!(button instanceof HTMLButtonElement) || button.disabled) return null;
  return button;
}

function firstControl(
  rows: readonly HTMLElement[],
  kind: TemplateControl,
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
 * The saved-section control an arrow, Home, or End key should move to.
 * A row without Delete is skipped when moving in that column.
 * The section is not inserted or deleted.
 */
export function templateMoveTarget(
  rows: readonly HTMLElement[],
  current: HTMLElement,
  key: string,
): HTMLButtonElement | null {
  if (!isTemplateMoveKey(key)) return null;
  const kind = controlKind(current);
  if (!kind) return null;
  const rowIndex = rows.findIndex((row) => row.contains(current));
  if (rowIndex < 0) return null;
  const kindIndex = TEMPLATE_CONTROLS.indexOf(kind);

  if (key === "ArrowRight" || key === "ArrowLeft") {
    const row = rows[rowIndex];
    if (!row) return null;
    const step = key === "ArrowRight" ? 1 : -1;
    for (
      let index = kindIndex + step;
      index >= 0 && index < TEMPLATE_CONTROLS.length;
      index += step
    ) {
      const nextKind = TEMPLATE_CONTROLS[index];
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

/** Moves focus through saved sections. Enter still inserts or deletes. */
export function onTemplateKeyDown(event: KeyboardEvent): void {
  const current = event.currentTarget;
  if (!(current instanceof HTMLElement) || event.target !== current) return;
  if (!isTemplateMoveKey(event.key) || !controlKind(current)) return;
  const root = current.ownerDocument;
  const rows = Array.from(
    root.querySelectorAll<HTMLElement>("#template-palette > li"),
  );
  const buttons = rows.flatMap((row) =>
    Array.from(row.querySelectorAll<HTMLButtonElement>("button")),
  );
  const target = templateMoveTarget(rows, current, event.key);
  event.preventDefault();
  if (!target) return;
  for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
  target.focus({ preventScroll: true });
  const scroller = target.closest(".workspace-tab-panel");
  if (scroller instanceof HTMLElement) scrollToReveal(scroller, target, 8);
}
