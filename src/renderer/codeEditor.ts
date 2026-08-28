// CodeMirror-backed code editor wrapper. Provides a tiny imperative API the
// rest of the renderer uses, so the editor implementation stays isolated.
import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { html } from "@codemirror/lang-html";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  indentWithTab,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from "@codemirror/commands";

export interface CodeEditor {
  getValue(): string;
  setValue(value: string): void;
  focus(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

/** Mounts a CodeMirror editor into the given container element. */
export function createCodeEditor(
  container: HTMLElement,
  onChange: () => void,
  onHistoryChange?: () => void,
): CodeEditor {
  const language = new Compartment();

  const extensions: Extension[] = [
    basicSetup,
    // Tab indents / Shift+Tab unindents (documented shortcut; basicSetup does
    // not include it by default).
    keymap.of([indentWithTab]),
    language.of(html()),
    oneDark,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange();
      if (
        update.docChanged ||
        update.transactions.some(
          (tr) => tr.isUserEvent("undo") || tr.isUserEvent("redo"),
        )
      ) {
        onHistoryChange?.();
      }
    }),
    EditorView.theme({
      "&": { height: "100%", fontSize: "var(--code-font-size, 13px)" },
      ".cm-scroller": {
        fontFamily: "'SFMono-Regular', Consolas, monospace",
      },
    }),
  ];

  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: "",
      extensions,
    }),
  });

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (value: string) => {
      // Replacing the whole document (page load, mode switch, save detach)
      // must NOT become an undoable transaction: undoing it would restore the
      // *previous page's* text into the current editor, and a save would then
      // write the wrong content to the wrong page. Recreating the state also
      // drops the previous document's undo/redo history, so the toolbar Undo
      // button is not wrongly enabled after a page switch.
      view.setState(
        EditorState.create({
          doc: value,
          extensions,
        }),
      );
      onHistoryChange?.();
    },
    focus: () => view.focus(),
    undo: () => {
      undo(view);
      onHistoryChange?.();
    },
    redo: () => {
      redo(view);
      onHistoryChange?.();
    },
    canUndo: () => undoDepth(view.state) > 0,
    canRedo: () => redoDepth(view.state) > 0,
  };
}
