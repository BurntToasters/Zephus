const fs = require("fs");
const path = require("path");

const FLATPAK_BUILD_DIR_PREFIX = "build-dir";
// Resolve everything against the repo root (this script's directory), never
// the caller's cwd: `node build-scripts/dist-tools.js clean` from a foreign
// directory must not delete that directory's dist/release folders.
const ROOT = path.resolve(__dirname, "..");
const RENDERER_DIR = path.join(ROOT, "src", "renderer");
const RENDERER_BUILD_ARTIFACTS = ["zephusEngine.js", "zephusEngine.js.map"];

function listFlatpakBuildDirs() {
  try {
    return fs
      .readdirSync(ROOT, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          (entry.name === FLATPAK_BUILD_DIR_PREFIX ||
            entry.name.startsWith(`${FLATPAK_BUILD_DIR_PREFIX}-`)),
      )
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function cleanBuildArtifacts() {
  const dirs = [
    path.join(ROOT, "dist"),
    path.join(ROOT, "template-previews", "dist"),
    path.join(ROOT, "template-previews", ".tmp"),
    path.join(ROOT, "template-previews", ".dist-staging"),
    path.join(ROOT, "template-previews", ".dist-backup"),
    path.join(ROOT, ".cache", "zephus"),
    ...listFlatpakBuildDirs().map((dir) => path.join(ROOT, dir)),
  ];
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 100,
      });
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
    }
  }

  // Remove bundled renderer output.
  for (const file of RENDERER_BUILD_ARTIFACTS) {
    const artifactPath = path.join(RENDERER_DIR, file);
    try {
      fs.rmSync(artifactPath, { force: true, maxRetries: 8, retryDelay: 100 });
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
    }
  }
}

function cleanReleaseArtifacts() {
  const dirs = [path.join(ROOT, "release")];
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 100,
      });
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
    }
  }
}

function copyRuntimeAssets() {
  // Everything renderer is referenced in place from src/renderer, so the
  // copy is a no-op — BUT zephusEngine.js is a gitignored build artifact in
  // src/. electron-builder globs it silently; a missing or stale bundle
  // packages an app whose script 404s (blank window) with zero errors.
  // Verify it exists and is newer than the newest renderer source.
  const bundle = path.join(ROOT, "src", "renderer", "zephusEngine.js");
  if (!fs.existsSync(bundle)) {
    throw new Error(
      "Renderer bundle missing: " +
        bundle +
        ". Run npm run compile:renderer first.",
    );
  }
  const bundleMtime = fs.statSync(bundle).mtimeMs;
  const rendererDir = path.join(ROOT, "src", "renderer");
  const newestSource = Math.max(
    ...walkFiles(rendererDir)
      .filter((f) => /\.[jt]sx?$/.test(f))
      .map((f) => fs.statSync(f).mtimeMs),
  );
  if (bundleMtime + 1000 < newestSource) {
    throw new Error(
      "Renderer bundle is STALE (newer source exists). Run npm run compile:renderer first.",
    );
  }
  console.log(
    "  copy step verified (renderer bundle fresh, files referenced in-place)",
  );
}

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

const mode = process.argv[2];

if (mode === "clean") {
  cleanBuildArtifacts();
  process.exit(0);
}

if (mode === "clean-release") {
  cleanReleaseArtifacts();
  process.exit(0);
}

if (mode === "copy") {
  copyRuntimeAssets();
  process.exit(0);
}

console.error(
  "Usage: node build-scripts/dist-tools.js <clean|clean-release|copy>",
);
process.exit(1);
