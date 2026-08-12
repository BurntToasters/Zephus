// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUndoOps } from "../editorUndoOps";
import {
  pushEditorSnapshot,
  pushEditorUndo,
  captureEditorSnapshot,
} from "../editorUndo";
import type { EditorSessionState } from "../editorSession";

interface FakeSection {
  id: string;
  type: string;
  label: string;
  props: Record<string, string>;
  children: Array<{ id: string; type: string; props: Record<string, string> }>;
}

function makeState(
  children: Array<{
    id: string;
    type: string;
    props: Record<string, string>;
  }> = [],
): EditorSessionState {
  return {
    sections: [
      { id: "s1", type: "section", label: "S", props: {}, children },
    ] as unknown as FakeSection[],
    undo: [] as unknown[],
    redo: [] as unknown[],
    rawCode: "",
    generatedCode: "",
    pageDirty: false,
    siteDirty: false,
    pendingSiteDocument: null,
    siteDocument: null,
    project: null,
  } as unknown as EditorSessionState;
}

function makeDeps(state: EditorSessionState) {
  const calls: string[] = [];
  let latchActive = false;
  const deps = {
    getState: () => state,
    isLatchActive: () => latchActive,
    restoreSnapshot: vi.fn(() => calls.push("restore")),
    syncSelectionAfterRestore: () => calls.push("sync-selection"),
    serializeBlocks: () => JSON.stringify(state.sections),
    trackChange: () => calls.push("track"),
    markDirty: (dirty: boolean) => {
      calls.push("markDirty:" + dirty);
    },
    renderLayers: () => calls.push("layers"),
    renderCanvas: () => calls.push("canvas"),
    renderProperties: () => calls.push("properties"),
    updateUndoRedoButtons: () => calls.push("undo-buttons"),
  } as unknown as Parameters<typeof createUndoOps>[0];
  return { deps, calls, setLatch: (v: boolean) => (latchActive = v) };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("undo ops", () => {
  it("ignores undo while the inspector latch is active (mid-drag)", () => {
    const state = makeState();
    const { deps, calls, setLatch } = makeDeps(state);
    const ops = createUndoOps(deps);
    setLatch(true);
    ops.doUndo();
    expect(calls).toHaveLength(0);
  });

  it("does nothing when the undo stack is empty", () => {
    const state = makeState();
    const { deps, calls } = makeDeps(state);
    createUndoOps(deps).doUndo();
    expect(calls).not.toContain("restore");
  });

  it("pops the undo entry and pushes the current state onto redo", () => {
    const state = makeState([
      { id: "b1", type: "heading", props: { text: "v1" } },
    ]);
    // v2: a second section state
    (state.sections as unknown as FakeSection[])[0]!.children = [
      { id: "b1", type: "heading", props: { text: "v2" } },
    ];
    const { deps, calls } = makeDeps(state);
    const ops = createUndoOps(deps);
    pushEditorUndo(state);
    // Redo stack must now hold the v2 state.
    ops.doUndo();
    expect(calls).toContain("restore");
    expect(calls).toContain("layers");
    expect(state.redo).toHaveLength(1);
  });

  it("marks the session dirty when undoing away from the saved source", () => {
    const state = makeState([
      { id: "b1", type: "heading", props: { text: "v1" } },
    ]);
    // Capture the pre-mutation (saved) snapshot, mutate, then push it.
    const saved = captureEditorSnapshot(state);
    state.rawCode = "v1-saved";
    (state.sections as unknown as FakeSection[])[0]!.children = [
      { id: "b1", type: "heading", props: { text: "v2" } },
    ];
    pushEditorSnapshot(state, saved);
    const { deps, calls } = makeDeps(state);
    const ops = createUndoOps(deps);
    ops.doUndo();
    // serializeBlocks() returns the restored v1 tree — not the saved source —
    // so the session must stay dirty.
    expect(calls).toContain("markDirty:true");
  });

  it("clears the dirty flag when undoing back to the saved source", () => {
    const state = makeState([
      { id: "b1", type: "heading", props: { text: "v1" } },
    ]);
    state.rawCode = JSON.stringify(state.sections);
    const { deps, calls } = makeDeps(state);
    const ops = createUndoOps(deps);
    // Snapshot the pre-mutation (saved) state, then mutate.
    const saved = captureEditorSnapshot(state);
    (state.sections as unknown as FakeSection[])[0]!.children = [
      { id: "b1", type: "heading", props: { text: "v2" } },
    ];
    pushEditorSnapshot(state, saved);
    // Undo restores the v1 tree — serializeBlocks then equals rawCode.
    (deps.restoreSnapshot as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        (state.sections as unknown as FakeSection[]) = [
          {
            id: "s1",
            type: "section",
            label: "S",
            props: {},
            children: [{ id: "b1", type: "heading", props: { text: "v1" } }],
          },
        ];
      },
    );
    void saved;
    ops.doUndo();
    expect(calls).toContain("markDirty:false");
  });

  it("redoes after an undo", () => {
    const state = makeState([
      { id: "b1", type: "heading", props: { text: "v1" } },
    ]);
    const { deps, calls } = makeDeps(state);
    const ops = createUndoOps(deps);
    pushEditorUndo(state);
    ops.doUndo();
    const undoRestores = calls.filter((c) => c === "restore").length;
    ops.doRedo();
    expect(calls.filter((c) => c === "restore").length).toBe(undoRestores + 1);
  });
});
