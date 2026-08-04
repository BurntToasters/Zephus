import { describe, it, expect, vi } from "vitest";
import { createEditorSession } from "../editorSession";
import {
  captureEditorSnapshot,
  EDITOR_UNDO_LIMIT,
  editorSnapshotSectionsChanged,
  popEditorRedoEntry,
  popEditorUndoEntry,
  pushEditorRedoFromCurrent,
  pushEditorUndo,
  pushEditorUndoFromCurrent,
  restoreEditorSnapshot,
} from "../editorUndo";

describe("editorUndo", () => {
  it("captures sections and effective site document", () => {
    const state = createEditorSession();
    state.sections = [
      {
        id: "s1",
        type: "section",
        label: "Main",
        props: { wrapper: "none" },
        children: [{ id: "b1", type: "text", props: { text: "Hi" } }],
      },
    ];
    state.siteDocument = {
      design: { accent: "#000" },
    } as SiteDocument;
    state.pendingSiteDocument = {
      design: { accent: "#111" },
    } as SiteDocument;

    const snap = captureEditorSnapshot(state);
    expect(snap.sections[0]!.children[0]!.props.text).toBe("Hi");
    expect(snap.site?.design?.accent).toBe("#111");
  });

  it("caps the undo stack", () => {
    const state = createEditorSession();
    const onStackChange = vi.fn();
    for (let i = 0; i < EDITOR_UNDO_LIMIT + 5; i++) {
      state.sections = [
        {
          id: `s${i}`,
          type: "section",
          label: "Main",
          props: {},
          children: [],
        },
      ];
      pushEditorUndo(state, onStackChange);
    }
    expect(state.undo).toHaveLength(EDITOR_UNDO_LIMIT);
    expect(state.redo).toHaveLength(0);
    expect(onStackChange).toHaveBeenCalled();
  });

  it("restores pending site when snapshot differs from saved site", () => {
    const state = createEditorSession();
    state.siteDocument = { design: { accent: "#000" } } as SiteDocument;
    state.pendingSiteDocument = { design: { accent: "#999" } } as SiteDocument;

    const applyDesignPreview = vi.fn();
    restoreEditorSnapshot(
      state,
      {
        sections: [],
        site: { design: { accent: "#222" } } as SiteDocument,
      },
      {
        syncBlocksFromSections: vi.fn(),
        syncSelectionState: vi.fn(),
        applyDesignPreview,
        renderDirtyIndicators: vi.fn(),
      },
    );

    expect(state.pendingSiteDocument?.design?.accent).toBe("#222");
    expect(state.siteDirty).toBe(true);
    expect(applyDesignPreview).toHaveBeenCalled();
  });

  it("detects section changes between snapshot and live state", () => {
    const snap = {
      sections: [
        {
          id: "s1",
          type: "section" as const,
          label: "A",
          props: {},
          children: [],
        },
      ],
      site: null,
    };
    expect(
      editorSnapshotSectionsChanged(snap, [
        {
          id: "s1",
          type: "section",
          label: "A",
          props: {},
          children: [{ id: "b1", type: "text", props: {} }],
        },
      ]),
    ).toBe(true);
  });

  it("clears pending site when the snapshot matches the saved site", () => {
    const state = createEditorSession();
    const saved = { design: { accent: "#000" } } as SiteDocument;
    state.siteDocument = saved;
    state.pendingSiteDocument = { design: { accent: "#999" } } as SiteDocument;
    state.siteDirty = true;

    restoreEditorSnapshot(
      state,
      { sections: [], site: { ...saved } },
      {
        syncBlocksFromSections: vi.fn(),
        syncSelectionState: vi.fn(),
        applyDesignPreview: vi.fn(),
        renderDirtyIndicators: vi.fn(),
      },
    );

    expect(state.pendingSiteDocument).toBeNull();
    expect(state.siteDirty).toBe(false);
  });

  it("leaves site state untouched when the snapshot site matches", () => {
    const state = createEditorSession();
    state.siteDocument = { design: { accent: "#000" } } as SiteDocument;

    const applyDesignPreview = vi.fn();
    restoreEditorSnapshot(
      state,
      { sections: [], site: { design: { accent: "#000" } } as SiteDocument },
      {
        syncBlocksFromSections: vi.fn(),
        syncSelectionState: vi.fn(),
        applyDesignPreview,
        renderDirtyIndicators: vi.fn(),
      },
    );

    expect(applyDesignPreview).not.toHaveBeenCalled();
    expect(state.siteDirty).toBe(false);
  });

  it("pop and push round-trips undo/redo entries", () => {
    const state = createEditorSession();
    state.sections = [
      {
        id: "s1",
        type: "section",
        label: "A",
        props: {},
        children: [],
      },
    ];
    pushEditorUndo(state);
    pushEditorRedoFromCurrent(state);
    pushEditorUndoFromCurrent(state);

    expect(state.redo).toHaveLength(1);
    expect(popEditorRedoEntry(state)?.sections[0]?.label).toBe("A");
    expect(popEditorUndoEntry(state)?.sections[0]?.label).toBe("A");
  });
});
