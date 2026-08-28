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

function packagedBinaryCandidates(platform) {
  if (platform === "darwin") {
    const nativeDir = process.arch === "arm64" ? "mac-arm64" : "mac";
    const binaryPath = (directory) =>
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
      binaryPath("mac-universal"),
      binaryPath(nativeDir),
      binaryPath("mac"),
    ];
  }
  if (platform === "win32") {
    return [path.join(ROOT, "release", "win-unpacked", "Zephus.exe")];
  }
  return [path.join(ROOT, "release", "linux-unpacked", "zephus")];
}

const binaryCandidates = packagedBinaryCandidates(process.platform);
const binary =
  binaryCandidates.find((candidate) => fs.existsSync(candidate)) ??
  binaryCandidates[0];
if (!binary || !fs.existsSync(binary)) {
  console.error(
    `✗ Packaged binary missing. Checked:\n  ${binaryCandidates.join("\n  ")}`,
  );
  console.error(
    "  Run: npx electron-builder -c electron-builder.base.yml --dir --publish never",
  );
  process.exit(1);
}

console.log(`Launching packaged binary: ${binary}`);
const env = {
  ...process.env,
  ZEPHUS_BOOT_CHECK: "1",
  NODE_ENV: "production",
};
if ("ELECTRON_RUN_AS_NODE" in env) delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(binary, noSandboxRequested ? ["--no-sandbox"] : [], {
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
  if (code === 0) {
    console.log("✓ Packaged boot check passed (renderer loaded, exit 0)");
    process.exit(0);
  }
  console.error(
    `✗ Packaged boot check failed (exit=${code} signal=${signal ?? "none"})`,
  );
  process.exit(code ?? 1);
});
