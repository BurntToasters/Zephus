// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createEditorPageParser } from "../editorParse";

interface ParseResult {
  id: string;
  type: string;
  label?: string;
  props: Record<string, string>;
  children?: ParseResult[];
  raw?: string;
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
  knownBlockTypes: new Set(["html", "heading", "text"]),
});

function parse(inner: string): ParseResult[] {
  return parser.parseSections(inner) as unknown as ParseResult[];
}

describe("round 13 parse fixes", () => {
  it("trims element text once at the top level only", () => {
    const tree = parse(`<p>before <span> after</span> end</p>`);
    const text = tree[0]?.children?.[0]?.props?.text;
    // nested element's leading space must survive
    expect(text).toBe("before  after end");
  });

  it("trims leading/trailing whitespace like the main parser", () => {
    const tree = parse(`<p>  hi  </p>`);
    expect(tree[0]?.children?.[0]?.props?.text).toBe("hi");
  });

  it("dedents html block raws on parse", () => {
    const tree = parse(
      `<section data-zephus-block="section" data-zephus-id="s1" data-zephus-props="%7B%7D"><div data-zephus-block="html" data-zephus-id="h1" data-zephus-props="%7B%7D"><pre>\n  line1\n  line2\n</pre></div></section>`,
    );
    const raw = tree[0]?.children?.[0]?.raw;
    expect(raw).toBeDefined();
    expect(raw).not.toContain("\n    line");
  });

  it("keeps nested style as an html block", () => {
    const tree = parse(
      `<section data-zephus-block="section" data-zephus-id="s1" data-zephus-props="%7B%22wrapper%22%3A%22none%22%7D"><style>p{color:red}</style><p>x</p></section>`,
    );
    const children = tree[0]?.children ?? [];
    expect(children.some((b) => b.raw?.includes("style"))).toBe(true);
  });

  it("labels trailing loose blocks like the main parser", () => {
    const tree = parse(`<p>loose</p>`);
    expect(tree[0]?.label).toBe("Main Content");
  });
});
