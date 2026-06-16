import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ensureVisualSchema,
  readSiteDocument,
  writeSiteDocument,
} from "../schema";

let tmpDir: string;
const pagesDir = path.join("src", "pages");

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-cssinj-"));
  fs.mkdirSync(path.join(tmpDir, "src", "layouts"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "src", "pages"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "public", "styles"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, "package.json"),
    JSON.stringify({
      scripts: { dev: "astro dev", build: "astro build" },
      dependencies: { astro: "^6.0.0" },
    }),
  );
  fs.writeFileSync(path.join(tmpDir, "astro.config.mjs"), "export default {};");
  fs.writeFileSync(
    path.join(tmpDir, "src", "layouts", "BaseLayout.astro"),
    `---\nconst { title = 'Site' } = Astro.props;\n---\n<html><body><nav></nav><main><slot /></main></body></html>`,
  );
  fs.writeFileSync(
    path.join(tmpDir, "public", "styles", "global.css"),
    "body{}",
  );
  fs.writeFileSync(
    path.join(tmpDir, "src", "pages", "index.astro"),
    `---\nimport BaseLayout from '../layouts/BaseLayout.astro';\ntitle: "Home"\n---\n<BaseLayout title="Home"><h1>Hi</h1></BaseLayout>\n`,
  );
  fs.mkdirSync(path.join(tmpDir, ".zephus"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, ".zephus", "settings.json"),
    JSON.stringify({ schemaVersion: 1, editorRules: {}, theme: "project" }),
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("design token CSS injection", () => {
  it("strips declaration/rule-breaking chars from design tokens", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    const site = readSiteDocument(tmpDir);
    expect(site.ok).toBe(true);
    writeSiteDocument(
      tmpDir,
      {
        ...site.site!,
        design: {
          ...site.site!.design,
          accent: "red; } body { display: none } /*",
          fontImportUrl: "https://evil.example.com/x.css",
        },
        shell: { ...site.site!.shell, layoutMode: "managed" },
      },
      pagesDir,
    );

    const css = fs.readFileSync(
      path.join(tmpDir, "public", "styles", "zephus-managed.css"),
      "utf8",
    );
    // The injected closing brace / extra rule must not appear in the :root value.
    const rootBlock = css.slice(0, css.indexOf("}") + 1);
    expect(rootBlock).not.toContain("display: none");
    expect(css).not.toContain("body { display: none }");

    const layout = fs.readFileSync(
      path.join(tmpDir, "src", "layouts", "BaseLayout.astro"),
      "utf8",
    );
    // Non-Google font URL must be rejected (not injected into <head>).
    expect(layout).not.toContain("evil.example.com");
  });
});
