import type { BlockNode, SectionNode } from "../main/types";
import {
  CANVAS_ASSET_PLACEHOLDER_SRC,
  renderBlockHtml,
  wrapSectionChildren,
  type RenderPostEntry,
} from "../shared/blockRender";
import { isProjectAssetPath } from "../shared/assetPreview";
import { BUILD_MAX_HEADING_LEVEL } from "../shared/blockRenderFixtures";
import {
  expandCssEscapes,
  safeUrl,
  stripCssFetches,
  type StyleViewport,
} from "../shared/renderHelpers";

export interface EditorBlockRenderOptions {
  viewport: StyleViewport;
  forCanvas: boolean;
  /** Applied on the live canvas preview. */
  canvasMaxHeadingLevel: number;
  /** Applied when serializing to managed source (defaults to build max). */
  serializeMaxHeadingLevel?: number;
  /** Pages available to Post List blocks; must mirror the build's index. */
  posts?: RenderPostEntry[];
  /** Current page route excluded from Post List results (mirrors build). */
  excludePostListPageRoute?: string;
}

/**
 * Presentation attributes the browser fetches when the value is `url(...)`.
 * A same-origin path is allowed by img-src 'self', so it loads from the
 * editor document. A `#fragment` stays inside the SVG.
 */
const PRESENTATION_URL_ATTRS = new Set([
  "fill",
  "stroke",
  "filter",
  "clip-path",
  "mask",
  "cursor",
  "marker",
  "marker-start",
  "marker-mid",
  "marker-end",
]);

const CANVAS_FORBIDDEN_TAGS = new Set([
  "script",
  "object",
  "embed",
  "iframe",
  "base",
  "style",
  "link",
  "meta",
  "animate",
  "animatetransform",
  "set",
  "foreignobject",
]);

/**
 * These stay in the preview so the page still looks like the published HTML.
 * `inert` keeps them out of the tab order and out of the editor's field
 * check: a focused input would swallow undo, delete, and the other page keys.
 */
const CANVAS_FROZEN_TAGS = new Set([
  "a",
  "area",
  "button",
  "dialog",
  "input",
  "select",
  "textarea",
]);

/** Drops fetches from a canvas style attribute. Other declarations stay. */
function sanitizeCanvasStyle(value: string): string {
  return stripCssFetches(expandCssEscapes(value).replace(/\\/g, "")).trim();
}

function sanitizeElementAttributes(node: Element): void {
  for (const attr of Array.from(node.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on")) {
      node.removeAttribute(attr.name);
    } else if (
      name === "id" ||
      name === "autofocus" ||
      name === "for" ||
      name === "form" ||
      name === "popovertarget" ||
      name === "commandfor" ||
      name === "interestfor" ||
      name === "interesttarget" ||
      name === "contenteditable"
    ) {
      // The canvas sits before the properties panel and modal. An id here
      // wins getElementById. for, commandfor, popovertarget, and interestfor
      // point at another element's id and can open editor chrome. interesttarget
      // is the earlier name of interestfor. contenteditable would accept an
      // unsanitized paste into the editor document and would make keyboard
      // shortcuts treat the block as a field.
      node.removeAttribute(attr.name);
    } else if (name === "tabindex") {
      // A positive tabindex is visited before every tabindex="0" control,
      // so one HTML block can steal the editor's tab order.
      const index = Number(attr.value);
      if (!Number.isInteger(index) || index > 0) {
        node.removeAttribute(attr.name);
      }
    } else if (
      name === "accesskey" ||
      name === "aria-modal" ||
      name === "attributionsrc" ||
      name === "ping"
    ) {
      // accesskey fires from the block. aria-modal tells assistive tech
      // that everything outside this element is inert, including the editor.
      // attributionsrc fetches as soon as the image is shown, and ping posts
      // when a link is activated. The editor allows loopback connect-src, so
      // either one can reach a local service from the canvas.
      node.removeAttribute(attr.name);
    } else if (name === "style") {
      const safe = sanitizeCanvasStyle(attr.value);
      if (!safe) node.removeAttribute(attr.name);
      else node.setAttribute(attr.name, safe);
    } else if (name === "srcset") {
      const safe = sanitizeSrcset(attr.value);
      if (safe === null) node.removeAttribute(attr.name);
      else node.setAttribute(attr.name, safe);
    } else if (name === "srcdoc") {
      node.removeAttribute(attr.name);
    } else if (
      PRESENTATION_URL_ATTRS.has(name) &&
      !presentationUrlsStayInDocument(attr.value)
    ) {
      node.removeAttribute(attr.name);
    } else if (
      name === "formaction" ||
      name === "action" ||
      name === "poster" ||
      name === "href" ||
      name === "src" ||
      name === "background" ||
      name === "xlink:href"
    ) {
      const sanitized = safeUrl(attr.value);
      if (!sanitized) node.removeAttribute(attr.name);
      else node.setAttribute(attr.name, sanitized);
    }
  }
  // `<use>`, `<feImage>`, and paint servers fetch href immediately. A link
  // does not, and a bare #fragment stays inside this document.
  stripFetchedReferences(node);
}

