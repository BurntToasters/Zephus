import { render } from "solid-js/web";
import { Show, createSignal, For, createEffect } from "solid-js";

export interface SectionTemplate {
  id: string;
  label: string;
  html?: string;
  deletable?: boolean;
  onDelete?: () => void | Promise<void>;
}

const [templates, setTemplates] = createSignal<SectionTemplate[]>([]);
let onInsertTemplateCallback: ((tpl: SectionTemplate) => void) | null = null;

function runIconRefresh() {
  setTimeout(() => {
    if (typeof window.refreshIcons === "function") {
      window.refreshIcons();
    }
  }, 0);
}

export function TemplatePalette() {
  createEffect(() => {
    templates();
    runIconRefresh();
  });

  const handleDragStart = (e: DragEvent, tpl: SectionTemplate) => {
    e.dataTransfer?.setData("text/zephus-template", tpl.id);
  };

  return (
    <For each={templates()}>
      {(tpl) => (
        <li
          draggable={true}
          title={`Insert ${tpl.label} (or drag onto the canvas)`}
          onDragStart={(e) => handleDragStart(e, tpl)}
        >
          <button
            type="button"
            class="palette-insert-btn"
            title={`Insert ${tpl.label}`}
            onClick={() => onInsertTemplateCallback?.(tpl)}
          >
            <i data-lucide="layout-template"></i> <span>{tpl.label}</span>
          </button>
          <Show when={tpl.deletable}>
            <button
              type="button"
              class="mini-btn"
              onClick={(event) => {
                event.stopPropagation();
                void tpl.onDelete?.();
              }}
            >
              Delete
            </button>
          </Show>
        </li>
      )}
    </For>
  );
}

export function updateTemplates(list: SectionTemplate[]): void {
  setTemplates(list);
}

export function registerInsertTemplateCallback(
  cb: (tpl: SectionTemplate) => void,
): void {
  onInsertTemplateCallback = cb;
}

export function mountTemplatePalette(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <TemplatePalette />, container);
}
