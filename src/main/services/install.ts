import { spawn, spawnSync, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { OperationResult } from "../types";
import { readGlobalSettings } from "./settings";
import { buildSpawnEnv, checkNodeVersion } from "./nodeCheck";
import { npmCommand } from "./npmCommand";

export type InstallLogListener = (chunk: string) => void;

let installing = false;
let activeChild: ChildProcess | null = null;
let activeInstallPromise: Promise<OperationResult> | null = null;
let activeInstallProjectPath: string | null = null;
const installLogListeners = new Set<InstallLogListener>();

function emitInstallLog(chunk: string): void {
  for (const listener of installLogListeners) {
    try {
      listener(chunk);
    } catch {
      /* listener threw — keep other subscribers alive */
    }
  }
}

// A hung `npm install` (network stall, blocked postinstall script) must not
// lock the install path forever: after this the child is killed and the lock
// released with a clear error.
const INSTALL_TIMEOUT_MS = 30 * 60 * 1000;

/** True when node_modules contains every declared dependency. */
/** Cancels a running install, killing the whole process tree. */
export function cancelInstall(): OperationResult {
  if (!activeChild || !activeChild.pid) {
    return { ok: false, error: "No install is running." };
  }
  killInstallTree(activeChild, true);
  return { ok: true };
}

type ProjectNodeModules =
  | { kind: "absent" }
  | { kind: "valid"; modulesDir: string }
  | { kind: "invalid" };

/** node_modules must be missing or a real in-project directory (never a symlink). */
function projectNodeModulesLayout(projectPath: string): ProjectNodeModules {
  const modules = path.join(projectPath, "node_modules");
  let realRoot: string;
  try {
    realRoot = fs.realpathSync.native(path.resolve(projectPath));
  } catch {
    return { kind: "invalid" };
  }
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(modules);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "absent" };
    }
    return { kind: "invalid" };
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return { kind: "invalid" };
  }
  let realModules: string;
  try {
    realModules = fs.realpathSync.native(modules);
  } catch {
    return { kind: "invalid" };
  }
  if (
    realModules !== realRoot &&
    !realModules.startsWith(realRoot + path.sep)
  ) {
    return { kind: "invalid" };
  }
  return { kind: "valid", modulesDir: modules };
}

function installLockFresh(projectPath: string, modules: string): boolean {
  const pkgPath = path.join(projectPath, "package.json");
  const lockPath = path.join(modules, ".package-lock.json");
  try {
    if (!fs.existsSync(lockPath)) return false;
    const pkgMtime = fs.statSync(pkgPath).mtimeMs;
    const lockMtime = fs.statSync(lockPath).mtimeMs;
    return lockMtime >= pkgMtime;
  } catch {
    return false;
  }
}

export function dependenciesInstalled(projectPath: string): boolean {
  const layout = projectNodeModulesLayout(projectPath);
  if (layout.kind !== "valid") return false;
  const modules = layout.modulesDir;
  const astroManifest = path.join(modules, "astro", "package.json");
  if (!fs.existsSync(astroManifest)) return false;
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectPath, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const declared = Object.keys({
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    });
    if (declared.length > 0 && !installLockFresh(projectPath, modules)) {
      return false;
    }
    return declared.every((name) =>
      fs.existsSync(path.join(modules, ...name.split("/"))),
    );
  } catch {
    return false;
  }
}

function writeInstallLockMarker(projectPath: string): void {
  const layout = projectNodeModulesLayout(projectPath);
  if (layout.kind === "invalid") return;
  const modules =
    layout.kind === "absent"
      ? path.join(projectPath, "node_modules")
      : layout.modulesDir;
  const lockPath = path.join(modules, ".package-lock.json");
  const rootLock = path.join(projectPath, "package-lock.json");
  try {
    fs.mkdirSync(modules, { recursive: true });
    if (fs.existsSync(rootLock)) {
      fs.copyFileSync(rootLock, lockPath);
    } else {
      fs.writeFileSync(lockPath, "{}\n");
    }
    const now = Date.now();
    fs.utimesSync(lockPath, now / 1000, now / 1000);
  } catch (error) {
    log.warn("Could not write install lock marker:", error);
  }
}

