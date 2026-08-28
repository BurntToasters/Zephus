/** Window chrome: startup guards (close/reload with unsaved work), toolbar button wiring, preview-window listeners… */

import { isGlobalDirty } from "./editorSession";
import type { EditorSessionState } from "./editorSession";

export interface ChromeDeps {
  getState: () => EditorSessionState;
  $: (id: string) => HTMLElement;
  $maybe: (id: string) => HTMLElement | null;
  setStatus: (message: string) => void;
  refreshIcons: () => void;
  maybeResolveUnsavedWork: (options?: {
    reloadCurrentPageOnDiscard?: boolean;
  }) => Promise<boolean>;
  renderLayers: () => void;
  renderThemePlaceholder: () => void;
  refreshGuidancePanels: () => void;
  updateUndoRedoButtons: () => void;
  setViewport: (vp: "desktop" | "tablet" | "mobile") => void;
  setMode: (mode: "visual" | "code") => void;
  doUndo: () => void;
  doRedo: () => void;
  performSave: () => Promise<boolean>;
  publishSite: () => Promise<void>;
  togglePreview: () => Promise<void>;
  openHelpModal: () => void;
  closeProject: () => Promise<void>;
  resetPreviewState: (message: string) => void;
  openSettingsModal: () => Promise<void>;
  createSiteFromTabFlow: () => Promise<void>;
  openProjectByPath: (folder: string) => Promise<void>;
  chooseFolder: () => Promise<void>;
  newPageFlow: () => Promise<void>;
  openFindReplaceModal: () => Promise<void>;
  regenerateNav: () => Promise<void>;
  openSiteShellModal: () => Promise<void>;
  openDesignSystemModal: () => Promise<void>;
  refreshHomeDraftSummaries: () => Promise<void>;
  renderRecent: () => Promise<void>;
  renderHomeStatusPanels: () => void;
  refreshUpdaterControls: () => void;
  promptDownloadedUpdate: (force?: boolean) => void;
  updateVersionLabel: (version?: string) => string;
  applyCodeFontSize: (size: number) => void;
  onKeydown: (event: KeyboardEvent) => void;
  cmUndo: () => void;
  cmRedo: () => void;
  installSmokeHook: () => void;
  setAppSettings: (settings: import("../main/types").GlobalSettings) => void;
  getAppSettings: () => import("../main/types").GlobalSettings | null;
  setUpdaterSnapshot: (
    snapshot: {
      status: string;
      version?: string;
      percent?: number;
      error?: string;
    } | null,
  ) => void;
  showModal: (
    title: string,
    body: string,
    actions: Array<{
      label: string;
      kind?: "primary" | "danger" | "ghost";
      onClick: () => void;
    }>,
  ) => void;
  closeModal: () => void;
}

