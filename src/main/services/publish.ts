import { execFile } from "child_process";
import { promisify } from "util";
import { shell } from "electron";
import * as path from "path";
import log from "electron-log";
import { OperationResult } from "../types";
import { readGlobalSettings } from "./settings";
import { buildSpawnEnv } from "./nodeCheck";

const execFileAsync = promisify(execFile);
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

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
  try {
    const env = await buildSpawnEnv(readGlobalSettings().customNodePath);
    await execFileAsync(npmCmd, ["run", "build"], {
      cwd: projectPath,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...env, FORCE_COLOR: "0" },
    });
    const output = path.join(projectPath, outDir);
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
