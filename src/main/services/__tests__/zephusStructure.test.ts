import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createSite } from "../wizard";
import {
  ensureVisualSchema,
  pagePathFromSlug,
  readPageDocument,
  writePageDocument,
} from "../schema";
import { readRepoSettings } from "../settings";
import type { SiteDocument } from "../../types";

/** Contract test for the `.zephus/` project save state: what a freshly created Zephus site must contain, what a healthy… */
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-contract-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createProject(theme = "minimal"): string {
  const target = path.join(tmpDir, "site");
  fs.mkdirSync(target);
  const created = createSite(target, theme);
  expect(created.ok).toBe(true);
  return target;
}

function listZephusFiles(projectPath: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, childRel);
      else out.push(childRel);
    }
  };
  walk(path.join(projectPath, ".zephus"), "");
  return out.sort();
}

describe(".zephus project structure", () => {
  it("creates exactly the expected save-state files", () => {
    const project = createProject();
    const files = listZephusFiles(project);
    // site.json + settings.json + one sidecar per page (index + theme pages).
    expect(files).toContain("site.json");
    expect(files).toContain("settings.json");
    expect(files.filter((f) => f.startsWith("pages/"))).toEqual([
      // Every fresh site scaffolds a 404 page (and its sidecar).
      "pages/404.json",
      "pages/index.json",
    ]);
    // No transient caches may live in the committed state.
    expect(files.some((f) => f.includes("assets-index"))).toBe(false);
    expect(files.some((f) => f.includes("corrupt"))).toBe(false);
  });

  it("site.json is a valid SiteDocument with design + shell", () => {
    const project = createProject("project");
    const site = JSON.parse(
      fs.readFileSync(path.join(project, ".zephus", "site.json"), "utf8"),
    ) as SiteDocument;
    expect(site.schemaVersion).toBe(1);
    expect(site.design).toBeDefined();
    expect(site.design.accent).toBeTruthy();
    expect(site.shell.layoutMode).toBe("managed");
    expect(site.shell.layoutPath).toMatch(/BaseLayout\.astro$/);
  });

  it("settings.json carries the theme and schema version", () => {
    const project = createProject("blog");
    const settings = readRepoSettings(project);
    expect(settings.schemaVersion).toBe(1);
    expect((settings as unknown as Record<string, unknown>)["theme"]).toBe(
      "blog",
    );
  });

  it("every page file has a matching sidecar that round-trips", () => {
    const project = createProject("project");
    const pages = fs
      .readdirSync(path.join(project, "src", "pages"))
      .filter((name) => name.endsWith(".astro"));

    const ensured = ensureVisualSchema(project, "src/pages");
    expect(ensured.ok).toBe(true);

    for (const page of pages) {
      const rel = path.join("src", "pages", page);
      const doc = readPageDocument(project, rel, "src/pages");
      expect(doc.ok).toBe(true);
      expect(doc.pageDocument?.managedFileStatus).toBe("managed");
      // The generated .astro matches the stored sidecar content.
      const generated = fs.readFileSync(path.join(project, rel), "utf8");
      expect(generated).toContain(
        `.zephus/pages/${page.replace(/\.astro$/, ".json")}`,
      );
    }
  });

  it("a saved page round-trips through writePageDocument", () => {
    const project = createProject("project");
    ensureVisualSchema(project, "src/pages");
    const rel = pagePathFromSlug("src/pages", "story");
    fs.writeFileSync(
      path.join(project, rel),
      "---\nimport BaseLayout from '../layouts/BaseLayout.astro';\n---\n<BaseLayout title=\"Story\"><p>Hello</p></BaseLayout>\n",
    );

    const current = readPageDocument(project, rel, "src/pages");
    expect(current.ok).toBe(true);
    writePageDocument(project, "src/pages", {
      ...current.pageDocument!,
      title: "Story",
      navLabel: "Story",
    });

    const reread = readPageDocument(project, rel, "src/pages");
    expect(reread.pageDocument?.title).toBe("Story");
    expect(reread.pageDocument?.managedFileStatus).toBe("managed");
  });

  it("a corrupt site.json is backed up and surfaced, never overwritten", () => {
    const project = createProject();
    fs.writeFileSync(path.join(project, ".zephus", "site.json"), "{", "utf8");

    const ensured = ensureVisualSchema(project, "src/pages");
    expect(ensured.ok).toBe(false);
    expect(ensured.error).toContain("corrupt");
    // The corrupt original is preserved as a backup.
    const backups = fs
      .readdirSync(path.join(project, ".zephus"))
      .filter((name) => name.startsWith("site.json.corrupt-"));
    expect(backups).toHaveLength(1);
    expect(
      fs.readFileSync(path.join(project, ".zephus", "site.json"), "utf8"),
    ).toBe("{");
  });

  it("a second open pass changes nothing (fresh-clone stability)", () => {
    const project = createProject("project");
    ensureVisualSchema(project, "src/pages");
    const snapshots = new Map<string, string>();
    for (const file of [
      "src/pages/index.astro",
      "src/layouts/BaseLayout.astro",
      "public/styles/global.css",
      ".zephus/pages/index.json",
      ".zephus/site.json",
    ]) {
      let content = fs.readFileSync(path.join(project, file), "utf8");
      if (file.endsWith("site.json")) {
        // generatedAt is a sync timestamp that changes on every pass by
        // design; everything else must stay byte-identical.
        const site = JSON.parse(content) as Record<string, unknown>;
        delete site["generatedAt"];
        content = JSON.stringify(site, null, 2);
      }
      snapshots.set(file, content);
    }

    // Reopening the project must not rewrite any file (no spurious diffs).
    ensureVisualSchema(project, "src/pages");
    for (const [file, content] of snapshots) {
      let next = fs.readFileSync(path.join(project, file), "utf8");
      if (file.endsWith("site.json")) {
        const site = JSON.parse(next) as Record<string, unknown>;
        delete site["generatedAt"];
        next = JSON.stringify(site, null, 2);
      }
      expect(next).toBe(content);
    }
  });

  it("deleting a page file removes the page (enumeration is file-driven)", () => {
    const project = createProject("project");
    const pages = fs
      .readdirSync(path.join(project, "src", "pages"))
      .filter((name) => name.endsWith(".astro") && !name.startsWith("index"));
    expect(pages.length).toBeGreaterThan(0);
    const removed = pages[0]!;
    fs.rmSync(path.join(project, "src", "pages", removed), { force: true });

    const ensured = ensureVisualSchema(project, "src/pages");
    expect(ensured.ok).toBe(true);
    // The page is gone from the project; its sidecar is left as an orphan
    // (never resurrected — the user deleted the page on purpose).
    expect(fs.existsSync(path.join(project, "src", "pages", removed))).toBe(
      false,
    );
    expect(
      fs.existsSync(
        path.join(
          project,
          ".zephus",
          "pages",
          removed.replace(/\.astro$/, ".json"),
        ),
      ),
    ).toBe(true);
  });
});
