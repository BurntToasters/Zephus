import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findAssetUsage, repointAssetReferences } from "../assetUsage";
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
    expect(img?.props["src"]).toBe("/my/assets/images/hero.png");
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
});
