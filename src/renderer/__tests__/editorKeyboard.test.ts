// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createKeyboardHandler } from "../editorKeyboard";

function makeDeps(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  let modalOpen = false;
  const deps = {
    getState: () =>
      ({
        mode: "visual",
        currentViewport: "desktop",
        project: { path: "/p" },
        selectedId: "b1",
        selectedSectionId: "a",
      }) as never,
    isBusy: () => false,
    modalController: { isOpen: () => modalOpen },
    openHelpModal: () => calls.push("help"),
    performSave: async () => {
      calls.push("save");
      return true;
    },
    setViewport: (vp: string) => calls.push("viewport:" + vp),
    setMode: (mode: string) => calls.push("mode:" + mode),
    openFindReplaceModal: async () => calls.push("find"),
    updateUndoRedoButtons: () => undefined,
    doUndo: () => calls.push("undo"),
    doRedo: () => calls.push("redo"),
    findSelectedBlock: () =>
      ({ id: "b1", type: "text", locked: false, props: {} }) as never,
    findSection: (id: string | null) =>
      id ? { id, label: "S", locked: false, children: [] } : null,
    duplicateSelectedBlock: () => calls.push("dup-block"),
    duplicateSection: () => calls.push("dup-section"),
    copySelectionToClipboard: () => calls.push("copy"),
    cutSelectionToClipboard: async () => calls.push("cut"),
    pasteFromClipboard: () => calls.push("paste"),
    deleteBlock: async () => calls.push("delete-block"),
    deleteSection: async () => calls.push("delete-section"),
    cmUndo: () => calls.push("cm-undo"),
    cmRedo: () => calls.push("cm-redo"),
    ...overrides,
  } as never;
  return { deps, calls, setModalOpen: (v: boolean) => (modalOpen = v) };
}

function fire(
  handler: (e: KeyboardEvent) => void,
  key: string,
  opts: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
) {
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: !!opts.ctrl,
    metaKey: !!opts.meta,
    shiftKey: !!opts.shift,
    bubbles: true,
    cancelable: true,
  });
  handler(event);
  return event;
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("keyboard handler", () => {
  it("saves on Cmd+S", async () => {
    const { deps, calls } = makeDeps();
    const { onKeydown } = createKeyboardHandler(deps);
    const e = fire(onKeydown, "s", { meta: true });
    expect(calls).toContain("save");
    expect(e.defaultPrevented).toBe(true);
  });

  it("does not fire shortcuts while a modal is open", () => {
    const { deps, calls, setModalOpen } = makeDeps();
    const { onKeydown } = createKeyboardHandler(deps);
    setModalOpen(true);
    fire(onKeydown, "s", { meta: true });
    expect(calls).not.toContain("save");
  });

  it("does not fire while a page is loading", () => {
    const { deps, calls } = makeDeps({ isBusy: () => true });
    const { onKeydown } = createKeyboardHandler(deps);
    fire(onKeydown, "Delete");
    expect(calls).not.toContain("delete-block");
  });

  it("undoes on Cmd+Z and redoes on Cmd+Shift+Z in visual mode", () => {
    const { deps, calls } = makeDeps();
    const { onKeydown } = createKeyboardHandler(deps);
    fire(onKeydown, "z", { meta: true });
    expect(calls).toContain("undo");
    fire(onKeydown, "z", { meta: true, shift: true });
    expect(calls).toContain("redo");
  });

  it("duplicates the selected block on Cmd+D", () => {
    const { deps, calls } = makeDeps();
    const { onKeydown } = createKeyboardHandler(deps);
    fire(onKeydown, "d", { meta: true });
    expect(calls).toContain("dup-block");
  });

  it("deletes the selected block with Delete", () => {
    const { deps, calls } = makeDeps();
    const { onKeydown } = createKeyboardHandler(deps);
    fire(onKeydown, "Delete");
    expect(calls).toContain("delete-block");
  });

  it("refuses destructive keys while a chrome control holds focus", () => {
    const btn = document.createElement("button");
    btn.classList.add("toolbar-btn");
    document.body.appendChild(btn);
    btn.focus();
    const { deps, calls } = makeDeps();
    const { onKeydown } = createKeyboardHandler(deps);
    fire(onKeydown, "Delete");
    expect(calls).not.toContain("delete-block");
  });

  it("switches viewports with Cmd+1/2/3 when the viewport differs", () => {
    const { deps, calls } = makeDeps();
    const { onKeydown } = createKeyboardHandler(deps);
    // Already on desktop: Cmd+1 is a no-op.
    fire(onKeydown, "1", { meta: true });
    expect(calls).not.toContain("viewport:desktop");
    fire(onKeydown, "2", { meta: true });
    expect(calls).toContain("viewport:tablet");
    fire(onKeydown, "3", { meta: true });
    expect(calls).toContain("viewport:mobile");
  });

  it("toggles visual/code mode with Cmd+E", () => {
    const { deps, calls } = makeDeps();
    const { onKeydown } = createKeyboardHandler(deps);
    fire(onKeydown, "e", { meta: true });
    expect(calls).toContain("mode:code");
  });

  it("opens the find modal with Cmd+F", async () => {
    const { deps, calls } = makeDeps();
    const { onKeydown } = createKeyboardHandler(deps);
    fire(onKeydown, "f", { meta: true });
    await Promise.resolve();
    expect(calls).toContain("find");
  });

  it("opens the help modal from the background with '?'", () => {
    const { deps, calls } = makeDeps();
    const { onKeydown } = createKeyboardHandler(deps);
    fire(onKeydown, "?");
    expect(calls).toContain("help");
  });

  it("uses CodeMirror undo in code mode", () => {
    const { deps, calls } = makeDeps({
      getState: () =>
        ({
          mode: "code",
          currentViewport: "desktop",
          project: { path: "/p" },
          selectedId: null,
          selectedSectionId: null,
        }) as never,
    });
    const { onKeydown } = createKeyboardHandler(deps);
    fire(onKeydown, "z", { meta: true });
    expect(calls).toContain("cm-undo");
  });
});
