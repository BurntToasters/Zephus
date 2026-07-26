import { For, Show, createEffect, createSignal } from "solid-js";
import { render } from "solid-js/web";

type SectionAction =
  "add-block" | "up" | "down" | "duplicate" | "toggle-lock" | "delete";

type BlockAction =
  "up" | "down" | "duplicate" | "wrap" | "toggle-lock" | "delete";

export interface CanvasBlockEntry {
  block: EditorBlock;
  label: string;
  breadcrumb: string;
  html: string;
  selected: boolean;
  editableText: boolean;
  shellAriaLabel: string;
  htmlBlock: boolean;
  effectiveStyle?: BlockStyle;
}

export interface CanvasSectionEntry {
  section: SectionNode;
  selected: boolean;
  breadcrumb: string;
  effectiveStyle?: BlockStyle;
  children: CanvasBlockEntry[];
}

export interface CanvasState {
  sections: CanvasSectionEntry[];
}

export interface CanvasHandlers {
  onInsertBlock: (index: number, sectionId: string) => void;
  onOpenSectionInsert: (index: number) => void;
  onQuickInsertSection: (
    index: number,
    template?: "blank" | "hero" | "features",
  ) => void;
  onSectionAction: (section: SectionNode, action: SectionAction) => void;
  onBlockAction: (block: EditorBlock, action: BlockAction) => void;
  onSelectSection: (section: SectionNode) => void;
  onBlockKeyDown: (
    event: KeyboardEvent,
    section: SectionNode,
    block: EditorBlock,
    preview: HTMLElement,
  ) => void;
  onBlockClick: (
    event: MouseEvent,
    section: SectionNode,
    block: EditorBlock,
    preview: HTMLElement,
  ) => void;
  onSectionDragStart: (event: DragEvent, section: SectionNode) => void;
  onSectionDragEnd: () => void;
  onSectionDragOver: (
    event: DragEvent,
    sectionIndex: number,
    shell: HTMLElement,
  ) => void;
  onSectionDrop: (event: DragEvent) => void;
  onSectionBodyDragOver: (
    event: DragEvent,
    sectionId: string,
    childCount: number,
  ) => void;
  onBlockDragStart: (event: DragEvent, block: EditorBlock) => void;
  onBlockDragOver: (
    event: DragEvent,
    sectionId: string,
    blockIndex: number,
    shell: HTMLElement,
    sectionBody: HTMLElement,
  ) => void;
  onBlockDrop: (event: DragEvent) => void;
  onPreviewRendered: (preview: HTMLElement, block: EditorBlock) => void;
  onSyncSectionShell: (shell: HTMLElement, section: SectionNode) => void;
  onSyncBlockShell: (
    shell: HTMLElement,
    block: EditorBlock,
    preview: HTMLElement,
  ) => void;
}

const [canvasState, setCanvasState] = createSignal<CanvasState>({
  sections: [],
});
let handlers: CanvasHandlers | null = null;

function boxStyle(style?: BlockStyle): Record<string, string> {
  const next: Record<string, string> = {
    "box-sizing": "border-box",
    "max-width": style?.maxWidth ? `min(${style.maxWidth}, 100%)` : "100%",
  };
  if (style?.width) next.width = style.width;
  if (style?.height) next.height = style.height;
  if (style?.background) next.background = style.background;
  if (style?.color) next.color = style.color;
  if (style?.padding) next.padding = style.padding;
  if (style?.margin) next.margin = style.margin;
  if (style?.radius) next["border-radius"] = style.radius;
  if (style?.shadow === "sm") next["box-shadow"] = "var(--shadow-sm)";
  if (style?.shadow === "md") next["box-shadow"] = "var(--shadow-md)";
  if (style?.shadow === "lg") next["box-shadow"] = "var(--shadow-lg)";
  return next;
}

function stopAndRun(event: MouseEvent, fn: () => void): void {
  event.stopPropagation();
  fn();
}

function InsertBlockButton(props: { index: number; sectionId: string }) {
  return (
    <div class="canvas-insert">
      <button
        type="button"
        class="mini-btn"
        onClick={(event) =>
          stopAndRun(event, () =>
            handlers?.onInsertBlock(props.index, props.sectionId),
          )
        }
      >
        + Add Block
      </button>
    </div>
  );
}

function InsertSectionButton(props: { index: number }) {
  return (
    <div class="canvas-insert section-insert">
      <button
        type="button"
        class="mini-btn"
        onClick={(event) =>
          stopAndRun(event, () => handlers?.onOpenSectionInsert(props.index))
        }
      >
        + Add Section
      </button>
    </div>
  );
}

