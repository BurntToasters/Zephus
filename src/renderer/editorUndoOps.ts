/** Undo/redo state machine for the visual editor. */

import {
  editorSnapshotSectionsChanged,
  popEditorRedoEntry,
  popEditorUndoEntry,
  pushEditorRedoFromCurrent,
  pushEditorUndoFromCurrent,
} from "./editorUndo";
import { SITE_DRAFT_TARGET } from "./editorDraft";
import { encodeSiteDraftContent } from "./editorDraftRestore";
import { effectiveSiteDocument } from "./editorSession";
import type { EditorSessionState } from "./editorSession";
import type { EditorSnapshot } from "./editorSession";

export interface UndoOpsDeps {
  getState: () => EditorSessionState;
  isLatchActive: () => boolean;
  restoreSnapshot: (snap: EditorSnapshot) => void;
  syncSelectionAfterRestore: () => void;
  serializeBlocks: () => string;
  savedPageRendererSource: () => string | null;
  trackChange: (label: string) => void;
  markDirty: (dirty: boolean) => void;
  renderLayers: () => void;
  renderCanvas: () => void;
  renderProperties: () => void;
  updateUndoRedoButtons: () => void;
  pageDraftContent?: () => string;
  siteDraftContent?: () => string;
}

export function createUndoOps(deps: UndoOpsDeps) {
  const {
    getState,
    isLatchActive,
    restoreSnapshot,
    syncSelectionAfterRestore,
    serializeBlocks,
    savedPageRendererSource,
    trackChange,
    markDirty,
    renderLayers,
    renderCanvas,
    renderProperties,
    updateUndoRedoButtons,
    pageDraftContent,
    siteDraftContent,
  } = deps;

  const state = getState();

  function siteDraftPayload(snapshot: EditorSessionState): string | null {
    const site = effectiveSiteDocument(snapshot);
    if (!site) return null;
    return encodeSiteDraftContent(site, snapshot.pendingSiteEditorKind);
  }

  function rewritePageDraftAfterClear(projectPath: string, page: string): void {
    const current = getState();
    if (current.project?.path !== projectPath || current.page !== page) return;
    const baseline = savedPageRendererSource();
    const needsDraft =
      current.pageDirty ||
      (baseline !== null && serializeBlocks() !== baseline);
    if (!needsDraft) return;
    const content = pageDraftContent?.() ?? serializeBlocks();
    void window.zephus
      .writeDraft(projectPath, "page", page, content)
      .catch(() => undefined);
  }

  function rewriteSiteDraftAfterClear(projectPath: string): void {
    const current = getState();
    if (current.project?.path !== projectPath) return;
    if (!current.siteDirty && !current.pendingSiteDocument) return;
    const content = siteDraftContent?.() ?? siteDraftPayload(current);
    if (!content) return;
    void window.zephus
      .writeDraft(projectPath, "site", SITE_DRAFT_TARGET, content)
      .catch(() => undefined);
  }

  function doUndo(): void {
    // An active resize drag holds the pre-drag snapshot on the stack; popping
    // it mid-drag restores clones the drag keeps mutating — the resize would
    // be silently lost and the undo entry wasted. Wait for the drag to finish.
    if (isLatchActive()) return;
    const prev = popEditorUndoEntry(state);
    if (!prev) return;
    const sectionsChanged = editorSnapshotSectionsChanged(prev, state.sections);
    pushEditorRedoFromCurrent(state);
    restoreSnapshot(prev);
    syncSelectionAfterRestore();
    if (sectionsChanged) {
      trackChange("Undid a change");
      // Undoing back to the last-saved tree must not leave a phantom dirty
      // flag (stale dot, redundant draft write, spurious unsaved-work prompt).
      const savedSource = savedPageRendererSource();
      const restoredMatchesSaved =
        savedSource !== null && serializeBlocks() === savedSource;
      markDirty(!restoredMatchesSaved);
    }
    clearStaleDraftAfterRevert();
    renderLayers();
    renderCanvas();
    renderProperties();
    updateUndoRedoButtons();
  }

  function doRedo(): void {
    // Mirror the doUndo guard: mid-drag redo would replace the sections the
    // drag keeps mutating, silently losing the resize and polluting the stacks
    // with mid-drag state.
    if (isLatchActive()) return;
    const next = popEditorRedoEntry(state);
    if (!next) return;
    const sectionsChanged = editorSnapshotSectionsChanged(next, state.sections);
    pushEditorUndoFromCurrent(state);
    restoreSnapshot(next);
    syncSelectionAfterRestore();
    if (sectionsChanged) {
      trackChange("Redid a change");
      const savedSource = savedPageRendererSource();
      const restoredMatchesSaved =
        savedSource !== null && serializeBlocks() === savedSource;
      markDirty(!restoredMatchesSaved);
    }
    clearStaleDraftAfterRevert();
    renderLayers();
    renderCanvas();
    renderProperties();
    updateUndoRedoButtons();
  }

  /** Undoing a site change back to the saved baseline leaves the site clean — any site draft on disk is then stale, and… */
  function clearStaleDraftAfterRevert(): void {
    const snapshot = getState();
    if (!snapshot.project) return;

    if (!snapshot.siteDirty && !snapshot.pendingSiteDocument) {
      const projectPath = snapshot.project.path;
      void window.zephus
        .clearDraft(projectPath, "site", SITE_DRAFT_TARGET)
        .then(() => {
          rewriteSiteDraftAfterClear(projectPath);
        })
        .catch(() => undefined);
    }

    if (snapshot.pageDirty || !snapshot.page) {
      return;
    }
    const savedSource = savedPageRendererSource();
    if (savedSource === null || serializeBlocks() !== savedSource) return;

    const projectPath = snapshot.project.path;
    const page = snapshot.page;
    void window.zephus
      .clearDraft(projectPath, "page", page)
      .then(() => {
        rewritePageDraftAfterClear(projectPath, page);
      })
      .catch(() => undefined);
  }

  return { doUndo, doRedo };
}
