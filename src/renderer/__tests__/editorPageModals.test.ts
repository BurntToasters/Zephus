// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPageModalActions } from "../editorPageModals";

let lastActions: Array<{ label: string; kind?: string; onClick: () => void }> =
  [];
let lastProps: PageSettingsProps | null = null;

interface PageSettingsProps {
  slug: string;
  slugDisabled: boolean;
  title: string;
  navVisible: boolean;
  noindex: boolean;
  onTitleChange: (value: string) => void;
  onSlugChange: (value: string) => void;
}

let assetBodyProps: Record<string, unknown> | null = null;

vi.mock("../AssetBrowserModal", () => ({
  AssetBrowserModalEntry: {},
  renderAssetBrowserModalBody: (
    _wrap: HTMLElement,
    props: Record<string, unknown>,
  ): (() => void) => {
    assetBodyProps = props;
    return () => undefined;
  },
}));
vi.mock("../PageModals", () => ({
  renderPageSettingsModal: (
    _wrap: HTMLElement,
    props: PageSettingsProps,
  ): (() => void) => {
    lastProps = props;
    return () => undefined;
  },
}));

function makeDeps() {
  const writes: Array<{ page: string; meta: Record<string, unknown> }> = [];
  const renames: string[] = [];
  const statuses: string[] = [];
  const cleared: string[] = [];
  const project = {
    path: "/proj",
    astro: { pagesDir: "src/pages", publicDir: "public" },
  };
  const state = {
    project,
    page: "src/pages/index.astro",
    pageDocument: { page: "src/pages/index.astro" },
    rawCode: "<h1>x</h1>",
  } as never;

  (window as unknown as { zephus?: unknown }).zephus = {
    readPageMeta: async (_p: string, page: string) => ({
      page,
      slug: page.includes("about") ? "about" : "index",
      route: page.includes("about") ? "/about" : "/",
      title: page.includes("about") ? "About" : "Home",
      navLabel: page.includes("about") ? "About" : "Home",
      metaDescription: "",
      navVisible: true,
      isHome: !page.includes("about"),
      socialImage: "",
      canonicalUrl: "",
      noindex: false,
      publishDate: "",
      author: "",
    }),
    readPageDocument: async () => ({
      ok: true,
      pageDocument: null,
      source: "",
    }),
    renamePage: async (_p: string, _page: string, _d: string, slug: string) => {
      renames.push(slug);
      return { ok: true };
    },
    writePageMeta: async (
      _p: string,
      page: string,
      _d: string,
      meta: Record<string, unknown>,
    ) => {
      writes.push({ page, meta });
      return { ok: true };
    },
    deletePage: async () => ({ ok: true }),
    duplicatePage: async () => ({ ok: true }),
    reattachPageDocument: async () => ({ ok: true }),
    detachPageDocument: async () => ({ ok: true }),
    clearDraft: async (_p: string, _s: string, target: string) => {
      cleared.push(target);
      return { ok: true };
    },
    stopWatch: async () => undefined,
    watchFile: async () => true,
    listAssets: async () => ({ ok: true, assets: [] }),
    importAssets: async () => ({ ok: true, imported: [], errors: [] }),
    importAssetPaths: async () => ({ ok: true, imported: [], errors: [] }),
    findAssetUsage: async () => ({ ok: true, pages: [], siteReferences: [] }),
    renameAsset: async () => ({ ok: true, webPath: "x" }),
    deleteAsset: async () => ({ ok: true }),
    getDroppedFilePath: () => "",
  };

  const deps = {
    getState: () => state,
    setStatus: (m: string) => statuses.push(m),
    closeModal: () => undefined,
    registerCleanup: () => undefined,
    refreshIcons: () => undefined,
    modalController: {
      confirmDestructive: vi.fn(async () => true),
      promptText: vi.fn(async () => null),
    },
    maybeResolveUnsavedWork: vi.fn(async () => true),
    reloadPages: vi.fn(async () => undefined),
    loadPage: vi.fn(async () => undefined),
    getCode: () => "<h1>x</h1>",
    syncCurrentMeta: () => undefined,
    resetOpenPageState: () => undefined,
    normalizePageSlugInput: (input: string) => {
      const slug = input.trim().replace(/[^a-z0-9-_]/g, "-");
      return slug || null;
    },
    isReservedNotFoundSlug: (slug: string) =>
      slug === "404" || slug.startsWith("404/"),
    invalidateAssetCache: () => undefined,
    fetchAssetDataUrl: async () => null,
    reloadSiteDocumentFromDisk: async () => undefined,
    showModalNode: (
      _title: string,
      _content: HTMLElement,
      actions: Array<{ label: string; kind?: string; onClick: () => void }>,
    ) => {
      lastActions = actions;
    },
  } as unknown as Parameters<typeof createPageModalActions>[0];

  return {
    deps,
    writes,
    renames,
    statuses,
    cleared,
    getProps: () => lastProps,
    getActions: () => lastActions,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  lastActions = [];
  lastProps = null;
  assetBodyProps = null;
});

