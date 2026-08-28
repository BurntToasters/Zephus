/** Minimal lucide icon injector, vendored from lucide's createIcons so the full icon-catalog alias map (119 KB) is not… */

type IconNode = [string, Record<string, unknown>][];

const DEFAULT_ATTRS = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 2,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
};

export function createElement(
  iconNode: IconNode,
  attrs: Record<string, unknown>,
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) svg.setAttribute(key, String(value));
  }
  for (const [tag, nodeAttrs] of iconNode) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(nodeAttrs)) {
      if (value !== undefined) element.setAttribute(key, String(value));
    }
    svg.appendChild(element);
  }
  return svg;
}

export function createIcons(options: {
  icons: Record<string, IconNode>;
  attrs?: Record<string, string>;
}): void {
  const { icons, attrs = {} } = options;
  const elements = Array.from(
    document.querySelectorAll<HTMLElement>("[data-lucide]"),
  );
  for (const element of elements) {
    const name = element.getAttribute("data-lucide") ?? "";
    const icon = icons[name];
    if (!icon) {
      console.warn(
        `<i data-lucide="${name}"></i> icon name was not found in the provided icons object.`,
      );
      continue;
    }
    const svg = createElement(icon, {
      ...DEFAULT_ATTRS,
      "data-lucide": name,
      "aria-hidden": "true",
      ...attrs,
    });
    for (const attr of Array.from(element.attributes)) {
      if (attr.name !== "data-lucide") svg.setAttribute(attr.name, attr.value);
    }
    element.replaceWith(svg);
  }
}
