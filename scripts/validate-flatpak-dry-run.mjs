#!/usr/bin/env node
/**
 * Flatpak packaging dry-run: verify Zephus Flatpak metadata exists for CI.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { hasExactReleaseVersion } from "./update-metainfo.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "run.rosie.zephus.metainfo.xml",
  "run.rosie.zephus.yml",
  "run.rosie.zephus.desktop",
  "src-tauri/linux/desktop-template.hbs",
  "scripts/prepare-flatpak-source.mjs",
];

let failed = false;
function fail(message) {
  console.error(`flatpak-dry-run: ${message}`);
  failed = true;
}

for (const rel of required) {
  if (!fs.existsSync(path.join(root, rel))) fail(`missing ${rel}`);
}

const sourceExporter = path.join(root, "scripts", "prepare-flatpak-source.mjs");
if (fs.existsSync(sourceExporter)) {
  const source = fs.readFileSync(sourceExporter, "utf8");
  for (const marker of [
    "git",
    "archive",
    "--porcelain=v1",
    ".zephus-source-commit",
    "src-tauri/gen/schemas/",
  ]) {
    if (!source.includes(marker)) fail(`source exporter missing ${marker}`);
  }
  if (source.includes("ffmpeg") || source.includes("yt-dlp")) {
    fail("Zephus Flatpak source export must not fetch media sidecars");
  }
}

const manifest = path.join(root, "run.rosie.zephus.yml");
if (fs.existsSync(manifest)) {
  const yaml = fs.readFileSync(manifest, "utf8");
  if (!/runtime-version:\s*['"]50['"]/.test(yaml)) {
    fail("run.rosie.zephus.yml must use org.gnome runtime 50");
  }
  if (!yaml.includes("app-id: run.rosie.zephus")) {
    fail("run.rosie.zephus.yml app-id must be run.rosie.zephus");
  }
  if (!yaml.includes("path: .flatpak-source")) {
    fail("build source must be a clean commit export");
  }
  if (!yaml.includes("npm ci") || !yaml.includes("--share=network")) {
    fail("sideload build must fetch integrity-locked dependencies explicitly");
  }
  if (
    !yaml.includes("npm@12 --") ||
    !yaml.includes("--before=") ||
    !yaml.includes("3 days ago")
  ) {
    fail(
      "node24 SDK npm 11 must be upgraded to newest npm 12 with a 3-day --before age gate before npm ci",
    );
  }
  if (!yaml.includes("tauri build --no-bundle -- --locked")) {
    fail("Cargo build must enforce Cargo.lock");
  }
  if (!yaml.includes('install -Dm755 "$node_bin" /app/bin/node')) {
    fail("Flatpak must install Node on PATH for the editor backend");
  }
  if (
    !yaml.includes("dest=/app/lib/Zephus") ||
    !yaml.includes("node scripts/stage-backend-resources.mjs") ||
    !yaml.includes('test -f "$dest/dist/main/main.js"') ||
    !yaml.includes('test -f "$dest/node_modules/entities/package.json"')
  ) {
    fail("Flatpak must install the Node backend under /app/lib/Zephus");
  }
  if (yaml.includes("electron") || yaml.includes("ZEPHUS_LINUX_UNPACKED_DIR")) {
    fail("Flatpak must not package the Electron linux-unpacked tree");
  }
  if (yaml.includes("yt-dlp") || yaml.includes("ffmpeg")) {
    fail("Flatpak must not install ROSI media sidecars");
  }
}

const metainfo = path.join(root, "run.rosie.zephus.metainfo.xml");
if (fs.existsSync(metainfo)) {
  const xml = fs.readFileSync(metainfo, "utf8");
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  if (!hasExactReleaseVersion(xml, pkg.version)) {
    fail(`metainfo needs an exact release version="${pkg.version}" attribute`);
  }
  for (const requiredMarkup of [
    '<component type="desktop-application">',
    "<id>run.rosie.zephus</id>",
    '<launchable type="desktop-id">run.rosie.zephus.desktop</launchable>',
  ]) {
    if (!xml.includes(requiredMarkup))
      fail(`metainfo missing ${requiredMarkup}`);
  }
}

function runValidator(command, args) {
  const probe = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (probe.error?.code === "ENOENT") {
    console.log(`flatpak-dry-run: ${command} unavailable; static checks only`);
    return;
  }
  if (probe.error || probe.status !== 0) {
    fail(
      `${command} validation failed:\n${probe.stderr || probe.stdout || probe.error?.message}`,
    );
  }
}

runValidator("appstreamcli", [
  "validate",
  "--no-net",
  "run.rosie.zephus.metainfo.xml",
]);
runValidator("desktop-file-validate", ["run.rosie.zephus.desktop"]);

if (failed) process.exit(1);
console.log("flatpak-dry-run: ok");
