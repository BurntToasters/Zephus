/** Site-level editing modals: the Site Shell editor and the Design System editor. */

import { renderDesignSystemModalBody } from "./DesignSystemModal";
import { renderSiteShellModalBody } from "./MiscModals";
import { cloneSiteDocument, effectiveSiteDocument } from "./editorSession";
import type { SiteDocument } from "../main/types";

export interface SiteEditorDeps {
  getState: () => import("./editorSession").EditorSessionState;
  setStatus: (message: string) => void;
  closeModal: () => void;
  showModalNode: (
    title: string,
    content: HTMLElement,
    actions: Array<{
      label: string;
      kind?: "primary" | "danger" | "ghost";
      onClick: () => void;
    }>,
    options?: { size?: "default" | "wide" },
  ) => void;
  registerCleanup: (cleanup: (() => void) | null) => void;
  modalController: {
    confirmDestructive: (
      title: string,
      message: string,
      confirmLabel: string,
    ) => Promise<boolean>;
  };
  resolveSiteEditorConflict: (kind: "shell" | "design") => Promise<boolean>;
  writeSiteDocumentFromRenderer: (
    nextSite: SiteDocument,
    editorKind: "shell" | "design",
    changeLabel: string,
    statusMessage: string,
  ) => Promise<void>;
  openLinkPicker: (current: string, onPick: (href: string) => void) => void;
  openAssetBrowser: (options: {
    filter?: "images" | "media" | "documents" | "other" | "all";
    title?: string;
    onSelect: (webPath: string) => void;
  }) => void;
  buildFontImportUrl: (googleSpecs: (string | null)[]) => string;
  googleFontForStack: (stack: string) => string | null;
}

