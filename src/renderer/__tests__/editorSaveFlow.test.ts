import { describe, it, expect, vi } from "vitest";
import {
  clearPageChanges,
  clearSiteChanges,
  createEditorSession,
  markPageDirty,
  markSiteDirty,
} from "../editorSession";
import { createEditorSaveActions } from "../editorSave";

function pageResult(
  overrides: Partial<PageDocumentResult> = {},
): PageDocumentResult {
  return {
    ok: true,
    site: { shell: {} } as SiteDocument,
    pageDocument: {
      page: "index.astro",
      slug: "index",
      route: "/",
      title: "Home",
      navLabel: "Home",
      sections: [],
    } as unknown as PageDocument,
    source: "<h1>gen</h1>",
    generatedSource: "<h1>gen</h1>",
    ...overrides,
  };
}

function makeState(
  overrides: Partial<ReturnType<typeof createEditorSession>> = {},
) {
  const state = createEditorSession();
  state.project = {
    path: "/proj",
    name: "P",
    astro: { pagesDir: "src/pages" },
  } as ProjectOpenResult;
  state.page = "index.astro";
  state.pageDirty = true;
  state.pageDocument = { sections: [] } as unknown as PageDocument;
  state.siteDocument = { shell: {} } as SiteDocument;
  return Object.assign(state, overrides);
}

function makeDeps(
  state: ReturnType<typeof createEditorSession>,
  mocks: Record<string, unknown> = {},
) {
  const writePageDocument = vi.fn(async () => pageResult());
  const detachPageDocument = vi.fn(async () => pageResult());
  const clearDraft = vi.fn(
    async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true }),
  );
  // Wire the real session helpers so dirty state actually flips, while
  // keeping spies for call assertions.
  const persistPendingSiteDocument = vi.fn(async () => {
    markSiteDirty(state, false);
    clearSiteChanges(state);
    state.pendingSiteDocument = null;
    return true;
  });
  const deps = {
    getState: () => state,
    setStatus: vi.fn(),
    getCode: () => state.rawCode,
    setCode: vi.fn(),
    serializeBlocks: () => "<h1>visual</h1>",
    pageDocumentFromState: () => state.pageDocument,
    syncVisualModeState: vi.fn(),
    sectionsFromPageDocument: vi.fn(() => []),
    syncBlocksFromSections: vi.fn(),
    clearChanges: vi.fn(() => {
      clearPageChanges(state);
    }),
    markDirty: vi.fn((dirty: boolean) => {
      markPageDirty(state, dirty);
    }),
    scheduleDraftWrite: vi.fn(),
    renderDirtyIndicators: vi.fn(),
    reloadPages: vi.fn(async () => undefined),
    persistPendingSiteDocument,
    afterSave: vi.fn(),
    zephus: { writePageDocument, detachPageDocument, clearDraft },
    ...mocks,
  };
  return {
    deps,
    writePageDocument,
    detachPageDocument,
    clearDraft,
    persistPendingSiteDocument,
  };
}

