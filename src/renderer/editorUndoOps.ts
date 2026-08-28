/** Undo/redo state machine for the visual editor. */

import {
  editorSnapshotSectionsChanged,
  popEditorRedoEntry,
  popEditorUndoEntry,
  pushEditorRedoFromCurrent,
  pushEditorUndoFromCurrent,
} from "./editorUndo";
import { SITE_DRAFT_TARGET } from "./editorDraft";
import type { EditorSessionState } from "./editorSession";
import type { EditorSnapshot } from "./editorSession";

export interface UndoOpsDeps {
  getState: () => EditorSessionState;
  isLatchActive: () => boolean;
  restoreSnapshot: (snap: EditorSnapshot) => void;
  syncSelectionAfterRestore: () => void;
  serializeBlocks: () => string;
  trackChange: (label: string) => void;
  markDirty: (dirty: boolean) => void;
  renderLayers: () => void;
  renderCanvas: () => void;
  renderProperties: () => void;
  updateUndoRedoButtons: () => void;
}

export function createUndoOps(deps: UndoOpsDeps) {
  const {
    getState,
    isLatchActive,
    restoreSnapshot,
    syncSelectionAfterRestore,
    serializeBlocks,
    trackChange,
    markDirty,
    renderLayers,
    renderCanvas,
    renderProperties,
    updateUndoRedoButtons,
  } = deps;

  const state = getState();

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
      const savedSource = state.rawCode ?? state.generatedCode ?? null;
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
      const savedSource = state.rawCode ?? state.generatedCode ?? null;
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
    if (!state.project || state.siteDirty || state.pendingSiteDocument) return;
    void window.zephus
      .clearDraft(state.project.path, "site", SITE_DRAFT_TARGET)
      .catch(() => undefined);
  }

  return { doUndo, doRedo };
}
