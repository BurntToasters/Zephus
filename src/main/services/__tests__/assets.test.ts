import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  categoryForExtension,
  deleteAsset,
  importAssets,
  importAssetsFromPaths,
  importImage,
  listProjectAssets,
  readAssetDataUrl,
  renameAsset,
} from "../assets";

const dialogMock = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  showMessageBox: vi.fn(),
}));

vi.mock("electron", () => ({
  dialog: dialogMock,
  BrowserWindow: class {},
}));

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
    expect(categoryForExtension("webm")).toBe("media");
    expect(categoryForExtension("mp3")).toBe("media");
    expect(categoryForExtension("pdf")).toBe("documents");
    expect(categoryForExtension("docx")).toBe("documents");
    expect(categoryForExtension("md")).toBe("documents");
    expect(categoryForExtension("xyz")).toBe("other");
    expect(categoryForExtension("")).toBe("other");
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

  it("rejects unsupported extensions and directories without failing the batch", () => {
    const dirSource = path.join(sourceDir, "folder.png");
    fs.mkdirSync(dirSource);
    const result = importAssetsFromPaths(projectDir, "public", [
      makeSource("evil.exe"),
      dirSource,
      makeSource("ok.jpg"),
    ]);
    expect(result.imported).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("unsupported file type");
    expect(result.errors[1]).toContain("not a file");
    expect(result.ok).toBe(false);
  });

  it("ignores non-string entries in the source list", () => {
    const result = importAssetsFromPaths(projectDir, "public", [
      makeSource("ok.png"),
      "",
      undefined as unknown as string,
      42 as unknown as string,
    ]);
    expect(result.ok).toBe(true);
    expect(result.imported).toHaveLength(1);
  });

  it("deduplicates imported names against existing files", () => {
    fs.mkdirSync(path.join(projectDir, "public/assets/images"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(projectDir, "public/assets/images/a.png"), "x");
    const result = importAssetsFromPaths(projectDir, "public", [
      makeSource("a.png"),
    ]);
    expect(result.imported[0]?.webPath).toBe("/assets/images/a-1.png");
  });
});

