// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  activateWorkspaceTab,
  initEditorWorkspaceTabs,
} from "../editorWorkspace";

function mountPanels(): void {
  document.body.innerHTML = `
    <div class="panel left" data-workspace-side="left">
      <button data-workspace-tab="pages" aria-selected="true">Pages</button>
      <button data-workspace-tab="assets">Assets</button>
      <div data-workspace-panel="pages"><input id="page-input" /></div>
      <div data-workspace-panel="assets" hidden><input id="asset-input" /></div>
    </div>
  `;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("activateWorkspaceTab", () => {
  it("switches the active tab and panel", () => {
    mountPanels();
    initEditorWorkspaceTabs();

    const pagesTab = document.querySelector(
      '[data-workspace-tab="pages"]',
    ) as HTMLButtonElement;
    const assetsTab = document.querySelector(
      '[data-workspace-tab="assets"]',
    ) as HTMLButtonElement;
    const pagesPanel = document.querySelector(
      '[data-workspace-panel="pages"]',
    ) as HTMLElement;
    const assetsPanel = document.querySelector(
      '[data-workspace-panel="assets"]',
    ) as HTMLElement;

    expect(pagesTab.classList.contains("active")).toBe(true);
    expect(assetsPanel.hidden).toBe(true);

    activateWorkspaceTab("left", "assets");

    expect(assetsTab.classList.contains("active")).toBe(true);
    expect(assetsTab.getAttribute("aria-selected")).toBe("true");
    expect(pagesTab.classList.contains("active")).toBe(false);
    expect(assetsPanel.hidden).toBe(false);
    expect(pagesPanel.hidden).toBe(true);
  });

  it("moves focus off a hidden panel so it is not left in a hidden container", () => {
    mountPanels();
    initEditorWorkspaceTabs();

    const assetInput = document.getElementById("asset-input")!;
    assetInput.focus();
    // Activating the pages tab while focus sits in the (soon hidden) assets
    // panel must move focus to the tab, not strand it in a hidden panel.
    activateWorkspaceTab("left", "pages");

    expect(document.activeElement?.tagName).toBe("BUTTON");
    expect(
      (document.activeElement as HTMLElement).dataset["workspaceTab"],
    ).toBe("pages");
  });

  it("does not steal focus when it is not about to be hidden", () => {
    mountPanels();
    initEditorWorkspaceTabs();

    const pageInput = document.getElementById("page-input")!;
    pageInput.focus();
    activateWorkspaceTab("left", "pages");

    expect(document.activeElement).toBe(pageInput);
  });
});

describe("initEditorWorkspaceTabs", () => {
  it("switches tabs on click", () => {
    mountPanels();
    initEditorWorkspaceTabs();

    const assetsTab = document.querySelector(
      '[data-workspace-tab="assets"]',
    ) as HTMLButtonElement;
    assetsTab.click();

    expect(assetsTab.classList.contains("active")).toBe(true);
    expect(assetsTab.getAttribute("aria-selected")).toBe("true");
  });

  it("supports arrow-key tab navigation with roving focus", () => {
    mountPanels();
    initEditorWorkspaceTabs();

    const pagesTab = document.querySelector(
      '[data-workspace-tab="pages"]',
    ) as HTMLButtonElement;
    pagesTab.focus();

    pagesTab.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(
      (document.activeElement as HTMLElement).dataset["workspaceTab"],
    ).toBe("assets");
    expect(
      (document.activeElement as HTMLElement).classList.contains("active"),
    ).toBe(true);

    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    expect(
      (document.activeElement as HTMLElement).dataset["workspaceTab"],
    ).toBe("pages");
  });
});
