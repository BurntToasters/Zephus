// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { richTextFromElement } from "../inlineRichText";

function element(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.firstElementChild as HTMLElement;
}

describe("richTextFromElement", () => {
  it("returns plain text when no formatting was used", () => {
    const el = element("<p>Hello world</p>");
    expect(richTextFromElement(el)).toBe("Hello world");
  });

  it("converts <br> to line breaks when allowed", () => {
    const el = element("<p>one<br>two<br />three</p>");
    expect(richTextFromElement(el)).toBe("one<br />two<br />three");
  });

  it("keeps line breaks out of line-encoded props", () => {
    const el = element("<p>one<br>two</p>");
    expect(richTextFromElement(el, { allowLineBreaks: false })).toBe("one two");
  });
  it("normalizes formatting tags to the canonical set", () => {
    const el = element(
      "<p><b>bold</b> <i>italic</i> <u>under</u> <s>strike</s> <code>code</code></p>",
    );
    expect(richTextFromElement(el)).toBe(
      "<strong>bold</strong> <em>italic</em> <u>under</u> <s>strike</s> <code>code</code>",
    );
  });

  it("keeps safe links and drops unsafe ones", () => {
    const safe = element('<p><a href="/about">About</a></p>');
    expect(richTextFromElement(safe)).toBe('<a href="/about">About</a>');

    const unsafe = element(
      '<p><a href="' + "java" + 'script:alert(1)">Bad</a></p>',
    );
    expect(richTextFromElement(unsafe)).toBe("Bad");
  });

  it("drops links entirely when allowLinks is false", () => {
    const el = element('<p><a href="/x">Label</a></p>');
    expect(richTextFromElement(el, { allowLinks: false })).toBe("Label");
  });

  it("drops scripts and styles but keeps their text", () => {
    const el = element("<p>a<script>evil()</script>b</p>");
    expect(richTextFromElement(el)).toBe("ab");
  });

  it("strips disallowed tags but keeps text", () => {
    const el = element('<p><span style="color:red">t</span>ext</p>');
    expect(richTextFromElement(el)).toBe("text");
  });

  it("stores decoded text raw (escaping happens at render)", () => {
    const el = element("<p>a &lt; b &amp; c</p>");
    expect(richTextFromElement(el)).toBe("a < b & c");
  });

  it("decodes text wrapped in browser-only elements", () => {
    // Regression: browsers wrap edited text in spans/divs (spellcheck,
    // execCommand). Storing the escaped walk output ("A &amp; B") with no
    // markup tags made plainTextToHtml escape it again — the literal text
    // "&amp;" appeared on screen and in the file.
    const span = element("<p><span>A &amp; B</span></p>");
    expect(richTextFromElement(span)).toBe("A & B");

    const div = element("<div>A &amp; B</div>");
    expect(richTextFromElement(div)).toBe("A & B");

    // Literal entity-looking text typed by the user must not be decoded away.
    const literal = element("<div>Tom &amp;amp; Jerry</div>");
    expect(richTextFromElement(literal)).toBe("Tom &amp; Jerry");
  });

  it("still drops script content when only wrappers are present", () => {
    const el = element("<div>safe<script>alert(1)</script></div>");
    expect(richTextFromElement(el)).toBe("safe");
  });

  it("collapses newline text nodes when line breaks are disallowed", () => {
    // Regression: a literal "\n" text node (browser paste/insertText) used to
    // land inside line-encoded props (list items, accordion, stats), shifting
    // every following "left :: right" pair.
    const el = element("<p>10k+\nMore</p>");
    expect(richTextFromElement(el, { allowLineBreaks: false })).toBe(
      "10k+ More",
    );
    const rich = element("<p><strong>A</strong>\nB</p>");
    expect(richTextFromElement(rich, { allowLineBreaks: false })).toBe(
      "<strong>A</strong> B",
    );
  });

  it("collapses block wrappers into line breaks", () => {
    const el = element("<div><p>one</p><p>two</p></div>");
    expect(richTextFromElement(el)).toBe("one<br />two");
  });
});
