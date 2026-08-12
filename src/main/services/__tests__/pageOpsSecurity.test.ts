import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createSite } from "../wizard";
import { createSchemaPage, ensureVisualSchema } from "../schema";
import {
  deletePage,
  duplicatePage,
  renamePage,
  readPageMetadata,
  writePageMetadata,
  listPageMetadata,
} from "../pageManager";
import {
  detachPageDocument,
  readPageDocument,
  writePageDocument,
} from "../schema";

let tmpDir: string;
let project: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-sec-"));
  project = path.join(tmpDir, "site");
  fs.mkdirSync(project);
  const created = createSite(project, "minimal");
  expect(created.ok).toBe(true);
  ensureVisualSchema(project, "src/pages");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("page operation security", () => {
  it("rejects delete of a non-page file", () => {
    const envFile = path.join(project, ".env");
    fs.writeFileSync(envFile, "SECRET=1\n");
    const result = deletePage(project, ".env", "src/pages");
    expect(result.ok).toBe(false);
    expect(fs.existsSync(envFile)).toBe(true);
  });

  it("rejects rename of a non-page file", () => {
    const envFile = path.join(project, ".env");
    fs.writeFileSync(envFile, "SECRET=1\n");
    const result = renamePage(project, ".env", "src/pages", "leaked");
    expect(result.ok).toBe(false);
    expect(fs.existsSync(envFile)).toBe(true);
    expect(
      fs.existsSync(path.join(project, "src", "pages", "leaked.astro")),
    ).toBe(false);
  });

  it("rejects duplicate of a non-page file", () => {
    const envFile = path.join(project, ".env");
    fs.writeFileSync(envFile, "SECRET=1\n");
    const result = duplicatePage(project, ".env", "src/pages");
    expect(result.ok).toBe(false);
    expect(
      fs
        .readdirSync(path.join(project, "src", "pages"))
        .some((f) => f.includes("leaked") || f.includes("env")),
    ).toBe(false);
  });

  it("rejects path traversal in writePageDocument", async () => {
    const layout = path.join(project, "src", "layouts", "BaseLayout.astro");
    const before = fs.readFileSync(layout, "utf8");
    const page = path.join("src", "pages", "index.astro");
    const current = readPageDocument(project, page, "src/pages");
    const result = writePageDocument(project, "src/pages", {
      ...current.pageDocument!,
      page: path.join("..", "layouts", "BaseLayout.astro"),
    });
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(layout, "utf8")).toBe(before);
  });

  it("confines detachPageDocument to pagesDir and writes atomically", () => {
    const layout = path.join(project, "src", "layouts", "BaseLayout.astro");
    const before = fs.readFileSync(layout, "utf8");
    const result = detachPageDocument(
      project,
      path.join("..", "layouts", "BaseLayout.astro"),
      "src/pages",
      "<p>evil</p>",
    );
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(layout, "utf8")).toBe(before);
  });

  it("preserves page ext and canonicalizes detach target", async () => {
    const page = path.join("src", "pages", "index.astro");
    const result = detachPageDocument(
      project,
      page,
      "src/pages",
      "<p>hand</p>",
    );
    expect(result.ok).toBe(true);
    expect(result.pageDocument?.page).toBe(
      path.join("src", "pages", "index.astro"),
    );
    expect(result.pageDocument?.detached).toBe(true);
  });
});

describe("wizard non-empty folder", () => {
  it("rejects a non-empty folder with guidance", () => {
    const other = path.join(tmpDir, "busy");
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, "existing.txt"), "x");
    const result = createSite(other, "minimal");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("empty folder");
  });

  it("detects a prior Zephus scaffold on retry", () => {
    const retry = path.join(tmpDir, "retry");
    fs.mkdirSync(retry);
    fs.writeFileSync(
      path.join(retry, "astro.config.mjs"),
      "export default {};",
    );
    const result = createSite(retry, "minimal");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("already contains a Zephus site");
  });
});

