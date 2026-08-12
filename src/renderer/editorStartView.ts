/**
 * Start view (home screen): start tabs, theme picker, settings tab, about/
 * licenses tab, and the create-site flow. Extracted from the engine so the
 * start-view state (selectedTabTheme, themePreviewBaseUrl, startThemes,
 * siteCreateInFlight) and its ~380 lines live in one place.
 */

import { renderThemePreviewModalBody } from "./MiscModals";
import { updateAboutLicenses } from "./AboutLicenses";
import {
  initializeSettingsTab,
  updateSettingsTabNode,
  updateSettingsTabUpdater,
} from "./SettingsTab";
import { updateThemesTab } from "./ThemesTab";
import type { InstallFlowResult } from "./editorPreviewPublish";
import type { GlobalSettings } from "../main/types";
import type { EditorSessionState } from "./editorSession";

export interface StartViewDeps {
  getState: () => EditorSessionState;
  $: (id: string) => HTMLElement;
  $maybe: (id: string) => HTMLElement | null;
  setStatus: (message: string) => void;
  showModal: (
    title: string,
    body: string,
    actions: Array<{
      label: string;
      kind?: "primary" | "danger" | "ghost";
      onClick: () => void;
    }>,
  ) => void;
  showModalNode: (
    title: string,
    content: HTMLElement,
    actions: Array<{
      label: string;
      kind?: "primary" | "danger" | "ghost";
      onClick: () => void;
    }>,
    options?: { size?: "default" | "wide" },
  ) => void;
  closeModal: () => void;
  openSettingsModal: () => Promise<void>;
  openProjectByPath: (folder: string) => Promise<void>;
  updaterStatusMessage: () => string;
  currentUpdaterActions: () => Array<{
    id: "check" | "download" | "restart" | "cancel";
    label: string;
    tone: "secondary" | "primary" | "ghost";
  }>;
  nodeStatusMessage: (res: NodeCheckResult) => string;
  friendlyError: (raw: string | undefined) => string;
  runInstallFlow: (folder: string) => Promise<InstallFlowResult>;
}

