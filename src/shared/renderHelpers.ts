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
