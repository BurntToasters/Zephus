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

/** Blocks dangerous URL schemes for href/src values. */
export function safeUrl(value: string): string {
  const trimmed = (value ?? "").trim();
  let stripped = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code > 0x1f) stripped += trimmed[i];
  }
  if (/^(javascript|vbscript|data|file):/i.test(stripped)) return "";
  return stripped;
}

const GOOGLE_FONT_STYLESHEET = /^https?:\/\/fonts\.googleapis\.com\//i;

/**
 * Stylesheet URL the editor and the generated layout may load.
 * Anything else is dropped so a site file cannot inject a stylesheet
 * into the editor document or the published head.
 */
export function googleFontStylesheetUrl(
  value: string | null | undefined,
): string {
  const trimmed = (value ?? "").trim();
  if (!GOOGLE_FONT_STYLESHEET.test(trimmed)) return "";
  return trimmed;
}

/**
 * Turns CSS escapes into the characters the browser would use. A style can
 * spell `url` as `\75 rl`, and the canvas would still request that address.
 */
export function decodeCssEscapes(value: string): string {
  return value.replace(
    /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([^\n\r\f])|[\n\r\f])/g,
    (_match, hex: string | undefined, other: string | undefined) => {
      if (hex === undefined) return other ?? "";
      const code = Number.parseInt(hex, 16);
      if (!Number.isFinite(code) || code === 0 || code > 0x10ffff) {
        return "\uFFFD";
      }
      try {
        return String.fromCodePoint(code);
      } catch {
        return "\uFFFD";
      }
    },
  );
}

/** Decodes nested CSS escapes and drops comments until the text stops changing. */
export function expandCssEscapes(value: string): string {
  let next = value;
  for (let i = 0; i < 8; i += 1) {
    const decoded = decodeCssEscapes(next).replace(/\/\*[\s\S]*?\*\//g, "");
    if (decoded === next) return next;
    next = decoded;
  }
  return next;
}

/**
 * Removes CSS that can fetch a URL. `url()` is not the only fetch: `image()`
 * and `image-set()` accept a plain string and the browser requests it.
 * `var()` and `calc()` stay intact.
 */
export function stripCssFetches(value: string): string {
  return value
    .replace(/url\s*\([^)]*\)?/gi, "")
    .replace(/(?:-webkit-)?image-set\s*\([^)]*\)?/gi, "")
    .replace(/\bimage\s*\([^)]*\)?/gi, "")
    .replace(/expression\s*\([^)]*\)?/gi, "")
    .replace(/@import/gi, "");
}

/**
 * Design-token text that is written into a CSS declaration and applied on
 * the editor canvas. Breakout characters are removed, and fetches are
 * removed so a token used as `background` cannot load a remote resource.
 * `var()` and `calc()` stay intact.
 */
export function designCssValue(value: string | null | undefined): string {
  const expanded = expandCssEscapes(value ?? "");
  return stripCssFetches(
    expanded.replace(/[;{}<>\\]/g, "").replace(/[\r\n]+/g, " "),
  )
    .trim()
    .slice(0, 200);
}

const ON_ACCENT_WHITE = "#ffffff";
const ON_ACCENT_INK = "#11131a";

function srgbChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: readonly [number, number, number]): number {
  return (
    0.2126 * srgbChannel(rgb[0]) +
    0.7152 * srgbChannel(rgb[1]) +
    0.0722 * srgbChannel(rgb[2])
  );
}

function contrastRatio(
  foreground: readonly [number, number, number],
  background: readonly [number, number, number],
): number {
  const lighter = relativeLuminance(foreground);
  const darker = relativeLuminance(background);
  const hi = Math.max(lighter, darker);
  const lo = Math.min(lighter, darker);
  return (hi + 0.05) / (lo + 0.05);
}

function parseSolidColor(
  value: string,
): readonly [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  const digits = hex?.[1];
  if (digits) {
    const body =
      digits.length === 3
        ? digits
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : digits;
    const parsed = Number.parseInt(body, 16);
    return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
  }
  const rgb =
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(?:1|0|0?\.\d+))?\s*\)$/i.exec(
      value.trim(),
    );
  const red = Number(rgb?.[1]);
  const green = Number(rgb?.[2]);
  const blue = Number(rgb?.[3]);
  if (
    !Number.isInteger(red) ||
    !Number.isInteger(green) ||
    !Number.isInteger(blue) ||
    red > 255 ||
    green > 255 ||
    blue > 255
  ) {
    return null;
  }
  return [red, green, blue];
}

