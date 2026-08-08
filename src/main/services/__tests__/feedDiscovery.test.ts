import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createSite } from "../wizard";
import {
  ensureVisualSchema,
  createSchemaPage,
  readPageDocument,
  readSiteDocument,
  writeSiteDocument,
  writePageDocument,
  pagePathFromSlug,
} from "../schema";

let tmpDir: string;
let project: string;
const pagesDir = path.join("src", "pages");

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-feed-"));
  project = path.join(tmpDir, "site");
  fs.mkdirSync(project);
  const created = createSite(project, "minimal");
  expect(created.ok).toBe(true);
  ensureVisualSchema(project, pagesDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function publicFile(name: string): string {
  return path.join(project, "public", name);
}

function setSiteUrl(url: string): void {
  const site = readSiteDocument(project);
  expect(site.ok).toBe(true);
  const saved = writeSiteDocument(
    project,
    { ...site.site!, siteUrl: url },
    pagesDir,
  );
  expect(saved.ok).toBe(true);
}

function addDatedPost(): void {
  const created = createSchemaPage(project, pagesDir, "post-1");
  expect(created.ok).toBe(true);
  const rel = pagePathFromSlug(pagesDir, "post-1");
  const current = readPageDocument(project, rel, pagesDir);
  expect(current.ok).toBe(true);
  const write = writePageDocument(project, pagesDir, {
    ...current.pageDocument!,
    publishDate: "2026-06-15",
    author: "Tester",
  });
  expect(write.ok).toBe(true);
}

describe("discovery files (sitemap/robots/rss)", () => {
  it("generates none without a public site URL", () => {
    setSiteUrl("");
    expect(fs.existsSync(publicFile("sitemap.xml"))).toBe(false);
    expect(fs.existsSync(publicFile("robots.txt"))).toBe(false);
    expect(fs.existsSync(publicFile("rss.xml"))).toBe(false);
  });

  it("generates sitemap and robots for a public URL", () => {
    setSiteUrl("https://example.com");
    expect(fs.existsSync(publicFile("sitemap.xml"))).toBe(true);
    expect(fs.existsSync(publicFile("robots.txt"))).toBe(true);
    const sitemap = fs.readFileSync(publicFile("sitemap.xml"), "utf8");
    expect(sitemap).toContain("https://example.com/");
    expect(sitemap).toContain("zephus:managed sitemap");
    const robots = fs.readFileSync(publicFile("robots.txt"), "utf8");
    expect(robots).toContain("zephus:managed robots");
  });

  it("generates an rss feed once a dated post exists", () => {
    setSiteUrl("https://example.com");
    expect(fs.existsSync(publicFile("rss.xml"))).toBe(false);
    addDatedPost();
    expect(fs.existsSync(publicFile("rss.xml"))).toBe(true);
    const rss = fs.readFileSync(publicFile("rss.xml"), "utf8");
    expect(rss).toContain("<rss");
    expect(rss).toContain("/post-1");
    expect(rss).toContain("Mon, 15 Jun 2026");
  });

  it("preserves hand-authored discovery files and removes managed ones on clear", () => {
    fs.mkdirSync(path.join(project, "public"), { recursive: true });
    fs.writeFileSync(publicFile("robots.txt"), "User-agent: *\nDisallow: /");
    fs.writeFileSync(
      publicFile("sitemap.xml"),
      "<?xml version='1.0'?><urlset/>",
    );
    setSiteUrl("https://example.com");

    // User-authored files are never replaced.
    expect(fs.readFileSync(publicFile("robots.txt"), "utf8")).toBe(
      "User-agent: *\nDisallow: /",
    );
    expect(fs.readFileSync(publicFile("sitemap.xml"), "utf8")).toBe(
      "<?xml version='1.0'?><urlset/>",
    );

    // Clearing the site URL removes only Zephus-managed discovery files.
    addDatedPost();
    expect(fs.existsSync(publicFile("rss.xml"))).toBe(true);
    setSiteUrl("");
    expect(fs.existsSync(publicFile("rss.xml"))).toBe(false);
    expect(fs.existsSync(publicFile("robots.txt"))).toBe(true);
    expect(fs.existsSync(publicFile("sitemap.xml"))).toBe(true);
  });
});
