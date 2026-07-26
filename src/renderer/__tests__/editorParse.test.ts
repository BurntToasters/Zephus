/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import {
  createEditorPageParser,
  parseZephusJsonAttr,
  sanitizeStringRecord,
} from "../editorParse";

describe("editorParse helpers", () => {
  it("sanitizes string records and drops dangerous keys", () => {
    expect(
      sanitizeStringRecord({
        text: "Hi",
        level: 2,
        __proto__: "bad",
        constructor: "bad",
      }),
    ).toEqual({ text: "Hi", level: "2" });
  });

  it("parses encoded zephus JSON attrs", () => {
    const encoded = encodeURIComponent(
      JSON.stringify({ text: "Title", cls: "" }),
    );
    expect(parseZephusJsonAttr<Record<string, string>>(encoded)).toEqual({
      text: "Title",
      cls: "",
    });
    expect(parseZephusJsonAttr(null)).toBeUndefined();
    expect(parseZephusJsonAttr("not-json")).toBeUndefined();
  });
});

describe("editorParse DOM", () => {
  const parser = createEditorPageParser({
    uid: () => "btestid1",
    createFallbackSection: () => ({
      id: "sec-fallback",
      type: "section",
      label: "Main Content",
      props: { wrapper: "none", cls: "" },
      children: [],
    }),
    knownBlockTypes: new Set(["text", "heading", "html"]),
  });

  it("parses a single fallback section from plain markup", () => {
    const sections = parser.parseSections("<p>Hello</p>");
    expect(sections).toHaveLength(1);
    expect(sections[0]!.children[0]?.type).toBe("text");
    expect(sections[0]!.children[0]?.props.text).toBe("Hello");
  });

  it("reconstructs un-annotated section wrappers", () => {
    const sections = parser.parseSections(
      '<section class="wrap"><p>Inner</p></section>',
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]!.props.wrapper).toBe("box");
    expect(sections[0]!.props.cls).toBe("wrap");
    expect(sections[0]!.children[0]?.type).toBe("text");
  });
});
