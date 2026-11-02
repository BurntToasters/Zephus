import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { dependenciesInstalled, cancelInstall } from "../install";
import { buildAndReveal } from "../publish";
import { npmCommand, resolveNpmCliJs } from "../npmCommand";

describe("install dependency detection", () => {
  it("returns false without node_modules", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-dep-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ dependencies: { astro: "^6.0.0" } }),
      );
      expect(dependenciesInstalled(tmp)).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns false for a partial node_modules", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-dep-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({
          dependencies: { astro: "^6.0.0", react: "^19.0.0" },
        }),
      );
      fs.mkdirSync(path.join(tmp, "node_modules", "astro"), {
        recursive: true,
      });
      // react is missing — a partial install must NOT count as installed.
      expect(dependenciesInstalled(tmp)).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns false when node_modules is a symlink outside the project", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-dep-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-dep-out-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ dependencies: { astro: "^6.0.0" } }),
      );
      const astroDir = path.join(outside, "astro");
      fs.mkdirSync(astroDir, { recursive: true });
      fs.writeFileSync(
        path.join(astroDir, "package.json"),
        JSON.stringify({ name: "astro" }),
      );
      fs.symlinkSync(outside, path.join(tmp, "node_modules"), "dir");
      expect(dependenciesInstalled(tmp)).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("returns true when every dependency exists", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-dep-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ dependencies: { astro: "^6.0.0" } }),
      );
      const astroDir = path.join(tmp, "node_modules", "astro");
      fs.mkdirSync(astroDir, { recursive: true });
      fs.writeFileSync(
        path.join(astroDir, "package.json"),
        JSON.stringify({ name: "astro" }),
      );
      const lockPath = path.join(tmp, "node_modules", ".package-lock.json");
      fs.writeFileSync(lockPath, "{}");
      const pkgMtime = fs.statSync(path.join(tmp, "package.json")).mtime;
      fs.utimesSync(lockPath, pkgMtime, new Date(pkgMtime.getTime() + 1000));
      expect(dependenciesInstalled(tmp)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("cancel with nothing running reports failure", async () => {
    const result = cancelInstall();
    expect(result.ok).toBe(false);
  });

  it("refuses install when node_modules symlinks outside the project", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-dep-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-dep-out-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ name: "t", private: true }),
      );
      fs.symlinkSync(outside, path.join(tmp, "node_modules"), "dir");
      const { installDependencies } = await import("../install");
      const result = await installDependencies(tmp, () => undefined);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/node_modules/i);
      expect(fs.existsSync(path.join(outside, ".package-lock.json"))).toBe(
        false,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("fails cleanly on a project without package.json", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-dep-"));
    try {
      const { installDependencies } = await import("../install");
      const result = await installDependencies(tmp, () => undefined);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("package.json");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("publish fails cleanly without a package.json", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-pub-"));
    try {
      const result = await buildAndReveal(tmp, "dist");
      expect(result.ok).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("npmCommand custom Node.js", () => {
  it("throws instead of falling back when npm-cli.js is missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-node-"));
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin, { recursive: true });
    const nodeBin = path.join(bin, "node");
    fs.writeFileSync(nodeBin, "");
    try {
      expect(resolveNpmCliJs(nodeBin, "darwin")).toBeNull();
      expect(() =>
        npmCommand(["install"], "darwin", process.env, undefined, nodeBin),
      ).toThrow(/npm-cli\.js/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked npm-cli.js", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-node-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-node-out-"));
    const bin = path.join(root, "bin");
    const lib = path.join(root, "lib", "node_modules", "npm", "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(lib, { recursive: true });
    const nodeBin = path.join(bin, "node");
    fs.writeFileSync(nodeBin, "");
    fs.writeFileSync(path.join(outside, "npm-cli.js"), "// evil");
    fs.symlinkSync(
      path.join(outside, "npm-cli.js"),
      path.join(lib, "npm-cli.js"),
    );
    try {
      expect(resolveNpmCliJs(nodeBin, "darwin")).toBeNull();
      expect(() =>
        npmCommand(["install"], "darwin", process.env, undefined, nodeBin),
      ).toThrow(/npm-cli\.js/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("accepts a regular npm-cli.js inside the Node install", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-node-"));
    const bin = path.join(root, "bin");
    const lib = path.join(root, "lib", "node_modules", "npm", "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(lib, { recursive: true });
    const nodeBin = path.join(bin, "node");
    fs.writeFileSync(nodeBin, "");
    const cli = path.join(lib, "npm-cli.js");
    fs.writeFileSync(cli, "// npm");
    try {
      expect(
        npmCommand(["install"], "darwin", process.env, undefined, nodeBin),
      ).toEqual({
        command: nodeBin,
        args: [path.normalize(cli), "install"],
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
