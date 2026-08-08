/**
 * Unified page + site undo snapshots for the visual editor.
 */

import {
  cloneSiteDocument,
  EditorSessionState,
  EditorSnapshot,
  effectiveSiteDocument,
  markSiteDirty,
  trackSiteChange,
} from "./editorSession";
import { cloneSections } from "./editorPageModel";

export const EDITOR_UNDO_LIMIT = 50;

export function captureEditorSnapshot(
  state: EditorSessionState,
): EditorSnapshot {
  return {
    sections: cloneSections(state.sections),
    site: cloneSiteDocument(effectiveSiteDocument(state)),
  };
}

export function pushEditorUndo(
  state: EditorSessionState,
  onStackChange?: () => void,
): void {
  state.undo.push(captureEditorSnapshot(state));
  if (state.undo.length > EDITOR_UNDO_LIMIT) state.undo.shift();
  state.redo = [];
  onStackChange?.();
}

/** Pushes an already-captured snapshot (pre-mutation state) onto the stack. */
export function pushEditorSnapshot(
  state: EditorSessionState,
  snapshot: EditorSnapshot,
  onStackChange?: () => void,
): void {
  state.undo.push(snapshot);
  if (state.undo.length > EDITOR_UNDO_LIMIT) state.undo.shift();
  state.redo = [];
  onStackChange?.();
}

export interface RestoreEditorSnapshotEffects {
  syncBlocksFromSections: () => void;
  syncSelectionState: () => void;
  applyDesignPreview: () => void;
  renderDirtyIndicators: () => void;
}

/**
 * Restores sections and pending site document from a snapshot (design/shell undo).
 */
export function restoreEditorSnapshot(
  state: EditorSessionState,
  snap: EditorSnapshot,
  effects: RestoreEditorSnapshotEffects,
): void {
  state.sections = cloneSections(snap.sections);
  effects.syncBlocksFromSections();
  effects.syncSelectionState();

  const currentSite = effectiveSiteDocument(state);
  if (JSON.stringify(snap.site) !== JSON.stringify(currentSite)) {
    if (snap.site === null || snap.site === undefined) {
      // The snapshot was captured while no site document was loaded/staged.
      // Undo must return to that state: clear any staged site edits instead
      // of leaving them applied-and-dirty (previously nothing happened).
      if (state.pendingSiteDocument) {
        state.pendingSiteDocument = null;
        state.pendingSiteEditorKind = null;
        markSiteDirty(state, false);
        effects.applyDesignPreview();
        effects.renderDirtyIndicators();
      }
    } else if (
      state.siteDocument &&
      JSON.stringify(snap.site) === JSON.stringify(state.siteDocument)
    ) {
      state.pendingSiteDocument = null;
      state.pendingSiteEditorKind = null;
      markSiteDirty(state, false);
      // The staged preview must be cleared from the canvas and the dirty
      // indicators refreshed, like the other revert branches.
      effects.applyDesignPreview();
      effects.renderDirtyIndicators();
    } else {
      state.pendingSiteDocument = cloneSiteDocument(snap.site);
      trackSiteChange(state, "Reverted a design change");
      markSiteDirty(state, true);
      effects.applyDesignPreview();
      effects.renderDirtyIndicators();
    }
  }
}

export function editorSnapshotSectionsChanged(
  snap: EditorSnapshot,
  sections: SectionNode[],
): boolean {
  return JSON.stringify(snap.sections) !== JSON.stringify(sections);
}

export function popEditorUndoEntry(
  state: EditorSessionState,
): EditorSnapshot | undefined {
  return state.undo.pop();
}

export function popEditorRedoEntry(
  state: EditorSessionState,
): EditorSnapshot | undefined {
  return state.redo.pop();
}

export function pushEditorRedoFromCurrent(state: EditorSessionState): void {
  state.redo.push(captureEditorSnapshot(state));
}

export function pushEditorUndoFromCurrent(state: EditorSessionState): void {
  state.undo.push(captureEditorSnapshot(state));
}
