import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  writeFileAtomic,
  readJsonSafe,
  safeResolve,
  assertRealpathInside,
} from "../fsSafe";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-fssafe-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("safeResolve", () => {
  it("rejects traversal outside the root", () => {
    expect(() => safeResolve(dir, "../escape.txt")).toThrow(
      "escapes the project directory",
    );
    expect(() => safeResolve(dir, "/absolute/path.txt")).toThrow(
      "escapes the project directory",
    );
  });

  it("resolves in-root paths", () => {
    expect(safeResolve(dir, "a/b.txt")).toBe(path.join(dir, "a", "b.txt"));
    expect(safeResolve(dir, ".")).toBe(dir);
  });
});

describe("assertRealpathInside", () => {
  it("accepts a target that does not exist yet (walk-up)", () => {
    const target = path.join(dir, "new", "dir", "file.txt");
    const result = assertRealpathInside(dir, target);
    expect(result.realRoot).toBe(fs.realpathSync.native(dir));
    expect(fs.existsSync(result.realTarget)).toBe(true);
  });

  it("throws when the project root itself does not exist", () => {
    const missing = path.join(dir, "no-such-root");
    // The realpath probe throws ENOENT — still an error, never a pass.
    expect(() =>
      assertRealpathInside(missing, path.join(missing, "x")),
    ).toThrow();
  });

  it("throws when a symlink resolves outside the root", () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "zephus-fssafe-out-"),
    );
    try {
      const link = path.join(dir, "in-root");
      fs.symlinkSync(outside, link, "dir");
      expect(() => assertRealpathInside(dir, path.join(link, "file"))).toThrow(
        "escapes the project directory",
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
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

  it("still reports corrupt when the backup cannot be written", () => {
    // A corrupt file that is readable but whose directory refuses the backup
    // copy must still surface corrupt:true instead of crashing.
    if (process.getuid?.() === 0) return; // root ignores permissions
    const file = path.join(dir, "locked.json");
    fs.writeFileSync(file, "{ broken ");
    fs.chmodSync(file, 0o444);
    fs.chmodSync(dir, 0o555);
    try {
      const r = readJsonSafe(file);
      expect(r.corrupt).toBe(true);
      expect(r.data).toBeNull();
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });
});
