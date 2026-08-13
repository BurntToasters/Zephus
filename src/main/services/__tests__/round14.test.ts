import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createSite } from "../wizard";
import { mergePageNavItems } from "../schema";
import type { PageDocument } from "../../types";
import { ensureVisualSchema } from "../schema";
import {
  writePageDocument,
  readSiteDocument,
  readPageDocument,
} from "../schema";
import { renderRssFeed, resolveAbsoluteHttpUrl } from "../schema";

let tmpDir: string;
let project: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-r14-"));
  project = path.join(tmpDir, "site");
  fs.mkdirSync(project);
  const created = createSite(project, "minimal");
  expect(created.ok).toBe(true);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("round 14 output correctness", () => {
  it("resolveAbsoluteHttpUrl treats bare hosts as absolute https", () => {
    expect(
      resolveAbsoluteHttpUrl("https://example.com/", "example.org/x"),
    ).toBe("https://example.org/x");
    // Relative routes stay relative.
    expect(resolveAbsoluteHttpUrl("https://example.com/", "about")).toBe(
      "https://example.com/about",
    );
    // Root-relative routes stay root-relative.
    expect(
      resolveAbsoluteHttpUrl("https://example.com/blog/", "/posts/x"),
    ).toBe("https://example.com/posts/x");
  });

  it("renderRssFeed strips XML-forbidden control characters", () => {
    const site = readSiteDocument(project);
    const feed = renderRssFeed("https://example.com/", site.site!, [
      {
        page: "src/pages/posts/a.astro",
        slug: "posts/a",
        route: "/posts/a",
        title: "Title\u0000with\u0001controls",
        navLabel: "A",
        metaDescription: "",
        navVisible: true,
        isHome: false,
        detached: false,
        socialImage: "",
        canonicalUrl: "",
        noindex: false,
        publishDate: "2026-01-01",
        author: "",
      },
    ]);
    expect(feed).not.toContain("\u0000");
    expect(feed).not.toContain("\u0001");
    expect(feed).toContain("Titlewithcontrols");
  });

  it("withSiteDefaults coerces non-string nav fields", () => {
    ensureVisualSchema(project, "src/pages");
    fs.writeFileSync(
      path.join(project, ".zephus", "site.json"),
      JSON.stringify({
        schemaVersion: 1,
        siteName: "Coerce",
        design: { accent: "#fff" },
        shell: {
          layoutMode: "managed",
          navItems: [
            { id: 42, label: { bad: true }, href: null, visible: "yes" },
            null,
          ],
          siteTitle: { nope: 1 },
          announcementText: undefined,
          navCtaLabel: 7,
          navCtaHref: null,
        },
      }),
    );
    const site = readSiteDocument(project);
    expect(site.ok).toBe(true);
    expect(site.site?.shell?.navItems?.[0]?.label).toBe("");
    expect(site.site?.shell?.navItems?.[0]?.href).toBe("#");
    expect(site.site?.shell?.navItems?.[0]?.visible).toBe(true);
    expect(site.site?.shell?.navItems?.length).toBe(1);
    expect(site.site?.shell?.siteTitle).toBe("Coerce");
  });

  it("mergePageNavItems preserves the user's item order", async () => {
    ensureVisualSchema(project, "src/pages");
    // Reorder: home, then a custom item, then about — the merge must keep
    // this order instead of rebuilding alphabetically.
    readSiteDocument(project);
    const nav = [
      {
        id: "nav-custom",
        label: "Custom",
        href: "/custom",
        visible: true,
        children: [],
      },
      {
        id: "nav-1",
        label: "Home",
        href: "/",
        page: "src/pages/index.astro",
        visible: true,
        children: [],
      },
    ];
    const docs = [
      {
        page: "src/pages/index.astro",
        slug: "index",
        route: "/",
        navLabel: "Home",
        navVisible: true,
      },
      {
        page: "src/pages/about.astro",
        slug: "about",
        route: "/about",
        navLabel: "About",
        navVisible: true,
      },
    ] as unknown as PageDocument[];
    const merged = mergePageNavItems(nav, docs);
    const order = merged.map((m) => m.page || m.href || m.id);
    // custom first (original position), then home, then the new about page.
    expect(order[0]).toBe("/custom");
    expect(order[1]).toBe("src/pages/index.astro");
    expect(order[2]).toBe("src/pages/about.astro");
  });

  it("writePageDocument survives the coerced shell on a save cycle", () => {
    ensureVisualSchema(project, "src/pages");
    fs.writeFileSync(
      path.join(project, ".zephus", "site.json"),
      JSON.stringify({
        schemaVersion: 1,
        siteName: "Coerce",
        shell: { layoutMode: "managed", navItems: [{ label: 5, href: 6 }] },
      }),
    );
    const rel = path.join("src", "pages", "index.astro");
    const current = readPageDocument(project, rel, "src/pages");
    const saved = writePageDocument(
      project,
      "src/pages",
      current.pageDocument!,
    );
    expect(saved.ok).toBe(true);
  });
});
