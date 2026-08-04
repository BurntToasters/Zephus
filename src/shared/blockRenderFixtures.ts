import { BlockNode, EditorBlockType } from "../main/types";

/** Shared block fixtures for render parity tests (build + editor serialize). */
export function blockRenderFixture(
  type: EditorBlockType,
  props: Record<string, string>,
  extra: Partial<BlockNode> = {},
): BlockNode {
  return { id: `fix-${type}`, type, props, ...extra };
}

export const BLOCK_RENDER_FIXTURES: BlockNode[] = [
  blockRenderFixture("heading", {
    text: "Hello & <world>",
    level: "2",
    cls: "",
  }),
  blockRenderFixture("text", { text: "Line one\nLine two", cls: "lead" }),
  blockRenderFixture("image", {
    src: "/assets/images/x.svg",
    alt: "Alt",
    cls: "",
  }),
  blockRenderFixture("button", { text: "Go", href: "/contact", cls: "" }),
  blockRenderFixture("button", {
    text: "Bad",
    href: "java" + "script:alert(1)",
    cls: "",
  }),
  blockRenderFixture("section", { text: "Body", wrapper: "box", cls: "" }),
  blockRenderFixture("divider", { cls: "" }),
  blockRenderFixture("spacer", { height: "64px", cls: "" }),
  blockRenderFixture(
    "columns",
    { count: "2", col1: "A", col2: "B", cls: "" },
    { style: { columns: "2", gap: "1.5rem", stackOnMobile: true } },
  ),
  blockRenderFixture("card", { title: "Card", text: "Body", cls: "" }),
  blockRenderFixture("gallery", { images: "/a.svg\n/b.svg", cls: "" }),
  blockRenderFixture("quote", { text: "Quoted", cite: "Author", cls: "" }),
  blockRenderFixture("list", { items: "One\nTwo", ordered: "true", cls: "" }),
  blockRenderFixture("embed", {
    src: "https://example.com",
    title: "Map",
    cls: "",
  }),
  blockRenderFixture("video", {
    src: "https://example.com/movie.mp4",
    title: "Showreel",
    cls: "",
  }),
  blockRenderFixture("html", {}, { raw: "<div>raw <b>html</b></div>" }),
  blockRenderFixture("feature", {
    icon: "⚡",
    title: "Fast",
    text: "Body",
    cls: "",
  }),
  blockRenderFixture("testimonial", {
    quote: "Great",
    author: "Sam",
    role: "CEO",
    cls: "",
  }),
  blockRenderFixture("accordion", { items: "Q1 :: A1\nQ2 :: A2", cls: "" }),
  blockRenderFixture("stats", { items: "2k :: Users\n4.9 :: Rating", cls: "" }),
  blockRenderFixture(
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
  blockRenderFixture("cta", {
    heading: "Ready?",
    text: "Go now",
    buttonText: "Start",
    buttonHref: "/start",
    cls: "",
  }),
];

/** Matches Astro/build output; editor serialization must use this, not canvas caps. */
export const BUILD_MAX_HEADING_LEVEL = 6;
