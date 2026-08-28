import type { BlockNode, SectionNode } from "../main/types";
import {
  renderBlockHtml,
  wrapSectionChildren,
  type RenderPostEntry,
} from "../shared/blockRender";
import { BUILD_MAX_HEADING_LEVEL } from "../shared/blockRenderFixtures";
import type { StyleViewport } from "../shared/renderHelpers";

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

/** Defense-in-depth sanitizer for raw `html` blocks on the live editor canvas. */
export function sanitizeHtmlForCanvas(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const toRemove: Element[] = [];
  const walker = document.createTreeWalker(
    tpl.content,
    NodeFilter.SHOW_ELEMENT,
  );
  let node = walker.nextNode() as Element | null;
  while (node) {
    const tag = node.tagName.toLowerCase();
    if (
      tag === "script" ||
      tag === "object" ||
      tag === "embed" ||
      tag === "iframe" ||
      // Forms can submit or navigate the editor document even when their
      // action is same-origin; the live canvas is a preview, never a form
      // runtime. The built site still preserves authored HTML.
      tag === "form" ||
      // <base> rewrites every relative URL on the canvas (images, links, css)
      // to an attacker-chosen origin — remove it outright.
      tag === "base" ||
      // <style>/<link> can exfiltrate data via CSS or visually hijack the
      // editor chrome. <meta http-equiv="refresh"> can redirect the canvas.
      // The built site preserves these; only the live canvas strips them.
      tag === "style" ||
      tag === "link" ||
      tag === "meta"
    ) {
      toRemove.push(node);
    } else {
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on")) {
          node.removeAttribute(attr.name);
        } else if (name === "srcset") {
          // Filter dangerous entries; drop the attribute if none survive.
          const safe = sanitizeSrcset(attr.value);
          if (safe === null) node.removeAttribute(attr.name);
          else node.setAttribute(attr.name, safe);
        } else if (
          name === "srcdoc" ||
          name === "formaction" ||
          name === "action" ||
          (name === "poster" &&
            /^\s*(javascript|vbscript|data):/i.test(
              attr.value.replace(/[\t\n\r]/g, ""),
            )) ||
          ((name === "href" || name === "src" || name === "xlink:href") &&
            /^\s*(javascript|vbscript|data):/i.test(
              attr.value.replace(/[\t\n\r]/g, ""),
            ))
        ) {
          node.removeAttribute(attr.name);
        }
      }
    }
    node = walker.nextNode() as Element | null;
  }
  for (const el of toRemove) el.remove();
  return tpl.innerHTML;
}

/** Filters a srcset attribute ("/a.png 1x, /b.png 2x") down to entries with safe URL schemes. */
function sanitizeSrcset(value: string): string | null {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;
  const safe = entries.filter(
    (entry) =>
      !/^\s*(javascript|vbscript|data):/i.test(entry.replace(/[\t\n\r]/g, "")),
  );
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
