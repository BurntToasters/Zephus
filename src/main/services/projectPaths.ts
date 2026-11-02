import * as fs from "fs";
import * as path from "path";
import { assertRealpathInside } from "./fsSafe";
import { detectAstro } from "./project";

export function normalizeProjectRelativeDir(
  value: string,
  fallback: string,
): string {
  const raw = (typeof value === "string" && value.trim()) || fallback;
  if (path.isAbsolute(raw) || path.win32.isAbsolute(raw)) return fallback;

  const slashPath = raw.replace(/\\/g, "/").replace(/^\.\//, "");
  if (path.posix.isAbsolute(slashPath)) return fallback;

  const normalized = path.posix.normalize(slashPath).replace(/\/+$/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return fallback;
  }
  return normalized;
}

export function toProjectRelativePath(value: string): string {
  return value.replace(/\\/g, "/");
}

/** Astro public directory; ignores a renderer hint such as src or src/pages. */
export function detectedAstroPublicDir(projectPath: string): string {
  return detectAstro(projectPath).publicDir;
}

export function resolveProjectRelativeDir(
  projectPath: string,
  value: string,
  fallback: string,
): { relative: string; absolute: string } {
  const root = path.resolve(projectPath);
  const relative = normalizeProjectRelativeDir(value, fallback);
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    const safeFallback = normalizeProjectRelativeDir(fallback, ".");
    return {
      relative: safeFallback,
      absolute: path.resolve(root, safeFallback),
    };
  }
  return { relative, absolute };
}

/** Resolves the build output directory and verifies it stays inside the project. */
export function resolveValidatedBuildOutputDir(
  projectPath: string,
  _outDirHint: string,
):
  | { ok: true; relative: string; absolute: string }
  | { ok: false; error: string } {
  const astro = detectAstro(projectPath);
  if (astro.configReadError) {
    return {
      ok: false,
      error:
        "Could not determine the build output folder from astro.config. Fix the config before publishing.",
    };
  }
  const { relative, absolute } = resolveProjectRelativeDir(
    projectPath,
    astro.outDir,
    astro.outDir,
  );
  try {
    assertRealpathInside(projectPath, absolute);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Invalid build output path.",
    };
  }
  return { ok: true, relative, absolute };
}

/** Build output folder for reveal-in-Finder; ignores a stale renderer hint when Astro config loads. */
export function resolveRevealOutputDir(
  projectPath: string,
  outDirHint: string,
): { relative: string; absolute: string } {
  const astro = detectAstro(projectPath);
  if (!astro.configReadError) {
    return resolveProjectRelativeDir(projectPath, astro.outDir, astro.outDir);
  }
  return resolveProjectRelativeDir(projectPath, outDirHint, "dist");
}

/** True when the build output folder contains a root index.html. */
export function buildOutputHasIndexHtml(absoluteOutDir: string): boolean {
  try {
    const indexPath = path.join(absoluteOutDir, "index.html");
    return fs.existsSync(indexPath) && fs.statSync(indexPath).isFile();
  } catch {
    return false;
  }
}
