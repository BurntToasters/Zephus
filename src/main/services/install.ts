import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { OperationResult } from "../types";
import { readGlobalSettings } from "./settings";
import { buildSpawnEnv } from "./nodeCheck";
import { npmCommand } from "./npmCommand";

export type InstallLogListener = (chunk: string) => void;

let installing = false;

/** True if the project already has node_modules. */
export function dependenciesInstalled(projectPath: string): boolean {
  return fs.existsSync(path.join(projectPath, "node_modules"));
}

/**
 * Runs `npm install` in the project, streaming output. Resolves with the
 * result when the process exits. Guards against concurrent installs.
 */
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
    let child;
    try {
      const npm = npmCommand(
        ["install", "--loglevel=http", "--no-fund"],
        process.platform,
        env,
      );
      child = spawn(npm.command, npm.args, {
        cwd: projectPath,
        windowsHide: true,
        env: { ...env, FORCE_COLOR: "0" },
      });
    } catch (error) {
      installing = false;
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const handle = (data: Buffer) => onLog(data.toString());
    child.stdout?.on("data", handle);
    child.stderr?.on("data", handle);

    child.on("error", (error) => {
      installing = false;
      log.error("npm install failed to start", error);
      resolve({
        ok: false,
        error:
          error.message.includes("ENOENT") || /not found/i.test(error.message)
            ? "Node.js / npm not found. Install Node.js or set a custom Node.js location in Settings."
            : error.message,
      });
    });

    child.on("exit", (code) => {
      installing = false;
      onLog(`\n[npm install exited with code ${code ?? "null"}]\n`);
      if (code === 0) resolve({ ok: true });
      else
        resolve({
          ok: false,
          error: `npm install failed (exit code ${code ?? "null"}). See the log for details.`,
        });
    });
  });
}
