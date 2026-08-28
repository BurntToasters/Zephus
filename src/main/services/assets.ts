import { BrowserWindow, dialog } from "electron";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import sanitizeFilename from "sanitize-filename";
import {
  AssetCategory,
  AssetEntry,
  AssetListResult,
  AssetMutationResult,
} from "../types";
import { resolveProjectRelativeDir } from "./projectPaths";

export interface ImportImageResult {
  ok: boolean;
  /** Web-root-relative path to reference in markup, e.g. /assets/images/photo.png */
  webPath?: string;
  canceled?: boolean;
  error?: string;
}

export interface ImportAssetsResult {
  ok: boolean;
  imported: { webPath: string; category: AssetCategory }[];
  errors: string[];
}

const EXTENSIONS_BY_CATEGORY: Record<
  Exclude<AssetCategory, "other">,
  string[]
> = {
  images: ["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico"],
  media: ["mp4", "webm", "mov", "mp3", "wav", "ogg", "m4a", "m4v"],
  documents: [
    "pdf",
    "doc",
    "docx",
    "txt",
    "md",
    "csv",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "odt",
    "rtf",
  ],
};

const IMAGE_EXTENSIONS = EXTENSIONS_BY_CATEGORY.images;

/** All non-image extensions, used for the "all assets" file dialog filter. */
const ALL_ASSET_EXTENSIONS = [
  ...EXTENSIONS_BY_CATEGORY.images,
  ...EXTENSIONS_BY_CATEGORY.media,
  ...EXTENSIONS_BY_CATEGORY.documents,
];

/** The base directory for Zephus-managed assets, relative to the web root. */
const ASSETS_ROOT = "assets";

/** Maps a file extension (no dot) to its asset category. */
export function categoryForExtension(ext: string): AssetCategory {
  const normalized = ext.replace(/^\./, "").toLowerCase();
  for (const [category, exts] of Object.entries(EXTENSIONS_BY_CATEGORY)) {
    if (exts.includes(normalized)) return category as AssetCategory;
  }
  return "other";
}

function uniqueName(dir: string, base: string, skipPath = ""): string {
  let candidate = base;
  let i = 1;
  // macOS/Windows filesystems are case-insensitive: "Hero.png" and "hero.png"
  // are the SAME file. The skip comparison must be case-insensitive there, or
  // a pure case rename would be rejected as a collision and produce Hero-1.png.
  const caseInsensitive = process.platform !== "linux";
  const skipMatches = (full: string): boolean =>
    caseInsensitive
      ? full.toLowerCase() === skipPath.toLowerCase()
      : full === skipPath;
  while (fs.existsSync(path.join(dir, candidate))) {
    // The file being renamed itself exists at the target name — that is a
    // no-op, not a collision.
    if (skipPath && skipMatches(path.join(dir, candidate))) return candidate;
    const ext = path.extname(base);
    const stem = path.basename(base, ext);
    candidate = `${stem}-${i}${ext}`;
    i += 1;
  }
  return candidate;
}

function assertRealChild(root: string, target: string, error: string): void {
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(error);
  }
}

function resolveRealPublicRoot(
  projectPath: string,
  publicRoot: string,
): string {
  const realProjectRoot = fs.realpathSync.native(projectPath);
  const realPublicRoot = fs.realpathSync.native(publicRoot);
  assertRealChild(
    realProjectRoot,
    realPublicRoot,
    "Public directory escapes the project directory.",
  );
  return realPublicRoot;
}

function ensureRealPublicRoot(projectPath: string, publicRoot: string): string {
  const realProjectRoot = fs.realpathSync.native(projectPath);
  let existingPath = publicRoot;
  while (!fs.existsSync(existingPath)) {
    const parent = path.dirname(existingPath);
    if (parent === existingPath) {
      throw new Error("Public directory escapes the project directory.");
    }
    existingPath = parent;
  }
  const realExisting = fs.realpathSync.native(existingPath);
  assertRealChild(
    realProjectRoot,
    realExisting,
    "Public directory escapes the project directory.",
  );
  fs.mkdirSync(publicRoot, { recursive: true });
  return resolveRealPublicRoot(projectPath, publicRoot);
}