function isLocalFragment(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith("#") &&
    !trimmed.includes("\\") &&
    !trimmed.includes("\0")
  );
}

/** True when every `url()` in a presentation attribute is a `#fragment`. */
function presentationUrlsStayInDocument(value: string): boolean {
  const expanded = expandCssEscapes(value).replace(/\\/g, "");
  const re = /url\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(expanded)) !== null) {
    let i = match.index + match[0].length;
    while (i < expanded.length && /\s/.test(expanded[i] ?? "")) i += 1;
    const quote = expanded[i];
    let inner: string;
    if (quote === "'" || quote === '"') {
      const end = expanded.indexOf(quote, i + 1);
      if (end < 0) return false;
      inner = expanded.slice(i + 1, end).trim();
    } else {
      const end = expanded.indexOf(")", i);
      if (end < 0) return false;
      inner = expanded.slice(i, end).trim();
    }
    if (!isLocalFragment(inner)) return false;
  }
  return true;
}

function stripFetchedReferences(node: Element): void {
  const tag = node.tagName.toLowerCase();
  if (tag === "a" || tag === "area") return;
  for (const name of ["href", "xlink:href"]) {
    if (!node.hasAttribute(name)) continue;
    const value = node.getAttribute(name) ?? "";
    if (isLocalFragment(value)) continue;
    node.removeAttribute(name);
  }
}

function canvasMediaNote(text: string): HTMLDivElement {
  const note = document.createElement("div");
  note.className = "canvas-empty";
  note.textContent = text;
  return note;
}

/**
 * Drop canvas URLs that would load from the editor origin or from the
 * network. Project images keep a placeholder until asset hydration fills
 * them in. Published HTML does not go through this pass.
 */
function neutralizeCanvasResource(node: Element): void {
  if (!node.parentNode) return;
  const hadFetchUrl =
    (node.getAttribute("src") ?? "").trim().length > 0 ||
    (node.getAttribute("srcset") ?? "").trim().length > 0 ||
    (node.getAttribute("imagesrcset") ?? "").trim().length > 0 ||
    (node.getAttribute("poster") ?? "").trim().length > 0 ||
    (node.getAttribute("href") ?? "").trim().length > 0 ||
    (node.getAttribute("xlink:href") ?? "").trim().length > 0;
  node.removeAttribute("srcset");
  node.removeAttribute("imagesrcset");
  node.removeAttribute("poster");
  node.removeAttribute("background");
  const tag = node.tagName.toLowerCase();
  if (tag === "source" || tag === "track") {
    node.remove();
    return;
  }
  if (tag === "image") {
    node.removeAttribute("href");
    node.removeAttribute("xlink:href");
    return;
  }
  if (tag === "video" || tag === "audio") {
    const hadSource =
      (node.getAttribute("src") ?? "").trim().length > 0 ||
      node.querySelector("source") !== null;
    node.replaceWith(
      canvasMediaNote(
        tag === "video"
          ? hadSource
            ? "Video plays in the site preview."
            : "Missing video URL."
          : hadSource
            ? "Audio plays in the site preview."
            : "Missing audio URL.",
      ),
    );
    return;
  }
  const imageLike =
    tag === "img" ||
    (tag === "input" &&
      (node.getAttribute("type") ?? "").toLowerCase() === "image");
  if (!imageLike) return;
  const src = node.getAttribute("src") ?? "";
  if (tag === "img" && isProjectAssetPath(src)) {
    node.setAttribute("data-asset-src", src);
    node.setAttribute("src", CANVAS_ASSET_PLACEHOLDER_SRC);
    return;
  }
  node.replaceWith(
    canvasMediaNote(
      hadFetchUrl ? "Image loads in the site preview." : "Missing image.",
    ),
  );
}

