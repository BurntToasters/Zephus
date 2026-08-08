/** Shared HTML/CSS serialization helpers used by schema.ts and the renderer. */

export function escapeHtml(value: string): string {
  return (
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Astro evaluates {...} in text as JS expressions ("{ brace }" compiles
      // to "${ brace }" → ReferenceError at build). Entity-escape braces in
      // text too — the browser renders &#123; as "{" — matching what the attr
      // path (escapeAstroAttr) already does. The entity round-trips through the
      // DOM parsers, so stored text and built output stay in sync.
      .replace(/\{/g, "&#123;")
      .replace(/\}/g, "&#125;")
  );
}

export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

/**
 * Blocks dangerous URL schemes for href/src values. Returns "" for
 * javascript:/data:/vbscript:/file:. ASCII tabs/newlines are stripped first,
 * mirroring WHATWG URL parsing (browsers execute "java<tab>script:..." since
 * they strip those characters before scheme detection).
 */
export function safeUrl(value: string): string {
  const trimmed = (value ?? "").trim();
  const normalized = trimmed.replace(/[\t\n\r]/g, "");
  if (/^(javascript|vbscript|data|file):/i.test(normalized)) return "";
  return trimmed;
}

/** Encodes a value as a URI-encoded JSON payload for a data-* attribute. */
export function encodeDataPayload(value: unknown): string {
  return encodeURIComponent(JSON.stringify(value)).replace(/'/g, "%27");
}

export function blockCssValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /[;{}<>\r\n]/.test(trimmed)) return null;
  return trimmed.slice(0, 240);
}

export function addCssValue(
  css: string[],
  property: string,
  value: unknown,
): void {
  const safe = blockCssValue(value);
  if (safe) css.push(`${property}:${safe}`);
}

export function plainTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br />");
}

/* ---------- Inline rich text ---------- */

/** Inline tags Zephus stores in text props, mapped to their canonical form. */
const RICH_TAG_ALIASES: Record<string, string> = {
  b: "strong",
  strong: "strong",
  i: "em",
  em: "em",
  u: "u",
  s: "s",
  del: "s",
  strike: "s",
  code: "code",
};

/**
 * True when a value contains inline markup Zephus itself wrote. Values without
 * it are rendered by `plainTextToHtml`, so text authored before inline
 * formatting existed (including literal entity-looking text) is untouched.
 */
const RICH_MARKUP_PATTERN =
  /<\/?(?:strong|b|em|i|u|s|del|strike|code|br|a)\b[^>]*>/i;

export function hasRichTextMarkup(value: string): boolean {
  return RICH_MARKUP_PATTERN.test(value ?? "");
}

const ENTITY_PATTERN =
  /^&(?:[a-zA-Z][a-zA-Z0-9]{1,30}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});/;

/**
 * Escapes text that may already contain entities produced by the editor, so
 * `&lt;` stays a literal `<` instead of becoming `&amp;lt;`.
 */
function escapeRichText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i] as string;
    if (char === "&") {
      if (ENTITY_PATTERN.test(value.slice(i))) {
        const end = value.indexOf(";", i);
        out += value.slice(i, end + 1);
        i = end;
        continue;
      }
      out += "&amp;";
    } else if (char === "<") {
      out += "&lt;";
    } else if (char === ">") {
      out += "&gt;";
    } else if (char === "{") {
      // Same Astro expression hazard as escapeHtml.
      out += "&#123;";
    } else if (char === "}") {
      out += "&#125;";
    } else if (char === "\n") {
      out += "<br />";
    } else {
      out += char;
    }
  }
  return out;
}

function readAttr(attrs: string, name: string): string {
  const match = attrs.match(
    new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"),
  );
  return match?.[2] ?? match?.[3] ?? "";
}

export interface RichTextOptions {
  /**
   * Set false where the result is placed inside an `<a>` (button, CTA, pricing
   * button); nested anchors are invalid HTML.
   */
  allowLinks?: boolean;
}

