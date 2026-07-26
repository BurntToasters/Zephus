/** Shared HTML/CSS serialization helpers used by schema.ts and the renderer. */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

/**
 * Blocks dangerous URL schemes for href/src values. Returns "" for
 * javascript:/data:/vbscript:/file:.
 */
export function safeUrl(value: string): string {
  const trimmed = (value ?? "").trim();
  if (/^(javascript|vbscript|data|file):/i.test(trimmed)) return "";
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
    .map((item) => `<li>${plainTextToHtml(item)}</li>`)
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
  if (style.hideOn?.includes(viewport) && forCanvas) {
    css.push(`display:none`);
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
