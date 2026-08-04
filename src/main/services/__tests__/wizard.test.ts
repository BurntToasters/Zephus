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

  it("rolls back written files when scaffolding fails mid-way", () => {
    const target = path.join(tmpDir, "rollback");
    fs.mkdirSync(target);
    // A file where a directory is needed forces a write failure mid-scaffold.
    fs.writeFileSync(path.join(target, "public"), "blocking file");

    const result = createSite(target, "minimal");

    expect(result.ok).toBe(false);
    // Nothing may be left behind claiming to be a Zephus project.
    expect(fs.existsSync(path.join(target, ".zephus"))).toBe(false);
    expect(fs.existsSync(path.join(target, "package.json"))).toBe(false);
    // The blocking file itself is untouched.
    expect(fs.readFileSync(path.join(target, "public"), "utf8")).toBe(
      "blocking file",
    );
  });
});
