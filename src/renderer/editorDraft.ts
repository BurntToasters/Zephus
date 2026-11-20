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
  /** Removes a draft that a late write restored after a save or discard. */
  clearDraft?: Pick<Window["zephus"], "clearDraft">["clearDraft"];
  pageDraftContent: () => string;
  siteDraftContent: () => string;
  /** Surfaced once per session: the crash-recovery net is silently dead (disk full, unwritable drafts.json) and every… */
  onDraftWriteFailure?: (error?: string) => void;
}

/** Writes a page draft, then drops it if a save or discard won the race. */
export function settlePageDraftWrite(
  state: EditorSessionState,
  deps: EditorDraftWriteDeps,
  projectPath: string,
  page: string,
  revision: number,
  content: string,
): Promise<void> {
  return deps
    .writeDraft(projectPath, "page", page, content)
    .then(async (res) => {
      if (res && !res.ok) {
        deps.onDraftWriteFailure?.(res.error);
        return;
      }
      const samePage =
        !!state.project &&
        state.project.path === projectPath &&
        state.page === page;
      if (
        samePage &&
        state.pageDirty &&
        (state.pageRevision !== revision || deps.pageDraftContent() !== content)
      ) {
        scheduleEditorDraftWrite(state, deps);
        return;
      }
      if (!samePage || !state.pageDirty) {
        await deps
          .clearDraft?.(projectPath, "page", page)
          ?.catch((error: unknown) =>
            deps.onDraftWriteFailure?.(draftFailureMessage(error)),
          );
      }
    })
    .catch((error: unknown) =>
      deps.onDraftWriteFailure?.(draftFailureMessage(error)),
    );
}

/** Writes a site draft, then drops it if a save or discard won the race. */
export function settleSiteDraftWrite(
  state: EditorSessionState,
  deps: EditorDraftWriteDeps,
  projectPath: string,
  revision: number,
  content: string,
): Promise<void> {
  return deps
    .writeDraft(projectPath, "site", SITE_DRAFT_TARGET, content)
    .then(async (res) => {
      if (res && !res.ok) {
        deps.onDraftWriteFailure?.(res.error);
        return;
      }
      const sameProject = !!state.project && state.project.path === projectPath;
      if (
        sameProject &&
        state.siteDirty &&
        (state.siteRevision !== revision || deps.siteDraftContent() !== content)
      ) {
        scheduleEditorDraftWrite(state, deps);
        return;
      }
      if (!sameProject || !state.siteDirty) {
        await deps
          .clearDraft?.(projectPath, "site", SITE_DRAFT_TARGET)
          ?.catch((error: unknown) =>
            deps.onDraftWriteFailure?.(draftFailureMessage(error)),
          );
      }
    })
    .catch((error: unknown) =>
      deps.onDraftWriteFailure?.(draftFailureMessage(error)),
    );
}

function draftFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
      void settlePageDraftWrite(
        state,
        deps,
        projectPath,
        page,
        pageRevisionAtWrite,
        content,
      );
    }
    if (state.siteDirty && effectiveSiteDocument(state)) {
      const projectPath = project.path;
      const siteRevisionAtWrite = state.siteRevision;
      const siteContent = deps.siteDraftContent();
      void settleSiteDraftWrite(
        state,
        deps,
        projectPath,
        siteRevisionAtWrite,
        siteContent,
      );
    }
  }, DRAFT_WRITE_DEBOUNCE_MS);
}
