import { For } from "solid-js";
import { render } from "solid-js/web";

export interface AssetBrowserModalEntry {
  category: AssetEntry["category"];
  fileName: string;
  previewSrc?: string;
  size: number;
  webPath: string;
}

export interface AssetBrowserModalState {
  assets: AssetBrowserModalEntry[];
  dragActive: boolean;
  emptyMessage: string;
  onDragActiveChange: (active: boolean) => void;
  onDropFiles: (files: File[]) => void;
  onSelect: (webPath: string) => void;
  onRendered?: () => void;
}

const CATEGORY_ICONS: Record<AssetEntry["category"], string> = {
  images: "image",
  media: "play",
  documents: "file-code",
  other: "file-code",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function renderAssetBrowserModalBody(
  container: HTMLElement,
  state: AssetBrowserModalState,
): void {
  container.innerHTML = "";
  render(
    () => (
      <div class="asset-browser">
        <div
          class={`asset-dropzone${state.dragActive ? " dragover" : ""}`}
          tabindex="0"
          role="region"
          aria-label="Drop files here to import"
          onDragOver={(event) => {
            event.preventDefault();
            state.onDragActiveChange(true);
          }}
          onDragLeave={() => state.onDragActiveChange(false)}
          onDrop={(event) => {
            event.preventDefault();
            state.onDragActiveChange(false);
            state.onDropFiles(Array.from(event.dataTransfer?.files ?? []));
          }}
        >
          <span>Drag and drop files here, or use Import below</span>
        </div>

        <div class="asset-grid">
          {state.assets.length === 0 ? (
            <p class="muted">{state.emptyMessage}</p>
          ) : (
            <For each={state.assets}>
              {(asset) => (
                <button
                  type="button"
                  class="asset-tile"
                  title={`${asset.fileName} · ${formatBytes(asset.size)}`}
                  onClick={() => state.onSelect(asset.webPath)}
                >
                  <div class="asset-thumb">
                    {asset.previewSrc ? (
                      <img src={asset.previewSrc} alt={asset.fileName} />
                    ) : (
                      <i data-lucide={CATEGORY_ICONS[asset.category]} />
                    )}
                  </div>
                  <span class="asset-name">
                    {asset.fileName.split("/").pop() ?? asset.fileName}
                  </span>
                </button>
              )}
            </For>
          )}
        </div>
      </div>
    ),
    container,
  );
  state.onRendered?.();
}
