// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sanitizeHtmlForCanvas } from "../editorBlockRender";

describe("sanitizeHtmlForCanvas", () => {
  it("removes script, object, embed, iframe, and form elements", () => {
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
    expect(out).not.toContain("<form");
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

  it("blocks URL schemes with tabs/newlines inside the scheme", () => {
    const out = sanitizeHtmlForCanvas(
      '<a href="java\tscript:alert(1)">x</a><a href="java\nscript:alert(1)">y</a><img src="data:text/html,e">',
    );
    expect(out).not.toContain("script:alert");
    expect(out).not.toContain("data:text/html");
  });

  it("removes base elements and dangerous poster/srcset URLs", () => {
    const out = sanitizeHtmlForCanvas(
      '<base href="https://evil.example/"><img src="/ok.png" poster="java' +
        "script:alert(1)" +
        '"><img srcset="/a.png 1x, java' +
        "script:x" +
        ' 2x"><img srcset="java' +
        "script:x" +
        ' 1x">',
    );
    expect(out).not.toContain("<base");
    expect(out).not.toContain("poster");
    // The mixed srcset keeps its safe entry; the all-dangerous one is dropped.
    expect(out).toContain('srcset="/a.png 1x"');
    expect(out).not.toContain("script:x");
  });

  it("keeps safe srcset intact", () => {
    const out = sanitizeHtmlForCanvas(
      '<img srcset="/a.png 1x, /b.png 2x" src="/a.png">',
    );
    expect(out).toContain('srcset="/a.png 1x, /b.png 2x"');
  });

  it("blocks javascript: when a C0 control leads the scheme", () => {
    const out = sanitizeHtmlForCanvas(
      '<a href="\u0001' + "java" + 'script:alert(1)">x</a>',
    );
    expect(out).not.toContain("href");
    expect(out).toContain(">x</a>");
  });

  it("keeps benign URLs after stripping stray C0 controls", () => {
    const out = sanitizeHtmlForCanvas(
      '<a href="/ab\u0001out">About</a><img src="/assets/\u0002x.png">',
    );
    expect(out).toContain('href="/about"');
    expect(out).toContain('src="/assets/x.png"');
  });

  it("sanitizes nested template contents", () => {
    const out = sanitizeHtmlForCanvas(
      '<template><iframe src="x"></iframe><img onerror="alert(1)" src="/a.png"><style>.x{}</style></template>',
    );
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("<style");
    expect(out).toContain('src="/a.png"');
  });

  it("sanitizes templates nested inside templates", () => {
    const out = sanitizeHtmlForCanvas(
      "<template><template><iframe></iframe></template></template>",
    );
    expect(out).not.toContain("<iframe");
  });

  it("sanitizes background URLs like href and src", () => {
    const out = sanitizeHtmlForCanvas(
      '<table background="/ok.png"><table background="' +
        "java" +
        'script:alert(1)">',
    );
    expect(out).toContain('background="/ok.png"');
    expect(out).not.toContain("java" + "script:");
    expect(out.match(/background=/g)?.length).toBe(1);
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
