#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createReleaseSession, verifyQualityGate } from "./release-session.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RENDERER_DIR = path.join(ROOT, "src", "renderer");
const FRONTEND_DIST = path.join(ROOT, "dist", "frontend");
const RENDERER_BUILD_ARTIFACTS = ["zephusEngine.js", "zephusEngine.js.map"];
const FLATPAK_BUILD_DIR_PREFIX = "flatpak-build";
const BUILD_DIR_FLATPAK_LEGACY = "build-dir";
const TAURI_TARGET_DIR = path.join("src-tauri", "target");
const RELEASE_BUILD_SESSION = ".build-session.json";

const CLEAN_TARGETS = {
  clean: ["dist"],
  "clean-release": ["release"],
  "clean-release-artifacts": ["release", "dist"],
  "clean-all": ["dist", "release", "flatpak-repo"],
};

const FRONTEND_RUNTIME_FILES = [
  "index.html",
  "splash.html",
  "styles.css",
  "tauriPreload.js",
  "zephusEngine.js",
];

function listFlatpakBuildDirs(cwd) {
  try {
    return fs
      .readdirSync(cwd, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        return (
          entry.name === FLATPAK_BUILD_DIR_PREFIX ||
          entry.name.startsWith(`${FLATPAK_BUILD_DIR_PREFIX}-`) ||
          entry.name === BUILD_DIR_FLATPAK_LEGACY ||
          entry.name.startsWith(`${BUILD_DIR_FLATPAK_LEGACY}-`)
        );
      })
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function listTauriBundleDirs(cwd) {
  const targetRoot = path.join(cwd, TAURI_TARGET_DIR);
  if (!fs.existsSync(targetRoot)) return [];

  const results = [];
  const addIfDir = (fullPath) => {
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        results.push(path.relative(cwd, fullPath));
      }
    } catch {}
  };

  addIfDir(path.join(targetRoot, "release", "bundle"));
  addIfDir(path.join(targetRoot, "debug", "bundle"));

  try {
    for (const entry of fs.readdirSync(targetRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const base = path.join(targetRoot, entry.name);
      addIfDir(path.join(base, "release", "bundle"));
      addIfDir(path.join(base, "debug", "bundle"));
      addIfDir(path.join(base, "bundle"));
    }
  } catch {}

  return Array.from(new Set(results));
}

function getCleanTargets(mode, cwd) {
  const baseTargets = CLEAN_TARGETS[mode];
  if (!baseTargets) {
    throw new Error(`Unknown clean mode "${mode}"`);
  }

  if (mode === "clean") {
    return Array.from(
      new Set([
        ...baseTargets,
        path.join("template-previews", "dist"),
        path.join("template-previews", ".tmp"),
        path.join("template-previews", ".dist-staging"),
        path.join("template-previews", ".dist-backup"),
        path.join(".cache", "zephus"),
        ...listFlatpakBuildDirs(cwd),
      ]),
    );
  }

  if (mode === "clean-release-artifacts") {
    return Array.from(new Set([...baseTargets, ...listTauriBundleDirs(cwd)]));
  }

  if (mode === "clean-all") {
    return Array.from(
      new Set([
        ...baseTargets,
        path.join("template-previews", "dist"),
        path.join("template-previews", ".tmp"),
        path.join(".cache", "zephus"),
        ...listFlatpakBuildDirs(cwd),
        ...listTauriBundleDirs(cwd),
      ]),
    );
  }

  return baseTargets;
}

