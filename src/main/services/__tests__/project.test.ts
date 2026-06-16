import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { validatePackage, detectAstro, listPages } from "../project";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("validatePackage", () => {
  it("returns not-ready when package.json missing", () => {
    const result = validatePackage(tmpDir);
    expect(result.exists).toBe(false);
    expect(result.ready).toBe(false);
  });

  it("returns ready for valid Astro package.json", () => {
    const pkg = {
      scripts: { dev: "astro dev", build: "astro build" },
      dependencies: { astro: "^5.0.0" },
    };
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify(pkg));
    const result = validatePackage(tmpDir);
    expect(result.exists).toBe(true);
    expect(result.parseable).toBe(true);
    expect(result.hasAstroDependency).toBe(true);
    expect(result.hasDevScript).toBe(true);
    expect(result.hasBuildScript).toBe(true);
    expect(result.ready).toBe(true);
  });

  it("detects missing dev script", () => {
    const pkg = { scripts: {}, dependencies: { astro: "^5.0.0" } };
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify(pkg));
    const result = validatePackage(tmpDir);
    expect(result.hasDevScript).toBe(false);
    expect(result.ready).toBe(false);
  });
});

describe("detectAstro", () => {
  it("detects non-astro project without config", () => {
    const result = detectAstro(tmpDir);
    expect(result.isAstro).toBe(false);
  });

  it("detects Astro project with config + dep", () => {
    fs.writeFileSync(
      path.join(tmpDir, "astro.config.mjs"),
      "export default {};",
    );
    const pkg = { dependencies: { astro: "^5.0.0" } };
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify(pkg));
    const result = detectAstro(tmpDir);
    expect(result.isAstro).toBe(true);
    expect(result.version).toBe("^5.0.0");
    expect(result.srcDir).toBe("src");
  });

  it("reads custom srcDir from config", () => {
    fs.writeFileSync(
      path.join(tmpDir, "astro.config.mjs"),
      `export default defineConfig({ srcDir: './source' });`,
    );
    const pkg = { dependencies: { astro: "^5.0.0" } };
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify(pkg));
    const result = detectAstro(tmpDir);
    expect(result.srcDir).toBe("source");
    expect(result.pagesDir).toBe(path.join("source", "pages"));
    expect(result.configReadError).toBe(false);
  });

  it("falls back when Astro config directories escape the project", () => {
    fs.writeFileSync(
      path.join(tmpDir, "astro.config.mjs"),
      `export default defineConfig({
        srcDir: '../source',
        publicDir: '/tmp/public',
        outDir: 'C:\\\\build'
      });`,
    );
    const pkg = { dependencies: { astro: "^5.0.0" } };
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify(pkg));

    const result = detectAstro(tmpDir);
    expect(result.srcDir).toBe("src");
    expect(result.pagesDir).toBe(path.join("src", "pages"));
    expect(result.publicDir).toBe("public");
    expect(result.outDir).toBe("dist");
    expect(result.configReadError).toBe(true);
  });

  it("detects Astro v6 project", () => {
    fs.writeFileSync(
      path.join(tmpDir, "astro.config.mjs"),
      "export default {};",
    );
    const pkg = { dependencies: { astro: "^6.0.0" } };
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify(pkg));
    const result = detectAstro(tmpDir);
    expect(result.isAstro).toBe(true);
    expect(result.version).toBe("^6.0.0");
  });
});

describe("listPages", () => {
  it("returns empty for non-existent pages dir", () => {
    expect(listPages(tmpDir, "src/pages")).toEqual([]);
  });

  it("lists .astro and .md pages", () => {
    const dir = path.join(tmpDir, "src", "pages");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.astro"), "");
    fs.writeFileSync(path.join(dir, "about.md"), "");
    fs.writeFileSync(path.join(dir, "style.css"), ""); // not a page
    const pages = listPages(tmpDir, "src/pages");
    expect(pages).toContain(path.join("src", "pages", "index.astro"));
    expect(pages).toContain(path.join("src", "pages", "about.md"));
    expect(pages).not.toContain(path.join("src", "pages", "style.css"));
  });

  it("does not walk pages directories outside the project", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-outside-"));
    try {
      fs.mkdirSync(path.join(outside, "pages"), { recursive: true });
      fs.writeFileSync(path.join(outside, "pages", "leak.astro"), "");
      expect(
        listPages(tmpDir, path.relative(tmpDir, path.join(outside, "pages"))),
      ).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
