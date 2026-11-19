const { spawn, spawnSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_TIMEOUT_MS = 120_000;
const TERMINATION_GRACE_MS = 4_000;
const FORCE_KILL_WAIT_MS = 1_000;

function runCommand(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runNpm(args) {
  // npm sets npm_execpath for lifecycle scripts. Invoking its JS entry through
  // Node avoids Windows' inability to exec npm.cmd directly via spawnSync.
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && path.isAbsolute(npmExecPath)) {
    runCommand(process.execPath, [npmExecPath, ...args]);
    return;
  }
  if (process.platform === "win32") {
    runCommand("cmd.exe", ["/d", "/s", "/c", `npm ${args.join(" ")}`]);
    return;
  }
  runCommand("npm", args);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function processGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

function signalPosixProcessTree(child, signal) {
  const pid = child.pid;
  if (!pid) return false;

  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      child.kill(signal);
      return true;
    } catch {
      return false;
    }
  }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) return true;
    await delay(Math.min(50, Math.max(1, deadline - Date.now())));
  }
  return !processGroupExists(pid);
}

async function terminateChildTree(child) {
  const pid = child.pid;
  if (!pid) return true;

  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
      timeout: TERMINATION_GRACE_MS,
    });
    if (
      result.status === 0 ||
      result.status === 128 ||
      child.exitCode !== null
    ) {
      return true;
    }

    try {
      child.kill("SIGKILL");
    } catch {
      // The direct process has already exited, but its tree was not verified.
    }
    return false;
  }

  if (!processGroupExists(pid)) return true;
  signalPosixProcessTree(child, "SIGTERM");
  if (await waitForProcessGroupExit(pid, TERMINATION_GRACE_MS)) return true;

  console.error(
    "Zephus process tree did not stop after SIGTERM; sending SIGKILL.",
  );
  signalPosixProcessTree(child, "SIGKILL");
  return waitForProcessGroupExit(pid, FORCE_KILL_WAIT_MS);
}

function debugBinary() {
  const name = process.platform === "win32" ? "zephus.exe" : "zephus";
  return path.join(ROOT, "src-tauri", "target", "debug", name);
}

function waitForVite() {
  const deadline = Date.now() + 30_000;
  const attempt = () =>
    new Promise((resolve) => {
      const req = http.get("http://localhost:5173/", (res) => {
        res.resume();
        resolve(Boolean(res.statusCode && res.statusCode < 500));
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });
  return (async () => {
    while (Date.now() < deadline) {
      if (await attempt()) return;
      await delay(200);
    }
    throw new Error("Vite dev server did not start on localhost:5173.");
  })();
}

async function runRuntimeSmoke(skipCompile = false) {
  if (!skipCompile) {
    runNpm(["run", "compile"]);
  }

  // The production bundle strips the smoke harness (editorSmoke stub);
  // this run needs it, so re-bundle the renderer with --smoke. ~1s.
  runNpm(["run", "compile:renderer", "--", "--smoke"]);
  runCommand(process.execPath, [
    path.join(ROOT, "scripts", "dist-tools.mjs"),
    "copy",
  ]);

  const binary = debugBinary();
  runCommand("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml"]);
  if (!fs.existsSync(binary)) {
    console.error(`Tauri debug binary missing after cargo build: ${binary}`);
    process.exit(1);
  }

  const viteBin = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
  const vite = spawn(process.execPath, [viteBin], {
    cwd: ROOT,
    stdio: "ignore",
    env: process.env,
    windowsHide: true,
  });
  await waitForVite();

  const env = {
    ...process.env,
    ZEPHUS_SMOKE: "1",
  };

  // Proof artifacts from a smoke run land under artifacts/smoke/<repo-sha>/ in
  // the Zephus repo (copied in main.ts before the temp scaffold is deleted).
  const child = spawn(binary, [], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "inherit"],
    env,
    windowsHide: false,
  });

  const timeoutMs = positiveNumber(
    process.env.ZEPHUS_SMOKE_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
  );
  let shutdownPromise = null;
  let completionReceived = false;

  const removeSignalHandlers = () => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };

  const finish = (exitCode, message, terminateTree) => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      clearTimeout(timeout);
      if (message) console.error(message);
      if (vite.pid && !vite.killed) {
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/pid", String(vite.pid), "/t", "/f"], {
            windowsHide: true,
            stdio: "ignore",
          });
        }
        try {
          vite.kill("SIGKILL");
        } catch {
          // Vite already exited.
        }
      }
      const cleanupSucceeded =
        !terminateTree || (await terminateChildTree(child));
      if (!cleanupSucceeded) {
        console.error("Zephus process-tree cleanup could not be verified.");
      }
      removeSignalHandlers();
      process.exitCode = cleanupSucceeded ? exitCode : 1;
    })().catch((error) => {
      console.error("Failed to clean up Zephus runtime smoke:", error);
      removeSignalHandlers();
      process.exitCode = 1;
    });
    return shutdownPromise;
  };

  const onSigint = () => {
    void finish(130, "Runtime smoke interrupted; stopping Zephus.", true);
  };
  const onSigterm = () => {
    void finish(143, "Runtime smoke terminated; stopping Zephus.", true);
  };

  // Keep handlers installed until cleanup settles. Repeated signals join the
  // same idempotent shutdown instead of bypassing it and orphaning Electron.
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  const timeout = setTimeout(() => {
    void finish(
      1,
      `Runtime smoke timed out after ${timeoutMs}ms; stopping Zephus.`,
      true,
    );
  }, timeoutMs);

  child.once("error", (error) => {
    void finish(1, `Failed to start Zephus runtime smoke: ${error}`, true);
  });

  let smokeBuffer = "";
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    smokeBuffer += text;
    process.stdout.write(text);
    const match = smokeBuffer.match(/ZEPHUS_SMOKE_COMPLETE exit=(\d+)/);
    if (!match) return;
    completionReceived = true;
    void finish(Number(match[1]), undefined, true);
  });

  child.once("close", (code, signal) => {
    const message = signal
      ? `Runtime smoke terminated by signal: ${signal}`
      : completionReceived
        ? undefined
        : `Runtime smoke exited with code ${code ?? "null"} before reporting completion.`;
    // A zero exit is not success unless the authenticated child IPC channel
    // first delivered the renderer-check result.
    void finish(completionReceived && !signal ? (code ?? 1) : 1, message, true);
  });
}

const skipCompile = process.argv.includes("--skip-compile");
runRuntimeSmoke(skipCompile);
