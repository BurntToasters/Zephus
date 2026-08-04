import { For, Show, createEffect } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import { render } from "solid-js/web";

type SectionAction =
  "add-block" | "up" | "down" | "duplicate" | "toggle-lock" | "delete";

type BlockAction =
  "up" | "down" | "duplicate" | "wrap" | "toggle-lock" | "delete";

export interface CanvasBlockEntry {
  id: string;
  block: EditorBlock;
  label: string;
  breadcrumb: string;
  html: string;
  selected: boolean;
  editableText: boolean;
  shellAriaLabel: string;
  htmlBlock: boolean;
  effectiveStyle?: BlockStyle;
  /** Hidden via style.hideOn on the active viewport (kept visible on canvas). */
  hiddenOnViewport?: boolean;
}

export interface CanvasSectionEntry {
  id: string;
  section: SectionNode;
  selected: boolean;
  breadcrumb: string;
  effectiveStyle?: BlockStyle;
  hiddenOnViewport?: boolean;
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
  onSectionBodyDragOver: (event: DragEvent, sectionId: string) => void;
  onBlockDragStart: (event: DragEvent, block: EditorBlock) => void;
  onBlockDragEnd: () => void;
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

const [canvasState, setCanvasState] = createStore<CanvasState>({
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

function sectionNode(entry: CanvasSectionEntry): SectionNode {
  return unwrap(entry.section);
}

function blockNode(entry: CanvasBlockEntry): EditorBlock {
  return unwrap(entry.block);
}

function observeCanvasEntry(...values: unknown[]): void {
  // Reading reactive store fields inside an effect keeps DOM enhancement and
  // resize handles synchronized without forcing shell remounts.
  void values;
}

function stopAndRun(event: MouseEvent, fn: () => void): void {
  event.stopPropagation();
  fn();
}

function CanvasActionButton(props: {
  label: string;
  icon: string;
  danger?: boolean;
  disabled?: boolean;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      classList={{
        "canvas-action-button": true,
        danger: !!props.danger,
      }}
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={(event) => stopAndRun(event, props.onRun)}
    >
      <i data-lucide={props.icon}></i>
    </button>
  );
}

function InsertBlockButton(props: { index: number; sectionId: string }) {
  return (
    <div class="canvas-insert">
      <button
        type="button"
        class="canvas-insert-button"
        aria-label="Add block here"
        onClick={(event) =>
          stopAndRun(event, () =>
            handlers?.onInsertBlock(props.index, props.sectionId),
          )
        }
      >
        <i data-lucide="plus"></i>
        <span>Add block</span>
      </button>
    </div>
  );
}

function InsertSectionButton(props: { index: number }) {
  return (
    <div class="canvas-insert section-insert">
      <button
        type="button"
        class="canvas-insert-button"
        aria-label="Add section here"
        onClick={(event) =>
          stopAndRun(event, () => handlers?.onOpenSectionInsert(props.index))
        }
      >
        <i data-lucide="plus"></i>
        <span>Add section</span>
      </button>
    </div>
  );
}

function SectionShell(props: { entry: CanvasSectionEntry; index: number }) {
  let shellRef: HTMLDivElement | undefined;
  let bodyRef: HTMLDivElement | undefined;

  createEffect(() => {
    const entry = props.entry;
    observeCanvasEntry(
      entry.selected,
      entry.section.locked,
      entry.effectiveStyle,
    );
    if (shellRef) handlers?.onSyncSectionShell(shellRef, sectionNode(entry));
  });

  return (
    <>
      <InsertSectionButton index={props.index} />

      <div
        ref={(element) => {
          shellRef = element;
        }}
        classList={{
          "canvas-section": true,
          selected: props.entry.selected,
          locked: !!props.entry.section.locked,
          "hidden-on-viewport": !!props.entry.hiddenOnViewport,
        }}
        style={boxStyle(props.entry.effectiveStyle)}
        onClick={(event) => {
          // Clicks on the section chrome (label, breadcrumb, empty toolbar
          // space) select the section instead of bubbling to the canvas and
          // deselecting everything. Interactive children (body, buttons, grip,
          // resize handles) stop propagation themselves.
          handlers?.onSelectSection(sectionNode(props.entry));
          void event;
        }}
        onDragOver={(event) =>
          shellRef && handlers?.onSectionDragOver(event, props.index, shellRef)
        }
        onDrop={(event) => handlers?.onSectionDrop(event)}
      >
        <button
          type="button"
          class="section-grip"
          title="Drag to reorder section"
          aria-label={`Reorder ${props.entry.section.label}`}
          disabled={!!props.entry.section.locked}
          draggable={!props.entry.section.locked}
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) =>
            handlers?.onSectionDragStart(event, sectionNode(props.entry))
          }
          onDragEnd={() => handlers?.onSectionDragEnd()}
        >
          <i data-lucide="grip-vertical"></i>
        </button>

        <div class="section-chrome">
          <span class="block-chip">
            {props.index + 1}. {props.entry.section.label}
          </span>
          <span class="block-breadcrumb">{props.entry.breadcrumb}</span>
          <div
            class="block-actions"
            role="toolbar"
            aria-label="Section actions"
          >
            <CanvasActionButton
              label="Add block"
              icon="plus"
              onRun={() =>
                handlers?.onSectionAction(sectionNode(props.entry), "add-block")
              }
            />
            <CanvasActionButton
              label="Move section up"
              icon="arrow-up"
              onRun={() =>
                handlers?.onSectionAction(sectionNode(props.entry), "up")
              }
            />
            <CanvasActionButton
              label="Move section down"
              icon="arrow-down"
              onRun={() =>
                handlers?.onSectionAction(sectionNode(props.entry), "down")
              }
            />
            <CanvasActionButton
              label="Duplicate section"
              icon="copy"
              onRun={() =>
                handlers?.onSectionAction(sectionNode(props.entry), "duplicate")
              }
            />
            <CanvasActionButton
              label={
                props.entry.section.locked ? "Unlock section" : "Lock section"
              }
              icon="lock-keyhole"
              onRun={() =>
                handlers?.onSectionAction(
                  sectionNode(props.entry),
                  "toggle-lock",
                )
              }
            />
            <CanvasActionButton
              label="Delete section"
              icon="trash-2"
              danger
              onRun={() =>
                handlers?.onSectionAction(sectionNode(props.entry), "delete")
              }
            />
          </div>
        </div>

        <div
          ref={(element) => {
            bodyRef = element;
          }}
          class="section-body"
          tabIndex={0}
          role="group"
          aria-label={`Select ${props.entry.section.label} section`}
          onClick={(event) =>
            stopAndRun(event, () =>
              handlers?.onSelectSection(sectionNode(props.entry)),
            )
          }
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            handlers?.onSelectSection(sectionNode(props.entry));
          }}
          onDragOver={(event) =>
            handlers?.onSectionBodyDragOver(event, props.entry.section.id)
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
  // Asset hydration + inline-editor attach only need to run when the preview
  // markup actually changes. Re-running them on every selection/lock/style
  // update would re-fetch asset data URLs and re-wire dblclick handlers on
  // each click.
  let lastPreviewHtml: string | null = null;

  createEffect(() => {
    const entry = props.blockEntry;
    observeCanvasEntry(
      entry.html,
      entry.selected,
      entry.block.locked,
      entry.effectiveStyle,
    );
    if (previewRef && entry.html !== lastPreviewHtml) {
      lastPreviewHtml = entry.html;
      handlers?.onPreviewRendered(previewRef, blockNode(entry));
    }
    if (shellRef && previewRef) {
      handlers?.onSyncBlockShell(shellRef, blockNode(entry), previewRef);
    }
  });

  return (
    <div
      ref={(element) => {
        shellRef = element;
      }}
      classList={{
        block: true,
        selected: props.blockEntry.selected,
        "html-block": props.blockEntry.htmlBlock,
        locked: !!props.blockEntry.block.locked,
        "hidden-on-viewport": !!props.blockEntry.hiddenOnViewport,
      }}
      title={props.blockEntry.label}
      tabIndex={0}
      role="group"
      aria-label={props.blockEntry.shellAriaLabel}
      onKeyDown={(event) =>
        previewRef &&
        handlers?.onBlockKeyDown(
          event,
          unwrap(props.section),
          blockNode(props.blockEntry),
          previewRef,
        )
      }
      onClick={(event) =>
        previewRef &&
        handlers?.onBlockClick(
          event,
          unwrap(props.section),
          blockNode(props.blockEntry),
          previewRef,
        )
      }
      onDragOver={(event) => {
        const sectionBody = props.sectionBody();
        if (shellRef && sectionBody) {
          handlers?.onBlockDragOver(
            event,
            props.section.id,
            props.blockIndex,
            shellRef,
            sectionBody,
          );
        }
      }}
      onDrop={(event) => handlers?.onBlockDrop(event)}
    >
      <div class="block-chrome">
        <button
          type="button"
          class="block-grip"
          title="Drag to reorder block"
          aria-label={`Reorder ${props.blockEntry.label} block`}
          disabled={!!props.blockEntry.block.locked}
          draggable={!props.blockEntry.block.locked}
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) =>
            handlers?.onBlockDragStart(event, blockNode(props.blockEntry))
          }
          onDragEnd={() => handlers?.onBlockDragEnd()}
        >
          <i data-lucide="grip-vertical"></i>
        </button>
        <span class="block-chip">
          {props.blockIndex + 1}. {props.blockEntry.label}
        </span>
        <span class="block-breadcrumb">{props.blockEntry.breadcrumb}</span>
        <div class="block-actions" role="toolbar" aria-label="Block actions">
          <CanvasActionButton
            label="Move block up"
            icon="arrow-up"
            onRun={() =>
              handlers?.onBlockAction(blockNode(props.blockEntry), "up")
            }
          />
          <CanvasActionButton
            label="Move block down"
            icon="arrow-down"
            onRun={() =>
              handlers?.onBlockAction(blockNode(props.blockEntry), "down")
            }
          />
          <CanvasActionButton
            label="Duplicate block"
            icon="copy"
            onRun={() =>
              handlers?.onBlockAction(blockNode(props.blockEntry), "duplicate")
            }
          />
          <CanvasActionButton
            label="Move block into a new section"
            icon="panel-top-open"
            onRun={() =>
              handlers?.onBlockAction(blockNode(props.blockEntry), "wrap")
            }
          />
          <CanvasActionButton
            label={
              props.blockEntry.block.locked ? "Unlock block" : "Lock block"
            }
            icon="lock-keyhole"
            onRun={() =>
              handlers?.onBlockAction(
                blockNode(props.blockEntry),
                "toggle-lock",
              )
            }
          />
          <CanvasActionButton
            label="Delete block"
            icon="trash-2"
            danger
            onRun={() =>
              handlers?.onBlockAction(blockNode(props.blockEntry), "delete")
            }
          />
        </div>
      </div>

      <div
        ref={(element) => {
          previewRef = element;
        }}
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
  const sections = () => canvasState.sections;

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

let iconRefreshScheduled = false;

function scheduleIconRefresh(): void {
  if (iconRefreshScheduled) return;
  iconRefreshScheduled = true;
  setTimeout(() => {
    iconRefreshScheduled = false;
    window.refreshIcons?.();
  }, 0);
}

export function updateCanvas(nextState: CanvasState): void {
  setCanvasState(reconcile(nextState, { key: "id" }));
  scheduleIconRefresh();
}

export function registerCanvasHandlers(nextHandlers: CanvasHandlers): void {
  handlers = nextHandlers;
}

export function mountCanvas(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <CanvasPanel />, container);
  scheduleIconRefresh();
}
