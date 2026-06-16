import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  categoryForExtension,
  importAssetsFromPaths,
  listProjectAssets,
  readAssetDataUrl,
} from "../assets";

let tmpDir: string;
let projectDir: string;
let sourceDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-assets-"));
  projectDir = path.join(tmpDir, "project");
  sourceDir = path.join(tmpDir, "sources");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeSource(name: string, content = "data"): string {
  const file = path.join(sourceDir, name);
  fs.writeFileSync(file, content);
  return file;
}

describe("categoryForExtension", () => {
  it("classifies known extensions", () => {
    expect(categoryForExtension("png")).toBe("images");
    expect(categoryForExtension(".JPG")).toBe("images");
    expect(categoryForExtension("mp4")).toBe("media");
    expect(categoryForExtension("pdf")).toBe("documents");
    expect(categoryForExtension("xyz")).toBe("other");
  });
});

describe("importAssetsFromPaths", () => {
  it("routes files into categorized public/assets folders", () => {
    const result = importAssetsFromPaths(projectDir, "public", [
      makeSource("photo.png"),
      makeSource("doc.pdf"),
    ]);
    expect(result.ok).toBe(true);
    expect(result.imported).toHaveLength(2);
    const paths = result.imported.map((i) => i.webPath).sort();
    expect(paths).toContain("/assets/images/photo.png");
    expect(paths).toContain("/assets/documents/doc.pdf");
    expect(
      fs.existsSync(path.join(projectDir, "public/assets/images/photo.png")),
    ).toBe(true);
  });

  it("deduplicates filenames on collision", () => {
    importAssetsFromPaths(projectDir, "public", [makeSource("a.png")]);
    importAssetsFromPaths(projectDir, "public", [makeSource("a.png")]);
    const listed = listProjectAssets(projectDir, "public");
    const names = listed.assets.map((a) => a.fileName).sort();
    expect(names).toEqual(["images/a-1.png", "images/a.png"]);
  });

  it("reports errors for missing files without failing the batch", () => {
    const result = importAssetsFromPaths(projectDir, "public", [
      makeSource("ok.png"),
      path.join(sourceDir, "does-not-exist.png"),
    ]);
    expect(result.imported).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it("rejects imports when public is a symlink outside the project", () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "zephus-assets-out-"),
    );
    try {
      fs.symlinkSync(outside, path.join(projectDir, "public"), "dir");

      const result = importAssetsFromPaths(projectDir, "public", [
        makeSource("photo.png"),
      ]);
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain("escapes");
      expect(fs.existsSync(path.join(outside, "assets/images/photo.png"))).toBe(
        false,
      );
      expect(fs.existsSync(path.join(outside, "assets"))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("listProjectAssets", () => {
  it("includes legacy public/images entries", () => {
    const legacyDir = path.join(projectDir, "public/images");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "old.png"), "x");

    const result = listProjectAssets(projectDir, "public");
    const legacy = result.assets.find((a) => a.webPath === "/images/old.png");
    expect(legacy).toBeDefined();
    expect(legacy?.category).toBe("images");
  });

  it("returns empty list for a project with no assets", () => {
    const result = listProjectAssets(projectDir, "public");
    expect(result.ok).toBe(true);
    expect(result.assets).toEqual([]);
  });

  it("rejects listings when public is a symlink outside the project", () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "zephus-assets-out-"),
    );
    try {
      fs.symlinkSync(outside, path.join(projectDir, "public"), "dir");

      const result = listProjectAssets(projectDir, "public");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("escapes");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("readAssetDataUrl", () => {
  it("returns a data URL for an imported image", () => {
    importAssetsFromPaths(projectDir, "public", [makeSource("pic.png", "abc")]);
    const result = readAssetDataUrl(
      projectDir,
      "public",
      "/assets/images/pic.png",
    );
    expect(result.ok).toBe(true);
    expect(result.dataUrl?.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("rejects paths that escape the public directory", () => {
    const result = readAssetDataUrl(
      projectDir,
      "public",
      "/../../etc/passwd.png",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects reads when public is a symlink outside the project", () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "zephus-assets-out-"),
    );
    try {
      fs.mkdirSync(path.join(outside, "assets", "images"), {
        recursive: true,
      });
      fs.writeFileSync(path.join(outside, "assets", "images", "pic.png"), "x");
      fs.symlinkSync(outside, path.join(projectDir, "public"), "dir");

      const result = readAssetDataUrl(
        projectDir,
        "public",
        "/assets/images/pic.png",
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain("escapes");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
