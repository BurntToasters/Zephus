import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  evaluateNodeVersionOutput,
  meetsMinimumNodeVersion,
  parseNodeVersion,
  validateNodePath,
} from "../nodeCheck";
import { npmCommand } from "../npmCommand";

describe("nodeCheck", () => {
  describe("validateNodePath", () => {
    it("rejects non-strings, empty, and relative paths", () => {
      expect(validateNodePath(null).ok).toBe(false);
      expect(validateNodePath("").ok).toBe(false);
      expect(validateNodePath("   ").ok).toBe(false);
      expect(validateNodePath("node").ok).toBe(false);
      expect(validateNodePath("./node").ok).toBe(false);
    });

    it("rejects an absolute path whose basename is not node/node.exe", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-node-"));
      const evil = path.join(dir, "evil.sh");
      fs.writeFileSync(evil, "#!/bin/sh\n");
      try {
        expect(validateNodePath(evil).ok).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("rejects a node-named path that does not exist or is a directory", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-node-"));
      try {
        expect(validateNodePath(path.join(dir, "node")).ok).toBe(false);
        fs.mkdirSync(path.join(dir, "subdir-node"));
        // A directory literally named "node".
        const nodeDir = path.join(dir, "node-dir", "node");
        fs.mkdirSync(nodeDir, { recursive: true });
        expect(validateNodePath(nodeDir).ok).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("accepts an absolute file named node", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-node-"));
      const good = path.join(dir, "node");
      fs.writeFileSync(good, "#!/bin/sh\n");
      try {
        const result = validateNodePath(good);
        expect(result.ok).toBe(true);
        expect(result.path).toBe(good);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("parseNodeVersion", () => {
    it("parses standard `node --version` output", () => {
      expect(parseNodeVersion("v22.12.0\n")).toEqual({
        major: 22,
        minor: 12,
        patch: 0,
      });
    });

    it("parses without a leading v", () => {
      expect(parseNodeVersion("24.15.0")).toEqual({
        major: 24,
        minor: 15,
        patch: 0,
      });
    });

    it("returns null for unparseable output", () => {
      expect(parseNodeVersion("not a version")).toBeNull();
      expect(parseNodeVersion("")).toBeNull();
    });
  });

  describe("meetsMinimumNodeVersion", () => {
    it("accepts the exact minimum and newer", () => {
      expect(meetsMinimumNodeVersion({ major: 22, minor: 12, patch: 0 })).toBe(
        true,
      );
      expect(meetsMinimumNodeVersion({ major: 22, minor: 12, patch: 5 })).toBe(
        true,
      );
      expect(meetsMinimumNodeVersion({ major: 22, minor: 20, patch: 0 })).toBe(
        true,
      );
      expect(meetsMinimumNodeVersion({ major: 24, minor: 0, patch: 0 })).toBe(
        true,
      );
    });

    it("rejects versions below the minimum", () => {
      expect(meetsMinimumNodeVersion({ major: 22, minor: 11, patch: 9 })).toBe(
        false,
      );
      expect(meetsMinimumNodeVersion({ major: 20, minor: 18, patch: 0 })).toBe(
        false,
      );
      expect(meetsMinimumNodeVersion({ major: 18, minor: 20, patch: 0 })).toBe(
        false,
      );
    });
  });

  describe("evaluateNodeVersionOutput", () => {
    it("returns ok for a supported version", () => {
      const result = evaluateNodeVersionOutput("v22.12.0");
      expect(result.status).toBe("ok");
      expect(result.version).toBe("22.12.0");
    });

    it("returns outdated for an unsupported version", () => {
      const result = evaluateNodeVersionOutput("v20.18.0");
      expect(result.status).toBe("outdated");
      expect(result.version).toBe("20.18.0");
      expect(result.message).toContain("22.12.0");
    });

    it("returns unknown for unparseable output", () => {
      const result = evaluateNodeVersionOutput("garbage");
      expect(result.status).toBe("unknown");
      expect(result.version).toBeNull();
    });
  });
});

describe("npmCommand", () => {
  it("runs npm directly on Unix-like platforms", () => {
    expect(npmCommand(["install"], "darwin")).toEqual({
      command: "npm",
      args: ["install"],
    });
  });

  it("routes npm.cmd through cmd.exe on Windows", () => {
    expect(npmCommand(["run", "dev"], "win32")).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", "run", "dev"],
    });
  });
});
