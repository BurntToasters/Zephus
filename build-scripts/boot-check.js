#!/usr/bin/env node
/**
 * Packaged-boot check: builds the app directory and launches the packaged
 * binary with ZEPHUS_BOOT_CHECK=1, asserting it exits 0 (renderer loaded).
 * The runtime smoke suite is intentionally disabled in packaged builds, so
 * this is the gate that shipped binaries actually boot.
 */

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const isWindows = process.platform === "win32";
const isLinux = process.platform === "linux";

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (result.status !== 0) {
    console.error(`✗ ${cmd} ${args.join(" ")} exited ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

function packagedBinary(platform) {
  if (platform === "darwin") {
    return path.join(
      ROOT,
      "release",
      process.arch === "arm64" ? "mac-arm64" : "mac",
      "Zephus.app",
      "Contents",
      "MacOS",
      "Zephus",
    );
  }
  if (platform === "win32") {
    return path.join(ROOT, "release", "win-unpacked", "Zephus.exe");
  }
  return path.join(ROOT, "release", "linux-unpacked", "zephus");
}

const binary = packagedBinary(process.platform);
if (!fs.existsSync(binary)) {
  console.error(`✗ Packaged binary missing at ${binary}`);
  console.error("  Run: npx electron-builder -c electron-builder.base.yml --dir --publish never");
  process.exit(1);
}

console.log(`Launching packaged binary: ${binary}`);
const env = {
  ...process.env,
  ZEPHUS_BOOT_CHECK: "1",
  NODE_ENV: "production",
};
if ("ELECTRON_RUN_AS_NODE" in env) delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(binary, [], { env, stdio: "inherit" });
const timeoutMs = 90_000;
const timer = setTimeout(() => {
  console.error(`✗ Boot check timed out after ${timeoutMs / 1000}s`);
  child.kill("SIGKILL");
  process.exit(1);
}, timeoutMs);

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  if (code === 0) {
    console.log("✓ Packaged boot check passed (renderer loaded, exit 0)");
    process.exit(0);
  }
  console.error(
    `✗ Packaged boot check failed (exit=${code} signal=${signal ?? "none"})`,
  );
  process.exit(code ?? 1);
});