/**
 * Text color for a solid accent fill. White stays when it clears 4.5:1.
 * A light custom accent switches to ink so the label stays readable.
 * Unparsed values keep the historical white label.
 */
export function onAccentText(accent: string | null | undefined): string {
  const background = parseSolidColor(accent ?? "");
  if (!background) return ON_ACCENT_WHITE;
  const white: readonly [number, number, number] = [255, 255, 255];
  const ink: readonly [number, number, number] = [17, 19, 26];
  if (contrastRatio(white, background) >= 4.5) return ON_ACCENT_WHITE;
  if (contrastRatio(ink, background) >= 4.5) return ON_ACCENT_INK;
  return contrastRatio(white, background) >= contrastRatio(ink, background)
    ? ON_ACCENT_WHITE
    : ON_ACCENT_INK;
}

/**
 * The color mixed into a filled accent on hover. White labels darken the
 * fill. Ink labels lighten it, so a vivid accent does not fall under 4.5:1
 * when the pointer is over the button.
 */
export function accentHoverMix(accent: string | null | undefined): string {
  return onAccentText(accent) === ON_ACCENT_INK ? "#ffffff" : "#000000";
}

const ACCENT_INK_FLOOR = 4.5;

function hexChannels(rgb: readonly [number, number, number]): string {
  return (
    "#" + rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")
  );
}

function mixChannels(
  color: readonly [number, number, number],
  target: readonly [number, number, number],
  amount: number,
): readonly [number, number, number] {
  return [
    Math.round(color[0] + (target[0] - color[0]) * amount),
    Math.round(color[1] + (target[1] - color[1]) * amount),
    Math.round(color[2] + (target[2] - color[2]) * amount),
  ];
}

/**
 * The site header lifts the surface 8% toward white. Nav hover text is the
 * accent ink, so that lifted color has to stay in the readable set.
 */
function shellHeaderPlane(
  surface: readonly [number, number, number],
): readonly [number, number, number] {
  return mixChannels(surface, [255, 255, 255], 0.08);
}

/**
 * Accent used as text or a large numeral. The chosen accent stays when it
 * already clears 4.5:1 on the page background, on cards, and on the lifted
 * header. A light accent on a light page is darkened, and a dark accent on a
 * dark page is lightened.
 */
export function accentInk(
  accent: string | null | undefined,
  background: string | null | undefined,
  surface?: string | null,
): string {
  const original = (accent ?? "").trim();
  const foreground = parseSolidColor(original);
  if (!foreground) return designCssValue(original) || "#4f46e5";
  const parsedSurface = parseSolidColor(surface ?? "");
  const planes = [parseSolidColor(background ?? ""), parsedSurface].filter(
    (value): value is readonly [number, number, number] => value !== null,
  );
  if (parsedSurface) planes.push(shellHeaderPlane(parsedSurface));
  const surfaces = planes.length > 0 ? planes : ([[255, 255, 255]] as const);
  const readable = (color: readonly [number, number, number]) =>
    surfaces.every((plane) => contrastRatio(color, plane) >= ACCENT_INK_FLOOR);
  if (readable(foreground)) return original;
  const toward: ReadonlyArray<readonly [number, number, number]> = [
    [17, 19, 26],
    [255, 255, 255],
  ];
  let best = foreground;
  let bestScore = Math.min(
    ...surfaces.map((plane) => contrastRatio(foreground, plane)),
  );
  for (const target of toward) {
    for (let step = 1; step <= 8; step += 1) {
      const next = mixChannels(foreground, target, step / 8);
      const score = Math.min(
        ...surfaces.map((plane) => contrastRatio(next, plane)),
      );
      if (score > bestScore) {
        best = next;
        bestScore = score;
      }
      if (readable(next)) return hexChannels(next);
    }
  }
  return hexChannels(best);
}

/**
 * Logo and resting nav color. The header lifts the surface 8% toward white,
 * so a foreground that just clears the page can fall under 4.5:1 there.
 * Body text keeps the chosen foreground. Unparsed colors stay as given.
 */