describe("page settings modal", () => {
  it("opens with the current metadata and a disabled slug for the home page", async () => {
    const { deps, getProps } = makeDeps();
    const actions = createPageModalActions(deps);
    void actions;
    await actions.openPageMetaModal("src/pages/index.astro");

    expect(getProps()!.slug).toBe("index");
    expect(getProps()!.slugDisabled).toBe(true);
    expect(getProps()!.title).toBe("Home");
  });

  it("saves metadata and updates the session document", async () => {
    const { deps, writes, getProps, getActions } = makeDeps();
    const actions = createPageModalActions(deps);
    void actions;
    await actions.openPageMetaModal("src/pages/index.astro");

    getProps()!.onTitleChange("New Home");
    const save = getActions().find((a) => a.label === "Save")!;
    await save.onClick();

    expect(writes.length).toBe(1);
    expect(writes[0]!.meta["title"]).toBe("New Home");
  });

  it("renames the page when the slug changes", async () => {
    const { deps, renames, getProps, getActions } = makeDeps();
    const actions = createPageModalActions(deps);
    void actions;
    await actions.openPageMetaModal("src/pages/index.astro");

    const save = getActions().find((a) => a.label === "Save")!;
    await save.onClick();
    expect(renames).toHaveLength(0); // home page slug is locked

    // A non-home page rename derives the new path from slug + extension.
    const actions2 = createPageModalActions({
      ...deps,
      getState: () =>
        ({
          project: {
            path: "/proj",
            astro: { pagesDir: "src/pages", publicDir: "public" },
          },
          page: "src/pages/about.astro",
          pageDocument: { page: "src/pages/about.astro" },
          rawCode: "<h1>about</h1>",
        }) as never,
    });
    await actions2.openPageMetaModal("src/pages/about.astro");
    getProps()!.onSlugChange("team");
    const save2 = getActions().find((a) => a.label === "Save")!;
    await save2.onClick();
    expect(renames).toContain("team");
  });

  it("hides the page from nav when the slug becomes 404", async () => {
    const { deps, getProps, getActions, writes } = makeDeps();
    const actions = createPageModalActions(deps);
    void actions;
    await actions.openPageMetaModal("src/pages/index.astro");

    getProps()!.onSlugChange("404");
    expect(getProps()!.navVisible).toBe(false);
    expect(getProps()!.noindex).toBe(true);

    const save = getActions().find((a) => a.label === "Save")!;
    await save.onClick();
    expect(writes[0]!.meta["navVisible"]).toBe(false);
    expect(writes[0]!.meta["noindex"]).toBe(true);
  });
});

