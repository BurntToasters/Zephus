import type { BlockNode, SectionNode } from "../main/types";
import {
  renderBlockHtml,
  wrapSectionChildren,
  type RenderPostEntry,
} from "../shared/blockRender";
import { BUILD_MAX_HEADING_LEVEL } from "../shared/blockRenderFixtures";
import { safeUrl, type StyleViewport } from "../shared/renderHelpers";

export interface EditorBlockRenderOptions {
  viewport: StyleViewport;
  forCanvas: boolean;
  /** Applied on the live canvas preview. */
  canvasMaxHeadingLevel: number;
  /** Applied when serializing to managed source (defaults to build max). */
  serializeMaxHeadingLevel?: number;
  /** Pages available to Post List blocks; must mirror the build's index. */
  posts?: RenderPostEntry[];
}

const CANVAS_FORBIDDEN_TAGS = new Set([
  "script",
  "object",
  "embed",
  "iframe",
  "form",
  "base",
  "style",
  "link",
  "meta",
  "animate",
  "animatetransform",
  "set",
  "foreignobject",
]);

function sanitizeElementAttributes(node: Element): void {
  for (const attr of Array.from(node.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on")) {
      node.removeAttribute(attr.name);
    } else if (name === "srcset") {
      const safe = sanitizeSrcset(attr.value);
      if (safe === null) node.removeAttribute(attr.name);
      else node.setAttribute(attr.name, safe);
    } else if (name === "srcdoc") {
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
}

/** Walks element nodes under `root`, including nested `<template>` contents. */
function sanitizeElementSubtree(root: ParentNode): void {
  const toRemove: Element[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode() as Element | null;
  while (node) {
    const tag = node.tagName.toLowerCase();
    if (CANVAS_FORBIDDEN_TAGS.has(tag)) {
      toRemove.push(node);
    } else {
      sanitizeElementAttributes(node);
      if (node instanceof HTMLTemplateElement) {
        sanitizeElementSubtree(node.content);
      }
    }
    node = walker.nextNode() as Element | null;
  }
  for (const el of toRemove) el.remove();
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
