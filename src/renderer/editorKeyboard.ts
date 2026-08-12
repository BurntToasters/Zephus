/**
 * Global keyboard shortcuts for the editor. Extracted from the engine: the
 * guards (modal open, editing, chrome-control focus, loading/closed) and the
 * visual/code dispatch live in one testable place.
 */

import type { EditorSessionState } from "./editorSession";
import type { EditorBlock, SectionNode } from "../main/types";

type Block = EditorBlock;

export interface KeyboardDeps {
  getState: () => EditorSessionState;
  isBusy: () => boolean;
  modalController: { isOpen: () => boolean };
  openHelpModal: () => void;
  performSave: () => Promise<boolean>;
  setViewport: (vp: "desktop" | "tablet" | "mobile") => void;
  setMode: (mode: "visual" | "code") => void;
  openFindReplaceModal: () => Promise<void>;
  updateUndoRedoButtons: () => void;
  doUndo: () => void;
  doRedo: () => void;
  findSelectedBlock: () => Block | null;
  findSection: (id: string | null) => SectionNode | null;
  duplicateSelectedBlock: (block: Block) => void;
  duplicateSection: (id: string) => void;
  copySelectionToClipboard: () => void;
  cutSelectionToClipboard: () => Promise<void>;
  pasteFromClipboard: () => void;
  deleteBlock: (block: Block) => Promise<void>;
  deleteSection: (id: string) => Promise<void>;
  cmUndo: () => void;
  cmRedo: () => void;
}

export function createKeyboardHandler(deps: KeyboardDeps) {
  const {
    getState,
    modalController,
    openHelpModal,
    performSave,
    setViewport,
    setMode,
    openFindReplaceModal,
    updateUndoRedoButtons,
    doUndo,
    doRedo,
    findSelectedBlock,
    findSection,
    duplicateSelectedBlock,
    duplicateSection,
    copySelectionToClipboard,
    cutSelectionToClipboard,
    pasteFromClipboard,
    deleteBlock,
    deleteSection,
  } = deps;

  const state = getState();

  function onKeydown(e: KeyboardEvent): void {
    const active = document.activeElement as HTMLElement | null;
    const editing =
      !!active &&
      (active.isContentEditable ||
        active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT");
    const mod = e.ctrlKey || e.metaKey;

    if (
      deps.isBusy() &&
      ((mod &&
        ["s", "z", "y", "d", "c", "x", "v"].includes(e.key.toLowerCase())) ||
        e.key === "Delete" ||
        e.key === "Backspace")
    ) {
      e.preventDefault();
      return;
    }

    // A modal being open must not let canvas shortcuts mutate the page behind
    // it: Cmd+Z/Y/C/X/V/D, Delete/Backspace, Cmd+S and Cmd+F all operate on the
    // editor canvas/state, and the modal's background is inert only for focus
    // and screen readers — document keydown still fires. (Modal-owned keys —
    // Escape/Tab — live in the modal controller's own capture handler.)
    const modalOpen = modalController.isOpen();
    if (
      modalOpen &&
      (mod ||
        e.key === "Delete" ||
        e.key === "Backspace" ||
        e.key === "?" ||
        e.key === "h" ||
        e.key === "H")
    ) {
      return;
    }

    if ((e.key === "?" || e.key === "h" || e.key === "H") && !editing) {
      if (!modalController.isOpen()) {
        // Only fire from the page background or the canvas itself — a bare
        // "h" while a palette item, template card, toolbar button, block shell
        // or workspace tab holds focus would otherwise hijack the keystroke.
        const isBackgroundFocus =
          active === null ||
          active === document.body ||
          active.id === "canvas" ||
          active.id === "app" ||
          active.classList.contains("start-container");
        if (isBackgroundFocus) openHelpModal();
      }
      e.preventDefault();
      return;
    }

    if (!state.project) return;

    if (mod && e.key === "s") {
      void performSave();
      e.preventDefault();
      return;
    }
    // Viewport shortcuts: Mod+1 desktop, Mod+2 tablet, Mod+3 mobile.
    if (mod && !e.shiftKey && ["1", "2", "3"].includes(e.key) && !editing) {
      const viewports = ["desktop", "tablet", "mobile"] as const;
      const viewport = viewports[
        Number(e.key) - 1
      ] as typeof state.currentViewport;
      if (viewport !== state.currentViewport) {
        setViewport(viewport);
      }
      e.preventDefault();
      return;
    }
    // Mod+E toggles Visual/Code mode.
    if (mod && e.key === "e" && !editing) {
      setMode(state.mode === "code" ? "visual" : "code");
      e.preventDefault();
      return;
    }
    if (mod && e.key === "f" && !editing) {
      // CodeMirror's own search keymap also binds Mod-f; when it already handled
      // the keystroke (its panel is open), don't stack the app's modal too.
      if (!e.defaultPrevented) void openFindReplaceModal();
      e.preventDefault();
      return;
    }
    if (state.mode === "code" && mod) {
      // CodeMirror's history keymap binds Mod-z/Mod-y and calls preventDefault
      // (without stopPropagation), so the event still reaches this document
      // handler. Skipping handled events keeps one keystroke from reverting two
      // edit steps.
      if (e.defaultPrevented) return;
      // A plain input (find modal field, page-settings prompt) focused in code
      // mode must keep NATIVE undo — running cm.undo() here hijacked it (the
      // visual-mode editing guard was bypassed by this branch).
      if (editing) return;
      if (e.key === "z" && !e.shiftKey) {
        deps.cmUndo();
        updateUndoRedoButtons();
        e.preventDefault();
        return;
      }
      if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        deps.cmRedo();
        updateUndoRedoButtons();
        e.preventDefault();
        return;
      }
    }
    if (state.mode !== "visual") return;
    if (editing) return;
    // Don't let a destructive block shortcut fire while a chrome control (e.g. a
    // toolbar button) holds focus — only when a block itself is the focus/target.
    const onChromeControl =
      !!active &&
      (active.tagName === "BUTTON" ||
        active.getAttribute("role") === "button") &&
      !active.classList.contains("block");
    if (
      onChromeControl &&
      (e.key === "Delete" ||
        e.key === "Backspace" ||
        e.key === "d" ||
        e.key === "D")
    ) {
      return;
    }
    if (mod && e.key === "z" && !e.shiftKey) {
      doUndo();
      e.preventDefault();
    } else if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
      doRedo();
      e.preventDefault();
    } else if (mod && (e.key === "d" || e.key === "D")) {
      const block = findSelectedBlock();
      if (block) {
        duplicateSelectedBlock(block);
        e.preventDefault();
      } else if (state.selectedSectionId && !state.selectedId) {
        duplicateSection(state.selectedSectionId);
        e.preventDefault();
      }
    } else if (mod && e.key === "c") {
      copySelectionToClipboard();
      e.preventDefault();
    } else if (mod && e.key === "x") {
      void cutSelectionToClipboard();
      e.preventDefault();
    } else if (mod && e.key === "v") {
      pasteFromClipboard();
      e.preventDefault();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      const block = findSelectedBlock();
      if (block && !block.locked) {
        void deleteBlock(block);
        e.preventDefault();
      } else if (!block && state.selectedSectionId && !state.selectedId) {
        const section = findSection(state.selectedSectionId);
        if (section && !section.locked) {
          void deleteSection(state.selectedSectionId);
          e.preventDefault();
        }
      }
    }
  }

  return { onKeydown };
}
