/**
 * Page loading + external-change orchestration. Extracted from the engine:
 * the page-switch race machinery (request counter, serialized chain,
 * change-during-read detection, generation guards) and the file-watcher
 * conflict flow live in one place with a deps contract.
 */

import type { EditorSessionState } from "./editorSession";

export interface PageLoadOptions {
  skipUnsavedGuard?: boolean;
  skipDraftRestore?: boolean;
  /** Restore the recovery draft WITHOUT prompting (home-screen resume). */
  restoreDraftSilently?: boolean;
  forceReload?: boolean;
  afterLoad?: () => void | Promise<void>;
}

interface IgnoredExternalChange {
  projectPath: string;
  page: string;
  content: string | null;
}

export interface PageLoaderDeps {
  getState: () => EditorSessionState;
  $: (id: string) => HTMLElement;
  setStatus: (message: string) => void;
  setLoadingPage: (page: string | null) => void;
  getEditorSessionGeneration: () => number;
  maybeResolveUnsavedWork: (options?: {
    reloadCurrentPageOnDiscard?: boolean;
  }) => Promise<boolean>;
  editorSaveWaitForIdle: () => Promise<boolean>;
  maybeRestorePageDraft: (
    page: string,
    pageLabel: string,
    savedRendererSource: string,
    options?: { skipPrompt?: boolean },
  ) => Promise<{
    restored: boolean;
    restoredContent?: string;
    restoredDraft?: DraftData;
    cleanupWarning?: string;
  }>;
  findPageMeta: (page: string) => { navLabel: string } | null;
  syncCurrentMeta: () => void;
  clearChanges: () => void;
  markDirty: (dirty: boolean) => void;
  updateUndoRedoButtons: () => void;
  splitManagedPageSource: (raw: string) => {
    frame: { frontmatter: string; prefix: string; suffix: string };
    inner: string;
  };
  assembleManagedPage: (
    frame: { frontmatter: string; prefix: string; suffix: string },
    sections: SectionNode[],
    renderBlock: (block: Block) => string,
  ) => string;
  sectionsFromPageDocument: (doc: PageDocument) => SectionNode[];
  parseSections: (inner: string) => SectionNode[];
  blockToHtml: (
    block: Block,
    viewport: "desktop" | "tablet" | "mobile",
    forCanvas?: boolean,
  ) => string;
  syncBlocksFromSections: () => void;
  syncVisualModeState: () => void;
  renderLayers: () => void;
  renderDirtyIndicators: () => void;
  setCode: (value: string) => void;
  setMode: (mode: "visual" | "code") => void;
  getCode: () => string;
  currentManagedSource: () => string;
  modalController: {
    choose: <T>(
      title: string,
      content: string | HTMLElement,
      actions: Array<{
        label: string;
        value: T;
        kind?: "primary" | "danger" | "ghost";
      }>,
      options?: { size?: "default" | "wide" },
    ) => Promise<T>;
  };
  clearIgnoredExternalChange: () => void;
  updateWindowTitle: () => void;
  trackChange: (label: string) => void;
  clearPageDraftAfterReload: (
    projectPath: string,
    page: string,
  ) => Promise<void>;
  renderPageList: (project: ProjectOpenResult) => void;
}

