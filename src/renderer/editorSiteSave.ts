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
    if (!state.project) return;
    await deps.zephus.clearDraft(
      state.project.path,
      "site",
      SITE_DRAFT_TARGET,
    );
    clearSiteChanges(state);
    markSiteDirty(state, false);
    deps.onSiteStateChanged();
  }

  async function persistPendingSiteDocument(): Promise<boolean> {
    const state = deps.getState();
    if (!state.project || !state.pendingSiteDocument) return true;
    const result = await deps.zephus.writeSiteDocument(
      state.project.path,
      state.pendingSiteDocument,
      state.project.astro.pagesDir,
    );
    if (!result.ok) {
      deps.setStatus(
        "Could not save site settings: " + (result.error ?? "unknown"),
      );
      return false;
    }
    const refreshed = await deps.zephus.readSiteDocument(state.project.path);
    if (refreshed.ok && refreshed.site) {
      state.siteDocument = refreshed.site;
    }
    await deps.zephus.clearDraft(
      state.project.path,
      "site",
      SITE_DRAFT_TARGET,
    );
    clearSiteChanges(state);
    markSiteDirty(state, false);
    deps.onSiteStateChanged();
    return true;
  }

  return { discardPendingSiteChanges, persistPendingSiteDocument };
}
