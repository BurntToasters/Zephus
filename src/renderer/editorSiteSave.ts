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
  let activePersist: Promise<boolean> | null = null;
  let discardSnapshotRequested = false;

  function waitForIdle(): Promise<void> {
    return activePersist
      ? activePersist.then(() => undefined)
      : Promise.resolve();
  }

  async function revertDiskToBaseline(
    projectPath: string,
    pagesDir: string,
    baseline: SiteDocument,
  ): Promise<void> {
    const reverted = await deps.zephus.writeSiteDocument(
      projectPath,
      baseline,
      pagesDir,
    );
    if (!reverted.ok) {
      deps.setStatus(
        "Could not restore saved site settings: " +
          (reverted.error ?? "unknown"),
      );
    }
  }

  async function discardPendingSiteChanges(): Promise<void> {
    const state = deps.getState();
    const projectPath = state.project?.path;
    if (!projectPath) return;

    discardSnapshotRequested = true;
    try {
      await waitForIdle();

      const revisionAtStart = state.siteRevision;
      const beforeClear = deps.getState();
      if (
        beforeClear.project?.path !== projectPath ||
        beforeClear.siteRevision !== revisionAtStart
      ) {
        deps.onSiteStateChanged();
        return;
      }

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
          deps.onSiteStateChanged();
          if (cleanupWarning) {
            deps.setStatus(
              `Site changes were not discarded because ${cleanupWarning}.`,
            );
          }
          return;
        }
      } catch (error) {
        cleanupWarning =
          error instanceof Error
            ? error.message
            : "recovery draft cleanup failed";
        deps.onSiteStateChanged();
        deps.setStatus(
          `Site changes were not discarded because ${cleanupWarning}.`,
        );
        return;
      }

      const current = deps.getState();
      if (
        current.project?.path !== projectPath ||
        current.siteRevision !== revisionAtStart
      ) {
        deps.onSiteStateChanged();
        deps.setStatus(
          "New site edits were made while discarding; they were kept.",
        );
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
    } finally {
      discardSnapshotRequested = false;
    }
  }

  async function persistPendingSiteDocument(): Promise<boolean> {
    if (activePersist) return activePersist;

    const pending = (async (): Promise<boolean> => {
      const state = deps.getState();
      const project = state.project;
      const pendingDoc = state.pendingSiteDocument;
      if (!project || !pendingDoc) return true;

      const projectPath = project.path;
      const pagesDir = project.astro.pagesDir;
      const revisionAtStart = state.siteRevision;
      const baselineSiteDocument = state.siteDocument
        ? (JSON.parse(JSON.stringify(state.siteDocument)) as SiteDocument)
        : null;
      const snapshot = JSON.parse(JSON.stringify(pendingDoc)) as SiteDocument;
      const snapshotFingerprint = JSON.stringify(snapshot);

      const isSnapshotCurrent = (): boolean => {
        if (discardSnapshotRequested) return false;
        const latest = deps.getState();
        return (
          latest.project?.path === projectPath &&
          latest.siteRevision === revisionAtStart &&
          (latest.pendingSiteDocument
            ? JSON.stringify(latest.pendingSiteDocument)
            : null) === snapshotFingerprint
        );
      };

      // Drift check: the staged snapshot builds on the baseline captured at
      // staging time (state.siteDocument). If the disk copy has changed since,
      // writing would silently overwrite external edits — stop instead.
      const onDisk = await deps.zephus.readSiteDocument(projectPath);
      if (!isSnapshotCurrent()) {
        deps.onSiteStateChanged();
        return true;
      }
      if (onDisk.ok && onDisk.site && state.siteDocument) {
        if (
          JSON.stringify(onDisk.site) !== JSON.stringify(state.siteDocument)
        ) {
          deps.setStatus(
            "Site settings changed on disk since you staged your edits. " +
              "Discard your staged changes to load the disk version, then re-apply them.",
          );
          return false;
        }
      }

      if (!isSnapshotCurrent()) {
        deps.onSiteStateChanged();
        return true;
      }

      const result = await deps.zephus.writeSiteDocument(
        projectPath,
        snapshot,
        pagesDir,
      );
      if (!result.ok) {
        deps.setStatus(
          "Could not save site settings: " + (result.error ?? "unknown"),
        );
        return false;
      }

      if (!isSnapshotCurrent()) {
        if (
          deps.getState().project?.path === projectPath &&
          baselineSiteDocument
        ) {
          await revertDiskToBaseline(
            projectPath,
            pagesDir,
            baselineSiteDocument,
          );
        }
        deps.onSiteStateChanged();
        return true;
      }

      const refreshed = await deps.zephus.readSiteDocument(projectPath);
      if (!isSnapshotCurrent()) {
        if (
          deps.getState().project?.path === projectPath &&
          baselineSiteDocument
        ) {
          await revertDiskToBaseline(
            projectPath,
            pagesDir,
            baselineSiteDocument,
          );
        }
        deps.onSiteStateChanged();
        return true;
      }

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
    })();

    activePersist = pending;
    void pending.finally(() => {
      if (activePersist === pending) activePersist = null;
    });
    return pending;
  }

  return {
    discardPendingSiteChanges,
    persistPendingSiteDocument,
    waitForIdle,
  };
}
