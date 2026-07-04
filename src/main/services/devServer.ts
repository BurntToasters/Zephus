import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { DevServerStartResult } from "../types";
import { readGlobalSettings } from "./settings";
import { buildSpawnEnv } from "./nodeCheck";
import { npmCommand } from "./npmCommand";

const URL_PATTERN =
  /(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/?[^\s]*)/i;
const STARTUP_TIMEOUT_MS = 60_000;
// Strips ANSI color/escape sequences. Astro/Vite still colorize their startup
// banner even with FORCE_COLOR=0, and the URL pattern's `[^\s]*` tail would
// otherwise swallow a trailing reset code (e.g. ESC[39m) into the captured
// URL — producing a malformed iframe src that 404s.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

interface RunningServer {
  projectPath: string;
  child: ChildProcess;
  url: string | null;
}

let current: RunningServer | null = null;
let starting = false;

export type DevServerLogListener = (chunk: string) => void;

function depsInstalled(projectPath: string): boolean {
  return fs.existsSync(path.join(projectPath, "node_modules"));
}

function hasDevScript(projectPath: string): boolean {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectPath, "package.json"), "utf8"),
    );
    return typeof pkg?.scripts?.dev === "string";
  } catch {
    return false;
  }
}

/**
 * Starts the project's dev server via `npm run dev`. Resolves once the server
 * reports a served URL, or rejects/returns an error on failure or timeout.
 * Reuses an already-running server for the same project.
 */
export function startDevServer(
  projectPath: string,
  onLog: DevServerLogListener,
): Promise<DevServerStartResult> {
  if (typeof projectPath !== "string" || !projectPath) {
    return Promise.resolve({
      ok: false,
      url: null,
      alreadyRunning: false,
      error: "Invalid project path.",
    });
  }
  if (current && current.projectPath === projectPath && current.url) {
    return Promise.resolve({
      ok: true,
      url: current.url,
      alreadyRunning: true,
    });
  }

  // Guard against a second start racing before the first resolves (would
  // orphan the first child process).
  if (starting) {
    return Promise.resolve({
      ok: false,
      url: null,
      alreadyRunning: true,
      error: "A preview is already starting. Please wait.",
    });
  }

  // Stop any server running for a different project to avoid orphaned processes.
  if (current && current.projectPath !== projectPath) {
    stopDevServer();
  }

  if (!hasDevScript(projectPath)) {
    return Promise.resolve({
      ok: false,
      url: null,
      alreadyRunning: false,
      error: 'The project has no "dev" script in package.json.',
    });
  }
  if (!depsInstalled(projectPath)) {
    return Promise.resolve({
      ok: false,
      url: null,
      alreadyRunning: false,
      error:
        "Project dependencies are not installed. Run npm install in the project first.",
    });
  }

  return startDevServerProcess(projectPath, onLog);
}

async function startDevServerProcess(
  projectPath: string,
  onLog: DevServerLogListener,
): Promise<DevServerStartResult> {
  const spawnEnv = await buildSpawnEnv(readGlobalSettings().customNodePath);
  starting = true;

  return new Promise<DevServerStartResult>((resolve) => {
    let settled = false;
    const finish = (r: DevServerStartResult): void => {
      if (settled) return;
      settled = true;
      starting = false;
      clearTimeout(timeout);
      resolve(r);
    };
    const npm = npmCommand(["run", "dev"], process.platform, spawnEnv);
    const child = spawn(npm.command, npm.args, {
      cwd: projectPath,
      windowsHide: true,
      // POSIX: detached makes the child its own process-group leader so we can
      // signal the whole tree (npm → astro/vite) on stop. Without this, killing
      // npm orphans the real dev server and leaves the port bound. Windows uses
      // taskkill /t to walk the tree instead, so detached stays off there
      // (detached on Windows would also pop a console window).
      detached: process.platform !== "win32",
      env: { ...spawnEnv, FORCE_COLOR: "0", NO_COLOR: "1" },
    });

    current = { projectPath, child, url: null };

    const timeout = setTimeout(() => {
      stopDevServer();
      finish({
        ok: false,
        url: null,
        alreadyRunning: false,
        error: `Dev server did not report a URL within ${STARTUP_TIMEOUT_MS / 1000}s.`,
      });
    }, STARTUP_TIMEOUT_MS);

    const handleData = (data: Buffer) => {
      const text = stripAnsi(data.toString());
      onLog(text);
      const match = text.match(URL_PATTERN);
      const url = match?.[1];
      if (url && current && !current.url) {
        current.url = url;
        finish({ ok: true, url, alreadyRunning: false });
      }
    };

    child.stdout?.on("data", handleData);
    child.stderr?.on("data", handleData);

    child.on("error", (error) => {
      log.error("Dev server failed to start", error);
      current = null;
      finish({
        ok: false,
        url: null,
        alreadyRunning: false,
        error: error.message,
      });
    });

    child.on("exit", (code) => {
      onLog(`\n[dev server exited with code ${code ?? "null"}]\n`);
      if (current && current.child === child) current = null;
      finish({
        ok: false,
        url: null,
        alreadyRunning: false,
        error: `Dev server exited before serving (code ${code ?? "null"}).`,
      });
    });
  });
}

export function stopDevServer(): void {
  starting = false;
  if (!current) return;
  const { child } = current;
  current = null;
  const pid = child.pid;

  if (process.platform === "win32") {
    // Walk and force-kill the whole process tree (npm.cmd → node → astro).
    if (pid) {
      try {
        spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
          windowsHide: true,
        });
      } catch (error) {
        log.warn("taskkill failed, falling back to child.kill", error);
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      }
    }
    return;
  }

  // POSIX: signal the process GROUP (negative pid) so the detached child and
  // every grandchild (astro/vite) die together, then escalate to SIGKILL.
  const signalGroup = (signal: NodeJS.Signals): boolean => {
    if (!pid) return false;
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      // Group kill can fail if the child isn't a group leader; fall back to
      // signalling the direct child only.
      try {
        child.kill(signal);
        return true;
      } catch {
        return false; // already exited
      }
    }
  };

  signalGroup("SIGTERM");
  setTimeout(() => {
    if (pid) {
      try {
        process.kill(-pid, 0); // throws if the whole group is already dead
        signalGroup("SIGKILL");
      } catch {
        /* already exited */
      }
    }
  }, 4000);
}
