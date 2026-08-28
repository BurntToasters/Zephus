export type EditorWorkspaceSide = "left" | "right";

interface ActivateWorkspaceOptions {
  focus?: boolean;
}

function workspaceRoot(side: EditorWorkspaceSide): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `.panel.${side}[data-workspace-side="${side}"]`,
  );
}

export function activateWorkspaceTab(
  side: EditorWorkspaceSide,
  tabId: string,
  options: ActivateWorkspaceOptions = {},
): void {
  const root = workspaceRoot(side);
  if (!root) return;

  const tabs = Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-workspace-tab]"),
  );
  const panels = Array.from(
    root.querySelectorAll<HTMLElement>("[data-workspace-panel]"),
  );
  const target = tabs.find((tab) => tab.dataset["workspaceTab"] === tabId);
  if (!target) return;

  const activeElement = document.activeElement;
  const focusWouldBeHidden = panels.some(
    (panel) =>
      panel.dataset["workspacePanel"] !== tabId &&
      activeElement instanceof Node &&
      panel.contains(activeElement),
  );

  for (const tab of tabs) {
    const active = tab === target;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  for (const panel of panels) {
    const active = panel.dataset["workspacePanel"] === tabId;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  }
  root.dataset["activeWorkspaceTab"] = tabId;
  if (options.focus || focusWouldBeHidden) target.focus();
}

function moveTabFocus(
  side: EditorWorkspaceSide,
  current: HTMLButtonElement,
  direction: -1 | 1,
): void {
  const root = workspaceRoot(side);
  if (!root) return;
  const tabs = Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-workspace-tab]"),
  );
  const index = tabs.indexOf(current);
  if (index < 0 || tabs.length === 0) return;
  const next = tabs[(index + direction + tabs.length) % tabs.length];
  const tabId = next?.dataset["workspaceTab"];
  if (next && tabId) activateWorkspaceTab(side, tabId, { focus: true });
}

export function initEditorWorkspaceTabs(): void {
  for (const side of ["left", "right"] as const) {
    const root = workspaceRoot(side);
    if (!root) continue;
    const tabs = Array.from(
      root.querySelectorAll<HTMLButtonElement>("[data-workspace-tab]"),
    );
    for (const tab of tabs) {
      tab.addEventListener("click", () => {
        const tabId = tab.dataset["workspaceTab"];
        if (tabId) activateWorkspaceTab(side, tabId);
      });
      tab.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          moveTabFocus(side, tab, 1);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          moveTabFocus(side, tab, -1);
        } else if (event.key === "Home") {
          event.preventDefault();
          const firstId = tabs[0]?.dataset["workspaceTab"];
          if (firstId) activateWorkspaceTab(side, firstId, { focus: true });
        } else if (event.key === "End") {
          event.preventDefault();
          const lastId = tabs.at(-1)?.dataset["workspaceTab"];
          if (lastId) activateWorkspaceTab(side, lastId, { focus: true });
        }
      });
    }

    const initial =
      tabs.find((tab) => tab.getAttribute("aria-selected") === "true") ??
      tabs[0];
    const initialId = initial?.dataset["workspaceTab"];
    if (initialId) activateWorkspaceTab(side, initialId);
  }
}