function SectionShell(props: { entry: CanvasSectionEntry; index: number }) {
  let shellRef: HTMLDivElement | undefined;
  let bodyRef: HTMLDivElement | undefined;

  createEffect(() => {
    props.entry.selected;
    props.entry.section.locked;
    props.entry.effectiveStyle;
    if (shellRef) handlers?.onSyncSectionShell(shellRef, props.entry.section);
  });

  return (
    <>
      <InsertSectionButton index={props.index} />

      <div
        ref={shellRef}
        classList={{
          "canvas-section": true,
          selected: props.entry.selected,
          locked: !!props.entry.section.locked,
        }}
        style={boxStyle(props.entry.effectiveStyle)}
        onDragOver={(event) =>
          handlers?.onSectionDragOver(event, props.index, shellRef!)
        }
        onDrop={(event) => handlers?.onSectionDrop(event)}
      >
        <span
          class="section-grip"
          title="Drag to reorder section"
          aria-hidden="true"
          draggable={!props.entry.section.locked}
          onDragStart={(event) =>
            handlers?.onSectionDragStart(event, props.entry.section)
          }
          onDragEnd={() => handlers?.onSectionDragEnd()}
        >
          ⠿
        </span>

        <div class="section-chrome">
          <span class="block-chip">
            {props.index + 1}. {props.entry.section.label}
          </span>
          <span class="block-breadcrumb">{props.entry.breadcrumb}</span>
          <div class="block-actions">
            <button
              type="button"
              class="mini-btn"
              onClick={(event) =>
                stopAndRun(event, () =>
                  handlers?.onSectionAction(props.entry.section, "add-block"),
                )
              }
            >
              Add Block
            </button>
            <button
              type="button"
              class="mini-btn"
              onClick={(event) =>
                stopAndRun(event, () =>
                  handlers?.onSectionAction(props.entry.section, "up"),
                )
              }
            >
              Up
            </button>
            <button
              type="button"
              class="mini-btn"
              onClick={(event) =>
                stopAndRun(event, () =>
                  handlers?.onSectionAction(props.entry.section, "down"),
                )
              }
            >
              Down
            </button>
            <button
              type="button"
              class="mini-btn"
              onClick={(event) =>
                stopAndRun(event, () =>
                  handlers?.onSectionAction(props.entry.section, "duplicate"),
                )
              }
            >
              Dup
            </button>
            <button
              type="button"
              class="mini-btn"
              onClick={(event) =>
                stopAndRun(event, () =>
                  handlers?.onSectionAction(props.entry.section, "toggle-lock"),
                )
              }
            >
              {props.entry.section.locked ? "Unlock" : "Lock"}
            </button>
            <button
              type="button"
              class="mini-btn"
              onClick={(event) =>
                stopAndRun(event, () =>
                  handlers?.onSectionAction(props.entry.section, "delete"),
                )
              }
            >
              Delete
            </button>
          </div>
        </div>

        <div
          ref={bodyRef}
          class="section-body"
          onClick={(event) =>
            stopAndRun(event, () =>
              handlers?.onSelectSection(props.entry.section),
            )
          }
          onDragOver={(event) =>
            handlers?.onSectionBodyDragOver(
              event,
              props.entry.section.id,
              props.entry.section.children.length,
            )
          }
          onDrop={(event) => handlers?.onSectionDrop(event)}
        >
          <Show
            when={props.entry.children.length > 0}
            fallback={
              <div class="canvas-empty">
                <strong>{props.entry.section.label}</strong>
                <span>Add blocks here or drop in a reusable section.</span>
              </div>
            }
          >
            <For each={props.entry.children}>
              {(blockEntry, blockIndex) => (
                <>
                  <InsertBlockButton
                    index={blockIndex()}
                    sectionId={props.entry.section.id}
                  />
                  <BlockShell
                    blockEntry={blockEntry}
                    blockIndex={blockIndex()}
                    section={props.entry.section}
                    sectionBody={() => bodyRef}
                  />
                </>
              )}
            </For>
            <InsertBlockButton
              index={props.entry.section.children.length}
              sectionId={props.entry.section.id}
            />
          </Show>
        </div>
      </div>
    </>
  );
}

