/**
 * Next Actions panel: the guidance cards that tell the user what to do next
 * (missing pages, SEO issues, dirty state, navigation gaps). Extracted from
 * the engine so the guidance logic is unit-testable in isolation.
 */

import { updateNextActions } from "./NextActions";
import { effectiveSiteDocument } from "./editorSession";
import { isBlockTypeAllowed } from "./editorCommands";
import type { EditorSessionState } from "./editorSession";
import { TEMPLATES, type SectionTemplate } from "./editorBlocks";

export interface NextActionsDeps {
  getState: () => EditorSessionState;
  setStatus: (message: string) => void;
  updateNextActions: (
    visible: boolean,
    cards: Array<{
      title: string;
      body: string;
      actions: Array<{ label: string; onClick: () => void }>;
    }>,
  ) => void;
  openPageMetaModal: (page: string) => Promise<void>;
  openSiteShellModal: () => Promise<void>;
  createNotFoundPage: () => Promise<void>;
  newPageFlow: () => Promise<void>;
  addImageBlockWithAssetFlow: () => Promise<void>;
  addSectionAt: (index: number, template?: SectionTemplate) => void;
  chooseAssetForImage: (
    block: import("../main/types").EditorBlock,
  ) => Promise<void>;
  regenerateNav: () => Promise<void>;
  performSave: () => Promise<boolean>;
  discardPendingSiteChanges: () => Promise<void>;
  clearChanges: () => void;
  markDirty: (dirty: boolean) => void;
  renderDirtyIndicators: () => void;
  renderLayers: () => void;
  renderCanvas: () => void;
  renderProperties: () => void;
  loadPage: (
    page: string,
    options?: {
      skipUnsavedGuard?: boolean;
      skipDraftRestore?: boolean;
      restoreDraftSilently?: boolean;
      forceReload?: boolean;
      afterLoad?: () => void | Promise<void>;
    },
  ) => Promise<void>;
  findBlockLocation: (id: string | null) => {
    section: import("../main/types").SectionNode;
    block: import("../main/types").EditorBlock;
    blockIndex: number;
  } | null;
  isValidDateString: (value: string) => boolean;
  visibleNavCount: () => number;
  templateAllowed: (template: SectionTemplate) => boolean;
}

