import { execFile } from "child_process";
import { promisify } from "util";
import { shell } from "electron";
import log from "electron-log";
import { OperationResult } from "../types";
import { readGlobalSettings } from "./settings";
import { buildSpawnEnv } from "./nodeCheck";
import { npmCommand } from "./npmCommand";
import { resolveProjectRelativeDir } from "./projectPaths";

const execFileAsync = promisify(execFile);

export interface PublishResult extends OperationResult {
  outputDir?: string;
}

/**
 * Runs `npm run build` (Astro production build) in the project directory.
 * On success, opens the output folder in the system file manager.
 */
export async function buildAndReveal(
  projectPath: string,
  outDir: string,
): Promise<PublishResult> {
  if (typeof projectPath !== "string" || !projectPath) {
    return { ok: false, error: "Invalid project path." };
  }
  try {
    const env = await buildSpawnEnv(readGlobalSettings().customNodePath);
    const npm = npmCommand(["run", "build"], process.platform, env);
    await execFileAsync(npm.command, npm.args, {
      cwd: projectPath,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...env, FORCE_COLOR: "0" },
    });
    const output = resolveProjectRelativeDir(
      projectPath,
      outDir,
      "dist",
    ).absolute;
    shell.openPath(output).catch(() => {
      /* best-effort */
    });
    return { ok: true, outputDir: output };
  } catch (error) {
    log.error("Publish (astro build) failed", error);
    const message =
      error instanceof Error
        ? (error as Error & { stderr?: string }).stderr || error.message
        : String(error);
    return { ok: false, error: message };
  }
}
