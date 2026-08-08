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
  if (text) {
    document.execCommand("insertText", false, text);
    return;
  }
  // Some apps expose only text/html (no text/plain fallback); without this,
  // the native paste is already suppressed and the paste silently vanishes.
  const html = event.clipboardData?.getData("text/html") ?? "";
  if (html) {
    // insertHTML would smuggle arbitrary markup into the contenteditable; only
    // its text content is wanted here, matching the plain-text contract.
    const container = document.createElement("div");
    container.innerHTML = html;
    document.execCommand("insertText", false, container.textContent ?? "");
  }
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

/**
 * Mounts a Solid panel when its container exists. Missing containers are
 * treated as optional (success). Thrown mount errors are reported via onError.
 */
export function tryMountPanel(
  label: string,
  container: HTMLElement | null | undefined,
  mount: (container: HTMLElement) => void,
  onError?: (label: string, error: unknown) => void,
): boolean {
  if (!container) return true;
  try {
    mount(container);
    return true;
  } catch (error) {
    onError?.(label, error);
    return false;
  }
}

export function formatPanelMountFailureStatus(failures: string[]): string {
  if (failures.length === 0) return "";
  return `Some editor panels failed to load: ${failures.join(", ")}.`;
}

export function isNodeLocked(
  node: { locked?: boolean } | null | undefined,
): boolean {
  return !!node?.locked;
}

export function lockedMutationMessage(
  scope: "block" | "section" | "target-section",
): string {
  switch (scope) {
    case "block":
      return "This block is locked. Unlock it to edit.";
    case "section":
      return "This section is locked. Unlock it to edit.";
    case "target-section":
      return "That section is locked. Unlock it to add or move content there.";
  }
}
