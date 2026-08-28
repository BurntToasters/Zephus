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
    const baseline = { design: { accent: "#000" } } as SiteDocument;
    const pending = { design: { accent: "#f00" } } as SiteDocument;
    state.pendingSiteDocument = pending;
    state.siteDocument = baseline;

    const writeSiteDocument = vi.fn(async () => ({ ok: true as const }));
    // First read = drift check (disk still matches the baseline); second read
    // = post-write refresh (disk now holds the written document).
    const readSiteDocument = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        site: { ...baseline },
      })
      .mockResolvedValueOnce({
        ok: true as const,
        site: { ...pending },
      });
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

  it("refuses to overwrite site.json changed on disk since staging", async () => {
    const state = createEditorSession();
    state.project = {
      path: "/proj",
      name: "P",
      astro: { pagesDir: "src/pages" },
    } as ProjectOpenResult;
    state.pendingSiteDocument = { design: { accent: "#f00" } } as SiteDocument;
    state.siteDocument = { design: { accent: "#000" } } as SiteDocument;

    const setStatus = vi.fn();
    const writeSiteDocument = vi.fn(async () => ({ ok: true as const }));
    const actions = createEditorSiteSaveActions({
      getState: () => state,
      setStatus,
      onSiteStateChanged: vi.fn(),
      zephus: {
        clearDraft: vi.fn(),
        writeSiteDocument,
        readSiteDocument: vi.fn(async () => ({
          ok: true as const,
          site: { design: { accent: "#999" } } as SiteDocument,
        })),
      },
    });

    expect(await actions.persistPendingSiteDocument()).toBe(false);
    expect(writeSiteDocument).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith(
      expect.stringContaining("changed on disk"),
    );
  });

  it("returns false when write fails", async () => {
    const state = createEditorSession();
    state.project = {
      path: "/proj",
      name: "P",
      astro: { pagesDir: "src/pages" },
    } as ProjectOpenResult;
    state.pendingSiteDocument = {} as SiteDocument;
    state.siteDocument = {} as SiteDocument;

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
        readSiteDocument: vi.fn(async () => ({
          ok: true as const,
          site: {} as SiteDocument,
        })),
      },
    });

    expect(await actions.persistPendingSiteDocument()).toBe(false);
    expect(setStatus).toHaveBeenCalledWith(
      "Could not save site settings: disk full",
    );
  });

  it("keeps newer edits dirty when they arrive mid-persist", async () => {
    const state = createEditorSession();
    state.project = {
      path: "/proj",
      name: "P",
      astro: { pagesDir: "src/pages" },
    } as ProjectOpenResult;
    const baseline = { design: { accent: "#000" } } as SiteDocument;
    const pending = { design: { accent: "#f00" } } as SiteDocument;
    state.siteDocument = baseline;
    state.pendingSiteDocument = pending;
    state.siteDirty = true;

    const writeSiteDocument = vi.fn(async () => ({ ok: true as const }));
    // First read = drift check (disk matches baseline); later reads = the
    // post-write refresh, which may fail — the code keeps the written
    // snapshot in that case.
    const readSiteDocument = vi
      .fn()
      .mockImplementationOnce(async () => ({
        ok: true as const,
        site: { ...baseline },
      }))
      .mockResolvedValue({ ok: false as const, site: null });
    const clearDraft = vi.fn(async () => ({ ok: true as const }));
    const onSiteStateChanged = vi.fn();

    const actions = createEditorSiteSaveActions({
      getState: () => state,
      setStatus: vi.fn(),
      onSiteStateChanged,
      zephus: {
        clearDraft,
        writeSiteDocument,
        readSiteDocument,
      },
    });

    const pendingPromise = actions.persistPendingSiteDocument();
    // Newer edits arrive while the write is in flight.
    state.siteRevision += 1;
    state.pendingSiteDocument = { design: { accent: "#0f0" } } as SiteDocument;

    expect(await pendingPromise).toBe(true);
    expect(state.siteDirty).toBe(true);
    expect(onSiteStateChanged).toHaveBeenCalled();
    // The draft must NOT be cleared for the newer edits.
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it("warns when the recovery draft cannot be cleared on discard", async () => {
    const state = createEditorSession();
    state.project = {
      path: "/proj",
      name: "P",
      astro: { pagesDir: "src/pages" },
    } as ProjectOpenResult;
    state.siteDirty = true;
    state.pendingSiteDocument = { design: {} } as SiteDocument;

    const setStatus = vi.fn();
    const actions = createEditorSiteSaveActions({
      getState: () => state,
      setStatus,
      onSiteStateChanged: vi.fn(),
      zephus: {
        clearDraft: vi.fn(async () => ({
          ok: false as const,
          error: "disk unwritable",
        })),
        writeSiteDocument: vi.fn(),
        readSiteDocument: vi.fn(),
      },
    });

    await actions.discardPendingSiteChanges();
    expect(setStatus).toHaveBeenCalledWith(
      expect.stringContaining("disk unwritable"),
    );
    expect(state.siteDirty).toBe(false);
  });

  it("warns when clearDraft throws during discard", async () => {
    const state = createEditorSession();
    state.project = {
      path: "/proj",
      name: "P",
      astro: { pagesDir: "src/pages" },
    } as ProjectOpenResult;
    state.siteDirty = true;
    state.pendingSiteDocument = { design: {} } as SiteDocument;

    const setStatus = vi.fn();
    const actions = createEditorSiteSaveActions({
      getState: () => state,
      setStatus,
      onSiteStateChanged: vi.fn(),
      zephus: {
        clearDraft: vi.fn(async () => {
          throw new Error("ipc exploded");
        }),
        writeSiteDocument: vi.fn(),
        readSiteDocument: vi.fn(),
      },
    });

    await actions.discardPendingSiteChanges();
    expect(setStatus).toHaveBeenCalledWith(
      expect.stringContaining("ipc exploded"),
    );
  });

  it("leaves a newer edit untouched when it lands mid-discard", async () => {
    const state = createEditorSession();
    state.project = {
      path: "/proj",
      name: "P",
      astro: { pagesDir: "src/pages" },
    } as ProjectOpenResult;
    state.siteDirty = true;
    state.pendingSiteDocument = { design: { accent: "#f00" } } as SiteDocument;

    const actions = createEditorSiteSaveActions({
      getState: () => state,
      setStatus: vi.fn(),
      onSiteStateChanged: vi.fn(),
      zephus: {
        clearDraft: vi.fn(async () => {
          // A newer site edit lands while the clear is in flight.
          state.pendingSiteDocument = {
            design: { accent: "#0f0" },
          } as SiteDocument;
          state.siteRevision += 1;
          return { ok: true as const };
        }),
        writeSiteDocument: vi.fn(),
        readSiteDocument: vi.fn(),
      },
    });

    await actions.discardPendingSiteChanges();
    expect(state.siteDirty).toBe(true);
    expect(state.pendingSiteDocument?.design?.accent).toBe("#0f0");
  });

  it("warns when the recovery draft cannot be cleared after a save", async () => {
    const state = createEditorSession();
    state.project = {
      path: "/proj",
      name: "P",
      astro: { pagesDir: "src/pages" },
    } as ProjectOpenResult;
    state.siteDirty = true;
    state.pendingSiteDocument = { design: { accent: "#f00" } } as SiteDocument;
    state.siteDocument = { design: { accent: "#000" } } as SiteDocument;

    const setStatus = vi.fn();
    const actions = createEditorSiteSaveActions({
      getState: () => state,
      setStatus,
      onSiteStateChanged: vi.fn(),
      zephus: {
        clearDraft: vi.fn(async () => ({
          ok: false as const,
          error: "locked file",
        })),
        writeSiteDocument: vi.fn(async () => ({ ok: true as const })),
        readSiteDocument: vi
          .fn()
          .mockResolvedValueOnce({
            ok: true as const,
            site: { design: { accent: "#000" } } as SiteDocument,
          })
          .mockResolvedValue({
            ok: true as const,
            site: { design: { accent: "#f00" } } as SiteDocument,
          }),
      },
    });

    expect(await actions.persistPendingSiteDocument()).toBe(true);
    expect(setStatus).toHaveBeenCalledWith(
      expect.stringContaining("locked file"),
    );
  });

  it("keeps newer site edits dirty and warns when the draft clear fails", async () => {
    const state = createEditorSession();
    state.project = {
      path: "/proj",
      name: "P",
      astro: { pagesDir: "src/pages" },
    } as ProjectOpenResult;
    state.pendingSiteDocument = { design: { accent: "#f00" } } as SiteDocument;
    state.siteDocument = { design: { accent: "#000" } } as SiteDocument;
    state.siteDirty = true;

    const writeSiteDocument = vi.fn(async () => ({ ok: true as const }));
    const clearDraft = vi.fn(async () => {
      // A newer edit lands while the draft clear is in flight — between the
      // two hasNewerEdits checks, so the warning path is taken.
      state.pendingSiteDocument = {
        design: { accent: "#0f0" },
      } as SiteDocument;
      state.siteRevision += 1;
      return { ok: false as const, error: "still dirty draft" };
    });
    const setStatus = vi.fn();
    const actions = createEditorSiteSaveActions({
      getState: () => state,
      setStatus,
      onSiteStateChanged: vi.fn(),
      zephus: {
        clearDraft,
        writeSiteDocument,
        readSiteDocument: vi
          .fn()
          .mockResolvedValueOnce({
            ok: true as const,
            site: { design: { accent: "#000" } } as SiteDocument,
          })
          .mockResolvedValue({
            ok: true as const,
            site: { design: { accent: "#f00" } } as SiteDocument,
          }),
      },
    });

    expect(await actions.persistPendingSiteDocument()).toBe(true);
    // The newer edit stays dirty and the failed draft clear is surfaced.
    expect(state.siteDirty).toBe(true);
    expect(state.pendingSiteDocument?.design?.accent).toBe("#0f0");
    expect(setStatus).toHaveBeenCalledWith(
      expect.stringContaining("still dirty draft"),
    );
  });
});
