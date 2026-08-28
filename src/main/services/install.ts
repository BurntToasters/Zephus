import { spawn, spawnSync, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { OperationResult } from "../types";
import { readGlobalSettings } from "./settings";
import { buildSpawnEnv } from "./nodeCheck";
import { npmCommand } from "./npmCommand";

export type InstallLogListener = (chunk: string) => void;

let installing = false;
let activeChild: ChildProcess | null = null;

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

export function dependenciesInstalled(projectPath: string): boolean {
  const modules = path.join(projectPath, "node_modules");
  if (!fs.existsSync(modules)) return false;
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
    return declared.every((name) =>
      fs.existsSync(path.join(modules, ...name.split("/"))),
    );
  } catch {
    return false;
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
  if (installing) {
    return { ok: false, error: "An install is already running." };
  }
  if (!fs.existsSync(path.join(projectPath, "package.json"))) {
    return { ok: false, error: "No package.json found in this project." };
  }

  installing = true;
  const env = await buildSpawnEnv(readGlobalSettings().customNodePath);
  // Surface activity immediately: without a TTY npm is silent for most of the
  // install, which left the progress box blank on first run.
  onLog("Running npm install…\n");

  return new Promise<OperationResult>((resolve) => {
    let child: ChildProcess | null = null;
    activeChild = null;
    let timeout: NodeJS.Timeout | null = null;
    let settled = false;
    const finish = (result: OperationResult): void => {
      if (settled) return;
      settled = true;
      installing = false;
      activeChild = null;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };
    try {
      const npm = npmCommand(
        ["install", "--loglevel=http", "--no-fund"],
        process.platform,
        env,
        projectPath,
      );
      // detached: true keeps npm's process group separate so the timeout can
      // terminate the whole install tree, not just the npm parent.
      child = spawn(npm.command, npm.args, {
        cwd: projectPath,
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
      onLog(
        `\n[npm install timed out after ${INSTALL_TIMEOUT_MS / 60000} minutes; terminating.]\n`,
      );
      if (child) {
        killInstallTree(child, false);
        // Escalate: SIGTERM may be ignored by stuck postinstall scripts.
        setTimeout(() => {
          if (child && !child.killed) killInstallTree(child, true);
        }, 3000);
      }
      finish({
        ok: false,
        error: `npm install timed out after ${INSTALL_TIMEOUT_MS / 60000} minutes.`,
      });
    }, INSTALL_TIMEOUT_MS);

    const handle = (data: Buffer) => onLog(data.toString());
    child.stdout?.on("data", handle);
    child.stderr?.on("data", handle);

    child.on("error", (error) => {
      log.error("npm install failed to start", error);
      finish({
        ok: false,
        error:
          error.message.includes("ENOENT") || /not found/i.test(error.message)
            ? "Node.js / npm not found. Install Node.js or set a custom Node.js location in Settings."
            : error.message,
      });
    });

    child.on("exit", (code) => {
      onLog(`\n[npm install exited with code ${code ?? "null"}]\n`);
      if (code === 0) finish({ ok: true });
      else
        finish({
          ok: false,
          error: `npm install failed (exit code ${code ?? "null"}). See the log for details.`,
        });
    });
  });
}
