/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { richTextFromElement } from "../inlineRichText";
import { richTextToHtml } from "../../shared/renderHelpers";

const CASES = [
  "plain text with & <literal> characters",
  "line one\nline two",
  "<strong>Bold &amp; clear</strong>",
  "<em>Editorial</em> <u>detail</u> <s>Removed</s> <code>npm run build</code>",
  '<a href="/docs">Read the docs</a> and <a href="https://example.com">the site</a>',
  '<strong>One</strong><br /><em>Two</em><br /><a href="/three">Three</a>',
  "<script>ignored</script><span>literal wrapper</span>",
  "Tom &amp; Jerry",
];

function editableRoot(rendered: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = rendered;
  return root;
}

describe("rich text render/read idempotency", () => {
  it.each(CASES)("keeps the rendered value stable: %s", (value) => {
    const rendered = richTextToHtml(value);
    const stored = richTextFromElement(editableRoot(rendered));

    expect(richTextToHtml(stored)).toBe(rendered);
  });

  it("keeps link policy symmetric for labels inside anchors", () => {
    const value = '<a href="/nested">Do not nest</a>';
    const rendered = richTextToHtml(value, { allowLinks: false });
    const stored = richTextFromElement(editableRoot(rendered), {
      allowLinks: false,
    });

    expect(rendered).toBe("Do not nest");
    expect(richTextToHtml(stored, { allowLinks: false })).toBe(rendered);
  });
});
