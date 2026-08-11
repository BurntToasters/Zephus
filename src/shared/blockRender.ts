/**
 * Shared block + section HTML serialization for build (schema) and editor.
 * Editor passes viewport/forCanvas; build uses defaults (desktop, not canvas).
 */

import {
  addCssValue,
  blockMetadataAttrs,
  classAttr,
  encodeDataPayload,
  escapeAttr,
  escapeHtml,
  plainTextToHtml,
  richTextToHtml,
  renderListItems,
  safeUrl,
  splitLines,
  splitPair,
  styleAttr,
  type BlockMetadataSource,
  type StyleAttrBlock,
  type StyleAttrOptions,
  type StyleViewport,
} from "./renderHelpers";
import type { BlockNode, BlockStyle, SectionNode } from "../main/types";

export interface RenderBlockInput extends Omit<BlockMetadataSource, "style"> {
  raw?: string;
  style?: BlockStyle;
}

/**
 * A page as seen by a Post List block. Built from the same page sidecars in
 * both processes, so the canvas and the build render identical lists.
 */
export interface RenderPostEntry {
  route: string;
  title: string;
  description: string;
  /** `YYYY-MM-DD`, or empty for pages that are not posts. */
  date: string;
  author: string;
  image: string;
}

export interface RenderBlockOptions extends StyleAttrOptions {
  /** Editor caps heading level; build uses 6. */
  maxHeadingLevel?: number;
  sanitizeHtmlForCanvas?: (html: string) => string;
  onUnknownBlockType?: (type: string) => void;
  /** Candidate pages for Post List blocks. */
  posts?: RenderPostEntry[];
}

/** Formats an ISO date for display without pulling in a date library. */
function formatPostDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value.trim();
  const [, year, month, day] = match;
  const monthName = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][Number(month) - 1];
  if (!monthName) return value.trim();
  return `${monthName} ${Number(day)}, ${year}`;
}

/**
 * Selects the pages a Post List block shows: everything under the configured
 * route prefix, newest first, dated posts before undated pages.
 */
export function selectPostEntries(
  props: Record<string, string>,
  posts: RenderPostEntry[],
): RenderPostEntry[] {
  const prefix = (props["folder"] ?? "/posts").trim().replace(/\/+$/, "");
  const limitValue = Number(props["limit"] ?? "5");
  const limit =
    Number.isFinite(limitValue) && limitValue > 0 ? Math.floor(limitValue) : 0;

  const matching = posts.filter((post) => {
    if (!prefix || prefix === "/") return post.route !== "/";
    return post.route === prefix || post.route.startsWith(`${prefix}/`);
  });

  const sorted = [...matching].sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return a.title.localeCompare(b.title);
  });

  return limit > 0 ? sorted.slice(0, limit) : sorted;
}

export interface SectionSerializeSource {
  id: string;
  label?: string;
  props: Record<string, string>;
  style?: StyleAttrBlock["style"];
  locked?: boolean;
}

function structuralCommon(
  block: RenderBlockInput,
  fixedClass: string,
  options: RenderBlockOptions,
): string {
  const userCls = block.props["cls"]
    ? " " + escapeAttr(block.props["cls"])
    : "";
  return `${blockMetadataAttrs(block)} class="${fixedClass}${userCls}"${styleAttr(
    block,
    options,
  )}`;
}

function blockCommon(
  block: RenderBlockInput,
  options: RenderBlockOptions,
): string {
  return `${blockMetadataAttrs(block)}${classAttr(block)}${styleAttr(
    block,
    options,
  )}`;
}

export function sectionWrapperIsNone(props: Record<string, string>): boolean {
  return (props["wrapper"] ?? "none") === "none";
}

export function sectionHasSurface(
  section: Pick<SectionSerializeSource, "style" | "locked" | "props">,
): boolean {
  return (
    Boolean(section.style && Object.keys(section.style).length > 0) ||
    Boolean(section.locked) ||
    Boolean(section.props["cls"])
  );
}

export function shouldUnwrapSectionChildren(
  section: SectionSerializeSource,
): boolean {
  return sectionWrapperIsNone(section.props) && !sectionHasSurface(section);
}

