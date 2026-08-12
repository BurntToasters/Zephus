// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBlockOpsActions } from "../editorBlockOps";

function makeState() {
  const sectionA = {
    id: "a",
    type: "section",
    label: "A",
    props: { wrapper: "box", cls: "" },
    locked: false,
    children: [
      { id: "b1", type: "heading", props: { text: "Hi" }, style: {} },
      { id: "b2", type: "text", props: { text: "Body" }, style: {} },
    ],
  };
  const sectionB = {
    id: "b",
    type: "section",
    label: "B",
    props: { wrapper: "box", cls: "" },
    locked: false,
    children: [],
  };
  return {
    sections: [sectionA, sectionB],
    selectedId: null as string | null,
    selectedSectionId: null as string | null,
    undo: [] as unknown[],
    redo: [] as unknown[],
    siteDocument: null,
    pendingSiteDocument: null,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const state = makeState();
  const statuses: string[] = [];
  const deps = {
    getState: () => state as never,
    setStatus: (m: string) => statuses.push(m),
    closeModal: () => undefined,
    showModalNode: () => undefined,
    modalController: { confirmDestructive: vi.fn(async () => true) },
    editorRules: { allowedBlocks: null },
    appSettings: null,
    updateUndoRedoButtons: () => undefined,
    renderLayers: () => undefined,
    renderCanvas: () => undefined,
    renderProperties: () => undefined,
    syncBlocksFromSections: () => undefined,
    syncSelectionState: () => undefined,
    beginInspectorEdit: () => undefined,
    endInspectorEdit: () => undefined,
    scheduleCanvasRepaint: () => undefined,
    findSection: (id: string | null) =>
      state.sections.find((s) => s.id === id) ?? null,
    findBlockLocation: (id: string | null) => {
      for (let i = 0; i < state.sections.length; i += 1) {
        const section = state.sections[i]!;
        const index = section.children.findIndex((c) => c.id === id);
        if (index >= 0) {
          return {
            section,
            sectionIndex: i,
            block: section.children[index]!,
            blockIndex: index,
          };
        }
      }
      return null;
    },
    findSelectedBlock: () => {
      for (const section of state.sections) {
        const found = section.children.find((c) => c.id === state.selectedId);
        if (found) return found;
      }
      return null;
    },
    activeSectionId: () => state.selectedSectionId,
    currentPageLabel: () => "Page",
    blockToHtml: (b: { type: string }) => `<${b.type}>`,
    trackChange: () => undefined,
    markDirty: () => undefined,
    cloneBlock: (b: never) => JSON.parse(JSON.stringify(b)),
    cloneSections: (s: never) => JSON.parse(JSON.stringify(s)),
    ensureFallbackSection: () => ({
      id: "f",
      type: "section",
      label: "Main Content",
      props: { wrapper: "box", cls: "" },
      children: [],
    }),
    defaultProps: () => ({}),
    uid: () => `u${Math.random().toString(36).slice(2)}`,
    ...overrides,
  } as never;
  return { deps, state, statuses };
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("block ops", () => {
  it("refuses to add a block into a locked section", () => {
    const { deps, state, statuses } = makeDeps();
    state.sections[0]!.locked = true;
    const ops = createBlockOpsActions(deps);
    ops.addBlockAt("heading", 0, "a");
    expect(statuses.join(" ").toLowerCase()).toContain("unlock");
    expect(state.sections[0]!.children).toHaveLength(2);
  });

  it("moves a trailing block to the next section", () => {
    const { deps, state } = makeDeps();
    const ops = createBlockOpsActions(deps);
    // b2 sits at the last index of section A: moving down crosses sections.
    const block = state.sections[0]!.children[1]!;
    ops.moveBlock(block as never, 1);
    expect(state.sections[0]!.children).toHaveLength(1);
    expect(state.sections[1]!.children).toHaveLength(1);
    expect(state.sections[1]!.children[0]!.id).toBe("b2");
    expect(state.selectedId).toBe("b2");
  });

  it("moves a block up within a section", () => {
    const { deps, state } = makeDeps();
    const ops = createBlockOpsActions(deps);
    const block = state.sections[0]!.children[1]!;
    ops.moveBlock(block as never, -1);
    expect(state.sections[0]!.children[0]!.id).toBe("b2");
  });

  it("duplicates a block with a fresh id", () => {
    const { deps, state } = makeDeps();
    const ops = createBlockOpsActions(deps);
    const block = state.sections[0]!.children[0]!;
    ops.duplicateSelectedBlock(block as never);
    expect(state.sections[0]!.children).toHaveLength(3);
    const copy = state.sections[0]!.children[1]!;
    expect(copy.id).not.toBe("b1");
    expect((copy as { props: { text: string } }).props.text).toBe("Hi");
  });

  it("deletes a block and clears the selection", async () => {
    const { deps, state } = makeDeps({
      appSettings: { confirmBlockDelete: true },
    });
    const ops = createBlockOpsActions(deps);
    state.selectedId = "b1";
    await ops.deleteBlock(state.sections[0]!.children[0]! as never);
    expect(state.sections[0]!.children).toHaveLength(1);
    expect(state.selectedId).toBeNull();
    expect(state.selectedSectionId).toBe("a");
  });

  it("wraps a block in a new section", () => {
    const { deps, state } = makeDeps();
    const ops = createBlockOpsActions(deps);
    const block = state.sections[0]!.children[0]!;
    ops.wrapBlockInSection(block as never);
    expect(state.sections).toHaveLength(3);
    const wrapped = state.sections[1]!;
    expect(wrapped.label).toBe("Heading Section");
    expect(wrapped.children).toHaveLength(1);
    expect(wrapped.children[0]!.id).toBe("b1");
  });

  it("refuses to paste a block into a locked section", () => {
    const { deps, state, statuses } = makeDeps();
    const ops = createBlockOpsActions(deps);
    // Copy the first block, lock the section, then paste.
    state.selectedId = "b1";
    ops.copySelectionToClipboard();
    state.sections[0]!.locked = true;
    ops.pasteFromClipboard();
    expect(statuses.join(" ").toLowerCase()).toContain("unlock");
    expect(state.sections[0]!.children).toHaveLength(2);
  });

  it("pastes a copied block after the selection", () => {
    const { deps, state } = makeDeps();
    const ops = createBlockOpsActions(deps);
    state.selectedId = "b1";
    ops.copySelectionToClipboard();
    ops.pasteFromClipboard();
    expect(state.sections[0]!.children).toHaveLength(3);
    expect(state.selectedId).not.toBe("b1");
  });

  it("duplicates a section with fresh ids for all children", () => {
    const { deps, state } = makeDeps();
    const ops = createBlockOpsActions(deps);
    ops.duplicateSection("a");
    expect(state.sections).toHaveLength(3);
    const copy = state.sections[1]!;
    expect(copy.id).not.toBe("a");
    expect(copy.label).toBe("A Copy");
    expect(copy.children[0]!.id).not.toBe("b1");
  });

  it("refuses to move a locked section", () => {
    const { deps, state, statuses } = makeDeps();
    state.sections[0]!.locked = true;
    const ops = createBlockOpsActions(deps);
    ops.moveSection("a", 1);
    expect(statuses.join(" ").toLowerCase()).toContain("locked");
    expect(state.sections[0]!.id).toBe("a");
  });
});
