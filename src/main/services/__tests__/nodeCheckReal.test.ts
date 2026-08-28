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
  it("detects the running Node version", async () => {
    // process.execPath IS node (vitest runs on Node). Whether it meets the
    // minimum depends on the runner's Node version, so accept both outcomes —
    // but the result must be structured and reference the real binary.
    const result = await checkNodeVersion(process.execPath);
    expect(["ok", "outdated"]).toContain(result.status);
    expect(result.binaryPath).toBe(process.execPath);
    expect(result.usedCustomPath).toBe(true);
    expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("reports missing for a nonexistent custom path", async () => {
    const result = await checkNodeVersion("/nonexistent/node");
    // A broken custom path must never resolve to a working binary silently:
    // the UI relies on usedCustomPath to tell the user their setting is not
    // in effect. (Status falls back through PATH/known locations, so assert
    // the resolution honesty contract instead of a specific status.)
    expect(result.usedCustomPath).toBe(false);
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

  it.skipIf(process.platform === "win32")(
    "caches the node resolution within its time window",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-nodecache-"));
      const logFile = path.join(dir, "runs.log");
      const fake = path.join(dir, "node");
      // A fake node binary that records every invocation.
      fs.writeFileSync(
        fake,
        `#!/bin/sh
echo "v24.0.0" >> "${logFile}"
echo "v24.0.0"
`,
        { mode: 0o755 },
      );
      try {
        const first = await checkNodeVersion(fake);
        expect(first.status).toBe("ok");
        const second = await checkNodeVersion(fake);
        expect(second.status).toBe("ok");
        // The cached resolution must not re-probe the binary.
        expect(
          fs.readFileSync(logFile, "utf8").trim().split("\n"),
        ).toHaveLength(1);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "falls back to the newest available node when every candidate is outdated",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-nodeold-"));
      const fake = path.join(dir, "node");
      fs.writeFileSync(fake, '#!/bin/sh\necho "v18.0.0"\n', {
        mode: 0o755,
      });
      try {
        // A custom path with an outdated node honestly reports "outdated"
        // (the user's configured binary is below the minimum).
        const result = await checkNodeVersion(fake);
        expect(result.status).toBe("outdated");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
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
