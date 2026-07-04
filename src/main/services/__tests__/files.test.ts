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
  it("rejects reading .env and .git files", () => {
    fs.writeFileSync(path.join(tmpDir, ".env"), "SECRET=1");
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".git", "config"), "[core]");

    const env = readProjectFile(tmpDir, ".env");
    expect(env.ok).toBe(false);
    const envLocal = (() => {
      fs.writeFileSync(path.join(tmpDir, ".env.local"), "X=1");
      return readProjectFile(tmpDir, ".env.local");
    })();
    expect(envLocal.ok).toBe(false);
    const gitCfg = readProjectFile(tmpDir, ".git/config");
    expect(gitCfg.ok).toBe(false);
  });
});

describe("writeProjectFile", () => {
  it("rejects writing .env and .git files", () => {
    const env = writeProjectFile(tmpDir, ".env", "SECRET=1");
    expect(env.ok).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".env"))).toBe(false);
    const gitCfg = writeProjectFile(tmpDir, ".git/hooks/pre-commit", "x");
    expect(gitCfg.ok).toBe(false);
  });

  it("rejects executable and package-runner writes", () => {
    for (const rel of [
      "npm.cmd",
      "sub/npx.cmd",
      "node.exe",
      "scripts/run.ps1",
      "scripts/run.bat",
      "scripts/tool.exe",
    ]) {
      const result = writeProjectFile(tmpDir, rel, "x");
      expect(result.ok).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, rel))).toBe(false);
    }
  });

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
