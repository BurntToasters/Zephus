import { execFile } from "child_process";
import { promisify } from "util";
import { shell } from "electron";
import log from "electron-log";
import { OperationResult } from "../types";
import { readGlobalSettings } from "./settings";
import { buildSpawnEnv } from "./nodeCheck";
import { npmCommand } from "./npmCommand";
import { resolveProjectRelativeDir } from "./projectPaths";
import { detectAstro } from "./project";
import { ensureVisualSchema } from "./schema";

const execFileAsync = promisify(execFile);

export interface PublishResult extends OperationResult {
  outputDir?: string;
}

let activeBuild: Promise<PublishResult> | null = null;

/**
 * Runs `npm run build` (Astro production build) in the project directory.
 * On success, opens the output folder in the system file manager.
 */
export function buildAndReveal(
  projectPath: string,
  outDir: string,
): Promise<PublishResult> {
  if (typeof projectPath !== "string" || !projectPath) {
    return Promise.resolve({ ok: false, error: "Invalid project path." });
  }
  // Serialize concurrent builds: two overlapping runs would regenerate the
  // same managed files and race writing the same dist/ directory.
  if (activeBuild) {
    return Promise.resolve({
      ok: false,
      error: "A build is already running. Wait for it to finish.",
    });
  }
  activeBuild = runBuild(projectPath, outDir);
  void activeBuild.finally(() => {
    if (activeBuild) activeBuild = null;
  });
  return activeBuild;
}

async function runBuild(
  projectPath: string,
  outDir: string,
): Promise<PublishResult> {
  try {
    // Astro builds whatever .astro files are on disk. Refresh managed pages
    // from their sidecars first, so a page that is stale relative to its saved
    // state (or to a newer generator) is never what gets published.
    const refreshed = ensureVisualSchema(
      projectPath,
      detectAstro(projectPath).pagesDir,
      undefined,
      { refreshManagedPages: true },
    );
    if (!refreshed.ok) {
      return { ok: false, error: refreshed.error ?? "Schema refresh failed." };
    }

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
