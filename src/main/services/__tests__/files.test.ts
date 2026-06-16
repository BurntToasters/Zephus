import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { readProjectFile, writeProjectFile } from "../files";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-files-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("readProjectFile", () => {
  it("reads a file inside the project", () => {
    fs.writeFileSync(path.join(tmpDir, "hello.txt"), "world");
    const result = readProjectFile(tmpDir, "hello.txt");
    expect(result.ok).toBe(true);
    expect(result.content).toBe("world");
  });

  it("rejects path traversal", () => {
    const result = readProjectFile(tmpDir, "../../../etc/passwd");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("escapes");
  });

  it("returns error for missing file", () => {
    const result = readProjectFile(tmpDir, "nope.txt");
    expect(result.ok).toBe(false);
  });

  it("rejects symlink escapes", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
      fs.symlinkSync(outside, path.join(tmpDir, "linked"), "dir");

      const result = readProjectFile(tmpDir, "linked/secret.txt");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("escapes");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("writeProjectFile", () => {
  it("writes a file inside the project", () => {
    const result = writeProjectFile(tmpDir, "sub/dir/file.txt", "data");
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, "sub/dir/file.txt"), "utf8")).toBe(
      "data",
    );
  });

  it("rejects path traversal", () => {
    const result = writeProjectFile(tmpDir, "../../bad.txt", "x");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("escapes");
  });

  it("rejects writes through symlink escapes", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-outside-"));
    try {
      fs.symlinkSync(outside, path.join(tmpDir, "linked"), "dir");

      const result = writeProjectFile(tmpDir, "linked/created.txt", "x");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("escapes");
      expect(fs.existsSync(path.join(outside, "created.txt"))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