function rmDir(relativeDir, cwd) {
  const dir = path.resolve(cwd, relativeDir);
  try {
    fs.rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 100,
    });
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw new Error(
      `Failed to clean "${relativeDir}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function cleanRendererBuildArtifacts() {
  for (const file of RENDERER_BUILD_ARTIFACTS) {
    const artifactPath = path.join(RENDERER_DIR, file);
    try {
      fs.rmSync(artifactPath, { force: true, maxRetries: 8, retryDelay: 100 });
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
    }
  }
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

function collectRelativeAssetsFromHtml(htmlPath, rendererRoot) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const assets = new Set();
  const patterns = [/\bsrc=["']([^"']+)["']/gi, /\bhref=["']([^"']+)["']/gi];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const ref = match[1];
      if (
        !ref ||
        ref.startsWith("http://") ||
        ref.startsWith("https://") ||
        ref.startsWith("data:") ||
        ref.startsWith("#") ||
        ref.startsWith("//")
      ) {
        continue;
      }
      const normalized = ref.split("?")[0].split("#")[0];
      if (normalized.includes("..") || path.isAbsolute(normalized)) continue;
      const absolute = path.resolve(rendererRoot, normalized);
      if (!absolute.startsWith(rendererRoot + path.sep)) continue;
      assets.add(
        path.relative(rendererRoot, absolute).split(path.sep).join("/"),
      );
    }
  }
  return assets;
}

function verifyRendererBundleFresh() {
  const bundle = path.join(ROOT, "src", "renderer", "zephusEngine.js");
  if (!fs.existsSync(bundle)) {
    throw new Error(
      `Renderer bundle missing: ${bundle}. Run npm run compile:renderer first.`,
    );
  }
  const bundleMtime = fs.statSync(bundle).mtimeMs;
  const newestSource = Math.max(
    ...walkFiles(RENDERER_DIR)
      .filter((f) => /\.[jt]sx?$/.test(f))
      .map((f) => fs.statSync(f).mtimeMs),
  );
  if (bundleMtime + 1000 < newestSource) {
    throw new Error(
      "Renderer bundle is STALE (newer source exists). Run npm run compile:renderer first.",
    );
  }
}

function copyRuntimeAssets() {
  verifyRendererBundleFresh();
  fs.mkdirSync(FRONTEND_DIST, { recursive: true });
  const relativeAssets = new Set(FRONTEND_RUNTIME_FILES);
  for (const htmlName of ["index.html", "splash.html"]) {
    const htmlPath = path.join(RENDERER_DIR, htmlName);
    if (fs.existsSync(htmlPath)) {
      for (const asset of collectRelativeAssetsFromHtml(
        htmlPath,
        RENDERER_DIR,
      )) {
        relativeAssets.add(asset);
      }
    }
  }
  for (const relative of relativeAssets) {
    if (relative.includes("__tests__")) continue;
    const source = path.join(RENDERER_DIR, relative);
    const destination = path.join(FRONTEND_DIST, relative);
    if (!fs.existsSync(source)) {
      if (FRONTEND_RUNTIME_FILES.includes(relative)) {
        throw new Error(`Missing runtime frontend file: ${relative}`);
      }
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  console.log(
    `  copied runtime frontend assets to ${path.relative(ROOT, FRONTEND_DIST)}`,
  );
}

function cleanDirs(mode) {
  const cwd = ROOT;
  const dirs = getCleanTargets(mode, cwd);

  if (mode === "clean-release-artifacts") {
    verifyQualityGate(cwd);
  }

  for (const relativeDir of dirs) {
    rmDir(relativeDir, cwd);
  }

  if (mode === "clean") {
    cleanRendererBuildArtifacts();
  }

  if (mode === "clean-release-artifacts") {
    const releaseDir = path.join(cwd, "release");
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(releaseDir, RELEASE_BUILD_SESSION),
      `${JSON.stringify(createReleaseSession(cwd))}\n`,
      { flag: "wx", mode: 0o600 },
    );
  }
}

const mode = process.argv[2];

if (
  mode === "clean" ||
  mode === "clean-release" ||
  mode === "clean-release-artifacts" ||
  mode === "clean-all"
) {
  cleanDirs(mode);
  process.exit(0);
}

if (mode === "copy") {
  copyRuntimeAssets();
  process.exit(0);
}

console.error(
  "Usage: node scripts/dist-tools.mjs <clean|clean-release|clean-release-artifacts|clean-all|copy>",
);
process.exit(1);
