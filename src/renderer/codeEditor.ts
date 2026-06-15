// CodeMirror-backed code editor wrapper. Provides a tiny imperative API the
// rest of the renderer uses, so the editor implementation stays isolated.
import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { html } from "@codemirror/lang-html";
import { oneDark } from "@codemirror/theme-one-dark";

export interface CodeEditor {
  getValue(): string;
  setValue(value: string): void;
  focus(): void;
}

/** Mounts a CodeMirror editor into the given container element. */
export function createCodeEditor(
  container: HTMLElement,
  onChange: () => void,
): CodeEditor {
  const language = new Compartment();

  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: "",
      extensions: [
        basicSetup,
        language.of(html()),
        oneDark,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange();
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "var(--code-font-size, 13px)" },
          ".cm-scroller": {
            fontFamily: "'SFMono-Regular', Consolas, monospace",
          },
        }),
      ],
    }),
  });

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (value: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    },
    focus: () => view.focus(),
  };
}
