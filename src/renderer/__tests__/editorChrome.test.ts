// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChromeActions } from "../editorChrome";
import type { ChromeDeps } from "../editorChrome";

function makeDeps(overrides: Partial<ChromeDeps> = {}) {
  let appSettings: {
    theme?: string;
    codeFontSize?: number;
    lastOpenedProject?: string;
    restoreLastProject?: boolean;
    recentProjects?: string[];
  } | null = null;
  let updaterSnapshot: { status: string } | null = null;
  const statuses: string[] = [];
  const modals: string[] = [];
  const buttons: Record<string, { onclick: (() => void) | null }> = {};
  const listeners: Record<string, Array<(e: unknown) => void>> = {};

  document.body.innerHTML = `
    <div id="sidebar-app-version"></div>
    <button id="btn-create"></button>
    <button id="btn-settings"></button>
    <div id="preview-url-chip"></div>
    <button id="btn-resume-last"></button>
    <button id="btn-open"></button>
    <button id="btn-new-page"></button>
    <button id="btn-find-replace"></button>
    <button id="btn-regen-nav"></button>
    <button id="btn-site-shell"></button>
    <button id="btn-design-system"></button>
    <button id="mode-visual"></button>
    <button id="mode-code"></button>
    <button id="btn-undo"></button>
    <button id="btn-redo"></button>
    <button id="btn-save"></button>
    <button id="btn-publish"></button>
    <button id="btn-preview"></button>
    <button id="btn-help"></button>
    <button id="btn-close"></button>
    <button id="vp-desktop"></button>
    <button id="vp-tablet"></button>
    <button id="vp-mobile"></button>
    <div id="canvas"></div>
    <div id="tab-create"></div>
    <div id="status-bar"></div>
  `;

  const deps: ChromeDeps = {
    getState: () =>
      ({ project: null, previewUrl: null, mode: "visual" }) as never,
    $: (id: string) => {
      const el = document.getElementById(id);
      if (!el) throw new Error("missing #" + id);
      return el as HTMLElement;
    },
    $maybe: (id: string) => document.getElementById(id) as HTMLElement | null,
    setStatus: (m: string) => statuses.push(m),
    refreshIcons: () => undefined,
    maybeResolveUnsavedWork: async () => true,
    renderLayers: () => undefined,
    renderThemePlaceholder: () => undefined,
    refreshGuidancePanels: () => undefined,
    updateUndoRedoButtons: () => undefined,
    setViewport: () => undefined,
    setMode: () => undefined,
    doUndo: () => undefined,
    doRedo: () => undefined,
    performSave: async () => true,
    publishSite: async () => undefined,
    togglePreview: async () => undefined,
    openHelpModal: () => undefined,
    closeProject: async () => undefined,
    resetPreviewState: () => undefined,
    openSettingsModal: async () => undefined,
    createSiteFromTabFlow: async () => undefined,
    openProjectByPath: async () => undefined,
    chooseFolder: async () => undefined,
    newPageFlow: async () => undefined,
    openFindReplaceModal: async () => undefined,
    regenerateNav: async () => undefined,
    openSiteShellModal: async () => undefined,
    openDesignSystemModal: async () => undefined,
    refreshHomeDraftSummaries: async () => undefined,
    renderRecent: async () => undefined,
    renderHomeStatusPanels: () => undefined,
    refreshUpdaterControls: () => undefined,
    promptDownloadedUpdate: () => undefined,
    updateVersionLabel: () => "1.0.0",
    applyCodeFontSize: () => undefined,
    onKeydown: () => undefined,
    cmUndo: () => undefined,
    cmRedo: () => undefined,
    installSmokeHook: () => undefined,
    setAppSettings: (s) => {
      appSettings = s as {
        theme?: string;
        codeFontSize?: number;
        lastOpenedProject?: string;
        restoreLastProject?: boolean;
        recentProjects?: string[];
      } | null;
    },
    getAppSettings: () => appSettings as never,
    setUpdaterSnapshot: (s: { status: string } | null) => {
      updaterSnapshot = s;
    },
    showModal: (t: string) => modals.push(t),
    closeModal: () => undefined,
    ...overrides,
  };
  return {
    deps,
    statuses,
    modals,
    getAppSettings: () => appSettings,
    getUpdaterSnapshot: () => updaterSnapshot,
    getButton: (id: string) => document.getElementById(id) as HTMLButtonElement,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  (window as unknown as { zephus?: unknown }).zephus = {
    onReloadRequested: () => () => undefined,
    onPreviewClosed: () => () => undefined,
    onPreviewExited: () => () => undefined,
    getAppVersion: async () => "1.0.0",
    closePreviewWindow: async () => ({ ok: true }),
    readGlobalSettings: async () => ({ recentProjects: [] }),
    onUpdaterStatus: () => () => undefined,
    getLastUpdaterStatus: async () => null,
  };
});

