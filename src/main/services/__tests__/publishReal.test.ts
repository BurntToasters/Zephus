import { describe, it, expect, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createSite } from "../wizard";
import { ensureVisualSchema } from "../schema";
import { buildAndReveal } from "../publish";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-publish-real-"));
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("buildAndReveal (real npm build)", () => {
  it("builds a scaffolded site and reports the output dir", async () => {
    const project = path.join(tmp, "site");
    fs.mkdirSync(project);
    const created = createSite(project, "minimal");
    expect(created.ok).toBe(true);
    const ensured = ensureVisualSchema(project, "src/pages");
    expect(ensured.ok).toBe(true);
    // Give the scaffolded site the repo's toolchain.
    fs.symlinkSync(
      path.join(ROOT, "node_modules"),
      path.join(project, "node_modules"),
      "dir",
    );
    const logs: string[] = [];
    const result = await buildAndReveal(project, "dist", (c) => logs.push(c));
    expect(result.ok).toBe(true);
    expect(result.outputDir).toBe(path.join(project, "dist"));
    expect(logs.join("").length).toBeGreaterThan(0);
    // The output folder must contain built HTML.
    const hasHtml = fs
      .readdirSync(path.join(project, "dist"), { recursive: true })
      .some((f) => String(f).endsWith(".html"));
    expect(hasHtml).toBe(true);
  }, 120000);

  it("fails cleanly when the project has no package.json", async () => {
    const bare = path.join(tmp, "bare");
    fs.mkdirSync(bare);
    const result = await buildAndReveal(bare, "dist");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("rejects a second concurrent build", async () => {
    const project = path.join(tmp, "site2");
    fs.mkdirSync(project);
    const created = createSite(project, "minimal");
    expect(created.ok).toBe(true);
    const first = buildAndReveal(project, "dist");
    const second = await buildAndReveal(project, "dist");
    expect(second.ok).toBe(false);
    expect(second.error).toContain("already running");
    await first;
  }, 120000);
});
