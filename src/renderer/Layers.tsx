import { render } from "solid-js/web";
import { For, Show, createSignal } from "solid-js";

export interface LayerChildEntry {
  id: string;
  label: string;
  active: boolean;
}

export interface LayerSectionEntry {
  id: string;
  label: string;
  active: boolean;
  children: LayerChildEntry[];
}

export interface LayersHandlers {
  onSelectSection: (id: string) => void;
  onSelectChild: (sectionId: string, childId: string) => void;
}

const [sections, setSections] = createSignal<LayerSectionEntry[]>([]);
let handlers: LayersHandlers | null = null;

export function LayersPanel() {
  return (
    <Show
      when={sections().length > 0}
      fallback={<li class="muted">No sections yet.</li>}
    >
      <For each={sections()}>
        {(section) => (
          <li classList={{ active: section.active }}>
            <button
              class="layer-button"
              onClick={() => handlers?.onSelectSection(section.id)}
            >
              {section.label}
            </button>

            <Show when={section.children.length > 0}>
              <div class="layer-children">
                <For each={section.children}>
                  {(child) => (
                    <button
                      classList={{
                        "layer-button": true,
                        muted: !child.active,
                      }}
                      onClick={() =>
                        handlers?.onSelectChild(section.id, child.id)
                      }
                    >
                      {child.label}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </li>
        )}
      </For>
    </Show>
  );
}

export function updateLayers(nextSections: LayerSectionEntry[]): void {
  setSections(nextSections);
}

export function registerLayersHandlers(nextHandlers: LayersHandlers): void {
  handlers = nextHandlers;
}

export function mountLayers(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <LayersPanel />, container);
}
