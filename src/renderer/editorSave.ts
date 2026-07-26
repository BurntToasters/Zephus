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
  serializeBlocks: () => string;
  pageDocumentFromState: () => PageDocument | null;
  syncVisualModeState: () => void;
  sectionsFromPageDocument: (doc: PageDocument) => SectionNode[];
  syncBlocksFromSections: () => void;
  clearChanges: () => void;
  markDirty: (dirty: boolean) => void;
  renderDirtyIndicators: () => void;
  reloadPages: () => Promise<void>;
  persistPendingSiteDocument: () => Promise<boolean>;
  afterSave: () => void;
  zephus: Pick<
    Window["zephus"],
    "detachPageDocument" | "writePageDocument" | "clearDraft"
  >;
}

export function createEditorSaveActions(deps: EditorSaveDeps) {
  async function performSave(): Promise<boolean> {
    const state = deps.getState();
    if (!state.project) {
      deps.setStatus("No project open to save.");
      return false;
    }
    if (!isGlobalDirty(state)) {
      deps.setStatus("Nothing to save.");
      return true;
    }
    cancelScheduledEditorDraftWrite(state);
    let savedPage = false;
    let savedSite = false;

    if (state.pageDirty) {
      if (!state.page) {
        deps.setStatus("No page open to save.");
        return false;
      }
      const content =
        state.mode === "code" ? deps.getCode() : deps.serializeBlocks();
      if (state.mode === "code") {
        if (state.managedStatus === "detached") {
          const detached = await deps.zephus.detachPageDocument(
            state.project.path,
            state.page,
            state.project.astro.pagesDir,
            content,
          );
          if (!detached.ok || !detached.pageDocument) {
            deps.setStatus("Save failed: " + (detached.error ?? "unknown"));
            return false;
          }
          state.pageDocument = detached.pageDocument;
          state.siteDocument = detached.site;
          state.managedStatus = detached.pageDocument.managedFileStatus;
          state.visualEditable = false;
          state.generatedCode =
            detached.generatedSource ?? detached.source ?? content;
          state.rawCode = content;
        } else if (state.managedStatus === "out-of-sync") {
          const detached = await deps.zephus.detachPageDocument(
            state.project.path,
            state.page,
            state.project.astro.pagesDir,
            content,
          );
          if (!detached.ok || !detached.pageDocument) {
            deps.setStatus("Save failed: " + (detached.error ?? "unknown"));
            return false;
          }
          state.pageDocument = detached.pageDocument;
          state.siteDocument = detached.site;
          state.managedStatus = detached.pageDocument.managedFileStatus;
          state.visualEditable = false;
          state.generatedCode =
            detached.generatedSource ?? detached.source ?? content;
          state.rawCode = content;
          deps.setStatus(
            "Page saved as hand-authored Astro. Reattach when you want visual editing again.",
          );
        } else {
          const visualDoc = deps.pageDocumentFromState();
          if (!visualDoc) {
            deps.setStatus("Save failed: missing page document.");
            return false;
          }
          const generated = await deps.zephus.writePageDocument(
            state.project.path,
            state.project.astro.pagesDir,
            visualDoc,
          );
          if (!generated.ok || !generated.pageDocument) {
            deps.setStatus("Save failed: " + (generated.error ?? "unknown"));
            return false;
          }
          const normalizedGenerated = generated.source ?? "";
          if (content !== normalizedGenerated) {
            const detached = await deps.zephus.detachPageDocument(
              state.project.path,
              state.page,
              state.project.astro.pagesDir,
              content,
            );
            if (!detached.ok || !detached.pageDocument) {
              deps.setStatus("Detach failed: " + (detached.error ?? "unknown"));
              return false;
            }
            state.pageDocument = detached.pageDocument;
            state.siteDocument = detached.site;
            state.managedStatus = detached.pageDocument.managedFileStatus;
            state.visualEditable = false;
            state.generatedCode = normalizedGenerated;
            state.rawCode = content;
            deps.setStatus(
              "Page detached from visual mode and saved as hand-authored Astro.",
            );
          } else {
            state.pageDocument = generated.pageDocument;
            state.siteDocument = generated.site;
            state.managedStatus = generated.pageDocument.managedFileStatus;
            state.visualEditable = true;
            state.generatedCode = normalizedGenerated;
            state.rawCode = normalizedGenerated;
          }
        }
      } else {
        const doc = deps.pageDocumentFromState();
        if (!doc) {
          deps.setStatus("Save failed: missing page document.");
          return false;
        }
        const saved = await deps.zephus.writePageDocument(
          state.project.path,
          state.project.astro.pagesDir,
          doc,
        );
        if (!saved.ok || !saved.pageDocument) {
          deps.setStatus("Save failed: " + (saved.error ?? "unknown"));
          return false;
        }
        state.pageDocument = saved.pageDocument;
        state.siteDocument = saved.site;
        state.managedStatus = saved.pageDocument.managedFileStatus;
        state.visualEditable = true;
        state.generatedCode = saved.generatedSource ?? saved.source ?? content;
        state.rawCode = state.generatedCode;
      }
      deps.syncVisualModeState();
      if (state.mode === "code" && state.visualEditable) {
        const currentDoc = deps.pageDocumentFromState();
        if (currentDoc) {
          state.sections = deps.sectionsFromPageDocument(currentDoc);
          deps.syncBlocksFromSections();
        }
      }
      await deps.zephus.clearDraft(state.project.path, "page", state.page);
      deps.clearChanges();
      deps.markDirty(false);
      savedPage = true;
    }

    if (state.siteDirty) {
      const saved = await deps.persistPendingSiteDocument();
      if (!saved) return false;
      savedSite = true;
    }

    deps.renderDirtyIndicators();
    deps.setStatus(
      formatSaveStatusMessage(savedPage, savedSite, state.page),
    );
    deps.afterSave();
    await deps.reloadPages();
    return true;
  }

  return { performSave };
}
