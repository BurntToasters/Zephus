const { spawn, spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const electronBinary = require("electron");
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
    if (result.status === 0) return true;

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
    "Electron process tree did not stop after SIGTERM; sending SIGKILL.",
  );
  signalPosixProcessTree(child, "SIGKILL");
  return waitForProcessGroupExit(pid, FORCE_KILL_WAIT_MS);
}

function isSmokeCompletionMessage(message) {
  return (
    message !== null &&
    typeof message === "object" &&
    message.type === "zephus-smoke-complete" &&
    Number.isInteger(message.exitCode) &&
    (message.exitCode === 0 || message.exitCode === 1)
  );
}

function runRuntimeSmoke(skipCompile = false) {
  if (!skipCompile) {
    runNpm(["run", "compile"]);
  }

  const noSandboxRequested = process.argv.includes("--no-sandbox");
  if (
    noSandboxRequested &&
    (process.platform !== "linux" || process.env.CI !== "true")
  ) {
    console.error("--no-sandbox is allowed only for Linux CI smoke runs.");
    process.exit(1);
  }
  const smokeArgs = [
    ...(noSandboxRequested ? ["--no-sandbox"] : []),
    ".",
    "--dev",
    "--smoke",
  ];
  const env = {
    ...process.env,
    ZEPHUS_SMOKE: "1",
    NODE_ENV: "development",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  };
  if ("ELECTRON_RUN_AS_NODE" in env) {
    delete env.ELECTRON_RUN_AS_NODE;
  }

  // The IPC completion message lets the launcher terminate the tree while the
  // root PID is still alive (required for reliable taskkill /t on Windows).
  // A detached POSIX process group provides equivalent whole-tree ownership.
  const child = spawn(electronBinary, smokeArgs, {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env,
    detached: process.platform !== "win32",
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
      const cleanupSucceeded =
        !terminateTree || (await terminateChildTree(child));
      if (!cleanupSucceeded) {
        console.error("Electron process-tree cleanup could not be verified.");
      }
      removeSignalHandlers();
      process.exitCode = cleanupSucceeded ? exitCode : 1;
    })().catch((error) => {
      console.error("Failed to clean up Electron runtime smoke:", error);
      removeSignalHandlers();
      process.exitCode = 1;
    });
    return shutdownPromise;
  };

  const onSigint = () => {
    void finish(130, "Runtime smoke interrupted; stopping Electron.", true);
  };
  const onSigterm = () => {
    void finish(143, "Runtime smoke terminated; stopping Electron.", true);
  };

  // Keep handlers installed until cleanup settles. Repeated signals join the
  // same idempotent shutdown instead of bypassing it and orphaning Electron.
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  const timeout = setTimeout(() => {
    void finish(
      1,
      `Runtime smoke timed out after ${timeoutMs}ms; stopping Electron.`,
      true,
    );
  }, timeoutMs);

  child.once("error", (error) => {
    void finish(1, `Failed to start Electron runtime smoke: ${error}`, true);
  });

  child.on("message", (message) => {
    if (!isSmokeCompletionMessage(message)) return;
    completionReceived = true;
    void finish(message.exitCode, undefined, true);
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
