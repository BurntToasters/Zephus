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
  // Compare sites ignoring generatedAt: page saves refresh the baseline with
  // a fresh generatedAt, and every snapshot captured BEFORE that save differs
  // from the new baseline ONLY in that timestamp. Comparing raw JSON made any
  // later undo stage the old site as a spurious "Reverted a design change"
  // and mark the site dirty — a save then wrote back the pre-toggle site.
  const siteKey = (site: SiteDocument | null): string =>
    JSON.stringify(
      site === null || site === undefined ? null : { ...site, generatedAt: "" },
    );
  if (siteKey(snap.site) !== siteKey(currentSite)) {
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
      siteKey(snap.site) === siteKey(state.siteDocument)
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
      // Preserve the current editor kind (shell/design): a re-staged
      // snapshot with kind null made the crash draft encode "shell" and the
      // conflict gate bypass a design redo.
      state.pendingSiteEditorKind = state.pendingSiteEditorKind ?? "shell";
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
