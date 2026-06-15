import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { DevServerStartResult } from "../types";
import { readGlobalSettings } from "./settings";
import { buildSpawnEnv } from "./nodeCheck";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const URL_PATTERN =
  /(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/?[^\s]*)/i;
const STARTUP_TIMEOUT_MS = 60_000;

interface RunningServer {
  projectPath: string;
  child: ChildProcess;
  url: string | null;
}

let current: RunningServer | null = null;

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
  if (current && current.projectPath === projectPath && current.url) {
    return Promise.resolve({
      ok: true,
      url: current.url,
      alreadyRunning: true,
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

  return new Promise<DevServerStartResult>((resolve) => {
    let settled = false;
    const child = spawn(npmCmd, ["run", "dev"], {
      cwd: projectPath,
      windowsHide: true,
      env: { ...spawnEnv, FORCE_COLOR: "0" },
    });

    current = { projectPath, child, url: null };

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      stopDevServer();
      resolve({
        ok: false,
        url: null,
        alreadyRunning: false,
        error: `Dev server did not report a URL within ${STARTUP_TIMEOUT_MS / 1000}s.`,
      });
    }, STARTUP_TIMEOUT_MS);

    const handleData = (data: Buffer) => {
      const text = data.toString();
      onLog(text);
      const match = text.match(URL_PATTERN);
      const url = match?.[1];
      if (url && current && !current.url) {
        current.url = url;
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve({ ok: true, url, alreadyRunning: false });
        }
      }
    };

    child.stdout?.on("data", handleData);
    child.stderr?.on("data", handleData);

    child.on("error", (error) => {
      log.error("Dev server failed to start", error);
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      current = null;
      resolve({
        ok: false,
        url: null,
        alreadyRunning: false,
        error: error.message,
      });
    });

    child.on("exit", (code) => {
      onLog(`\n[dev server exited with code ${code ?? "null"}]\n`);
      if (current && current.child === child) current = null;
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({
          ok: false,
          url: null,
          alreadyRunning: false,
          error: `Dev server exited before serving (code ${code ?? "null"}).`,
        });
      }
    });
  });
}

export function stopDevServer(): void {
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
    }
  } catch (error) {
    log.warn("Failed to stop dev server cleanly", error);
  }
}
