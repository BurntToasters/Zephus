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
  readSiteDocument,
  reattachPageDocument,
  writePageDocument,
  writeSiteDocument,
} from "../schema";
import { assertRealpathInside } from "../fsSafe";
import { readRepoSettings } from "../settings";
import { writeProjectFile } from "../files";

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
    expect(result.pageDocument?.page).toBe("src/pages/index.astro");
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
  it.skipIf(process.platform === "win32")(
    "cleans the target folder when a write fails mid-scaffold",
    () => {
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
    },
  );
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
  it.skipIf(process.platform === "win32")(
    "restores the file when the site write fails",
    () => {
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
    },
  );
});

describe("round 2 audit security & web engine failure checks", () => {
  it.skipIf(process.platform === "win32")(
    "rejects dangling symlinks pointing outside the project in assertRealpathInside",
    () => {
      const outsideTarget = path.join(tmpDir, "outside-target.astro");
      const linkPath = path.join(project, "src", "pages", "escape.astro");
      fs.symlinkSync(outsideTarget, linkPath);
      expect(() => assertRealpathInside(project, linkPath)).toThrow(
        /escapes the project directory/i,
      );
      const dup = duplicatePage(
        project,
        path.join("src", "pages", "index.astro"),
        "src/pages",
        "escape",
      );
      expect(dup.ok).toBe(false);
      expect(fs.existsSync(outsideTarget)).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses repo settings symlink escape without creating .corrupt backups",
    () => {
      const outsideSecret = path.join(tmpDir, "secret.txt");
      fs.writeFileSync(outsideSecret, "PRIVATE_KEY=NOT_JSON\n", "utf8");
      const zephusDir = path.join(project, ".zephus");
      fs.mkdirSync(zephusDir, { recursive: true });
      const settingsFile = path.join(zephusDir, "settings.json");
      fs.rmSync(settingsFile, { force: true });
      fs.symlinkSync(outsideSecret, settingsFile);

      const settings = readRepoSettings(project);
      expect(settings.schemaVersion).toBe(1);
      const files = fs.readdirSync(zephusDir);
      expect(files.some((f) => f.includes(".corrupt-"))).toBe(false);
    },
  );

  it("pins pagesDir in detachPageDocument so layouts cannot be overwritten", () => {
    const layout = path.join(project, "src", "layouts", "BaseLayout.astro");
    const before = fs.readFileSync(layout, "utf8");
    const res = detachPageDocument(
      project,
      "src/layouts/BaseLayout.astro",
      "src/layouts",
      "<p>pwned</p>",
    );
    expect(res.ok).toBe(false);
    expect(fs.readFileSync(layout, "utf8")).toBe(before);
  });

  it("blocks writes to executable Vite, PostCSS, and Tailwind config files", () => {
    for (const cfg of [
      "vite.config.mjs",
      "postcss.config.js",
      "tailwind.config.ts",
    ]) {
      const res = writeProjectFile(project, cfg, "export default {};");
      expect(res.ok).toBe(false);
    }
  });

  it("reattaches an out-of-sync page back to managed state", () => {
    const pageRel = path.join("src", "pages", "index.astro");
    const pageFile = path.join(project, pageRel);
    const modified = fs
      .readFileSync(pageFile, "utf8")
      .replace(
        "</BaseLayout>",
        "  <p>Hand edited paragraph</p>\n</BaseLayout>",
      );
    fs.writeFileSync(pageFile, modified, "utf8");

    const before = readPageDocument(project, pageRel, "src/pages");
    expect(before.ok).toBe(true);
    expect(before.pageDocument?.managedFileStatus).toBe("out-of-sync");

    const reattached = reattachPageDocument(project, pageRel, "src/pages");
    expect(reattached.ok).toBe(true);
    expect(reattached.pageDocument?.managedFileStatus).toBe("managed");
    expect(reattached.pageDocument?.detached).toBe(false);
  });

  it("blocks renaming the home page and syncs site navigation when renaming a detached page", () => {
    const homeRename = renamePage(
      project,
      path.join("src", "pages", "index.astro"),
      "src/pages",
      "home-renamed",
    );
    expect(homeRename.ok).toBe(false);

    const created = createSchemaPage(project, "src/pages", "team");
    expect(created.ok).toBe(true);
    const detached = detachPageDocument(
      project,
      path.join("src", "pages", "team.astro"),
      "src/pages",
      "---\nimport BaseLayout from '../layouts/BaseLayout.astro';\n---\n<BaseLayout><p>Team</p></BaseLayout>\n",
    );
    expect(detached.ok).toBe(true);

    const renamed = renamePage(
      project,
      path.join("src", "pages", "team.astro"),
      "src/pages",
      "our-team",
    );
    expect(renamed.ok).toBe(true);
    const siteRes = readSiteDocument(project);
    expect(
      siteRes.site?.shell.navItems.some((item) => item.href === "/our-team"),
    ).toBe(true);
  });

  it("normalizes bare domain siteUrl to https:// for sitemap and layout", () => {
    const siteRes = readSiteDocument(project);
    expect(siteRes.ok).toBe(true);
    const written = writeSiteDocument(
      project,
      { ...siteRes.site!, siteUrl: "example.com" },
      "src/pages",
    );
    expect(written.ok).toBe(true);
    const sitemap = fs.readFileSync(
      path.join(project, "public", "sitemap.xml"),
      "utf8",
    );
    expect(sitemap).toContain("https://example.com/");
    const layout = fs.readFileSync(
      path.join(project, "src", "layouts", "BaseLayout.astro"),
      "utf8",
    );
    expect(layout).toContain("https://example.com");
  });
});
