import { describe, it, expect, vi } from "vitest";
import {
  createEditorDraftRestoreActions,
  formatPageDraftRestoreMessage,
  formatSiteDraftRestoreMessage,
  siteDraftContentMatchesSaved,
} from "../editorDraftRestore";
import { createEditorSession } from "../editorSession";
import { SITE_DRAFT_TARGET } from "../editorDraft";

describe("editorDraftRestore", () => {
  it("formats page restore copy", () => {
    const msg = formatPageDraftRestoreMessage(
      "Home",
      "2026-01-15T12:00:00.000Z",
    );
    expect(msg).toContain("Home");
    expect(msg).toContain("Restore it?");
  });

  it("formats site restore copy", () => {
    const msg = formatSiteDraftRestoreMessage("2026-01-15T12:00:00.000Z");
    expect(msg).toContain("site-level");
    expect(msg).toContain("Restore them?");
  });

  it("detects site draft identical to saved document", () => {
    const site = { design: { accent: "#111" } } as SiteDocument;
    const content = JSON.stringify(site, null, 2);
    expect(siteDraftContentMatchesSaved(content, site)).toBe(true);
    expect(
      siteDraftContentMatchesSaved('{"design":{"accent":"#222"}}', site),
    ).toBe(false);
  });

  function makeState() {
    const state = createEditorSession();
    state.project = {
      path: "/proj",
      name: "P",
      astro: { pagesDir: "src/pages" },
    } as ProjectOpenResult;
    state.siteDocument = { design: { accent: "#000" } } as SiteDocument;
    return state;
  }

  describe("maybeRestoreSiteDraft", () => {
    it("returns null when no draft exists", async () => {
      const state = makeState();
      const actions = createEditorDraftRestoreActions({
        getState: () => state,
        setStatus: vi.fn(),
        confirmRestoreDraft: vi.fn(),
        onSiteDraftRestored: vi.fn(),
        zephus: {
          readDraft: vi.fn(async () => ({ ok: false as const, draft: null })),
          clearDraft: vi.fn(),
        },
      });

      expect(await actions.maybeRestoreSiteDraft()).toBeNull();
    });

    it("returns null when the draft matches the saved document", async () => {
      const state = makeState();
      const confirmRestoreDraft = vi.fn();
      const actions = createEditorDraftRestoreActions({
        getState: () => state,
        setStatus: vi.fn(),
        confirmRestoreDraft,
        onSiteDraftRestored: vi.fn(),
        zephus: {
          readDraft: vi.fn(async () => ({
            ok: true as const,
            draft: {
              projectPath: "/proj",
              scope: "site" as const,
              target: SITE_DRAFT_TARGET,
              content: JSON.stringify(state.siteDocument, null, 2),
              savedAt: "2026-01-15T12:00:00.000Z",
            },
          })),
          clearDraft: vi.fn(),
        },
      });

      expect(await actions.maybeRestoreSiteDraft()).toBeNull();
      expect(confirmRestoreDraft).not.toHaveBeenCalled();
    });

    it("discards the draft when the user chooses discard", async () => {
      const state = makeState();
      const clearDraft = vi.fn(async () => ({ ok: true as const }));
      const actions = createEditorDraftRestoreActions({
        getState: () => state,
        setStatus: vi.fn(),
        confirmRestoreDraft: vi.fn(async () => "discard" as const),
        onSiteDraftRestored: vi.fn(),
        zephus: {
          readDraft: vi.fn(async () => ({
            ok: true as const,
            draft: {
              projectPath: "/proj",
              scope: "site" as const,
              target: SITE_DRAFT_TARGET,
              content: '{"design":{"accent":"#111"}}',
              savedAt: "2026-01-15T12:00:00.000Z",
            },
          })),
          clearDraft,
        },
      });

      expect(await actions.maybeRestoreSiteDraft()).toBeNull();
      expect(clearDraft).toHaveBeenCalledWith(
        "/proj",
        "site",
        SITE_DRAFT_TARGET,
      );
      expect(state.siteDirty).toBe(false);
    });

    it("restores the draft into the pending site document", async () => {
      const state = makeState();
      const onSiteDraftRestored = vi.fn();
      const actions = createEditorDraftRestoreActions({
        getState: () => state,
        setStatus: vi.fn(),
        confirmRestoreDraft: vi.fn(async () => "restore" as const),
        onSiteDraftRestored,
        zephus: {
          readDraft: vi.fn(async () => ({
            ok: true as const,
            draft: {
              projectPath: "/proj",
              scope: "site" as const,
              target: SITE_DRAFT_TARGET,
              content: '{"design":{"accent":"#111"}}',
              savedAt: "2026-01-15T12:00:00.000Z",
            },
          })),
          clearDraft: vi.fn(),
        },
      });

      expect(await actions.maybeRestoreSiteDraft()).toBeNull();
      expect(state.pendingSiteDocument?.design?.accent).toBe("#111");
      expect(state.siteDirty).toBe(true);
      expect(onSiteDraftRestored).toHaveBeenCalled();
    });

    it("clears a corrupt draft instead of restoring it", async () => {
      const state = makeState();
      const clearDraft = vi.fn(async () => ({ ok: true as const }));
      const actions = createEditorDraftRestoreActions({
        getState: () => state,
        setStatus: vi.fn(),
        confirmRestoreDraft: vi.fn(async () => "restore" as const),
        onSiteDraftRestored: vi.fn(),
        zephus: {
          readDraft: vi.fn(async () => ({
            ok: true as const,
            draft: {
              projectPath: "/proj",
              scope: "site" as const,
              target: SITE_DRAFT_TARGET,
              content: "not json{{",
              savedAt: "2026-01-15T12:00:00.000Z",
            },
          })),
          clearDraft,
        },
      });

      expect(await actions.maybeRestoreSiteDraft()).toBeNull();
      expect(clearDraft).toHaveBeenCalled();
      expect(state.siteDirty).toBe(false);
    });
  });

  describe("maybeRestorePageDraft", () => {
    it("returns no-restore when no draft exists", async () => {
      const state = makeState();
      const actions = createEditorDraftRestoreActions({
        getState: () => state,
        setStatus: vi.fn(),
        confirmRestoreDraft: vi.fn(),
        onSiteDraftRestored: vi.fn(),
        zephus: {
          readDraft: vi.fn(async () => ({ ok: false as const, draft: null })),
          clearDraft: vi.fn(),
        },
      });

      expect(
        await actions.maybeRestorePageDraft("index.astro", "Home", "<h1>"),
      ).toEqual({ restored: false });
    });

    it("returns no-restore when the draft matches the raw code", async () => {
      const state = makeState();
      const confirmRestoreDraft = vi.fn();
      const actions = createEditorDraftRestoreActions({
        getState: () => state,
        setStatus: vi.fn(),
        confirmRestoreDraft,
        onSiteDraftRestored: vi.fn(),
        zephus: {
          readDraft: vi.fn(async () => ({
            ok: true as const,
            draft: {
              projectPath: "/proj",
              scope: "page" as const,
              target: "index.astro",
              content: "<h1>current</h1>",
              savedAt: "2026-01-15T12:00:00.000Z",
            },
          })),
          clearDraft: vi.fn(),
        },
      });

      expect(
        await actions.maybeRestorePageDraft(
          "index.astro",
          "Home",
          "<h1>current</h1>",
        ),
      ).toEqual({ restored: false });
      expect(confirmRestoreDraft).not.toHaveBeenCalled();
    });

    it("restores the draft content on confirm", async () => {
      const state = makeState();
      const actions = createEditorDraftRestoreActions({
        getState: () => state,
        setStatus: vi.fn(),
        confirmRestoreDraft: vi.fn(async () => "restore" as const),
        onSiteDraftRestored: vi.fn(),
        zephus: {
          readDraft: vi.fn(async () => ({
            ok: true as const,
            draft: {
              projectPath: "/proj",
              scope: "page" as const,
              target: "index.astro",
              content: "<h1>draft</h1>",
              savedAt: "2026-01-15T12:00:00.000Z",
            },
          })),
          clearDraft: vi.fn(),
        },
      });

      const outcome = await actions.maybeRestorePageDraft(
        "index.astro",
        "Home",
        "<h1>current</h1>",
      );
      expect(outcome.restored).toBe(true);
      expect(outcome.restoredContent).toBe("<h1>draft</h1>");
      expect(outcome.restoredDraft).toBeDefined();
    });

    it("discards the draft on discard choice", async () => {
      const state = makeState();
      const clearDraft = vi.fn(async () => ({ ok: true as const }));
      const actions = createEditorDraftRestoreActions({
        getState: () => state,
        setStatus: vi.fn(),
        confirmRestoreDraft: vi.fn(async () => "discard" as const),
        onSiteDraftRestored: vi.fn(),
        zephus: {
          readDraft: vi.fn(async () => ({
            ok: true as const,
            draft: {
              projectPath: "/proj",
              scope: "page" as const,
              target: "index.astro",
              content: "<h1>draft</h1>",
              savedAt: "2026-01-15T12:00:00.000Z",
            },
          })),
          clearDraft,
        },
      });

      const outcome = await actions.maybeRestorePageDraft(
        "index.astro",
        "Home",
        "<h1>current</h1>",
      );
      expect(outcome.restored).toBe(false);
      expect(clearDraft).toHaveBeenCalledWith("/proj", "page", "index.astro");
    });

    it("surfaces failed draft cleanup on discard", async () => {
      const state = makeState();
      const actions = createEditorDraftRestoreActions({
        getState: () => state,
        setStatus: vi.fn(),
        confirmRestoreDraft: vi.fn(async () => "discard" as const),
        onSiteDraftRestored: vi.fn(),
        zephus: {
          readDraft: vi.fn(async () => ({
            ok: true as const,
            draft: {
              projectPath: "/proj",
              scope: "page" as const,
              target: "index.astro",
              content: "<h1>draft</h1>",
              savedAt: "2026-01-15T12:00:00.000Z",
            },
          })),
          clearDraft: vi.fn(async () => ({
            ok: false as const,
            error: "busy",
          })),
        },
      });

      const outcome = await actions.maybeRestorePageDraft(
        "index.astro",
        "Home",
        "<h1>current</h1>",
      );
      expect(outcome.restored).toBe(false);
      expect(outcome.cleanupWarning).toContain("busy");
    });
  });
});
