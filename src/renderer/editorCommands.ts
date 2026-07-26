import type { BlockNode, SectionNode } from "../main/types";

export type EditorClipboardPayload =
  | { kind: "block"; block: BlockNode }
  | { kind: "section"; section: SectionNode };

/** Managed pages cannot round-trip dirty code into visual mode without detaching. */
export function shouldBlockManagedVisualSwitch(
  codeVal: string,
  rawCode: string,
  managedStatus: string,
): boolean {
  return codeVal !== rawCode && managedStatus !== "detached";
}

export function isBlockTypeAllowed(
  type: string,
  allowedBlocks: string[] | null,
): boolean {
  return !allowedBlocks || allowedBlocks.includes(type);
}

export function handlePlainTextPaste(event: ClipboardEvent): void {
  event.preventDefault();
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!text) return;
  document.execCommand("insertText", false, text);
}

export function syncUndoRedoToolbar(options: {
  mode: "visual" | "code";
  visualUndoDepth: number;
  visualRedoDepth: number;
  codeCanUndo: boolean;
  codeCanRedo: boolean;
  undoButton: HTMLButtonElement;
  redoButton: HTMLButtonElement;
}): void {
  if (options.mode === "code") {
    options.undoButton.disabled = !options.codeCanUndo;
    options.redoButton.disabled = !options.codeCanRedo;
  } else {
    options.undoButton.disabled = options.visualUndoDepth === 0;
    options.redoButton.disabled = options.visualRedoDepth === 0;
  }
  options.undoButton.setAttribute(
    "aria-disabled",
    String(options.undoButton.disabled),
  );
  options.redoButton.setAttribute(
    "aria-disabled",
    String(options.redoButton.disabled),
  );
}
