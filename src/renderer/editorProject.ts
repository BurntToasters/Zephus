/** Project open lifecycle: the open-queue guard, the open flow with its failure gates (not-a-zephus, damaged, git init)… */

import { markSiteDirty } from "./editorSession";
import type { EditorSessionState } from "./editorSession";

export interface ProjectOpenDeps {
  getState: () => EditorSessionState;
  $: (id: string) => HTMLElement;
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
  closeModal: () => void;
  clearAssetCache: () => void;
  resetLoadPipeline: () => void;
  renderRecent: () => Promise<void>;
  refreshHomeDraftSummaries: () => Promise<void>;
  renderPageList: (result: import("../main/types").ProjectOpenResult) => void;
  renderNavEditor: (result: import("../main/types").ProjectOpenResult) => void;
  reloadPages: () => Promise<void>;
  renderDirtyIndicators: () => void;
  resetOpenPageState: () => void;
  ensureCodeEditor: () => void;
  setMode: (mode: "visual" | "code") => void;
  loadPage: (
    page: string,
    options?: { restoreDraftSilently?: boolean },
  ) => Promise<void>;
  applyRepoRules: () => Promise<void>;
  applyMergedTheme: () => Promise<void>;
  maybeRestoreSiteDraft: (options?: {
    skipPrompt?: boolean;
  }) => Promise<string | null>;
  onExternalChange: () => Promise<void>;
  editorGitRefresh: () => Promise<void>;
  editorDraftRestoreRestoreSiteDraft: (options?: {
    skipPrompt?: boolean;
  }) => Promise<string | null>;
  bumpSessionGeneration: () => void;
  updateWindowTitle: () => void;
}

interface PendingDraftResume {
  projectPath: string;
  scope: "page" | "site";
  target: string;
}

