// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sanitizeHtmlForCanvas } from "../editorBlockRender";

describe("sanitizeHtmlForCanvas", () => {
  it("removes script, object, embed, and iframe elements", () => {
    const out = sanitizeHtmlForCanvas(
      '<div>ok<script>alert(1)</script><object>o</object><embed src="x"><iframe src="y"></iframe></div>',
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<object");
    expect(out).not.toContain("<embed");
    expect(out).not.toContain("<iframe");
    expect(out).toContain("ok");
  });

  it("strips event handler attributes", () => {
    const out = sanitizeHtmlForCanvas(
      '<img src="/a.png" onerror="alert(1)" onclick="x()" alt="a">',
    );
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("onclick");
    expect(out).toContain('src="/a.png"');
  });

  it("strips srcdoc and formaction", () => {
    const out = sanitizeHtmlForCanvas(
      '<iframe srcdoc="<script>x</script>"></iframe><form><button formaction="' +
        "java" +
        'script:x">Go</button></form>',
    );
    expect(out).not.toContain("srcdoc");
    expect(out).not.toContain("formaction");
  });

  it("blocks javascript: and data: URLs in href/src", () => {
    const out = sanitizeHtmlForCanvas(
      '<a href="' +
        "java" +
        'script:alert(1)">x</a><img src="data:text/html,evil">',
    );
    expect(out).not.toContain("java" + "script:");
    expect(out).not.toContain("data:text/html");
  });

  it("keeps safe content intact", () => {
    const out = sanitizeHtmlForCanvas(
      '<a href="/about">About</a><img src="/assets/x.png" alt="X"><strong>bold</strong>',
    );
    expect(out).toContain('<a href="/about">About</a>');
    expect(out).toContain('src="/assets/x.png"');
    expect(out).toContain("<strong>bold</strong>");
  });
});
