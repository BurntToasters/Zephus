import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeFileAtomic, readJsonSafe } from "../fsSafe";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-fssafe-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("writes content and leaves no temp files behind", () => {
    const file = path.join(dir, "nested", "out.json");
    writeFileAtomic(file, '{"a":1}');
    expect(fs.readFileSync(file, "utf8")).toBe('{"a":1}');
    const leftovers = fs
      .readdirSync(path.dirname(file))
      .filter((f) => f.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });

  it("overwrites existing content", () => {
    const file = path.join(dir, "out.txt");
    writeFileAtomic(file, "first");
    writeFileAtomic(file, "second");
    expect(fs.readFileSync(file, "utf8")).toBe("second");
  });
});

describe("readJsonSafe", () => {
  it("returns null/!corrupt for an absent file", () => {
    const r = readJsonSafe(path.join(dir, "missing.json"));
    expect(r.data).toBeNull();
    expect(r.corrupt).toBe(false);
  });

  it("parses valid JSON", () => {
    const file = path.join(dir, "ok.json");
    fs.writeFileSync(file, '{"x":42}');
    const r = readJsonSafe<{ x: number }>(file);
    expect(r.corrupt).toBe(false);
    expect(r.data?.x).toBe(42);
  });

  it("backs up corrupt JSON instead of returning it", () => {
    const file = path.join(dir, "bad.json");
    fs.writeFileSync(file, "{ not json ");
    const r = readJsonSafe(file);
    expect(r.data).toBeNull();
    expect(r.corrupt).toBe(true);
    const backups = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("bad.json.corrupt-"));
    expect(backups.length).toBe(1);
    // Original is preserved (not deleted).
    expect(fs.existsSync(file)).toBe(true);
  });
});
