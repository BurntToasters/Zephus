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
    const npm = npmCommand(["run", "dev"]);
    const child = spawn(npm.command, npm.args, {
      cwd: projectPath,
      windowsHide: true,
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
  try {
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
      });
    } else {
      child.kill("SIGTERM");
      // Escalate if it ignores SIGTERM.
      const pid = child.pid;
      setTimeout(() => {
        try {
          if (pid) process.kill(pid, 0); // throws if already dead
          child.kill("SIGKILL");
        } catch {
          /* already exited */
        }
      }, 4000);
    }
  } catch (error) {
    log.warn("Failed to stop dev server cleanly", error);
  }
}
