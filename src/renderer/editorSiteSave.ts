/**
 * Persist or discard pending site shell/design changes from the editor session.
 */

import { SITE_DRAFT_TARGET } from "./editorDraft";
import {
  clearSiteChanges,
  EditorSessionState,
  markSiteDirty,
} from "./editorSession";

export interface EditorSiteSaveDeps {
  getState: () => EditorSessionState;
  setStatus: (message: string) => void;
  onSiteStateChanged: () => void;
  zephus: Pick<
    Window["zephus"],
    "clearDraft" | "writeSiteDocument" | "readSiteDocument"
  >;
}

export function createEditorSiteSaveActions(deps: EditorSiteSaveDeps) {
  async function discardPendingSiteChanges(): Promise<void> {
    const state = deps.getState();
    const projectPath = state.project?.path;
    if (!projectPath) return;
    const revisionAtStart = state.siteRevision;
    let cleanupWarning: string | null = null;
    try {
      const cleared = await deps.zephus.clearDraft(
        projectPath,
        "site",
        SITE_DRAFT_TARGET,
      );
      if (!cleared.ok) {
        cleanupWarning =
          cleared.error ?? "the recovery draft could not be cleared";
      }
    } catch (error) {
      cleanupWarning =
        error instanceof Error
          ? error.message
          : "recovery draft cleanup failed";
    }

    const current = deps.getState();
    if (
      current.project?.path !== projectPath ||
      current.siteRevision !== revisionAtStart
    ) {
      deps.onSiteStateChanged();
      return;
    }
    clearSiteChanges(current);
    markSiteDirty(current, false);
    deps.onSiteStateChanged();
    if (cleanupWarning) {
      deps.setStatus(
        `Site changes were discarded in the editor, but ${cleanupWarning}.`,
      );
    }
  }

  async function persistPendingSiteDocument(): Promise<boolean> {
    const state = deps.getState();
    const project = state.project;
    const pending = state.pendingSiteDocument;
    if (!project || !pending) return true;

    const projectPath = project.path;
    const revisionAtStart = state.siteRevision;
    const snapshot = JSON.parse(JSON.stringify(pending)) as SiteDocument;
    const snapshotFingerprint = JSON.stringify(snapshot);
    const result = await deps.zephus.writeSiteDocument(
      projectPath,
      snapshot,
      project.astro.pagesDir,
    );
    if (!result.ok) {
      deps.setStatus(
        "Could not save site settings: " + (result.error ?? "unknown"),
      );
      return false;
    }

    const refreshed = await deps.zephus.readSiteDocument(projectPath);
    const current = deps.getState();
    if (current.project?.path !== projectPath) return true;
    if (refreshed.ok && refreshed.site) {
      current.siteDocument = refreshed.site;
    } else {
      // The write already succeeded. Keep the in-memory saved baseline aligned
      // with exactly what was sent even if the follow-up read is unavailable.
      current.siteDocument = snapshot;
    }

    const hasNewerEdits = (): boolean => {
      const latest = deps.getState();
      return (
        latest.project?.path !== projectPath ||
        latest.siteRevision !== revisionAtStart ||
        (latest.pendingSiteDocument
          ? JSON.stringify(latest.pendingSiteDocument)
          : null) !== snapshotFingerprint
      );
    };

    if (hasNewerEdits()) {
      // A modal or inspector changed site settings while the write was in
      // flight. Keep those newer edits dirty and let draft scheduling persist
      // them rather than marking them saved accidentally.
      deps.onSiteStateChanged();
      return true;
    }

    let cleanupWarning: string | null = null;
    try {
      const cleared = await deps.zephus.clearDraft(
        projectPath,
        "site",
        SITE_DRAFT_TARGET,
      );
      if (!cleared.ok) {
        cleanupWarning = cleared.error ?? "unknown recovery cleanup error";
      }
    } catch (error) {
      cleanupWarning =
        error instanceof Error
          ? error.message
          : "recovery draft cleanup failed";
    }
    if (hasNewerEdits()) {
      deps.onSiteStateChanged();
      if (cleanupWarning) {
        deps.setStatus(
          `Site settings were saved, but the recovery draft could not be cleared: ${cleanupWarning}`,
        );
      }
      return true;
    }

    clearSiteChanges(current);
    markSiteDirty(current, false);
    deps.onSiteStateChanged();
    if (cleanupWarning) {
      deps.setStatus(
        `Site settings were saved, but the recovery draft could not be cleared: ${cleanupWarning}`,
      );
    }
    return true;
  }

  return { discardPendingSiteChanges, persistPendingSiteDocument };
}
