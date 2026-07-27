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

  it("parses managed section metadata (data-zephus-block=section)", () => {
    const props = encodeURIComponent(
      JSON.stringify({ wrapper: "none", cls: "hero", label: "Hero" }),
    );
    const sections = parser.parseSections(
      `<section data-zephus-id="sec-1" data-zephus-block="section" data-zephus-props="${props}"><h1>Title</h1></section><section data-zephus-id="sec-2" data-zephus-block="section" data-zephus-props="${encodeURIComponent(JSON.stringify({ wrapper: "box", cls: "" }))}"><p>More</p></section>`,
    );
    expect(sections).toHaveLength(2);
    expect(sections[0]!.id).toBe("sec-1");
    expect(sections[0]!.label).toBe("Hero");
    expect(sections[0]!.props.wrapper).toBe("none");
    expect(sections[0]!.props.cls).toBe("hero");
    expect(sections[0]!.children[0]?.type).toBe("heading");
    expect(sections[1]!.props.wrapper).toBe("box");
  });
});