/** Kills npm and its whole process tree (postinstall scripts, node-gyp…), so a terminated install cannot keep writing… */
function killInstallTree(child: ChildProcess, hard: boolean): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    // NOTE: an empty-string arg (hard ? "/f" : "") made taskkill reject the
    // graceful kill with "Invalid argument/option" — and spawnSync does not
    // throw on non-zero exit, so the child.kill fallback never ran. The
    // graceful kill silently did nothing; only the /f escalation worked.
    const args = ["/pid", String(child.pid), "/t"];
    if (hard) args.push("/f");
    try {
      const result = spawnSync("taskkill", args, {
        windowsHide: true,
      });
      if (result.status !== 0 && hard) {
        // taskkill failed outright — fall back to a direct kill.
        child.kill();
      }
    } catch {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }
    return;
  }
  try {
    process.kill(-child.pid, hard ? "SIGKILL" : "SIGTERM");
  } catch {
    try {
      child.kill(hard ? "SIGKILL" : "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/** Runs `npm install` in the project, streaming output. */
export async function installDependencies(
  projectPath: string,
  onLog: InstallLogListener,
): Promise<OperationResult> {
  if (typeof projectPath !== "string" || !projectPath) {
    return { ok: false, error: "Invalid project path." };
  }
  if (installing && activeInstallPromise) {
    if (activeInstallProjectPath === projectPath) {
      installLogListeners.add(onLog);
      try {
        return await activeInstallPromise;
      } finally {
        installLogListeners.delete(onLog);
      }
    }
    return {
      ok: false,
      error: "An install is already running for another project.",
    };
  }
  if (!fs.existsSync(path.join(projectPath, "package.json"))) {
    return { ok: false, error: "No package.json found in this project." };
  }
  if (projectNodeModulesLayout(projectPath).kind === "invalid") {
    return {
      ok: false,
      error:
        "node_modules must be a directory inside this project (symlinks to other locations are not allowed). Remove or replace it before installing.",
    };
  }

  const nodeStatus = await checkNodeVersion(
    readGlobalSettings().customNodePath,
  );
  if (nodeStatus.status !== "ok") {
    return { ok: false, error: nodeStatus.message };
  }

  installLogListeners.add(onLog);
  installing = true;
  activeInstallProjectPath = projectPath;
  const env = await buildSpawnEnv(readGlobalSettings().customNodePath);
  // Surface activity immediately: without a TTY npm is silent for most of the
  // install, which left the progress box blank on first run.
  emitInstallLog("Running npm install…\n");

  activeInstallPromise = new Promise<OperationResult>((resolve) => {
    let child: ChildProcess | null = null;
    activeChild = null;
    let timeout: NodeJS.Timeout | null = null;
    let settled = false;
    let timedOut = false;
    let escalationTimer: NodeJS.Timeout | null = null;
    const finish = (result: OperationResult): void => {
      if (settled) return;
      settled = true;
      installing = false;
      activeChild = null;
      activeInstallPromise = null;
      activeInstallProjectPath = null;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };
    try {
      const npm = npmCommand(
        ["install", "--loglevel=http", "--no-fund"],
        process.platform,
        env,
        projectPath,
        nodeStatus.binaryPath,
      );
      // detached: true keeps npm's process group separate so the timeout can
      // terminate the whole install tree, not just the npm parent.
      child = spawn(npm.command, npm.args, {
        cwd: projectPath,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: npm.windowsVerbatimArguments,
        detached: process.platform !== "win32",
        env: { ...env, FORCE_COLOR: "0", NO_COLOR: "1" },
      });
      activeChild = child;
    } catch (error) {
      finish({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    timeout = setTimeout(() => {
      timedOut = true;
      emitInstallLog(
        `\n[npm install timed out after ${INSTALL_TIMEOUT_MS / 60000} minutes; terminating.]\n`,
      );
      if (child) {
        killInstallTree(child, false);
        // Keep the operation active through escalation so app shutdown/cancel
        // can still reach the child and no ignored-SIGTERM process is orphaned.
        const timedOutChild = child;
        escalationTimer = setTimeout(() => {
          const exited =
            timedOutChild.exitCode !== null &&
            timedOutChild.exitCode !== undefined;
          const signalled =
            timedOutChild.signalCode !== null &&
            timedOutChild.signalCode !== undefined;
          if (!exited && !signalled) killInstallTree(timedOutChild, true);
          finish({
            ok: false,
            error: `npm install timed out after ${INSTALL_TIMEOUT_MS / 60000} minutes.`,
          });
        }, 3000);
      } else {
        finish({
          ok: false,
          error: `npm install timed out after ${INSTALL_TIMEOUT_MS / 60000} minutes.`,
        });
      }
    }, INSTALL_TIMEOUT_MS);

    const handle = (data: Buffer) => emitInstallLog(data.toString());
    child.stdout?.on("data", handle);
    child.stderr?.on("data", handle);

    child.on("error", (error) => {
      if (escalationTimer) clearTimeout(escalationTimer);
      log.error("npm install failed to start", error);
      finish(
        timedOut
          ? {
              ok: false,
              error: `npm install timed out after ${INSTALL_TIMEOUT_MS / 60000} minutes.`,
            }
          : {
              ok: false,
              error:
                error.message.includes("ENOENT") ||
                /not found/i.test(error.message)
                  ? "Node.js / npm not found. Install Node.js or set a custom Node.js location in Settings."
                  : error.message,
            },
      );
    });

    child.on("exit", (code) => {
      if (escalationTimer) clearTimeout(escalationTimer);
      emitInstallLog(`\n[npm install exited with code ${code ?? "null"}]\n`);
      if (timedOut) {
        finish({
          ok: false,
          error: `npm install timed out after ${INSTALL_TIMEOUT_MS / 60000} minutes.`,
        });
      } else if (code === 0) {
        writeInstallLockMarker(projectPath);
        finish({ ok: true });
      } else
        finish({
          ok: false,
          error: `npm install failed (exit code ${code ?? "null"}). See the log for details.`,
        });
    });
  });
  try {
    return await activeInstallPromise;
  } finally {
    installLogListeners.delete(onLog);
  }
}
