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
  readPageMetadata,
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

    const created = createManagedPage(project, "taken", "src/pages");
    expect(created.ok).toBe(true);
    const again = createManagedPage(project, "taken", "src/pages");
    expect(again.ok).toBe(false);
    expect(again.error).toContain("already exists");
  });

  it("renaming to the same name is a no-op", () => {
    const created = createManagedPage(project, "same", "src/pages");
    expect(created.ok).toBe(true);
    const renamed = renamePage(
      project,
      path.join("src", "pages", "same.astro"),
      "src/pages",
      "same",
    );
    expect(renamed.ok).toBe(true);
  });

  it("renaming to a 404 slug flips nav visibility off", () => {
    const created = createManagedPage(project, "not-found-able", "src/pages");
    expect(created.ok).toBe(true);
    // A top-level "404" now exists in every scaffold (createSite scaffolds
    // one); use a nested 404 route, which is equally reserved.
    const renamed = renamePage(
      project,
      path.join("src", "pages", "not-found-able.astro"),
      "src/pages",
      "404/custom",
    );
    expect(renamed.ok).toBe(true);
    const listed = listPageMetadata(project, "src/pages");
    const entry = listed.entries.find((m) => m.slug === "404/custom");
    expect(entry?.navVisible).toBe(false);
    expect(entry?.noindex).toBe(true);
  });

  it("duplicates with a custom slug and bumps colliding names", () => {
    const created = createManagedPage(project, "original", "src/pages");
    expect(created.ok).toBe(true);

    const first = duplicatePage(
      project,
      path.join("src", "pages", "original.astro"),
      "src/pages",
      "copy",
    );
    expect(first.ok).toBe(true);
    expect(
      fs.existsSync(path.join(project, "src", "pages", "copy.astro")),
    ).toBe(true);

    // Collision: the second duplicate bumps to copy-copy-1.
    const second = duplicatePage(
      project,
      path.join("src", "pages", "original.astro"),
      "src/pages",
      "copy",
    );
    expect(second.ok).toBe(true);
    expect(
      fs.existsSync(path.join(project, "src", "pages", "copy-copy-1.astro")),
    ).toBe(true);
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
    createManagedPage(project, "gone", "src/pages");
    const deleted = deletePage(
      project,
      path.join("src", "pages", "gone.astro"),
      "src/pages",
    );
    expect(deleted.ok).toBe(true);
    expect(
      fs.existsSync(path.join(project, "src", "pages", "gone.astro")),
    ).toBe(false);
  });

  it("readPageMetadata falls back to derived metadata without a sidecar", () => {
    // A raw hand-authored page with no sidecar yet.
    fs.writeFileSync(
      path.join(project, "src", "pages", "handmade.astro"),
      "<h1>Hi</h1>",
    );
    const meta = readPageMetadata(
      project,
      path.join("src", "pages", "handmade.astro"),
      "src/pages",
    );
    expect(meta.slug).toBe("handmade");
    expect(meta.route).toBe("/handmade");
    expect(meta.navLabel).toBe("Handmade");
    expect(meta.navVisible).toBe(true);
    expect(meta.noindex).toBe(false);
    expect(meta.page).toBe(path.join("src", "pages", "handmade.astro"));

    // Index pages fall back to Home.
    const home = readPageMetadata(
      project,
      path.join("src", "pages", "index.astro"),
      "src/pages",
    );
    expect(home.title).toBe("Home");
    expect(home.route).toBe("/");
    expect(home.isHome).toBe(true);
  });

  it("readPageMetadata falls back to index for an un-normalizable slug", () => {
    // A file name that cannot normalize to a slug (only dashes) falls back
    // to the index metadata instead of throwing.
    fs.writeFileSync(
      path.join(project, "src", "pages", "---.astro"),
      "<h1>x</h1>",
    );
    const meta = readPageMetadata(
      project,
      path.join("src", "pages", "---.astro"),
      "src/pages",
    );
    expect(meta.slug).toBe("index");
    expect(meta.route).toBe("/");
  });

  it("listPageMetadata reports a failure on a corrupt project config", () => {
    fs.writeFileSync(path.join(project, ".zephus", "site.json"), "{ broken");
    const listed = listPageMetadata(project, "src/pages");
    expect(listed.ok).toBe(false);
  });

  it("writePageMetadata fails when the page schema cannot be read", () => {
    createManagedPage(project, "meta-page", "src/pages");
    fs.writeFileSync(path.join(project, ".zephus", "site.json"), "{ broken");
    const written = writePageMetadata(
      project,
      path.join("src", "pages", "meta-page.astro"),
      "src/pages",
      { title: "New Title" },
    );
    expect(written.ok).toBe(false);
  });

  it("renamePage fails cleanly when the source cannot be read", () => {
    // A directory where a page file is expected forces a read error.
    fs.mkdirSync(path.join(project, "src", "pages", "dir-as-page"));
    const renamed = renamePage(
      project,
      path.join("src", "pages", "dir-as-page"),
      "src/pages",
      "elsewhere",
    );
    expect(renamed.ok).toBe(false);
    expect(
      fs.existsSync(path.join(project, "src", "pages", "dir-as-page")),
    ).toBe(true);
  });

  it("duplicatePage fails cleanly when the source cannot be copied", () => {
    fs.mkdirSync(path.join(project, "src", "pages", "dir-to-copy"));
    const duplicated = duplicatePage(
      project,
      path.join("src", "pages", "dir-to-copy"),
      "src/pages",
    );
    expect(duplicated.ok).toBe(false);
  });

  it("rolls the rename back when the sidecar cannot be moved", () => {
    // A read-only sidecar directory makes renamePageSchema fail after the
    // .astro was moved — the rename must restore the original file.
    if (process.getuid?.() === 0) return;
    createManagedPage(project, "movable", "src/pages");
    const sidecarDir = path.join(project, ".zephus", "pages");
    const mode = fs.statSync(sidecarDir).mode;
    try {
      fs.chmodSync(sidecarDir, 0o555);
      const renamed = renamePage(
        project,
        path.join("src", "pages", "movable.astro"),
        "src/pages",
        "elsewhere",
      );
      expect(renamed.ok).toBe(false);
      // The original file survives.
      expect(
        fs.existsSync(path.join(project, "src", "pages", "movable.astro")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(project, "src", "pages", "elsewhere.astro")),
      ).toBe(false);
    } finally {
      fs.chmodSync(sidecarDir, mode);
    }
  });

  it("renames a detached page without touching its hand-authored file", () => {
    createManagedPage(project, "detached-page", "src/pages");
    const rel = path.join("src", "pages", "detached-page.astro");
    const handAuthored =
      "---\nconst custom = true;\n---\n<p>hand written</p>\n";
    fs.writeFileSync(path.join(project, rel), handAuthored, "utf8");
    // Mark the sidecar detached (simulates a user hand-edit + detach).
    ensureVisualSchema(project, "src/pages");
    const sidecar = path.join(
      project,
      ".zephus",
      "pages",
      "detached-page.json",
    );
    const doc = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    doc.detached = true;
    doc.detachedAt = new Date().toISOString();
    fs.writeFileSync(sidecar, JSON.stringify(doc));

    const renamed = renamePage(project, rel, "src/pages", "renamed-page");
    expect(renamed.ok).toBe(true);
    // The moved file keeps the user's hand-authored bytes EXACTLY.
    const moved = path.join(project, "src", "pages", "renamed-page.astro");
    expect(fs.readFileSync(moved, "utf8")).toBe(handAuthored);
    // The sidecar moved with the detached flag preserved.
    const nextSidecar = JSON.parse(
      fs.readFileSync(
        path.join(project, ".zephus", "pages", "renamed-page.json"),
        "utf8",
      ),
    );
    expect(nextSidecar.detached).toBe(true);
    expect(nextSidecar.slug).toBe("renamed-page");
  });

  it("writePageMetadata on a detached page preserves the hand-authored file", () => {
    createManagedPage(project, "detached-meta", "src/pages");
    const rel = path.join("src", "pages", "detached-meta.astro");
    const handAuthored =
      "---\nconst custom = true;\n---\n<p>hand written</p>\n";
    fs.writeFileSync(path.join(project, rel), handAuthored, "utf8");
    // Mark the sidecar detached (simulates a user hand-edit + detach).
    ensureVisualSchema(project, "src/pages");
    const sidecar = path.join(
      project,
      ".zephus",
      "pages",
      "detached-meta.json",
    );
    const doc = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    doc.detached = true;
    doc.detachedAt = new Date().toISOString();
    fs.writeFileSync(sidecar, JSON.stringify(doc));

    const written = writePageMetadata(project, rel, "src/pages", {
      navVisible: false,
      title: "Renamed in UI",
    });
    expect(written.ok).toBe(true);
    // The hand-authored bytes must survive byte-for-byte.
    expect(fs.readFileSync(path.join(project, rel), "utf8")).toBe(handAuthored);
    // The sidecar metadata updated AND stays detached.
    const nextSidecar = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    expect(nextSidecar.title).toBe("Renamed in UI");
    expect(nextSidecar.navVisible).toBe(false);
    expect(nextSidecar.detached).toBe(true);
    expect(nextSidecar.managedFileStatus).toBe("detached");
  });

  it("duplicates a detached page preserving the hand-authored bytes", () => {
    createManagedPage(project, "detach-src", "src/pages");
    const rel = path.join("src", "pages", "detach-src.astro");
    const handAuthored = "---\nconst x = 1;\n---\n<p>custom</p>\n";
    fs.writeFileSync(path.join(project, rel), handAuthored, "utf8");
    ensureVisualSchema(project, "src/pages");
    const sidecar = path.join(project, ".zephus", "pages", "detach-src.json");
    const doc = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    doc.detached = true;
    doc.detachedAt = new Date().toISOString();
    fs.writeFileSync(sidecar, JSON.stringify(doc));

    const duplicated = duplicatePage(project, rel, "src/pages");
    expect(duplicated.ok).toBe(true);
    // The copy carries the hand-authored bytes, not the stale managed tree.
    const copy = path.join(project, "src", "pages", "detach-src-copy.astro");
    expect(fs.readFileSync(copy, "utf8")).toBe(handAuthored);
    const copySidecar = JSON.parse(
      fs.readFileSync(
        path.join(project, ".zephus", "pages", "detach-src-copy.json"),
        "utf8",
      ),
    );
    expect(copySidecar.detached).toBe(true);
    expect(copySidecar.title).toBe(`${doc.title} Copy`);
  });

  it("restores the page file when the sidecar delete fails", () => {
    if (process.getuid?.() === 0) return;
    createManagedPage(project, "keeper", "src/pages");
    const sidecarDir = path.join(project, ".zephus", "pages");
    const mode = fs.statSync(sidecarDir).mode;
    try {
      fs.chmodSync(sidecarDir, 0o555);
      const deleted = deletePage(
        project,
        path.join("src", "pages", "keeper.astro"),
        "src/pages",
      );
      expect(deleted.ok).toBe(false);
      // The page file is restored.
      expect(
        fs.existsSync(path.join(project, "src", "pages", "keeper.astro")),
      ).toBe(true);
    } finally {
      fs.chmodSync(sidecarDir, mode);
    }
  });

  it("removes the copied file when the duplicate schema write fails", () => {
    if (process.getuid?.() === 0) return;
    createManagedPage(project, "dupe-source", "src/pages");
    const sidecarDir = path.join(project, ".zephus", "pages");
    const mode = fs.statSync(sidecarDir).mode;
    try {
      fs.chmodSync(sidecarDir, 0o555);
      const duplicated = duplicatePage(
        project,
        path.join("src", "pages", "dupe-source.astro"),
        "src/pages",
      );
      expect(duplicated.ok).toBe(false);
      // No orphaned .astro copy may remain.
      expect(
        fs.existsSync(
          path.join(project, "src", "pages", "dupe-source-copy.astro"),
        ),
      ).toBe(false);
    } finally {
      fs.chmodSync(sidecarDir, mode);
    }
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
