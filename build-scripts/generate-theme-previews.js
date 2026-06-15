const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST_ROOT = path.join(ROOT, "template-previews", "dist");
const TEMP_ROOT = path.join(ROOT, "template-previews", ".tmp");
const THEMES_MODULE = path.join(ROOT, "dist", "main", "themes.js");

function ensureThemesModule() {
  if (!fs.existsSync(THEMES_MODULE)) {
    throw new Error(
      `Missing compiled themes module at ${THEMES_MODULE}. Run npm run compile:main first.`,
    );
  }

  return require(THEMES_MODULE);
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

function buildPreview(themeMeta, buildPreviewTheme, astroCli) {
  const theme = buildPreviewTheme(
    themeMeta.id,
    `zephus-preview-${themeMeta.id}`,
  );
  if (!theme) {
    throw new Error(`Could not build preview theme for ${themeMeta.id}`);
  }

  const tempDir = path.join(TEMP_ROOT, themeMeta.id);
  const outDir = path.join(DIST_ROOT, "theme", themeMeta.id);

  writeThemeFiles(theme, tempDir);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outDir), { recursive: true });

  const result = spawnSync(
    process.execPath,
    [astroCli, "build", "--root", tempDir, "--outDir", outDir],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, FORCE_COLOR: "0" },
    },
  );

  if (result.status !== 0) {
    throw new Error(`Astro build failed for ${themeMeta.id}`);
  }
}

function writeManifest(themes) {
  fs.mkdirSync(DIST_ROOT, { recursive: true });
  fs.writeFileSync(
    path.join(DIST_ROOT, "manifest.json"),
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

function main() {
  const { buildPreviewTheme, listThemes } = ensureThemesModule();
  const astroCli = path.join(
    path.dirname(require.resolve("astro/package.json")),
    "astro.js",
  );
  const themes = listThemes();

  fs.rmSync(DIST_ROOT, { recursive: true, force: true });
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEMP_ROOT, { recursive: true });

  try {
    for (const theme of themes) {
      console.log(`Generating preview: ${theme.id}`);
      buildPreview(theme, buildPreviewTheme, astroCli);
    }

    writeManifest(themes);
    console.log(`Theme previews written to ${DIST_ROOT}`);
  } finally {
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
