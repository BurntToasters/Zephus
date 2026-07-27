/**
 * Crash-recovery draft restore prompts (page + site), separate from Save-to-disk.
 */

import { SITE_DRAFT_TARGET } from "./editorDraft";
import {
  EditorSessionState,
  markSiteDirty,
  trackSiteChange,
} from "./editorSession";

export function formatPageDraftRestoreMessage(
  pageLabel: string,
  savedAt: string,
): string {
  return `Zephus found an unsaved draft for ${pageLabel} from ${new Date(
    savedAt,
  ).toLocaleString()}. Restore it?`;
}

export function formatSiteDraftRestoreMessage(savedAt: string): string {
  return `Zephus found unsaved site-level changes from ${new Date(savedAt).toLocaleString()}. Restore them?`;
}

export function siteDraftContentMatchesSaved(
  draftContent: string,
  site: SiteDocument,
): boolean {
  return draftContent === JSON.stringify(site, null, 2);
}

export type DraftRestoreChoice = "restore" | "discard" | "cancel";

export interface PageDraftRestoreOutcome {
  restored: boolean;
  restoredContent?: string;
  restoredDraft?: DraftData;
  cleanupWarning?: string;
}

export interface EditorDraftRestoreDeps {
  getState: () => EditorSessionState;
  setStatus: (message: string) => void;
  confirmRestoreDraft: (
    title: string,
    message: string,
  ) => Promise<DraftRestoreChoice>;
  onSiteDraftRestored: () => void;
  zephus: Pick<Window["zephus"], "readDraft" | "clearDraft">;
}

function cleanupWarning(scope: "page" | "site", error?: string): string {
  return `The ${scope} recovery draft could not be discarded: ${error ?? "unknown error"}. It will remain available next time.`;
}

export function createEditorDraftRestoreActions(deps: EditorDraftRestoreDeps) {
  async function maybeRestoreSiteDraft(): Promise<string | null> {
    const state = deps.getState();
    if (!state.project || !state.siteDocument) return null;
    const draft = await deps.zephus.readDraft(
      state.project.path,
      "site",
      SITE_DRAFT_TARGET,
    );
    if (!draft.ok || !draft.draft?.content) return null;
    if (siteDraftContentMatchesSaved(draft.draft.content, state.siteDocument)) {
      return null;
    }
    const choice = await deps.confirmRestoreDraft(
      "Restore Site Draft",
      formatSiteDraftRestoreMessage(draft.draft.savedAt),
    );
    if (choice === "discard") {
      const cleared = await deps.zephus.clearDraft(
        state.project.path,
        "site",
        SITE_DRAFT_TARGET,
      );
      if (!cleared.ok) {
        const warning = cleanupWarning("site", cleared.error);
        deps.setStatus(warning);
        return warning;
      }
      return null;
    }
    if (choice !== "restore") return null;
    try {
      const restored = JSON.parse(draft.draft.content) as SiteDocument;
      state.pendingSiteDocument = restored;
      state.pendingSiteEditorKind = "shell";
      state.recoveredSiteDraft = draft.draft;
      trackSiteChange(state, "Recovered unsaved site settings");
      markSiteDirty(state, true);
      deps.onSiteDraftRestored();
      deps.setStatus(
        `Recovered site settings draft from ${new Date(draft.draft.savedAt).toLocaleString()}.`,
      );
      return null;
    } catch {
      const cleared = await deps.zephus.clearDraft(
        state.project.path,
        "site",
        SITE_DRAFT_TARGET,
      );
      if (!cleared.ok) {
        const warning = cleanupWarning("site", cleared.error);
        deps.setStatus(warning);
        return warning;
      }
      return null;
    }
  }

  async function maybeRestorePageDraft(
    page: string,
    pageLabel: string,
    rawCode: string,
  ): Promise<PageDraftRestoreOutcome> {
    const state = deps.getState();
    if (!state.project) return { restored: false };
    const draft = await deps.zephus.readDraft(state.project.path, "page", page);
    if (!draft.ok || !draft.draft?.content) return { restored: false };
    if (draft.draft.content === rawCode) return { restored: false };

    const choice = await deps.confirmRestoreDraft(
      "Restore Page Draft",
      formatPageDraftRestoreMessage(pageLabel, draft.draft.savedAt),
    );
    if (choice === "discard") {
      const cleared = await deps.zephus.clearDraft(
        state.project.path,
        "page",
        page,
      );
      if (!cleared.ok) {
        const warning = cleanupWarning("page", cleared.error);
        deps.setStatus(warning);
        return { restored: false, cleanupWarning: warning };
      }
      return { restored: false };
    }
    if (choice !== "restore") return { restored: false };

    deps.setStatus(
      `Recovered draft from ${new Date(draft.draft.savedAt).toLocaleString()}.`,
    );
    return {
      restored: true,
      restoredContent: draft.draft.content,
      restoredDraft: draft.draft,
    };
  }

  return { maybeRestoreSiteDraft, maybeRestorePageDraft };
}
