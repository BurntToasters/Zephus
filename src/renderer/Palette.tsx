import { render } from "solid-js/web";
import { createSignal, For, Show, createEffect } from "solid-js";
import { PALETTE, PALETTE_ICONS, type BlockType } from "./editorBlocks";

interface PaletteItem {
  type: BlockType;
  label: string;
  icon: string;
  category: string;
}

const CATEGORY_ORDER = [
  "Structure & Prose",
  "Media & Interactive",
  "Marketing & Sections",
  "Dynamic & Custom",
] as const;

const BLOCK_CATEGORY: Record<BlockType, (typeof CATEGORY_ORDER)[number]> = {
  section: "Structure & Prose",
  columns: "Structure & Prose",
  heading: "Structure & Prose",
  text: "Structure & Prose",
  list: "Structure & Prose",
  quote: "Structure & Prose",
  divider: "Structure & Prose",
  spacer: "Structure & Prose",
  image: "Media & Interactive",
  gallery: "Media & Interactive",
  video: "Media & Interactive",
  embed: "Media & Interactive",
  button: "Media & Interactive",
  accordion: "Media & Interactive",
  card: "Marketing & Sections",
  feature: "Marketing & Sections",
  testimonial: "Marketing & Sections",
  stats: "Marketing & Sections",
  pricing: "Marketing & Sections",
  cta: "Marketing & Sections",
  postlist: "Dynamic & Custom",
  html: "Dynamic & Custom",
};

// Single source of truth: the catalog in editorBlocks.ts (palette order,
// labels, icons). This palette must never drift from what the engine can
// insert.
const PALETTE_ITEMS: PaletteItem[] = PALETTE.map((entry) => ({
  type: entry.type,
  label: entry.label,
  icon: PALETTE_ICONS[entry.type],
  category: BLOCK_CATEGORY[entry.type] ?? "Dynamic & Custom",
}));

const [allowedBlocks, setAllowedBlocks] = createSignal<string[] | null>(null);
const [query, setQuery] = createSignal("");
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
    query();
    runIconRefresh();
  });

  const filteredPalette = () => {
    const allowed = allowedBlocks();
    const q = query().trim().toLowerCase();
    return PALETTE_ITEMS.filter((item) => {
      if (allowed && !allowed.includes(item.type)) return false;
      if (
        q &&
        !item.label.toLowerCase().includes(q) &&
        !item.type.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  };

  const groupedPalette = () => {
    const items = filteredPalette();
    return CATEGORY_ORDER.map((title) => ({
      title,
      items: items.filter((item) => item.category === title),
    })).filter((group) => group.items.length > 0);
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
    <>
      <li class="palette-search-item" role="none">
        <i data-lucide="search" aria-hidden="true"></i>
        <input
          type="search"
          class="palette-search-input"
          placeholder="Filter blocks..."
          aria-label="Filter blocks"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </li>
      <Show
        when={groupedPalette().length > 0}
        fallback={
          <li class="palette-empty-state" role="status">
            No matching blocks
          </li>
        }
      >
        <For each={groupedPalette()}>
          {(group) => (
            <>
              <li class="palette-category-header" role="presentation">
                {group.title}
              </li>
              <For each={group.items}>
                {(item) => (
                  <li
                    draggable={true}
                    data-block={item.type}
                    tabIndex={0}
                    role="button"
                    aria-label={`Add ${item.label} block`}
                    title={`Add ${item.label} (or drag onto the canvas)`}
                    onClick={() => onInsertBlockCallback?.(item.type)}
                    onKeyDown={(e) => handleKeyDown(e, item)}
                    onDragStart={(e) => handleDragStart(e, item)}
                  >
                    <i data-lucide={item.icon} aria-hidden="true"></i>{" "}
                    <span>{item.label}</span>
                  </li>
                )}
              </For>
            </>
          )}
        </For>
      </Show>
    </>
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