/**
 * Renders a text prop that may contain a small inline formatting subset
 * (`strong`, `em`, `u`, `s`, `code`, `br`, `a`). Everything else is escaped, so
 * this is safe for untrusted values: no other tags, no attributes besides a
 * `safeUrl`-checked `href`, and never any event handlers.
 *
 * Mirrored usage between the editor canvas and the build output — both call
 * this same function, so rendered markup stays byte-identical.
 */
export function richTextToHtml(
  text: string,
  options: RichTextOptions = {},
): string {
  const value = text ?? "";
  if (!hasRichTextMarkup(value)) return plainTextToHtml(value);

  const allowLinks = options.allowLinks !== false;
  const open: string[] = [];
  let out = "";
  let index = 0;
  let skippedAnchors = 0;

  const closeThrough = (tag: string): void => {
    if (!open.includes(tag)) return;
    for (;;) {
      const current = open.pop();
      if (!current) break;
      out += `</${current}>`;
      if (current === tag) break;
    }
  };

  while (index < value.length) {
    const lt = value.indexOf("<", index);
    if (lt === -1) {
      out += escapeRichText(value.slice(index));
      break;
    }
    out += escapeRichText(value.slice(index, lt));
    const gt = value.indexOf(">", lt);
    if (gt === -1) {
      out += escapeRichText(value.slice(lt));
      break;
    }

    const rawTag = value.slice(lt + 1, gt);
    index = gt + 1;
    const parsed = rawTag.match(/^\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([\s\S]*)$/);
    if (!parsed) {
      out += escapeRichText(`<${rawTag}>`);
      continue;
    }
    const closing = parsed[1] === "/";
    const name = (parsed[2] ?? "").toLowerCase();
    const attrs = parsed[3] ?? "";

    if (name === "br") {
      if (!closing) out += "<br />";
      continue;
    }

    if (name === "a") {
      if (!allowLinks) continue;
      if (closing) {
        if (skippedAnchors > 0) skippedAnchors -= 1;
        else closeThrough("a");
        continue;
      }
      if (open.includes("a")) {
        // Nested anchors are invalid; keep the inner text, drop the tag.
        skippedAnchors += 1;
        continue;
      }
      const href = safeUrl(readAttr(attrs, "href"));
      out += `<a href="${escapeAttr(href || "#")}">`;
      open.push("a");
      continue;
    }

    const mapped = RICH_TAG_ALIASES[name];
    if (!mapped) {
      out += escapeRichText(`<${rawTag}>`);
      continue;
    }
    if (closing) closeThrough(mapped);
    else {
      out += `<${mapped}>`;
      open.push(mapped);
    }
  }

  while (open.length > 0) out += `</${open.pop()}>`;
  return out;
}

