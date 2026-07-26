import type { BlockNode, SectionNode } from "../main/types";
import { renderBlockHtml, wrapSectionChildren } from "../shared/blockRender";
import { BUILD_MAX_HEADING_LEVEL } from "../shared/blockRenderFixtures";
import type { StyleViewport } from "../shared/renderHelpers";

export interface EditorBlockRenderOptions {
  viewport: StyleViewport;
  forCanvas: boolean;
  /** Applied on the live canvas preview. */
  canvasMaxHeadingLevel: number;
  /** Applied when serializing to managed source (defaults to build max). */
  serializeMaxHeadingLevel?: number;
}

/**
 * Defense-in-depth sanitizer for raw `html` blocks on the live editor canvas.
 * Parsing into a <template> is inert (no script execution, no resource loads).
 */
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
      tag === "iframe"
    ) {
      toRemove.push(node);
    } else {
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on")) {
          node.removeAttribute(attr.name);
        } else if (
          name === "srcdoc" ||
          name === "formaction" ||
          ((name === "href" || name === "src" || name === "xlink:href") &&
            /^\s*(javascript|vbscript|data):/i.test(attr.value))
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
