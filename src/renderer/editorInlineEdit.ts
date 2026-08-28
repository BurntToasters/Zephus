/** Inline (contenteditable) text editing on the canvas: double-click to edit, floating format toolbar… */

import { safeUrl, splitLines, splitPair } from "../shared/renderHelpers";
import { richTextFromElement } from "./inlineRichText";
import type { EditorBlock } from "../main/types";

type Block = EditorBlock;

export interface InlineEditTarget {
  prop: string;
  multiline?: boolean;
  lineIndex?: number;
  pairSide?: "left" | "right";
  /** Enables the inline formatting toolbar (bold/italic/link) for prose targets. */
  rich?: boolean;
  /** False where the text is rendered inside an `<a>`, so links are invalid. */
  allowLinks?: boolean;
}

export interface InlineEditDeps {
  setStatus: (message: string) => void;
  refreshIcons: () => void;
  handlePlainTextPaste: (event: ClipboardEvent) => void;
  pushUndo: () => void;
  commitBlockChange: (summary: string) => void;
  renderCanvas: () => void;
  renderProperties: () => void;
}

export function updateLineValue(
  raw: string,
  index: number,
  value: string,
  pairSide?: "left" | "right",
): string {
  const lines = splitLines(raw);
  while (lines.length <= index) lines.push("");
  if (!pairSide) {
    lines[index] = value;
  } else {
    const [left, right] = splitPair(lines[index] ?? "");
    // "::" is the line's PAIR SEPARATOR, not legal inside one side: typing
    // it into a value made the split shift on the next read (the label side
    // silently absorbed the remainder) and compound on every edit. Normalize
    // it to an em-dash so the user's intent survives verbatim instead.
    const safe = value.replace(/::/g, "—");
    lines[index] =
      pairSide === "left" ? `${safe} :: ${right}` : `${left} :: ${safe}`;
  }
  return lines.join("\n");
}

export function targetCurrentValue(
  block: Block,
  target: InlineEditTarget,
): string {
  const raw = block.props[target.prop] ?? "";
  if (target.lineIndex === undefined) return raw.trim();
  const line = splitLines(raw)[target.lineIndex] ?? "";
  if (!target.pairSide) return line;
  const [left, right] = splitPair(line);
  return target.pairSide === "left" ? left : right;
}

export function applyInlineValue(
  block: Block,
  target: InlineEditTarget,
  value: string,
): void {
  if (target.lineIndex === undefined) {
    block.props[target.prop] = value;
    return;
  }
  block.props[target.prop] = updateLineValue(
    block.props[target.prop] ?? "",
    target.lineIndex,
    value,
    target.pairSide,
  );
}