export function createSiteEditorActions(deps: SiteEditorDeps) {
  const {
    getState,
    setStatus,
    closeModal,
    showModalNode,
    registerCleanup,
    modalController,
    resolveSiteEditorConflict,
    writeSiteDocumentFromRenderer,
    openLinkPicker,
    openAssetBrowser,
    buildFontImportUrl,
  } = deps;

  const state = getState();

  async function openSiteShellModal(): Promise<void> {
    if (!state.project || !effectiveSiteDocument(state)) return;
    if (!(await resolveSiteEditorConflict("shell"))) return;
    const nextSite = cloneSiteDocument(
      effectiveSiteDocument(state),
    ) as SiteDocument;
    const shellState = {
      siteTitle: nextSite.shell.siteTitle,
      siteUrlError: "" as string,
      logoText: nextSite.shell.logoText,
      announcementText: nextSite.shell.announcementText,
      announcementVisible: nextSite.shell.announcementVisible,
      ctaLabel: nextSite.shell.navCtaLabel,
      ctaHref: nextSite.shell.navCtaHref,
      footerHtml: nextSite.shell.footerHtml,
      customHeadHtml: nextSite.shell.customHeadHtml,
      siteUrl: nextSite.siteUrl ?? "",
      language: nextSite.language ?? "en",
      faviconPath: nextSite.faviconPath ?? "",
    };

    const wrap = document.createElement("div");
    let shellModalDispose: (() => void) | null = null;
    const mountShellModal = () => {
      shellModalDispose?.();
      shellModalDispose = renderSiteShellModalBody(wrap, {
        siteTitle: shellState.siteTitle,
        logoText: shellState.logoText,
        announcementText: shellState.announcementText,
        announcementVisible: shellState.announcementVisible,
        ctaLabel: shellState.ctaLabel,
        ctaHref: shellState.ctaHref,
        footerHtml: shellState.footerHtml,
        customHeadHtml: shellState.customHeadHtml,
        onSiteTitleChange: (value) => {
          shellState.siteTitle = value;
        },
        onLogoTextChange: (value) => {
          shellState.logoText = value;
        },
        onAnnouncementTextChange: (value) => {
          shellState.announcementText = value;
        },
        onAnnouncementVisibleChange: (value) => {
          shellState.announcementVisible = value;
        },
        onCtaLabelChange: (value) => {
          shellState.ctaLabel = value;
        },
        onCtaHrefChange: (value) => {
          shellState.ctaHref = value;
        },
        onPickCtaHref: () => {
          openLinkPicker(shellState.ctaHref, (href) => {
            shellState.ctaHref = href;
            mountShellModal();
          });
        },
        onFooterHtmlChange: (value) => {
          shellState.footerHtml = value;
        },
        onCustomHeadHtmlChange: (value) => {
          shellState.customHeadHtml = value;
        },
        siteUrl: shellState.siteUrl,
        siteUrlError: shellState.siteUrlError || undefined,
        language: shellState.language,
        faviconPath: shellState.faviconPath,
        onSiteUrlChange: (value) => {
          shellState.siteUrl = value;
        },
        onLanguageChange: (value) => {
          shellState.language = value;
        },
        onFaviconPathChange: (value) => {
          shellState.faviconPath = value;
        },
        onPickFavicon: () => {
          openAssetBrowser({
            filter: "images",
            title: "Choose Favicon",
            onSelect: (webPath) => {
              shellState.faviconPath = webPath;
              mountShellModal();
            },
          });
        },
      });
      registerCleanup(shellModalDispose);
    };
    mountShellModal();

    showModalNode(
      "Site Shell",
      wrap,
      [
        { label: "Cancel", kind: "ghost", onClick: closeModal },
        {
          label: "Stage Shell",
          kind: "primary",
          onClick: async () => {
            const newFooter = shellState.footerHtml.trim();
            const newHead = shellState.customHeadHtml.trim();
            const hadFooter = Boolean(nextSite.shell.footerHtml.trim());
            const hadHead = Boolean(nextSite.shell.customHeadHtml.trim());
            // Gate: warn user when they first add raw HTML (they might not
            // understand it injects unescaped content into their site).
            if ((newFooter && !hadFooter) || (newHead && !hadHead)) {
              const proceed = await modalController.confirmDestructive(
                "Custom HTML Warning",
                "Footer HTML and Custom head HTML are injected directly into " +
                  "your site without escaping. Only add content you trust " +
                  "(analytics, fonts, embeds). Proceed?",
                "I understand, save it",
              );
              if (!proceed) return;
            }
            nextSite.shell.layoutMode = "managed";
            nextSite.shell.siteTitle =
              shellState.siteTitle.trim() || nextSite.siteName;
            nextSite.shell.logoText =
              shellState.logoText.trim() || nextSite.siteName;
            nextSite.shell.announcementText =
              shellState.announcementText.trim();
            nextSite.shell.announcementVisible = shellState.announcementVisible;
            nextSite.shell.navCtaLabel = shellState.ctaLabel.trim();
            nextSite.shell.navCtaHref = shellState.ctaHref.trim() || "#";
            nextSite.shell.footerHtml = shellState.footerHtml.trim();
            nextSite.shell.customHeadHtml = shellState.customHeadHtml.trim();
            const normalizedSiteUrl = normalizeSiteUrl(shellState.siteUrl);
            if (normalizedSiteUrl === null) {
              // Inline error: the status bar sits UNDER the modal overlay, so
              // the old setStatus failure was completely invisible.
              shellState.siteUrlError =
                "Site URL must be a full http(s) address, for example https://example.com.";
              mountShellModal();
              return;
            }
            nextSite.siteUrl = normalizedSiteUrl;
            nextSite.language = shellState.language.trim() || "en";
            nextSite.faviconPath = shellState.faviconPath.trim();
            closeModal();
            await writeSiteDocumentFromRenderer(
              nextSite,
              "shell",
              "Updated site shell settings",
              "Staged site shell changes. Click Save to write them.",
            );
          },
        },
      ],
      { size: "wide" },
    );
    registerCleanup(shellModalDispose);
  }

  /** Validates the site URL and strips any trailing slash. */
  function normalizeSiteUrl(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const candidate = /^[a-z][\w+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") {
      return null;
    }
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  }

  async function openDesignSystemModal(): Promise<void> {
    if (!state.project || !effectiveSiteDocument(state)) return;
    if (!(await resolveSiteEditorConflict("design"))) return;
    const nextSite = cloneSiteDocument(
      effectiveSiteDocument(state),
    ) as SiteDocument;
    const designState = {
      accent: nextSite.design.accent,
      background: nextSite.design.background,
      foreground: nextSite.design.foreground,
      surface: nextSite.design.surface,
      bodyFont: nextSite.design.fontFamily,
      bodyFontGoogle: deps.googleFontForStack(nextSite.design.fontFamily),
      headingFont: nextSite.design.headingFontFamily,
      headingFontGoogle: deps.googleFontForStack(
        nextSite.design.headingFontFamily,
      ),
      radius: nextSite.design.radius,
      containerWidth: nextSite.design.containerWidth,
      shadow: nextSite.design.shadow,
    };

    const wrap = document.createElement("div");
    renderDesignSystemModalBody(wrap, {
      accent: designState.accent,
      background: designState.background,
      foreground: designState.foreground,
      surface: designState.surface,
      bodyFont: designState.bodyFont,
      headingFont: designState.headingFont,
      radius: designState.radius,
      containerWidth: designState.containerWidth,
      shadow: designState.shadow,
      onAccentChange: (value) => {
        designState.accent = value;
      },
      onBackgroundChange: (value) => {
        designState.background = value;
      },
      onForegroundChange: (value) => {
        designState.foreground = value;
      },
      onSurfaceChange: (value) => {
        designState.surface = value;
      },
      onBodyFontChange: (stack, google) => {
        designState.bodyFont = stack;
        designState.bodyFontGoogle = google;
      },
      onHeadingFontChange: (stack, google) => {
        designState.headingFont = stack;
        designState.headingFontGoogle = google;
      },
      onRadiusChange: (value) => {
        designState.radius = value;
      },
      onContainerWidthChange: (value) => {
        designState.containerWidth = value;
      },
      onShadowChange: (value) => {
        designState.shadow = value;
      },
    });

    showModalNode("Design System", wrap, [
      { label: "Cancel", kind: "ghost", onClick: closeModal },
      {
        label: "Stage Design",
        kind: "primary",
        onClick: async () => {
          // A staged accent must not reference itself: --zephus-accent:
          // var(--accent) resolves to nothing and silently strips the brand
          // color from every link/CTA/announcement.
          if (/var\(\s*--accent\s*\)/i.test(designState.accent.trim())) {
            setStatus(
              "Accent color cannot reference itself (var(--accent)). Pick a concrete color.",
            );
            return;
          }
          nextSite.shell.layoutMode = "managed";
          nextSite.design.accent = designState.accent.trim();
          nextSite.design.background = designState.background.trim();
          nextSite.design.foreground = designState.foreground.trim();
          nextSite.design.surface = designState.surface.trim();
          // Empty custom font stacks silently emitted an invalid CSS variable
          // (every font inherited). Fall back to the existing/current stack.
          const currentFonts = nextSite.design.fontFamily;
          nextSite.design.fontFamily =
            designState.bodyFont.trim() || currentFonts;
          nextSite.design.headingFontFamily =
            designState.headingFont.trim() || currentFonts;
          const googleSpecs = [
            designState.bodyFontGoogle,
            designState.headingFontGoogle,
          ].filter(Boolean) as string[];
          // Staging with zero font changes must PRESERVE the existing Google
          // Fonts link — previously buildFontImportUrl([]) returned "" and the
          // themed site's font link silently vanished from the build.
          nextSite.design.fontImportUrl =
            googleSpecs.length > 0
              ? buildFontImportUrl(googleSpecs)
              : (nextSite.design.fontImportUrl ?? "");
          nextSite.design.radius = designState.radius.trim();
          nextSite.design.containerWidth = designState.containerWidth.trim();
          nextSite.design.shadow = designState.shadow;
          closeModal();
          await writeSiteDocumentFromRenderer(
            nextSite,
            "design",
            "Updated design system settings",
            "Staged design system changes. Click Save to write them.",
          );
        },
      },
    ]);
  }

  return { openSiteShellModal, openDesignSystemModal };
}
