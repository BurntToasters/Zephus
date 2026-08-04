// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createInlineEditController } from "../editorInlineEdit";
import type { EditorBlock } from "../../main/types";

function makeController() {
  const deps = {
    setStatus: vi.fn(),
    refreshIcons: vi.fn(),
    handlePlainTextPaste: vi.fn(),
    pushUndo: vi.fn(),
    commitBlockChange: vi.fn(),
    renderCanvas: vi.fn(),
    renderProperties: vi.fn(),
  };
  const controller = createInlineEditController(deps);
  return { controller, deps };
}

function block(overrides: Partial<EditorBlock> = {}): EditorBlock {
  return {
    id: "b1",
    type: "text",
    props: { text: "Hello world", cls: "" },
    ...overrides,
  } as EditorBlock;
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Format toolbars are appended to document.body and must not leak between
  // tests (a finished session removes its own; unfinished ones do not).
  document.body.innerHTML = "";
});

describe("attachInlineEditors", () => {
  it("attaches double-click targets for heading/text/button/section", () => {
    const { controller } = makeController();
    for (const type of ["heading", "text", "button", "section"] as const) {
      const root = document.createElement("div");
      root.innerHTML =
        type === "section" ? "<p>body</p>" : "<span>label</span>";
      const targets = controller.attachInlineEditors(root, block({ type }));
      expect(targets).toHaveLength(1);
      expect(targets[0]!.classList.contains("editable-text-target")).toBe(true);
      expect(targets[0]!.title).toContain("Double-click");
    }
  });

  it("attaches per-column targets for columns blocks", () => {
    const { controller } = makeController();
    const root = document.createElement("div");
    root.innerHTML =
      '<section><div class="zephus-column">A</div><div class="zephus-column">B</div></section>';
    const targets = controller.attachInlineEditors(
      root,
      block({ type: "columns", props: { col1: "A", col2: "B", cls: "" } }),
    );
    expect(targets).toHaveLength(2);
  });

  it("attaches title/body targets for cards and features", () => {
    const { controller } = makeController();
    const card = document.createElement("div");
    card.innerHTML = "<h3>Title</h3><p>Body</p>";
    expect(
      controller.attachInlineEditors(
        card,
        block({ type: "card", props: { title: "T", text: "B", cls: "" } }),
      ),
    ).toHaveLength(2);

    const feature = document.createElement("div");
    feature.innerHTML =
      '<div class="zephus-feature-icon">★</div><h3>F</h3><p>B</p>';
    expect(
      controller.attachInlineEditors(
        feature,
        block({
          type: "feature",
          props: { icon: "★", title: "F", text: "B", cls: "" },
        }),
      ),
    ).toHaveLength(3);
  });

  it("attaches quote, list, testimonial, accordion, stats, pricing, cta targets", () => {
    const { controller } = makeController();
    const cases: Array<[EditorBlock["type"], string, number]> = [
      ["quote", "<p>Q</p><cite>Author</cite>", 2],
      ["list", "<ul><li>One</li><li>Two</li></ul>", 2],
      [
        "testimonial",
        "<blockquote>T</blockquote><figcaption><strong>A</strong><span>R</span></figcaption>",
        3,
      ],
      [
        "accordion",
        "<details><summary>Q1</summary><p>A1</p></details><details><summary>Q2</summary><p>A2</p></details>",
        4,
      ],
      [
        "stats",
        '<div class="zephus-stat"><span class="zephus-stat-num">1</span><span class="zephus-stat-label">L</span></div>',
        2,
      ],
      [
        "pricing",
        "<h3>Plan</h3><div class='zephus-price'><span class='zephus-price-amount'>$9</span><span class='zephus-price-period'>/mo</span></div><ul><li>F1</li></ul><a class='button'>Buy</a>",
        5,
      ],
      ["cta", "<h2>H</h2><p>B</p><a class='button'>Go</a>", 3],
    ];
    for (const [type, html, expected] of cases) {
      const root = document.createElement("div");
      root.innerHTML = html;
      const targets = controller.attachInlineEditors(root, block({ type }));
      expect(targets).toHaveLength(expected);
    }
  });
});