export function createInlineEditController(deps: InlineEditDeps) {
  // True while a contenteditable session is active. Used to stop the block
  // click/select logic from hijacking clicks during editing (which would
  // re-enter edit mode and collapse the user's text selection — e.g. when
  // double-clicking a word to highlight it).
  let isInlineEditing = false;
  // The active session's commit function, so a save can flush the DOM edit
  // into the section tree before serializing.
  let activeFinish: (() => void) | null = null;

  /**
   * Applies an inline formatting command to the current selection.
   *
   * `execCommand` is deprecated but remains the only way to transform a
   * selection inside a contenteditable without hand-rolling range surgery.
   * Whatever markup it produces is normalized on commit by
   * `richTextFromElement`, so the stored value never contains anything outside
   * the allowed subset.
   */
  function applyInlineFormat(
    command: "bold" | "italic" | "removeFormat" | "createLink" | "unlink",
    value?: string,
  ): void {
    try {
      document.execCommand(command, false, value);
    } catch {
      deps.setStatus("Could not apply formatting here.");
    }
  }

  interface InlineFormatToolbar {
    element: HTMLElement;
    syncState: () => void;
    promptLink: () => void;
    destroy: () => void;
  }

  /**
   * Floating bold/italic/link controls shown while inline-editing prose.
   * Buttons suppress mousedown so the caret and selection survive the click.
   */
  function createInlineFormatToolbar(
    el: HTMLElement,
    options: { allowLinks: boolean },
  ): InlineFormatToolbar {
    const bar = document.createElement("div");
    bar.className = "inline-format-toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Text formatting");

    const buttons: Array<{ key: string; button: HTMLButtonElement }> = [];
    const addButton = (
      key: string,
      label: string,
      title: string,
      onActivate: () => void,
    ): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "inline-format-btn";
      button.innerHTML = label;
      button.title = title;
      button.setAttribute("aria-label", title);
      button.addEventListener("mousedown", (event) => {
        // Keep focus (and the selection) in the text being edited.
        event.preventDefault();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        onActivate();
      });
      bar.appendChild(button);
      buttons.push({ key, button });
      return button;
    };

    const syncState = (): void => {
      for (const entry of buttons) {
        if (entry.key !== "bold" && entry.key !== "italic") continue;
        let active: boolean;
        try {
          active = document.queryCommandState(entry.key);
        } catch {
          active = false;
        }
        entry.button.classList.toggle("active", active);
        entry.button.setAttribute("aria-pressed", String(active));
      }
    };

    addButton("bold", "<strong>B</strong>", "Bold (Cmd/Ctrl+B)", () => {
      applyInlineFormat("bold");
      syncState();
    });
    addButton("italic", "<em>I</em>", "Italic (Cmd/Ctrl+I)", () => {
      applyInlineFormat("italic");
      syncState();
    });

    const linkRow = document.createElement("div");
    linkRow.className = "inline-format-link";
    linkRow.hidden = true;
    const linkInput = document.createElement("input");
    linkInput.type = "text";
    linkInput.className = "text";
    linkInput.placeholder = "https://example.com or /about";
    linkInput.setAttribute("aria-label", "Link address");
    linkRow.appendChild(linkInput);

    let savedRange: Range | null = null;
    const restoreSelection = (): void => {
      if (!savedRange) return;
      const selection = window.getSelection();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(savedRange);
    };

    const applyLink = (): void => {
      const raw = linkInput.value.trim();
      linkRow.hidden = true;
      el.focus();
      restoreSelection();
      if (!raw) return;
      const safe = safeUrl(raw);
      if (!safe) {
        deps.setStatus("That link type is not allowed.");
        return;
      }
      applyInlineFormat("createLink", safe);
      deps.setStatus("Added link.");
    };

    const promptLink = (): void => {
      if (!options.allowLinks) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        deps.setStatus("Select the words you want to link first.");
        return;
      }
      savedRange = selection.getRangeAt(0).cloneRange();
      const existing = selection.anchorNode?.parentElement?.closest("a");
      linkInput.value = existing?.getAttribute("href") ?? "";
      linkRow.hidden = false;
      linkInput.focus();
      linkInput.select();
    };

    if (options.allowLinks) {
      addButton(
        "link",
        '<i data-lucide="link"></i>',
        "Add link (Cmd/Ctrl+K)",
        () => promptLink(),
      );
      addButton("unlink", '<i data-lucide="unlink"></i>', "Remove link", () => {
        applyInlineFormat("unlink");
      });
    }
    addButton(
      "removeFormat",
      '<i data-lucide="remove-formatting"></i>',
      "Clear formatting",
      () => {
        applyInlineFormat("removeFormat");
        syncState();
      },
    );

    linkInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyLink();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        linkRow.hidden = true;
        el.focus();
        restoreSelection();
      }
    });

    bar.appendChild(linkRow);
    document.body.appendChild(bar);
    deps.refreshIcons();

    const position = (): void => {
      const rect = el.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      const top = Math.max(8, rect.top - barRect.height - 8);
      const left = Math.min(
        Math.max(8, rect.left),
        Math.max(8, window.innerWidth - barRect.width - 8),
      );
      bar.style.top = `${top}px`;
      bar.style.left = `${left}px`;
    };
    position();

    const onSelectionChange = (): void => syncState();
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    syncState();

    return {
      element: bar,
      syncState,
      promptLink,
      destroy: () => {
        document.removeEventListener("selectionchange", onSelectionChange);
        window.removeEventListener("resize", position);
        window.removeEventListener("scroll", position, true);
        bar.remove();
      },
    };
  }

  function startInlineEdit(
    el: HTMLElement,
    block: Block,
    target: InlineEditTarget = { prop: "text" },
  ): void {
    const original = targetCurrentValue(block, target);
    let finished = false;
    el.setAttribute("contenteditable", "true");
    el.setAttribute("role", "textbox");
    el.setAttribute("aria-label", "Edit text");
    el.classList.add("inline-editing");
    isInlineEditing = true;
    el.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const allowLinks = target.allowLinks !== false;
    const toolbar = target.rich
      ? createInlineFormatToolbar(el, { allowLinks })
      : null;

    // When focus moves INTO the toolbar (e.g. the link input), the text's blur
    // handler must not end the session — but once focus leaves the toolbar
    // entirely (click elsewhere on the canvas), the session must finish.
    // Without this, the link-input hop (el -> input -> outside) never fires a
    // blur on `el` and the session stays stuck, swallowing all canvas clicks.
    const onToolbarFocusOut = (event: FocusEvent): void => {
      const next = event.relatedTarget;
      if (
        next instanceof Node &&
        (toolbar!.element.contains(next) || el.contains(next))
      ) {
        return;
      }
      finish();
    };
    toolbar?.element.addEventListener("focusout", onToolbarFocusOut);

    const cleanup = (): void => {
      isInlineEditing = false;
      activeFinish = null;
      el.removeAttribute("contenteditable");
      el.removeAttribute("role");
      el.removeAttribute("aria-label");
      el.classList.remove("inline-editing");
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("keydown", onKeydown);
      el.removeEventListener("paste", onPaste);
      el.removeEventListener("compositionstart", onCompositionStart);
      el.removeEventListener("compositionend", onCompositionEnd);
      toolbar?.element.removeEventListener("focusout", onToolbarFocusOut);
      toolbar?.destroy();
    };
    const readValue = (): string =>
      target.rich
        ? richTextFromElement(el, {
            allowLinks,
            // Line-encoded props must stay on one line or the encoding breaks.
            allowLineBreaks:
              target.multiline === true && target.lineIndex === undefined,
          }).trim()
        : // Non-rich targets are single-line props (stat numbers/labels, icons).
          // A pasted newline would corrupt line-encoded props (a "\n" inside
          // one "left :: right" line shifts every following pair), so collapse
          // it like the rich path does.
          el.innerText.trim().replace(/\s*\n+\s*/g, " ");
    const finish = () => {
      if (finished) return;
      finished = true;
      activeFinish = null;
      const newText = readValue();
      cleanup();
      if (newText !== original) {
        deps.pushUndo();
        applyInlineValue(block, target, newText);
        deps.commitBlockChange(`Edited ${block.type} content`);
      } else {
        deps.renderCanvas();
        deps.renderProperties();
      }
    };
    const cancel = (): void => {
      if (finished) return;
      finished = true;
      activeFinish = null;
      el.innerText = original;
      cleanup();
      deps.renderCanvas();
      deps.renderProperties();
    };
    const onPaste = (event: ClipboardEvent): void => {
      deps.handlePlainTextPaste(event);
    };
    // Focus moving into the format toolbar is still part of this edit session.
    // Clicking away MID-COMPOSITION (CJK): committing the session would store
    // the partial/cancelled candidate text. Defer the finish until the
    // composition ends.
    let composing = false;
    const onCompositionStart = (): void => {
      composing = true;
    };
    const onCompositionEnd = (): void => {
      composing = false;
    };
    const onBlur = (event: FocusEvent): void => {
      const next = event.relatedTarget;
      if (toolbar && next instanceof Node && toolbar.element.contains(next)) {
        return;
      }
      if (composing) {
        // The composition's own blur will follow; schedule the finish after
        // it ends.
        el.addEventListener(
          "compositionend",
          () => {
            if (isInlineEditing) finish();
          },
          { once: true },
        );
        return;
      }
      finish();
    };
    el.addEventListener("compositionstart", onCompositionStart);
    el.addEventListener("compositionend", onCompositionEnd);
    const onKeydown = (event: KeyboardEvent): void => {
      // IME composition (CJK etc.): Enter confirms a candidate and Esc
      // cancels it — neither must finish/cancel the edit session mid-
      // composition (previously Enter committed partial text and Esc wiped
      // the whole edit).
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      if (target.rich && (event.metaKey || event.ctrlKey)) {
        const key = event.key.toLowerCase();
        if (key === "b" || key === "i") {
          event.preventDefault();
          applyInlineFormat(key === "b" ? "bold" : "italic");
          toolbar?.syncState();
          return;
        }
        if (key === "k" && allowLinks) {
          event.preventDefault();
          toolbar?.promptLink();
          return;
        }
      }
      if (event.key === "Enter") {
        // Allow a literal line break only for free-form multiline props. Targets
        // backed by a line-encoded shared prop (lineIndex set, e.g. an accordion
        // answer) must NOT contain newlines — that would corrupt the encoding —
        // so those still commit on Enter.
        const allowNewline = target.multiline && target.lineIndex === undefined;
        if (!allowNewline || event.metaKey || event.ctrlKey) {
          event.preventDefault();
          finish();
        }
      }
    };
    activeFinish = finish;
    el.addEventListener("blur", onBlur);
    el.addEventListener("keydown", onKeydown);
    el.addEventListener("paste", onPaste);
  }

  function attachInlineTarget(
    root: HTMLElement,
    selector: string,
    block: Block,
    target: InlineEditTarget,
  ): HTMLElement | null {
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) return null;
    el.classList.add("editable-text-target");
    el.title = "Double-click to edit text";
    el.ondblclick = (event) => {
      // Already editing: let the browser's native word-selection happen instead
      // of restarting the edit session (which would collapse the selection).
      if (isInlineEditing) return;
      event.preventDefault();
      event.stopPropagation();
      startInlineEdit(el, block, target);
    };
    return el;
  }

  function attachInlineEditors(root: HTMLElement, block: Block): HTMLElement[] {
    const targets: HTMLElement[] = [];
    const add = (selector: string, target: InlineEditTarget) => {
      const el = attachInlineTarget(root, selector, block, target);
      if (el) targets.push(el);
    };
    switch (block.type) {
      case "heading":
      case "text":
      case "button":
      case "section":
        // Headings and buttons are single-line labels, so Enter commits the
        // edit. Body copy keeps Enter as a line break (Cmd/Ctrl+Enter or blur
        // commits).
        add(":scope > *", {
          prop: "text",
          multiline: block.type === "text" || block.type === "section",
          rich: true,
          // A button's label is already inside an <a>; a nested link is
          // invalid.
          allowLinks: block.type !== "button",
        });
        break;
      case "columns":
        root.querySelectorAll<HTMLElement>(".zephus-column").forEach((_, i) =>
          add(`.zephus-column:nth-of-type(${i + 1})`, {
            prop: `col${i + 1}`,
            multiline: true,
            rich: true,
          }),
        );
        break;
      case "card":
        add("h3", { prop: "title", rich: true });
        add("p", { prop: "text", multiline: true, rich: true });
        break;
      case "quote":
        add("p", { prop: "text", multiline: true, rich: true });
        add("cite", { prop: "cite", rich: true });
        break;
      case "list":
        root.querySelectorAll<HTMLElement>("li").forEach((_, i) =>
          add(`li:nth-of-type(${i + 1})`, {
            prop: "items",
            lineIndex: i,
            rich: true,
          }),
        );
        break;
      case "feature":
        add(".zephus-feature-icon", { prop: "icon" });
        add("h3", { prop: "title", rich: true });
        add("p", { prop: "text", multiline: true, rich: true });
        break;
      case "testimonial":
        add("blockquote", { prop: "quote", multiline: true, rich: true });
        add("figcaption strong", { prop: "author", rich: true });
        add("figcaption span", { prop: "role", rich: true });
        break;
      case "accordion":
        root.querySelectorAll<HTMLElement>("details").forEach((_, i) => {
          add(`details:nth-of-type(${i + 1}) summary`, {
            prop: "items",
            lineIndex: i,
            pairSide: "left",
            rich: true,
          });
          add(`details:nth-of-type(${i + 1}) p`, {
            prop: "items",
            lineIndex: i,
            pairSide: "right",
            multiline: true,
            rich: true,
          });
        });
        break;
      case "stats":
        root.querySelectorAll<HTMLElement>(".zephus-stat").forEach((_, i) => {
          add(`.zephus-stat:nth-of-type(${i + 1}) .zephus-stat-num`, {
            prop: "items",
            lineIndex: i,
            pairSide: "left",
          });
          add(`.zephus-stat:nth-of-type(${i + 1}) .zephus-stat-label`, {
            prop: "items",
            lineIndex: i,
            pairSide: "right",
          });
        });
        break;
      case "pricing":
        add("h3", { prop: "plan", rich: true });
        add(".zephus-price-amount", { prop: "price" });
        add(".zephus-price-period", { prop: "period" });
        root.querySelectorAll<HTMLElement>("li").forEach((_, i) =>
          add(`li:nth-of-type(${i + 1})`, {
            prop: "features",
            lineIndex: i,
            rich: true,
          }),
        );
        // Button labels render inside an <a>, so links are not offered.
        add("a.button", { prop: "ctaText", rich: true, allowLinks: false });
        break;
      case "cta":
        add("h2", { prop: "heading", rich: true });
        add("p", { prop: "text", multiline: true, rich: true });
        add("a.button", { prop: "buttonText", rich: true, allowLinks: false });
        break;
    }
    return targets;
  }

  function startFirstInlineEdit(root: HTMLElement, block: Block): void {
    const first = attachInlineEditors(root, block)[0];
    if (!first) return;
    first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  }

  return {
    /** True while a contenteditable edit session is active. */
    isInlineEditing: (): boolean => isInlineEditing,
    /**
     * Commits the active edit session into the block tree immediately (used
     * before a save, so the serialized content includes the in-flight edit).
     * No-op when no session is active.
     */
    finishInlineEdit: (): void => {
      activeFinish?.();
    },
    attachInlineEditors,
    startFirstInlineEdit,
  };
}
