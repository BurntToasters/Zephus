import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findAssetUsage, repointAssetReferences } from "../assetUsage";
import { readSiteDocument, writeSiteDocument } from "../schema";
import { createSite } from "../wizard";
import {
  ensureVisualSchema,
  pagePathFromSlug,
  readPageDocument,
  writePageDocument,
} from "../schema";

let tmpDir: string;
let project: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-usage-"));
  project = path.join(tmpDir, "site");
  fs.mkdirSync(project);
  const created = createSite(project, "minimal");
  expect(created.ok).toBe(true);
  ensureVisualSchema(project, "src/pages");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function pageWithImage(src: string): void {
  const rel = pagePathFromSlug("src/pages", "story");
  fs.writeFileSync(path.join(project, rel), "stub", "utf8");
  ensureVisualSchema(project, "src/pages");
  const current = readPageDocument(project, rel, "src/pages");
  writePageDocument(project, "src/pages", {
    ...current.pageDocument!,
    sections: [
      {
        id: "s1",
        type: "section",
        label: "Main",
        props: { wrapper: "none", cls: "" },
        children: [
          {
            id: "img1",
            type: "image",
            props: { src, alt: "", cls: "" },
          },
        ],
      },
    ],
  });
}

describe("assetUsage", () => {
  it("finds pages referencing an asset", () => {
    pageWithImage("/assets/images/hero.png");
    const usage = findAssetUsage(
      project,
      "src/pages",
      "/assets/images/hero.png",
    );
    expect(usage.ok).toBe(true);
    expect(usage.pages).toHaveLength(1);
    expect(usage.pages[0]!.count).toBe(1);
  });

  it("ignores references inside longer paths", () => {
    pageWithImage("/my/assets/images/hero.png");
    const usage = findAssetUsage(
      project,
      "src/pages",
      "/assets/images/hero.png",
    );
    expect(usage.ok).toBe(true);
    expect(usage.pages).toHaveLength(0);
  });

  it("repoints references on rename and counts them", () => {
    pageWithImage("/assets/images/hero.png");
    const result = repointAssetReferences(
      project,
      "src/pages",
      "/assets/images/hero.png",
      "/assets/images/renamed.png",
    );
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(1);

    const reread = readPageDocument(
      project,
      pagePathFromSlug("src/pages", "story"),
      "src/pages",
    );
    const img = reread
      .pageDocument!.sections.flatMap((s) => s.children)
      .find((b) => b.type === "image");
    expect(img?.props["src"]).toBe("/assets/images/renamed.png");
  });

  it("repoints references with quotes and backslashes in the filename", () => {
    // Regression: the old implementation replaced on JSON.stringify output,
    // where " and \ are escaped — such filenames never matched, and a `to`
    // needing escaping produced invalid JSON that aborted the repoint.
    const from = '/assets/images/quote"back\\slash.png';
    const to = '/assets/images/renamed"one\\two.png';
    pageWithImage(from);
    const result = repointAssetReferences(project, "src/pages", from, to);
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(1);

    const reread = readPageDocument(
      project,
      pagePathFromSlug("src/pages", "story"),
      "src/pages",
    );
    const img = reread
      .pageDocument!.sections.flatMap((s) => s.children)
      .find((b) => b.type === "image");
    expect(img?.props["src"]).toBe(to);
  });

  it("does not repoint references inside longer paths", () => {
    pageWithImage("/my/assets/images/hero.png");
    const result = repointAssetReferences(
      project,
      "src/pages",
      "/assets/images/hero.png",
      "/assets/images/renamed.png",
    );
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(0);

    const reread = readPageDocument(
      project,
      pagePathFromSlug("src/pages", "story"),
      "src/pages",
    );
    const img = reread
      .pageDocument!.sections.flatMap((s) => s.children)
      .find((b) => b.type === "image");
    // The longer path must be left byte-for-byte intact.
    expect(img?.props["src"]).toBe("/my/assets/images/hero.png");
  });

  it("does not repoint a from-path without a leading slash inside a longer path", () => {
    // Regression: `/` used to count as a token boundary, so a `from` lacking
    // a leading slash matched inside any longer directory-prefixed path and
    // corrupted it (e.g. `assets/images/hero.png` inside `/foo/assets/...`).
    pageWithImage("/foo/assets/images/hero.png");
    const result = repointAssetReferences(
      project,
      "src/pages",
      "assets/images/hero.png",
      "assets/images/renamed.png",
    );
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(0);

    const reread = readPageDocument(
      project,
      pagePathFromSlug("src/pages", "story"),
      "src/pages",
    );
    const img = reread
      .pageDocument!.sections.flatMap((s) => s.children)
      .find((b) => b.type === "image");
    expect(img?.props["src"]).toBe("/foo/assets/images/hero.png");
  });

  it("no-ops when old and new paths are identical", () => {
    pageWithImage("/assets/images/hero.png");
    const result = repointAssetReferences(
      project,
      "src/pages",
      "/assets/images/hero.png",
      "/assets/images/hero.png",
    );
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(0);
  });

  it("repoints references in site settings (favicon, footer, head)", () => {
    const site = readSiteDocument(project);
    expect(site.ok).toBe(true);
    const saved = writeSiteDocument(
      project,
      {
        ...site.site!,
        faviconPath: "/assets/images/hero.png",
        shell: {
          ...site.site!.shell,
          footerHtml: '<img src="/assets/images/hero.png">',
          customHeadHtml: '<link href="/assets/images/hero.png">',
        },
      },
      "src/pages",
    );
    expect(saved.ok).toBe(true);

    const result = repointAssetReferences(
      project,
      "src/pages",
      "/assets/images/hero.png",
      "/assets/images/renamed.png",
    );
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(3);

    const reread = readSiteDocument(project);
    expect(reread.site?.faviconPath).toBe("/assets/images/renamed.png");
    expect(reread.site?.shell.footerHtml).toContain(
      "/assets/images/renamed.png",
    );
    expect(reread.site?.shell.customHeadHtml).toContain(
      "/assets/images/renamed.png",
    );
  });

  it("reports site-level references from findAssetUsage", () => {
    const site = readSiteDocument(project);
    const saved = writeSiteDocument(
      project,
      {
        ...site.site!,
        faviconPath: "/assets/images/hero.png",
        shell: {
          ...site.site!.shell,
          footerHtml: '<img src="/assets/images/hero.png">',
        },
      },
      "src/pages",
    );
    expect(saved.ok).toBe(true);

    const usage = findAssetUsage(
      project,
      "src/pages",
      "/assets/images/hero.png",
    );
    expect(usage.ok).toBe(true);
    expect(usage.siteReferences).toContain("Site favicon");
    expect(usage.siteReferences).toContain("Footer HTML");
    expect(usage.siteReferences).not.toContain("Custom head HTML");
  });

  it("reports custom head HTML references from findAssetUsage", () => {
    const site = readSiteDocument(project);
    const saved = writeSiteDocument(
      project,
      {
        ...site.site!,
        shell: {
          ...site.site!.shell,
          customHeadHtml: '<link href="/assets/images/hero.png">',
        },
      },
      "src/pages",
    );
    expect(saved.ok).toBe(true);
    const usage = findAssetUsage(
      project,
      "src/pages",
      "/assets/images/hero.png",
    );
    expect(usage.siteReferences).toContain("Custom head HTML");
  });

  it("fails cleanly when pages cannot be listed", () => {
    fs.writeFileSync(path.join(project, ".zephus", "site.json"), "{ broken");
    const usage = findAssetUsage(project, "src/pages", "/assets/images/x.png");
    expect(usage.ok).toBe(false);
    const repoint = repointAssetReferences(
      project,
      "src/pages",
      "/assets/images/x.png",
      "/assets/images/y.png",
    );
    expect(repoint.ok).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "aborts mid-repoint when a page write fails",
    () => {
      if (process.getuid?.() === 0) return;
      pageWithImage("/assets/images/hero.png");
      const sidecarDir = path.join(project, ".zephus", "pages");
      const mode = fs.statSync(sidecarDir).mode;
      try {
        fs.chmodSync(sidecarDir, 0o555);
        const result = repointAssetReferences(
          project,
          "src/pages",
          "/assets/images/hero.png",
          "/assets/images/renamed.png",
        );
        expect(result.ok).toBe(false);
      } finally {
        fs.chmodSync(sidecarDir, mode);
      }
    },
  );

  it("reports errors for missing and empty asset paths", () => {
    const missing = findAssetUsage(project, "src/pages", "");
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain("Missing asset path");

    const repoint = repointAssetReferences(project, "src/pages", "", "/x.png");
    expect(repoint.ok).toBe(true);
    expect(repoint.updated).toBe(0);
  });

  it("repoints numeric and nested values in the section tree", () => {
    const rel = pagePathFromSlug("src/pages", "numeric");
    fs.writeFileSync(path.join(project, rel), "stub", "utf8");
    ensureVisualSchema(project, "src/pages");
    const current = readPageDocument(project, rel, "src/pages");
    writePageDocument(project, "src/pages", {
      ...current.pageDocument!,
      sections: [
        {
          id: "s1",
          type: "section",
          label: "Main",
          props: { wrapper: "none", cls: "" },
          style: {
            columns: 2 as unknown as string,
            responsive: { mobile: { gap: "4px" } },
          },
          children: [
            {
              id: "img1",
              type: "image",
              props: { src: "/assets/images/hero.png", alt: "", cls: "" },
            },
          ],
        },
      ],
    });
    const result = repointAssetReferences(
      project,
      "src/pages",
      "/assets/images/hero.png",
      "/assets/images/renamed.png",
    );
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(1);
    const reread = readPageDocument(project, rel, "src/pages");
    const img = reread
      .pageDocument!.sections.flatMap((s) => s.children)
      .find((b) => b.type === "image");
    expect(img?.props["src"]).toBe("/assets/images/renamed.png");
    // The numeric style value survives the tree rewrite.
    expect(reread.pageDocument!.sections[0]?.style?.columns).toBe(2);
  });
});
