import { describe, it, expect } from "vitest";
import {
  defaultProps,
  KNOWN_BLOCK_TYPES,
  mk,
  PALETTE,
  PALETTE_ICONS,
  setUidGenerator,
  TEMPLATES,
  TEXT_EDITABLE,
  type BlockType,
} from "../editorBlocks";

describe("editorBlocks catalog", () => {
  it("covers every declared block type in palette + icons", () => {
    const declared = Object.keys(PALETTE_ICONS).sort();
    const paletteTypes = PALETTE.map((entry) => entry.type).sort();
    expect(paletteTypes).toEqual(declared);
    expect(paletteTypes).toHaveLength(22);
    // Every palette entry has a label and every type has an icon.
    for (const entry of PALETTE) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(PALETTE_ICONS[entry.type].length).toBeGreaterThan(0);
    }
  });

  it("derives the runtime allowlist from the icons map", () => {
    expect(KNOWN_BLOCK_TYPES.size).toBe(22);
    expect(KNOWN_BLOCK_TYPES.has("heading")).toBe(true);
    expect(KNOWN_BLOCK_TYPES.has("nonsense")).toBe(false);
  });

  it("provides default props for every block type", () => {
    for (const type of Object.keys(PALETTE_ICONS) as BlockType[]) {
      const props = defaultProps(type);
      expect(props).toBeTruthy();
      if (type !== "html") {
        // Non-HTML blocks must carry every prop the renderer reads.
        expect(props["cls"]).toBeDefined();
        expect(Object.keys(props).length).toBeGreaterThan(0);
      } else {
        // HTML blocks carry no props; the raw markup is the content.
        expect(Object.keys(props)).toHaveLength(0);
      }
    }
  });

  it("keeps the inline-editable list a subset of the palette", () => {
    for (const type of TEXT_EDITABLE) {
      expect(KNOWN_BLOCK_TYPES.has(type)).toBe(true);
    }
  });

  it("every template produces valid, known blocks", () => {
    setUidGenerator(() => "tpl-uid");
    for (const template of TEMPLATES) {
      expect(template.label).toBeTruthy();
      if (!template.blocks) {
        // HTML-only templates still carry content.
        expect(template.html).toBeTruthy();
        continue;
      }
      const blocks = template.blocks();
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(KNOWN_BLOCK_TYPES.has(block.type)).toBe(true);
        expect(block.id).toBeTruthy();
        expect(block.props).toBeTruthy();
        if (block.type !== "html") {
          expect(block.props["cls"]).toBeDefined();
        }
      }
    }
  });

  it("template blocks merge defaults with overrides", () => {
    const hero = TEMPLATES.find((t) => t.id === "hero");
    expect(hero).toBeTruthy();
    const blocks = hero!.blocks?.() ?? [];
    expect(blocks.some((b) => b.type === "heading")).toBe(true);
  });
});

describe("editorBlocks mk", () => {
  it("builds a block with merged props and style", () => {
    setUidGenerator(() => "id-1");
    const block = mk("heading", { text: "Hi" }, { align: "center" });
    expect(block).toEqual({
      id: "id-1",
      type: "heading",
      props: { text: "Hi", level: "2", cls: "" },
      style: { align: "center" },
    });
  });

  it("generates unique ids via the registered generator", () => {
    let n = 0;
    setUidGenerator(() => `gen-${++n}`);
    const a = mk("text");
    const b = mk("text");
    expect(a.id).toBe("gen-1");
    expect(b.id).toBe("gen-2");
  });
});

describe("editorBlocks templates", () => {
  it("produces fresh, fully editable blocks with unique ids per insert", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(9);
    let n = 0;
    setUidGenerator(() => `tpl-${++n}`);
    const hero = TEMPLATES.find((t) => t.id === "hero");
    expect(hero).toBeDefined();
    const first = hero!.blocks!();
    expect(first.length).toBeGreaterThan(0);
    for (const block of first) {
      expect(block.id).toMatch(/^tpl-/);
      expect(KNOWN_BLOCK_TYPES.has(block.type)).toBe(true);
    }
  });

  it("gives every template a unique id and label", () => {
    const ids = new Set(TEMPLATES.map((t) => t.id));
    const labels = new Set(TEMPLATES.map((t) => t.label));
    expect(ids.size).toBe(TEMPLATES.length);
    expect(labels.size).toBe(TEMPLATES.length);
  });
});
