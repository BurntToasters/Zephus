/**
 * Parses managed page inner HTML into section/block trees (visual editor load path).
 */

import type {
  BlockStyle,
  EditorBlock,
  EditorBlockType,
  SectionNode,
} from "../main/types";

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
  const style = {
    color: el.style.color || undefined,
    background: el.style.background || undefined,
    padding: el.style.padding || undefined,
    margin: el.style.margin || undefined,
    width: el.style.width || undefined,
    height: el.style.height || undefined,
    maxWidth: el.style.maxWidth || undefined,
    radius: el.style.borderRadius || undefined,
    gap: el.style.gap || undefined,
  } satisfies BlockStyle;
  return Object.values(style).some(Boolean) ? style : undefined;
}

export interface EditorParseDeps {
  uid: () => string;
  createFallbackSection: () => SectionNode;
  knownBlockTypes: ReadonlySet<string>;
}

export function createEditorPageParser(deps: EditorParseDeps) {
  function parseInner(inner: string): Block[] {
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
          raw: storedType === "html" ? el.outerHTML : undefined,
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
          props: { text: el.textContent ?? "", level: tag[1] ?? "2", cls },
          style: styleFromLegacyProps(el),
        });
      } else if (tag === "p") {
        blocks.push({
          id: deps.uid(),
          type: "text",
          props: { text: el.textContent ?? "", cls },
          style: styleFromLegacyProps(el),
        });
      } else if (tag === "a") {
        blocks.push({
          id: deps.uid(),
          type: "button",
          props: {
            text: el.textContent ?? "",
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
        blocks.push({
          id: deps.uid(),
          type: "quote",
          props: {
            text:
              el.querySelector("p")?.textContent?.trim() ??
              el.textContent?.trim() ??
              "",
            cite: el.querySelector("cite")?.textContent?.trim() ?? "",
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
              .map((item) => item.textContent?.trim() ?? "")
              .filter(Boolean)
              .join("\n"),
            ordered: tag === "ol" ? "true" : "false",
            cls,
          },
          style: styleFromLegacyProps(el),
        });
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
    return {
      id: storedId || deps.uid(),
      type: "section",
      label: `Section ${index + 1}`,
      props: { wrapper: "box", cls },
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
      sec.children = parseInner(inner);
      return [sec];
    }

    const sections: SectionNode[] = [];
    let looseBlocks: Block[] = [];

    const flushLoose = (): void => {
      if (looseBlocks.length === 0) return;
      const sec = deps.createFallbackSection();
      sec.label =
        sections.length === 0
          ? "Main Content"
          : `Section ${sections.length + 1}`;
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
      if (node.nodeType !== Node.ELEMENT_NODE) {
        const raw = (node as ChildNode).textContent ?? "";
        if (raw.trim()) {
          looseBlocks.push({ id: deps.uid(), type: "html", props: {}, raw });
        }
        continue;
      }
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "style") continue;
      if (
        tag === "section" &&
        (el.dataset["zephusBlock"] === "section" || !el.dataset["zephusBlock"])
      ) {
        flushLoose();
        sections.push(sectionNodeFromElement(el, sections.length));
      } else {
        looseBlocks.push(...parseInner(el.outerHTML));
      }
    }

    flushLoose();
    return sections.length > 0 ? sections : [deps.createFallbackSection()];
  }

  return { parseSections, parseInner };
}
