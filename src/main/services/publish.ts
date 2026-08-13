import { spawn } from "child_process";
import { shell } from "electron";
import log from "electron-log";
import { OperationResult } from "../types";
import { readGlobalSettings } from "./settings";
import { buildSpawnEnv } from "./nodeCheck";
import { npmCommand } from "./npmCommand";
import { resolveProjectRelativeDir } from "./projectPaths";
import { detectAstro } from "./project";
import { ensureVisualSchema } from "./schema";

export interface PublishResult extends OperationResult {
  /** True when the output folder was actually opened in the file manager. */
  revealed?: boolean;
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
  onBuildLog?: (chunk: string) => void,
  options: { reveal?: boolean } = {},
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
  activeBuild = runBuild(projectPath, outDir, onBuildLog, options);
  void activeBuild.finally(() => {
    if (activeBuild) activeBuild = null;
  });
  return activeBuild;
}

async function runBuild(
  projectPath: string,
  outDir: string,
  onBuildLog?: (chunk: string) => void,
  options: { reveal?: boolean } = {},
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
    const npm = npmCommand(
      ["run", "build"],
      process.platform,
      env,
      projectPath,
    );
    // Stream output chunk-by-chunk so a long first build never reads as a
    // hang (the renderer pipes these chunks into the log panel as they
    // arrive — previously everything arrived only after the build finished).
    try {
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(npm.command, npm.args, {
          cwd: projectPath,
          windowsHide: true,
          env: { ...env, FORCE_COLOR: "0" },
        });
        const handle = (data: Buffer) => {
          const text = data.toString();
          onBuildLog?.(text);
        };
        child.stdout?.on("data", handle);
        child.stderr?.on("data", handle);
        child.on("error", reject);
        child.on("exit", (code) => resolve(code));
      });
      if (exitCode !== 0) {
        throw new Error(
          `npm run build exited with code ${exitCode ?? "null"}.`,
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/maxBuffer/.test(msg)) {
        return {
          ok: false,
          error:
            "The build produced too much log output and was stopped. Check the build logs for warnings.",
        };
      }
      throw error;
    }
    const output = resolveProjectRelativeDir(
      projectPath,
      outDir,
      "dist",
    ).absolute;
    let revealed = false;
    if (options.reveal !== false) {
      const openError = await shell.openPath(output);
      revealed = !openError;
    }
    return {
      ok: true,
      outputDir: output,
      revealed,
    };
  } catch (error) {
    log.error("Publish (astro build) failed", error);
    const message =
      error instanceof Error
        ? (error as Error & { stderr?: string }).stderr || error.message
        : String(error);
    return { ok: false, error: message };
  }
}
