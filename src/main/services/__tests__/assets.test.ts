import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { listProjectImages } from "../assets";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-assets-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("listProjectImages", () => {
  it("returns image assets from nested public/images folders", () => {
    const nested = path.join(tmpDir, "public", "images", "blog");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "public", "images", "hero.png"), "x");
    fs.writeFileSync(path.join(nested, "cover.jpg"), "y");
    fs.writeFileSync(path.join(nested, "notes.txt"), "ignore");

    const result = listProjectImages(tmpDir, "public");

    expect(result.ok).toBe(true);
    expect(result.assets.map((asset) => asset.webPath)).toEqual([
      "/images/blog/cover.jpg",
      "/images/hero.png",
    ]);
  });
});