describe("asset browser modal", () => {
  async function openBrowser(
    deps: Parameters<typeof createPageModalActions>[0],
  ) {
    const actions = createPageModalActions(deps);
    const {
      listAssets,
      importAssets,
      importAssetPaths,
      findAssetUsage,
      renameAsset,
      deleteAsset,
      getDroppedFilePath,
      ...rest
    } = (window as unknown as { zephus: Record<string, unknown> })
      .zephus as Record<string, unknown>;
    (window as unknown as { zephus?: unknown }).zephus = {
      ...rest,
      listAssets: async () => ({
        ok: true,
        assets: [
          {
            category: "images",
            fileName: "hero.png",
            webPath: "/hero.png",
            size: 10,
          },
        ],
      }),
      importAssets: async () => ({
        ok: true,
        imported: [{ webPath: "/a.png", category: "images" }],
        errors: [],
      }),
      importAssetPaths: async () => ({ ok: true, imported: [], errors: [] }),
      findAssetUsage: async () => ({ ok: true, pages: [], siteReferences: [] }),
      renameAsset: async () => ({
        ok: true,
        webPath: "/renamed.png",
        updatedReferences: 0,
      }),
      deleteAsset: async () => ({ ok: true }),
      getDroppedFilePath: () => "",
    };
    void listAssets;
    void importAssets;
    void importAssetPaths;
    void findAssetUsage;
    void renameAsset;
    void deleteAsset;
    void getDroppedFilePath;
    await actions.openAssetBrowser({
      filter: "images",
      title: "Asset Browser",
      onSelect: () => undefined,
    });
    await vi.waitFor(() => {
      expect(assetBodyProps).not.toBeNull();
      expect((assetBodyProps?.assets as unknown[] | undefined)?.length).toBe(1);
    });
    return { actions };
  }

  it("renders the asset list after listing", async () => {
    const { deps } = makeDeps();
    await openBrowser(deps);
    expect(assetBodyProps).not.toBeNull();
    expect((assetBodyProps!.assets as unknown[]).length).toBe(1);
  });

  it("refuses to rename while unsaved work is unsettled", async () => {
    const { deps, statuses } = makeDeps();
    // Dirty session + a declined save/discard prompt.
    const stateObj = {
      project: {
        path: "/proj",
        astro: { pagesDir: "src/pages", publicDir: "public" },
      },
      page: "x",
      pageDirty: true,
    };
    const deps2 = {
      ...deps,
      getState: () => stateObj,
      modalController: {
        ...(deps.modalController as object),
        promptText: async () => "renamed",
      },
      maybeResolveUnsavedWork: async () => false,
    } as unknown as Parameters<typeof createPageModalActions>[0];
    const renames: string[] = [];
    (
      window as unknown as { zephus: { renameAsset: unknown } }
    ).zephus.renameAsset = async () => {
      renames.push("x");
      return { ok: true, webPath: "/renamed.png" };
    };
    await openBrowser(deps2);
    await (
      assetBodyProps!.onRename as (asset: {
        fileName: string;
        webPath: string;
      }) => Promise<void>
    )({ fileName: "hero.png", webPath: "/hero.png" });
    await vi.waitFor(() =>
      expect(statuses.join(" ")).toContain("save or discard"),
    );
    expect(renames).toHaveLength(0);
  });

  it("imports dropped files and reports the result", async () => {
    const { deps, statuses } = makeDeps();
    const imported: string[][] = [];
    await openBrowser(deps);
    (
      window as unknown as { zephus: { importAssetPaths: unknown } }
    ).zephus.importAssetPaths = async (
      _p: string,
      _d: string,
      paths: string[],
    ) => {
      imported.push(paths);
      return {
        ok: true,
        imported: paths.map((p) => ({ webPath: p, category: "images" })),
        errors: [],
      };
    };
    (
      window as unknown as { zephus: { getDroppedFilePath: unknown } }
    ).zephus.getDroppedFilePath = (f: { name: string }) => `/drop/${f.name}`;
    await (
      assetBodyProps!.onDropFiles as (
        files: Array<{ name: string }>,
      ) => Promise<void>
    )([{ name: "photo.png" }, { name: "logo.svg" }]);
    await Promise.resolve();
    expect(imported).toHaveLength(1);
    expect(imported[0]!.length).toBe(2);
    expect(statuses.join(" ")).toContain("Imported 2 file(s)");
  });

  it("deletes an asset after confirmation", async () => {
    const { deps, statuses } = makeDeps();
    await openBrowser(deps);
    const deleted: string[] = [];
    (
      window as unknown as { zephus: { deleteAsset: unknown } }
    ).zephus.deleteAsset = async () => {
      deleted.push("x");
      return { ok: true };
    };
    (
      assetBodyProps!.onDelete as (asset: {
        fileName: string;
        webPath: string;
      }) => void
    )({ fileName: "hero.png", webPath: "/hero.png" });
    await vi.waitFor(() => expect(deleted).toHaveLength(1));
    expect(statuses.join(" ")).toContain("Deleted hero.png");
  });

  it("deletes the page after confirmation and reloads the list", async () => {
    const { deps, getActions } = makeDeps();
    const deletedPages: string[] = [];
    (
      window as unknown as { zephus: { deletePage: unknown } }
    ).zephus.deletePage = async (_p: string, page: string) => {
      deletedPages.push(page);
      return { ok: true };
    };
    const actions = createPageModalActions(deps);
    await actions.openPageMetaModal("src/pages/about.astro");
    const del = getActions().find((a) => a.label === "Delete")!;
    await del.onClick();
    expect(deletedPages).toContain("src/pages/about.astro");
    expect(deps.reloadPages).toHaveBeenCalled();
  });

  it("refuses to delete the home page", async () => {
    const { deps, getActions, statuses } = makeDeps();
    const actions = createPageModalActions(deps);
    await actions.openPageMetaModal("src/pages/index.astro");
    const del = getActions().find((a) => a.label === "Delete")!;
    await del.onClick();
    expect(statuses.join(" ")).toContain("Home page cannot be deleted");
  });

  it("detaches a page from visual mode", async () => {
    const { deps, getActions } = makeDeps();
    const detached: string[] = [];
    (
      window as unknown as { zephus: { detachPageDocument: unknown } }
    ).zephus.detachPageDocument = async (
      _p: string,
      _d: string,
      _s: string,
      source: string,
    ) => {
      detached.push(source);
      return { ok: true, pageDocument: { detached: true } };
    };
    const actions = createPageModalActions(deps);
    await actions.openPageMetaModal("src/pages/about.astro");
    const detach = getActions().find((a) => a.label === "Detach Visual")!;
    await detach.onClick();
    expect(detached.length).toBeGreaterThan(0);
  });

  it("duplicates the page and reloads", async () => {
    const { deps, getActions } = makeDeps();
    let duplicated = false;
    (
      window as unknown as { zephus: { duplicatePage: unknown } }
    ).zephus.duplicatePage = async () => {
      duplicated = true;
      return { ok: true };
    };
    const actions = createPageModalActions(deps);
    await actions.openPageMetaModal("src/pages/about.astro");
    const dup = getActions().find((a) => a.label === "Duplicate")!;
    await dup.onClick();
    expect(duplicated).toBe(true);
    expect(deps.reloadPages).toHaveBeenCalled();
  });
});