describe("chrome", () => {
  it("wires the toolbar buttons during install", () => {
    const { deps, getButton } = makeDeps();
    const chrome = createChromeActions(deps);
    chrome.installChrome();
    expect(getButton("btn-save").onclick).toBeTruthy();
    expect(getButton("btn-close").onclick).toBeTruthy();
    expect(getButton("btn-publish").onclick).toBeTruthy();
    expect(getButton("vp-mobile").onclick).toBeTruthy();
  });

  it("bootstrap loads settings and applies the theme", async () => {
    const { deps, getAppSettings } = makeDeps();
    (window as unknown as { zephus?: unknown }).zephus = {
      readGlobalSettings: async () => ({
        theme: "dark",
        codeFontSize: 14,
        recentProjects: [],
      }),
      onUpdaterStatus: () => () => undefined,
      getLastUpdaterStatus: async () => null,
    };
    const chrome = createChromeActions(deps);
    await chrome.bootstrap();
    expect(getAppSettings()?.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("bootstrap shows onboarding only for brand-new users", async () => {
    const { deps, modals } = makeDeps();
    (window as unknown as { zephus?: unknown }).zephus = {
      readGlobalSettings: async () => ({
        theme: "system",
        codeFontSize: 13,
        recentProjects: [],
      }),
      onUpdaterStatus: () => () => undefined,
      getLastUpdaterStatus: async () => null,
    };
    const chrome = createChromeActions(deps);
    await chrome.bootstrap();
    expect(modals).toContain("Welcome to Zephus");

    // Existing user: no onboarding.
    const { deps: deps2, modals: modals2 } = makeDeps();
    (window as unknown as { zephus?: unknown }).zephus = {
      readGlobalSettings: async () => ({
        theme: "system",
        codeFontSize: 13,
        recentProjects: ["/existing"],
      }),
      onUpdaterStatus: () => () => undefined,
      getLastUpdaterStatus: async () => null,
    };
    await createChromeActions(deps2).bootstrap();
    expect(modals2).not.toContain("Welcome to Zephus");
  });

  it("bootstrap restores the last project when opted in", async () => {
    const { deps, getAppSettings } = makeDeps();
    let opened: string | null = null;
    (window as unknown as { zephus?: unknown }).zephus = {
      readGlobalSettings: async () => ({
        theme: "system",
        codeFontSize: 13,
        recentProjects: ["/last"],
        lastOpenedProject: "/last",
        restoreLastProject: true,
      }),
      onUpdaterStatus: () => () => undefined,
      getLastUpdaterStatus: async () => null,
    };
    const chrome = createChromeActions(
      makeDeps({
        openProjectByPath: async (folder: string) => {
          opened = folder;
        },
      }).deps,
    );
    await chrome.bootstrap();
    expect(opened).toBe("/last");
    void getAppSettings;
  });

  it("installs the close guard that allows a force-close via the marker", () => {
    const { deps } = makeDeps();
    const chrome = createChromeActions(deps);
    chrome.installChrome();
    expect(
      typeof (window as unknown as { zephusMarkForceCloseAllowed?: unknown })
        .zephusMarkForceCloseAllowed,
    ).toBe("function");
  });
});