describe("startInlineEdit", () => {
  it("enters edit mode via the double-click target and commits via Ctrl+Enter", () => {
    const { controller, deps } = makeController();
    const root = document.createElement("div");
    root.innerHTML = "<span>Hello</span>";
    const [target] = controller.attachInlineEditors(root, block());

    target!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(controller.isInlineEditing()).toBe(true);
    expect(target!.getAttribute("contenteditable")).toBe("true");

    // Body text is multiline, so plain Enter inserts a line break; Ctrl+Enter
    // (or blur) commits.
    target!.textContent = "Edited";
    target!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(controller.isInlineEditing()).toBe(true);

    target!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
      }),
    );
    expect(controller.isInlineEditing()).toBe(false);
    expect(deps.pushUndo).toHaveBeenCalled();
    expect(deps.commitBlockChange).toHaveBeenCalledWith("Edited text content");
  });

  it("cancels on Escape and restores the original text", () => {
    const { controller, deps } = makeController();
    const root = document.createElement("div");
    root.innerHTML = "<span>Original</span>";
    const [target] = controller.attachInlineEditors(root, block());

    target!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    target!.textContent = "Changed";
    target!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(controller.isInlineEditing()).toBe(false);
    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(deps.commitBlockChange).not.toHaveBeenCalled();
  });

  it("does not commit when the text is unchanged", () => {
    const { controller, deps } = makeController();
    const root = document.createElement("div");
    root.innerHTML = "<span>Same</span>";
    const [target] = controller.attachInlineEditors(
      root,
      block({ props: { text: "Same", cls: "" } }),
    );

    target!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    target!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
      }),
    );

    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(deps.commitBlockChange).not.toHaveBeenCalled();
    expect(deps.renderCanvas).toHaveBeenCalled();
  });

  it("finishes the edit on blur", () => {
    const { controller, deps } = makeController();
    const root = document.createElement("div");
    root.innerHTML = "<span>Text</span>";
    const [target] = controller.attachInlineEditors(root, block());

    target!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    target!.textContent = "Blurred edit";
    target!.dispatchEvent(new FocusEvent("blur"));

    expect(controller.isInlineEditing()).toBe(false);
    expect(deps.commitBlockChange).toHaveBeenCalled();
  });

  it("keeps the session alive when focus moves to the format toolbar", () => {
    const { controller } = makeController();
    const root = document.createElement("div");
    root.innerHTML = "<span>Rich text</span>";
    const [target] = controller.attachInlineEditors(
      root,
      block({
        type: "heading",
        props: { text: "Rich text", level: "2", cls: "" },
      }),
    );

    target!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const toolbar = document.querySelector(".inline-format-toolbar");
    expect(toolbar).toBeTruthy();

    target!.dispatchEvent(
      new FocusEvent("blur", { relatedTarget: toolbar as Node }),
    );
    expect(controller.isInlineEditing()).toBe(true);
  });

  it("creates a format toolbar for rich targets and destroys it on finish", () => {
    const { controller, deps } = makeController();
    const root = document.createElement("div");
    root.innerHTML = "<span>Bold me</span>";
    const [target] = controller.attachInlineEditors(
      root,
      block({
        type: "heading",
        props: { text: "Bold me", level: "2", cls: "" },
      }),
    );

    target!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(document.querySelector(".inline-format-toolbar")).toBeTruthy();
    expect(deps.refreshIcons).toHaveBeenCalled();

    target!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(document.querySelector(".inline-format-toolbar")).toBeNull();
  });
});

describe("startFirstInlineEdit", () => {
  it("enters edit mode on the first editable target", () => {
    const { controller } = makeController();
    const root = document.createElement("div");
    root.innerHTML = "<span>Text</span>";
    controller.startFirstInlineEdit(root, block());
    expect(controller.isInlineEditing()).toBe(true);
    expect(root.querySelector("[contenteditable]")).toBeTruthy();
  });
});
