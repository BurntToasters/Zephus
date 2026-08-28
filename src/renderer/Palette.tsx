import { render } from "solid-js/web";
import { createSignal, For, createEffect } from "solid-js";
import { PALETTE, PALETTE_ICONS, type BlockType } from "./editorBlocks";

interface PaletteItem {
  type: BlockType;
  label: string;
  icon: string;
}

// Single source of truth: the catalog in editorBlocks.ts (palette order,
// labels, icons). This palette must never drift from what the engine can
// insert.
const PALETTE_ITEMS: PaletteItem[] = PALETTE.map((entry) => ({
  type: entry.type,
  label: entry.label,
  icon: PALETTE_ICONS[entry.type],
}));

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
    if (!allowed) return PALETTE_ITEMS;
    return PALETTE_ITEMS.filter((item) => allowed.includes(item.type));
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
