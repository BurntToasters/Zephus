/** Canvas layout and section paint. The editor document must not request the URLs a section background can carry. */

import { blockCssValue, designCssValue } from "../shared/renderHelpers";

/** One CSS value safe to assign on the editor canvas. */
export function canvasVisualValue(value: string | undefined): string {
  if (!value) return "";
  const safe = blockCssValue(value);
  if (!safe) return "";
  return designCssValue(safe);
}

export function boxStyle(style?: BlockStyle): Record<string, string> {
  // The wrapper must NOT duplicate the visual style declarations: the inner
  // element already carries padding/margin/background/color/radius/shadow.
  // Applying them here too makes the canvas show ~2x padding/margins. Only
  // the outer layout box belongs on the wrapper.
  const width = canvasVisualValue(style?.width);
  const height = canvasVisualValue(style?.height);
  const maxWidth = canvasVisualValue(style?.maxWidth);
  const next: Record<string, string> = {
    "box-sizing": "border-box",
    "max-width": maxWidth ? `min(${maxWidth}, 100%)` : "100%",
  };
  if (width) next.width = width;
  if (height) next.height = height;
  return next;
}

/**
 * The section's visual declarations for the canvas content area. The build
 * puts these on the real section. The canvas section wrapper only carries
 * the layout box, so without this the canvas never showed a section's
 * background, padding, align, radius, or shadow.
 */
export function sectionVisualStyle(style?: BlockStyle): Record<string, string> {
  const next: Record<string, string> = {};
  if (["left", "center", "right"].includes(String(style?.align))) {
    next["text-align"] = style!.align as string;
  }
  const set = (prop: string, value?: string): void => {
    const safe = canvasVisualValue(value);
    if (safe) next[prop] = safe;
  };
  set("background", style?.background);
  set("color", style?.color);
  set("padding", style?.padding);
  set("margin", style?.margin);
  set("border-radius", style?.radius);
  if (style?.shadow === "sm") next["box-shadow"] = "var(--shadow-sm)";
  if (style?.shadow === "md") next["box-shadow"] = "var(--shadow-md)";
  if (style?.shadow === "lg") next["box-shadow"] = "var(--shadow-lg)";
  return next;
}