function BlockShell(props: {
  blockEntry: CanvasBlockEntry;
  blockIndex: number;
  section: SectionNode;
  sectionBody: () => HTMLDivElement | undefined;
}) {
  let shellRef: HTMLDivElement | undefined;
  let previewRef: HTMLDivElement | undefined;

  createEffect(() => {
    props.blockEntry.html;
    props.blockEntry.selected;
    props.blockEntry.block.locked;
    if (previewRef)
      handlers?.onPreviewRendered(previewRef, props.blockEntry.block);
    if (shellRef && previewRef) {
      handlers?.onSyncBlockShell(shellRef, props.blockEntry.block, previewRef);
    }
  });

  return (
    <div
      ref={shellRef}
      classList={{
        block: true,
        selected: props.blockEntry.selected,
        "html-block": props.blockEntry.htmlBlock,
        locked: !!props.blockEntry.block.locked,
      }}
      draggable={!props.blockEntry.block.locked}
      title={props.blockEntry.label}
      tabIndex={0}
      role="button"
      aria-label={props.blockEntry.shellAriaLabel}
      onKeyDown={(event) =>
        previewRef &&
        handlers?.onBlockKeyDown(
          event,
          props.section,
          props.blockEntry.block,
          previewRef,
        )
      }
      onClick={(event) =>
        previewRef &&
        handlers?.onBlockClick(
          event,
          props.section,
          props.blockEntry.block,
          previewRef,
        )
      }
      onDragStart={(event) =>
        handlers?.onBlockDragStart(event, props.blockEntry.block)
      }
      onDragOver={(event) =>
        handlers?.onBlockDragOver(
          event,
          props.section.id,
          props.blockIndex,
          shellRef!,
          props.sectionBody()!,
        )
      }
      onDrop={(event) => handlers?.onBlockDrop(event)}
    >
      <div class="block-chrome">
        <span class="block-chip">
          {props.blockIndex + 1}. {props.blockEntry.label}
        </span>
        <span class="block-breadcrumb">{props.blockEntry.breadcrumb}</span>
        <div class="block-actions">
          <button
            type="button"
            class="mini-btn"
            onClick={(event) =>
              stopAndRun(event, () =>
                handlers?.onBlockAction(props.blockEntry.block, "up"),
              )
            }
          >
            Up
          </button>
          <button
            type="button"
            class="mini-btn"
            onClick={(event) =>
              stopAndRun(event, () =>
                handlers?.onBlockAction(props.blockEntry.block, "down"),
              )
            }
          >
            Down
          </button>
          <button
            type="button"
            class="mini-btn"
            onClick={(event) =>
              stopAndRun(event, () =>
                handlers?.onBlockAction(props.blockEntry.block, "duplicate"),
              )
            }
          >
            Dup
          </button>
          <button
            type="button"
            class="mini-btn"
            onClick={(event) =>
              stopAndRun(event, () =>
                handlers?.onBlockAction(props.blockEntry.block, "wrap"),
              )
            }
          >
            Wrap
          </button>
          <button
            type="button"
            class="mini-btn"
            onClick={(event) =>
              stopAndRun(event, () =>
                handlers?.onBlockAction(props.blockEntry.block, "toggle-lock"),
              )
            }
          >
            {props.blockEntry.block.locked ? "Unlock" : "Lock"}
          </button>
          <button
            type="button"
            class="mini-btn"
            onClick={(event) =>
              stopAndRun(event, () =>
                handlers?.onBlockAction(props.blockEntry.block, "delete"),
              )
            }
          >
            Delete
          </button>
        </div>
      </div>

      <div
        ref={previewRef}
        classList={{
          "block-preview": true,
          "editable-text": props.blockEntry.editableText,
        }}
        style={boxStyle(props.blockEntry.effectiveStyle)}
        innerHTML={props.blockEntry.html}
      />
    </div>
  );
}

export function CanvasPanel() {
  const sections = () => canvasState().sections;

  return (
    <Show
      when={sections().length > 0}
      fallback={
        <div class="canvas-empty-state">
          <h3>This page is empty</h3>
          <p>Add your first section or drop in a reusable section.</p>
          <div class="canvas-empty-actions">
            <button
              type="button"
              class="btn"
              onClick={(event) =>
                stopAndRun(event, () =>
                  handlers?.onQuickInsertSection(0, "blank"),
                )
              }
            >
              Blank Section
            </button>
            <button
              type="button"
              class="btn"
              onClick={(event) =>
                stopAndRun(event, () =>
                  handlers?.onQuickInsertSection(0, "hero"),
                )
              }
            >
              Hero Section
            </button>
            <button
              type="button"
              class="btn"
              onClick={(event) =>
                stopAndRun(event, () =>
                  handlers?.onQuickInsertSection(0, "features"),
                )
              }
            >
              Features Section
            </button>
          </div>
        </div>
      }
    >
      <For each={sections()}>
        {(entry, index) => <SectionShell entry={entry} index={index()} />}
      </For>
      <InsertSectionButton index={sections().length} />
    </Show>
  );
}

export function updateCanvas(nextState: CanvasState): void {
  setCanvasState(nextState);
}

export function registerCanvasHandlers(nextHandlers: CanvasHandlers): void {
  handlers = nextHandlers;
}

export function mountCanvas(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <CanvasPanel />, container);
}
