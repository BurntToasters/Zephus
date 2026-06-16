import { describe, it, expect } from "vitest";
import { renderBlockNode } from "../schema";
import { BlockNode, EditorBlockType } from "../../types";

/**
 * Golden snapshot of the build-side block renderer (schema.ts renderBlockNode).
 * This is the canonical markup the editor's blockToHtml MUST emit byte-for-byte
 * (the documented render-parity invariant). If a block's output changes here,
 * the matching change must be mirrored in zephusEngine.ts blockToHtml.
 *
 * Block ids are fixed so the snapshots are deterministic.
 */
function fixture(
  type: EditorBlockType,
  props: Record<string, string>,
  extra: Partial<BlockNode> = {},
): BlockNode {
  return { id: `fix-${type}`, type, props, ...extra };
}

const FIXTURES: BlockNode[] = [
  fixture("heading", { text: "Hello & <world>", level: "2", cls: "" }),
  fixture("text", { text: "Line one\nLine two", cls: "lead" }),
  fixture("image", { src: "/assets/images/x.svg", alt: "Alt", cls: "" }),
  fixture("button", { text: "Go", href: "/contact", cls: "" }),
  fixture("button", { text: "Bad", href: "java" + "script:alert(1)", cls: "" }),
  fixture("section", { text: "Body", wrapper: "box", cls: "" }),
  fixture("divider", { cls: "" }),
  fixture("spacer", { height: "64px", cls: "" }),
  fixture(
    "columns",
    { count: "2", col1: "A", col2: "B", cls: "" },
    { style: { columns: "2", gap: "1.5rem", stackOnMobile: true } },
  ),
  fixture("card", { title: "Card", text: "Body", cls: "" }),
  fixture("gallery", { images: "/a.svg\n/b.svg", cls: "" }),
  fixture("quote", { text: "Quoted", cite: "Author", cls: "" }),
  fixture("list", { items: "One\nTwo", ordered: "true", cls: "" }),
  fixture("embed", { src: "https://example.com", title: "Map", cls: "" }),
  fixture("html", {}, { raw: "<div>raw <b>html</b></div>" }),
  fixture("feature", { icon: "⚡", title: "Fast", text: "Body", cls: "" }),
  fixture("testimonial", {
    quote: "Great",
    author: "Sam",
    role: "CEO",
    cls: "",
  }),
  fixture("accordion", { items: "Q1 :: A1\nQ2 :: A2", cls: "" }),
  fixture("stats", { items: "2k :: Users\n4.9 :: Rating", cls: "" }),
  fixture(
    "pricing",
    {
      plan: "Pro",
      price: "$12",
      period: "/mo",
      features: "A\nB",
      ctaText: "Buy",
      ctaHref: "/pricing",
      cls: "",
    },
    { style: { shadow: "md" } },
  ),
  fixture("cta", {
    heading: "Ready?",
    text: "Go now",
    buttonText: "Start",
    buttonHref: "/start",
    cls: "",
  }),
];

describe("build render parity (renderBlockNode goldens)", () => {
  it("covers every block fixture without throwing", () => {
    for (const block of FIXTURES) {
      expect(typeof renderBlockNode(block)).toBe("string");
    }
  });

  it.each(FIXTURES.map((b, i) => [`${b.type}-${i}`, b] as const))(
    "renders %s to stable markup",
    (_label, block) => {
      expect(renderBlockNode(block)).toMatchSnapshot();
    },
  );

  it("never emits a javascript: URL", () => {
    const danger = "java" + "script:alert(1)";
    const out = renderBlockNode(
      fixture("button", { text: "x", href: danger, cls: "" }),
    );
    expect(out).not.toMatch(/javascript:/i);
  });
});
