// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createEditorPageParser } from "../editorParse";

interface ParseResultUnit {
  id: string;
  type: string;
  label?: string;
  props: Record<string, string>;
  children?: ParseResultUnit[];
  raw?: string;
  style?: Record<string, string>;
}

const parser = createEditorPageParser({
  uid: () => "uid",
  createFallbackSection: () => ({
    id: "s",
    type: "section",
    label: "Main Content",
    props: { wrapper: "box", cls: "" },
    children: [],
  }),
  knownBlockTypes: new Set(["html", "heading", "text", "button"]),
});

describe("parser legacy branches", () => {
  it("parses legacy anchors as buttons", () => {
    const tree = parser.parseSections('<a href="/x">Go</a>');
    const block = tree[0]?.children?.[0];
    expect(block?.type).toBe("button");
    expect(block?.props?.href).toBe("/x");
    expect(block?.props?.text).toBe("Go");
  });

  it("parses headings with levels", () => {
    const tree = parser.parseSections("<h3>Sub</h3>");
    expect(tree[0]?.children?.[0]?.props?.level).toBe("3");
  });

  it("keeps text nodes and comments as html blocks", () => {
    const tree = parser.parseSections("raw text<!-- note --><p>p</p>");
    const children = tree[0]?.children ?? [];
    expect(
      children.some(
        (b: { raw?: string; type?: string }) => b.raw === "raw text",
      ),
    ).toBe(true);
    expect(
      children.some(
        (b: { raw?: string; type?: string }) => b.raw === "<!-- note -->",
      ),
    ).toBe(true);
  });

  it("falls back to an empty section for empty inner", () => {
    const tree = parser.parseSections("");
    expect(tree[0]).toBeDefined();
  });
});

describe("parser legacy branch coverage", () => {
  it("parses legacy anchors as buttons", () => {
    const tree = parser.parseSections(
      '<a href="/x">Go</a>',
    ) as unknown as ParseResultUnit[];
    const block = tree[0]?.children?.[0];
    expect(block?.type).toBe("button");
    expect(block?.props?.href).toBe("/x");
    expect(block?.props?.text).toBe("Go");
  });

  it("keeps text nodes and comments as html blocks", () => {
    const tree = parser.parseSections(
      "raw text<!-- note --><p>p</p>",
    ) as unknown as ParseResultUnit[];
    const children = (tree[0]?.children ?? []) as unknown as ParseResultUnit[];
    expect(children.some((b) => b.raw === "raw text")).toBe(true);
    expect(children.some((b) => b.raw === "<!-- note -->")).toBe(true);
  });

  it("falls back to an empty section for empty inner", () => {
    const tree = parser.parseSections("");
    expect(tree[0]).toBeDefined();
  });
});

describe("parser list and blockquote branches", () => {
  it("parses ul as a list block", () => {
    const tree = parser.parseSections(
      "<ul><li>One</li><li>Two</li></ul>",
    ) as unknown as ParseResultUnit[];
    const block = tree[0]?.children?.[0];
    expect(block?.type).toBe("list");
    expect(block?.props?.items).toBe("One\nTwo");
    expect(block?.props?.ordered).toBe("false");
  });

  it("parses ol as an ordered list block", () => {
    const tree = parser.parseSections(
      "<ol><li>One</li></ol>",
    ) as unknown as ParseResultUnit[];
    const block = tree[0]?.children?.[0];
    expect(block?.props?.ordered).toBe("true");
  });

  it("parses blockquote with cite", () => {
    const tree = parser.parseSections(
      "<blockquote><p>Quote</p><cite>Author</cite></blockquote>",
    ) as unknown as ParseResultUnit[];
    const block = tree[0]?.children?.[0];
    expect(block?.type).toBe("quote");
    expect(block?.props?.text).toBe("Quote");
  });
});

describe("parser edge branches", () => {
  it("extracts legacy inline styles into the block style", () => {
    const tree = parser.parseSections(
      '<p style="color:red;background:#fff">Styled</p>',
    ) as unknown as ParseResultUnit[];
    const block = tree[0]?.children?.[0];
    expect(block?.style?.color).toBe("red");
    expect(block?.style?.background).toBe("rgb(255, 255, 255)");
  });

  it("keeps comment markers verbatim", () => {
    const tree = parser.parseSections(
      "<!-- note --><p>x</p>",
    ) as unknown as ParseResultUnit[];
    const children = (tree[0]?.children ?? []) as unknown as ParseResultUnit[];
    expect(children.some((b) => b.raw === "<!-- note -->")).toBe(true);
  });

  it("keeps single-line html raw unchanged (no dedent)", () => {
    const tree = parser.parseSections(
      `<section data-zephus-block="section" data-zephus-id="s1" data-zephus-props="%7B%7D"><div data-zephus-block="html" data-zephus-id="h1" data-zephus-props="%7B%7D"><p>x</p></div></section>`,
    ) as unknown as ParseResultUnit[];
    expect(tree[0]?.children?.[0]?.raw).toContain("<p>x</p>");
  });
});

describe("parser button/text legacy details", () => {
  it("parses legacy p with class into a text block", () => {
    const tree = parser.parseSections('<p class="lead">Lead</p>');
    expect(tree[0]?.children?.[0]?.props?.cls).toBe("lead");
  });

  it("preserves stored section props", () => {
    const tree = parser.parseSections(
      '<section data-zephus-block="section" data-zephus-id="s1" data-zephus-props="%7B%22wrapper%22%3A%22box%22%2C%22cls%22%3A%22hero%22%7D"></section>',
    );
    expect(tree[0]?.props?.wrapper).toBe("box");
    expect(tree[0]?.props?.cls).toBe("hero");
  });
});