export function createNextActionsRenderer(deps: NextActionsDeps) {
  const {
    getState,
    setStatus,
    updateNextActions,
    openPageMetaModal,
    openSiteShellModal,
    createNotFoundPage,
    newPageFlow,
    addImageBlockWithAssetFlow,
    addSectionAt,
    chooseAssetForImage,
    regenerateNav,
    performSave,
    discardPendingSiteChanges,
    clearChanges,
    markDirty,
    renderDirtyIndicators,
    renderLayers,
    renderCanvas,
    renderProperties,
    loadPage,
    findBlockLocation,
    isValidDateString,
    visibleNavCount,
    templateAllowed,
  } = deps;

  const state = getState();

  function renderNextActions(): void {
    if (!state.project) {
      updateNextActions(false, []);
      return;
    }

    const cards: Array<{
      title: string;
      body: string;
      actions: Array<{ label: string; onClick: () => void }>;
    }> = [];

    if (state.pageMeta.length === 0) {
      cards.push({
        title: "Create your first page",
        body: "New projects feel much less empty once you have a visible route to edit and preview.",
        actions: [{ label: "Create Page", onClick: () => void newPageFlow() }],
      });
    }

    if (state.page && state.sections.length === 0) {
      cards.push({
        title: "Start the page structure",
        body: "Add a section now so the canvas has a real layout to work with.",
        actions: [
          {
            label: "Add Hero",
            onClick: () => {
              const hero = TEMPLATES.find((tpl) => tpl.id === "hero");
              if (!hero || !templateAllowed(hero)) {
                setStatus(
                  "This section's blocks are not allowed by the project's rules.",
                );
                return;
              }
              addSectionAt(state.sections.length, hero);
            },
          },
          {
            label: "Add Blank Section",
            onClick: () => addSectionAt(state.sections.length),
          },
          {
            label: "Open Site Shell",
            onClick: () => void openSiteShellModal(),
          },
        ],
      });
    }

    if (state.page && visibleNavCount() === 0) {
      cards.push({
        title: "No visible navigation items",
        body: "Visitors will not see page links yet. Review the current page metadata or stage a nav set from the shell.",
        actions: [
          {
            label: "Page Settings",
            onClick: () => {
              if (state.page) void openPageMetaModal(state.page);
            },
          },
          { label: "Review Navigation", onClick: () => void regenerateNav() },
        ],
      });
    }

    const imageBlock = state.blocks.find((block) => block.type === "image");
    if (state.page && !imageBlock) {
      cards.push({
        title: "Add visual assets",
        body: "This page has no image blocks yet. Drop in an image and reuse bundled asset import flows.",
        actions: [
          {
            label: "Import Image",
            onClick: () => void addImageBlockWithAssetFlow(),
          },
        ],
      });
    } else if (imageBlock && !(imageBlock.props["src"] ?? "").trim()) {
      cards.push({
        title: "Finish the image block",
        body: "An image block exists but it is still missing a selected asset.",
        actions: [
          {
            label: "Choose Asset",
            onClick: () => void chooseAssetForImage(imageBlock),
          },
        ],
      });
    }

    // Warn when image blocks have a src but are missing alt text.
    const imagesWithNoAlt = state.blocks.filter(
      (block) =>
        block.type === "image" &&
        (block.props["src"] ?? "").trim() !== "" &&
        (block.props["alt"] ?? "").trim() === "",
    );
    if (imagesWithNoAlt.length > 0) {
      const first = imagesWithNoAlt[0]!;
      const count = imagesWithNoAlt.length;
      cards.push({
        title: "Add image alt text",
        body: `${count === 1 ? "One image is" : `${count} images are`} missing alt text. Screen readers need a description to convey the image to users who cannot see it.`,
        actions: [
          {
            label: "Edit Image",
            onClick: () => {
              state.selectedId = first.id;
              const loc = findBlockLocation(first.id);
              if (loc) state.selectedSectionId = loc.section.id;
              renderLayers();
              renderCanvas();
              renderProperties();
            },
          },
        ],
      });
    }

    // SEO 1: Missing Meta Description Warning
    if (
      state.page &&
      state.currentMeta &&
      !(state.currentMeta.metaDescription ?? "").trim()
    ) {
      cards.push({
        title: "Add page meta description",
        body: "This page is missing a meta description. Adding one helps search engines summarize your page and improves click-through rates.",
        actions: [
          {
            label: "Page Settings",
            onClick: () => {
              if (state.page) void openPageMetaModal(state.page);
            },
          },
        ],
      });
    }

    // SEO: no site URL means canonical tags, social previews, and sitemap.xml
    // cannot be generated at all, so it outranks per-page SEO advice.
    const siteForSeo = effectiveSiteDocument(state);
    if (siteForSeo && !siteForSeo.siteUrl.trim()) {
      cards.push({
        title: "Set your site address",
        body: "Without a site URL, Zephus cannot add canonical links, social share previews, or generate sitemap.xml for search engines.",
        actions: [
          {
            label: "Open Site Shell",
            onClick: () => void openSiteShellModal(),
          },
        ],
      });
    }

    // A 404 page is what visitors see after a broken or outdated link; Astro
    // serves src/pages/404.astro automatically once it exists.
    if (
      state.pageMeta.length > 0 &&
      !state.pageMeta.some((entry) => entry.slug === "404")
    ) {
      cards.push({
        title: "Add a 404 page",
        body: "Visitors who follow a broken link currently get your host's default error page. A 404 page keeps them on your site with a way back.",
        actions: [
          {
            label: "Create 404 Page",
            onClick: () => void createNotFoundPage(),
          },
        ],
      });
    }

    // A 404 page is meant to be noindex, so flagging it would be noise.
    if (
      state.page &&
      state.currentMeta?.noindex &&
      state.currentMeta.slug !== "404"
    ) {
      cards.push({
        title: "This page is hidden from search engines",
        body: "It sends a noindex tag and is left out of sitemap.xml. Remove that in Page Settings when the page is ready to be found.",
        actions: [
          {
            label: "Page Settings",
            onClick: () => {
              if (state.page) void openPageMetaModal(state.page);
            },
          },
        ],
      });
    }

    // SEO 2: Multiple H1 Headings Warning
    const h1Blocks = state.blocks.filter(
      (block) => block.type === "heading" && block.props["level"] === "1",
    );
    if (h1Blocks.length > 1) {
      const secondH1 = h1Blocks[1]!;
      cards.push({
        title: "Multiple H1 headings detected",
        body: "SEO best practices recommend using exactly one H1 heading per page to establish a clear hierarchy. Consider changing extra H1s to H2.",
        actions: [
          {
            label: "Fix Heading",
            onClick: () => {
              state.selectedId = secondH1.id;
              const loc = findBlockLocation(secondH1.id);
              if (loc) state.selectedSectionId = loc.section.id;
              renderLayers();
              renderCanvas();
              renderProperties();
            },
          },
        ],
      });
    }

    // A publish date that isn't a real YYYY-MM-DD date keeps the page out of
    // RSS and Post List ordering entirely — surface that instead of letting it
    // fail silently.
    const publishDate = state.currentMeta?.publishDate?.trim() ?? "";
    if (state.page && publishDate && !isValidDateString(publishDate)) {
      cards.push({
        title: "Fix the publish date",
        body: `"${publishDate}" is not a valid YYYY-MM-DD date, so this page is excluded from RSS and post listings. Correct it in Page Settings.`,
        actions: [
          {
            label: "Page Settings",
            onClick: () => {
              if (state.page) void openPageMetaModal(state.page);
            },
          },
        ],
      });
    }

    if (state.siteDirty || state.pageDirty) {
      const actionsList = [
        { label: "Save All", onClick: () => void performSave() },
      ];
      if (state.siteDirty) {
        actionsList.push({
          label: "Discard Site",
          onClick: () => void discardPendingSiteChanges(),
        });
      }
      if (state.pageDirty && state.page) {
        // Page-only dirty had no discard affordance (Save All was the only
        // action); mirror the site discard.
        actionsList.push({
          label: "Discard Page",
          onClick: () => {
            void (async () => {
              const projectPath = state.project?.path;
              const page = state.page;
              if (!projectPath || !page) return;
              const cleared = await window.zephus.clearDraft(
                projectPath,
                "page",
                page,
              );
              void cleared;
              clearChanges();
              markDirty(false);
              renderDirtyIndicators();
              await loadPage(page, {
                skipUnsavedGuard: true,
                skipDraftRestore: true,
                forceReload: true,
              });
              setStatus("Discarded unsaved page changes.");
            })();
          },
        });
      }
      cards.push({
        title: "Unsaved work pending",
        body: "Keep page and site state in sync before you switch context or run a full preview.",
        actions: actionsList,
      });
    }

    updateNextActions(true, cards);
  }

  return { renderNextActions };
}
