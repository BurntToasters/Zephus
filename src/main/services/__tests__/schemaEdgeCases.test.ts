import { describe, it, expect } from "vitest";
import {
  escapeAstroAttr,
  extractManagedInner,
  isNotFoundSlug,
  isValidPublishDate,
  mergePageNavItems,
  parseSectionsFromSource,
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

  it("never adopts a custom item that shares a page's href", () => {
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
    // A custom item duplicating a page route is dropped as redundant; the
    // page item carries the page's own visibility.
    expect(merged.filter((item) => item.id === "custom")).toHaveLength(0);
    const pageItem = merged.find((item) => item.page);
    expect(pageItem?.visible).toBe(false);
  });

  it("drops duplicate custom items whose href matches a page", () => {
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
    expect(merged.some((item) => item.id === "custom-dup")).toBe(false);
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
});
