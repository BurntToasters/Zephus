// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createNextActionsRenderer } from "../editorNextActions";

interface Card {
  title: string;
  body: string;
  actions: Array<{ label: string; onClick: () => void }>;
}

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    project: { path: "/p", astro: { pagesDir: "src/pages" } },
    page: "src/pages/index.astro",
    sections: [],
    blocks: [
      { id: "h1a", type: "heading", props: { level: "1" } },
      { id: "h1b", type: "heading", props: { level: "1" } },
    ],
    pageMeta: [],
    currentMeta: {
      slug: "index",
      publishDate: "",
      noindex: false,
    },
    siteDocument: { siteUrl: "" },
    pendingSiteDocument: null,
    pageDirty: false,
    siteDirty: false,
    selectedId: null,
    selectedSectionId: null,
    ...overrides,
  } as unknown as import("../editorSession").EditorSessionState;
}

function makeDeps(state: ReturnType<typeof makeState>) {
  const cards: Card[] = [];
  let visible = false;
  const statuses: string[] = [];
  const deps = {
    getState: () => state,
    setStatus: (m: string) => statuses.push(m),
    updateNextActions: (v: boolean, c: Card[]) => {
      visible = v;
      cards.splice(0, cards.length, ...c);
    },
    openPageMetaModal: vi.fn(async () => undefined),
    openSiteShellModal: vi.fn(async () => undefined),
    createNotFoundPage: vi.fn(async () => undefined),
    newPageFlow: vi.fn(async () => undefined),
    addImageBlockWithAssetFlow: vi.fn(async () => undefined),
    addSectionAt: vi.fn(),
    chooseAssetForImage: vi.fn(async () => undefined),
    regenerateNav: vi.fn(async () => undefined),
    performSave: vi.fn(async () => true),
    discardPendingSiteChanges: vi.fn(async () => undefined),
    clearChanges: vi.fn(),
    markDirty: vi.fn(),
    renderDirtyIndicators: vi.fn(),
    renderLayers: vi.fn(),
    renderCanvas: vi.fn(),
    renderProperties: vi.fn(),
    loadPage: vi.fn(async () => undefined),
    findBlockLocation: vi.fn(() => null),
    isValidDateString: (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v),
    visibleNavCount: () => 0,
    templateAllowed: () => true,
  } as unknown as Parameters<typeof createNextActionsRenderer>[0];
  return { deps, cards, getVisible: () => visible, statuses };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("next actions guidance", () => {
  it("hides the panel without a project", () => {
    const state = makeState({ project: null });
    const { deps, getVisible, cards } = makeDeps(state);
    createNextActionsRenderer(deps).renderNextActions();
    expect(getVisible()).toBe(false);
    expect(cards).toHaveLength(0);
  });

  it("offers save-all when the session is dirty", () => {
    const state = makeState({ pageDirty: true });
    const { deps, cards } = makeDeps(state);
    createNextActionsRenderer(deps).renderNextActions();
    const saveAll = cards.find((c) => c.title === "Unsaved work pending");
    expect(saveAll).toBeDefined();
    expect(saveAll!.actions.some((a) => a.label === "Save All")).toBe(true);
  });

  it("recommends a site URL when none is set", () => {
    const state = makeState({ siteDocument: { siteUrl: "" } });
    const { deps, cards } = makeDeps(state);
    createNextActionsRenderer(deps).renderNextActions();
    expect(cards.some((c) => c.title === "Set your site address")).toBe(true);
  });

  it("recommends a 404 page when missing", () => {
    const state = makeState({
      pageMeta: [{ slug: "index", page: "index", navVisible: true }],
    });
    const { deps, cards } = makeDeps(state);
    createNextActionsRenderer(deps).renderNextActions();
    expect(cards.some((c) => c.title === "Add a 404 page")).toBe(true);
  });

  it("flags multiple H1 headings", () => {
    const state = makeState();
    const { deps, cards } = makeDeps(state);
    createNextActionsRenderer(deps).renderNextActions();
    expect(cards.some((c) => c.title === "Multiple H1 headings detected")).toBe(
      true,
    );
  });

  it("flags an invalid publish date", () => {
    const state = makeState({
      currentMeta: { slug: "post", publishDate: "not-a-date", noindex: false },
    });
    const { deps, cards } = makeDeps(state);
    createNextActionsRenderer(deps).renderNextActions();
    expect(cards.some((c) => c.title === "Fix the publish date")).toBe(true);
  });

  it("fixes the second H1 via the guidance card action", () => {
    const state = makeState();
    state.selectedId = null;
    state.selectedSectionId = null;
    const { deps, cards } = makeDeps(state);
    (deps.findBlockLocation as ReturnType<typeof vi.fn>).mockReturnValue({
      section: { id: "a" },
      blockIndex: 1,
    });
    createNextActionsRenderer(deps).renderNextActions();
    const card = cards.find(
      (c) => c.title === "Multiple H1 headings detected",
    )!;
    card.actions.find((a) => a.label === "Fix Heading")!.onClick();
    expect(state.selectedId).toBe("h1b");
    expect(state.selectedSectionId).toBe("a");
  });

  it("creates the 404 page from the guidance card", () => {
    const state = makeState({
      pageMeta: [{ slug: "index", page: "index", navVisible: true }],
    });
    const { deps, cards } = makeDeps(state);
    createNextActionsRenderer(deps).renderNextActions();
    const card = cards.find((c) => c.title === "Add a 404 page")!;
    card.actions.find((a) => a.label === "Create 404 Page")!.onClick();
    expect(deps.createNotFoundPage).toHaveBeenCalled();
  });

  it("opens the site shell from the site-URL card", () => {
    const state = makeState({ siteDocument: { siteUrl: "" } });
    const { deps, cards } = makeDeps(state);
    createNextActionsRenderer(deps).renderNextActions();
    const card = cards.find((c) => c.title === "Set your site address")!;
    card.actions.find((a) => a.label === "Open Site Shell")!.onClick();
    expect(deps.openSiteShellModal).toHaveBeenCalled();
  });

  it("discards the site changes from the dirty card", () => {
    const state = makeState({ siteDirty: true });
    const { deps, cards } = makeDeps(state);
    createNextActionsRenderer(deps).renderNextActions();
    const card = cards.find((c) => c.title === "Unsaved work pending")!;
    card.actions.find((a) => a.label === "Discard Site")!.onClick();
    expect(deps.discardPendingSiteChanges).toHaveBeenCalled();
  });

  it("does not flag a valid publish date", () => {
    const state = makeState({
      currentMeta: { slug: "post", publishDate: "2026-01-15", noindex: false },
    });
    const { deps, cards } = makeDeps(state);
    createNextActionsRenderer(deps).renderNextActions();
    expect(cards.some((c) => c.title === "Fix the publish date")).toBe(false);
  });
});
