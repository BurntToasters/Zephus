/**
 * Crash-recovery draft restore prompts (page + site), separate from Save-to-disk.
 */

import { SITE_DRAFT_TARGET } from "./editorDraft";
import type { SiteEditorKind } from "./editorSession";
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

/** The site draft payload wraps the site with the editor kind that staged it
 *  (shell vs design), so a restored draft reopens the RIGHT editor instead of
 *  always forcing the shell editor and prompting a spurious save/discard
 *  conflict. Legacy raw-site drafts (no kind field) parse as "shell". */
export function encodeSiteDraftContent(
  site: SiteDocument,
  kind: SiteEditorKind | null,
): string {
  return JSON.stringify({ kind: kind ?? "shell", site }, null, 2);
}

export function decodeSiteDraftContent(
  draftContent: string,
): { site: SiteDocument; kind: SiteEditorKind } | null {
  try {
    const parsed = JSON.parse(draftContent) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "site" in (parsed as Record<string, unknown>) &&
      "kind" in (parsed as Record<string, unknown>)
    ) {
      const wrapped = parsed as { site: unknown; kind: unknown };
      // Validate minimal SiteDocument shape and kind value.
      if (
        typeof wrapped.site !== "object" ||
        wrapped.site === null ||
        (wrapped.kind !== "shell" &&
          wrapped.kind !== "design" &&
          wrapped.kind !== null)
      ) {
        return null;
      }
      return {
        site: wrapped.site as SiteDocument,
        kind: wrapped.kind as SiteEditorKind,
      };
    }
    // Legacy draft: raw site JSON — validate it is at least an object.
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return { site: parsed as SiteDocument, kind: "shell" };
  } catch {
    return null;
  }
}

export function siteDraftContentMatchesSaved(
  draftContent: string,
  site: SiteDocument,
): boolean {
  // Accept BOTH the wrapped payload (kind + site) and legacy raw-site drafts
  // written before the kind was persisted.
  return (
    draftContent === encodeSiteDraftContent(site, null) ||
    draftContent === JSON.stringify(site, null, 2)
  );
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
  async function maybeRestoreSiteDraft(
    options: { skipPrompt?: boolean } = {},
  ): Promise<string | null> {
    const state = deps.getState();
    if (!state.project || !state.siteDocument) return null;
    const draft = await deps.zephus.readDraft(
      state.project.path,
      "site",
      SITE_DRAFT_TARGET,
    );
    if (!draft.ok || !draft.draft?.content) return null;
    if (siteDraftContentMatchesSaved(draft.draft.content, state.siteDocument)) {
      // The draft is stale (its content now equals the saved site — e.g. the
      // user staged a change and reverted it). Leaving it on disk makes the
      // home screen show a permanent "Unsaved Work Recovery" card whose
      // "Resume Draft" silently does nothing; clear it.
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
    // Home-screen resume already asked the user; restore without re-prompting.
    if (options.skipPrompt) {
      try {
        const decoded = decodeSiteDraftContent(draft.draft.content);
        if (!decoded) throw new Error("malformed site draft");
        const restored = decoded.site;
        state.pendingSiteDocument = restored;
        state.pendingSiteEditorKind = decoded.kind;
        state.recoveredSiteDraft = draft.draft;
        trackSiteChange(state, "Recovered unsaved site settings");
        markSiteDirty(state, true);
        deps.onSiteDraftRestored();
        deps.setStatus(
          `Recovered site settings draft from ${new Date(draft.draft.savedAt).toLocaleString()}.`,
        );
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
      }
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
      const decoded = decodeSiteDraftContent(draft.draft.content);
      if (!decoded) throw new Error("malformed site draft");
      const restored = decoded.site;
      state.pendingSiteDocument = restored;
      state.pendingSiteEditorKind = decoded.kind;
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
    options: { skipPrompt?: boolean } = {},
  ): Promise<PageDraftRestoreOutcome> {
    const state = deps.getState();
    if (!state.project) return { restored: false };
    const draft = await deps.zephus.readDraft(state.project.path, "page", page);
    if (!draft.ok || !draft.draft?.content) return { restored: false };
    if (draft.draft.content === rawCode) {
      // Stale draft: its content now equals the saved page (user edited and
      // reverted). Clear it so the home card does not linger forever.
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

    // Home-screen resume already asked the user; restore without re-prompting.
    if (options.skipPrompt) {
      deps.setStatus(
        `Recovered draft from ${new Date(draft.draft.savedAt).toLocaleString()}.`,
      );
      return {
        restored: true,
        restoredContent: draft.draft.content,
        restoredDraft: draft.draft,
      };
    }

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
