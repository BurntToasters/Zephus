// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSiteEditorActions } from "../editorSiteEditor";

let shellProps: Record<string, unknown> | null = null;
let designProps: Record<string, unknown> | null = null;
let modalActions: Array<{ label: string; kind?: string; onClick: () => void }> =
  [];

vi.mock("../DesignSystemModal", () => ({
  googleFontForStack: () => null,
  renderDesignSystemModalBody: (
    _wrap: HTMLElement,
    props: Record<string, unknown>,
  ) => {
    designProps = props;
    return () => undefined;
  },
}));
vi.mock("../MiscModals", () => ({
  renderSiteShellModalBody: (
    _wrap: HTMLElement,
    props: Record<string, unknown>,
  ) => {
    shellProps = props;
    return () => undefined;
  },
}));

function makeSite() {
  return {
    siteUrl: "",
    language: "en",
    faviconPath: "",
    siteName: "My Site",
    shell: {
      siteTitle: "My Site",
      logoText: "",
      announcementText: "",
      announcementVisible: false,
      navCtaLabel: "",
      navCtaHref: "",
      footerHtml: "",
      customHeadHtml: "",
      layoutMode: "managed",
    },
    design: {
      accent: "#7c3aed",
      background: "#fff",
      foreground: "#111",
      surface: "#fafafa",
      fontFamily: "system-ui",
      headingFontFamily: "system-ui",
      radius: "12px",
      containerWidth: "960px",
      shadow: "md",
      fontImportUrl: "",
    },
  };
}

function makeDeps() {
  const statuses: string[] = [];
  const state = {
    project: { path: "/p", astro: { pagesDir: "src/pages" } },
    siteDocument: makeSite(),
    pendingSiteDocument: null,
  } as never;
  const deps = {
    getState: () => state,
    setStatus: (m: string) => statuses.push(m),
    closeModal: () => undefined,
    showModalNode: (
      _t: string,
      _c: HTMLElement,
      actions: Array<{ label: string; kind?: string; onClick: () => void }>,
    ) => {
      modalActions = actions;
    },
    registerCleanup: () => undefined,
    modalController: { confirmDestructive: vi.fn(async () => true) },
    resolveSiteEditorConflict: vi.fn(async () => true),
    writeSiteDocumentFromRenderer: vi.fn(async () => undefined),
    openLinkPicker: vi.fn(),
    openAssetBrowser: vi.fn(),
    buildFontImportUrl: (specs: (string | null)[]) => specs.join("&"),
    googleFontForStack: () => null,
  } as unknown as Parameters<typeof createSiteEditorActions>[0];
  return {
    deps,
    statuses,
    getShellProps: () => shellProps,
    getDesignProps: () => designProps,
    getActions: () => modalActions,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  shellProps = null;
  designProps = null;
  modalActions = [];
});

describe("site editor", () => {
  it("stages the shell with the site URL", async () => {
    const { deps, getShellProps, getActions } = makeDeps();
    const actions = createSiteEditorActions(deps);
    await actions.openSiteShellModal();
    expect(getShellProps()).not.toBeNull();
    (
      getShellProps()! as unknown as {
        onSiteUrlChange: (v: string) => void;
      }
    ).onSiteUrlChange("https://example.com");
    const stage = getActions().find((a) => a.label === "Stage Shell")!;
    await stage.onClick();
    expect(deps.writeSiteDocumentFromRenderer).toHaveBeenCalled();
  });

  it("warns before staging first-time custom HTML", async () => {
    const { deps, getShellProps, getActions } = makeDeps();
    (
      deps.modalController as { confirmDestructive: unknown }
    ).confirmDestructive = vi.fn(async () => false);
    const actions = createSiteEditorActions(deps);
    await actions.openSiteShellModal();
    (
      getShellProps()! as unknown as {
        onFooterHtmlChange: (v: string) => void;
      }
    ).onFooterHtmlChange("<script>alert(1)</script>");
    const stage = getActions().find((a) => a.label === "Stage Shell")!;
    await stage.onClick();
    // Declined: nothing staged.
    expect(deps.writeSiteDocumentFromRenderer).not.toHaveBeenCalled();
  });

  it("rejects a self-referencing accent color in the design editor", async () => {
    const { deps, getDesignProps, getActions, statuses } = makeDeps();
    const actions = createSiteEditorActions(deps);
    await actions.openDesignSystemModal();
    (
      getDesignProps()! as unknown as {
        onAccentChange: (v: string) => void;
      }
    ).onAccentChange("var(--accent)");
    const stage = getActions().find((a) => a.label === "Stage Design")!;
    await stage.onClick();
    expect(deps.writeSiteDocumentFromRenderer).not.toHaveBeenCalled();
    expect(statuses.join(" ")).toContain("cannot reference itself");
  });

  it("stages the design system with a concrete accent", async () => {
    const { deps, getDesignProps, getActions } = makeDeps();
    const actions = createSiteEditorActions(deps);
    await actions.openDesignSystemModal();
    (
      getDesignProps()! as unknown as {
        onAccentChange: (v: string) => void;
      }
    ).onAccentChange("#ff0000");
    const stage = getActions().find((a) => a.label === "Stage Design")!;
    await stage.onClick();
    expect(deps.writeSiteDocumentFromRenderer).toHaveBeenCalledWith(
      expect.anything(),
      "design",
      expect.any(String),
      expect.any(String),
    );
  });
});
