import { it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createSite } from "../wizard";
import {
  ensureVisualSchema,
  createSchemaPage,
  writePageDocument,
  readPageDocument,
  pagePathFromSlug,
} from "../schema";

/**
 * Integration test: every page Zephus generates must be valid Astro source.
 * Runs the REAL Astro compiler (a devDependency) over the generated output of
 * a page containing every block type with hostile prop values, plus the
 * scaffolded layout. A page that fails here would break `astro build` for
 * users at publish time.
 */
// @ts-expect-error ESM import of the wasm-backed compiler
const compiler = await import("@astrojs/compiler");

function allBlocksPage(): Array<Record<string, unknown>> {
  const special =
    "Braces {x} quotes \" ' amp & <tag> émoji 🚀 &copy; newline\nhere";
  return [
    {
      id: "b-heading",
      type: "heading",
      props: { text: `Heading ${special}`, level: "1", cls: "hero" },
    },
    { id: "b-text", type: "text", props: { text: `Body ${special}`, cls: "" } },
    {
      id: "b-button",
      type: "button",
      props: { text: "Go", href: "/about?x=1&y=2", cls: "" },
    },
    {
      id: "b-image",
      type: "image",
      props: { src: "/assets/images/x.svg", alt: "Alt", cls: "" },
    },
    {
      id: "b-video",
      type: "video",
      props: { src: "https://example.com/m.mp4", title: "V", cls: "" },
    },
    {
      id: "b-embed",
      type: "embed",
      props: { src: "https://example.com/embed", title: "E", cls: "" },
    },
    {
      id: "b-columns",
      type: "columns",
      props: { col1: "A", col2: "B", count: "2", cls: "" },
    },
    { id: "b-card", type: "card", props: { title: "T", text: "B", cls: "" } },
    { id: "b-quote", type: "quote", props: { text: "Q", cite: "C", cls: "" } },
    {
      id: "b-list",
      type: "list",
      props: { items: "One\nTwo\nThree", ordered: "false", cls: "" },
    },
    {
      id: "b-feature",
      type: "feature",
      props: { icon: "★", title: "F", text: "B", cls: "" },
    },
    {
      id: "b-testimonial",
      type: "testimonial",
      props: { quote: "Q", author: "A", role: "R", cls: "" },
    },
    {
      id: "b-accordion",
      type: "accordion",
      props: { items: "Q1 :: A1\nQ2 :: A2", cls: "" },
    },
    {
      id: "b-stats",
      type: "stats",
      props: { items: "10k :: users\n99% :: uptime", cls: "" },
    },
    {
      id: "b-pricing",
      type: "pricing",
      props: {
        plan: "Pro",
        price: "$9",
        period: "/mo",
        features: "F1\nF2",
        ctaHref: "/signup",
        ctaText: "Buy",
        cls: "",
      },
    },
    {
      id: "b-cta",
      type: "cta",
      props: {
        heading: "CT",
        text: "B",
        buttonHref: "/x",
        buttonText: "Go",
        cls: "",
      },
    },
    {
      id: "b-gallery",
      type: "gallery",
      props: { images: "/a.png\n/b.png", cls: "" },
    },
    { id: "b-divider", type: "divider", props: { cls: "" } },
    { id: "b-spacer", type: "spacer", props: { height: "64px", cls: "" } },
    {
      id: "b-postlist",
      type: "postlist",
      props: {
        folder: "/posts",
        showDate: "true",
        showAuthor: "true",
        showExcerpt: "true",
        showImage: "true",
        emptyText: "None",
        cls: "",
      },
    },
    {
      id: "b-html",
      type: "html",
      props: {},
      raw: "<div class='custom'>raw &amp; content</div>",
    },
  ];
}

it("compiles every block type with the real Astro compiler", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-astro-"));
  try {
    const project = path.join(tmp, "site");
    fs.mkdirSync(project, { recursive: true });
    const created = createSite(project, "minimal");
    expect(created.ok).toBe(true);
    ensureVisualSchema(project, "src/pages");

    // A page containing every block type, with hostile prop values.
    const createdPage = createSchemaPage(project, "src/pages", "everything");
    expect(createdPage.ok).toBe(true);
    const rel = pagePathFromSlug("src/pages", "everything");
    const current = readPageDocument(project, rel, "src/pages");
    const saved = writePageDocument(project, "src/pages", {
      ...current.pageDocument!,
      sections: [
        {
          id: "sec-main",
          type: "section",
          label: "Main",
          props: { wrapper: "none", cls: "" },
          style: {
            padding: "24px",
            responsive: { mobile: { padding: "8px" } },
            hideOn: [],
          },
          children: allBlocksPage(),
        },
      ],
    });
    expect(saved.ok).toBe(true);

    // Compile EVERY generated page + the layout with the real compiler.
    const pages = fs
      .readdirSync(path.join(project, "src", "pages"))
      .filter((f) => f.endsWith(".astro"));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      const source = fs.readFileSync(
        path.join(project, "src", "pages", page),
        "utf8",
      );
      const result = await compiler.transform(source, { filename: page });
      // The source must not contain raw {expr} outside the encoded payloads,
      // CSS <style> blocks, and the deliberate noindex={true} expression the
      // 404 page always emits (the compiler would otherwise turn text braces
      // into ${...} → runtime ReferenceError; CSS braces are handled by vite).
      const outsidePayloads = source
        .replace(/data-zephus-props="[^"]*"/g, "")
        .replace(/<style>[\s\S]*?<\/style>/g, "")
        .replace(/noindex=\{true\}/g, "");
      expect(outsidePayloads).not.toMatch(/\{[^}]*\}/);
    }
    const layout = fs.readFileSync(
      path.join(project, "src", "layouts", "BaseLayout.astro"),
      "utf8",
    );
    await compiler.transform(layout, { filename: "BaseLayout.astro" });
    console.log("ALL", pages.length, "PAGES COMPILED OK");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
