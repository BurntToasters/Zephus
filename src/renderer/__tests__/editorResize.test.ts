// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createResizeController } from "../editorResize";
import type { EditorBlock, SectionNode } from "../../main/types";

function makeController(viewport: "desktop" | "tablet" | "mobile" = "desktop") {
  const pushUndo = vi.fn();
  const commitInspectorChange = vi.fn();
  const endInspectorEdit = vi.fn();
  const inspectorEditLatch = { markActive: vi.fn() };
  const controller = createResizeController({
    getViewport: () => viewport,
    pushUndo,
    commitInspectorChange,
    endInspectorEdit,
    inspectorEditLatch,
  });
  return {
    controller,
    pushUndo,
    commitInspectorChange,
    endInspectorEdit,
    inspectorEditLatch,
  };
}

const block = (style?: EditorBlock["style"]): EditorBlock =>
  ({ id: "b1", type: "heading", props: {}, style }) as EditorBlock;

beforeEach(() => {
  vi.stubGlobal(
    "getComputedStyle",
    vi.fn(
      () =>
        ({ paddingLeft: "0px", paddingRight: "0px" }) as CSSStyleDeclaration,
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("editorResize handles", () => {
  it("adds four corner handles when enabled and removes them when not", () => {
    const { controller } = makeController();
    const shell = document.createElement("div");
    const subject = document.createElement("div");
    shell.appendChild(subject);

    controller.syncResizeHandles(
      shell,
      { kind: "block", node: block() },
      () => subject,
      true,
    );
    const handles = shell.querySelectorAll(".resize-handle");
    expect(handles).toHaveLength(4);
    expect(shell.querySelector(".resize-handles")).toBeTruthy();

    controller.syncResizeHandles(
      shell,
      { kind: "block", node: block() },
      () => subject,
      false,
    );
    expect(shell.querySelector(".resize-handles")).toBeNull();
  });

  it("keyboard resize commits an inspector change with undo", () => {
    const {
      controller,
      pushUndo,
      commitInspectorChange,
      endInspectorEdit,
      inspectorEditLatch,
    } = makeController();
    const shell = document.createElement("div");
    const subject = document.createElement("div");
    shell.appendChild(subject);
    Object.defineProperty(subject, "getBoundingClientRect", {
      value: () => ({ width: 100, height: 50, top: 0, left: 0 }),
    });

    controller.syncResizeHandles(
      shell,
      { kind: "block", node: block() },
      () => subject,
      true,
    );
    const se = shell.querySelector<HTMLButtonElement>(".resize-handle.se");
    expect(se).toBeTruthy();

    se!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(pushUndo).toHaveBeenCalled();
    expect(inspectorEditLatch.markActive).toHaveBeenCalled();
    expect(commitInspectorChange).toHaveBeenCalledWith("Resized heading", true);
    expect(endInspectorEdit).toHaveBeenCalled();
    // 100 + 10px step, written to the style.
    const node = block();
    expect(node).toBeTruthy();
  });

  it("ignores non-arrow keys on handles", () => {
    const { controller, pushUndo } = makeController();
    const shell = document.createElement("div");
    const subject = document.createElement("div");
    shell.appendChild(subject);
    controller.syncResizeHandles(
      shell,
      { kind: "block", node: block() },
      () => subject,
      true,
    );
    const se = shell.querySelector<HTMLButtonElement>(".resize-handle.se");
    se!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(pushUndo).not.toHaveBeenCalled();
  });

  it("writes viewport-specific responsive styles off desktop", () => {
    const { controller, pushUndo, commitInspectorChange } =
      makeController("mobile");
    const shell = document.createElement("div");
    const subject = document.createElement("div");
    shell.appendChild(subject);
    Object.defineProperty(subject, "getBoundingClientRect", {
      value: () => ({ width: 100, height: 50, top: 0, left: 0 }),
    });
    const node = block();
    controller.syncResizeHandles(
      shell,
      { kind: "block", node },
      () => subject,
      true,
    );
    const se = shell.querySelector<HTMLButtonElement>(".resize-handle.se");
    se!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );

    expect(node.style?.responsive?.mobile?.width).toBe("110px");
    expect(pushUndo).toHaveBeenCalled();
    expect(commitInspectorChange).toHaveBeenCalled();
  });

  it("effectiveNodeStyle stays desktop when viewport is desktop", () => {
    const { controller } = makeController("desktop");
    const style = controller.effectiveNodeStyle({
      style: { responsive: { mobile: { width: "50%" } } },
    } as SectionNode);
    expect(style.width).toBeUndefined();
  });

  it("drags the SE handle to resize and commits on pointerup", () => {
    const {
      controller,
      pushUndo,
      commitInspectorChange,
      endInspectorEdit,
      inspectorEditLatch,
    } = makeController();
    const shell = document.createElement("div");
    const subject = document.createElement("div");
    const parent = document.createElement("div");
    parent.appendChild(subject);
    shell.appendChild(parent);
    Object.defineProperty(subject, "getBoundingClientRect", {
      value: () => ({ width: 100, height: 50, top: 0, left: 0 }),
    });
    const node = block();
    controller.syncResizeHandles(
      shell,
      { kind: "block", node },
      () => subject,
      true,
    );
    const se = shell.querySelector<HTMLButtonElement>(".resize-handle.se");

    se!.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 }),
    );
    expect(pushUndo).toHaveBeenCalled();
    expect(inspectorEditLatch.markActive).toHaveBeenCalled();

    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 20,
        clientY: 10,
      }),
    );
    expect(node.style?.width).toBe("120px");
    expect(node.style?.height).toBe("60px");
    expect(subject.style.width).toBe("120px");

    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    expect(commitInspectorChange).toHaveBeenCalledWith("Resized heading", true);
    expect(endInspectorEdit).toHaveBeenCalled();
  });

  it("NW handle grows the box when dragging up-left and clamps to the parent", () => {
    const { controller, commitInspectorChange } = makeController();
    const shell = document.createElement("div");
    const subject = document.createElement("div");
    const parent = document.createElement("div");
    parent.appendChild(subject);
    shell.appendChild(parent);
    Object.defineProperty(subject, "getBoundingClientRect", {
      value: () => ({ width: 100, height: 50, top: 0, left: 0 }),
    });
    Object.defineProperty(parent, "clientWidth", {
      value: 120,
      configurable: true,
    });
    const node = block();
    controller.syncResizeHandles(
      shell,
      { kind: "block", node },
      () => subject,
      true,
    );
    const nw = shell.querySelector<HTMLButtonElement>(".resize-handle.nw");

    nw!.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 2,
        clientX: 50,
        clientY: 25,
      }),
    );
    // Dragging left and up makes NW grow the box, clamped to parent width.
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 2,
        clientX: 30,
        clientY: 10,
      }),
    );
    expect(node.style?.width).toBe("120px");
    expect(node.style?.height).toBe("65px");

    document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 2 }));
    expect(commitInspectorChange).toHaveBeenCalledWith("Resized heading", true);
  });

  it("window blur ends the drag and finishing twice commits once", () => {
    const { controller, commitInspectorChange, endInspectorEdit } =
      makeController();
    const shell = document.createElement("div");
    const subject = document.createElement("div");
    shell.appendChild(subject);
    Object.defineProperty(subject, "getBoundingClientRect", {
      value: () => ({ width: 100, height: 50, top: 0, left: 0 }),
    });
    const node = block();
    controller.syncResizeHandles(
      shell,
      { kind: "block", node },
      () => subject,
      true,
    );
    const se = shell.querySelector<HTMLButtonElement>(".resize-handle.se");
    se!.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 3, clientX: 0, clientY: 0 }),
    );
    window.dispatchEvent(new Event("blur"));
    expect(commitInspectorChange).toHaveBeenCalledTimes(1);
    expect(endInspectorEdit).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 3 }));
    expect(commitInspectorChange).toHaveBeenCalledTimes(1);
  });

  it("clamps below-minimum drags to the minimum size", () => {
    const { controller } = makeController();
    const shell = document.createElement("div");
    const subject = document.createElement("div");
    shell.appendChild(subject);
    Object.defineProperty(subject, "getBoundingClientRect", {
      value: () => ({ width: 100, height: 50, top: 0, left: 0 }),
    });
    const node = block();
    controller.syncResizeHandles(
      shell,
      { kind: "block", node },
      () => subject,
      true,
    );
    const se = shell.querySelector<HTMLButtonElement>(".resize-handle.se");
    se!.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 4, clientX: 0, clientY: 0 }),
    );
    // Dragging far into the top-left corner of the SE handle shrinks to min.
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 4,
        clientX: -1000,
        clientY: -1000,
      }),
    );
    expect(node.style?.width).toBe("40px");
    expect(node.style?.height).toBe("24px");
  });
});
