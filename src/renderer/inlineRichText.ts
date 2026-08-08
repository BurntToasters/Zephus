/**
 * Converts an inline-edited contenteditable back into the small markup subset
 * Zephus stores in text props. Counterpart to `richTextToHtml` in
 * `src/shared/renderHelpers.ts`: that renders a prop to HTML, this reads the
 * edited DOM back into a prop value.
 *
 * Anything outside the subset (spans, styles, block wrappers that browsers and
 * `execCommand` produce) is dropped while keeping its text, so a paste or a
 * formatting command can never smuggle markup into the page.
 */

import { escapeAttr, safeUrl } from "../shared/renderHelpers";

/** Editor tag names mapped to the canonical stored tag. */
const ALLOWED_TAGS: Record<string, string> = {
  STRONG: "strong",
  B: "strong",
  EM: "em",
  I: "em",
  U: "u",
  S: "s",
  STRIKE: "s",
  DEL: "s",
  CODE: "code",
};

/** Elements that visually start a new line in a contenteditable. */
const BLOCK_TAGS = new Set([
  "DIV",
  "P",
  "LI",
  "SECTION",
  "ARTICLE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
]);

/** Escapes text so stored markup is unambiguous when parsed back. */
function escapeStored(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface RichTextReadOptions {
  /** False for labels rendered inside an `<a>` (button, CTA, pricing button). */
  allowLinks?: boolean;
  /** False for props stored one-per-line (list items, accordion, stats). */
  allowLineBreaks?: boolean;
}

/**
 * Reads an edited element into a stored prop value.
 *
 * When no inline formatting was used, the plain text is returned unchanged, so
 * text authored before inline formatting existed round-trips byte-identically
 * and keeps rendering through `plainTextToHtml`.
 */
export function richTextFromElement(
  root: HTMLElement,
  options: RichTextReadOptions = {},
): string {
  const allowLinks = options.allowLinks !== false;
  const allowLineBreaks = options.allowLineBreaks !== false;
  let usedMarkup = false;
  // True once any non-text child was seen (br, script, span, formatting…).
  // The walk output is authoritative then; the innerText fallback (which is
  // layout-dependent and browser-inconsistent) only applies to pure text.
  let sawElement = false;

  const lineBreak = (): string => {
    if (!allowLineBreaks) {
      sawElement = true;
      return " ";
    }
    usedMarkup = true;
    return "<br />";
  };

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      let text = node.textContent ?? "";
      if (!allowLineBreaks) {
        // Line-encoded props (list items, accordion, stats) must stay on one
        // line; some browsers/pastes produce literal "\n" text nodes that
        // bypass the BR/block handling.
        text = text.replace(/\s*\n+\s*/g, " ");
      }
      return escapeStored(text);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    sawElement = true;
    const element = node as HTMLElement;
    const tag = element.tagName;
    if (tag === "BR") return lineBreak();
    if (tag === "SCRIPT" || tag === "STYLE") return "";

    const inner = Array.from(element.childNodes).map(walk).join("");

    if (tag === "A") {
      const href = allowLinks
        ? safeUrl(element.getAttribute("href") ?? "")
        : "";
      if (!href || !inner) return inner;
      usedMarkup = true;
      return `<a href="${escapeAttr(href)}">${inner}</a>`;
    }

    const mapped = ALLOWED_TAGS[tag];
    if (mapped) {
      if (!inner.trim()) return inner;
      usedMarkup = true;
      return `<${mapped}>${inner}</${mapped}>`;
    }

    return inner;
  };

  const parts: string[] = [];
  const children = Array.from(root.childNodes);
  children.forEach((child) => {
    // Browsers wrap new lines in block elements; mirror that as a line break.
    if (
      child.nodeType === Node.ELEMENT_NODE &&
      BLOCK_TAGS.has((child as HTMLElement).tagName) &&
      parts.some((part) => part !== "")
    ) {
      parts.push(lineBreak());
    }
    parts.push(walk(child));
  });

  const markup = parts.join("");
  if (!usedMarkup) {
    if (!sawElement) {
      // Pure text (no markup, no tags): keep the prop as plain text (what the
      // editor did before inline formatting existed).
      const text = root.innerText ?? root.textContent ?? "";
      return allowLineBreaks ? text : text.replace(/\s*\n+\s*/g, " ");
    }
    // Only browser-generated wrappers were seen (spellcheck spans, execCommand
    // divs) — no formatting was actually applied. The walk already escaped the
    // text, so decode it back: storing "A &amp; B" here would render as the
    // literal text "&amp;" (plainTextToHtml escapes again). Scripts are
    // dropped by the walk, so this stays safe where innerText is not.
    return markup
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/<br \/>/g, allowLineBreaks ? "\n" : " ");
  }
  return markup;
}