export function createProjectOpenActions(deps: ProjectOpenDeps) {
  const {
    getState,
    $,
    setStatus,
    showModal,
    closeModal,
    clearAssetCache,
    resetLoadPipeline,
    renderRecent,
    refreshHomeDraftSummaries,
    renderPageList,
    renderNavEditor,
    reloadPages,
    renderDirtyIndicators,
    resetOpenPageState,
    ensureCodeEditor,
    setMode,
    loadPage,
    applyRepoRules,
    applyMergedTheme,
    maybeRestoreSiteDraft,
    onExternalChange,
    editorGitRefresh,
    editorDraftRestoreRestoreSiteDraft,
    bumpSessionGeneration,
    updateWindowTitle,
  } = deps;

  const state = getState();

  // Guards concurrent opens (double-click on a recent entry): two overlapping
  // flows would both mutate state.project and interleave their page loads.
  let projectOpenInFlight = false;
  // An open requested while another is in flight (the startup auto-restore is
  // the common case): user intent must WIN over the automatic restore, so the
  // request is queued and run once the in-flight open settles instead of being
  // silently dropped.
  let queuedProjectOpen: string | null = null;
  let pendingHomeDraftResume: PendingDraftResume | null = null;

  async function openProjectByPath(folder: string): Promise<void> {
    if (projectOpenInFlight) {
      // The auto-restore (bootstrap) is running; remember the user's explicit
      // choice and open it right after, so their click is never swallowed.
      queuedProjectOpen = folder;
      setStatus("Opening " + folder + "…");
      return;
    }
    projectOpenInFlight = true;
    try {
      await openProjectByPathInner(folder);
      const queued = queuedProjectOpen;
      queuedProjectOpen = null;
      if (queued && queued !== folder) {
        // The user clicked another project while the auto-restore ran: honor
        // their explicit choice (the freshly-opened project has no unsaved
        // work, so switching is safe).
        setStatus("Opening " + queued + "…");
        await openProjectByPathInner(queued);
      }
    } catch (error) {
      // A thrown open must not leave a stale queued path: the next open would
      // silently open a project the user never clicked.
      queuedProjectOpen = null;
      throw error;
    } finally {
      projectOpenInFlight = false;
    }
  }

  async function openProjectByPathInner(folder: string): Promise<void> {
    setStatus("Opening " + folder + "…");
    const result = await window.zephus.openProject(folder);
    if (!result.ok) {
      // A failed open must not leave a stale resume request pending: the next
      // successful open of the same path would silently resume a draft with no
      // second prompt (and if its target page no longer exists, the draft would
      // linger on the home screen forever).
      const pending = pendingHomeDraftResume;
      pendingHomeDraftResume = null;
      if (pending?.projectPath === folder) {
        // The project cannot be opened (deleted folder): clear its recovery
        // drafts so the card does not stay on the home screen.
        const cleared = await window.zephus.clearDraft(
          folder,
          pending.scope,
          pending.target,
        );
        void cleared;
        await refreshHomeDraftSummaries();
      }
      // Recent-project validation: drop entries that no longer resolve.
      await window.zephus.removeRecentProject(folder);
      await renderRecent();
      showModal("Could Not Open Project", result.error ?? "Unknown error.", [
        { label: "OK", kind: "primary", onClick: closeModal },
      ]);
      return;
    }

    if (!result.isZephusProject) {
      showModal(
        "Not a Zephus Site",
        "Zephus can only open sites it created. This folder has no .zephus marker. " +
          'Use "Create New Site" to start a new project from a theme.',
        [{ label: "OK", kind: "primary", onClick: closeModal }],
      );
      return;
    }

    resetLoadPipeline();
    state.project = result;
    clearAssetCache();
    await renderRecent();

    if (!result.pkg.ready) {
      state.project = null;
      showModal(
        "Project Appears Damaged",
        "This Zephus project is missing a valid package.json (Astro dependency and a " +
          "dev script). The project may be incomplete or damaged.",
        [{ label: "OK", kind: "primary", onClick: closeModal }],
      );
      return;
    }

    if (!result.isGitRepo) {
      showModal(
        "Not a Git Repository",
        "This project has no Git repository. Initialize one?",
        [
          {
            label: "Skip",
            kind: "ghost",
            onClick: () => {
              closeModal();
              void enterEditor(result);
            },
          },
          {
            label: "Initialize Git",
            kind: "primary",
            onClick: async () => {
              closeModal();
              try {
                await window.zephus.initGitRepo(folder);
              } catch (error) {
                state.project = null;
                showModal(
                  "Could Not Initialize Git",
                  error instanceof Error ? error.message : String(error),
                  [{ label: "OK", kind: "primary", onClick: closeModal }],
                );
                return;
              }
              await enterEditor(result);
            },
          },
        ],
      );
      return;
    }

    await enterEditor(result);
  }

  async function enterEditor(
    result: import("../main/types").ProjectOpenResult,
  ): Promise<void> {
    bumpSessionGeneration();
    $("view-start").classList.add("hidden");
    const editorView = $("view-editor");
    editorView.classList.remove("hidden");
    // Move focus into the editor so keyboard/SR users aren't dropped on <body>.
    editorView.setAttribute("tabindex", "-1");
    editorView.focus();
    $("project-name").textContent = result.name;
    updateWindowTitle();
    // A fresh editor session has no page open yet. Clearing it matters when a
    // second project is opened without closing the first: both can contain the
    // same page path, and a stale value would make the load look redundant.
    state.page = null;
    state.currentMeta = null;
    try {
      const ensured = await window.zephus.ensureVisualSchema(
        result.path,
        result.astro.pagesDir,
      );
      if (!ensured.ok) {
        throw new Error(
          ensured.error ?? "Could not initialize Zephus schema sidecars.",
        );
      }
      const siteResult = await window.zephus.readSiteDocument(result.path);
      state.siteDocument = siteResult.ok ? siteResult.site : null;
      state.pendingSiteDocument = null;
      state.pendingSiteEditorKind = null;
      markSiteDirty(state, false);
      ensureCodeEditor();
      const siteDraftCleanupWarning = await maybeRestoreSiteDraft();
      void editorGitRefresh();
      await applyRepoRules();
      void applyMergedTheme();
      await reloadPages();
      renderPageList(result);
      renderNavEditor(result);
      setMode("visual");
      renderDirtyIndicators();

      // Subscribe once to external file-change notifications.
      state.unsubExternal?.();
      state.unsubExternal = window.zephus.onExternalChange((rel) => {
        if (rel === state.page) void onExternalChange();
      });

      const integrity = ensured.status?.integrity ?? result.schema.integrity;
      setStatus(
        siteDraftCleanupWarning ??
          (integrity === "legacy"
            ? "Migrated project into schema-backed visual mode."
            : "Ready — " + result.path),
      );
      const pendingDraft =
        pendingHomeDraftResume?.projectPath === result.path
          ? pendingHomeDraftResume
          : null;
      pendingHomeDraftResume = null;
      if (pendingDraft?.scope === "site") {
        // The user already chose to resume the site draft on the home screen;
        // restore it silently instead of prompting again.
        const warning = await editorDraftRestoreRestoreSiteDraft({
          skipPrompt: true,
        });
        if (warning) setStatus(warning);
      }
      if (
        pendingDraft?.scope === "page" &&
        state.project?.pages.includes(pendingDraft.target)
      ) {
        // The user already chose to resume this draft on the home screen; do
        // not prompt "Restore Page Draft?" a second time — but DO restore the
        // draft content (skipping the restore entirely opened the stale disk
        // copy and left the card looping forever).
        await loadPage(pendingDraft.target, {
          restoreDraftSilently: true,
        });
        // The cleared draft's home card would otherwise linger for the whole
        // session (stale timestamp, phantom).
        await refreshHomeDraftSummaries();
        return;
      }
      if (pendingDraft?.scope === "page") {
        // The draft's page was renamed or deleted: clear the stale draft so
        // the card does not linger on the home screen forever.
        const cleared = await window.zephus.clearDraft(
          result.path,
          "page",
          pendingDraft.target,
        );
        if (!cleared.ok) {
          setStatus(
            "Could not clear the recovery draft: " +
              (cleared.error ?? "unknown error"),
          );
        }
        await refreshHomeDraftSummaries();
      }
      if (!state.page && state.project?.pages[0]) {
        await loadPage(state.project.pages[0]);
      }
    } catch (error) {
      // Never leave a half-open project: reset the editor session and return
      // to the start screen so the UI cannot act on a phantom project.
      pendingHomeDraftResume = null;
      state.project = null;
      updateWindowTitle();
      state.siteDocument = null;
      state.pendingSiteDocument = null;
      state.pendingSiteEditorKind = null;
      resetOpenPageState();
      $("view-editor").classList.add("hidden");
      $("view-start").classList.remove("hidden");
      setStatus("");
      showModal(
        "Could Not Open Project",
        error instanceof Error ? error.message : String(error),
        [{ label: "OK", kind: "primary", onClick: closeModal }],
      );
    }
  }

  /** The home screen hands a chosen draft resume to the next open. */
  function setPendingHomeDraftResume(draft: PendingDraftResume | null): void {
    pendingHomeDraftResume = draft;
  }

  return {
    openProjectByPath,
    setPendingHomeDraftResume,
  };
}
