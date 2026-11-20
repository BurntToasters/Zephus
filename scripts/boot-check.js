#!/usr/bin/env node
/** Packaged-boot check: builds the app directory and launches the packaged binary with ZEPHUS_BOOT_CHECK=1, asserting it… */

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const isWindows = process.platform === "win32";
const isLinux = process.platform === "linux";
const noSandboxRequested = process.argv.includes("--no-sandbox");

if (noSandboxRequested && (!isLinux || process.env.CI !== "true")) {
  console.error("--no-sandbox is allowed only for Linux CI boot checks.");
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (result.status !== 0) {
    console.error(`✗ ${cmd} ${args.join(" ")} exited ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

function tauriReleaseBinary(triple, fileName) {
  const parts = [ROOT, "src-tauri", "target"];
  if (triple) parts.push(triple);
  parts.push("release", fileName);
  return path.join(...parts);
}

function packagedBinaryCandidates(platform) {
  if (platform === "darwin") {
    const appBinary = (triple) =>
      path.join(
        ROOT,
        "src-tauri",
        "target",
        triple,
        "release",
        "bundle",
        "macos",
        "Zephus.app",
        "Contents",
        "MacOS",
        "zephus",
      );
    const nativeDir = process.arch === "arm64" ? "mac-arm64" : "mac";
    const electronBinary = (directory) =>
      path.join(
        ROOT,
        "release",
        directory,
        "Zephus.app",
        "Contents",
        "MacOS",
        "Zephus",
      );
    // Universal --dir builds use mac-universal; retain native fallbacks for
    // the architecture-specific CI and local developer builds.
    return [
      appBinary("aarch64-apple-darwin"),
      appBinary("x86_64-apple-darwin"),
      electronBinary("mac-universal"),
      electronBinary(nativeDir),
      electronBinary("mac"),
    ];
  }
  if (platform === "win32") {
    return [
      tauriReleaseBinary(null, "zephus.exe"),
      tauriReleaseBinary("x86_64-pc-windows-msvc", "zephus.exe"),
      tauriReleaseBinary("aarch64-pc-windows-msvc", "zephus.exe"),
      path.join(ROOT, "release", "win-unpacked", "Zephus.exe"),
    ];
  }
  return [
    tauriReleaseBinary(null, "zephus"),
    tauriReleaseBinary("x86_64-unknown-linux-gnu", "zephus"),
    tauriReleaseBinary("aarch64-unknown-linux-gnu", "zephus"),
    path.join(ROOT, "release", "linux-unpacked", "zephus"),
  ];
}

const binaryCandidates = packagedBinaryCandidates(process.platform);
const found =
  binaryCandidates.find((candidate) => fs.existsSync(candidate)) ?? null;
if (!found) {
  console.error(
    `✗ Packaged binary missing. Checked:\n  ${binaryCandidates.join("\n  ")}`,
  );
  console.error("  Run: npm run tauri:build");
  process.exit(1);
}

const RESOURCE_NAMES = [
  "dist",
  "src",
  "template-previews",
  "node_modules",
  "licenses.json",
  "package.json",
];

function cargoCheckoutBinary(binary) {
  const windows = binary.replace(/\//g, "\\").toLowerCase();
  if (process.platform === "win32") {
    return (
      windows.includes("\\target\\debug\\") ||
      windows.includes("\\target\\release\\")
    );
  }
  if (process.platform === "linux") {
    const unix = binary.replace(/\\/g, "/");
    return unix.includes("/target/debug/") || unix.includes("/target/release/");
  }
  return false;
}

let stagedRoot = null;

function stagePackagedLayout(binary) {
  // target\release is a checkout build. Copy the exe and the resources Tauri
  // placed beside it so the shell takes the packaged resource path.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-boot-"));
  stagedRoot = stage;
  const sourceDir = path.dirname(binary);
  fs.copyFileSync(binary, path.join(stage, path.basename(binary)));
  for (const name of RESOURCE_NAMES) {
    const from = path.join(sourceDir, name);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(stage, name), { recursive: true });
  }
  const mainJs = path.join(stage, "dist", "main", "main.js");
  if (!fs.existsSync(mainJs)) {
    console.error(`✗ Staged packaged layout is missing ${mainJs}`);
    process.exit(1);
  }
  return path.join(stage, path.basename(binary));
}

function appLogPath() {
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || "",
      "run.rosie.zephus",
      "logs",
      "zephus.log",
    );
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "run.rosie.zephus",
      "logs",
      "zephus.log",
    );
  }
  const base =
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "run.rosie.zephus", "logs", "zephus.log");
}

function expectedBackendRoot(binary) {
  if (process.platform === "darwin") {
    return path.resolve(path.dirname(binary), "..", "Resources");
  }
  const installedLib = path.resolve(
    path.dirname(binary),
    "..",
    "lib",
    "Zephus",
  );
  if (process.platform === "linux" && fs.existsSync(installedLib)) {
    return installedLib;
  }
  return path.dirname(binary);
}

const binary = cargoCheckoutBinary(found) ? stagePackagedLayout(found) : found;
const backendRoot = expectedBackendRoot(binary);

// electron-builder applies fuses after Electron's upstream signature. On
// macOS, intentionally unsigned CI packages are then killed by the kernel as
// Code Signature Invalid before JS starts. Ad-hoc sign ONLY when signing
// discovery was explicitly disabled; real release signatures are never
// replaced by this check.
if (
  process.platform === "darwin" &&
  process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false"
) {
  const appBundle = path.resolve(path.dirname(binary), "..", "..");
  console.log(`Ad-hoc signing unsigned smoke package: ${appBundle}`);
  run("codesign", ["--force", "--deep", "--sign", "-", appBundle]);
  run("codesign", ["--verify", "--deep", "--strict", appBundle]);
}

console.log(`Launching packaged binary: ${binary}`);
const logPath = appLogPath();
const logStart = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
const env = {
  ...process.env,
  ZEPHUS_BOOT_CHECK: "1",
  NODE_ENV: "production",
};
if ("ELECTRON_RUN_AS_NODE" in env) delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(binary, [], {
  env,
  stdio: "inherit",
});
const timeoutMs = 90_000;
const timer = setTimeout(() => {
  console.error(`✗ Boot check timed out after ${timeoutMs / 1000}s`);
  child.kill("SIGKILL");
  process.exit(1);
}, timeoutMs);

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  let fresh = "";
  if (fs.existsSync(logPath)) {
    const bytes = fs.readFileSync(logPath);
    const start = bytes.length >= logStart ? logStart : 0;
    fresh = bytes.subarray(start).toString("utf8");
  }
  const haystack = fresh.toLowerCase().replace(/\//g, "\\");
  const backendReady =
    haystack.includes("node backend ready") &&
    haystack.includes(backendRoot.toLowerCase().replace(/\//g, "\\"));
  if (code === 0 && backendReady) {
    if (stagedRoot) {
      fs.rmSync(stagedRoot, { recursive: true, force: true });
    }
    console.log(
      "✓ Packaged boot check passed (renderer loaded, Node backend started, exit 0)",
    );
    process.exit(0);
  }
  if (code === 0 && !backendReady) {
    const ready = fresh
      .split(/\r?\n/)
      .filter((line) => line.toLowerCase().includes("node backend ready"));
    console.error(
      "✗ Packaged boot exited 0 without starting the Node backend from the packaged resources.",
    );
    console.error(`  expected root: ${backendRoot}`);
    if (ready.length === 0) {
      console.error("  log has no Node backend ready line");
    } else {
      for (const line of ready) console.error(`  ${line}`);
    }
    process.exit(1);
  }
  console.error(
    `✗ Packaged boot check failed (exit=${code} signal=${signal ?? "none"})`,
  );
  process.exit(code ?? 1);
});
