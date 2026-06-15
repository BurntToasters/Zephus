import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { AstroInfo, PackageValidation, ProjectOpenResult } from "../types";
import { isZephusProject } from "./settings";

const ASTRO_CONFIG_FILES = [
  "astro.config.mjs",
  "astro.config.ts",
  "astro.config.js",
  "astro.config.cjs",
];

export function isGitRepo(projectPath: string): boolean {
  return fs.existsSync(path.join(projectPath, ".git"));
}

function readPackageJson(projectPath: string): {
  raw: unknown | null;
  parseable: boolean;
  exists: boolean;
} {
  const file = path.join(projectPath, "package.json");
  if (!fs.existsSync(file))
    return { raw: null, parseable: false, exists: false };
  try {
    return {
      raw: JSON.parse(fs.readFileSync(file, "utf8")),
      parseable: true,
      exists: true,
    };
  } catch {
    return { raw: null, parseable: false, exists: true };
  }
}

export function validatePackage(projectPath: string): PackageValidation {
  const { raw, parseable, exists } = readPackageJson(projectPath);
  const pkg = (raw ?? {}) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const scripts = pkg.scripts ?? {};
  const hasAstroDependency = Boolean(deps["astro"]);
  const hasDevScript = typeof scripts["dev"] === "string";
  const hasBuildScript = typeof scripts["build"] === "string";
  return {
    exists,
    parseable,
    hasAstroDependency,
    hasDevScript,
    hasBuildScript,
    ready: exists && parseable && hasAstroDependency && hasDevScript,
  };
}

function findAstroConfig(projectPath: string): string | null {
  for (const name of ASTRO_CONFIG_FILES) {
    if (fs.existsSync(path.join(projectPath, name))) return name;
  }
  return null;
}

function detectAstroVersion(projectPath: string): string | null {
  const { raw } = readPackageJson(projectPath);
  const pkg = (raw ?? {}) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return pkg.dependencies?.["astro"] ?? pkg.devDependencies?.["astro"] ?? null;
}

function extractConfigDir(
  configText: string,
  key: string,
  fallback: string,
): string {
  // Matches e.g. srcDir: './source' or outDir: "build"
  const re = new RegExp(`${key}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`);
  const m = configText.match(re);
  if (!m || !m[1]) return fallback;
  // Normalize a leading ./ and trailing slashes.
  return m[1].replace(/^\.\//, "").replace(/\/+$/, "") || fallback;
}

export function detectAstro(projectPath: string): AstroInfo {
  const configFile = findAstroConfig(projectPath);
  const version = detectAstroVersion(projectPath);

  let srcDir = "src";
  let publicDir = "public";
  let outDir = "dist";
  let configReadError = false;

  if (configFile) {
    try {
      const text = fs.readFileSync(path.join(projectPath, configFile), "utf8");
      srcDir = extractConfigDir(text, "srcDir", "src");
      publicDir = extractConfigDir(text, "publicDir", "public");
      outDir = extractConfigDir(text, "outDir", "dist");
    } catch {
      configReadError = true;
    }
  }

  const info: AstroInfo = {
    isAstro: Boolean(configFile) && Boolean(version),
    version,
    srcDir,
    pagesDir: path.join(srcDir, "pages"),
    publicDir,
    outDir,
    configFile,
    configReadError,
  };
  return info;
}

/** Lists editable page files (relative to project root) in src/pages. */
export function listPages(projectPath: string, pagesDir: string): string[] {
  const root = path.join(projectPath, pagesDir);
  const out: string[] = [];
  const PAGE_EXT = /\.(astro|md|mdx|html)$/i;

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && PAGE_EXT.test(entry.name)) {
        out.push(path.relative(projectPath, full));
      }
    }
  }

  walk(root);
  return out.sort();
}

export function openProject(projectPath: string): ProjectOpenResult {
  try {
    if (!fs.existsSync(projectPath)) {
      return makeFailure(projectPath, "Project path no longer exists.");
    }
    const name = path.basename(projectPath);
    const astro = detectAstro(projectPath);
    const pkg = validatePackage(projectPath);
    const pages = astro.isAstro ? listPages(projectPath, astro.pagesDir) : [];
    return {
      ok: true,
      path: projectPath,
      name,
      isGitRepo: isGitRepo(projectPath),
      isZephusProject: isZephusProject(projectPath),
      pkg,
      astro,
      pages,
    };
  } catch (error) {
    log.error("Failed to open project", projectPath, error);
    return makeFailure(
      projectPath,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function makeFailure(projectPath: string, message: string): ProjectOpenResult {
  return {
    ok: false,
    path: projectPath,
    name: path.basename(projectPath),
    isGitRepo: false,
    isZephusProject: false,
    pkg: {
      exists: false,
      parseable: false,
      hasAstroDependency: false,
      hasDevScript: false,
      hasBuildScript: false,
      ready: false,
    },
    astro: {
      isAstro: false,
      version: null,
      srcDir: "src",
      pagesDir: path.join("src", "pages"),
      publicDir: "public",
      outDir: "dist",
      configFile: null,
      configReadError: false,
    },
    pages: [],
    error: message,
  };
}
