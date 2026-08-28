// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createEditorPageParser } from "../editorParse";
import { renderBlockHtml as renderBlockHtmlFn } from "../../shared/blockRender";
import { assembleManagedPage } from "../editorSerialize";

const parser = createEditorPageParser({
  uid: () => "uid",
  createFallbackSection: () => ({
    id: "s",
    type: "section",
    label: "Main Content",
    props: { wrapper: "box", cls: "" },
    children: [],
  }),
  knownBlockTypes: new Set(["html", "heading", "text", "columns"]),
});

describe("round 13 extra units", () => {
  it("drops a top-level style in the fallback path", () => {
    const tree = parser.parseSections("<style>.x{}</style>\n<p>hi</p>");
    const children = tree[0]?.children ?? [];
    expect(
      children.some((b: { raw?: string; type?: string }) =>
        b.raw?.includes("style"),
      ),
    ).toBe(false);
  });

  it("keeps a nested style inside a stored section", () => {
    const tree = parser.parseSections(
      `<section data-zephus-block="section" data-zephus-id="s1" data-zephus-props="%7B%22wrapper%22%3A%22none%22%7D"><style>p{color:red}</style><p>x</p></section>`,
    );
    const children = tree[0]?.children ?? [];
    expect(
      children.some((b: { raw?: string; type?: string }) =>
        b.raw?.includes("style"),
      ),
    ).toBe(true);
  });

  it("html raw interior lines are never re-indented by the serializer", () => {
    // Round trip: parse a multi-line html raw, serialize with the build
    // renderer, and the interior lines must be byte-identical (the old
    // behavior added 2 spaces per save cycle forever).
    const tree = parser.parseSections(
      `<section data-zephus-block="section" data-zephus-id="s1" data-zephus-props="%7B%7D"><div data-zephus-block="html" data-zephus-id="h1" data-zephus-props="%7B%7D"><pre>\n  one\n  two\n</pre></div></section>`,
    );
    const raw = tree[0]?.children?.[0]?.raw as string;
    // The raw's interior newlines are shielded from the indent as sentinels.
    const serialized = renderBlockHtmlFn(
      tree[0]!.children[0] as unknown as {
        id: string;
        type: string;
        props: Record<string, string>;
        raw?: string;
      },
      {},
    );
    expect(serialized).toContain("\uE000");
    // After the indent step they return as real newlines with the ORIGINAL
    // interior indentation — the +2-per-save growth is gone.
    const page = assembleManagedPage(
      { frontmatter: "", prefix: "", suffix: "" },
      tree,
      (block) =>
        renderBlockHtmlFn(
          block as unknown as Parameters<typeof renderBlockHtmlFn>[0],
          {},
        ),
    );
    // (The HTML parser drops the newline immediately after <pre>.)
    expect(page).toContain("<pre>  one\n  two\n</pre>");
    expect(raw).toContain("<pre>  one\n  two\n</pre>");
    // Serialize twice: interior indentation must NOT grow.
    const page2 = assembleManagedPage(
      { frontmatter: "", prefix: "", suffix: "" },
      tree,
      (block) =>
        renderBlockHtmlFn(
          block as unknown as Parameters<typeof renderBlockHtmlFn>[0],
          {},
        ),
    );
    expect(page2).toBe(page);
  });

  it("columns blocks render grid styles", () => {
    const html = renderBlockHtmlFn(
      {
        id: "c1",
        type: "columns",
        props: { count: "3", col1: "A", col2: "B", col3: "C", cls: "" },
        style: { columns: "3", gap: "16px" },
      },
      { forCanvas: true },
    );
    expect(html).toContain("grid-template-columns");
  });
});
