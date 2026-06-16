import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createSchemaPage,
  ensureVisualSchema,
  pagePathFromSlug,
  readPageDocument,
  writePageDocument,
} from "../schema";
import type { SectionNode } from "../../types";

let tmpDir: string;
const pagesDir = path.join("src", "pages");

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-roundtrip-"));
  fs.mkdirSync(path.join(tmpDir, "src", "layouts"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "src", "pages"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "public", "styles"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, "package.json"),
    JSON.stringify({
      scripts: { dev: "astro dev", build: "astro build" },
      dependencies: { astro: "^6.0.0" },
    }),
  );
  fs.writeFileSync(path.join(tmpDir, "astro.config.mjs"), "export default {};");
  fs.writeFileSync(
    path.join(tmpDir, "src", "layouts", "BaseLayout.astro"),
    `---
const { title = 'Site' } = Astro.props;
---
<html><body><nav><a href="/">Home</a></nav><main><slot /></main></body></html>`,
  );
  fs.writeFileSync(
    path.join(tmpDir, "public", "styles", "global.css"),
    "body { font-family: system-ui; }",
  );
  fs.writeFileSync(
    path.join(tmpDir, "src", "pages", "index.astro"),
    `---
import BaseLayout from '../layouts/BaseLayout.astro';
title: "Home"
navLabel: "Home"
navVisible: true
---

<BaseLayout title="Home">
  <h1>Welcome</h1>
</BaseLayout>
`,
  );
  fs.mkdirSync(path.join(tmpDir, ".zephus"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, ".zephus", "settings.json"),
    JSON.stringify({ schemaVersion: 1, editorRules: {}, theme: "project" }),
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Builds a diverse section tree with tricky text content. */
function richSections(): SectionNode[] {
  return [
    {
      id: "section-main",
      type: "section",
      label: "Main Content",
      props: { wrapper: "box", cls: "rich" },
      style: {
        background: "#eef2ff",
        padding: "2rem",
        align: "center",
        width: "720px",
        height: "360px",
        responsive: {
          mobile: {
            width: "320px",
            height: "240px",
          },
        },
      },
      children: [
        {
          id: "h",
          type: "heading",
          props: {
            text: 'It\'s a <bold> & "quoted" title — café',
            level: "1",
            cls: "",
          },
          style: { color: "#111827", width: "640px", height: "48px" },
        },
        {
          id: "p",
          type: "text",
          props: {
            text: "Line one's value\nLine two > line one & more",
            cls: "",
          },
        },
        {
          id: "btn",
          type: "button",
          props: {
            text: "Don't click",
            href: "mailto:a'b@example.com",
            cls: "",
          },
        },
        {
          id: "li",
          type: "list",
          props: {
            items: "First's item\nSecond & third\n<fourth>",
            ordered: "true",
            cls: "",
          },
        },
        {
          id: "q",
          type: "quote",
          props: { text: 'She said "it\'s fine"', cite: "O'Brien", cls: "" },
        },
      ],
    },
  ];
}

describe("schema round-trip", () => {
  it("preserves the block tree through write → read (JSON sidecar)", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    createSchemaPage(tmpDir, pagesDir, "story");
    const rel = pagePathFromSlug(pagesDir, "story");

    const current = readPageDocument(tmpDir, rel, pagesDir);
    expect(current.ok).toBe(true);

    const written = writePageDocument(tmpDir, pagesDir, {
      ...current.pageDocument!,
      sections: richSections(),
    });
    expect(written.ok).toBe(true);

    const reread = readPageDocument(tmpDir, rel, pagesDir);
    expect(reread.ok).toBe(true);
    const section = reread.pageDocument!.sections[0]!;
    expect(section.children).toHaveLength(5);

    const heading = section.children[0]!;
    expect(heading.type).toBe("heading");
    expect(heading.props["text"]).toBe(
      'It\'s a <bold> & "quoted" title — café',
    );
    expect(heading.style?.color).toBe("#111827");
    expect(heading.style?.width).toBe("640px");
    expect(heading.style?.height).toBe("48px");
    expect(section.style?.width).toBe("720px");
    expect(section.style?.height).toBe("360px");
    expect(section.style?.responsive?.mobile?.width).toBe("320px");
    expect(section.style?.responsive?.mobile?.height).toBe("240px");

    const button = section.children[2]!;
    expect(button.props["href"]).toBe("mailto:a'b@example.com");

    const quote = section.children[4]!;
    expect(quote.props["cite"]).toBe("O'Brien");
    expect(quote.props["text"]).toBe('She said "it\'s fine"');
  });

  it("escapes special characters in the generated .astro (no broken markup)", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    createSchemaPage(tmpDir, pagesDir, "story");
    const rel = pagePathFromSlug(pagesDir, "story");
    const current = readPageDocument(tmpDir, rel, pagesDir);
    writePageDocument(tmpDir, pagesDir, {
      ...current.pageDocument!,
      sections: richSections(),
    });

    const astro = fs.readFileSync(path.join(tmpDir, rel), "utf8");
    // Raw angle brackets from user text must be entity-escaped in the body.
    expect(astro).toContain("&lt;bold&gt;");
    // The data payload attribute must not contain a literal apostrophe.
    const propMatch = astro.match(/data-zephus-props="([^"]*)"/);
    expect(propMatch).toBeTruthy();
    expect(propMatch![1]).not.toContain("'");
  });

  it("survives reparse from .astro when the JSON sidecar is missing", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    createSchemaPage(tmpDir, pagesDir, "story");
    const rel = pagePathFromSlug(pagesDir, "story");
    const current = readPageDocument(tmpDir, rel, pagesDir);
    writePageDocument(tmpDir, pagesDir, {
      ...current.pageDocument!,
      sections: richSections(),
    });

    // Simulate a fresh clone where .zephus sidecars were not committed.
    fs.rmSync(path.join(tmpDir, ".zephus", "pages"), {
      recursive: true,
      force: true,
    });

    ensureVisualSchema(tmpDir, pagesDir);
    const reparsed = readPageDocument(tmpDir, rel, pagesDir);
    expect(reparsed.ok).toBe(true);

    // Flatten all blocks across sections after reparse.
    const blocks = reparsed.pageDocument!.sections.flatMap((s) => s.children);
    const heading = blocks.find((b) => b.type === "heading");
    expect(heading).toBeDefined();
    expect(heading!.props["text"]).toBe(
      'It\'s a <bold> & "quoted" title — café',
    );
    expect(heading!.style?.width).toBe("640px");
    expect(heading!.style?.height).toBe("48px");

    const button = blocks.find((b) => b.type === "button");
    expect(button?.props["href"]).toBe("mailto:a'b@example.com");

    const quote = blocks.find((b) => b.type === "quote");
    expect(quote?.props["cite"]).toBe("O'Brien");
  });

  it("parses legacy inline width and height styles", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    createSchemaPage(tmpDir, pagesDir, "story");
    const rel = pagePathFromSlug(pagesDir, "story");
    fs.writeFileSync(
      path.join(tmpDir, rel),
      `---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="Story">
  <h1 style="width:640px;height:72px;max-width:900px">Legacy heading</h1>
</BaseLayout>
`,
      "utf8",
    );
    fs.rmSync(path.join(tmpDir, ".zephus", "pages"), {
      recursive: true,
      force: true,
    });

    const reparsed = readPageDocument(tmpDir, rel, pagesDir);
    expect(reparsed.ok).toBe(true);
    const heading = reparsed
      .pageDocument!.sections.flatMap((section) => section.children)
      .find((block) => block.type === "heading");
    expect(heading?.style?.width).toBe("640px");
    expect(heading?.style?.height).toBe("72px");
    expect(heading?.style?.maxWidth).toBe("900px");
  });
});
