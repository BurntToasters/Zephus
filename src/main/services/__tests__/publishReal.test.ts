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

  it("streams build output incrementally, not only after completion", async () => {
    const project = path.join(tmp, "stream");
    fs.mkdirSync(project);
    const created = createSite(project, "minimal");
    expect(created.ok).toBe(true);
    // A build script that emits two chunks with a delay in between, so a
    // chunk arriving before the promise resolves proves streaming.
    const pkgPath = path.join(project, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    pkg.scripts.build =
      "node -e \"process.stdout.write('first-chunk'); setTimeout(() => { process.stdout.write('second-chunk'); process.exit(0); }, 400)\"";
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

    const chunks: string[] = [];
    let resolved = false;
    let firstChunkBeforeResolve = false;
    const promise = buildAndReveal(project, "dist", (c) => {
      if (!chunks.length) firstChunkBeforeResolve = !resolved;
      chunks.push(c);
    });
    const result = await promise;
    resolved = true;
    expect(result.ok).toBe(true);
    expect(chunks.join("")).toContain("first-chunk");
    expect(chunks.join("")).toContain("second-chunk");
    expect(firstChunkBeforeResolve).toBe(true);
  }, 30000);

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
