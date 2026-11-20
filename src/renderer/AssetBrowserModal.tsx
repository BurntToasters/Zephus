import { For, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { isAcceptedImageDataUrl } from "../shared/assetPreview";
import {
  assetStop,
  assetTabStop,
  onAssetKeyDown,
  type AssetAction,
} from "./assetKeyboard";

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
  /** Tab stop to restore after the grid is rebuilt. */
  initialStop?: { webPath: string; kind: AssetAction } | null;
  /** Omitted when the browser is opened purely to pick a file. */
  onRename?: (asset: AssetBrowserModalEntry) => void;
  onDelete?: (asset: AssetBrowserModalEntry) => void;
  /** Shown in the dialog. The status bar is covered while this dialog is open. */
  formError?: string;
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
  const dispose = render(() => {
    // Drag state lives in a local signal: re-rendering the whole modal on
    // dragover would destroy the drop target mid-drag and cancel the drop.
    const [dragover, setDragover] = createSignal(state.dragActive);
    const [tabStop, setTabStop] = createSignal<{
      webPath: string;
      kind: AssetAction;
    } | null>(state.initialStop ?? null);
    // dragenter/dragleave fire per child element, so depth-count them.
    let dragDepth = 0;
    const markDrag = (active: boolean): void => {
      setDragover(active);
      state.onDragActiveChange(active);
    };
    const stop = () => {
      const active = tabStop();
      return assetStop(
        state.assets.map((asset) => ({
          webPath: asset.webPath,
          canRename: !!state.onRename,
          canDelete: !!state.onDelete,
        })),
        active?.webPath ?? null,
        active?.kind ?? null,
      );
    };
    const rememberStop = (event: KeyboardEvent) => {
      onAssetKeyDown(event);
      const current = event.currentTarget;
      if (!(current instanceof HTMLElement)) return;
      const active = current.ownerDocument.activeElement;
      if (!(active instanceof HTMLButtonElement)) return;
      const webPath = active.dataset["assetPath"];
      const kind = active.dataset["assetAction"];
      if (
        !webPath ||
        (kind !== "select" && kind !== "rename" && kind !== "delete")
      ) {
        return;
      }
      setTabStop({ webPath, kind });
    };
    return (
      <div class="asset-browser">
        <div
          class={`asset-dropzone${dragover() ? " dragover" : ""}`}
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
        {state.formError ? (
          <p class="form-error asset-browser-error" role="alert">
            {state.formError}
          </p>
        ) : null}

        <div class="asset-grid">
          {state.assets.length === 0 ? (
            <p class="muted">{state.emptyMessage}</p>
          ) : (
            <For each={state.assets}>
              {(asset) => {
                const displayName =
                  asset.fileName.split("/").pop() ?? asset.fileName;
                const preview =
                  asset.previewSrc && isAcceptedImageDataUrl(asset.previewSrc)
                    ? asset.previewSrc
                    : "";
                return (
                  <div class="asset-tile-wrap">
                    <button
                      type="button"
                      class="asset-tile"
                      title={`${asset.fileName} · ${formatBytes(asset.size)}`}
                      data-asset-path={asset.webPath}
                      data-asset-action="select"
                      tabIndex={assetTabStop(
                        asset.webPath,
                        "select",
                        stop()?.webPath ?? null,
                        stop()?.kind ?? null,
                      )}
                      onKeyDown={rememberStop}
                      onClick={() => {
                        setTabStop({ webPath: asset.webPath, kind: "select" });
                        state.onSelect(asset.webPath);
                      }}
                    >
                      <div class="asset-thumb">
                        {preview ? (
                          <img src={preview} alt="" />
                        ) : (
                          <i
                            data-lucide={CATEGORY_ICONS[asset.category]}
                            aria-hidden="true"
                          />
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
                            class="mini-btn asset-rename-btn"
                            title={`Rename ${displayName}`}
                            aria-label={`Rename ${displayName}`}
                            data-asset-path={asset.webPath}
                            data-asset-action="rename"
                            tabIndex={assetTabStop(
                              asset.webPath,
                              "rename",
                              stop()?.webPath ?? null,
                              stop()?.kind ?? null,
                            )}
                            onKeyDown={rememberStop}
                            onClick={() => {
                              setTabStop({
                                webPath: asset.webPath,
                                kind: "rename",
                              });
                              state.onRename?.(asset);
                            }}
                          >
                            <i data-lucide="pencil" />
                          </button>
                        ) : null}
                        {state.onDelete ? (
                          <button
                            type="button"
                            class="mini-btn danger asset-delete-btn"
                            title={`Delete ${displayName}`}
                            aria-label={`Delete ${displayName}`}
                            data-asset-path={asset.webPath}
                            data-asset-action="delete"
                            tabIndex={assetTabStop(
                              asset.webPath,
                              "delete",
                              stop()?.webPath ?? null,
                              stop()?.kind ?? null,
                            )}
                            onKeyDown={rememberStop}
                            onClick={() => {
                              setTabStop({
                                webPath: asset.webPath,
                                kind: "delete",
                              });
                              state.onDelete?.(asset);
                            }}
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
  // Solid has committed the tile icons. Callers refresh them here; a call
  // after `return` never ran, so file icons stayed as empty <i> tags.
  state.onRendered?.();
  return dispose;
}
