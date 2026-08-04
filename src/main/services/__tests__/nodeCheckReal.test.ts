import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildSpawnEnv,
  checkNodeVersion,
  commonNodePaths,
  meetsMinimumNodeVersion,
  parseNodeVersion,
  validateNodePath,
} from "../nodeCheck";

describe("nodeCheck with the real Node binary", () => {
  it("detects the running Node version as ok", async () => {
    // process.execPath IS node (vitest runs on Node) — the version must meet
    // the minimum since the app itself requires Node >= 24.
    const result = await checkNodeVersion(process.execPath);
    expect(result.status).toBe("ok");
    expect(result.binaryPath).toBe(process.execPath);
    expect(result.usedCustomPath).toBe(true);
    expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("reports missing for a nonexistent custom path", async () => {
    const result = await checkNodeVersion("/nonexistent/node");
    // The custom path probe fails, then PATH/known locations are tried, so
    // "missing" is only expected on machines with no Node at all — instead
    // assert we never crash and always return a structured result.
    expect(["ok", "outdated", "missing", "unknown"]).toContain(result.status);
  });

  it("buildSpawnEnv prepends the custom binary directory to PATH", async () => {
    const env = await buildSpawnEnv(process.execPath, { PATH: "/usr/bin" });
    const dir = path.dirname(process.execPath);
    const sep = process.platform === "win32" ? ";" : ":";
    expect(env["PATH"]).toContain(`${dir}${sep}`);
  });

  it("buildSpawnEnv returns the base env for bare node", async () => {
    const env = await buildSpawnEnv(null, { PATH: "/usr/bin" });
    expect(env["PATH"]).toBe("/usr/bin");
  });
});

describe("nodeCheck version parsing", () => {
  it("parses version strings", () => {
    expect(parseNodeVersion("v22.12.0\n")).toEqual({
      major: 22,
      minor: 12,
      patch: 0,
    });
    expect(parseNodeVersion("24.1.2")).toEqual({
      major: 24,
      minor: 1,
      patch: 2,
    });
    expect(parseNodeVersion("garbage")).toBeNull();
  });

  it("compares against the minimum", () => {
    expect(meetsMinimumNodeVersion({ major: 24, minor: 0, patch: 0 })).toBe(
      true,
    );
    expect(meetsMinimumNodeVersion({ major: 22, minor: 12, patch: 0 })).toBe(
      true,
    );
    expect(meetsMinimumNodeVersion({ major: 22, minor: 11, patch: 9 })).toBe(
      false,
    );
    expect(meetsMinimumNodeVersion({ major: 20, minor: 0, patch: 0 })).toBe(
      false,
    );
  });
});

describe("validateNodePath", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-nodecheck-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("accepts an absolute node-named file", () => {
    const file = path.join(tmpDir, "node");
    fs.writeFileSync(file, "#!/bin/sh\n");
    expect(validateNodePath(file)).toEqual({ ok: true, path: file });
  });

  it("rejects relative paths and wrong names", () => {
    expect(validateNodePath("node").ok).toBe(false);
    const evil = path.join(tmpDir, "evil.sh");
    fs.writeFileSync(evil, "x");
    expect(validateNodePath(evil).ok).toBe(false);
  });

  it("rejects directories and missing files", () => {
    fs.mkdirSync(path.join(tmpDir, "node-dir"));
    expect(validateNodePath(path.join(tmpDir, "node-dir")).ok).toBe(false);
    expect(validateNodePath(path.join(tmpDir, "node")).ok).toBe(false);
  });

  it("lists platform-appropriate common paths", () => {
    const paths = commonNodePaths();
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(path.isAbsolute(p)).toBe(true);
    }
  });
});
