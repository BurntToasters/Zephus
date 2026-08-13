// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProjectOpenActions } from "../editorProject";

function makeState() {
  return {
    project: null,
    page: null,
    currentMeta: null,
    siteDocument: null,
    pendingSiteDocument: null,
    pendingSiteEditorKind: null,
    sections: [],
    unsubExternal: null,
    undo: [],
    redo: [],
  } as unknown as import("../editorSession").EditorSessionState;
}

function makeDeps(state: ReturnType<typeof makeState>) {
  const statuses: string[] = [];
  const modals: string[] = [];
  const deps = {
    getState: () => state,
    $: (id: string) => {
      const el = document.getElementById(id);
      if (!el) throw new Error("missing #" + id);
      return el as HTMLElement;
    },
    setStatus: (m: string) => statuses.push(m),
    showModal: (t: string) => modals.push(t),
    closeModal: () => undefined,
    clearAssetCache: () => undefined,
    resetLoadPipeline: () => undefined,
    renderRecent: async () => undefined,
    refreshHomeDraftSummaries: async () => undefined,
    renderPageList: () => undefined,
    renderNavEditor: () => undefined,
    reloadPages: async () => undefined,
    renderDirtyIndicators: () => undefined,
    resetOpenPageState: () => undefined,
    ensureCodeEditor: () => undefined,
    setMode: () => undefined,
    loadPage: async () => undefined,
    applyRepoRules: async () => undefined,
    applyMergedTheme: async () => undefined,
    maybeRestoreSiteDraft: async () => null,
    onExternalChange: async () => undefined,
    editorGitRefresh: async () => undefined,
    editorDraftRestoreRestoreSiteDraft: async () => null,
    bumpSessionGeneration: () => undefined,
    updateWindowTitle: () => undefined,
  } as unknown as Parameters<typeof createProjectOpenActions>[0];
  return { deps, statuses, modals };
}

function mountDom(): void {
  document.body.innerHTML = `
    <div id="view-start"></div>
    <div id="view-editor"></div>
    <div id="project-name"></div>
  `;
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("project open", () => {
  it("reports a failed open and cleans the recent list", async () => {
    mountDom();
    const state = makeState();
    const { deps, modals } = makeDeps(state);
    const removed: string[] = [];
    (window as unknown as { zephus?: unknown }).zephus = {
      openProject: async () => ({ ok: false, error: "gone" }),
      removeRecentProject: async (p: string) => {
        removed.push(p);
        return { ok: true };
      },
      clearDraft: async () => ({ ok: true }),
    };
    const actions = createProjectOpenActions(deps);
    await actions.openProjectByPath("/missing");
    expect(modals).toContain("Could Not Open Project");
    expect(removed).toContain("/missing");
    expect(state.project).toBeNull();
  });

  it("refuses non-Zephus folders", async () => {
    mountDom();
    const state = makeState();
    const { deps, modals } = makeDeps(state);
    (window as unknown as { zephus?: unknown }).zephus = {
      openProject: async () => ({
        ok: true,
        isZephusProject: false,
        path: "/x",
      }),
    };
    const actions = createProjectOpenActions(deps);
    await actions.openProjectByPath("/x");
    expect(modals).toContain("Not a Zephus Site");
    expect(state.project).toBeNull();
  });

  it("rejects a damaged project (missing package.json)", async () => {
    mountDom();
    const state = makeState();
    const { deps, modals } = makeDeps(state);
    (window as unknown as { zephus?: unknown }).zephus = {
      openProject: async () => ({
        ok: true,
        isZephusProject: true,
        path: "/x",
        pkg: { ready: false },
        astro: { pagesDir: "src/pages" },
      }),
      renderRecent: undefined,
    };
    const actions = createProjectOpenActions(deps);
    await actions.openProjectByPath("/x");
    expect(modals).toContain("Project Appears Damaged");
    expect(state.project).toBeNull();
  });

  it("queues an open while another is in flight, then honors it", async () => {
    mountDom();
    const state = makeState();
    const { deps } = makeDeps(state);
    let firstResolve!: (v: unknown) => void;
    const opened: string[] = [];
    (window as unknown as { zephus?: unknown }).zephus = {
      openProject: async (p: string) => {
        opened.push(p);
        if (p === "/a") {
          return new Promise((r) => {
            firstResolve = r;
          });
        }
        return {
          ok: true,
          isZephusProject: true,
          path: p,
          pkg: { ready: true },
          isGitRepo: true,
          astro: { pagesDir: "src/pages" },
          schema: { integrity: "full" },
          name: p,
          pages: [],
        };
      },
      ensureVisualSchema: async () => ({
        ok: true,
        status: { integrity: "full" },
      }),
      readSiteDocument: async () => ({ ok: true, site: null }),
      onExternalChange: () => () => undefined,
    };
    const actions = createProjectOpenActions(deps);
    const first = actions.openProjectByPath("/a");
    void actions.openProjectByPath("/b"); // queued
    firstResolve({
      ok: true,
      isZephusProject: true,
      path: "/a",
      pkg: { ready: true },
      isGitRepo: true,
      astro: { pagesDir: "src/pages" },
      schema: { integrity: "full" },
      name: "/a",
      pages: [],
    });
    await first;
    await new Promise((r) => setTimeout(r, 10));
    expect(opened).toContain("/a");
    expect(opened).toContain("/b");
  });
});
