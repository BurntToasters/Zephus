import { describe, it, expect } from "vitest";
import {
  addCssValue,
  blockCssValue,
  blockMetadataAttrs,
  classAttr,
  encodeDataPayload,
  escapeAttr,
  escapeHtml,
  plainTextToHtml,
  renderListItems,
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
    expect(safeUrl("javascript:alert(1)")).toBe("");
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
    expect(renderListItems("one\ntwo")).toBe(
      "<li>one</li><li>two</li>",
    );
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
    expect(mobile).toContain("display:none");
  });
});
