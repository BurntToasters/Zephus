import { For, createSignal } from "solid-js";
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
  /** Omitted when the browser is opened purely to pick a file. */
  onRename?: (asset: AssetBrowserModalEntry) => void;
  onDelete?: (asset: AssetBrowserModalEntry) => void;
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
): () => void {
  container.innerHTML = "";
  return render(() => {
    // Drag state lives in a local signal: re-rendering the whole modal on
    // dragover would destroy the drop target mid-drag and cancel the drop.
    const [dragover, setDragover] = createSignal(state.dragActive);
    // dragenter/dragleave fire per child element, so depth-count them.
    let dragDepth = 0;
    const markDrag = (active: boolean): void => {
      setDragover(active);
      state.onDragActiveChange(active);
    };
    return (
      <div class="asset-browser">
        <div
          class={`asset-dropzone${dragover() ? " dragover" : ""}`}
          tabindex="0"
          role="region"
          aria-label="Drop files here to import"
          onDragEnter={(event) => {
            event.preventDefault();
            dragDepth += 1;
            markDrag(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => {
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) markDrag(false);
          }}
          onDragEnd={() => {
            // Esc/gesture-cancel mid-drag used to leave dragDepth > 0 — a
            // permanent "dragover" highlight until the next drag. dragend
            // fires after both drop and cancel.
            if (dragDepth > 0) {
              dragDepth = 0;
              markDrag(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            dragDepth = 0;
            markDrag(false);
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
              {(asset) => {
                const displayName =
                  asset.fileName.split("/").pop() ?? asset.fileName;
                return (
                  <div class="asset-tile-wrap">
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
                      <span class="asset-name">{displayName}</span>
                      <span class="asset-size">{formatBytes(asset.size)}</span>
                    </button>
                    {state.onRename || state.onDelete ? (
                      <div class="asset-tile-actions">
                        {state.onRename ? (
                          <button
                            type="button"
                            class="mini-btn"
                            title={`Rename ${displayName}`}
                            aria-label={`Rename ${displayName}`}
                            onClick={() => state.onRename?.(asset)}
                          >
                            <i data-lucide="pencil" />
                          </button>
                        ) : null}
                        {state.onDelete ? (
                          <button
                            type="button"
                            class="mini-btn danger"
                            title={`Delete ${displayName}`}
                            aria-label={`Delete ${displayName}`}
                            onClick={() => state.onDelete?.(asset)}
                          >
                            <i data-lucide="trash-2" />
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              }}
            </For>
          )}
        </div>
      </div>
    );
  }, container);
  state.onRendered?.();
}
