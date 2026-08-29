const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PREVIEWS_ROOT = path.join(ROOT, "template-previews");
const DIST_ROOT = path.join(PREVIEWS_ROOT, "dist");
const STAGING_ROOT = path.join(PREVIEWS_ROOT, ".dist-staging");
const BACKUP_ROOT = path.join(PREVIEWS_ROOT, ".dist-backup");
const TEMP_ROOT = path.join(PREVIEWS_ROOT, ".tmp");
const THEMES_MODULE = path.join(ROOT, "dist", "main", "themes.js");
const SCHEMA_MODULE = path.join(ROOT, "dist", "main", "services", "schema.js");

function ensureModule(file, label) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing compiled ${label} at ${file}. Run npm run compile:main first.`,
    );
  }
  return require(file);
}

function writeThemeFiles(theme, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  for (const [rel, content] of Object.entries(theme.files)) {
    const full = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
}

/** Recursively rewrites root-absolute href/src in every .astro under dir. */
function rewriteAstroUrls(dir, themeId, rewrite) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteAstroUrls(full, themeId, rewrite);
    } else if (entry.isFile() && entry.name.endsWith(".astro")) {
      fs.writeFileSync(full, rewrite(fs.readFileSync(full, "utf8"), themeId));
    }
  }
}

function previewAstroConfig(themeId) {
  return `import { defineConfig } from 'astro/config';
export default defineConfig({ output: 'static', base: '/theme/${themeId}' });
`;
}

function buildPreview(themeMeta, deps, astroCli, outputRoot) {
  const { buildPreviewTheme, rewritePreviewAbsoluteUrls, ensureVisualSchema } =
    deps;
  const theme = buildPreviewTheme(
    themeMeta.id,
    `zephus-preview-${themeMeta.id}`,
  );
  if (!theme)
    throw new Error(`Could not build preview theme for ${themeMeta.id}`);

  const tempDir = path.join(TEMP_ROOT, themeMeta.id);
  const outDir = path.join(outputRoot, "theme", themeMeta.id);

  writeThemeFiles(theme, tempDir);

  // Turn the shipped schema sidecars + stubs into real pages/layout/CSS,
  // using the exact editor pipeline so previews match what users get.
  // regenerateHashlessPages is required: the scaffold stubs have hash-less
  // sidecars, so without it they are treated as out-of-sync and never
  // materialized — every preview would build as an empty shell.
  const ensured = ensureVisualSchema(
    tempDir,
    path.join("src", "pages"),
    undefined,
    {
      regenerateHashlessPages: true,
    },
  );
  if (!ensured.ok) {
    throw new Error(
      `ensureVisualSchema failed for ${themeMeta.id}: ${ensured.error ?? "unknown"}`,
    );
  }

  // Base-prefix root-absolute URLs (the preview is served under /theme/<id>).
  rewriteAstroUrls(
    path.join(tempDir, "src"),
    themeMeta.id,
    rewritePreviewAbsoluteUrls,
  );
  fs.writeFileSync(
    path.join(tempDir, "astro.config.mjs"),
    previewAstroConfig(themeMeta.id),
  );

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outDir), { recursive: true });

  const result = spawnSync(
    process.execPath,
    [astroCli, "build", "--root", tempDir, "--outDir", outDir],
    { cwd: ROOT, stdio: "inherit", env: { ...process.env, FORCE_COLOR: "0" } },
  );
  if (result.status !== 0) {
    throw new Error(`Astro build failed for ${themeMeta.id}`);
  }
}

function writeManifest(themes, outputRoot) {
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(
    path.join(outputRoot, "manifest.json"),
    JSON.stringify(
      {
        themes: themes.map(({ id, name, description, previewPath }) => ({
          id,
          name,
          description,
          previewPath,
        })),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

// Recover from an interrupted prior run and clear stale scratch dirs before
// building into a fresh staging directory. The existing dist is never touched
// here, so any build failure leaves the last-good previews in place.
function prepareWorkspace() {
  // If a previous publish was interrupted after moving dist to backup but
  // before staging landed, dist is missing while backup holds the good copy —
  // restore it.
  if (!fs.existsSync(DIST_ROOT) && fs.existsSync(BACKUP_ROOT)) {
    fs.renameSync(BACKUP_ROOT, DIST_ROOT);
  }
  // Otherwise any leftover staging/backup is stale scratch — remove it.
  fs.rmSync(STAGING_ROOT, { recursive: true, force: true });
  fs.rmSync(BACKUP_ROOT, { recursive: true, force: true });
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(STAGING_ROOT, { recursive: true });
  fs.mkdirSync(TEMP_ROOT, { recursive: true });
}

// Atomically-ish swap freshly built staging into place. Rename current dist
// aside as a backup, move staging into dist, and only drop the backup once the
// swap succeeds — rolling the backup back if the staging rename fails.
function publishStaging() {
  const hadDist = fs.existsSync(DIST_ROOT);
  if (hadDist) {
    fs.rmSync(BACKUP_ROOT, { recursive: true, force: true });
    fs.renameSync(DIST_ROOT, BACKUP_ROOT);
  }
  try {
    fs.renameSync(STAGING_ROOT, DIST_ROOT);
  } catch (error) {
    if (hadDist && fs.existsSync(BACKUP_ROOT) && !fs.existsSync(DIST_ROOT)) {
      fs.renameSync(BACKUP_ROOT, DIST_ROOT);
    }
    throw error;
  }
  fs.rmSync(BACKUP_ROOT, { recursive: true, force: true });
}

function main() {
  const themesMod = ensureModule(THEMES_MODULE, "themes module");
  const schemaMod = ensureModule(SCHEMA_MODULE, "schema module");
  const deps = {
    buildPreviewTheme: themesMod.buildPreviewTheme,
    rewritePreviewAbsoluteUrls: themesMod.rewritePreviewAbsoluteUrls,
    ensureVisualSchema: schemaMod.ensureVisualSchema,
  };
  const astroCli = path.join(
    path.dirname(require.resolve("astro/package.json")),
    require(require.resolve("astro/package.json")).bin.astro,
  );
  const themes = themesMod.listThemes();

  prepareWorkspace();

  try {
    for (const theme of themes) {
      console.log(`Generating preview: ${theme.id}`);
      buildPreview(theme, deps, astroCli, STAGING_ROOT);
    }
    writeManifest(themes, STAGING_ROOT);
    publishStaging();
    console.log(`Theme previews written to ${DIST_ROOT}`);
  } finally {
    // Always drop the temp project workspace and any failed staging output.
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
    fs.rmSync(STAGING_ROOT, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
