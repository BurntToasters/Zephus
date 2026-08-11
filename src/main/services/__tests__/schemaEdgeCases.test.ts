import { describe, it, expect } from "vitest";
import {
  escapeAstroAttr,
  extractManagedInner,
  isNotFoundSlug,
  isValidPublishDate,
  mergePageNavItems,
  parseSectionsFromSource,
  renderBlockNode,
} from "../schema";
import type { NavItem, PageDocument } from "../../types";

describe("escapeAstroAttr", () => {
  it("escapes HTML and braces for quoted Astro attributes", () => {
    expect(escapeAstroAttr(`A & B "quoted"`)).toBe(
      "A &amp; B &quot;quoted&quot;",
    );
    expect(escapeAstroAttr("{user}'s Portfolio")).toBe(
      "&#123;user&#125;'s Portfolio",
    );
  });
});

describe("isValidPublishDate", () => {
  it("accepts real calendar dates", () => {
    expect(isValidPublishDate("2026-02-03")).toBe(true);
    expect(isValidPublishDate("2026-02-03  ")).toBe(true);
  });

  it("rejects malformed and impossible dates", () => {
    expect(isValidPublishDate("")).toBe(false);
    expect(isValidPublishDate("2026/02/03")).toBe(false);
    expect(isValidPublishDate("2026-13-01")).toBe(false);
    expect(isValidPublishDate("2026-02-30")).toBe(false);
    expect(isValidPublishDate("not-a-date")).toBe(false);
  });
});

describe("isNotFoundSlug", () => {
  it("treats nested 404 routes as reserved", () => {
    expect(isNotFoundSlug("404")).toBe(true);
    expect(isNotFoundSlug("404/index")).toBe(true);
    expect(isNotFoundSlug("404/fallback")).toBe(true);
    expect(isNotFoundSlug("about")).toBe(false);
    expect(isNotFoundSlug("4040")).toBe(false);
  });
});

describe("mergePageNavItems", () => {
  const doc = (
    page: string,
    route: string,
    navVisible: boolean,
  ): PageDocument =>
    ({
      page,
      route,
      slug: route === "/" ? "index" : route.slice(1),
      navLabel: "Home",
      navVisible,
      sections: [],
    }) as PageDocument;

  it("page docs stay authoritative for page-bound items", () => {
    const nav: NavItem[] = [
      {
        id: "nav-1",
        label: "My Home",
        href: "/",
        page: "src/pages/index.astro",
        visible: true,
        children: [],
      },
    ];
    const merged = mergePageNavItems(nav, [
      doc("src/pages/index.astro", "/", true),
    ]);
    expect(merged).toHaveLength(1);
    // The page document's label/visibility win; the existing item only
    // contributes its id (and children) for continuity.
    expect(merged[0]!.label).toBe("Home");
    expect(merged[0]!.id).toBe("nav-1");
  });

  it("a custom item targeting a page route overrides the page item", () => {
    const nav: NavItem[] = [
      {
        id: "custom",
        label: "Custom Link",
        href: "/",
        visible: true,
        children: [],
      },
    ];
    const merged = mergePageNavItems(nav, [
      doc("src/pages/index.astro", "/", false),
    ]);
    // The deliberate custom link wins: it keeps its own label/visibility and
    // becomes page-bound, rather than being silently deleted on site write.
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe("custom");
    expect(merged[0]!.label).toBe("Custom Link");
    expect(merged[0]!.visible).toBe(true);
    expect(merged[0]!.page).toBe("src/pages/index.astro");
  });

  it("custom item overrides only the matching page, others stay", () => {
    const nav: NavItem[] = [
      {
        id: "custom-dup",
        label: "Dup",
        href: "/about",
        visible: true,
        children: [],
      },
    ];
    const merged = mergePageNavItems(nav, [
      doc("src/pages/index.astro", "/", true),
      doc("src/pages/about.astro", "/about", true),
    ]);
    expect(merged).toHaveLength(2);
    const home = merged.find((item) => item.href === "/");
    expect(home?.page).toBe("src/pages/index.astro");
    const about = merged.find((item) => item.href === "/about");
    expect(about?.id).toBe("custom-dup");
    expect(about?.label).toBe("Dup");
    expect(about?.page).toBe("src/pages/about.astro");
  });
});

describe("extractManagedInner", () => {
  it("extracts between the first open and LAST close of BaseLayout", () => {
    const raw = `---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="Home">
<p>One</p>
<!-- </BaseLayout> inside content -->
<p>Two</p>
</BaseLayout>
`;
    expect(extractManagedInner(raw)).toBe(
      `<p>One</p>\n<!-- </BaseLayout> inside content -->\n<p>Two</p>`,
    );
  });

  it("falls back to the body when no BaseLayout exists", () => {
    const raw = `<html><body><main>Hi</main></body></html>`;
    expect(extractManagedInner(raw)).toBe(`<main>Hi</main>`);
  });
});

