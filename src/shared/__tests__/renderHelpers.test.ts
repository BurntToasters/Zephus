import { describe, it, expect } from "vitest";
import {
  addCssValue,
  blockCssValue,
  blockMetadataAttrs,
  classAttr,
  encodeDataPayload,
  escapeAttr,
  escapeHtml,
  hasRichTextMarkup,
  plainTextToHtml,
  renderListItems,
  richTextToHtml,
  safeUrl,
  splitLines,
  splitPair,
  styleAttr,
} from "../renderHelpers";

describe("renderHelpers", () => {
  it("escapes HTML and attributes", () => {
    expect(escapeHtml(`a & b < c > d`)).toBe("a &amp; b &lt; c &gt; d");
    expect(escapeAttr(`say "hi"`)).toBe("say &quot;hi&quot;");
  });

  it("blocks dangerous URLs", () => {
    expect(safeUrl("java" + "script:alert(1)")).toBe("");
    expect(safeUrl("/about")).toBe("/about");
  });

  it("encodes data payloads without raw apostrophes", () => {
    const encoded = encodeDataPayload({ text: "it's fine" });
    expect(encoded.includes("'")).toBe(false);
    expect(decodeURIComponent(encoded)).toBe(`{"text":"it's fine"}`);
  });

  it("sanitizes CSS values", () => {
    expect(blockCssValue(" 12px ")).toBe("12px");
    expect(blockCssValue("bad;inject")).toBeNull();
    const css: string[] = [];
    addCssValue(css, "width", "100px");
    addCssValue(css, "height", "bad\nvalue");
    expect(css).toEqual(["width:100px"]);
  });

  it("formats plain text and lists", () => {
    expect(plainTextToHtml("line1\nline2")).toBe("line1<br />line2");
    expect(renderListItems("one\ntwo")).toBe("<li>one</li><li>two</li>");
  });

  it("splits lines and pairs", () => {
    expect(splitLines(" a \n\n b ")).toEqual(["a", "b"]);
    expect(splitPair("left :: right")).toEqual(["left", "right"]);
    expect(splitPair("solo")).toEqual(["solo", ""]);
  });

  it("builds block metadata attributes", () => {
    const attrs = blockMetadataAttrs({
      id: "b1",
      type: "heading",
      props: { text: "Hi" },
      locked: true,
    });
    expect(attrs.startsWith(" ")).toBe(true);
    expect(attrs).toContain('data-zephus-id="b1"');
    expect(attrs).toContain('data-zephus-block="heading"');
    expect(attrs).toContain('data-zephus-locked="true"');
    expect(attrs).toContain("data-zephus-props=");
  });

  it("builds style and class attributes", () => {
    expect(classAttr({ props: { cls: "hero" } })).toBe(' class="hero"');
    expect(classAttr({ props: {} })).toBe("");

    const desktop = styleAttr({
      type: "columns",
      props: {},
      style: {
        width: "100%",
        columns: "2",
        stackOnMobile: true,
        responsive: { mobile: { width: "50%" } },
      },
    });
    expect(desktop).toContain("width:100%");
    expect(desktop).toContain("grid-template-columns:repeat(2");
    expect(desktop).not.toContain("grid-template-columns:1fr");

    const mobile = styleAttr(
      {
        type: "columns",
        props: {},
        style: {
          width: "100%",
          columns: "2",
          stackOnMobile: true,
          hideOn: ["mobile"],
          responsive: { mobile: { width: "50%" } },
        },
      },
      { viewport: "mobile", forCanvas: true },
    );
    expect(mobile).toContain("width:50%");
    expect(mobile).toContain("grid-template-columns:1fr");
    // The canvas keeps hidden elements visible (marked with a dashed outline
    // by canvas CSS) so they stay selectable — no inline display:none here.
    expect(mobile).not.toContain("display:none");

    // The build hides at the marked viewport via the responsive <style> block
    // (collectResponsiveCss), and inline for the desktop viewport.
    const buildDesktop = styleAttr({
      type: "columns",
      props: {},
      style: { hideOn: ["desktop"] },
    });
    expect(buildDesktop).toContain("display:none");
  });
});

describe("richTextToHtml", () => {
  it("falls back to plain text without markup (byte-identical)", () => {
    expect(richTextToHtml("plain & <literal>")).toBe(
      "plain &amp; &lt;literal&gt;",
    );
    expect(hasRichTextMarkup("plain text")).toBe(false);
    expect(hasRichTextMarkup("<strong>bold</strong>")).toBe(true);
  });

  it("renders the allowed inline subset", () => {
    expect(
      richTextToHtml("<b>bold</b> <i>it</i> <u>u</u> <s>s</s> <code>c</code>"),
    ).toBe(
      "<strong>bold</strong> <em>it</em> <u>u</u> <s>s</s> <code>c</code>",
    );
    expect(richTextToHtml("a<br>b")).toBe("a<br />b");
  });

  it("sanitizes links: only href, safeUrl-checked", () => {
    expect(
      richTextToHtml('<a href="https://ok.example" onclick="x()">link</a>'),
    ).toBe('<a href="https://ok.example">link</a>');
    expect(richTextToHtml('<a href="javascript:alert(1)">bad</a>')).toBe(
      '<a href="#">bad</a>',
    );
    expect(richTextToHtml('<a title="t" href="/about">x</a>')).toBe(
      '<a href="/about">x</a>',
    );
  });

  it("drops links entirely when allowLinks is false", () => {
    expect(
      richTextToHtml('<a href="/x">label</a>', { allowLinks: false }),
    ).toBe("label");
  });

  it("handles nested and unclosed anchors safely", () => {
    expect(
      richTextToHtml('<a href="/a">outer <a href="/b">inner</a></a>'),
    ).toBe('<a href="/a">outer inner</a>');
    expect(richTextToHtml('<a href="/a">unclosed')).toBe(
      '<a href="/a">unclosed</a>',
    );
  });

  it("escapes unknown tags and attributes as text", () => {
    expect(richTextToHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    // Quotes are safe in text content; the angle brackets are what would
    // otherwise form a tag.
    expect(richTextToHtml('<span style="x">t</span>')).toBe(
      '&lt;span style="x"&gt;t&lt;/span&gt;',
    );
    expect(richTextToHtml("</div>")).toBe("&lt;/div&gt;");
  });

  it("preserves editor-written entities without double-escaping", () => {
    expect(richTextToHtml("<strong>&lt;tag&gt; &amp; more</strong>")).toBe(
      "<strong>&lt;tag&gt; &amp; more</strong>",
    );
    // Without markup the plain-text fallback escapes literally — that is the
    // documented byte-identical round-trip for legacy values.
    expect(richTextToHtml("100% &amp; sure")).toBe("100% &amp;amp; sure");
  });

  it("normalizes stray angle brackets as literal text", () => {
    expect(richTextToHtml("2 < 3 and 5 > 4")).toBe("2 &lt; 3 and 5 &gt; 4");
    expect(richTextToHtml("a < b")).toBe("a &lt; b");
  });
});
