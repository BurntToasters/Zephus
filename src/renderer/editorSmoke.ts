/**
 * Editor smoke harness (--smoke / ?smoke=1). Drives real DOM interactions in
 * the packaged app: inspector input, inline editing, canvas link inertness,
 * undo/redo, resize handles. Failures surface via __zephusSmokeReport.
 */

import type { EditorSessionState } from "./editorSession";
import type { EditorBlock, SectionNode } from "../main/types";

type Block = EditorBlock;

export interface EditorSmokeDeps {
  getState: () => EditorSessionState;
  $: (id: string) => HTMLElement;
  setMode: (mode: "visual" | "code") => void;
  renderLayers: () => void;
  renderCanvas: () => void;
  renderProperties: () => void;
  syncBlocksFromSections: () => void;
  markPageDirty: (state: EditorSessionState, dirty: boolean) => void;
  addBlockAt: (
    type: "heading" | "text" | "image" | "html" | "section" | "card",
    index: number,
    sectionId?: string | null,
  ) => void;
  findBlockLocation: (id: string | null) => {
    section: SectionNode;
    block: Block;
    blockIndex: number;
  } | null;
}

export function installEditorSmokeHook(deps: EditorSmokeDeps): void {
  const {
    getState,
    $,
    setMode,
    renderLayers,
    renderCanvas,
    renderProperties,
    syncBlocksFromSections,
    markPageDirty,
    addBlockAt,
    findBlockLocation,
  } = deps;

  window.__zephusRunEditorSmoke = () => {
    const state = getState();
    const failures: string[] = [];
    const assert = (condition: unknown, message: string): void => {
      if (!condition) failures.push(message);
    };

    const section: SectionNode = {
      id: "smoke-section",
      type: "section",
      label: "Smoke Section",
      props: { wrapper: "none", cls: "" },
      children: [
        {
          id: "smoke-heading",
          type: "heading",
          props: { text: "Smoke Title", level: "2" },
          style: {},
        },
        {
          id: "smoke-button",
          type: "button",
          props: {
            text: "Smoke Link",
            href: "https://example.com",
            cls: "",
          },
          style: {},
        },
      ],
    };
    state.sections = [section];
    // A project object enables the document-level keyboard shortcuts
    // (undo/redo/delete) the smoke exercises below.
    state.project = {
      path: "/smoke-project",
      name: "Smoke Project",
    } as ProjectOpenResult;
    state.selectedSectionId = section.id;
    state.selectedId = "smoke-heading";
    state.page = "src/pages/index.astro";
    state.currentMeta = {
      page: state.page,
      route: "/",
      slug: "index",
      title: "Smoke",
      navLabel: "Smoke",
      metaDescription: "",
      navVisible: true,
      isHome: true,
      detached: false,
      socialImage: "",
      canonicalUrl: "",
      noindex: false,
      publishDate: "",
      author: "",
    };
    state.pageMeta = state.currentMeta ? [state.currentMeta] : [];
    state.currentViewport = "desktop";
    state.undo = [];
    state.redo = [];
    markPageDirty(state, false);
    syncBlocksFromSections();

    $("view-start").classList.add("hidden");
    $("view-editor").classList.remove("hidden");
    $("project-name").textContent = "Smoke Project";
    setMode("visual");
    renderLayers();
    renderCanvas();
    renderProperties();

    assert(
      !!document.querySelector(".block.selected"),
      "Editor smoke: selected block did not render.",
    );
    assert(
      document.querySelectorAll(".resize-handle").length === 4,
      "Editor smoke: selected block resize handles missing.",
    );

    const textInput = document.querySelector<HTMLInputElement>(
      "#properties input.text",
    );
    assert(!!textInput, "Editor smoke: inspector text input missing.");
    if (textInput) {
      textInput.focus();
      textInput.value = "";
      for (const char of "Smoke Typed") {
        textInput.value += char;
        textInput.dispatchEvent(new Event("input", { bubbles: true }));
        assert(
          document.activeElement === textInput,
          "Editor smoke: inspector input lost focus while typing.",
        );
      }
      assert(
        section.children[0]?.props["text"] === "Smoke Typed",
        "Editor smoke: inspector input did not update block props.",
      );
      textInput.blur();
    }

    const target = document.querySelector<HTMLElement>(
      ".block-preview .editable-text-target",
    );
    assert(!!target, "Editor smoke: inline editable target missing.");
    if (target) {
      target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      assert(
        target.isContentEditable,
        "Editor smoke: double-click did not start inline editing.",
      );
      target.textContent = "Inline Edited";
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      assert(
        section.children[0]?.props["text"] === "Inline Edited",
        "Editor smoke: inline edit did not update block props.",
      );
    }

    const canvasLink = document.querySelector<HTMLAnchorElement>(
      '.block-preview a[href="https://example.com"]',
    );
    assert(!!canvasLink, "Editor smoke: canvas link missing.");
    if (canvasLink) {
      const allowed = canvasLink.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      assert(!allowed, "Editor smoke: canvas link was not inert.");
    }

    // The canvas-link click above selected the button block; restore the
    // heading selection so the inspector edits the heading again.
    state.selectedId = "smoke-heading";
    state.selectedSectionId = section.id;
    renderProperties();

    // Undo/redo through the real inspector latch: typing commits one undo
    // entry on blur, Ctrl+Z reverts it, Ctrl+Shift+Z (or Cmd+Y) redoes.
    // Re-query the input: renderProperties() replaced the panel element.
    const redoKeys = (): void => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "z",
          ctrlKey: true,
          shiftKey: true,
        }),
      );
    };
    const undoKey = (): void => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "z",
          ctrlKey: true,
        }),
      );
    };
    const freshInput = document.querySelector<HTMLInputElement>(
      "#properties input.text",
    );
    assert(
      !!freshInput,
      "Editor smoke: inspector input missing after re-render.",
    );
    if (freshInput) {
      freshInput.focus();
      let directFired = false;
      const directListener = () => {
        directFired = true;
      };
      freshInput.addEventListener("input", directListener);
      freshInput.value = "Undo Me";
      freshInput.dispatchEvent(new Event("input", { bubbles: true }));
      freshInput.removeEventListener("input", directListener);
      const afterInput = section.children[0]?.props["text"];
      freshInput.blur();
      const afterBlur = section.children[0]?.props["text"];
      assert(
        afterBlur === "Undo Me",
        `Editor smoke: inspector blur did not commit (afterInput=${JSON.stringify(afterInput)} afterBlur=${JSON.stringify(afterBlur)} attached=${document.contains(freshInput)} direct=${directFired} selected=${state.selectedId} dirty=${state.pageDirty})`,
      );
      undoKey();
      assert(
        section.children[0]?.props["text"] !== "Undo Me",
        "Editor smoke: Ctrl+Z did not revert the inspector edit.",
      );
      redoKeys();
      assert(
        section.children[0]?.props["text"] === "Undo Me",
        "Editor smoke: redo did not restore the inspector edit.",
      );
    }

    // Add a block, duplicate the section, then undo both back to baseline.
    const beforeAdd = state.sections[0]?.children.length ?? 0;
    addBlockAt("text", 1, section.id);
    assert(
      (state.sections[0]?.children.length ?? 0) === beforeAdd + 1,
      "Editor smoke: addBlockAt did not insert a block.",
    );
    undoKey();
    assert(
      state.sections[0]?.children.length === beforeAdd,
      "Editor smoke: undo did not remove the added block.",
    );

    // The block-add above changed the selection; re-select the heading.
    state.selectedId = "smoke-heading";
    state.selectedSectionId = section.id;
    renderCanvas();
    renderProperties();

    // Keyboard resize of the selected block writes width + undo restores it.
    const selBlock = findBlockLocation(state.selectedId);
    const originalWidth = selBlock?.block.style?.width;
    const handle =
      document.querySelector<HTMLButtonElement>(".resize-handle.se");
    assert(!!handle, "Editor smoke: resize handle missing for keyboard test.");
    if (handle) {
      handle.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "ArrowRight",
        }),
      );
      assert(
        selBlock?.block.style?.width !== originalWidth,
        `Editor smoke: keyboard resize did not change the width (before=${JSON.stringify(originalWidth)} after=${JSON.stringify(selBlock?.block.style?.width)} selected=${state.selectedId} handles=${document.querySelectorAll(".resize-handle").length})`,
      );
      undoKey();
      const restored = findBlockLocation("smoke-heading");
      assert(
        restored?.block.style?.width === originalWidth,
        `Editor smoke: undo did not restore the pre-resize width (before=${JSON.stringify(originalWidth)} after=${JSON.stringify(restored?.block.style?.width)})`,
      );
    }

    // Inline edit Escape cancels and restores the original text.
    if (target) {
      target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      target.textContent = "Should Not Stick";
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
      assert(
        section.children[0]?.props["text"] === "Undo Me",
        "Editor smoke: Escape did not cancel the inline edit.",
      );
    }

    return failures;
  };
}