/**
 * Copies a single source file into the categorized assets directory
 * (public/assets/<category>/) and returns its web-root-relative path.
 */
function copyIntoAssets(
  projectPath: string,
  publicDir: string,
  sourcePath: string,
): { webPath: string; category: AssetCategory } {
  const ext = path.extname(sourcePath).slice(1);
  const category = categoryForExtension(ext);
  const publicRoot = resolveProjectRelativeDir(
    projectPath,
    publicDir,
    "public",
  ).absolute;
  const realPublicRoot = ensureRealPublicRoot(projectPath, publicRoot);
  const targetDir = path.join(publicRoot, ASSETS_ROOT, category);
  fs.mkdirSync(targetDir, { recursive: true });
  const realTargetDir = fs.realpathSync.native(targetDir);
  assertRealChild(
    realPublicRoot,
    realTargetDir,
    "Asset directory escapes the public directory.",
  );
  const name = uniqueName(targetDir, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, path.join(targetDir, name));
  return { webPath: `/${ASSETS_ROOT}/${category}/${name}`, category };
}

/**
 * Prompts the user to pick an image, copies it into public/assets/images,
 * and returns the web-root-relative path. Kept for the image block flow.
 */
export async function importImage(
  win: BrowserWindow | null,
  projectPath: string,
  publicDir: string,
): Promise<ImportImageResult> {
  const options: Electron.OpenDialogOptions = {
    title: "Choose an Image",
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
  };
  const result =
    win && !win.isDestroyed()
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }

  const source = result.filePaths[0]!;
  try {
    const { webPath } = copyIntoAssets(projectPath, publicDir, source);
    return { ok: true, webPath };
  } catch (error) {
    log.error("Image import failed", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Prompts the user to pick one or more assets of any supported type and
 * imports them into their categorized directories.
 */
export async function importAssets(
  win: BrowserWindow | null,
  projectPath: string,
  publicDir: string,
): Promise<ImportAssetsResult> {
  const options: Electron.OpenDialogOptions = {
    title: "Choose Assets",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "All Assets", extensions: ALL_ASSET_EXTENSIONS },
      { name: "Images", extensions: EXTENSIONS_BY_CATEGORY.images },
      { name: "Media", extensions: EXTENSIONS_BY_CATEGORY.media },
      { name: "Documents", extensions: EXTENSIONS_BY_CATEGORY.documents },
    ],
  };
  const result =
    win && !win.isDestroyed()
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, imported: [], errors: [] };
  }
  return importAssetsFromPaths(projectPath, publicDir, result.filePaths);
}

/**
 * Imports assets from explicit file paths (used for drag-and-drop). Each file
 * is routed to its category folder. Returns per-file success and any errors.
 */
