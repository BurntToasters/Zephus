/** Parses managed page inner HTML into section/block trees (visual editor load path). */

import type {
  BlockStyle,
  EditorBlock,
  EditorBlockType,
  SectionNode,
} from "../main/types";
import { HTML_RAW_LINE_SENTINEL } from "../shared/blockRender";
import { safeUrl } from "../shared/renderHelpers";

type Block = EditorBlock;
type BlockType = EditorBlockType;

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Coerces decoded dataset props to a flat string record. */
export function sanitizeStringRecord(
  input: Record<string, unknown> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object") return out;
  for (const [key, value] of Object.entries(input)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
    }
  }
  return out;
}

export function parseZephusJsonAttr<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
    if (parsed && typeof parsed === "object") {
      for (const key of DANGEROUS_KEYS) {
        if (Object.prototype.hasOwnProperty.call(parsed, key)) {
          delete (parsed as Record<string, unknown>)[key];
        }
      }
    }
    return parsed as T;
  } catch {
    return undefined;
  }
}

function styleFromLegacyProps(el: HTMLElement): BlockStyle | undefined {
  const raw = el.getAttribute("style") ?? "";
  if (!raw.trim()) return undefined;
  const style: BlockStyle = {};
  for (const part of raw.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const key = part.slice(0, colon).trim().toLowerCase();
    const val = part.slice(colon + 1).trim();
    if (!val) continue;
    if (key === "color") style.color = val;
    else if (key === "background") style.background = val;
    else if (key === "padding") style.padding = val;
    else if (key === "margin") style.margin = val;
    else if (key === "width") style.width = val;
    else if (key === "height") style.height = val;
    else if (key === "max-width") style.maxWidth = val;
    else if (key === "border-radius") style.radius = val;
    else if (key === "gap") style.gap = val;
    else if (key === "text-align") {
      const normalized = val.toLowerCase();
      if (
        normalized === "left" ||
        normalized === "center" ||
        normalized === "right"
      ) {
        style.align = normalized;
      }
    }
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

export interface EditorParseDeps {
  uid: () => string;
  createFallbackSection: () => SectionNode;
  knownBlockTypes: ReadonlySet<string>;
}

/** Reads an element's text like the main-process regex parser does: <br> becomes "\n" and nested elements contribute… */
function elementTextRaw(el: Element): string {
  let out = "";
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? "";
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as Element;
      if (childEl.tagName === "BR") out += "\n";
      else out += elementTextRaw(childEl);
    }
  }
  return out;
}

function elementText(el: Element): string {
  // Trim ONCE at the top level, mirroring the main-process parser
  // (schema.ts textFromHtml trims the whole string). Trimming inside the
  // recursive walk would strip the leading space of nested elements
  // (<p>before <span> after</span></p> would lose a space).
  return elementTextRaw(el).trim();
}

/** Inner markup of a managed html block (wrapper div is re-emitted on save). */
function htmlBlockInnerRaw(el: HTMLElement): string {
  return el.innerHTML.replace(new RegExp(HTML_RAW_LINE_SENTINEL, "g"), "\n");
}