export function createStartViewActions(deps: StartViewDeps) {
  const {
    getState,
    $,
    $maybe,
    setStatus,
    showModal,
    showModalNode,
    closeModal,
    openSettingsModal,
    openProjectByPath,
    updaterStatusMessage,
    currentUpdaterActions,
    nodeStatusMessage,
    friendlyError,
    runInstallFlow,
  } = deps;

  const state = getState();

  let selectedTabTheme: string | null = null;
  let themePreviewBaseUrl: string | null = null;
  let startThemes: ThemeMeta[] | null = null;
  function initStartTabs(): void {
    const tabs = ["recent", "create", "settings", "about"] as const;
    const tabBtns = tabs.map((t) => $("tab-" + t));

    // Wire click handlers.
    for (const [i, t] of tabs.entries()) {
      const btn = tabBtns[i];
      if (btn) btn.onclick = () => void switchStartTab(t);
    }

    // Arrow-key roving tabindex (ARIA Authoring Practices Guide — Tabs pattern).
    // Only one tab is in the natural tab order at a time; Left/Right/Home/End
    // move focus within the tablist without requiring an extra Tab keypress.
    const tablist = document.querySelector<HTMLElement>(
      ".start-nav[role='tablist']",
    );
    if (!tablist) return;
    tablist.addEventListener("keydown", (e) => {
      const currentIndex = tabBtns.findIndex(
        (btn) => btn === document.activeElement,
      );
      if (currentIndex < 0) return;
      let next = -1;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        next = (currentIndex + 1) % tabs.length;
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        next = (currentIndex - 1 + tabs.length) % tabs.length;
      } else if (e.key === "Home") {
        next = 0;
      } else if (e.key === "End") {
        next = tabs.length - 1;
      }
      if (next < 0) return;
      e.preventDefault();
      const target = tabs[next]!;
      void switchStartTab(target);
      tabBtns[next]?.focus();
    });
  }

  async function switchStartTab(
    target: "recent" | "create" | "settings" | "about",
  ): Promise<void> {
    const tabs = ["recent", "create", "settings", "about"] as const;
    for (const t of tabs) {
      const tabBtn = $("tab-" + t);
      const pane = $("pane-" + t);
      if (tabBtn) {
        tabBtn.classList.toggle("active", t === target);
        tabBtn.setAttribute("aria-selected", t === target ? "true" : "false");
        tabBtn.setAttribute("tabindex", t === target ? "0" : "-1");
      }
      if (pane) {
        pane.classList.toggle("active", t === target);
        pane.classList.toggle("hidden", t !== target);
      }
    }
    if (target === "create") {
      await renderThemesInTab();
    } else if (target === "settings") {
      await renderSettingsInTab();
    } else if (target === "about") {
      await renderAboutAndLicensesInTab();
    }
  }

  async function activateHomeSection(
    section: "recent" | "create" | "settings" | "about",
  ): Promise<void> {
    await switchStartTab(section);
  }

  function syncCreateButtonState(): void {
    const btnCreate = $("btn-create") as HTMLButtonElement;
    if (!btnCreate) return;
    const enabled = selectedTabTheme !== null;
    btnCreate.disabled = !enabled;
    btnCreate.classList.toggle("disabled", !enabled);
  }

  function previewUrlForTheme(theme: ThemeMeta): string | null {
    if (!themePreviewBaseUrl) return null;
    return new URL(theme.previewPath, themePreviewBaseUrl).toString();
  }

  function selectThemeCard(themeId: string): void {
    selectedTabTheme = themeId;
    if (startThemes) {
      updateThemesTab({
        mode: "ready",
        themes: startThemes.map((theme) => ({
          id: theme.id,
          name: theme.name,
          description: theme.description,
          previewUrl: previewUrlForTheme(theme),
          selected: theme.id === selectedTabTheme,
          header: getThemeHeaderDetails(theme.id),
        })),
      });
    }
    syncCreateButtonState();
  }

  function openThemePreviewModal(theme: ThemeMeta): void {
    const previewUrl = previewUrlForTheme(theme);
    if (!previewUrl) {
      showModal(
        "Theme Preview Unavailable",
        "The bundled theme previews are not ready yet.",
        [{ label: "OK", kind: "primary", onClick: closeModal }],
      );
      return;
    }

    const wrap = document.createElement("div");
    renderThemePreviewModalBody(wrap, {
      description: theme.description,
      previewUrl,
      themeName: theme.name,
    });

    showModalNode(
      `${theme.name} Preview`,
      wrap,
      [
        { label: "Close", kind: "ghost", onClick: closeModal },
        {
          label: "Choose Folder & Create Site",
          kind: "primary",
          onClick: () => {
            selectThemeCard(theme.id);
            closeModal();
            void createSiteFromTabFlow();
          },
        },
      ],
      { size: "wide" },
    );
  }

  function getThemeHeaderDetails(themeId: string): {
    gradient: string;
    icon: string;
  } {
    const id = themeId.toLowerCase();
    if (id.includes("doc")) {
      return {
        gradient: "linear-gradient(135deg, #312e81, #1e3a8a)",
        icon: "book-open",
      };
    } else if (id.includes("blog")) {
      return {
        gradient: "linear-gradient(135deg, #7c2d12, #451a03)",
        icon: "edit-3",
      };
    } else if (id.includes("port")) {
      return {
        gradient: "linear-gradient(135deg, #164e63, #155e75)",
        icon: "image",
      };
    } else if (id.includes("min") || id.includes("blank")) {
      return {
        gradient: "linear-gradient(135deg, #374151, #111827)",
        icon: "terminal",
      };
    } else {
      return {
        gradient: "linear-gradient(135deg, #064e3b, #022c22)",
        icon: "rocket",
      };
    }
  }

  async function renderThemesInTab(): Promise<void> {
    updateThemesTab({ mode: "loading", themes: [] });

    try {
      if (!startThemes) {
        startThemes = await window.zephus.listThemes();
      }
      if (!themePreviewBaseUrl) {
        const previewServer = await window.zephus.ensureThemePreviewServer();
        if (!previewServer.ok || !previewServer.baseUrl) {
          throw new Error(
            previewServer.error ?? "Could not start theme preview server.",
          );
        }
        themePreviewBaseUrl = previewServer.baseUrl;
      }

      updateThemesTab({
        mode: "ready",
        themes: startThemes.map((theme) => ({
          id: theme.id,
          name: theme.name,
          description: theme.description,
          previewUrl: previewUrlForTheme(theme),
          selected: theme.id === selectedTabTheme,
          header: getThemeHeaderDetails(theme.id),
        })),
      });
      syncCreateButtonState();
    } catch (err) {
      updateThemesTab({
        mode: "error",
        error: String(err),
        themes: [],
      });
    }
  }

  async function renderSettingsInTab(): Promise<void> {
    let settings: GlobalSettings;
    try {
      settings = await window.zephus.readGlobalSettings();
    } catch {
      setStatus("Could not load settings.");
      return;
    }
    initializeSettingsTab(settings);
    updateSettingsTabUpdater(updaterStatusMessage(), currentUpdaterActions());
    updateSettingsTabNode("Checking Node.js…", !settings.customNodePath);

    const applyNodeStatus = (
      res: NodeCheckResult,
      currentSettings: GlobalSettings,
    ): void => {
      const label =
        res.status === "ok"
          ? `Node.js ${res.version} detected ✓`
          : res.status === "outdated"
            ? `Node.js ${res.version ?? "?"} — version 22.12+ required`
            : res.status === "missing"
              ? "Node.js not found — set a custom location below"
              : "Node.js status could not be determined";
      const source = currentSettings.customNodePath
        ? `Custom: ${currentSettings.customNodePath}`
        : "Auto-detect (system PATH)";
      updateSettingsTabNode(
        `${label} · ${source}`,
        !currentSettings.customNodePath,
      );
    };

    window.zephus
      .getNodeStatus()
      .then((res) => applyNodeStatus(res, settings))
      .catch(() => {
        updateSettingsTabNode(
          "Could not check Node.js.",
          !settings.customNodePath,
        );
      });
  }

  async function renderAboutAndLicensesInTab(): Promise<void> {
    const versionText = $("about-app-version");
    if (versionText) {
      try {
        const v = await window.zephus.getAppVersion();
        versionText.textContent = `v${v}`;
      } catch {
        versionText.textContent = "Zephus";
      }
    }

    const configBtn = $maybe("btn-about-config");
    if (configBtn) {
      configBtn.onclick = () => void window.zephus.openConfigFolder();
    }

    const loadLicensesBtn = $("btn-load-licenses") as HTMLButtonElement;
    const openRawLicensesBtn = $("btn-open-raw-licenses");
    const licensesListContainer = $("about-licenses-list");

    if (openRawLicensesBtn) {
      openRawLicensesBtn.onclick = async () => {
        const opened = await window.zephus.openProductionLicensesFile();
        if (!opened.ok) {
          setStatus(opened.error ?? "Could not open licenses.json.");
        }
      };
    }

    if (loadLicensesBtn && licensesListContainer) {
      loadLicensesBtn.onclick = async () => {
        loadLicensesBtn.disabled = true;
        loadLicensesBtn.textContent = "Loading Licenses…";
        licensesListContainer.classList.remove("hidden");
        updateAboutLicenses({
          visible: true,
          loading: true,
          error: null,
          entries: [],
        });

        const result = await window.zephus.readProductionLicenses();
        loadLicensesBtn.disabled = false;
        loadLicensesBtn.textContent = "Reload Dependency Licenses";

        if (!result.ok) {
          updateAboutLicenses({
            visible: true,
            loading: false,
            error: result.error ?? "Could not load production license data.",
            entries: [],
          });
          return;
        }

        updateAboutLicenses({
          visible: true,
          loading: false,
          error: null,
          entries: result.entries.map((entry) => ({
            packageId: entry.packageId,
            licenses: entry.licenses,
            repository: entry.repository,
            licenseUrl: entry.licenseUrl,
            parentsLabel:
              entry.parents.slice(0, 4).join(" > ") || "Direct dependency",
          })),
        });
      };
    }
  }

  // Guards the create flow: double-clicks (or Enter on a card) could otherwise
  // launch two folder pickers / two scaffold runs that interleave.
  let siteCreateInFlight = false;

  async function createSiteFromTabFlow(): Promise<void> {
    if (siteCreateInFlight) return;
    siteCreateInFlight = true;
    try {
      await createSiteFromTabFlowInner();
    } finally {
      siteCreateInFlight = false;
    }
  }

  async function createSiteFromTabFlowInner(): Promise<void> {
    if (!selectedTabTheme) return;
    const theme = selectedTabTheme;
    // Check Node BEFORE asking for a folder: previously the user picked a
    // folder, then hit the "Node.js Required" modal and had to back out.
    const node = await window.zephus.getNodeStatus();
    if (node.status !== "ok") {
      showModal("Node.js Required", nodeStatusMessage(node), [
        { label: "Open Settings", kind: "primary", onClick: openSettingsModal },
        { label: "Cancel", kind: "ghost", onClick: closeModal },
      ]);
      return;
    }
    const folder = await window.zephus.chooseNewSiteFolder();
    if (!folder) return;
    setStatus("Creating site from theme…");
    const r = await window.zephus.createSite(folder, theme);
    if (!r.ok) {
      showModal("Could Not Create Site", friendlyError(r.error), [
        { label: "OK", kind: "primary", onClick: closeModal },
      ]);
      return;
    }
    // First-run convenience: install deps now so preview/publish just work.
    // A FAILED install must not strand the user: the site exists on disk and
    // should open anyway (preview/publish will re-offer the install).
    const installResult = await runInstallFlow(folder);
    await openProjectByPath(folder);
    if (!state.project) {
      setStatus(
        "Site created, but Zephus could not open it. Check the project folder and try again.",
      );
    } else if (installResult === "backgrounded") {
      setStatus(
        "Site opened; dependency installation continues in background.",
      );
    } else if (installResult === "failed") {
      setStatus(
        "Site opened. Dependencies failed to install — open the project and try Preview or Publish to retry.",
      );
    }
  }
  return {
    initStartTabs,
    switchStartTab,
    activateHomeSection,
    selectThemeCard,
    createSiteFromTabFlow,
    renderThemesInTab,
    renderSettingsInTab,
    renderAboutAndLicensesInTab,
    openThemePreviewModal,
    syncCreateButtonState,
    previewUrlForTheme,
    getThemeHeaderDetails,
    hasLoadedStartThemes: (): boolean => startThemes !== null,
    getStartTheme: (themeId: string): ThemeMeta | null =>
      startThemes?.find((entry) => entry.id === themeId) ?? null,
  };
}