describe("editorSave runSave", () => {
  it("saves a dirty visual page and clears the draft", async () => {
    const state = makeState();
    const { deps, writePageDocument, clearDraft } = makeDeps(state);
    const { performSave } = createEditorSaveActions(deps);

    expect(await performSave()).toBe(true);

    expect(writePageDocument).toHaveBeenCalledTimes(1);
    expect(clearDraft).toHaveBeenCalledWith("/proj", "page", "index.astro");
    expect(state.pageDirty).toBe(false);
    expect(deps.clearChanges).toHaveBeenCalled();
    expect(deps.renderDirtyIndicators).toHaveBeenCalled();
    expect(deps.setStatus).toHaveBeenCalledWith("Saved index.astro");
  });

  it("reports nothing to save when the session is clean", async () => {
    const state = makeState({ pageDirty: false, siteDirty: false });
    const { deps, writePageDocument } = makeDeps(state);
    const { performSave } = createEditorSaveActions(deps);

    expect(await performSave()).toBe(true);
    expect(writePageDocument).not.toHaveBeenCalled();
    expect(deps.setStatus).toHaveBeenCalledWith("Nothing to save.");
  });

  it("handles a missing project", async () => {
    const state = makeState();
    state.project = null;
    const { deps, writePageDocument } = makeDeps(state);
    const { performSave } = createEditorSaveActions(deps);

    expect(await performSave()).toBe(false);
    expect(writePageDocument).not.toHaveBeenCalled();
    expect(deps.setStatus).toHaveBeenCalledWith("No project open to save.");
  });

  it("surfaces a failed page write", async () => {
    const state = makeState();
    const { deps, writePageDocument } = makeDeps(state);
    writePageDocument.mockResolvedValueOnce(
      pageResult({ ok: false, error: "disk full" }),
    );
    const { performSave } = createEditorSaveActions(deps);

    expect(await performSave()).toBe(false);
    expect(deps.setStatus).toHaveBeenCalledWith("Save failed: disk full");
  });

  it("keeps newer edits dirty when they arrive mid-save", async () => {
    const state = makeState();
    const { deps, clearDraft } = makeDeps(state);
    // Hold the draft-clear open: edits that land between the write and the
    // cleanup must re-mark the session dirty after it was cleared.
    let resolveClear: (value: { ok: boolean; error?: string }) => void;
    clearDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveClear = resolve;
        }),
    );
    const { performSave } = createEditorSaveActions(deps);

    const pending = performSave();
    // Wait until the save reaches the (held-open) draft clear.
    await vi.waitFor(() => {
      expect(resolveClear).toBeTypeOf("function");
    });
    // User edits while the save's cleanup is still in flight.
    state.pageRevision += 1;
    resolveClear!({ ok: true });
    await pending;

    // The session was never marked clean, so the newer edits remain dirty
    // and the status says so.
    expect(state.pageDirty).toBe(true);
    expect(deps.markDirty).not.toHaveBeenCalledWith(false);
    expect(deps.setStatus).toHaveBeenCalledWith(
      expect.stringContaining("Newer page edits remain unsaved."),
    );
    // The dirty session also re-arms the crash-recovery draft.
    expect(deps.scheduleDraftWrite).toHaveBeenCalled();
  });

  it("stops cleanly when the open page changed mid-write", async () => {
    const state = makeState();
    const { deps, writePageDocument } = makeDeps(state);
    let resolveWrite: (value: PageDocumentResult) => void;
    writePageDocument.mockReturnValueOnce(
      new Promise<PageDocumentResult>((resolve) => {
        resolveWrite = resolve;
      }),
    );
    const { performSave } = createEditorSaveActions(deps);

    const pending = performSave();
    state.page = "about.astro";
    resolveWrite!(pageResult());
    await pending;

    expect(deps.setStatus).toHaveBeenCalledWith(
      "Saved index.astro; the open page changed.",
    );
  });

  it("detaches in code mode when the code differs from the visual model", async () => {
    const state = makeState({ mode: "code", managedStatus: "managed" });
    state.rawCode = "<p>hand written</p>";
    const { deps, detachPageDocument, writePageDocument } = makeDeps(state);
    const { performSave } = createEditorSaveActions(deps);

    await performSave();

    expect(detachPageDocument).toHaveBeenCalledWith(
      "/proj",
      "index.astro",
      "src/pages",
      "<p>hand written</p>",
    );
    expect(writePageDocument).not.toHaveBeenCalled();
    expect(state.visualEditable).toBe(false);
    expect(state.rawCode).toBe("<p>hand written</p>");
  });

  it("detaches in code mode for already-detached or out-of-sync pages", async () => {
    const state = makeState({
      mode: "code",
      managedStatus: "detached",
      rawCode: "<p>detached</p>",
    });
    const { deps, detachPageDocument } = makeDeps(state);
    const { performSave } = createEditorSaveActions(deps);

    await performSave();
    expect(detachPageDocument).toHaveBeenCalled();
  });

  it("writes the visual document from code mode when code matches", async () => {
    const state = makeState({ mode: "code", managedStatus: "managed" });
    state.rawCode = "<h1>visual</h1>";
    const { deps, writePageDocument, detachPageDocument } = makeDeps(state);
    const { performSave } = createEditorSaveActions(deps);

    await performSave();

    expect(writePageDocument).toHaveBeenCalledTimes(1);
    expect(detachPageDocument).not.toHaveBeenCalled();
    expect(state.visualEditable).toBe(true);
  });

  it("saves site settings when the site is dirty", async () => {
    const state = makeState({ siteDirty: true });
    const { deps, persistPendingSiteDocument } = makeDeps(state);
    const { performSave } = createEditorSaveActions(deps);

    await performSave();

    expect(persistPendingSiteDocument).toHaveBeenCalled();
    expect(deps.setStatus).toHaveBeenCalledWith(
      "Saved index.astro and site settings.",
    );
  });

  it("reports a draft-clear failure without failing the save", async () => {
    const state = makeState();
    const { deps, clearDraft } = makeDeps(state);
    clearDraft.mockResolvedValueOnce({ ok: false as const, error: "locked" });
    const { performSave } = createEditorSaveActions(deps);

    expect(await performSave()).toBe(true);
    expect(deps.setStatus).toHaveBeenCalledWith(
      "Saved index.astro, but its recovery draft could not be cleared: locked.",
    );
  });

  it("re-schedules a draft write when still dirty after a failed save", async () => {
    const state = makeState();
    const { deps, writePageDocument } = makeDeps(state);
    writePageDocument.mockResolvedValueOnce(
      pageResult({ ok: false, error: "boom" }),
    );
    const { performSave } = createEditorSaveActions(deps);

    expect(await performSave()).toBe(false);
    // The failed save left the session dirty, so the draft safety net must
    // be re-armed for the newer edits.
    expect(deps.scheduleDraftWrite).toHaveBeenCalled();
  });

  it("does not schedule a draft write after a clean save", async () => {
    const state = makeState();
    const { deps } = makeDeps(state);
    const { performSave } = createEditorSaveActions(deps);

    await performSave();
    expect(deps.scheduleDraftWrite).not.toHaveBeenCalled();
  });
});

describe("editorSave trailing save", () => {
  it("flushes newer edits when Ctrl+S is pressed during a save", async () => {
    const state = makeState();
    const { deps, writePageDocument } = makeDeps(state);
    let resolveFirst: (value: PageDocumentResult) => void;
    writePageDocument.mockImplementationOnce(
      () =>
        new Promise<PageDocumentResult>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { performSave } = createEditorSaveActions(deps);

    const first = performSave();
    const second = performSave();
    // Newer edits arrive while the first write is in flight.
    state.pageRevision += 1;
    resolveFirst!(pageResult());
    await first;
    await second;

    // The trailing request flushed the newer edits with a second write.
    expect(writePageDocument).toHaveBeenCalledTimes(2);
  });
});
