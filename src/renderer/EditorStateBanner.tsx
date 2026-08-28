import { render } from "solid-js/web";
import { For, createSignal } from "solid-js";

export interface EditorBannerAction {
  label: string;
  onClick: () => void;
}

export interface EditorBannerItem {
  tone: "warning" | "info";
  message: string;
  actions: EditorBannerAction[];
}

const [items, setItems] = createSignal<EditorBannerItem[]>([]);

export function EditorStateBannerPanel() {
  return (
    <For each={items()}>
      {(item) => (
        <div class={`editor-banner-item ${item.tone}`}>
          <p class="editor-banner-copy">{item.message}</p>
          <div class="editor-banner-actions">
            <For each={item.actions}>
              {(action) => (
                <button class="mini-btn" onClick={action.onClick}>
                  {action.label}
                </button>
              )}
            </For>
          </div>
        </div>
      )}
    </For>
  );
}

export function updateEditorStateBanners(nextItems: EditorBannerItem[]): void {
  setItems(nextItems);
}

export function mountEditorStateBanner(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <EditorStateBannerPanel />, container);
}
