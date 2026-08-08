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

  it("ends the session when focus leaves the toolbar entirely", () => {
    // Regression: focus el -> link input -> outside never blurred `el`, so the
    // session stayed stuck and swallowed every canvas click.
    const { controller, deps } = makeController();
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
    const toolbar = document.querySelector<HTMLElement>(
      ".inline-format-toolbar",
    );
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    toolbar!.dispatchEvent(
      new FocusEvent("focusout", { relatedTarget: outside }),
    );
    expect(controller.isInlineEditing()).toBe(false);
    expect(deps.commitBlockChange).not.toHaveBeenCalled();
    outside.remove();
  });

  it("finishInlineEdit commits the active session immediately", () => {
    const { controller, deps } = makeController();
    const root = document.createElement("div");
    root.innerHTML = "<span>Flush me</span>";
    const [target] = controller.attachInlineEditors(root, block());

    target!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    target!.textContent = "Flushed";
    controller.finishInlineEdit();
    expect(controller.isInlineEditing()).toBe(false);
    expect(deps.commitBlockChange).toHaveBeenCalledWith("Edited text content");

    // No-op when no session is active.
    controller.finishInlineEdit();
    expect(deps.commitBlockChange).toHaveBeenCalledTimes(1);
  });

  it("prompts for a link via Ctrl+K and applies it on Enter", () => {
    const { controller, deps } = makeController();
    const root = document.createElement("div");
    root.innerHTML = "<span>Link me</span>";
    const [target] = controller.attachInlineEditors(
      root,
      block({
        type: "heading",
        props: { text: "Link me", level: "2", cls: "" },
      }),
    );

    document.body.appendChild(root);
    target!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    // Select the text so the link prompt accepts it.
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target!);
    selection!.removeAllRanges();
    selection!.addRange(range);

    target!.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "k",
        ctrlKey: true,
      }),
    );
    const linkRow = document.querySelector<HTMLElement>(".inline-format-link");
    expect(linkRow?.hidden).toBe(false);

    const input = linkRow?.querySelector<HTMLInputElement>("input");
    expect(input).toBeTruthy();
    input!.value = "/contact";
    input!.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    expect(deps.setStatus).toHaveBeenCalledWith("Added link.");
  });

  it("rejects dangerous link targets with a status message", () => {
    const { controller, deps } = makeController();
    const root = document.createElement("div");
    root.innerHTML = "<span>Link me</span>";
    const [target] = controller.attachInlineEditors(
      root,
      block({
        type: "heading",
        props: { text: "Link me", level: "2", cls: "" },
      }),
    );

    document.body.appendChild(root);
    target!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target!);
    selection!.removeAllRanges();
    selection!.addRange(range);

    target!.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "k",
        ctrlKey: true,
      }),
    );
    const input = document.querySelector<HTMLInputElement>(
      ".inline-format-link input",
    );
    input!.value = "java" + "script:alert(1)";
    input!.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    expect(deps.setStatus).toHaveBeenCalledWith(
      "That link type is not allowed.",
    );
  });

  it("promptLink warns when no text is selected", () => {
    const { controller, deps } = makeController();
    const root = document.createElement("div");
    root.innerHTML = "<span>Empty selection</span>";
    const [target] = controller.attachInlineEditors(
      root,
      block({
        type: "heading",
        props: { text: "Empty selection", level: "2", cls: "" },
      }),
    );

    document.body.appendChild(root);
    target!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    // The caret is collapsed after starting the edit.
    target!.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "k",
        ctrlKey: true,
      }),
    );
    expect(deps.setStatus).toHaveBeenCalledWith(
      "Select the words you want to link first.",
    );
  });

  it("applies bold via the toolbar button and Ctrl+B", () => {
    const { controller } = makeController();
    const root = document.createElement("div");
    root.innerHTML = "<span>Bold</span>";
    const [target] = controller.attachInlineEditors(
      root,
      block({
        type: "heading",
        props: { text: "Bold", level: "2", cls: "" },
      }),
    );
    document.body.appendChild(root);
    target!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    // jsdom does not implement execCommand formatting — spy on the call so a
    // dropped/misrouted formatting command still fails the test.
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand as typeof document.execCommand;

    const bold = document.querySelector<HTMLButtonElement>(
      '.inline-format-btn[aria-label="Bold (Cmd/Ctrl+B)"]',
    );
    expect(bold).toBeTruthy();
    bold!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    bold!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(execCommand).toHaveBeenCalledWith("bold", false, undefined);

    target!.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "b",
        ctrlKey: true,
      }),
    );
    expect(execCommand).toHaveBeenCalledTimes(2);
  });

  it("clears formatting via the toolbar button", () => {
    const { controller } = makeController();
    const root = document.createElement("div");
    root.innerHTML = "<span>Clear</span>";
    const [target] = controller.attachInlineEditors(
      root,
      block({
        type: "heading",
        props: { text: "Clear", level: "2", cls: "" },
      }),
    );
    document.body.appendChild(root);
    target!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    const clear = document.querySelector<HTMLButtonElement>(
      '.inline-format-btn[aria-label="Clear formatting"]',
    );
    expect(clear).toBeTruthy();
    clear!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // The session survives the click (mousedown prevented the blur).
    expect(controller.isInlineEditing()).toBe(true);
  });

  it("Escape closes the link prompt without applying", () => {
    const { controller } = makeController();
    const root = document.createElement("div");
    root.innerHTML = "<span>Esc</span>";
    const [target] = controller.attachInlineEditors(
      root,
      block({
        type: "heading",
        props: { text: "Esc", level: "2", cls: "" },
      }),
    );
    document.body.appendChild(root);
    target!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target!);
    selection!.removeAllRanges();
    selection!.addRange(range);
    target!.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "k",
        ctrlKey: true,
      }),
    );

    const input = document.querySelector<HTMLInputElement>(
      ".inline-format-link input",
    );
    input!.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
    );
    const linkRow = document.querySelector<HTMLElement>(".inline-format-link");
    expect(linkRow?.hidden).toBe(true);
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
