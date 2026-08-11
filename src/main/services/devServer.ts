import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { DevServerStartResult } from "../types";
import { readGlobalSettings } from "./settings";
import { buildSpawnEnv } from "./nodeCheck";
import { npmCommand } from "./npmCommand";

// Matches a server URL line like "Local: http://localhost:4321/". The URL is
// anchored so trailing punctuation (")", ",", ";") is not swallowed, and the
// match is restricted to localhost/loopback hosts the preview window accepts.
const URL_PATTERN =
  /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/?[^\s)\]}.,;]*/i;
const STARTUP_TIMEOUT_MS = 60_000;
// Strips ANSI color/escape sequences. Astro/Vite still colorize their startup
// banner even with FORCE_COLOR=0, and an un-stripped reset code (e.g. ESC[39m)
// could end up adjacent to a captured URL.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/**
 * Incremental URL finder: URLs (and ANSI sequences) can be split across
 * stdout chunk boundaries, so the tail of each chunk is buffered before
 * matching. Kept pure so the chunking logic is unit-testable.
 */
export class DevServerUrlScanner {
  private buffer = "";
  private readonly maxBuffer: number;

  constructor(maxBuffer = 512) {
    this.maxBuffer = maxBuffer;
  }

  /** Feeds a raw chunk; returns the first server URL seen, or null. */
  push(chunk: string): string | null {
    this.buffer = (this.buffer + stripAnsi(chunk)).slice(-this.maxBuffer);
    const match = this.buffer.match(URL_PATTERN);
    if (!match || match.index === undefined) return null;
    // A URL ending exactly at the buffer edge (no path separator) may be a
    // truncated port/path split across chunks — wait for the next chunk to
    // confirm before reporting it.
    const after = this.buffer[match.index + match[0].length];
    if (after === undefined && !match[0].endsWith("/")) return null;
    return match[0];
  }

  /** The port of the most recent URL seen in the buffered output, if any. */
  pendingPort(): number | null {
    const global = new RegExp(URL_PATTERN.source, URL_PATTERN.flags + "g");
    const matches = [...this.buffer.matchAll(global)];
    const last = matches[matches.length - 1];
    const port = last?.[0].match(/:(\d+)/)?.[1];
    return port ? Number(port) : null;
  }
}

interface RunningServer {
  projectPath: string;
  child: ChildProcess;
  url: string | null;
}

