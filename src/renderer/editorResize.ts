/** Canvas resize handles: the corner grips on selected blocks/sections and the pointer/keyboard resizing they drive. */

import type { BlockStyle, EditorBlock, SectionNode } from "../main/types";

type Block = EditorBlock;

export type ResizeCorner = "nw" | "ne" | "sw" | "se";
export type ResizeTarget =
  { kind: "block"; node: Block } | { kind: "section"; node: SectionNode };

export type ResizeViewport = "desktop" | "tablet" | "mobile";

export interface ResizeDeps {
  getViewport: () => ResizeViewport;
  pushUndo: () => void;
  commitInspectorChange: (
    summary: string,
    rerenderProperties?: boolean,
  ) => void;
  endInspectorEdit: () => void;
  inspectorEditLatch: { markActive: () => void };
}

const MIN_RESIZE_WIDTH = 40;
const MIN_RESIZE_HEIGHT = 24;

export function createResizeController(deps: ResizeDeps) {
    /** Largest width a resized element may take without spilling outside the page: the content width of its containing… */
  function maxResizeWidthFor(subject: HTMLElement): number {
    const parent = subject.parentElement;
    if (!parent) return Number.POSITIVE_INFINITY;
    const cs = getComputedStyle(parent);
    const pad =
      (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const inner = parent.clientWidth - pad;
    return inner > MIN_RESIZE_WIDTH ? inner : Number.POSITIVE_INFINITY;
  }

  function resizeStyleTarget(target: ResizeTarget): BlockStyle {
    target.node.style = target.node.style ?? {};
    if (deps.getViewport() === "desktop") return target.node.style;
    target.node.style.responsive = target.node.style.responsive ?? {};
    target.node.style.responsive[deps.getViewport()] =
      target.node.style.responsive[deps.getViewport()] ?? {};
    return target.node.style.responsive[deps.getViewport()]!;
  }

  function effectiveNodeStyle(node: { style?: BlockStyle }): BlockStyle {
    const base = node.style ? JSON.parse(JSON.stringify(node.style)) : {};
    const viewport = deps.getViewport();
    const responsive =
      viewport === "desktop" ? undefined : node.style?.responsive?.[viewport];
    if (responsive) Object.assign(base, responsive);
    return base;
  }

  function addResizeHandles(
    shell: HTMLElement,
    target: ResizeTarget,
    getSubject: () => HTMLElement,
  ): void {
    const handleWrap = document.createElement("div");
    handleWrap.className = "resize-handles";
    for (const corner of ["nw", "ne", "sw", "se"] as ResizeCorner[]) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = `resize-handle ${corner}`;
      handle.setAttribute("aria-label", `Resize ${corner}`);
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        beginCanvasResize(event, corner, target, getSubject(), handle);
      });
      handle.addEventListener("keydown", (event) => {
        if (
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        resizeCanvasTargetByKeyboard(event.key, corner, target, getSubject());
      });
      handleWrap.appendChild(handle);
    }
    shell.appendChild(handleWrap);
  }

  function syncResizeHandles(
    shell: HTMLElement,
    target: ResizeTarget,
    getSubject: () => HTMLElement,
    enabled: boolean,
  ): void {
    shell.querySelector(".resize-handles")?.remove();
    if (enabled) addResizeHandles(shell, target, getSubject);
  }

  function resizeCanvasTargetByKeyboard(
    key: string,
    corner: ResizeCorner,
    target: ResizeTarget,
    subject: HTMLElement,
  ): void {
    const rect = subject.getBoundingClientRect();
    const fromLeft = corner === "nw" || corner === "sw";
    const fromTop = corner === "nw" || corner === "ne";
    let width = rect.width;
    let height = rect.height;
    const step = 10;

    if (key === "ArrowRight") width += fromLeft ? -step : step;
    if (key === "ArrowLeft") width += fromLeft ? step : -step;
    if (key === "ArrowDown") height += fromTop ? -step : step;
    if (key === "ArrowUp") height += fromTop ? step : -step;

    // Clamp FIRST, then bail when the clamp makes the change a no-op (already
    // at MIN/MAX): a phantom undo entry + dirty flag per dead keypress used to
    // accumulate and wipe the redo stack.
    width = Math.min(
      maxResizeWidthFor(subject),
      Math.max(MIN_RESIZE_WIDTH, Math.round(width)),
    );
    height = Math.max(MIN_RESIZE_HEIGHT, Math.round(height));
    // Read the current values WITHOUT creating the style object (creation
    // must happen after the undo snapshot so the pre-state stays null/empty).
    const existingStyle = target.node.style;
    const existing =
      existingStyle &&
      (deps.getViewport() === "desktop"
        ? existingStyle
        : existingStyle.responsive?.[deps.getViewport()]);
    if (
      existing?.width === `${width}px` &&
      existing?.height === `${height}px`
    ) {
      return;
    }

    // Snapshot BEFORE mutating (like the pointer path): the undo entry must
    // capture the pre-resize state, or Ctrl+Z restores the same size.
    deps.pushUndo();
    const style = resizeStyleTarget(target);
    style.width = `${width}px`;
    style.height = `${height}px`;
    subject.style.width = style.width;
    subject.style.height = style.height;
    deps.inspectorEditLatch.markActive();
    deps.commitInspectorChange(
      `Resized ${target.kind === "block" ? target.node.type : target.node.label}`,
      true,
    );
    deps.endInspectorEdit();
  }

  function beginCanvasResize(
    event: PointerEvent,
    corner: ResizeCorner,
    target: ResizeTarget,
    subject: HTMLElement,
    handle: HTMLElement,
  ): void {
    // NOTE: the undo snapshot is pushed lazily inside onMove, only when the
    // size actually changes. Pushing at pointerdown left a phantom undo entry
    // (and a dirty page + wiped redo stack) when the user clicked a handle
    // without dragging.
    deps.inspectorEditLatch.markActive();
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = subject.getBoundingClientRect();
    const startWidth = rect.width;
    const startHeight = rect.height;
    const fromLeft = corner === "nw" || corner === "sw";
    const fromTop = corner === "nw" || corner === "ne";
    const maxWidth = maxResizeWidthFor(subject);
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is best effort */
    }

    let undoPushed = false;
    const onMove = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const width = Math.min(
        maxWidth,
        Math.max(
          MIN_RESIZE_WIDTH,
          Math.round(startWidth + (fromLeft ? -dx : dx)),
        ),
      );
      const height = Math.max(
        MIN_RESIZE_HEIGHT,
        Math.round(startHeight + (fromTop ? -dy : dy)),
      );
      const style = resizeStyleTarget(target);
      if (
        !undoPushed &&
        (style.width !== `${width}px` || style.height !== `${height}px`)
      ) {
        undoPushed = true;
        deps.pushUndo();
      }
      style.width = `${width}px`;
      style.height = `${height}px`;
      subject.style.width = style.width;
      subject.style.height = style.height;
    };

    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        /* pointer capture is best effort */
      }
      if (undoPushed) {
        deps.commitInspectorChange(
          `Resized ${target.kind === "block" ? target.node.type : target.node.label}`,
          true,
        );
      }
      deps.endInspectorEdit();
    };
    const onUp = (): void => finish();
    const onCancel = (): void => finish();

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
  }

  return { syncResizeHandles, effectiveNodeStyle };
}
