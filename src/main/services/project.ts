import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { AstroInfo, PackageValidation, ProjectOpenResult } from "../types";
import {
  normalizeProjectRelativeDir,
  resolveProjectRelativeDir,
  toProjectRelativePath,
} from "./projectPaths";
import { getVisualSchemaStatus } from "./schema";
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
): { value: string; invalid: boolean } {
  // Matches e.g. srcDir: './source' or outDir: "build"
  const re = new RegExp(`${key}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`);
  const m = configText.match(re);
  if (!m || !m[1]) return { value: fallback, invalid: false };
  const invalidSentinel = "__zephus_invalid_dir__";
  const value = normalizeProjectRelativeDir(m[1], invalidSentinel);
  if (value === invalidSentinel) return { value: fallback, invalid: true };
  return { value, invalid: false };
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
      const nextSrcDir = extractConfigDir(text, "srcDir", "src");
      const nextPublicDir = extractConfigDir(text, "publicDir", "public");
      const nextOutDir = extractConfigDir(text, "outDir", "dist");
      srcDir = nextSrcDir.value;
      publicDir = nextPublicDir.value;
      outDir = nextOutDir.value;
      configReadError =
        nextSrcDir.invalid || nextPublicDir.invalid || nextOutDir.invalid;
    } catch {
      configReadError = true;
    }
  }

  const info: AstroInfo = {
    isAstro: Boolean(configFile) && Boolean(version),
    version,
    srcDir,
    pagesDir: path.posix.join(srcDir, "pages"),
    publicDir,
    outDir,
    configFile,
    configReadError,
  };
  return info;
}

/** Lists editable page files (relative to project root) in src/pages. */
export function listPages(projectPath: string, pagesDir: string): string[] {
  const { absolute: root } = resolveProjectRelativeDir(
    projectPath,
    pagesDir,
    path.join("src", "pages"),
  );
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
        out.push(toProjectRelativePath(path.relative(projectPath, full)));
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
    const schema = astro.isAstro
      ? getVisualSchemaStatus(projectPath, astro.pagesDir)
      : {
          exists: false,
          integrity: "legacy" as const,
          detachedPages: [],
          pageDocumentCount: 0,
        };
    return {
      ok: true,
      path: projectPath,
      name,
      isGitRepo: isGitRepo(projectPath),
      isZephusProject: isZephusProject(projectPath),
      pkg,
      astro,
      schema,
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
      pagesDir: path.posix.join("src", "pages"),
      publicDir: "public",
      outDir: "dist",
      configFile: null,
      configReadError: false,
    },
    schema: {
      exists: false,
      integrity: "legacy",
      detachedPages: [],
      pageDocumentCount: 0,
    },
    pages: [],
    error: message,
  };
}
