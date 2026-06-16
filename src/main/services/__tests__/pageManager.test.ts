import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createManagedPage,
  deletePage,
  duplicatePage,
  listPageMetadata,
  normalizePageSlug,
  readPageMetadata,
  renamePage,
  routeFromPage,
  writePageMetadata,
} from "../pageManager";

let tmpDir: string;
const pagesDir = path.join("src", "pages");

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-pages-"));
  fs.mkdirSync(path.join(tmpDir, "src", "layouts"), { recursive: true });
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
    "<slot />",
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("pageManager", () => {
  it("normalizes nested slugs", () => {
    expect(normalizePageSlug(" Docs/Getting Started ")).toBe(
      "docs/getting-started",
    );
    expect(normalizePageSlug("")).toBe("index");
  });

  it("creates nested pages and reads metadata", () => {
    const created = createManagedPage(tmpDir, "docs/getting-started", pagesDir);
    expect(created.ok).toBe(true);

    const page = path.join("src", "pages", "docs", "getting-started.astro");
    expect(fs.existsSync(path.join(tmpDir, page))).toBe(true);
    expect(routeFromPage(page, pagesDir)).toBe("/docs/getting-started");

    const meta = readPageMetadata(tmpDir, page, pagesDir);
    expect(meta.slug).toBe("docs/getting-started");
    expect(meta.title).toBe("Getting Started");
  });

  it("writes metadata, renames, duplicates, and deletes pages", () => {
    createManagedPage(tmpDir, "about", pagesDir);
    const page = path.join("src", "pages", "about.astro");

    const saved = writePageMetadata(tmpDir, page, pagesDir, {
      title: "About Zephus",
      navLabel: "About",
      metaDescription: "About page",
      navVisible: false,
    });
    expect(saved.ok).toBe(true);

    let meta = readPageMetadata(tmpDir, page, pagesDir);
    expect(meta.title).toBe("About Zephus");
    expect(meta.navVisible).toBe(false);

    const renamed = renamePage(tmpDir, page, pagesDir, "company/about");
    expect(renamed.ok).toBe(true);

    const renamedPage = path.join("src", "pages", "company", "about.astro");
    expect(fs.existsSync(path.join(tmpDir, renamedPage))).toBe(true);

    const duplicated = duplicatePage(tmpDir, renamedPage, pagesDir);
    expect(duplicated.ok).toBe(true);

    const listed = listPageMetadata(tmpDir, pagesDir);
    expect(listed.ok).toBe(true);
    expect(listed.entries.length).toBe(2);
    expect(listed.entries.map((entry) => entry.route)).toContain(
      "/company/about",
    );

    const deleted = deletePage(tmpDir, renamedPage, pagesDir);
    expect(deleted.ok).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, renamedPage))).toBe(false);

    meta = readPageMetadata(
      tmpDir,
      path.join("src", "pages", "company", "about-copy.astro"),
      pagesDir,
    );
    expect(meta.title).toContain("Copy");
  });

  it("keeps schema and files aligned for custom Astro pages directories", () => {
    const customPagesDir = path.join("source", "pages");
    fs.writeFileSync(
      path.join(tmpDir, "astro.config.mjs"),
      "export default { srcDir: './source' };",
    );
    fs.mkdirSync(path.join(tmpDir, "source", "layouts"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "source", "layouts", "BaseLayout.astro"),
      "<slot />",
    );

    const created = createManagedPage(tmpDir, "docs/intro", customPagesDir);
    expect(created.ok).toBe(true);

    const page = path.join("source", "pages", "docs", "intro.astro");
    const renamed = renamePage(
      tmpDir,
      page,
      customPagesDir,
      "docs/getting-started",
    );
    expect(renamed.ok).toBe(true);

    const renamedPage = path.join(
      "source",
      "pages",
      "docs",
      "getting-started.astro",
    );
    const duplicated = duplicatePage(tmpDir, renamedPage, customPagesDir);
    expect(duplicated.ok).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          tmpDir,
          ".zephus",
          "pages",
          "docs",
          "getting-started-copy.json",
        ),
      ),
    ).toBe(true);

    const deleted = deletePage(tmpDir, renamedPage, customPagesDir);
    expect(deleted.ok).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, renamedPage))).toBe(false);
    expect(
      fs.existsSync(
        path.join(tmpDir, ".zephus", "pages", "docs", "getting-started.json"),
      ),
    ).toBe(false);
  });
});