export function renderSectionWrapperOpen(
  section: SectionSerializeSource,
  options: StyleAttrOptions = {},
): string {
  const cls = section.props["cls"]
    ? ` class="${escapeAttr(section.props["cls"])}"`
    : "";
  const metadata = blockMetadataAttrs({
    id: section.id,
    type: "section",
    props: { ...section.props, label: section.label ?? "" },
    style: section.style,
    locked: section.locked,
  });
  const style = styleAttr(
    {
      type: "section",
      props: section.props,
      style: section.style,
    },
    options,
  );
  return `<section${metadata}${cls}${style}>`;
}

export function wrapSectionChildren(
  section: SectionSerializeSource,
  body: string,
  options: StyleAttrOptions = {},
): string {
  if (shouldUnwrapSectionChildren(section)) return body;
  return `${renderSectionWrapperOpen(section, options)}\n${body}\n</section>`;
}

function responsiveCssDeclarations(
  style: BlockStyle | undefined,
): string | null {
  if (!style) return null;
  // !important is REQUIRED: the same properties ship as inline style="" on
  // the element (styleAttr), and inline styles beat every non-!important
  // stylesheet rule — without this, tablet/mobile overrides (and
  // stackOnMobile) never applied in the built site while the canvas showed
  // them.
  const important = (value: string): string => `${value}!important`;
  const css: string[] = [];
  if (["left", "center", "right"].includes(String(style.align))) {
    css.push(important(`text-align:${style.align}`));
  }
  addCssValue(css, "width", style.width ? important(style.width) : undefined);
  addCssValue(
    css,
    "height",
    style.height ? important(style.height) : undefined,
  );
  addCssValue(
    css,
    "max-width",
    style.maxWidth ? important(style.maxWidth) : undefined,
  );
  addCssValue(
    css,
    "padding",
    style.padding ? important(style.padding) : undefined,
  );
  addCssValue(
    css,
    "margin",
    style.margin ? important(style.margin) : undefined,
  );
  addCssValue(css, "gap", style.gap ? important(style.gap) : undefined);
  if (style.columns) {
    css.push(
      important(
        `grid-template-columns:repeat(${Math.max(1, Number(style.columns) || 1)}, minmax(0, 1fr))`,
      ),
    );
  }
  return css.length ? css.join(";") : null;
}

/** Shown to the indent step so a multi-line html raw stays one logical line. */
export const HTML_RAW_LINE_SENTINEL = "\uE000";

/** Media-query rules for responsive block/section styles (build + editor serialize). */
/** Escapes an attribute value for use inside a CSS attribute selector
 *  string. HTML escaping (escapeAttr) must NOT be used here: `<style>` is a
 *  raw-text element, so `&amp;` would stay literal and the selector would
 *  never match the real `data-zephus-id` attribute.
 *
 *  `<`/`>` are escaped too: a hand-authored block id containing `</style>`
 *  would otherwise terminate the `<style>` raw-text element mid-selector and
 *  let a following `<script>` run in the published site (stored XSS). The
 *  `\3c `/`\3e ` hex escapes (space terminates the escape) keep the selector
 *  matching the real attribute while never emitting a literal angle bracket. */
function cssStringValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\a ")
    .replace(/</g, "\\3c ")
    .replace(/>/g, "\\3e ");
}

export function collectResponsiveCss(sections: SectionNode[]): string {
  const tabletRules: string[] = [];
  const mobileRules: string[] = [];

  const addRules = (
    id: string,
    style: BlockStyle | undefined,
    includeStackRule = false,
  ): void => {
    const tablet = responsiveCssDeclarations(style?.responsive?.tablet);
    const mobile = responsiveCssDeclarations(style?.responsive?.mobile);
    const selector = `[data-zephus-id="${cssStringValue(id)}"]`;
    if (tablet) tabletRules.push(`${selector}{${tablet}}`);
    if (mobile) mobileRules.push(`${selector}{${mobile}}`);
    if (includeStackRule && style?.stackOnMobile) {
      // !important: must beat the inline grid-template-columns from styleAttr.
      mobileRules.push(`${selector}{grid-template-columns:1fr!important}`);
    }
    // hideOn hides the element at the marked viewports in the BUILT site
    // (the canvas previews the same state with a dashed outline instead of
    // display:none, so hidden blocks stay selectable).
    if (style?.hideOn?.includes("tablet")) {
      tabletRules.push(`${selector}{display:none!important}`);
    }
    if (style?.hideOn?.includes("mobile")) {
      mobileRules.push(`${selector}{display:none!important}`);
    }
  };

  for (const section of sections) {
    addRules(section.id, section.style);
    for (const block of section.children) {
      addRules(block.id, block.style, block.type === "columns");
    }
  }

  const chunks: string[] = [];
  if (tabletRules.length > 0) {
    chunks.push(`@media (max-width: 1024px){${tabletRules.join("")}}`);
  }
  if (mobileRules.length > 0) {
    chunks.push(`@media (max-width: 720px){${mobileRules.join("")}}`);
  }
  return chunks.join("\n");
}