export function headerText(
  foreground: string | null | undefined,
  surface: string | null | undefined,
): string {
  const original = (foreground ?? "").trim();
  const ink = parseSolidColor(original);
  const plane = parseSolidColor(surface ?? "");
  if (!ink || !plane) return designCssValue(original) || "#0f172a";
  const header = shellHeaderPlane(plane);
  if (contrastRatio(ink, header) >= ACCENT_INK_FLOOR) return original;
  const target: readonly [number, number, number] =
    relativeLuminance(ink) >= relativeLuminance(header)
      ? [255, 255, 255]
      : [17, 19, 26];
  let best = ink;
  let bestScore = contrastRatio(ink, header);
  for (let step = 1; step <= 100; step += 1) {
    const next = mixChannels(ink, target, step / 100);
    const score = contrastRatio(next, header);
    if (score > bestScore) {
      best = next;
      bestScore = score;
    }
    if (score >= ACCENT_INK_FLOOR) return hexChannels(next);
  }
  return hexChannels(best);
}

/**
 * How much of the foreground to keep in muted text such as a lead or a
 * caption. The historical mix is `minimumPercent`. A lighter foreground
 * keeps more of itself so the text still clears 4.5:1 on the page and on
 * cards. Unparsed colors keep the historical mix.
 */
export function mutedForegroundPercent(
  foreground: string | null | undefined,
  background: string | null | undefined,
  surface: string | null | undefined,
  minimumPercent: number,
): number {
  const ink = parseSolidColor(foreground ?? "");
  const floor = Math.max(0, Math.min(100, Math.round(minimumPercent)));
  if (!ink) return floor;
  const planes = [background, surface]
    .map((value) => parseSolidColor(value ?? ""))
    .filter(
      (value): value is readonly [number, number, number] => value !== null,
    );
  const surfaces = planes.length > 0 ? planes : ([[255, 255, 255]] as const);
  for (let percent = floor; percent <= 100; percent += 1) {
    const towardPlane = 1 - percent / 100;
    const readable = surfaces.every((plane) => {
      const mixed = mixChannels(ink, plane, towardPlane);
      return contrastRatio(mixed, plane) >= ACCENT_INK_FLOOR;
    });
    if (readable) return percent;
  }
  return 100;
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
  /** Set false where the result is placed inside an `<a>` (button, CTA, pricing button); nested anchors are invalid HTML. */
  allowLinks?: boolean;
}

/** Renders a text prop that may contain a small inline formatting subset (`strong`, `em`, `u`, `s`, `code`, `br`, `a`). */
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
  const style = mergeViewportStyle(block.style, viewport);
  const css: string[] = [];
  const pushCss = (property: string, value: unknown): void => {
    if (!options.forCanvas) {
      addCssValue(css, property, value);
      return;
    }
    // The canvas is the editor document. A color field that contains url()
    // would make the editor fetch a remote image. The published stylesheet
    // still receives the original value.
    const safe = blockCssValue(value);
    if (!safe) return;
    const stripped = designCssValue(safe);
    if (stripped) css.push(`${property}:${stripped}`);
  };
  if (["left", "center", "right"].includes(String(style.align))) {
    css.push(`text-align:${style.align}`);
  }
  pushCss("width", style.width);
  pushCss("height", style.height);
  pushCss("max-width", style.maxWidth);
  pushCss("background", style.background);
  pushCss("color", style.color);
  pushCss("padding", style.padding);
  pushCss("margin", style.margin);
  pushCss("border-radius", style.radius);
  pushCss("gap", style.gap);
  pushCss("aspect-ratio", style.aspectRatio);
  pushCss("object-fit", style.objectFit);
  pushCss("object-position", style.objectPosition);
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
  // hideOn visibility on the built site is handled only in collectResponsiveCss
  // (media queries). The canvas keeps hidden elements visible with a dashed
  // outline so they stay selectable — never inline display:none here.
  if (block.type === "spacer" && !style.height) {
    pushCss("height", block.props["height"] || "48px");
  }
  return css.length ? ` style="${escapeAttr(css.join(";"))}"` : "";
}

export function classAttr(block: { props: Record<string, string> }): string {
  const cls = block.props["cls"];
  return cls ? ` class="${escapeAttr(cls)}"` : "";
}
