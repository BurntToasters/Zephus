import { For, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { render } from "solid-js/web";
import { layerTabStop, onLayerKeyDown } from "./layerKeyboard";

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

const [sections, setSections] = createStore<LayerSectionEntry[]>([]);
let handlers: LayersHandlers | null = null;

function anyLayerActive(): boolean {
  return sections.some(
    (section) =>
      section.active || section.children.some((child) => child.active),
  );
}

export function LayersPanel() {
  return (
    <Show
      when={sections.length > 0}
      fallback={<li class="muted">No sections yet.</li>}
    >
      <For each={sections}>
        {(section, index) => (
          <li classList={{ active: section.active }}>
            <button
              type="button"
              class="layer-button"
              data-layer-id={section.id}
              aria-current={section.active ? "true" : undefined}
              tabIndex={layerTabStop(
                section.active,
                index() === 0 && !anyLayerActive(),
              )}
              onClick={() => handlers?.onSelectSection(section.id)}
              onKeyDown={onLayerKeyDown}
            >
              {section.label}
            </button>

            <Show when={section.children.length > 0}>
              <div class="layer-children">
                <For each={section.children}>
                  {(child) => (
                    <button
                      type="button"
                      classList={{
                        "layer-button": true,
                        active: child.active,
                        muted: !child.active,
                      }}
                      data-layer-id={child.id}
                      aria-current={child.active ? "true" : undefined}
                      tabIndex={layerTabStop(child.active, false)}
                      onClick={() =>
                        handlers?.onSelectChild(section.id, child.id)
                      }
                      onKeyDown={onLayerKeyDown}
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
  setSections(reconcile(nextSections, { key: "id" }));
}

export function registerLayersHandlers(nextHandlers: LayersHandlers): void {
  handlers = nextHandlers;
}

export function mountLayers(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <LayersPanel />, container);
}
