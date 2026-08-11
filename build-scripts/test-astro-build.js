#!/usr/bin/env node
/**
 * Full-pipeline Astro build check: scaffolds every bundled theme, generates
 * the managed schema, and runs a REAL `astro build` on each site. Slower than
 * the unit-level compiler check (astroBuild.test.ts) but proves the generated
 * pages actually build and render with Astro's full toolchain.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const ASTRON = path.join(ROOT, "node_modules", ".bin", "astro");

async function main() {
  const wizard = await import(path.join(ROOT, "dist", "main", "services", "wizard.js"));
  const schema = await import(path.join(ROOT, "dist", "main", "services", "schema.js"));
  const themes = await import(path.join(ROOT, "dist", "main", "themes.js"));

  let failures = 0;
  for (const theme of themes.listThemes()) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `zephus-theme-${theme.id}-`));
    const project = path.join(tmp, "site");
    fs.mkdirSync(project, { recursive: true });
    try {
      const created = wizard.createSite(project, theme.id);
      if (!created.ok) {
        console.error(`✖ ${theme.id}: scaffold failed: ${created.error}`);
        failures += 1;
        continue;
      }
      // Give the scaffolded site access to the repo's astro/vite toolchain.
      fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(project, "node_modules"), "dir");
      const ensured = schema.ensureVisualSchema(project, "src/pages");
      if (!ensured.ok) {
        throw new Error("ensureVisualSchema failed: " + (ensured.error ?? "unknown"));
      }
      execFileSync(ASTRON, ["build", "--silent"], {
        cwd: project,
        encoding: "utf8",
        timeout: 300000,
        env: { ...process.env, NO_COLOR: "1" },
        stdio: "pipe",
      });
      const pages = fs
        .readdirSync(path.join(project, "src", "pages"))
        .filter((f) => f.endsWith(".astro")).length;
      if (pages === 0) {
        throw new Error("build produced no pages");
      }
      console.log(`✓ ${theme.id.padEnd(14)} builds (${pages} page${pages === 1 ? "" : "s"})`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`✖ ${theme.id}: build failed:\n${msg.slice(0, 1200)}`);
      failures += 1;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  if (failures > 0) {
    console.error(`\n${failures} theme build(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll themes build successfully.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
