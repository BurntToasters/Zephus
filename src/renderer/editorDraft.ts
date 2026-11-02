/**
 * Debounced local draft writes (crash recovery — not a substitute for Save).
 */

import {
  EditorSessionState,
  effectiveSiteDocument,
  isGlobalDirty,
} from "./editorSession";

export const SITE_DRAFT_TARGET = "site-shell";
export const DRAFT_WRITE_DEBOUNCE_MS = 800;

export interface EditorDraftWriteDeps {
  writeDraft: Pick<Window["zephus"], "writeDraft">["writeDraft"];
  pageDraftContent: () => string;
  siteDraftContent: () => string;
  /** Surfaced once per session: the crash-recovery net is silently dead (disk full, unwritable drafts.json) and every… */
  onDraftWriteFailure?: () => void;
}

export function cancelScheduledEditorDraftWrite(
  state: EditorSessionState,
): void {
  if (state.draftTimer !== null) {
    window.clearTimeout(state.draftTimer);
    state.draftTimer = null;
  }
}

export function scheduleEditorDraftWrite(
  state: EditorSessionState,
  deps: EditorDraftWriteDeps,
): void {
  if (!state.project) return;
  cancelScheduledEditorDraftWrite(state);
  state.draftTimer = window.setTimeout(() => {
    state.draftTimer = null;
    const project = state.project;
    if (!project || !isGlobalDirty(state)) return;
    if (state.pageDirty && state.page) {
      const projectPath = project.path;
      const page = state.page;
      const pageRevisionAtWrite = state.pageRevision;
      const content = deps.pageDraftContent();
      // Fire-and-forget: an IPC rejection (e.g. project path no longer
      // approved) must not become an unhandled rejection. A failed WRITE
      // (ok:false) is surfaced once via onDraftWriteFailure — a silently
      // dead recovery net is worse than a warning.
      void deps
        .writeDraft(projectPath, "page", page, content)
        .then((res) => {
          if (res && !res.ok) deps.onDraftWriteFailure?.();
          if (
            !state.project ||
            state.project.path !== projectPath ||
            state.page !== page
          ) {
            return;
          }
          if (state.pageRevision !== pageRevisionAtWrite) {
            scheduleEditorDraftWrite(state, deps);
          }
        })
        .catch(() => deps.onDraftWriteFailure?.());
    }
    if (state.siteDirty && effectiveSiteDocument(state)) {
      const projectPath = project.path;
      const siteRevisionAtWrite = state.siteRevision;
      const siteContent = deps.siteDraftContent();
      void deps
        .writeDraft(projectPath, "site", SITE_DRAFT_TARGET, siteContent)
        .then((res) => {
          if (res && !res.ok) deps.onDraftWriteFailure?.();
          if (!state.project || state.project.path !== projectPath) {
            return;
          }
          if (state.siteRevision !== siteRevisionAtWrite) {
            scheduleEditorDraftWrite(state, deps);
          }
        })
        .catch(() => deps.onDraftWriteFailure?.());
    }
  }, DRAFT_WRITE_DEBOUNCE_MS);
}