describe("page operation success paths", () => {
  function makePage(slug: string): string {
    ensureVisualSchema(project, "src/pages");
    const created = createSchemaPage(project, "src/pages", slug);
    expect(created.ok).toBe(true);
    return path.join("src", "pages", `${slug}.astro`);
  }

  it("renames a managed page end to end", () => {
    const rel = makePage("rename-src");
    const result = renamePage(project, rel, "src/pages", "renamed-target");
    expect(result.ok).toBe(true);
    expect(
      fs.existsSync(path.join(project, "src", "pages", "renamed-target.astro")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(project, "src", "pages", "rename-src.astro")),
    ).toBe(false);
  });

  it("duplicates a page with a bumped colliding name", () => {
    const rel = makePage("dup-src");
    const first = duplicatePage(project, rel, "src/pages");
    expect(first.ok).toBe(true);
    expect(
      fs.existsSync(path.join(project, "src", "pages", "dup-src-copy.astro")),
    ).toBe(true);
  });

  it("deletes a page and its schema", () => {
    const rel = makePage("del-src");
    const result = deletePage(project, rel, "src/pages");
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(project, rel))).toBe(false);
    expect(
      fs.existsSync(path.join(project, ".zephus", "pages", "del-src.json")),
    ).toBe(false);
  });

  it("rejects renaming to an existing slug", () => {
    makePage("ren-a");
    const result = renamePage(
      project,
      path.join("src", "pages", "ren-a.astro"),
      "src/pages",
      "index",
    );
    expect(result.ok).toBe(false);
  });
});

describe("wizard rollback", () => {
  it("cleans the target folder when a write fails mid-scaffold", () => {
    if (process.getuid?.() === 0) return;
    const fresh = path.join(tmpDir, "fresh");
    fs.mkdirSync(fresh, { recursive: true });
    // Read-only parent: the scaffold cannot write, and the rollback must not
    // leave a partial .zephus claiming to be a Zephus project.
    const parent = path.join(tmpDir, "blocked");
    fs.mkdirSync(parent, { recursive: true });
    fs.chmodSync(parent, 0o555);
    try {
      const result = createSite(path.join(parent, "site"), "minimal");
      expect(result.ok).toBe(false);
    } finally {
      fs.chmodSync(parent, 0o755);
    }
    // The successfully-written case still cleans residue.
    expect(fs.existsSync(fresh)).toBe(true);
  });
});

describe("metadata fallbacks", () => {
  it("readPageMetadata falls back for sidecar-less pages", () => {
    ensureVisualSchema(project, "src/pages");
    fs.writeFileSync(
      path.join(project, "src", "pages", "bare.astro"),
      "<p>bare</p>",
    );
    const meta = readPageMetadata(
      project,
      path.join("src", "pages", "bare.astro"),
      "src/pages",
    );
    expect(meta.slug).toBe("bare");
    expect(meta.route).toBe("/bare");
    expect(meta.navVisible).toBe(true);
  });

  it("writePageMetadata preserves source on detached pages", () => {
    ensureVisualSchema(project, "src/pages");
    const rel = path.join("src", "pages", "det-meta.astro");
    const handAuthored = "---\nconst x = 1;\n---\n<p>mine</p>\n";
    fs.writeFileSync(path.join(project, rel), handAuthored);
    ensureVisualSchema(project, "src/pages");
    const sidecar = path.join(project, ".zephus", "pages", "det-meta.json");
    const doc = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    doc.detached = true;
    fs.writeFileSync(sidecar, JSON.stringify(doc));

    const written = writePageMetadata(project, rel, "src/pages", {
      title: "Renamed",
    });
    expect(written.ok).toBe(true);
    expect(fs.readFileSync(path.join(project, rel), "utf8")).toBe(handAuthored);
    const nextSidecar = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    expect(nextSidecar.title).toBe("Renamed");
    expect(nextSidecar.detached).toBe(true);
  });

  it("listPageMetadata reports ensure failures", () => {
    // Corrupt site.json makes the ensure pass fail.
    fs.mkdirSync(path.join(project, ".zephus"), { recursive: true });
    fs.writeFileSync(path.join(project, ".zephus", "site.json"), "{broken");
    const listed = listPageMetadata(project, "src/pages");
    expect(listed.ok).toBe(false);
  });
});

describe("deletePage restore", () => {
  it("restores the file when the site write fails", () => {
    if (process.getuid?.() === 0) return;
    ensureVisualSchema(project, "src/pages");
    const rel = path.join("src", "pages", "restore-me.astro");
    const created = createSchemaPage(project, "src/pages", "restore-me");
    expect(created.ok).toBe(true);
    const before = fs.readFileSync(path.join(project, rel), "utf8");
    // Block site.json writes so the post-delete sync fails.
    const zephusDir = path.join(project, ".zephus");
    const mode = fs.statSync(zephusDir).mode;
    try {
      fs.chmodSync(zephusDir, 0o555);
      const result = deletePage(project, rel, "src/pages");
      expect(result.ok).toBe(false);
      // The file must come back byte-for-byte.
      expect(fs.existsSync(path.join(project, rel))).toBe(true);
      expect(fs.readFileSync(path.join(project, rel), "utf8")).toBe(before);
    } finally {
      fs.chmodSync(zephusDir, mode);
    }
  });
});