let current: RunningServer | null = null;
// Set synchronously BEFORE any await so two rapid starts cannot both pass the
// guard (install.ts follows the same pattern).
let starting = false;
// Incremented by stopDevServer: an in-flight start that completes after a
// stop must not spawn (the user asked to stop, so the server would be
// orphaned with no UI bound to it).
let stopEpoch = 0;

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
  // orphan the first child process). Set synchronously — see startDevServerProcess.
  if (starting) {
    return Promise.resolve({
      ok: false,
      url: null,
      alreadyRunning: false,
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

  // Synchronous: no await between the guard and this flag (a TOCTOU window
  // here would let two children spawn).
  starting = true;
  return startDevServerProcess(projectPath, onLog);
}

async function startDevServerProcess(
  projectPath: string,
  onLog: DevServerLogListener,
): Promise<DevServerStartResult> {
  const epoch = stopEpoch;
  try {
    const spawnEnv = await buildSpawnEnv(readGlobalSettings().customNodePath);

    return new Promise<DevServerStartResult>((resolve) => {
      let settled = false;
      // Declared up front: finish() can run before the timeout is assigned
      // (synchronous spawn failure below) — the TDZ crash would otherwise
      // reject the promise with the wrong shape.
      let timeout: NodeJS.Timeout | null = null;
      const finish = (r: DevServerStartResult): void => {
        if (settled) return;
        settled = true;
        starting = false;
        if (timeout) clearTimeout(timeout);
        resolve(r);
      };
      // A stop issued while we were probing Node must cancel this start.
      if (epoch !== stopEpoch) {
        finish({
          ok: false,
          url: null,
          alreadyRunning: false,
          error: "Preview start was cancelled.",
        });
        return;
      }
      const npm = npmCommand(
        ["run", "dev"],
        process.platform,
        spawnEnv,
        projectPath,
      );
      let child: ChildProcess;
      try {
        child = spawn(npm.command, npm.args, {
          cwd: projectPath,
          windowsHide: true,
          // POSIX: detached makes the child its own process-group leader so we
          // can signal the whole tree (npm → astro/vite) on stop. Without this,
          // killing npm orphans the real dev server and leaves the port bound.
          // Windows uses taskkill /t to walk the tree instead, so detached
          // stays off there (detached on Windows would also pop a console).
          detached: process.platform !== "win32",
          env: { ...spawnEnv, FORCE_COLOR: "0", NO_COLOR: "1" },
        });
      } catch (error) {
        // A synchronous spawn throw must not leave `starting` set forever.
        log.error("Dev server failed to spawn", error);
        finish({
          ok: false,
          url: null,
          alreadyRunning: false,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      current = { projectPath, child, url: null };

      timeout = setTimeout(() => {
        stopDevServer();
        // Distinguish "a zombie/foreign process holds the port" from a
        // server that failed for another reason: probe the last URL's port.
        const port = urlScanner.pendingPort();
        const hint = port
          ? ` (the port ${port} is already in use — another dev server or process may be holding it)`
          : "";
        finish({
          ok: false,
          url: null,
          alreadyRunning: false,
          error: `Dev server did not report a URL within ${STARTUP_TIMEOUT_MS / 1000}s${hint}.`,
        });
      }, STARTUP_TIMEOUT_MS);

      // URLs (and ANSI sequences) can be split across stdout chunk boundaries,
      // so buffer the tail of each chunk before matching.
      const urlScanner = new DevServerUrlScanner();
      const handleData = (data: Buffer) => {
        const text = data.toString();
        onLog(text);
        const url = urlScanner.push(text);
        // Guard the child: a stopped server's stdout can still drain while a
        // NEW server starts — its URL must not settle the new promise, or the
        // new server gets killed by the timeout with the wrong URL reported.
        if (url && current && current.child === child && !current.url) {
          current.url = url;
          finish({ ok: true, url, alreadyRunning: false });
        }
      };

      child.stdout?.on("data", handleData);
      child.stderr?.on("data", handleData);

      child.on("error", (error) => {
        log.error("Dev server failed to start", error);
        if (current?.child === child) current = null;
        finish({
          ok: false,
          url: null,
          alreadyRunning: false,
          error: error.message,
        });
      });

      child.on("exit", (code) => {
        onLog(`\n[dev server exited with code ${code ?? "null"}]\n`);
        if (current?.child === child) current = null;
        finish({
          ok: false,
          url: null,
          alreadyRunning: false,
          error: `Dev server exited before serving (code ${code ?? "null"}).`,
        });
      });

      // If the server crashes AFTER serving, the renderer must reset its
      // preview UI (button state, previewUrl) instead of showing a dead
      // preview forever.
      child.once("exit", () => {
        onServerExitListeners.forEach((listener) => listener());
      });
    });
  } catch (error) {
    starting = false;
    return {
      ok: false,
      url: null,
      alreadyRunning: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Renderers subscribe via previewServerExited to reset preview UI when the
// running dev server dies (crash, port conflict, manual kill outside Zephus).
type ServerExitListener = () => void;
const onServerExitListeners = new Set<ServerExitListener>();

export function onDevServerExit(listener: ServerExitListener): () => void {
  onServerExitListeners.add(listener);
  return () => {
    onServerExitListeners.delete(listener);
  };
}

/**
 * Force-kills a process tree via taskkill (Windows). Extracted so the win32
 * stop path is testable on any platform.
 */
export function taskkillProcessTree(pid: number): void {
  spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
    windowsHide: true,
  });
}

export function stopDevServer(): void {
  starting = false;
  stopEpoch += 1;
  if (!current) return;
  const { child } = current;
  current = null;
  const pid = child.pid;

  if (process.platform === "win32") {
    // Walk and force-kill the whole process tree (npm.cmd → node → astro).
    if (pid) {
      try {
        taskkillProcessTree(pid);
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