export function importAssetsFromPaths(
  projectPath: string,
  publicDir: string,
  sourcePaths: string[],
): ImportAssetsResult {
  const imported: { webPath: string; category: AssetCategory }[] = [];
  const errors: string[] = [];

  const paths = Array.isArray(sourcePaths)
    ? sourcePaths.filter((p): p is string => typeof p === "string" && !!p)
    : [];

  for (const source of paths) {
    try {
      const ext = path.extname(source).slice(1).toLowerCase();
      if (!ext || !ALL_ASSET_EXTENSIONS.includes(ext)) {
        errors.push(
          `${path.basename(source)}: unsupported file type` +
            (ext ? ` (.${ext})` : ""),
        );
        continue;
      }
      // Reject sources inside the project: importing the project's own files
      // into its own public dir is never intended and copies secrets that
      // happen to sit in the tree (e.g. .env snapshots renamed .png).
      const resolvedSource = path.resolve(source);
      const resolvedRoot = path.resolve(projectPath);
      if (
        resolvedSource === resolvedRoot ||
        resolvedSource.startsWith(resolvedRoot + path.sep)
      ) {
        errors.push(`${path.basename(source)}: already inside the project`);
        continue;
      }
      const stat = fs.statSync(source);
      if (!stat.isFile()) {
        errors.push(`${path.basename(source)}: not a file`);
        continue;
      }
      imported.push(copyIntoAssets(projectPath, publicDir, source));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${path.basename(source)}: ${message}`);
    }
  }

  return { ok: errors.length === 0, imported, errors };
}

/** Walks a directory tree collecting asset files under a given web prefix. */
function collectAssets(
  baseDir: string,
  webPrefix: string,
  forcedCategory: AssetCategory | null,
  out: AssetEntry[],
): void {
  function walk(dir: string, rel: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      const category = forcedCategory ?? categoryForExtension(ext);
      let size: number;
      try {
        size = fs.statSync(full).size;
      } catch {
        continue;
      }
      out.push({
        fileName: childRel,
        size,
        webPath: `${webPrefix}/${childRel}`,
        category,
      });
    }
  }
  walk(baseDir, "");
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
};

/** Max file size to inline as a data URL for thumbnails (5 MB). */
const MAX_DATA_URL_BYTES = 5 * 1024 * 1024;

export interface AssetDataUrlResult {
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

/**
 * Reads an image asset (referenced by its web path) and returns it as a data
 * URL for in-app thumbnails. The renderer's CSP allows data: images but not
 * file://, so this is how previews are shown without the dev server running.
 */
export function readAssetDataUrl(
  projectPath: string,
  publicDir: string,
  webPath: string,
): AssetDataUrlResult {
  try {
    const relative = webPath.replace(/^\/+/, "");
    const publicRoot = resolveProjectRelativeDir(
      projectPath,
      publicDir,
      "public",
    ).absolute;
    const resolved = path.resolve(publicRoot, relative);
    if (
      resolved !== publicRoot &&
      !resolved.startsWith(publicRoot + path.sep)
    ) {
      return { ok: false, error: "Path escapes the public directory." };
    }
    const realPublicRoot = resolveRealPublicRoot(projectPath, publicRoot);
    const realResolved = fs.realpathSync.native(resolved);
    assertRealChild(
      realPublicRoot,
      realResolved,
      "Path escapes the public directory.",
    );
    const ext = path.extname(resolved).slice(1).toLowerCase();
    const mime = MIME_BY_EXTENSION[ext];
    if (!mime) return { ok: false, error: "Unsupported image type." };
    const stat = fs.statSync(resolved);
    if (stat.size > MAX_DATA_URL_BYTES) {
      return { ok: false, error: "Image too large to preview." };
    }
    const buffer = fs.readFileSync(resolved);
    return {
      ok: true,
      dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Resolves a renderer-supplied asset web path to a real file inside the
 * project's public directory. Rejects traversal, symlink escapes, directories,
 * and extensions outside the asset allowlist, so this cannot be used to delete
 * or move arbitrary project files (e.g. source code or `.git` contents).
 */
function resolveManagedAssetFile(
  projectPath: string,
  publicDir: string,
  webPath: string,
): { file: string; publicRoot: string } {
  if (typeof webPath !== "string" || !webPath.trim()) {
    throw new Error("Missing asset path.");
  }
  const relative = webPath.replace(/^\/+/, "");
  if (!relative || relative.split(/[\\/]/).includes("..")) {
    throw new Error("Invalid asset path.");
  }
  const publicRoot = resolveProjectRelativeDir(
    projectPath,
    publicDir,
    "public",
  ).absolute;
  const resolved = path.resolve(publicRoot, relative);
  assertRealChild(publicRoot, resolved, "Path escapes the public directory.");
  const realPublicRoot = resolveRealPublicRoot(projectPath, publicRoot);
  const realResolved = fs.realpathSync.native(resolved);
  assertRealChild(
    realPublicRoot,
    realResolved,
    "Path escapes the public directory.",
  );
  if (!fs.statSync(realResolved).isFile()) {
    throw new Error("Asset is not a file.");
  }
  const ext = path.extname(realResolved).slice(1).toLowerCase();
  if (!ALL_ASSET_EXTENSIONS.includes(ext)) {
    throw new Error("Not a managed asset type.");
  }
  // Both paths must be realpaths, or deriving a web path from them produces
  // traversal garbage on platforms where the temp/home root is a symlink
  // (e.g. macOS /var -> /private/var).
  // A symlink INSIDE the project pointing at this asset: mutating it would
  // change the symlink's target (leaving the in-project link pointing at a
  // dead name) while the web path refers to the link. Reject so the user can
  // decide instead of silently operating on a different file. (Compare the
  // LEXICAL path: resolving first would hide the link — e.g. macOS /var is
  // itself a symlink to /private/var.)
  if (fs.lstatSync(resolved).isSymbolicLink()) {
    throw new Error(
      "This asset is a symlink. Deleting or renaming it would affect the file it points to; remove the link manually instead.",
    );
  }
  return { file: realResolved, publicRoot: realPublicRoot };
}

/** Converts an absolute file inside the public root back to its web path. */
function webPathForFile(publicRoot: string, file: string): string {
  const rel = path.relative(publicRoot, file).split(path.sep).join("/");
  return `/${rel}`;
}

/** Deletes a managed asset file from the project's public directory. */
export function deleteAsset(
  projectPath: string,
  publicDir: string,
  webPath: string,
): AssetMutationResult {
  try {
    const { file } = resolveManagedAssetFile(projectPath, publicDir, webPath);
    fs.rmSync(file, { force: true });
    return { ok: true };
  } catch (error) {
    log.error("Asset delete failed", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Renames a managed asset in place. The new name is reduced to a bare file name
 * (no directory parts) and keeps the original extension, so a rename can never
 * relocate the file or change its type. Collisions get a numeric suffix.
 */
export function renameAsset(
  projectPath: string,
  publicDir: string,
  webPath: string,
  nextName: string,
): AssetMutationResult {
  try {
    const { file, publicRoot } = resolveManagedAssetFile(
      projectPath,
      publicDir,
      webPath,
    );
    const ext = path.extname(file);
    const requested = sanitizeFilename(
      path.basename(String(nextName ?? "")).trim(),
    );
    const stem = path.basename(requested, path.extname(requested)).trim();
    if (!stem) return { ok: false, error: "Enter a file name." };

    const dir = path.dirname(file);
    const target = path.join(dir, uniqueName(dir, `${stem}${ext}`, file));
    if (target === file) {
      return { ok: true, webPath: webPathForFile(publicRoot, file) };
    }
    assertRealChild(
      fs.realpathSync.native(dir),
      target,
      "Path escapes the asset directory.",
    );
    fs.renameSync(file, target);
    return { ok: true, webPath: webPathForFile(publicRoot, target) };
  } catch (error) {
    log.error("Asset rename failed", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Lists all managed assets under public/assets/<category>/, plus any legacy
 * images under public/images/ so existing projects keep working.
 */
export function listProjectAssets(
  projectPath: string,
  publicDir: string,
): AssetListResult {
  const assets: AssetEntry[] = [];
  try {
    const publicRoot = resolveProjectRelativeDir(
      projectPath,
      publicDir,
      "public",
    ).absolute;
    if (!fs.existsSync(publicRoot)) {
      return { ok: true, assets };
    }
    resolveRealPublicRoot(projectPath, publicRoot);
    const assetsRoot = path.join(publicRoot, ASSETS_ROOT);
    if (fs.existsSync(assetsRoot)) {
      collectAssets(assetsRoot, `/${ASSETS_ROOT}`, null, assets);
    }

    // Legacy location from earlier Zephus versions.
    const legacyImages = path.join(publicRoot, "images");
    if (fs.existsSync(legacyImages)) {
      collectAssets(legacyImages, "/images", "images", assets);
    }

    assets.sort((a, b) => a.fileName.localeCompare(b.fileName));
    return { ok: true, assets };
  } catch (error) {
    log.error("Failed to list project assets", error);
    return {
      ok: false,
      assets: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
