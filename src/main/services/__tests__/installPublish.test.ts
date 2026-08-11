import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { dependenciesInstalled, cancelInstall } from "../install";
import { buildAndReveal } from "../publish";

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

  it("returns true when every dependency exists", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-dep-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ dependencies: { astro: "^6.0.0" } }),
      );
      fs.mkdirSync(path.join(tmp, "node_modules", "astro"), {
        recursive: true,
      });
      expect(dependenciesInstalled(tmp)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("cancel with nothing running reports failure", async () => {
    const result = cancelInstall();
    expect(result.ok).toBe(false);
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