describe("importImage dialog flow", () => {
  beforeEach(() => {
    dialogMock.showOpenDialog.mockReset();
  });

  it("returns the web path when the user picks a file", async () => {
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [makeSource("picked.png")],
    });
    const result = await importImage(null, projectDir, "public");
    expect(result.ok).toBe(true);
    expect(result.webPath).toBe("/assets/images/picked.png");
  });

  it("reports cancel without an error", async () => {
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: [],
    });
    const result = await importImage(null, projectDir, "public");
    expect(result.ok).toBe(false);
    expect(result.canceled).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("surfaces copy failures as errors", async () => {
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [path.join(sourceDir, "missing.png")],
    });
    const result = await importImage(null, projectDir, "public");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("importAssets dialog flow", () => {
  beforeEach(() => {
    dialogMock.showOpenDialog.mockReset();
  });

  it("imports the picked files", async () => {
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [makeSource("pick.png"), makeSource("note.txt")],
    });
    const result = await importAssets(null, projectDir, "public");
    expect(result.ok).toBe(true);
    expect(result.imported).toHaveLength(2);
  });

  it("reports cancel as an empty result", async () => {
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: [],
    });
    const result = await importAssets(null, projectDir, "public");
    expect(result.ok).toBe(false);
    expect(result.imported).toEqual([]);
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

  it("rejects unsupported image types", () => {
    importAssetsFromPaths(projectDir, "public", [makeSource("doc.pdf")]);
    const result = readAssetDataUrl(
      projectDir,
      "public",
      "/assets/documents/doc.pdf",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unsupported image type");
  });

  it("rejects files over the data URL size limit", () => {
    fs.mkdirSync(path.join(projectDir, "public/assets/images"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(projectDir, "public/assets/images/big.png"),
      Buffer.alloc(6 * 1024 * 1024),
    );
    const result = readAssetDataUrl(
      projectDir,
      "public",
      "/assets/images/big.png",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("too large");
  });

  it("reports missing files", () => {
    const result = readAssetDataUrl(
      projectDir,
      "public",
      "/assets/images/nope.png",
    );
    expect(result.ok).toBe(false);
  });
});

describe("deleteAsset", () => {
  it("deletes a managed asset file", () => {
    importAssetsFromPaths(projectDir, "public", [makeSource("del.png")]);
    const result = deleteAsset(projectDir, "public", "/assets/images/del.png");
    expect(result.ok).toBe(true);
    expect(
      fs.existsSync(path.join(projectDir, "public/assets/images/del.png")),
    ).toBe(false);
  });

  it("rejects traversal paths", () => {
    const result = deleteAsset(projectDir, "public", "/../src/pages/x.png");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("rejects missing and non-managed files", () => {
    const missing = deleteAsset(
      projectDir,
      "public",
      "/assets/images/nope.png",
    );
    expect(missing.ok).toBe(false);

    importAssetsFromPaths(projectDir, "public", [makeSource("ok.png")]);
    const directory = path.join(projectDir, "public/assets/images/sub");
    fs.mkdirSync(directory, { recursive: true });
    const dirResult = deleteAsset(projectDir, "public", "/assets/images/sub");
    expect(dirResult.ok).toBe(false);

    const exe = path.join(projectDir, "public/assets/images/tool.exe");
    fs.writeFileSync(exe, "x");
    const typeResult = deleteAsset(
      projectDir,
      "public",
      "/assets/images/tool.exe",
    );
    expect(typeResult.ok).toBe(false);
    expect(typeResult.error).toContain("Not a managed asset type");
    expect(fs.existsSync(exe)).toBe(true);
  });

  it("rejects assets behind a symlink pointing outside the project", () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "zephus-assets-out-"),
    );
    try {
      // Create the images dir with a different file, then replace a target
      // with a symlink pointing outside the project.
      importAssetsFromPaths(projectDir, "public", [makeSource("host.png")]);
      fs.writeFileSync(path.join(outside, "victim.png"), "x");
      fs.rmSync(path.join(projectDir, "public/assets/images/victim.png"), {
        force: true,
      });
      fs.symlinkSync(
        path.join(outside, "victim.png"),
        path.join(projectDir, "public/assets/images/victim.png"),
      );

      const result = deleteAsset(
        projectDir,
        "public",
        "/assets/images/victim.png",
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain("escapes");
      expect(fs.existsSync(path.join(outside, "victim.png"))).toBe(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("renameAsset", () => {
  beforeEach(() => {
    importAssetsFromPaths(projectDir, "public", [makeSource("pic.png")]);
  });

  it("renames in place and keeps the extension", () => {
    const result = renameAsset(
      projectDir,
      "public",
      "/assets/images/pic.png",
      "renamed",
    );
    expect(result.ok).toBe(true);
    expect(result.webPath).toBe("/assets/images/renamed.png");
    expect(
      fs.existsSync(path.join(projectDir, "public/assets/images/pic.png")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(projectDir, "public/assets/images/renamed.png")),
    ).toBe(true);
  });

  it("preserves the original extension even when one is given", () => {
    const result = renameAsset(
      projectDir,
      "public",
      "/assets/images/pic.png",
      "other.jpg",
    );
    expect(result.ok).toBe(true);
    expect(result.webPath).toBe("/assets/images/other.png");
  });

  it("strips directory parts from the requested name", () => {
    const result = renameAsset(
      projectDir,
      "public",
      "/assets/images/pic.png",
      "../../escape/name",
    );
    expect(result.ok).toBe(true);
    expect(result.webPath).toBe("/assets/images/name.png");
  });

  it("deduplicates on collision with a numeric suffix", () => {
    fs.writeFileSync(
      path.join(projectDir, "public/assets/images/renamed.png"),
      "x",
    );
    const result = renameAsset(
      projectDir,
      "public",
      "/assets/images/pic.png",
      "renamed",
    );
    expect(result.ok).toBe(true);
    expect(result.webPath).toBe("/assets/images/renamed-1.png");
  });

  it("no-ops when the name already matches", () => {
    const result = renameAsset(
      projectDir,
      "public",
      "/assets/images/pic.png",
      "pic.png",
    );
    expect(result.ok).toBe(true);
    expect(result.webPath).toBe("/assets/images/pic.png");
  });

  it("rejects empty names", () => {
    const result = renameAsset(
      projectDir,
      "public",
      "/assets/images/pic.png",
      "   ",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Enter a file name.");
  });

  it("rejects traversal web paths", () => {
    const result = renameAsset(projectDir, "public", "/../../escape.png", "x");
    expect(result.ok).toBe(false);
  });

  it("rejects renaming a missing asset", () => {
    const result = renameAsset(
      projectDir,
      "public",
      "/assets/images/nope.png",
      "x",
    );
    expect(result.ok).toBe(false);
  });
});

describe("listProjectAssets", () => {
  it("walks nested directories and reports sizes", () => {
    fs.mkdirSync(path.join(projectDir, "public/assets/images/2024"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(projectDir, "public/assets/images/2024/hero.png"),
      "abcd",
    );
    const result = listProjectAssets(projectDir, "public");
    expect(result.ok).toBe(true);
    const entry = result.assets.find(
      (a) => a.fileName === "images/2024/hero.png",
    );
    expect(entry).toBeDefined();
    expect(entry?.size).toBe(4);
    expect(entry?.webPath).toBe("/assets/images/2024/hero.png");
  });

  it("returns an empty list when public does not exist", () => {
    const result = listProjectAssets(projectDir, "public");
    expect(result.ok).toBe(true);
    expect(result.assets).toEqual([]);
  });
});
