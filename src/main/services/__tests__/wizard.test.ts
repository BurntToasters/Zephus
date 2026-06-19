import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createSite } from "../wizard";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-wizard-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createSite", () => {
  it("refuses to scaffold into a non-empty folder", () => {
    const target = path.join(tmpDir, "existing");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "package.json"), "keep");

    const result = createSite(target, "minimal");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("empty folder");
    expect(fs.readFileSync(path.join(target, "package.json"), "utf8")).toBe(
      "keep",
    );
  });

  it("scaffolds into an empty folder", () => {
    const target = path.join(tmpDir, "empty");
    fs.mkdirSync(target);

    const result = createSite(target, "minimal");

    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(target, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(target, ".zephus", "site.json"))).toBe(true);
  });
});
