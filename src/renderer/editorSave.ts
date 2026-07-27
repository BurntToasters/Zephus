/**
 * Page + site save flow for the editor. Keeps IPC and dirty-state wiring out of zephusEngine.
 */

import { EditorSessionState, isGlobalDirty } from "./editorSession";
import { cancelScheduledEditorDraftWrite } from "./editorDraft";

export function formatSaveStatusMessage(
  savedPage: boolean,
  savedSite: boolean,
  pagePath: string | null,
): string {
  if (savedPage && savedSite) {
    return `Saved ${pagePath ?? "page"} and site settings.`;
  }
  if (savedPage) {
    return `Saved ${pagePath ?? "page"}`;
  }
  if (savedSite) {
    return "Saved site settings.";
  }
  return "Nothing to save.";
}

export interface EditorSaveDeps {
  getState: () => EditorSessionState;
  setStatus: (message: string) => void;
  getCode: () => string;
  setCode: (value: string) => void;
  serializeBlocks: () => string;
  pageDocumentFromState: () => PageDocument | null;
  syncVisualModeState: () => void;
  sectionsFromPageDocument: (doc: PageDocument) => SectionNode[];
  syncBlocksFromSections: () => void;
  clearChanges: () => void;
  markDirty: (dirty: boolean) => void;
  scheduleDraftWrite: () => void;
  renderDirtyIndicators: () => void;
  reloadPages: () => Promise<void>;
  persistPendingSiteDocument: () => Promise<boolean>;
  afterSave: () => void;
  zephus: Pick<
    Window["zephus"],
    "detachPageDocument" | "writePageDocument" | "clearDraft"
  >;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createEditorSaveActions(deps: EditorSaveDeps) {
  let activeSave: Promise<boolean> | null = null;
  let trailingSaveRequested = false;

  async function runSave(): Promise<boolean> {
    const initialState = deps.getState();
    const project = initialState.project;
    if (!project) {
      deps.setStatus("No project open to save.");
      return false;
    }
    if (!isGlobalDirty(initialState)) {
      deps.setStatus("Nothing to save.");
      return true;
    }

    cancelScheduledEditorDraftWrite(initialState);
    let savedPage = false;
    let savedSite = false;
    let pageHasNewerEdits = false;
    let siteHasNewerEdits = false;
    let pageSaveNotice: string | null = null;

    try {
      if (initialState.pageDirty) {
        const pagePath = initialState.page;
        if (!pagePath) {
          deps.setStatus("No page open to save.");
          return false;
        }

        const projectPath = project.path;
        const pagesDir = project.astro.pagesDir;
        const modeAtStart = initialState.mode;
        const managedStatusAtStart = initialState.managedStatus;
        const pageRevisionAtStart = initialState.pageRevision;
        const content =
          modeAtStart === "code" ? deps.getCode() : deps.serializeBlocks();
        const managedSource = deps.serializeBlocks();
        const isSamePage = (): boolean => {
          const current = deps.getState();
          return (
            current.project?.path === projectPath && current.page === pagePath
          );
        };
        const currentPageContent = (): string => {
          const current = deps.getState();
          return current.mode === "code"
            ? deps.getCode()
            : deps.serializeBlocks();
        };

        if (modeAtStart === "code") {
          // Managed Code mode is safe only when its contents still match the
          // page document currently represented by the visual model. A match
          // against an older generated/raw snapshot is not sufficient: the
          // user may have intentionally restored that older source after a
          // newer visual edit, and preserving it requires detaching.
          const codeRequiresDetach =
            managedStatusAtStart === "detached" ||
            managedStatusAtStart === "out-of-sync" ||
            content !== managedSource;

          if (codeRequiresDetach) {
            const detached = await deps.zephus.detachPageDocument(
              projectPath,
              pagePath,
              pagesDir,
              content,
            );
            if (!detached.ok || !detached.pageDocument) {
              deps.setStatus(
                "Save failed: " + (detached.error ?? "unknown error"),
              );
              return false;
            }
            if (!isSamePage()) {
              deps.setStatus(`Saved ${pagePath}; the open page changed.`);
              return true;
            }

            const state = deps.getState();
            state.pageDocument = detached.pageDocument;
            state.siteDocument = detached.site;
            state.managedStatus = detached.pageDocument.managedFileStatus;
            state.visualEditable = false;
            state.generatedCode =
              detached.generatedSource ??
              managedSource ??
              detached.source ??
              "";
            state.rawCode = content;
            if (managedStatusAtStart !== "detached") {
              pageSaveNotice = `Saved ${pagePath} as hand-authored Astro; visual editing is now detached.`;
            }
          } else {
            const visualDoc = deps.pageDocumentFromState();
            if (!visualDoc) {
              deps.setStatus("Save failed: missing page document.");
              return false;
            }
            const generated = await deps.zephus.writePageDocument(
              projectPath,
              pagesDir,
              visualDoc,
            );
            if (!generated.ok || !generated.pageDocument) {
              deps.setStatus(
                "Save failed: " + (generated.error ?? "unknown error"),
              );
              return false;
            }
            if (!isSamePage()) {
              deps.setStatus(`Saved ${pagePath}; the open page changed.`);
              return true;
            }

            const state = deps.getState();
            const normalizedGenerated =
              generated.generatedSource ?? generated.source ?? managedSource;
            state.pageDocument = generated.pageDocument;
            state.siteDocument = generated.site;
            state.managedStatus = generated.pageDocument.managedFileStatus;
            state.visualEditable = true;
            state.generatedCode = normalizedGenerated;
            state.rawCode = normalizedGenerated;
          }
        } else {
          const doc = deps.pageDocumentFromState();
          if (!doc) {
            deps.setStatus("Save failed: missing page document.");
            return false;
          }
          const saved = await deps.zephus.writePageDocument(
            projectPath,
            pagesDir,
            doc,
          );
          if (!saved.ok || !saved.pageDocument) {
            deps.setStatus("Save failed: " + (saved.error ?? "unknown error"));
            return false;
          }
          if (!isSamePage()) {
            deps.setStatus(`Saved ${pagePath}; the open page changed.`);
            return true;
          }

          const state = deps.getState();
          state.pageDocument = saved.pageDocument;
          state.siteDocument = saved.site;
          state.managedStatus = saved.pageDocument.managedFileStatus;
          state.visualEditable = true;
          state.generatedCode =
            saved.generatedSource ?? saved.source ?? content;
          state.rawCode = state.generatedCode;
        }

        const state = deps.getState();
        pageHasNewerEdits =
          state.pageRevision !== pageRevisionAtStart ||
          currentPageContent() !== content;
        deps.syncVisualModeState();

        if (!pageHasNewerEdits) {
          try {
            const cleared = await deps.zephus.clearDraft(
              projectPath,
              "page",
              pagePath,
            );
            if (!cleared.ok) {
              pageSaveNotice = `Saved ${pagePath}, but its recovery draft could not be cleared: ${cleared.error ?? "unknown error"}.`;
            }
          } catch {
            pageSaveNotice = `Saved ${pagePath}, but its recovery draft could not be cleared.`;
          }
          pageHasNewerEdits =
            state.pageRevision !== pageRevisionAtStart ||
            currentPageContent() !== content;
        }

        if (pageHasNewerEdits) {
          if (!state.pageDirty) deps.markDirty(true);
        } else {
          if (state.mode === "code" && state.visualEditable) {
            deps.setCode(state.rawCode);
            const currentDoc = deps.pageDocumentFromState();
            if (currentDoc) {
              state.sections = deps.sectionsFromPageDocument(currentDoc);
              deps.syncBlocksFromSections();
            }
          }
          deps.clearChanges();
          deps.markDirty(false);
        }
        savedPage = true;
      }

      if (deps.getState().siteDirty) {
        const saved = await deps.persistPendingSiteDocument();
        if (!saved) return false;
        savedSite = true;
        siteHasNewerEdits = deps.getState().siteDirty;
      }

      deps.renderDirtyIndicators();
      let status =
        pageSaveNotice ??
        formatSaveStatusMessage(savedPage, savedSite, deps.getState().page);
      if (pageHasNewerEdits || siteHasNewerEdits) {
        const newerScopes = [
          pageHasNewerEdits ? "page" : "",
          siteHasNewerEdits ? "site" : "",
        ].filter(Boolean);
        status += ` Newer ${newerScopes.join(" and ")} edits remain unsaved.`;
      }
      deps.setStatus(status);
      deps.afterSave();
      try {
        await deps.reloadPages();
      } catch (error) {
        deps.setStatus(
          `${status} Page list refresh failed: ${errorMessage(error)}`,
        );
      }
      return true;
    } catch (error) {
      deps.setStatus("Save failed: " + errorMessage(error));
      return false;
    } finally {
      if (isGlobalDirty(deps.getState())) deps.scheduleDraftWrite();
    }
  }

  function performSave(): Promise<boolean> {
    if (activeSave) {
      // A second explicit save is a request to flush anything changed while
      // the current write is in flight, not a request to silently coalesce
      // those newer edits into the older snapshot.
      trailingSaveRequested = true;
      return activeSave;
    }

    trailingSaveRequested = false;
    const pending = (async (): Promise<boolean> => {
      let saved = await runSave();
      while (saved && trailingSaveRequested && isGlobalDirty(deps.getState())) {
        trailingSaveRequested = false;
        saved = await runSave();
      }
      trailingSaveRequested = false;
      return saved;
    })();
    activeSave = pending;
    void pending.finally(() => {
      if (activeSave === pending) activeSave = null;
    });
    return pending;
  }

  function waitForIdle(): Promise<boolean> {
    return activeSave ?? Promise.resolve(true);
  }

  return {
    performSave,
    waitForIdle,
    isSaving: () => activeSave !== null,
  };
}
