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

export interface RenderBlockOptions extends StyleAttrOptions {
  /** Editor caps heading level; build uses 6. */
  maxHeadingLevel?: number;
  sanitizeHtmlForCanvas?: (html: string) => string;
  onUnknownBlockType?: (type: string) => void;
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
  return (
    sectionWrapperIsNone(section.props) && !sectionHasSurface(section)
  );
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

function responsiveCssDeclarations(style: BlockStyle | undefined): string | null {
  if (!style) return null;
  const css: string[] = [];
  if (["left", "center", "right"].includes(String(style.align))) {
    css.push(`text-align:${style.align}`);
  }
  addCssValue(css, "width", style.width);
  addCssValue(css, "height", style.height);
  addCssValue(css, "max-width", style.maxWidth);
  addCssValue(css, "padding", style.padding);
  addCssValue(css, "margin", style.margin);
  addCssValue(css, "gap", style.gap);
  if (style.columns) {
    css.push(
      `grid-template-columns:repeat(${Math.max(1, Number(style.columns) || 1)}, minmax(0, 1fr))`,
    );
  }
  return css.length ? css.join(";") : null;
}

/** Media-query rules for responsive block/section styles (build + editor serialize). */
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
    const selector = `[data-zephus-id="${escapeAttr(id)}"]`;
    if (tablet) tabletRules.push(`${selector}{${tablet}}`);
    if (mobile) mobileRules.push(`${selector}{${mobile}}`);
    if (includeStackRule && style?.stackOnMobile) {
      mobileRules.push(`${selector}{grid-template-columns:1fr}`);
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
      const level = Math.max(
        1,
        Math.min(maxHeading, Number(block.props["level"] ?? 2)),
      );
      return `<h${level}${common}>${plainTextToHtml(
        block.props["text"] ?? "",
      )}</h${level}>`;
    }
    case "text":
      return `<p${common}>${plainTextToHtml(block.props["text"] ?? "")}</p>`;
    case "image": {
      const src = block.props["src"] ?? "";
      if (!src && forCanvas) {
        return `<figure${common}><div class="canvas-empty">Missing image. Choose one in Properties.</div></figure>`;
      }
      const isProjectAsset = forCanvas && src.startsWith("/");
      const srcAttr = isProjectAsset
        ? ` src="" data-asset-src="${escapeAttr(src)}"`
        : ` src="${escapeAttr(safeUrl(src))}"`;
      return `<img${common}${srcAttr} alt="${escapeAttr(block.props["alt"] ?? "")}" />`;
    }
    case "button":
      return `<a${common} href="${escapeAttr(safeUrl(block.props["href"] ?? "#") || "#")}">${plainTextToHtml(block.props["text"] ?? "")}</a>`;
    case "section":
      return `<section${common}>${plainTextToHtml(block.props["text"] ?? "")}</section>`;
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
          return `<div class="zephus-column">${plainTextToHtml(
            block.props[key] ?? `Column ${index + 1}`,
          )}</div>`;
        },
      ).join("");
      return `<section${common}>${parts}</section>`;
    }
    case "card":
      return `<article${common}><h3>${plainTextToHtml(
        block.props["title"] ?? "Card title",
      )}</h3><p>${plainTextToHtml(block.props["text"] ?? "Card body")}</p></article>`;
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
      return `<blockquote${common}><p>${plainTextToHtml(
        block.props["text"] ?? "",
      )}</p>${
        block.props["cite"]
          ? `<cite>${plainTextToHtml(block.props["cite"])}</cite>`
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
    case "html":
      if (forCanvas && options.sanitizeHtmlForCanvas) {
        return options.sanitizeHtmlForCanvas(block.raw ?? "");
      }
      return block.raw ?? "";
    case "feature":
      return `<div${structuralCommon(block, "zephus-feature", options)}><div class="zephus-feature-icon">${plainTextToHtml(
        block.props["icon"] ?? "★",
      )}</div><h3>${plainTextToHtml(
        block.props["title"] ?? "Feature",
      )}</h3><p>${plainTextToHtml(block.props["text"] ?? "")}</p></div>`;
    case "testimonial":
      return `<figure${structuralCommon(block, "zephus-testimonial", options)}><blockquote>${plainTextToHtml(
        block.props["quote"] ?? "",
      )}</blockquote><figcaption><strong>${plainTextToHtml(
        block.props["author"] ?? "",
      )}</strong>${
        block.props["role"]
          ? ` <span>${plainTextToHtml(block.props["role"])}</span>`
          : ""
      }</figcaption></figure>`;
    case "accordion": {
      const items = splitLines(block.props["items"] ?? "")
        .map((line) => splitPair(line))
        .map(
          ([q, a]) =>
            `<details><summary>${plainTextToHtml(q)}</summary><p>${plainTextToHtml(a)}</p></details>`,
        )
        .join("");
      return `<div${structuralCommon(block, "zephus-accordion", options)}>${items}</div>`;
    }
    case "stats": {
      const items = splitLines(block.props["items"] ?? "")
        .map((line) => splitPair(line))
        .map(
          ([n, l]) =>
            `<div class="zephus-stat"><span class="zephus-stat-num">${plainTextToHtml(
              n,
            )}</span><span class="zephus-stat-label">${plainTextToHtml(l)}</span></div>`,
        )
        .join("");
      return `<div${structuralCommon(block, "zephus-stats", options)}>${items}</div>`;
    }
    case "pricing": {
      const features = splitLines(block.props["features"] ?? "")
        .map((f) => `<li>${plainTextToHtml(f)}</li>`)
        .join("");
      const cta = block.props["ctaText"]
        ? `<a class="button" href="${escapeAttr(safeUrl(block.props["ctaHref"] ?? "#") || "#")}">${plainTextToHtml(
            block.props["ctaText"],
          )}</a>`
        : "";
      return `<div${structuralCommon(block, "zephus-pricing", options)}><h3>${plainTextToHtml(
        block.props["plan"] ?? "Plan",
      )}</h3><div class="zephus-price"><span class="zephus-price-amount">${plainTextToHtml(
        block.props["price"] ?? "",
      )}</span>${
        block.props["period"]
          ? `<span class="zephus-price-period">${plainTextToHtml(block.props["period"])}</span>`
          : ""
      }</div><ul>${features}</ul>${cta}</div>`;
    }
    case "cta": {
      const cta = block.props["buttonText"]
        ? `<a class="button" href="${escapeAttr(safeUrl(block.props["buttonHref"] ?? "#") || "#")}">${plainTextToHtml(
            block.props["buttonText"],
          )}</a>`
        : "";
      return `<div${structuralCommon(block, "zephus-cta", options)}><h2>${plainTextToHtml(
        block.props["heading"] ?? "",
      )}</h2>${
        block.props["text"]
          ? `<p>${plainTextToHtml(block.props["text"])}</p>`
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