export function createPageLoader(deps: PageLoaderDeps) {
  const {
    getState,
    $,
    setStatus,
    setLoadingPage,
    getEditorSessionGeneration,
    maybeResolveUnsavedWork,
    editorSaveWaitForIdle,
    maybeRestorePageDraft,
    findPageMeta,
    syncCurrentMeta,
    clearChanges,
    markDirty,
    updateUndoRedoButtons,
    splitManagedPageSource,
    assembleManagedPage,
    sectionsFromPageDocument,
    parseSections,
    blockToHtml,
    syncBlocksFromSections,
    syncVisualModeState,
    renderLayers,
    renderDirtyIndicators,
    setCode,
    setMode,
    getCode,
    currentManagedSource,
    modalController,
    trackChange,
    clearPageDraftAfterReload,
    renderPageList,
  } = deps;

  const state = getState();

  // Serialized page loads: an older request must never replace the watcher
  // or the editor content of a newer one (see loadPageNow's isCurrentRequest).
  let latestPageLoadRequest = 0;
  let pageLoadChain: Promise<void> = Promise.resolve();
  let externalChangeInFlight: Promise<void> | null = null;
  let externalChangeQueued = false;
  let ignoredExternalChange: IgnoredExternalChange | null = null;

  function setPageLoading(page: string | null): void {
    setLoadingPage(page);
    const canvas = $("canvas");
    const busy = page !== null;
    canvas.classList.toggle("loading", busy);
    if (busy) {
      canvas.setAttribute("aria-busy", "true");
      canvas.dataset["loadingLabel"] =
        `Loading ${findPageMeta(page)?.navLabel ?? page}…`;
    } else {
      canvas.removeAttribute("aria-busy");
      delete canvas.dataset["loadingLabel"];
    }

    const interactionSurfaces = [
      canvas,
      $("code-editor"),
      $("workspace-left-build"),
      $("workspace-left-layers"),
      $("nav-list"),
      document.querySelector<HTMLElement>(".panel.right"),
    ];
    for (const surface of interactionSurfaces) {
      surface?.toggleAttribute("inert", busy);
    }
    for (const id of [
      "mode-visual",
      "mode-code",
      "btn-save",
      "btn-new-page",
      "btn-find-replace",
      "btn-regen-nav",
      "btn-site-shell",
      "btn-design-system",
      "btn-preview",
      "btn-publish",
      "btn-close",
      "btn-undo",
      "btn-redo",
      "vp-desktop",
      "vp-tablet",
      "vp-mobile",
    ] as const) {
      ($(id) as HTMLButtonElement).disabled = busy;
    }
    if (!busy) syncVisualModeState();
    updateUndoRedoButtons();
    if (state.project) renderPageList(state.project);
  }

  function loadPage(page: string, options?: PageLoadOptions): Promise<void> {
    const projectPath = state.project?.path;
    if (!projectPath) return Promise.resolve();
    const requestId = ++latestPageLoadRequest;
    setPageLoading(page);
    const run = pageLoadChain.then(() =>
      loadPageNow(page, projectPath, requestId, options),
    );
    const handled = run.catch((error: unknown) => {
      if (
        requestId === latestPageLoadRequest &&
        state.project?.path === projectPath
      ) {
        setStatus(
          `Could not load ${page}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    pageLoadChain = handled.finally(() => {
      if (requestId === latestPageLoadRequest) setPageLoading(null);
    });
    return pageLoadChain;
  }

  async function loadPageNow(
    page: string,
    projectPath: string,
    requestId: number,
    options?: PageLoadOptions,
  ): Promise<void> {
    const isCurrentRequest = (): boolean =>
      requestId === latestPageLoadRequest &&
      state.project?.path === projectPath;

    await editorSaveWaitForIdle();
    if (!isCurrentRequest()) return;
    if (page === state.page && !options?.forceReload) return;
    if (!options?.skipUnsavedGuard && !(await maybeResolveUnsavedWork())) {
      return;
    }
    if (!isCurrentRequest()) return;

    const sourcePage = state.page;
    const pageRevisionAtRead = state.pageRevision;
    const siteRevisionAtRead = state.siteRevision;
    const codeAtRead = state.mode === "code" ? getCode() : null;
    const sourceChangedDuringRead = (): boolean =>
      state.page !== sourcePage ||
      state.pageRevision !== pageRevisionAtRead ||
      state.siteRevision !== siteRevisionAtRead ||
      (codeAtRead !== null && getCode() !== codeAtRead);

    const project = state.project;
    if (!project) return;
    setStatus(`Loading ${findPageMeta(page)?.navLabel ?? page}…`);
    const res = await window.zephus.readPageDocument(
      projectPath,
      page,
      project.astro.pagesDir,
    );
    if (!isCurrentRequest()) return;
    if (sourceChangedDuringRead()) {
      setStatus(
        "Page switch canceled because the open page changed while the next page was loading.",
      );
      return;
    }
    if (!res.ok || !res.pageDocument) {
      setStatus("Could not load " + page + ": " + (res.error ?? "unknown"));
      return;
    }

    const nextManagedStatus = res.pageDocument.managedFileStatus;
    const nextVisualEditable = nextManagedStatus !== "detached";
    const initialSource = res.source ?? "";
    const generatedSource = res.generatedSource ?? initialSource;
    let pageDraftCleanupWarning: string | undefined;
    let restoredPageContent: string | undefined;
    let restoredPageDraft: DraftData | undefined;
    if (!options?.skipDraftRestore) {
      // The visual draft was written as serializeBlocks() — the RENDERER's
      // serialization of the live state. Comparing it against the main-side
      // generatedSource can never be byte-equal (different body indentation,
      // post-index source), which forced a bogus "Restore unsaved draft"
      // prompt for already-saved content. Compare against the renderer's own
      // serialization of the SAVED document instead: equality then means the
      // live state would serialize identically — nothing to restore.
      const savedRendererSource =
        nextVisualEditable && res.pageDocument
          ? (() => {
              const savedFrame = splitManagedPageSource(generatedSource);
              return assembleManagedPage(
                savedFrame.frame,
                sectionsFromPageDocument(res.pageDocument),
                (block) => blockToHtml(block as Block, "desktop", false),
              );
            })()
          : nextVisualEditable
            ? generatedSource
            : initialSource;
      const draftOutcome = await maybeRestorePageDraft(
        page,
        findPageMeta(page)?.navLabel ?? page,
        savedRendererSource,
        options?.restoreDraftSilently ? { skipPrompt: true } : undefined,
      );
      pageDraftCleanupWarning = draftOutcome.cleanupWarning;
      restoredPageContent = draftOutcome.restoredContent;
      restoredPageDraft = draftOutcome.restoredDraft;
    }
    if (!isCurrentRequest()) return;

    // Commit the complete page in one synchronous step. Until draft resolution
    // finishes, the current editor session remains untouched, so a superseding
    // request can safely abandon this candidate without leaving partial state.
    const frameSource =
      restoredPageContent && nextVisualEditable
        ? restoredPageContent
        : initialSource;
    const { frame, inner } = splitManagedPageSource(frameSource);
    const nextSections =
      restoredPageContent && nextVisualEditable
        ? parseSections(inner)
        : sectionsFromPageDocument(res.pageDocument);

    ignoredExternalChange = null;
    state.page = page;
    if (!state.siteDirty) {
      // See reloadPages: never swap the staging baseline mid-staging.
      state.siteDocument = res.site;
    }
    state.pageDocument = res.pageDocument;
    state.managedStatus = nextManagedStatus;
    state.visualEditable = nextVisualEditable;
    state.frontmatter = frame.frontmatter;
    state.prefix = frame.prefix;
    state.suffix = frame.suffix;
    syncCurrentMeta();
    state.sections = nextSections;
    syncBlocksFromSections();
    state.generatedCode = res.generatedSource ?? currentManagedSource();
    state.rawCode =
      restoredPageContent ??
      (state.visualEditable ? state.generatedCode : initialSource);
    state.recoveredPageDraft = restoredPageDraft ?? null;

    state.undo = [];
    state.redo = [];
    updateUndoRedoButtons();
    state.selectedId = null;
    state.selectedSectionId = state.sections[0]?.id ?? null;
    clearChanges();
    markDirty(Boolean(state.recoveredPageDraft));
    const loadedPageRevision = state.pageRevision;
    const loadedSiteRevision = state.siteRevision;
    renderLayers();

    for (const li of Array.from($("page-list").children) as HTMLElement[]) {
      li.classList.toggle("active", li.dataset["page"] === page);
    }
    syncVisualModeState();
    setCode(state.rawCode);
    setMode(state.visualEditable ? "visual" : "code");
    renderDirtyIndicators();

    // Watch the open file for external changes. Serialized page loads guarantee
    // that an older request cannot replace the watcher for a newer page.
    if (!isCurrentRequest()) return;
    await window.zephus.watchFile(projectPath, page).catch(() => {
      setStatus("Warning: could not watch the page for external edits.");
    });
    if (!isCurrentRequest()) return;
    if (pageDraftCleanupWarning) {
      setStatus(pageDraftCleanupWarning);
    } else if (state.managedStatus === "out-of-sync") {
      setStatus(
        "Managed page drift detected. Save visually to overwrite or edit in code and detach.",
      );
    } else if (state.managedStatus === "detached") {
      setStatus(
        "Detached page loaded in code mode. Reattach it from the editor banner or Page Settings to restore visual editing.",
      );
    } else {
      setStatus("Editing " + page);
    }

    if (options?.afterLoad) {
      if (
        state.pageRevision !== loadedPageRevision ||
        state.siteRevision !== loadedSiteRevision
      ) {
        setStatus(
          `Editing ${page}; recovery cleanup was postponed because newer edits exist.`,
        );
        return;
      }
      try {
        await options.afterLoad();
      } catch (error) {
        setStatus(
          `Editing ${page}, but recovery cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async function handleExternalChange(): Promise<void> {
    const project = state.project;
    const page = state.page;
    if (!project || !page) return;
    const projectPath = project.path;
    const sessionGeneration = getEditorSessionGeneration();
    const isCurrentPage = (): boolean =>
      state.project?.path === projectPath &&
      state.page === page &&
      getEditorSessionGeneration() === sessionGeneration;

    await editorSaveWaitForIdle();
    if (!isCurrentPage()) return;

    let diskContent: string | null = null;
    try {
      const onDisk = await window.zephus.readFile(projectPath, page);
      if (!isCurrentPage()) return;
      if (onDisk.ok && typeof onDisk.content === "string") {
        diskContent = onDisk.content;
        if (
          diskContent === state.rawCode ||
          diskContent === state.generatedCode
        ) {
          return;
        }
        if (
          ignoredExternalChange?.projectPath === projectPath &&
          ignoredExternalChange.page === page
        ) {
          if (ignoredExternalChange.content === diskContent) return;
          if (ignoredExternalChange.content === null) {
            // The file was unreadable when the user chose Keep Mine; the next
            // watcher event is almost certainly the same change becoming
            // readable. Suppress it once instead of re-prompting forever.
            ignoredExternalChange = null;
            return;
          }
        }
      }
    } catch {
      // If the file cannot be read, still let the user decide how to proceed.
    }

    if (!isCurrentPage()) return;
    const choice = await modalController.choose<"keep" | "reload">(
      "File Changed on Disk",
      "The current page was modified outside Zephus. Reload it from disk or keep your in-app version?",
      [
        { label: "Keep Mine", value: "keep", kind: "ghost" },
        { label: "Reload", value: "reload", kind: "primary" },
      ],
    );
    if (!isCurrentPage()) return;
    if (choice === "keep") {
      // Record the ignored state even when the file could not be read: without
      // a marker, the next debounced watcher event for the same change would
      // prompt again forever.
      ignoredExternalChange = { projectPath, page, content: diskContent };
      trackChange("Kept in-app version after an external file change");
      markDirty(true);
      setStatus(
        "Keeping your in-app version. Save to overwrite the disk change.",
      );
      return;
    }

    ignoredExternalChange = null;
    await loadPage(page, {
      skipUnsavedGuard: true,
      skipDraftRestore: true,
      forceReload: true,
      afterLoad: async () => {
        await clearPageDraftAfterReload(projectPath, page);
      },
    });
  }

  function onExternalChange(): Promise<void> {
    if (externalChangeInFlight) {
      externalChangeQueued = true;
      return externalChangeInFlight;
    }
    const pending = handleExternalChange();
    externalChangeInFlight = pending;
    void pending.finally(() => {
      if (externalChangeInFlight === pending) externalChangeInFlight = null;
      if (externalChangeQueued) {
        externalChangeQueued = false;
        void onExternalChange();
      }
    });
    return pending;
  }

  /** A successful save means the disk matches the session: the next watcher
   *  echo of that same write must not re-prompt. */
  function clearIgnoredExternalChangeLocal(): void {
    ignoredExternalChange = null;
  }

  /** Project teardown: invalidate every in-flight load and watcher flow. */
  function resetLoadPipeline(): void {
    latestPageLoadRequest += 1;
    externalChangeInFlight = null;
    externalChangeQueued = false;
    ignoredExternalChange = null;
    setPageLoading(null);
  }

  return {
    loadPage,
    onExternalChange,
    setPageLoading,
    resetLoadPipeline,
    clearIgnoredExternalChange: clearIgnoredExternalChangeLocal,
  };
}

type Block = import("../main/types").EditorBlock;
type SectionNode = import("../main/types").SectionNode;
type PageDocument = import("../main/types").PageDocument;
type ProjectOpenResult = import("../main/types").ProjectOpenResult;
