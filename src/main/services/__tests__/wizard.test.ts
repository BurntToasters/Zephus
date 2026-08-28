import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createSite, createPage } from "../wizard";
import { ensureVisualSchema } from "../schema";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-wizard-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createSite", () => {
  it("refuses to scaffold into a non-empty folder", () => {
    const target = path.join(tmpDir, "existing");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "package.json"), "keep");

    const result = createSite(target, "minimal");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("empty folder");
    expect(fs.readFileSync(path.join(target, "package.json"), "utf8")).toBe(
      "keep",
    );
  });

  it("scaffolds into an empty folder", () => {
    const target = path.join(tmpDir, "empty");
    fs.mkdirSync(target);

    const result = createSite(target, "minimal");

    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(target, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(target, ".zephus", "site.json"))).toBe(true);
  });

  it("rolls back written files when scaffolding fails mid-way", () => {
    const target = path.join(tmpDir, "rollback");
    fs.mkdirSync(target);
    // A file where a directory is needed forces a write failure mid-scaffold.
    fs.writeFileSync(path.join(target, "public"), "blocking file");

    const result = createSite(target, "minimal");

    expect(result.ok).toBe(false);
    // Nothing may be left behind claiming to be a Zephus project.
    expect(fs.existsSync(path.join(target, ".zephus"))).toBe(false);
    expect(fs.existsSync(path.join(target, "package.json"))).toBe(false);
    // The blocking file itself is untouched.
    expect(fs.readFileSync(path.join(target, "public"), "utf8")).toBe(
      "blocking file",
    );
  });

  it("rejects an unknown theme id", () => {
    const target = path.join(tmpDir, "unknown");
    fs.mkdirSync(target);
    const result = createSite(target, "no-such-theme");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown theme");
    expect(fs.readdirSync(target)).toHaveLength(0);
  });

  it("leaves a pre-existing .zephus dir alone when scaffolding fails", () => {
    const target = path.join(tmpDir, "keep-zephus");
    fs.mkdirSync(path.join(target, ".zephus"), { recursive: true });
    fs.writeFileSync(path.join(target, ".zephus", "marker.txt"), "keep me");
    fs.writeFileSync(path.join(target, "public"), "blocking file");

    const result = createSite(target, "minimal");
    expect(result.ok).toBe(false);
    // The pre-existing marker must survive the rollback.
    expect(
      fs.readFileSync(path.join(target, ".zephus", "marker.txt"), "utf8"),
    ).toBe("keep me");
  });

  it("sanitizes the folder name into the package name", () => {
    const target = path.join(tmpDir, "My Ünïque Site!");
    fs.mkdirSync(target);
    const result = createSite(target, "minimal");
    expect(result.ok).toBe(true);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(target, "package.json"), "utf8"),
    );
    expect(pkg.name).toMatch(/^[a-z0-9-]+$/);
  });

  it("createPage delegates to the managed page creator", () => {
    const target = path.join(tmpDir, "delegated");
    fs.mkdirSync(target);
    expect(createSite(target, "minimal").ok).toBe(true);
    ensureVisualSchema(target, "src/pages");
    const created = createPage(target, "Delegated", "src/pages");
    expect(created.ok).toBe(true);
    expect(
      fs.existsSync(path.join(target, "src", "pages", "delegated.astro")),
    ).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "rolls back cleanly when the target cannot be created",
    () => {
      // A read-only parent makes mkdirSync throw inside the scaffold's try
      // block — the rollback must run without crashing.
      if (process.getuid?.() === 0) return; // root ignores permissions
      const parent = path.join(tmpDir, "ro");
      fs.mkdirSync(parent);
      fs.chmodSync(parent, 0o555);
      try {
        const result = createSite(path.join(parent, "site"), "minimal");
        expect(result.ok).toBe(false);
        expect(result.error).toContain("EACCES");
        expect(fs.existsSync(path.join(parent, "site"))).toBe(false);
      } finally {
        fs.chmodSync(parent, 0o755);
      }
    },
  );

  it("rolls back everything when schema initialization fails", () => {
    const target = path.join(tmpDir, "schema-fail");
    fs.mkdirSync(target);
    // A corrupt site.json makes ensureVisualSchema return an error mid-scaffold
    // (exercising the explicit failure path, not just thrown exceptions).
    fs.mkdirSync(path.join(target, ".zephus"), { recursive: true });
    fs.writeFileSync(path.join(target, ".zephus", "site.json"), "{ not json");

    const result = createSite(target, "minimal");
    expect(result.ok).toBe(false);
    // The pre-existing .zephus dir is kept (it was there before), but the
    // partially written theme files must be gone.
    expect(fs.existsSync(path.join(target, "package.json"))).toBe(false);
    expect(fs.existsSync(path.join(target, "astro.config.mjs"))).toBe(false);
  });
});