describe("parseSectionsFromSource entity handling", () => {
  it("decodes entities in text and attributes", () => {
    const sections = parseSectionsFromSource(`---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="Home">
<p>&copy; 2024 &mdash; Café &#169;</p>
<img src="/assets/a&amp;b.png" alt="A &amp; B" />
</BaseLayout>
`);
    const children = sections.flatMap((s) => s.children);
    const text = children.find((b) => b.type === "text");
    expect(text?.props["text"]).toBe("© 2024 — Café ©");
    const img = children.find((b) => b.type === "image");
    expect(img?.props["src"]).toBe("/assets/a&b.png");
    expect(img?.props["alt"]).toBe("A & B");
  });

  it("parses legacy element types with the regex parser", () => {
    const sections = parseSectionsFromSource(
      `<a href="/about">About</a>
<img src="/i.png" alt="I" />
<hr />
<blockquote><p>First para</p><p>Second para</p><cite>Author</cite></blockquote>
<ol><li>One</li><li>Two</li></ol>
<iframe src="https://embed.example" title="E"></iframe>`,
    );
    const types = sections.flatMap((s) => s.children).map((b) => b.type);
    expect(types).toEqual([
      "button",
      "image",
      "divider",
      "quote",
      "list",
      "embed",
    ]);
    const quote = sections
      .flatMap((s) => s.children)
      .find((b) => b.type === "quote");
    expect(quote?.props["text"]).toBe("First para\nSecond para");
    expect(quote?.props["cite"]).toBe("Author");
    const list = sections
      .flatMap((s) => s.children)
      .find((b) => b.type === "list");
    expect(list?.props["ordered"]).toBe("true");
    expect(list?.props["items"]).toBe("One\nTwo");
  });

  it("extracts legacy inline styles into block style", () => {
    const sections = parseSectionsFromSource(
      '<h1 style="color: red; padding: 4px">Big</h1>',
    );
    const heading = sections.flatMap((s) => s.children)[0]!;
    expect(heading.type).toBe("heading");
    expect(heading.style?.color).toBe("red");
    expect(heading.style?.padding).toBe("4px");
  });

  it("parses an anchor without an href into a button", () => {
    const sections = parseSectionsFromSource("<a>No href</a>");
    const button = sections.flatMap((s) => s.children)[0]!;
    expect(button.type).toBe("button");
    expect(button.props["href"]).toBe("#");
  });

  it("preserves bare text as an html block", () => {
    const sections = parseSectionsFromSource("just some text");
    const blocks = sections.flatMap((s) => s.children);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("html");
    expect(blocks[0]!.raw).toBe("just some text");
  });

  it("keeps a literal < that is not a tag start", () => {
    const sections = parseSectionsFromSource("<p>2 < 3 and 5 > 4</p>");
    const text = sections
      .flatMap((s) => s.children)
      .find((b) => b.type === "text");
    expect(text?.props["text"]).toBe("2 < 3 and 5 > 4");
  });

  it("recurses into wrapper sections containing stored blocks", () => {
    const sections = parseSectionsFromSource(
      '<section class="wrap"><p data-zephus-block="text" data-zephus-props="%7B%22text%22%3A%22Inner%22%2C%22cls%22%3A%22%22%7D">Inner</p></section>',
    );
    const blocks = sections.flatMap((s) => s.children);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("text");
    expect(blocks[0]!.props["text"]).toBe("Inner");
  });

  it("preserves unknown block types through the build renderer", () => {
    const html = renderBlockNode({
      id: "u1",
      type: "mystery" as never,
      props: { a: "b" },
    });
    expect(html).toContain("Unknown block type");
    expect(html).toContain("mystery");
  });

  it("parses the full inline style vocabulary", () => {
    const sections = parseSectionsFromSource(
      '<p style="text-align: center; width: 100px; height: 50px; max-width: 200px; background: #fff; color: red; padding: 4px; margin: 2px; border-radius: 8px; gap: 12px; url(http://x)">styled</p>',
    );
    const block = sections.flatMap((s) => s.children)[0]!;
    expect(block.style).toEqual({
      align: "center",
      width: "100px",
      height: "50px",
      maxWidth: "200px",
      background: "#fff",
      color: "red",
      padding: "4px",
      margin: "2px",
      radius: "8px",
      gap: "12px",
    });
  });

  it("ignores style fragments without a separator or value", () => {
    const sections = parseSectionsFromSource(
      '<p style="color:red; naked; : ; padding: ">x</p>',
    );
    const block = sections.flatMap((s) => s.children)[0]!;
    expect(block.style?.color).toBe("red");
  });
});
