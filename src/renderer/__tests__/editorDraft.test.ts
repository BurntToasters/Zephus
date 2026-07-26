/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEditorSession } from "../editorSession";
import {
  cancelScheduledEditorDraftWrite,
  DRAFT_WRITE_DEBOUNCE_MS,
  scheduleEditorDraftWrite,
  SITE_DRAFT_TARGET,
} from "../editorDraft";

describe("editorDraft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes page and site drafts after debounce when dirty", async () => {
    const state = createEditorSession();
    state.project = { path: "/proj", name: "P" } as ProjectOpenResult;
    state.page = "index.astro";
    state.pageDirty = true;
    state.siteDirty = true;
    state.siteDocument = { design: {} } as SiteDocument;

    const writeDraft = vi.fn(async () => ({ ok: true as const }));
    scheduleEditorDraftWrite(state, {
      writeDraft,
      pageDraftContent: () => "<p>page</p>",
      siteDraftContent: () => '{"design":{}}',
    });

    expect(writeDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DEBOUNCE_MS);

    expect(writeDraft).toHaveBeenCalledWith(
      "/proj",
      "page",
      "index.astro",
      "<p>page</p>",
    );
    expect(writeDraft).toHaveBeenCalledWith(
      "/proj",
      "site",
      SITE_DRAFT_TARGET,
      '{"design":{}}',
    );
    expect(state.draftTimer).toBeNull();
  });

  it("skips writes when nothing is dirty at fire time", async () => {
    const state = createEditorSession();
    state.project = { path: "/proj", name: "P" } as ProjectOpenResult;
    state.pageDirty = true;

    const writeDraft = vi.fn(async () => ({ ok: true as const }));
    scheduleEditorDraftWrite(state, {
      writeDraft,
      pageDraftContent: () => "x",
      siteDraftContent: () => "y",
    });

    state.pageDirty = false;
    state.siteDirty = false;
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DEBOUNCE_MS);

    expect(writeDraft).not.toHaveBeenCalled();
  });

  it("cancels a pending timer", () => {
    const state = createEditorSession();
    state.project = { path: "/proj", name: "P" } as ProjectOpenResult;
    state.pageDirty = true;
    state.page = "index.astro";

    const writeDraft = vi.fn();
    scheduleEditorDraftWrite(state, {
      writeDraft,
      pageDraftContent: () => "x",
      siteDraftContent: () => "y",
    });
    expect(state.draftTimer).not.toBeNull();

    cancelScheduledEditorDraftWrite(state);
    expect(state.draftTimer).toBeNull();
    vi.advanceTimersByTime(DRAFT_WRITE_DEBOUNCE_MS);
    expect(writeDraft).not.toHaveBeenCalled();
  });
});
