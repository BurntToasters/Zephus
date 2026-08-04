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

  it("strips dangerous keys from parsed attrs", () => {
    const encoded = encodeURIComponent(
      JSON.stringify({ text: "ok", __proto__: "polluted", constructor: "x" }),
    );
    expect(parseZephusJsonAttr<Record<string, string>>(encoded)).toEqual({
      text: "ok",
    });
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

  it("extracts legacy inline styles into block style", () => {
    const sections = parser.parseSections(
      '<h1 style="color: red; padding: 4px">Big</h1>',
    );
    expect(sections[0]!.children[0]?.style?.color).toBe("red");
    expect(sections[0]!.children[0]?.style?.padding).toBe("4px");
  });

  it("converts <br> into newlines in element text", () => {
    const sections = parser.parseSections("<p>Line 1<br>Line 2</p>");
    expect(sections[0]!.children[0]?.props.text).toBe("Line 1\nLine 2");
  });

  it("keeps comments and loose text as html blocks", () => {
    const sections = parser.parseSections(
      '<section data-zephus-block="section" data-zephus-props="%7B%22wrapper%22%3A%22none%22%2C%22cls%22%3A%22%22%7D">Hello <!-- note --> world</section>',
    );
    const children = sections[0]!.children;
    expect(children.map((c) => c.type)).toEqual(["html", "html", "html"]);
    expect(children[0]!.raw).toBe("Hello ");
    expect(children[1]!.raw).toBe("<!-- note -->");
  });

  it("reads stored props, style, id and lock flag on managed blocks", () => {
    const props = encodeURIComponent(JSON.stringify({ text: "Managed" }));
    const style = encodeURIComponent(
      JSON.stringify({ color: "blue", responsive: {} }),
    );
    const sections = parser.parseSections(
      `<p data-zephus-id="p-7" data-zephus-block="text" data-zephus-props="${props}" data-zephus-style="${style}" data-zephus-locked="true">Managed</p>`,
    );
    const block = sections[0]!.children[0]!;
    expect(block.id).toBe("p-7");
    expect(block.props.text).toBe("Managed");
    expect(block.style?.color).toBe("blue");
    expect(block.locked).toBe(true);
  });

  it("falls back to legacy parsing when stored props are missing", () => {
    // data-zephus-block says text but no props: the tag decides.
    const sections = parser.parseSections(
      '<h1 data-zephus-block="text">Legacy</h1>',
    );
    expect(sections[0]!.children[0]?.type).toBe("heading");
    expect(sections[0]!.children[0]?.props.level).toBe("1");
  });

  it("preserves raw markup for stored html blocks", () => {
    const props = encodeURIComponent(JSON.stringify({}));
    const sections = parser.parseSections(
      `<div data-zephus-block="html" data-zephus-props="${props}"><b>raw</b></div>`,
    );
    expect(sections[0]!.children[0]?.type).toBe("html");
    expect(sections[0]!.children[0]?.raw).toContain("<b>raw</b>");
  });

  it("keeps loose top-level elements as their own fallback section", () => {
    const sections = parser.parseSections(
      '<section data-zephus-block="section" data-zephus-props="%7B%22wrapper%22%3A%22none%22%2C%22cls%22%3A%22%22%7D"><p>A</p></section><div><span>loose</span></div>',
    );
    expect(sections).toHaveLength(2);
    expect(sections[1]!.children[0]?.type).toBe("html");
  });

  it("skips style tags at the top level", () => {
    const sections = parser.parseSections("<style>.x{}</style><p>kept</p>");
    expect(sections[0]!.children).toHaveLength(1);
    expect(sections[0]!.children[0]?.props.text).toBe("kept");
  });
});
