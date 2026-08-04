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

  it("collapses block wrappers into line breaks", () => {
    const el = element("<div><p>one</p><p>two</p></div>");
    expect(richTextFromElement(el)).toBe("one<br />two");
  });
});
