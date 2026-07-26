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

  const handleKeyDown = (e: KeyboardEvent, tpl: SectionTemplate) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onInsertTemplateCallback?.(tpl);
    }
  };

  const handleDragStart = (e: DragEvent, tpl: SectionTemplate) => {
    e.dataTransfer?.setData("text/zephus-template", tpl.id);
  };

  return (
    <For each={templates()}>
      {(tpl) => (
        <li
          draggable={true}
          tabIndex={0}
          role="button"
          aria-label={`Insert ${tpl.label} section`}
          title={`Insert ${tpl.label} (or drag onto the canvas)`}
          onClick={() => onInsertTemplateCallback?.(tpl)}
          onKeyDown={(e) => handleKeyDown(e, tpl)}
          onDragStart={(e) => handleDragStart(e, tpl)}
        >
          <i data-lucide="layout-template"></i> <span>{tpl.label}</span>
          <Show when={tpl.deletable}>
            <button
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