export function createChromeActions(deps: ChromeDeps) {
  const {
    getState,
    $,
    $maybe,
    setStatus,
    refreshIcons,
    maybeResolveUnsavedWork,
    renderLayers,
    renderThemePlaceholder,
    refreshGuidancePanels,
    updateUndoRedoButtons,
    setViewport,
    setMode,
    doUndo,
    doRedo,
    performSave,
    publishSite,
    togglePreview,
    openHelpModal,
    closeProject,
    resetPreviewState,
    openSettingsModal,
    createSiteFromTabFlow,
    openProjectByPath,
    chooseFolder,
    newPageFlow,
    openFindReplaceModal,
    regenerateNav,
    openSiteShellModal,
    openDesignSystemModal,
    refreshHomeDraftSummaries,
    renderRecent,
    renderHomeStatusPanels,
    refreshUpdaterControls,
    promptDownloadedUpdate,
    updateVersionLabel,
    applyCodeFontSize,
    onKeydown,
    cmUndo,
    cmRedo,
    installSmokeHook,
    setAppSettings,
    getAppSettings,
    setUpdaterSnapshot,
    showModal,
    closeModal,
  } = deps;

  const state = getState();

  function installChrome(): void {
    if (window.location.search.includes("smoke=1")) {
      installSmokeHook();
    }
    window.refreshIcons = refreshIcons;

    // Prevent stray file drops from navigating the window away from the app.
    // Specific dropzones call preventDefault + stopPropagation to handle drops.
    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("drop", (event) => event.preventDefault());

    // Warn before closing/reloading with unsaved work. Drafts also auto-save,
    // but this is an explicit last-chance rail.
    // NOTE: in Electron, preventing beforeunload CANCELS the close with NO
    // dialog (Chromium's confirm is suppressed) — the app used to silently
    // refuse to quit. Instead, surface the app's own save/discard/cancel modal
    // and, once resolved, re-close with the guard lifted.
    let forceCloseAllowed = false;
    // Distinguishes CLOSE from RELOAD in beforeunload: a reload replaces the
    // navigation entry (type "reload"); a close leaves it untouched. Closing
    // after an earlier reload must still close — compare against the type of
    // the FIRST load this window performed.
    const initialNavType =
      (
        performance.getEntriesByType("navigation")[0] as
          PerformanceNavigationTiming | undefined
      )?.type ?? "navigate";
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (forceCloseAllowed) return;
      if (!state.project || !isGlobalDirty(state)) return;
      event.preventDefault();
      event.returnValue = "";
      const navType = (
        performance.getEntriesByType("navigation")[0] as
          PerformanceNavigationTiming | undefined
      )?.type;
      const isReload = navType === "reload" && navType !== initialNavType;
      void (async () => {
        const resolved = await maybeResolveUnsavedWork();
        if (!resolved) return;
        if (isReload) {
          location.reload();
          return;
        }
        forceCloseAllowed = true;
        window.removeEventListener("beforeunload", onBeforeUnload);
        window.close();
      })();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    // Cmd/Ctrl+R is intercepted in the main process (the menu accelerator
    // would otherwise fire before this keydown handler). Resolve unsaved work
    // first, then reload for real — reloading while dirty used to resolve the
    // modal and then CLOSE the app (the guard could not tell reload from close).
    window.zephus.onReloadRequested(() => {
      void (async () => {
        if (state.project && isGlobalDirty(state)) {
          const resolved = await maybeResolveUnsavedWork();
          if (!resolved) return;
        }
        location.reload();
      })();
    });
    // Update installs quit the app programmatically; the dirty guard must not
    // strand the update. restartToApplyUpdate resolves unsaved work first and
    // then calls this.
    window.zephusMarkForceCloseAllowed = () => {
      forceCloseAllowed = true;
    };

    // Populate sidebar version label.
    const sidebarVersion = $("sidebar-app-version");
    if (sidebarVersion) {
      window.zephus
        .getAppVersion()
        .then((v) => {
          sidebarVersion.textContent = `v${v}`;
        })
        .catch(() => {
          sidebarVersion.textContent = "";
        });
    }

    const btnCreate = $("btn-create");
    if (btnCreate) btnCreate.onclick = () => void createSiteFromTabFlow();
    const btnSettings = $maybe("btn-settings");
    if (btnSettings) btnSettings.onclick = () => void openSettingsModal();
    const previewUrlChip = $maybe("preview-url-chip");
    if (previewUrlChip) {
      previewUrlChip.onclick = () => {
        const url = state.previewUrl;
        if (!url) return;
        void navigator.clipboard?.writeText(url).then(
          () => setStatus("Preview URL copied."),
          () => setStatus("Preview URL: " + url),
        );
      };
    }
    const btnResumeLast = $("btn-resume-last");
    if (btnResumeLast) {
      btnResumeLast.onclick = () => {
        const lastProject = getAppSettings()?.lastOpenedProject;
        if (lastProject) {
          void openProjectByPath(lastProject);
        }
      };
    }

    const btnOpen = $("btn-open");
    if (btnOpen) btnOpen.onclick = () => void chooseFolder();

    $("btn-new-page").onclick = () => void newPageFlow();
    $("btn-find-replace").onclick = () => void openFindReplaceModal();
    $("btn-regen-nav").onclick = () => void regenerateNav();
    $("btn-site-shell").onclick = () => void openSiteShellModal();
    $("btn-design-system").onclick = () => void openDesignSystemModal();
    $("mode-visual").onclick = () => setMode("visual");
    $("mode-code").onclick = () => setMode("code");
    $("btn-undo").onclick = () => {
      if (state.mode === "code") cmUndo();
      else doUndo();
      updateUndoRedoButtons();
    };
    $("btn-redo").onclick = () => {
      if (state.mode === "code") cmRedo();
      else doRedo();
      updateUndoRedoButtons();
    };
    updateUndoRedoButtons();
    $("btn-save").onclick = () => void performSave();
    $("btn-publish").onclick = () => void publishSite();
    $("btn-preview").onclick = () => void togglePreview();
    $("btn-help").onclick = () => void openHelpModal();
    $("btn-close").onclick = () => void closeProject();
    // The preview window can be closed by the user (native close button); when
    // that happens the main process tears down the dev server and tells us, so
    // the Preview button + status reset to match.
    window.zephus.onPreviewClosed(() => {
      if (state.previewUrl) resetPreviewState("Preview stopped.");
    });
    // The dev server can die on its own (crash, port conflict, killed outside
    // Zephus) while the preview window is still open. Reset the preview UI and
    // close the dead window so the editor never shows a stale "preview open".
    window.zephus.onPreviewExited(() => {
      if (state.previewUrl) {
        void window.zephus.closePreviewWindow().catch(() => undefined);
        resetPreviewState("Preview server stopped.");
      }
    });
    $("vp-desktop").onclick = () => setViewport("desktop");
    $("vp-tablet").onclick = () => setViewport("tablet");
    $("vp-mobile").onclick = () => setViewport("mobile");
    document.addEventListener("keydown", onKeydown);
    renderLayers();
    renderThemePlaceholder();
    refreshGuidancePanels();
  }

  async function bootstrap(): Promise<void> {
    try {
      const settings = await window.zephus.readGlobalSettings();
      setAppSettings(settings);
      document.documentElement.setAttribute("data-theme", settings.theme);
      applyCodeFontSize(settings.codeFontSize);
    } catch {
      /* defaults apply */
    }
    await refreshHomeDraftSummaries();
    await renderRecent();
    window.zephus.onUpdaterStatus((data) => {
      setUpdaterSnapshot(data);
      renderHomeStatusPanels();
      refreshUpdaterControls();
      if (data.status === "downloaded") {
        setStatus(
          `Update ${updateVersionLabel(data.version)} downloaded. Restart Zephus to apply it.`,
        );
        promptDownloadedUpdate();
      }
    });
    // The startup check can resolve before this listener attaches; claim the
    // cached status so the sidebar does not falsely say "Up to date".
    window.zephus
      .getLastUpdaterStatus()
      .then((cached) => {
        if (cached) {
          setUpdaterSnapshot(cached);
          renderHomeStatusPanels();
          refreshUpdaterControls();
        }
      })
      .catch(() => {
        /* non-fatal */
      });
    refreshIcons();

    // Reopen last project if the user opted in and it still resolves. A
    // failed reopen (missing folder, removed .zephus, damaged project) must
    // not skip the first-run onboarding for brand-new users.
    const settings = getAppSettings();
    if (settings?.restoreLastProject && settings.lastOpenedProject) {
      await openProjectByPath(settings.lastOpenedProject);
      if (state.project) return;
    }
    await showOnboardingIfNew();
  }

  async function showOnboardingIfNew(): Promise<void> {
    const settings = await window.zephus.readGlobalSettings();
    if (settings.recentProjects.length > 0) return;
    try {
      if (localStorage.getItem("zephus.onboarding.dismissed") === "1") return;
    } catch {
      // Continue showing onboarding if storage is unavailable.
    }
    showModal(
      "Welcome to Zephus",
      "Zephus builds real websites visually — no coding needed. " +
        "Pick a starter template and Zephus sets everything up for you, " +
        "including installing what the site needs to run. " +
        "Then drag blocks, edit text, and click Preview to see it live. " +
        "Note: Zephus needs Node.js installed on your computer to preview and build sites.",
      [
        {
          label: "Create My First Site",
          kind: "primary",
          onClick: () => {
            closeModal();
            const tabCreate = $("tab-create");
            if (tabCreate) tabCreate.click();
          },
        },
        {
          label: "I'll look around first",
          kind: "ghost",
          onClick: () => {
            try {
              localStorage.setItem("zephus.onboarding.dismissed", "1");
            } catch {
              // Non-fatal; modal still closes.
            }
            closeModal();
          },
        },
      ],
    );
  }

  return { installChrome, bootstrap };
}
