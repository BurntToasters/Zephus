import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createSite } from "../wizard";
import {
  ensureVisualSchema,
  readSiteDocument,
  writeSiteDocument,
} from "../schema";

let tmpDir: string;
let project: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-cssv-"));
  project = path.join(tmpDir, "site");
  fs.mkdirSync(project);
  const created = createSite(project, "minimal");
  expect(created.ok).toBe(true);
  ensureVisualSchema(project, "src/pages");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("managed styles", () => {
  it("preserves var() and calc() design tokens in the managed CSS", () => {
    const site = readSiteDocument(project);
    const saved = writeSiteDocument(
      project,
      {
        ...site.site,
        design: {
          ...site.site.design,
          accent: "var(--brand-color)",
          radius: "calc(4px + 2px)",
        },
      },
      "src/pages",
    );
    expect(saved.ok).toBe(true);
    const css = fs.readFileSync(
      path.join(project, "public", "styles", "zephus-managed.css"),
      "utf8",
    );
    expect(css).toContain("--zephus-accent: var(--brand-color)");
    expect(css).toContain("--zephus-radius: calc(4px + 2px)");
  });

  it("strips CSS-injection characters from design tokens", () => {
    const site = readSiteDocument(project);
    const saved = writeSiteDocument(
      project,
      {
        ...site.site,
        design: {
          ...site.site.design,
          accent: "red;} body { display: none",
        },
      },
      "src/pages",
    );
    expect(saved.ok).toBe(true);
    const css = fs.readFileSync(
      path.join(project, "public", "styles", "zephus-managed.css"),
      "utf8",
    );
    // The breakout characters must be neutralized: the accent declaration
    // must be a single clean declaration — the only ";" is the terminator at
    // the very end, and no "}" survives (the "display: none" fragment can
    // only persist as harmless text inside the value).
    const accentLine = css.match(/--zephus-accent: [^\n]+/)?.[0] ?? "";
    expect(accentLine.endsWith(";")).toBe(true);
    expect(accentLine.slice(0, -1)).not.toContain(";");
    expect(accentLine).not.toContain("}");
  });
});