export function splitLines(raw: string): string[] {
  return (raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Splits "left :: right" into a tuple; right is "" when no separator. */
export function splitPair(line: string, sep = "::"): [string, string] {
  const i = line.indexOf(sep);
  if (i < 0) return [line.trim(), ""];
  return [line.slice(0, i).trim(), line.slice(i + sep.length).trim()];
}

export function renderListItems(items: string): string {
  return items
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `<li>${richTextToHtml(item)}</li>`)
    .join("");
}

/** Minimal block shape needed for Zephus data-* metadata attributes. */
export interface BlockMetadataSource {
  id: string;
  type: string;
  props: Record<string, string>;
  style?: unknown;
  locked?: boolean;
}

/** Emits leading-space data-zephus-* attributes for a block or section node. */
export function blockMetadataAttrs(block: BlockMetadataSource): string {
  const attrs = [
    `data-zephus-id="${escapeAttr(block.id)}"`,
    `data-zephus-block="${escapeAttr(block.type)}"`,
    `data-zephus-props="${escapeAttr(encodeDataPayload(block.props))}"`,
  ];
  if (block.style) {
    attrs.push(
      `data-zephus-style="${escapeAttr(encodeDataPayload(block.style))}"`,
    );
  }
  if (block.locked) attrs.push(`data-zephus-locked="true"`);
  return " " + attrs.join(" ");
}

export type StyleViewport = "desktop" | "tablet" | "mobile";

export interface StyleAttrBlock {
  type: string;
  props: Record<string, string>;
  style?: {
    align?: string;
    width?: string;
    height?: string;
    maxWidth?: string;
    background?: string;
    color?: string;
    padding?: string;
    margin?: string;
    radius?: string;
    shadow?: string;
    columns?: string;
    gap?: string;
    aspectRatio?: string;
    objectFit?: string;
    objectPosition?: string;
    stackOnMobile?: boolean;
    hideOn?: string[];
    responsive?: Partial<
      Record<
        StyleViewport,
        {
          align?: string;
          width?: string;
          height?: string;
          maxWidth?: string;
          padding?: string;
          margin?: string;
          columns?: string;
          gap?: string;
        }
      >
    >;
  };
}

export interface StyleAttrOptions {
  /** Canvas viewport preview. Build output should leave this as desktop. */
  viewport?: StyleViewport;
  /** When true, honor hideOn for the active viewport (editor canvas only). */
  forCanvas?: boolean;
}

/** Merges tablet/mobile responsive overrides onto a cloned base style. */
export function mergeViewportStyle(
  style: StyleAttrBlock["style"] | undefined,
  viewport: StyleViewport = "desktop",
): NonNullable<StyleAttrBlock["style"]> {
  const base = (style ? JSON.parse(JSON.stringify(style)) : {}) as NonNullable<
    StyleAttrBlock["style"]
  >;
  if (viewport !== "desktop") {
    const override = style?.responsive?.[viewport];
    if (override) Object.assign(base, override);
  }
  return base;
}

/**
 * Builds an inline style="" attribute for a block/section. Build uses desktop
 * base styles (+ separate media queries); the editor can pass viewport/forCanvas
 * to preview responsive and hideOn behavior on the canvas.
 */
export function styleAttr(
  block: StyleAttrBlock,
  options: StyleAttrOptions = {},
): string {
  const viewport = options.viewport ?? "desktop";
  const forCanvas = options.forCanvas ?? false;
  const style = mergeViewportStyle(block.style, viewport);
  const css: string[] = [];
  if (["left", "center", "right"].includes(String(style.align))) {
    css.push(`text-align:${style.align}`);
  }
  addCssValue(css, "width", style.width);
  addCssValue(css, "height", style.height);
  addCssValue(css, "max-width", style.maxWidth);
  addCssValue(css, "background", style.background);
  addCssValue(css, "color", style.color);
  addCssValue(css, "padding", style.padding);
  addCssValue(css, "margin", style.margin);
  addCssValue(css, "border-radius", style.radius);
  addCssValue(css, "gap", style.gap);
  addCssValue(css, "aspect-ratio", style.aspectRatio);
  addCssValue(css, "object-fit", style.objectFit);
  addCssValue(css, "object-position", style.objectPosition);
  if (style.columns && (block.type === "columns" || block.type === "gallery")) {
    css.push(
      `grid-template-columns:repeat(${Math.max(1, Number(style.columns) || 1)}, minmax(0, 1fr))`,
    );
  }
  if (style.shadow === "sm") css.push(`box-shadow:var(--shadow-sm)`);
  if (style.shadow === "md") css.push(`box-shadow:var(--shadow-md)`);
  if (style.shadow === "lg") css.push(`box-shadow:var(--shadow-lg)`);
  if (
    style.stackOnMobile &&
    viewport === "mobile" &&
    block.type === "columns"
  ) {
    css.push(`grid-template-columns:1fr`);
  }
  if (style.hideOn?.includes(viewport) && !forCanvas) {
    // Build: hide inline for the desktop viewport (tablet/mobile hiding comes
    // from collectResponsiveCss media queries). The canvas keeps hidden
    // elements visible with a dashed outline so they stay selectable.
    css.push("display:none");
  }
  if (block.type === "spacer" && !style.height) {
    addCssValue(css, "height", block.props["height"] || "48px");
  }
  return css.length ? ` style="${escapeAttr(css.join(";"))}"` : "";
}

export function classAttr(block: { props: Record<string, string> }): string {
  const cls = block.props["cls"];
  return cls ? ` class="${escapeAttr(cls)}"` : "";
}