export function renderSectionsMarkup(
  sections: SectionNode[],
  renderBlock: (block: BlockNode) => string,
): string {
  const responsiveCss = collectResponsiveCss(sections);
  const body = sections
    .map((section) => {
      const inner = section.children.map(renderBlock).join("\n");
      return wrapSectionChildren(section, inner);
    })
    .filter(Boolean)
    .join("\n");
  return responsiveCss ? `<style>${responsiveCss}</style>\n${body}` : body;
}

export function renderBlockHtml(
  block: RenderBlockInput,
  options: RenderBlockOptions = {},
): string {
  const forCanvas = options.forCanvas ?? false;
  const maxHeading = options.maxHeadingLevel ?? 6;
  const common = blockCommon(block, options);

  switch (block.type) {
    case "heading": {
      // Hand-edited sidecars can carry a non-numeric level; never emit
      // `<hNaN>` or a fractional level.
      const rawLevel = Number(block.props["level"] ?? 2);
      const parsedLevel = Number.isFinite(rawLevel) ? Math.round(rawLevel) : 2;
      const level = Math.max(1, Math.min(maxHeading, parsedLevel));
      return `<h${level}${common}>${richTextToHtml(
        block.props["text"] ?? "",
      )}</h${level}>`;
    }
    case "text":
      return `<p${common}>${richTextToHtml(block.props["text"] ?? "")}</p>`;
    case "image": {
      const src = block.props["src"] ?? "";
      if (!src && forCanvas) {
        return `<figure${common}><div class="canvas-empty">Missing image. Choose one in Properties.</div></figure>`;
      }
      const isProjectAsset = forCanvas && src.startsWith("/");
      // A project asset hydrates to a data URL asynchronously; an empty src
      // would fire a request for the app's own document (broken-icon flash)
      // until then, so start with a transparent placeholder instead.
      const srcAttr = isProjectAsset
        ? ` src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-asset-src="${escapeAttr(src)}"`
        : ` src="${escapeAttr(safeUrl(src))}"`;
      return `<img${common}${srcAttr} alt="${escapeAttr(block.props["alt"] ?? "")}" />`;
    }
    case "button": {
      // The .button class carries the theme's pill styling (global CSS);
      // without it every hero CTA renders as a plain accent link. Merge it
      // with the user's cls (blockCommon already emitted the raw class).
      const cls = `button ${block.props["cls"] ?? ""}`.trim();
      const common = `${blockMetadataAttrs(block)}${
        cls ? ` class="${escapeAttr(cls)}"` : ""
      }${styleAttr(block, options)}`;
      return `<a${common} href="${escapeAttr(safeUrl(block.props["href"] ?? "#") || "#")}">${richTextToHtml(
        block.props["text"] ?? "",
        {
          allowLinks: false,
        },
      )}</a>`;
    }
    case "section":
      return `<section${common}>${richTextToHtml(block.props["text"] ?? "")}</section>`;
    case "divider":
      return `<hr${common} />`;
    case "spacer":
      return `<div${common}></div>`;
    case "columns": {
      const cols = Number(block.style?.columns ?? block.props["count"] ?? 2);
      const parts = Array.from(
        { length: Math.max(2, Math.min(cols || 2, 4)) },
        (_, index) => {
          const key = `col${index + 1}`;
          return `<div class="zephus-column">${richTextToHtml(
            block.props[key] ?? `Column ${index + 1}`,
          )}</div>`;
        },
      ).join("");
      return `<section${common}>${parts}</section>`;
    }
    case "card":
      return `<article${common}><h3>${richTextToHtml(
        block.props["title"] ?? "Card title",
      )}</h3><p>${richTextToHtml(block.props["text"] ?? "Card body")}</p></article>`;
    case "gallery": {
      const images = (block.props["images"] ?? "")
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
      const galleryCommon = structuralCommon(block, "zephus-gallery", options);
      if (images.length === 0 && forCanvas) {
        return `<section${galleryCommon}><div class="canvas-empty">No gallery images yet.</div></section>`;
      }
      return `<section${galleryCommon}>${images
        .map((src, index) => {
          const isProjectAsset = forCanvas && src.startsWith("/");
          const srcAttr = isProjectAsset
            ? ` src="" data-asset-src="${escapeAttr(src)}"`
            : ` src="${escapeAttr(safeUrl(src))}"`;
          return `<img${srcAttr} alt="${escapeAttr(
            block.props[`alt${index + 1}`] ?? "",
          )}" />`;
        })
        .join("")}</section>`;
    }
    case "quote":
      return `<blockquote${common}><p>${richTextToHtml(
        block.props["text"] ?? "",
      )}</p>${
        block.props["cite"]
          ? `<cite>${richTextToHtml(block.props["cite"])}</cite>`
          : ""
      }</blockquote>`;
    case "list": {
      const tag = block.props["ordered"] === "true" ? "ol" : "ul";
      return `<${tag}${common}>${renderListItems(
        block.props["items"] ?? "",
      )}</${tag}>`;
    }
    case "embed":
      if (!block.props["src"] && forCanvas) {
        return `<section${common}><div class="canvas-empty">Missing embed URL.</div></section>`;
      }
      return `<iframe${common} src="${escapeAttr(safeUrl(block.props["src"] ?? ""))}" title="${escapeAttr(block.props["title"] ?? "Embed")}" loading="lazy"></iframe>`;
    case "video": {
      const src = block.props["src"] ?? "";
      if (!src && forCanvas) {
        return `<figure${common}><div class="canvas-empty">Missing video URL. Set it in Properties.</div></figure>`;
      }
      return `<video${common} controls preload="metadata" src="${escapeAttr(safeUrl(src))}" title="${escapeAttr(block.props["title"] ?? "Video")}"></video>`;
    }
    case "html":
      if (forCanvas && options.sanitizeHtmlForCanvas) {
        return options.sanitizeHtmlForCanvas(block.raw ?? "");
      }
      // The build serializers indent every body line (+2). Without shielding,
      // a multi-line raw html block grew 2 spaces per save cycle forever (and
      // reparse kept the grown bytes). Sentinel the raw's newlines so the
      // indent treats it as ONE line; the indent step restores real newlines.
      return (block.raw ?? "").replace(/\n/g, HTML_RAW_LINE_SENTINEL);
    case "feature":
      return `<div${structuralCommon(block, "zephus-feature", options)}><div class="zephus-feature-icon">${plainTextToHtml(
        block.props["icon"] ?? "★",
      )}</div><h3>${richTextToHtml(
        block.props["title"] ?? "Feature",
      )}</h3><p>${richTextToHtml(block.props["text"] ?? "")}</p></div>`;
    case "testimonial":
      return `<figure${structuralCommon(block, "zephus-testimonial", options)}><blockquote>${richTextToHtml(
        block.props["quote"] ?? "",
      )}</blockquote><figcaption><strong>${richTextToHtml(
        block.props["author"] ?? "",
      )}</strong>${
        block.props["role"]
          ? ` <span>${richTextToHtml(block.props["role"])}</span>`
          : ""
      }</figcaption></figure>`;
    case "accordion": {
      const items = splitLines(block.props["items"] ?? "")
        .map((line) => splitPair(line))
        .map(
          ([q, a]) =>
            `<details><summary>${richTextToHtml(q)}</summary><p>${richTextToHtml(a)}</p></details>`,
        )
        .join("");
      return `<div${structuralCommon(block, "zephus-accordion", options)}>${items}</div>`;
    }
    case "stats": {
      const items = splitLines(block.props["items"] ?? "")
        .map((line) => splitPair(line))
        .map(
          ([n, l]) =>
            `<div class="zephus-stat"><span class="zephus-stat-num">${richTextToHtml(
              n,
            )}</span><span class="zephus-stat-label">${richTextToHtml(l)}</span></div>`,
        )
        .join("");
      return `<div${structuralCommon(block, "zephus-stats", options)}>${items}</div>`;
    }
    case "pricing": {
      const rawFeatures = (block.props["features"] ?? "").trim();
      if (!rawFeatures && forCanvas) {
        return `<div${structuralCommon(
          block,
          "zephus-pricing",
          options,
        )}><div class="canvas-empty">No features yet. Add them in Properties.</div></div>`;
      }
      const features = splitLines(rawFeatures)
        .map((f) => `<li>${richTextToHtml(f)}</li>`)
        .join("");
      const cta = block.props["ctaText"]
        ? `<a class="button" href="${escapeAttr(safeUrl(block.props["ctaHref"] ?? "#") || "#")}">${richTextToHtml(
            block.props["ctaText"],
            { allowLinks: false },
          )}</a>`
        : "";
      return `<div${structuralCommon(block, "zephus-pricing", options)}><h3>${richTextToHtml(
        block.props["plan"] ?? "Plan",
      )}</h3><div class="zephus-price"><span class="zephus-price-amount">${richTextToHtml(
        block.props["price"] ?? "",
      )}</span>${
        block.props["period"]
          ? `<span class="zephus-price-period">${richTextToHtml(block.props["period"])}</span>`
          : ""
      }</div><ul>${features}</ul>${cta}</div>`;
    }
    case "postlist": {
      const listCommon = structuralCommon(block, "zephus-postlist", options);
      const entries = selectPostEntries(block.props, options.posts ?? []);
      if (entries.length === 0) {
        const empty =
          block.props["emptyText"] ??
          "No posts yet. Add a page with a publish date.";
        return `<div${listCommon}><p class="zephus-postlist-empty">${richTextToHtml(
          empty,
        )}</p></div>`;
      }
      const showDate = block.props["showDate"] !== "false";
      const showAuthor = block.props["showAuthor"] === "true";
      const showExcerpt = block.props["showExcerpt"] !== "false";
      const showImage = block.props["showImage"] === "true";
      const items = entries
        .map((post) => {
          const href = escapeAttr(safeUrl(post.route) || "#");
          const meta = [
            showDate && post.date
              ? `<time class="zephus-postlist-date" datetime="${escapeAttr(
                  post.date,
                )}">${escapeHtml(formatPostDate(post.date))}</time>`
              : "",
            showAuthor && post.author
              ? `<span class="zephus-postlist-author">${escapeHtml(post.author)}</span>`
              : "",
          ]
            .filter(Boolean)
            .join("");
          const image =
            showImage && post.image
              ? `<img class="zephus-postlist-image" src="${escapeAttr(
                  safeUrl(post.image),
                )}" alt="" loading="lazy" decoding="async" />`
              : "";
          const excerpt =
            showExcerpt && post.description
              ? `<p class="zephus-postlist-excerpt">${escapeHtml(post.description)}</p>`
              : "";
          return `<article class="zephus-postlist-item">${image}<h3 class="zephus-postlist-title"><a href="${href}">${escapeHtml(
            post.title,
          )}</a></h3>${
            meta ? `<div class="zephus-postlist-meta">${meta}</div>` : ""
          }${excerpt}</article>`;
        })
        .join("");
      return `<div${listCommon}>${items}</div>`;
    }
    case "cta": {
      const cta = block.props["buttonText"]
        ? `<a class="button" href="${escapeAttr(safeUrl(block.props["buttonHref"] ?? "#") || "#")}">${richTextToHtml(
            block.props["buttonText"],
            { allowLinks: false },
          )}</a>`
        : "";
      return `<div${structuralCommon(block, "zephus-cta", options)}><h2>${richTextToHtml(
        block.props["heading"] ?? "",
      )}</h2>${
        block.props["text"]
          ? `<p>${richTextToHtml(block.props["text"])}</p>`
          : ""
      }${cta}</div>`;
    }
    default: {
      const unknownType = (block as { type: string }).type;
      if (forCanvas) {
        return `<div${common} class="canvas-unknown-block">Unknown block: ${escapeHtml(unknownType)}</div>`;
      }
      options.onUnknownBlockType?.(unknownType);
      const payload = encodeDataPayload(block.props);
      return `<div data-zephus-block="${escapeAttr(unknownType)}" data-zephus-props="${escapeAttr(payload)}" class="zephus-unknown-block"><!-- Unknown block type: ${escapeHtml(unknownType)} --></div>`;
    }
  }
}

export type { StyleViewport };
