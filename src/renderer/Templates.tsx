import { render } from "solid-js/web";
import { Show, createSignal, For, createEffect } from "solid-js";
import {
  onTemplateKeyDown,
  templateStop,
  templateTabStop,
} from "./templateKeyboard";

export interface SectionTemplate {
  id: string;
  label: string;
  html?: string;
  deletable?: boolean;
  onDelete?: () => void | Promise<void>;
}

const [templates, setTemplates] = createSignal<SectionTemplate[]>([]);
const [tabStop, setTabStop] = createSignal<{
  id: string;
  kind: "insert" | "delete";
} | null>(null);
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

  const stop = () => {
    const active = tabStop();
    return templateStop(templates(), active?.id ?? null, active?.kind ?? null);
  };

  const rememberStop = (event: KeyboardEvent) => {
    onTemplateKeyDown(event);
    const current = event.currentTarget;
    if (!(current instanceof HTMLElement)) return;
    const active = current.ownerDocument.activeElement;
    if (!(active instanceof HTMLButtonElement)) return;
    const id = active.dataset["templateId"];
    const kind = active.dataset["templateAction"];
    if (!id || (kind !== "insert" && kind !== "delete")) return;
    setTabStop({ id, kind });
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
            class="palette-insert-btn template-insert-btn"
            title={`Insert ${tpl.label}`}
            data-template-id={tpl.id}
            data-template-action="insert"
            tabIndex={templateTabStop(
              tpl.id,
              "insert",
              stop()?.id ?? null,
              stop()?.kind ?? null,
            )}
            onKeyDown={rememberStop}
            onClick={() => {
              setTabStop({ id: tpl.id, kind: "insert" });
              onInsertTemplateCallback?.(tpl);
            }}
          >
            <i data-lucide="layout-template"></i> <span>{tpl.label}</span>
          </button>
          <Show when={tpl.deletable}>
            <button
              type="button"
              class="mini-btn template-delete-btn"
              aria-label={`Delete saved section ${tpl.label}`}
              data-template-id={tpl.id}
              data-template-action="delete"
              tabIndex={templateTabStop(
                tpl.id,
                "delete",
                stop()?.id ?? null,
                stop()?.kind ?? null,
              )}
              onKeyDown={rememberStop}
              onClick={(event) => {
                event.stopPropagation();
                setTabStop({ id: tpl.id, kind: "delete" });
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
