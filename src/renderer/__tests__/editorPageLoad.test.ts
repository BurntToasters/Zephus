// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPageLoader } from "../editorPageLoad";

function makeState() {
  return {
    project: { path: "/p", astro: { pagesDir: "src/pages" } },
    page: null,
    pageDocument: null,
    sections: [],
    rawCode: "",
    generatedCode: "",
    mode: "visual",
    visualEditable: true,
    managedStatus: "managed",
    frontmatter: "",
    prefix: "",
    suffix: "",
    pageRevision: 0,
    siteRevision: 0,
    pageDirty: false,
    siteDirty: false,
    siteDocument: null,
    undo: [],
    redo: [],
    selectedId: null,
    selectedSectionId: null,
  } as unknown as import("../editorSession").EditorSessionState;
}

function makeDeps(state: import("../editorSession").EditorSessionState) {
  let loadingPage: string | null = null;
  let sessionGeneration = 0;
  const statuses: string[] = [];
  let choice: "keep" | "reload" | null = null;
  const deps = {
    getState: () => state,
    $: (id: string) => {
      const el = document.getElementById(id);
      if (!el) throw new Error("missing #" + id);
      return el as HTMLElement;
    },
    setStatus: (m: string) => statuses.push(m),
    setLoadingPage: (page: string | null) => {
      loadingPage = page;
    },
    getEditorSessionGeneration: () => sessionGeneration,
    maybeResolveUnsavedWork: async () => true,
    editorSaveWaitForIdle: async () => true,
    maybeRestorePageDraft: async () => ({ restored: false }),
    findPageMeta: () => null,
    syncCurrentMeta: () => undefined,
    clearChanges: () => undefined,
    markDirty: () => undefined,
    updateUndoRedoButtons: () => undefined,
    splitManagedPageSource: (raw: string) => ({
      frame: { frontmatter: "", prefix: "", suffix: "" },
      inner: raw,
    }),
    assembleManagedPage: () => "",
    sectionsFromPageDocument: () => [],
    parseSections: () => [],
    blockToHtml: () => "",
    syncBlocksFromSections: () => undefined,
    syncVisualModeState: () => undefined,
    renderLayers: () => undefined,
    renderDirtyIndicators: () => undefined,
    setCode: () => undefined,
    setMode: () => undefined,
    getCode: () => "",
    currentManagedSource: () => "",
    modalController: {
      choose: async () => choice,
    },
    trackChange: () => undefined,
    clearPageDraftAfterReload: async () => undefined,
    renderPageList: () => undefined,
    clearIgnoredExternalChange: () => undefined,
  } as unknown as Parameters<typeof createPageLoader>[0];
  return {
    deps,
    statuses,
    getLoadingPage: () => loadingPage,
    setChoice: (c: "keep" | "reload" | null) => (choice = c),
    bumpSession: () => {
      sessionGeneration += 1;
    },
  };
}

function mountDom(): void {
  document.body.innerHTML = `
    <div id="canvas"></div>
    <div id="code-editor"></div>
    <div id="workspace-left-build"></div>
    <div id="workspace-left-layers"></div>
    <div id="nav-list"></div>
    <div id="page-list"></div>
    <div id="mode-visual"></div>
    <div id="mode-code"></div>
    <div id="btn-save"></div>
    <div id="btn-new-page"></div>
    <div id="btn-find-replace"></div>
    <div id="btn-regen-nav"></div>
    <div id="btn-site-shell"></div>
    <div id="btn-design-system"></div>
    <div id="btn-preview"></div>
    <div id="btn-publish"></div>
    <div id="btn-close"></div>
    <div id="btn-undo"></div>
    <div id="btn-redo"></div>
    <div id="vp-desktop"></div>
    <div id="vp-tablet"></div>
    <div id="vp-mobile"></div>
  `;
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("page loader", () => {
  it("loads a page and clears the loading state", async () => {
    mountDom();
    const state = makeState();
    const { deps, getLoadingPage } = makeDeps(state);
    const loader = createPageLoader(deps);
    const readCalls: string[] = [];
    (window as unknown as { zephus?: unknown }).zephus = {
      readPageDocument: async () => {
        readCalls.push("read");
        return {
          ok: true,
          pageDocument: { managedFileStatus: "managed" },
          source: "<h1>x</h1>",
        };
      },
      watchFile: async () => true,
    };
    await loader.loadPage("src/pages/index.astro");
    expect(readCalls).toHaveLength(1);
    expect(getLoadingPage()).toBeNull();
    expect(state.page).toBe("src/pages/index.astro");
  });

  it("skips loading when the project closes mid-load (generation bump)", async () => {
    mountDom();
    const state = makeState();
    const { deps } = makeDeps(state);
    const loader = createPageLoader(deps);
    let resolveRead!: (v: unknown) => void;
    (window as unknown as { zephus?: unknown }).zephus = {
      readPageDocument: () =>
        new Promise((r) => {
          resolveRead = r;
        }),
      watchFile: async () => true,
    };
    const pending = loader.loadPage("src/pages/index.astro");
    // Let the chain reach the read call.
    await vi.waitFor(() => expect(resolveRead).toBeDefined());
    // Project closes while the read is in flight: the load pipeline is reset,
    // invalidating the in-flight request.
    loader.resetLoadPipeline();
    resolveRead({
      ok: true,
      pageDocument: { managedFileStatus: "managed" },
      source: "<h1>x</h1>",
    });
    await pending;
    expect(state.page).toBeNull();
  });

  it("reloads the page when the user picks Reload on an external change", async () => {
    mountDom();
    const state = makeState();
    state.page = "src/pages/index.astro";
    state.rawCode = "<h1>old</h1>";
    const { deps, setChoice } = makeDeps(state);
    setChoice("reload");
    let reads = 0;
    (window as unknown as { zephus?: unknown }).zephus = {
      readFile: async () => ({ ok: true, content: "<h1>new</h1>" }),
      readPageDocument: async () => {
        reads += 1;
        return {
          ok: true,
          pageDocument: { managedFileStatus: "managed" },
          source: "<h1>new</h1>",
        };
      },
      watchFile: async () => true,
    };
    const loader = createPageLoader(deps);
    await loader.onExternalChange();
    expect(reads).toBeGreaterThan(0);
    expect(state.page).toBe("src/pages/index.astro");
  });

  it("keeps the in-app version and suppresses the same change again", async () => {
    mountDom();
    const state = makeState();
    state.page = "src/pages/index.astro";
    state.rawCode = "<h1>mine</h1>";
    const { deps, setChoice } = makeDeps(state);
    setChoice("keep");
    let reads = 0;
    (window as unknown as { zephus?: unknown }).zephus = {
      readFile: async () => ({ ok: true, content: "<h1>theirs</h1>" }),
      readPageDocument: async () => {
        reads += 1;
        return { ok: false };
      },
      watchFile: async () => true,
    };
    const loader = createPageLoader(deps);
    await loader.onExternalChange();
    expect(reads).toBe(0);
    // The same disk content must not re-prompt.
    await loader.onExternalChange();
    expect(reads).toBe(0);
  });
});
