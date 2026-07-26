import { render } from "solid-js/web";
import { createSignal, For, createEffect } from "solid-js";

export type BlockType =
  | "heading"
  | "text"
  | "image"
  | "button"
  | "section"
  | "divider"
  | "spacer"
  | "columns"
  | "card"
  | "gallery"
  | "quote"
  | "list"
  | "embed"
  | "feature"
  | "testimonial"
  | "accordion"
  | "stats"
  | "pricing"
  | "cta"
  | "html";

interface PaletteItem {
  type: BlockType;
  label: string;
  icon: string;
}

const PALETTE: PaletteItem[] = [
  { type: "heading", label: "Heading", icon: "heading" },
  { type: "text", label: "Text", icon: "align-left" },
  { type: "image", label: "Image", icon: "image" },
  { type: "button", label: "Button", icon: "square" },
  { type: "section", label: "Section", icon: "layout" },
  { type: "divider", label: "Divider", icon: "align-left" },
  { type: "spacer", label: "Spacer", icon: "layout" },
  { type: "columns", label: "Columns", icon: "layout-template" },
  { type: "card", label: "Card", icon: "square" },
  { type: "gallery", label: "Gallery", icon: "image" },
  { type: "quote", label: "Quote", icon: "align-left" },
  { type: "list", label: "List", icon: "align-left" },
  { type: "embed", label: "Embed", icon: "link" },
  { type: "feature", label: "Feature", icon: "star" },
  { type: "testimonial", label: "Testimonial", icon: "quote" },
  { type: "accordion", label: "FAQ / Accordion", icon: "chevron-down" },
  { type: "stats", label: "Stats", icon: "bar-chart" },
  { type: "pricing", label: "Pricing", icon: "tag" },
  { type: "cta", label: "Call to Action", icon: "megaphone" },
  { type: "html", label: "HTML", icon: "code-xml" },
];

const [allowedBlocks, setAllowedBlocks] = createSignal<string[] | null>(null);
let onInsertBlockCallback: ((type: BlockType) => void) | null = null;

function runIconRefresh() {
  setTimeout(() => {
    if (typeof window.refreshIcons === "function") {
      window.refreshIcons();
    }
  }, 0);
}

export function BlockPalette() {
  createEffect(() => {
    allowedBlocks();
    runIconRefresh();
  });

  const filteredPalette = () => {
    const allowed = allowedBlocks();
    if (!allowed) return PALETTE;
    return PALETTE.filter((item) => allowed.includes(item.type));
  };

  const handleKeyDown = (e: KeyboardEvent, item: PaletteItem) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onInsertBlockCallback?.(item.type);
    }
  };

  const handleDragStart = (e: DragEvent, item: PaletteItem) => {
    e.dataTransfer?.setData("text/zephus-new", item.type);
  };

  return (
    <For each={filteredPalette()}>
      {(item) => (
        <li
          draggable={true}
          tabIndex={0}
          role="button"
          aria-label={`Add ${item.label} block`}
          title={`Add ${item.label} (or drag onto the canvas)`}
          onClick={() => onInsertBlockCallback?.(item.type)}
          onKeyDown={(e) => handleKeyDown(e, item)}
          onDragStart={(e) => handleDragStart(e, item)}
        >
          <i data-lucide={item.icon}></i> <span>{item.label}</span>
        </li>
      )}
    </For>
  );
}

export function updateAllowedBlocks(allowed: string[] | null): void {
  setAllowedBlocks(allowed);
}

export function registerInsertBlockCallback(
  cb: (type: BlockType) => void,
): void {
  onInsertBlockCallback = cb;
}

export function mountBlockPalette(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <BlockPalette />, container);
}
