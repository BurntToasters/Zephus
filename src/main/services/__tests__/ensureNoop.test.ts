import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createSite } from "../wizard";
import { ensureVisualSchema } from "../schema";

let tmpDir: string;
let project: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-noop-"));
  project = path.join(tmpDir, "site");
  fs.mkdirSync(project);
  const created = createSite(project, "minimal");
  expect(created.ok).toBe(true);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ensureVisualSchema no-op short-circuits", () => {
  it("does not rewrite site.json or sidecars on a second pass", () => {
    ensureVisualSchema(project, "src/pages");
    const siteFile = path.join(project, ".zephus", "site.json");
    const sidecar = path.join(project, ".zephus", "pages", "index.json");
    const siteBefore = fs.readFileSync(siteFile, "utf8");
    const sidecarBefore = fs.readFileSync(sidecar, "utf8");
    const siteMtime = fs.statSync(siteFile).mtimeMs;
    const sidecarMtime = fs.statSync(sidecar).mtimeMs;

    // Wait so a fast rewrite would produce a different mtime.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const ensured = ensureVisualSchema(project, "src/pages");
        expect(ensured.ok).toBe(true);
        expect(fs.readFileSync(siteFile, "utf8")).toBe(siteBefore);
        expect(fs.readFileSync(sidecar, "utf8")).toBe(sidecarBefore);
        expect(fs.statSync(siteFile).mtimeMs).toBe(siteMtime);
        expect(fs.statSync(sidecar).mtimeMs).toBe(sidecarMtime);
        resolve();
      }, 20);
    });
  });
});
