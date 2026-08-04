import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createSite } from "../wizard";
import { ensureVisualSchema } from "../schema";
import {
  createManagedPage,
  deletePage,
  duplicatePage,
  listPageMetadata,
  renamePage,
  writePageMetadata,
} from "../pageManager";

let tmpDir: string;
let project: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-pagemgr-"));
  project = path.join(tmpDir, "site");
  fs.mkdirSync(project);
  const created = createSite(project, "minimal");
  expect(created.ok).toBe(true);
  ensureVisualSchema(project, "src/pages");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("pageManager", () => {
  it("creates pages with normalized slugs", () => {
    const created = createManagedPage(project, "About Us", "src/pages");
    expect(created.ok).toBe(true);
    expect(
      fs.existsSync(path.join(project, "src", "pages", "about-us.astro")),
    ).toBe(true);

    const listed = listPageMetadata(project, "src/pages");
    expect(listed.entries.some((e) => e.slug === "about-us")).toBe(true);
  });

  it("rejects invalid and duplicate slugs", () => {
    expect(createManagedPage(project, "", "src/pages").ok).toBe(false);
    expect(createManagedPage(project, "////", "src/pages").ok).toBe(false);
    expect(createManagedPage(project, "index", "src/pages").ok).toBe(false);
  });

  it("renames pages and moves the sidecar", () => {
    createManagedPage(project, "First Page", "src/pages");
    const renamed = renamePage(
      project,
      path.join("src", "pages", "first-page.astro"),
      "src/pages",
      "second-page",
    );
    expect(renamed.ok).toBe(true);
    expect(
      fs.existsSync(path.join(project, "src", "pages", "second-page.astro")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(project, "src", "pages", "first-page.astro")),
    ).toBe(false);

    const listed = listPageMetadata(project, "src/pages");
    expect(listed.entries.some((e) => e.slug === "second-page")).toBe(true);
  });

  it("refuses to rename onto an existing page", () => {
    createManagedPage(project, "One", "src/pages");
    createManagedPage(project, "Two", "src/pages");
    const renamed = renamePage(
      project,
      path.join("src", "pages", "one.astro"),
      "src/pages",
      "two",
    );
    expect(renamed.ok).toBe(false);
    expect(renamed.error).toContain("already exists");
  });

  it("duplicates pages with fresh slugs and content", () => {
    createManagedPage(project, "About", "src/pages");
    const duplicated = duplicatePage(
      project,
      path.join("src", "pages", "about.astro"),
      "src/pages",
    );
    expect(duplicated.ok).toBe(true);
    expect(
      fs.existsSync(path.join(project, "src", "pages", "about-copy.astro")),
    ).toBe(true);
  });

  it("deletes pages and their sidecars", () => {
    createManagedPage(project, "Temp", "src/pages");
    const deleted = deletePage(
      project,
      path.join("src", "pages", "temp.astro"),
      "src/pages",
    );
    expect(deleted.ok).toBe(true);
    expect(
      fs.existsSync(path.join(project, "src", "pages", "temp.astro")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(project, ".zephus", "pages", "temp.json")),
    ).toBe(false);
  });

  it("reports deletion of a missing page", () => {
    const deleted = deletePage(
      project,
      path.join("src", "pages", "nope.astro"),
      "src/pages",
    );
    expect(deleted.ok).toBe(false);
  });

  it("writes page metadata (title, nav, SEO)", () => {
    createManagedPage(project, "Blog", "src/pages");
    const written = writePageMetadata(
      project,
      path.join("src", "pages", "blog.astro"),
      "src/pages",
      {
        title: "The Blog",
        navLabel: "Articles",
        metaDescription: "All the articles.",
        navVisible: false,
        noindex: true,
        publishDate: "2026-02-03",
        author: "Ada",
      },
    );
    expect(written.ok).toBe(true);

    const listed = listPageMetadata(project, "src/pages");
    const entry = listed.entries.find((e) => e.slug === "blog");
    expect(entry?.title).toBe("The Blog");
    expect(entry?.navLabel).toBe("Articles");
    expect(entry?.navVisible).toBe(false);
    expect(entry?.noindex).toBe(true);
    expect(entry?.publishDate).toBe("2026-02-03");
  });

  it("keeps the 404 page hidden and noindex even when written otherwise", () => {
    createManagedPage(project, "404", "src/pages");
    const written = writePageMetadata(
      project,
      path.join("src", "pages", "404.astro"),
      "src/pages",
      { navVisible: true, noindex: false },
    );
    expect(written.ok).toBe(true);
    const listed = listPageMetadata(project, "src/pages");
    const entry = listed.entries.find((e) => e.slug === "404");
    expect(entry?.navVisible).toBe(false);
    expect(entry?.noindex).toBe(true);
  });
});
