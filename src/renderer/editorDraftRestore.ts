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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Validates the full shape written by current Zephus versions. */
function isSiteDocument(value: unknown): value is SiteDocument {
  if (
    !isRecord(value) ||
    !isRecord(value["design"]) ||
    !isRecord(value["shell"])
  ) {
    return false;
  }
  const d = value["design"];
  const s = value["shell"];
  return (
    typeof value["schemaVersion"] === "number" &&
    Number.isFinite(value["schemaVersion"]) &&
    isString(value["themeId"]) &&
    isString(value["siteName"]) &&
    isString(value["generatedAt"]) &&
    isString(value["siteUrl"]) &&
    isString(value["language"]) &&
    isString(value["faviconPath"]) &&
    isString(d["accent"]) &&
    isString(d["background"]) &&
    isString(d["foreground"]) &&
    isString(d["surface"]) &&
    isString(d["fontFamily"]) &&
    isString(d["headingFontFamily"]) &&
    isString(d["radius"]) &&
    isString(d["containerWidth"]) &&
    (d["shadow"] === "none" ||
      d["shadow"] === "sm" ||
      d["shadow"] === "md" ||
      d["shadow"] === "lg") &&
    (s["layoutMode"] === "legacy" || s["layoutMode"] === "managed") &&
    isString(s["layoutPath"]) &&
    isString(s["siteTitle"]) &&
    isString(s["logoText"]) &&
    isString(s["announcementText"]) &&
    typeof s["announcementVisible"] === "boolean" &&
    Array.isArray(s["navItems"]) &&
    isString(s["navCtaLabel"]) &&
    isString(s["navCtaHref"]) &&
    isString(s["footerHtml"]) &&
    isString(s["customHeadHtml"]) &&
    isString(s["customScriptsPath"]) &&
    isString(s["customCssPath"])
  );
}

/** Merges legacy partial drafts onto a known-good saved document. */
function restoreSiteDocument(
  saved: SiteDocument,
  draft: Partial<SiteDocument>,
): SiteDocument {
  if (isSiteDocument(draft)) return draft;
  // Defensive fallback for an already-malformed saved document. Normal project
  // loads are normalized by main, but merging rather than throwing still lets
  // the user recover/export the draft.
  if (!isSiteDocument(saved)) {
    const savedRecord: Record<string, unknown> = isRecord(saved) ? saved : {};
    const draftRecord: Record<string, unknown> = isRecord(draft) ? draft : {};
    return {
      ...savedRecord,
      ...draftRecord,
      design: {
        ...(isRecord(savedRecord["design"]) ? savedRecord["design"] : {}),
        ...(isRecord(draftRecord["design"]) ? draftRecord["design"] : {}),
      },
      shell: {
        ...(isRecord(savedRecord["shell"]) ? savedRecord["shell"] : {}),
        ...(isRecord(draftRecord["shell"]) ? draftRecord["shell"] : {}),
      },
    } as unknown as SiteDocument;
  }
  const raw = draft as Record<string, unknown>;
  const design = isRecord(raw["design"]) ? raw["design"] : {};
  const shell = isRecord(raw["shell"]) ? raw["shell"] : {};
  const stringValue = (value: unknown, fallback: string): string =>
    isString(value) ? value : fallback;
  return {
    ...saved,
    schemaVersion:
      typeof raw["schemaVersion"] === "number" &&
      Number.isFinite(raw["schemaVersion"])
        ? raw["schemaVersion"]
        : saved.schemaVersion,
    themeId: stringValue(raw["themeId"], saved.themeId),
    siteName: stringValue(raw["siteName"], saved.siteName),
    generatedAt: stringValue(raw["generatedAt"], saved.generatedAt),
    siteUrl: stringValue(raw["siteUrl"], saved.siteUrl),
    language: stringValue(raw["language"], saved.language),
    faviconPath: stringValue(raw["faviconPath"], saved.faviconPath),
    design: {
      ...saved.design,
      accent: stringValue(design["accent"], saved.design.accent),
      background: stringValue(design["background"], saved.design.background),
      foreground: stringValue(design["foreground"], saved.design.foreground),
      surface: stringValue(design["surface"], saved.design.surface),
      fontFamily: stringValue(design["fontFamily"], saved.design.fontFamily),
      headingFontFamily: stringValue(
        design["headingFontFamily"],
        saved.design.headingFontFamily,
      ),
      radius: stringValue(design["radius"], saved.design.radius),
      containerWidth: stringValue(
        design["containerWidth"],
        saved.design.containerWidth,
      ),
      fontImportUrl: isString(design["fontImportUrl"])
        ? design["fontImportUrl"]
        : saved.design.fontImportUrl,
      shadow:
        design["shadow"] === "none" ||
        design["shadow"] === "sm" ||
        design["shadow"] === "md" ||
        design["shadow"] === "lg"
          ? design["shadow"]
          : saved.design.shadow,
    },
    shell: {
      ...saved.shell,
      layoutMode:
        shell["layoutMode"] === "legacy" || shell["layoutMode"] === "managed"
          ? shell["layoutMode"]
          : saved.shell.layoutMode,
      layoutPath: stringValue(shell["layoutPath"], saved.shell.layoutPath),
      siteTitle: stringValue(shell["siteTitle"], saved.shell.siteTitle),
      logoText: stringValue(shell["logoText"], saved.shell.logoText),
      announcementText: stringValue(
        shell["announcementText"],
        saved.shell.announcementText,
      ),
      announcementVisible:
        typeof shell["announcementVisible"] === "boolean"
          ? shell["announcementVisible"]
          : saved.shell.announcementVisible,
      navItems: Array.isArray(shell["navItems"])
        ? (shell["navItems"] as NavItem[])
        : saved.shell.navItems,
      navCtaLabel: stringValue(shell["navCtaLabel"], saved.shell.navCtaLabel),
      navCtaHref: stringValue(shell["navCtaHref"], saved.shell.navCtaHref),
      footerHtml: stringValue(shell["footerHtml"], saved.shell.footerHtml),
      customHeadHtml: stringValue(
        shell["customHeadHtml"],
        saved.shell.customHeadHtml,
      ),
      customScriptsPath: stringValue(
        shell["customScriptsPath"],
        saved.shell.customScriptsPath,
      ),
      customCssPath: stringValue(
        shell["customCssPath"],
        saved.shell.customCssPath,
      ),
    },
  };
}

export function decodeSiteDraftContent(
  draftContent: string,
): { site: Partial<SiteDocument>; kind: SiteEditorKind } | null {
  try {
    const parsed = JSON.parse(draftContent) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "site" in (parsed as Record<string, unknown>) &&
      "kind" in (parsed as Record<string, unknown>)
    ) {
      const wrapped = parsed as { site: unknown; kind: unknown };
      if (
        !isSiteDocument(wrapped.site) ||
        (wrapped.kind !== "shell" && wrapped.kind !== "design")
      ) {
        return null;
      }
      return {
        site: wrapped.site,
        kind: wrapped.kind,
      };
    }
    // Legacy drafts stored a raw, sometimes partial, SiteDocument. The caller
    // merges valid fields onto the known-good saved document before use.
    if (!isRecord(parsed)) return null;
    return { site: parsed as Partial<SiteDocument>, kind: "shell" };
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
        const restored = restoreSiteDocument(state.siteDocument, decoded.site);
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
      const restored = restoreSiteDocument(state.siteDocument, decoded.site);
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