/** Keeps a form's contents and drops the form so it cannot submit. */
function unwrapElement(node: Element): void {
  const parent = node.parentNode;
  if (!parent) return;
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  node.remove();
}

/** Walks element nodes under `root`, including nested `<template>` contents. */
function sanitizeElementSubtree(root: ParentNode): void {
  const toRemove: Element[] = [];
  const toUnwrap: Element[] = [];
  const media: Element[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode() as Element | null;
  while (node) {
    const tag = node.tagName.toLowerCase();
    if (tag === "form") {
      toUnwrap.push(node);
    } else if (CANVAS_FORBIDDEN_TAGS.has(tag)) {
      toRemove.push(node);
    } else {
      sanitizeElementAttributes(node);
      if (CANVAS_FROZEN_TAGS.has(tag)) node.setAttribute("inert", "");
      if (
        tag === "img" ||
        tag === "image" ||
        tag === "video" ||
        tag === "audio" ||
        tag === "source" ||
        tag === "track" ||
        tag === "input" ||
        node.hasAttribute("poster") ||
        node.hasAttribute("background")
      ) {
        media.push(node);
      }
      if (node instanceof HTMLTemplateElement) {
        sanitizeElementSubtree(node.content);
      }
    }
    node = walker.nextNode() as Element | null;
  }
  for (const el of toRemove) el.remove();
  for (const el of toUnwrap) unwrapElement(el);
  for (const el of media) neutralizeCanvasResource(el);
}

/** Defense-in-depth sanitizer for raw `html` blocks on the live editor canvas. */
export function sanitizeHtmlForCanvas(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  sanitizeElementSubtree(tpl.content);
  return tpl.innerHTML;
}

/** Filters a srcset attribute ("/a.png 1x, /b.png 2x") down to entries with safe URL schemes. */
function sanitizeSrcset(value: string): string | null {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;
  const safe = entries
    .map((entry) => safeUrl(entry))
    .filter((entry) => entry.length > 0);
  return safe.length > 0 ? safe.join(", ") : null;
}

export function blockToHtmlForEditor(
  block: BlockNode,
  options: EditorBlockRenderOptions,
): string {
  const maxHeadingLevel = options.forCanvas
    ? options.canvasMaxHeadingLevel
    : (options.serializeMaxHeadingLevel ?? BUILD_MAX_HEADING_LEVEL);
  return renderBlockHtml(block, {
    viewport: options.viewport,
    forCanvas: options.forCanvas,
    maxHeadingLevel,
    sanitizeHtmlForCanvas: options.forCanvas
      ? sanitizeHtmlForCanvas
      : undefined,
    posts: options.posts,
    excludePostListPageRoute: options.excludePostListPageRoute,
  });
}

export function sectionToHtmlForEditor(
  section: SectionNode,
  options: EditorBlockRenderOptions,
): string {
  const body = section.children
    .map((block) => blockToHtmlForEditor(block, options))
    .join("\n");
  return wrapSectionChildren(section, body, {
    viewport: options.viewport,
    forCanvas: options.forCanvas,
  });
}