export function createEditorPageParser(deps: EditorParseDeps) {
  function parseInner(inner: string, topLevel = false): Block[] {
    const doc = new DOMParser().parseFromString(
      `<div id="z-root">${inner}</div>`,
      "text/html",
    );
    const root = doc.getElementById("z-root");
    const blocks: Block[] = [];
    if (!root) return blocks;

    for (const node of Array.from(root.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? "";
        if (text.trim().length > 0) {
          blocks.push({ id: deps.uid(), type: "html", props: {}, raw: text });
        }
        continue;
      }
      if (node.nodeType === Node.COMMENT_NODE) {
        // Rebuild the comment markers: textContent alone would turn a
        // comment into visible page text on the next save.
        const raw = `<!--${node.textContent ?? ""}-->`;
        if (raw.trim()) {
          blocks.push({ id: deps.uid(), type: "html", props: {}, raw });
        }
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        const raw = (node as ChildNode).textContent ?? "";
        if (raw.trim()) {
          blocks.push({ id: deps.uid(), type: "html", props: {}, raw });
        }
        continue;
      }
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const cls = el.getAttribute("class") ?? "";
      // Match the main-process parser: a top-level <style> is dropped, never
      // stored as content. NESTED <style> (inside a section) is preserved as
      // an html block — dropping it deleted hand-authored CSS on save.
      if (tag === "style" && topLevel) continue;
      const storedType = el.dataset["zephusBlock"];
      const storedProps = parseZephusJsonAttr<Record<string, unknown>>(
        el.dataset["zephusProps"] ?? null,
      );
      const storedStyle = parseZephusJsonAttr<BlockStyle>(
        el.dataset["zephusStyle"] ?? null,
      );
      const storedId = el.dataset["zephusId"]?.trim();
      if (storedType && deps.knownBlockTypes.has(storedType) && storedProps) {
        blocks.push({
          id: storedId || deps.uid(),
          type: storedType as BlockType,
          props: sanitizeStringRecord(storedProps),
          style: storedStyle,
          locked: el.dataset["zephusLocked"] === "true",
          raw: storedType === "html" ? htmlBlockInnerRaw(el) : undefined,
        });
        continue;
      }

      if (
        tag === "section" &&
        !storedType &&
        el.querySelector("[data-zephus-block]")
      ) {
        blocks.push(...parseInner(el.innerHTML));
        continue;
      }

      if (/^h[1-6]$/.test(tag)) {
        blocks.push({
          id: deps.uid(),
          type: "heading",
          props: { text: elementText(el), level: tag[1] ?? "2", cls },
          style: styleFromLegacyProps(el),
        });
      } else if (tag === "p") {
        blocks.push({
          id: deps.uid(),
          type: "text",
          props: { text: elementText(el), cls },
          style: styleFromLegacyProps(el),
        });
      } else if (tag === "a") {
        blocks.push({
          id: deps.uid(),
          type: "button",
          props: {
            text: elementText(el),
            href: el.getAttribute("href") ?? "#",
            cls,
          },
          style: styleFromLegacyProps(el),
        });
      } else if (tag === "img") {
        blocks.push({
          id: deps.uid(),
          type: "image",
          props: {
            src: el.getAttribute("src") ?? "",
            alt: el.getAttribute("alt") ?? "",
            cls,
          },
          style: styleFromLegacyProps(el),
        });
      } else if (tag === "hr") {
        blocks.push({
          id: deps.uid(),
          type: "divider",
          props: { cls },
          style: styleFromLegacyProps(el),
        });
      } else if (tag === "blockquote") {
        const paragraphs = Array.from(el.querySelectorAll("p"))
          .map((paragraph) => elementText(paragraph).trim())
          .filter(Boolean);
        let quoteText = paragraphs.join("\n");
        if (!quoteText) {
          const clone = el.cloneNode(true) as Element;
          for (const citeNode of Array.from(clone.querySelectorAll("cite"))) {
            citeNode.remove();
          }
          quoteText = elementText(clone).trim();
        }
        const citeEl = el.querySelector("cite");
        blocks.push({
          id: deps.uid(),
          type: "quote",
          props: {
            // Join every paragraph (not just the first), matching the
            // main-process parser.
            text: quoteText,
            cite: citeEl ? elementText(citeEl).trim() : "",
            cls,
          },
          style: styleFromLegacyProps(el),
        });
      } else if (tag === "ul" || tag === "ol") {
        blocks.push({
          id: deps.uid(),
          type: "list",
          props: {
            items: Array.from(el.querySelectorAll("li"))
              .map((item) => elementText(item).trim())
              .filter(Boolean)
              .join("\n"),
            ordered: tag === "ol" ? "true" : "false",
            cls,
          },
          style: styleFromLegacyProps(el),
        });
      } else if (tag === "video") {
        const directSrc = el.getAttribute("src")?.trim() ?? "";
        const sourceSrc =
          el.querySelector("source[src]")?.getAttribute("src")?.trim() ?? "";
        const candidateSrc = directSrc || sourceSrc;
        const validSrc = candidateSrc ? safeUrl(candidateSrc) : "";
        if (validSrc) {
          blocks.push({
            id: deps.uid(),
            type: "video",
            props: {
              src: validSrc,
              title: el.getAttribute("title") ?? "Video",
              cls,
            },
            style: styleFromLegacyProps(el),
          });
        } else {
          blocks.push({
            id: deps.uid(),
            type: "html",
            props: {},
            raw: el.outerHTML,
          });
        }
      } else if (tag === "iframe") {
        blocks.push({
          id: deps.uid(),
          type: "embed",
          props: {
            src: el.getAttribute("src") ?? "",
            title: el.getAttribute("title") ?? "Embed",
            cls,
          },
          style: styleFromLegacyProps(el),
        });
      } else {
        blocks.push({
          id: deps.uid(),
          type: "html",
          props: {},
          raw: el.outerHTML,
        });
      }
    }
    return blocks;
  }

  /**
   * Parses managed inner HTML into SectionNodes, reconstructing section
   * wrappers from sectionToHtml as editable SectionNodes.
   */
  function sectionNodeFromElement(el: HTMLElement, index: number): SectionNode {
    const storedType = el.dataset["zephusBlock"];
    const storedProps = parseZephusJsonAttr<Record<string, unknown>>(
      el.dataset["zephusProps"] ?? null,
    );
    const storedStyle = parseZephusJsonAttr<BlockStyle>(
      el.dataset["zephusStyle"] ?? null,
    );
    const storedId = el.dataset["zephusId"]?.trim();
    if (storedType === "section" && storedProps) {
      const props = sanitizeStringRecord(storedProps);
      return {
        id: storedId || deps.uid(),
        type: "section",
        label: props["label"] || `Section ${index + 1}`,
        props: {
          wrapper: props["wrapper"] ?? "none",
          cls: props["cls"] ?? "",
        },
        style: storedStyle,
        locked: el.dataset["zephusLocked"] === "true",
        children: parseInner(el.innerHTML),
      };
    }
    const cls = el.getAttribute("class") ?? "";
    const style = styleFromLegacyProps(el);
    return {
      id: storedId || deps.uid(),
      type: "section",
      label: `Section ${index + 1}`,
      props: { wrapper: "box", cls },
      ...(style ? { style } : {}),
      children: parseInner(el.innerHTML),
    };
  }

  function parseSections(inner: string): SectionNode[] {
    const doc = new DOMParser().parseFromString(
      `<div id="z-root">${inner}</div>`,
      "text/html",
    );
    const root = doc.getElementById("z-root");
    if (!root) return [deps.createFallbackSection()];

    const topElements = Array.from(root.children)
      .map((element) => element as HTMLElement)
      .filter((element) => element.tagName.toLowerCase() !== "style");

    const hasManagedSection = topElements.some(
      (el) => el.dataset["zephusBlock"] === "section",
    );
    const hasLegacySectionWrapper = topElements.some(
      (el) =>
        el.tagName.toLowerCase() === "section" && !el.dataset["zephusBlock"],
    );

    if (!hasManagedSection && !hasLegacySectionWrapper) {
      const sec = deps.createFallbackSection();
      // This is the top level: a <style> here must be dropped like the main
      // parser drops it (the default false kept it as an html block).
      sec.children = parseInner(inner, true);
      return [sec];
    }

    const sections: SectionNode[] = [];
    let looseBlocks: Block[] = [];

    const flushLoose = (): void => {
      if (looseBlocks.length === 0) return;
      const sec = deps.createFallbackSection();
      // Mirror the main-process parser: trailing loose blocks always label
      // the section "Main Content" — a differing label landed in
      // data-zephus-props and changed bytes on the first save.
      sec.label = "Main Content";
      sec.children = looseBlocks;
      looseBlocks = [];
      sections.push(sec);
    };

    for (const node of Array.from(root.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? "";
        if (text.trim()) {
          looseBlocks.push({
            id: deps.uid(),
            type: "html",
            props: {},
            raw: text,
          });
        }
        continue;
      }
      if (node.nodeType === Node.COMMENT_NODE) {
        const raw = `<!--${node.textContent ?? ""}-->`;
        if (raw.trim()) {
          looseBlocks.push({ id: deps.uid(), type: "html", props: {}, raw });
        }
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        const raw = (node as ChildNode).textContent ?? "";
        if (raw.trim()) {
          looseBlocks.push({ id: deps.uid(), type: "html", props: {}, raw });
        }
        continue;
      }
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (
        tag === "section" &&
        (el.dataset["zephusBlock"] === "section" || !el.dataset["zephusBlock"])
      ) {
        flushLoose();
        sections.push(sectionNodeFromElement(el, sections.length));
      } else {
        looseBlocks.push(...parseInner(el.outerHTML, true));
      }
    }

    flushLoose();
    return sections.length > 0 ? sections : [deps.createFallbackSection()];
  }

  return { parseSections, parseInner };
}
