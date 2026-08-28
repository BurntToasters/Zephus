import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  installDependencies,
  cancelInstall,
  dependenciesInstalled,
} from "../install";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-install-real-"));

function writeProject(pkg: Record<string, unknown>): string {
  const dir = path.join(tmp, `p-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "t", private: true, ...pkg }),
  );
  return dir;
}

describe("installDependencies (real npm)", () => {
  it("runs a real install and reports ok", async () => {
    const dir = writeProject({ scripts: {} });
    try {
      const logs: string[] = [];
      const result = await installDependencies(dir, (c) => logs.push(c));
      expect(result.ok).toBe(true);
      expect(logs.join("")).toContain("npm install");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("cancels a running install via cancelInstall", async () => {
    if (process.platform === "win32") return;
    const dir = writeProject({
      scripts: { postinstall: "sleep 30" },
    });
    try {
      // Start an install that will hang in postinstall for 30s.
      const pending = installDependencies(dir, () => undefined);
      // Give npm a moment to start, then cancel.
      await new Promise((r) => setTimeout(r, 800));
      const cancel = cancelInstall();
      expect(cancel.ok).toBe(true);
      const result = await pending;
      expect(result.ok).toBe(false);
      // Cancel must not leave the lock held.
      const second = cancelInstall();
      expect(second.ok).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("dependenciesInstalled respects the dependency set", async () => {
    const dir = writeProject({ dependencies: { nope: "1.0.0" } });
    try {
      // No node_modules at all.
      expect(dependenciesInstalled(dir)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("install failure paths", () => {
  it("reports a failing postinstall as an install error", async () => {
    if (process.platform === "win32") return;
    const dir = writeProject({
      scripts: { postinstall: "exit 1" },
    });
    try {
      const logs: string[] = [];
      const result = await installDependencies(dir, (c) => logs.push(c));
      expect(result.ok).toBe(false);
      expect(logs.join("")).toContain("npm install exited with code");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("rejects a second concurrent install", async () => {
    if (process.platform === "win32") return;
    const dir = writeProject({
      scripts: { postinstall: "sleep 10" },
    });
    try {
      const first = installDependencies(dir, () => undefined);
      await new Promise((r) => setTimeout(r, 500));
      const second = await installDependencies(dir, () => undefined);
      expect(second.ok).toBe(false);
      expect(second.error).toContain("already running");
      cancelInstall();
      await first;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});

describe("install spawn failure", () => {
  it("reports ENOENT when npm cannot be found", async () => {
    if (process.platform === "win32") return;
    const dir = writeProject({ scripts: {} });
    const realPath = process.env.PATH;
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-empty-path-"));
    try {
      process.env.PATH = empty;
      const result = await installDependencies(dir, () => undefined);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not found|ENOENT/i);
    } finally {
      process.env.PATH = realPath;
      fs.rmSync(empty, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
