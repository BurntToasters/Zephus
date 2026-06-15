const fs = require("fs");
const path = require("path");

const FLATPAK_BUILD_DIR_PREFIX = "build-dir";
const RENDERER_DIR = path.join("src", "renderer");
const RENDERER_BUILD_ARTIFACTS = ["zephusEngine.js", "zephusEngine.js.map"];

function listFlatpakBuildDirs() {
  try {
    return fs
      .readdirSync(".", { withFileTypes: true })
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
    "dist",
    "template-previews/dist",
    "template-previews/.tmp",
    ...listFlatpakBuildDirs(),
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
  const dirs = ["release"];
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
  console.log(
    "  copy step complete (renderer files referenced in-place from src/)",
  );
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
