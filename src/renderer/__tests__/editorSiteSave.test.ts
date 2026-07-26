import { describe, it, expect, vi } from "vitest";
import { createEditorSession } from "../editorSession";
import { createEditorSiteSaveActions } from "../editorSiteSave";
import { SITE_DRAFT_TARGET } from "../editorDraft";

describe("editorSiteSave", () => {
  it("discards pending site changes and clears draft", async () => {
    const state = createEditorSession();
    state.project = {
      path: "/proj",
      name: "P",
      astro: { pagesDir: "src/pages" },
    } as ProjectOpenResult;
    state.siteDirty = true;
    state.pendingSiteDocument = { design: {} } as SiteDocument;

    const clearDraft = vi.fn(async () => ({ ok: true as const }));
    const onSiteStateChanged = vi.fn();
    const actions = createEditorSiteSaveActions({
      getState: () => state,
      setStatus: vi.fn(),
      onSiteStateChanged,
      zephus: {
        clearDraft,
        writeSiteDocument: vi.fn(),
        readSiteDocument: vi.fn(),
      },
    });

    await actions.discardPendingSiteChanges();

    expect(clearDraft).toHaveBeenCalledWith("/proj", "site", SITE_DRAFT_TARGET);
    expect(state.siteDirty).toBe(false);
    expect(state.pendingSiteDocument).toBeNull();
    expect(onSiteStateChanged).toHaveBeenCalled();
  });

  it("persists pending site document and refreshes from disk", async () => {
    const state = createEditorSession();
    state.project = {
      path: "/proj",
      name: "P",
      astro: { pagesDir: "src/pages" },
    } as ProjectOpenResult;
    const pending = { design: { accent: "#f00" } } as SiteDocument;
    state.pendingSiteDocument = pending;
    state.siteDocument = { design: { accent: "#000" } } as SiteDocument;

    const writeSiteDocument = vi.fn(async () => ({ ok: true as const }));
    const readSiteDocument = vi.fn(async () => ({
      ok: true as const,
      site: { design: { accent: "#f00" } } as SiteDocument,
    }));
    const clearDraft = vi.fn(async () => ({ ok: true as const }));

    const actions = createEditorSiteSaveActions({
      getState: () => state,
      setStatus: vi.fn(),
      onSiteStateChanged: vi.fn(),
      zephus: { clearDraft, writeSiteDocument, readSiteDocument },
    });

    const ok = await actions.persistPendingSiteDocument();

    expect(ok).toBe(true);
    expect(writeSiteDocument).toHaveBeenCalledWith(
      "/proj",
      pending,
      "src/pages",
    );
    expect(state.siteDocument?.design?.accent).toBe("#f00");
    expect(state.siteDirty).toBe(false);
  });

  it("returns false when write fails", async () => {
    const state = createEditorSession();
    state.project = {
      path: "/proj",
      name: "P",
      astro: { pagesDir: "src/pages" },
    } as ProjectOpenResult;
    state.pendingSiteDocument = {} as SiteDocument;

    const setStatus = vi.fn();
    const actions = createEditorSiteSaveActions({
      getState: () => state,
      setStatus,
      onSiteStateChanged: vi.fn(),
      zephus: {
        clearDraft: vi.fn(),
        writeSiteDocument: vi.fn(async () => ({
          ok: false as const,
          error: "disk full",
        })),
        readSiteDocument: vi.fn(),
      },
    });

    expect(await actions.persistPendingSiteDocument()).toBe(false);
    expect(setStatus).toHaveBeenCalledWith(
      "Could not save site settings: disk full",
    );
  });
});
