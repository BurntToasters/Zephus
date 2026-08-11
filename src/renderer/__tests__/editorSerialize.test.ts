import { describe, it, expect } from "vitest";
import {
  assembleManagedPage,
  indentManagedBody,
  splitManagedPageSource,
} from "../editorSerialize";
import { renderBlockNode } from "../../main/services/schema";
import { BUILD_MAX_HEADING_LEVEL } from "../../shared/blockRenderFixtures";
import { renderBlockHtml } from "../../shared/blockRender";

describe("editorSerialize", () => {
  it("splits frontmatter and body regions", () => {
    const raw = `---
title: About
---
<html><body><p>Hi</p></body></html>`;
    const { frame, inner } = splitManagedPageSource(raw);
    expect(frame.frontmatter).toBe(`---
title: About
---
`);
    expect(frame.prefix).toContain("<body");
    expect(frame.suffix).toContain("</body>");
    expect(inner.trim()).toBe("<p>Hi</p>");
  });

  it("round-trips frame + inner through assemble", () => {
    const frame = {
      frontmatter: "",
      prefix: "<div class='wrap'>",
      suffix: "</div>",
    };
    const sections = [
      {
        id: "sec-1",
        type: "section" as const,
        label: "Main",
        props: { wrapper: "none" },
        children: [
          {
            id: "t1",
            type: "text" as const,
            props: { text: "x", cls: "" },
          },
        ],
      },
    ];
    const full = assembleManagedPage(frame, sections, (b) =>
      b.type === "text" ? `<p>${b.props["text"]}</p>` : "",
    );
    const split = splitManagedPageSource(full);
    expect(split.frame.prefix).toBe(frame.prefix);
    expect(split.frame.suffix).toBe(frame.suffix);
    expect(split.inner).toContain("<p>x</p>");
  });

  it("indents non-empty lines only", () => {
    // Default indent MUST match the main-process renderAstroPage (2 spaces);
    // a 4-space default made renderer output never byte-match disk, which
    // silently detached managed pages on the second code-mode save.
    expect(indentManagedBody("a\n\nb")).toBe("  a\n\n  b");
  });

  it("assembles frame + sections like serializeBlocks", () => {
    const frame = {
      frontmatter: "---\ntitle: Hi\n---\n",
      prefix: "<body>",
      suffix: "</body>",
    };
    const sections = [
      {
        id: "sec-1",
        type: "section" as const,
        label: "Main",
        props: { wrapper: "none" },
        children: [
          {
            id: "fix-text",
            type: "text" as const,
            props: { text: "Hello", cls: "" },
          },
        ],
      },
    ];
    const build = assembleManagedPage(frame, sections, renderBlockNode);
    const editor = assembleManagedPage(frame, sections, (block) =>
      renderBlockHtml(block, {
        viewport: "desktop",
        forCanvas: false,
        maxHeadingLevel: BUILD_MAX_HEADING_LEVEL,
      }),
    );
    expect(editor).toBe(build);
    expect(build).toContain("---\ntitle: Hi\n---\n<body>");
    expect(build).toContain("Hello");
    expect(build).toContain("</body>");
  });
});
