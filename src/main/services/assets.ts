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

/**
 * Encodes a filesystem-relative path for a web URL. Each segment is encoded
 * separately so legal filename delimiters (spaces, "#", "%", "?") cannot be
 * parsed as URL syntax, while "/" directory separators are preserved.
 */
function encodeWebPath(relative: string): string {
  return relative.split("/").map(encodeURIComponent).join("/");
}

/**
 * Rejects segments that could change meaning during filesystem resolution.
 * Applied independently to raw web-path segments and their decoded forms.
 */
function assertSafeWebPathSegment(segment: string): void {
  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    segment.includes("\0") ||
    segment.includes("/") ||
    segment.includes("\\")
  ) {
    throw new Error("Invalid asset path.");
  }
}

interface AssetWebPathCandidates {
  /** Percent-decoded segments, or null when any segment has no valid escape. */
  decoded: string[] | null;
  /** Raw segments, for legacy references that contain a literal "%". */
  raw: string[];
}

/**
 * Splits a managed asset web path into raw and decoded candidates. Each
 * segment is validated independently: decoding the whole string first would
 * turn an encoded slash into a real separator before containment checks run.
 */
function decodeAssetWebPath(webPath: string): AssetWebPathCandidates {
  if (typeof webPath !== "string" || !webPath.trim()) {
    throw new Error("Missing asset path.");
  }
  const relative = webPath.replace(/^\/+/, "");
  if (!relative) {
    throw new Error("Invalid asset path.");
  }
  const raw = relative.split("/");
  for (const segment of raw) {
    assertSafeWebPathSegment(segment);
  }
  const decodedSegments: string[] = [];
  let allDecoded = true;
  for (const segment of raw) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // A literal "%" is legal in legacy file names. Keep validating the
      // remaining segments so encoded traversal is still a hard rejection.
      allDecoded = false;
      continue;
    }
    assertSafeWebPathSegment(decoded);
    decodedSegments.push(decoded);
  }
  return { decoded: allDecoded ? decodedSegments : null, raw };
}

/**
 * Every unique reference spelling that can name one managed web path: the
 * NFC-normalized path itself plus, when decoding is unambiguous, the legacy
 * raw spelling older sidecars saved (e.g. `/assets/images/hero #1.png` for
 * `/assets/images/hero%20%231.png`). Decoding reuses the strict segment
 * validation above, so encoded slashes, backslashes, and dot segments throw
 * instead of turning into aliases.
 */
export function assetReferenceSpellings(webPath: string): string[] {
  const normalized = String(webPath ?? "")
    .trim()
    .normalize("NFC");
  if (!normalized) return [];
  const { decoded } = decodeAssetWebPath(normalized);
  const spellings = [normalized];
  if (!decoded) return spellings;
  for (const segment of decoded) {
    let redecoded: string;
    try {
      redecoded = decodeURIComponent(segment);
    } catch {
      // A literal "%" with no valid escape cannot denote any other name.
      continue;
    }
    // A decoded segment that is itself a valid encoding of a different name
    // makes the raw spelling ambiguous: it could point at another file, so
    // never treat it as an alias for this one.
    if (redecoded !== segment) return spellings;
  }
  const leading = /^\/+/.exec(normalized)?.[0] ?? "";
  const alias =
    leading + decoded.map((segment) => segment.normalize("NFC")).join("/");
  if (!spellings.includes(alias)) spellings.push(alias);
  return spellings;
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
/** Ensures the import reads the file the user picked, not a symlink target elsewhere. */
function isResolvedPathInsideProject(
  resolvedSource: string,
  resolvedRoot: string,
): boolean {
  if (
    resolvedSource === resolvedRoot ||
    resolvedSource.startsWith(resolvedRoot + path.sep)
  ) {
    return true;
  }
  try {
    const realSource = fs.realpathSync.native(resolvedSource);
    const realRoot = fs.realpathSync.native(resolvedRoot);
    return (
      realSource === realRoot || realSource.startsWith(realRoot + path.sep)
    );
  } catch {
    return false;
  }
}

function assertImportDestinationNotSymlink(destPath: string): void {
  try {
    if (fs.lstatSync(destPath).isSymbolicLink()) {
      throw new Error(
        "Refusing to overwrite a symlink in the asset directory.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function assertImportSourceRealpath(sourcePath: string): string {
  const resolved = path.resolve(sourcePath);
  const lstat = fs.lstatSync(resolved);
  if (!lstat.isFile() && !lstat.isSymbolicLink()) {
    throw new Error("Source is not a file.");
  }
  const realSource = fs.realpathSync.native(resolved);
  if (lstat.isSymbolicLink()) {
    throw new Error(
      "Symlinked source files are not allowed; pick the real file instead.",
    );
  }
  return realSource;
}

function copyIntoAssets(
  projectPath: string,
  publicDir: string,
  sourcePath: string,
): { webPath: string; category: AssetCategory } {
  const realSource = assertImportSourceRealpath(sourcePath);
  const ext = path.extname(realSource).slice(1);
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
  const name = uniqueName(targetDir, path.basename(realSource));
  const destPath = path.join(targetDir, name);
  assertImportDestinationNotSymlink(destPath);
  fs.copyFileSync(realSource, destPath);
  return {
    webPath: `/${ASSETS_ROOT}/${category}/${encodeWebPath(name)}`,
    category,
  };
}

/**
 * The last path segment only. A dropped name is untrusted text, so directory
 * prefixes and Windows separators are discarded before the file is created.
 */
function droppedAssetFileName(value: string): string {
  if (value.includes("\0")) {
    throw new Error("Invalid file name.");
  }
  const base = value.split(/[/\\]/).pop() ?? "";
  const cleaned = sanitizeFilename(base);
  if (
    !cleaned ||
    cleaned === "." ||
    cleaned === ".." ||
    /[/\\]/.test(cleaned)
  ) {
    throw new Error("Invalid file name.");
  }
  return cleaned;
}

/**
 * Writes one dropped file into public/assets/<category>/. The caller has no
 * filesystem path: the webview can read the bytes, not the source location.
 */
export function importAssetBytes(
  projectPath: string,
  publicDir: string,
  fileName: string,
  bytesBase64: string,
): ImportAssetsResult {
  const imported: { webPath: string; category: AssetCategory }[] = [];
  const errors: string[] = [];
  try {
    if (typeof fileName !== "string" || typeof bytesBase64 !== "string") {
      throw new Error("Invalid dropped file.");
    }
    const name = droppedAssetFileName(fileName);
    const ext = path.extname(name).slice(1).toLowerCase();
    if (!ext || !ALL_ASSET_EXTENSIONS.includes(ext)) {
      errors.push(`${name}: unsupported file type` + (ext ? ` (.${ext})` : ""));
      return { ok: false, imported, errors };
    }
    if (
      bytesBase64.length > MAX_DROPPED_ASSET_BASE64 + 4 ||
      bytesBase64.length === 0
    ) {
      errors.push(
        bytesBase64.length === 0
          ? `${name}: empty file`
          : `${name}: file is too large to drop. Use Import Files.`,
      );
      return { ok: false, imported, errors };
    }
    const bytes = Buffer.from(bytesBase64, "base64");
    if (bytes.length === 0 || bytes.length > MAX_DROPPED_ASSET_BYTES) {
      errors.push(
        bytes.length === 0
          ? `${name}: empty file`
          : `${name}: file is too large to drop. Use Import Files.`,
      );
      return { ok: false, imported, errors };
    }
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
    const storedName = uniqueName(targetDir, name);
    const destPath = path.join(targetDir, storedName);
    assertImportDestinationNotSymlink(destPath);
    assertRealChild(
      path.resolve(targetDir),
      path.resolve(destPath),
      "Asset file escapes the public directory.",
    );
    fs.writeFileSync(destPath, bytes);
    imported.push({
      webPath: `/${ASSETS_ROOT}/${category}/${encodeWebPath(storedName)}`,
      category,
    });
    return { ok: true, imported, errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(message);
    return { ok: false, imported, errors };
  }
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
      if (isResolvedPathInsideProject(resolvedSource, resolvedRoot)) {
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
  realPublicRoot: string,
): void {
  function walk(dir: string, rel: string): void {
    let realDir: string;
    try {
      realDir = fs.realpathSync.native(dir);
    } catch {
      return;
    }
    if (
      realDir !== realPublicRoot &&
      !realDir.startsWith(realPublicRoot + path.sep)
    ) {
      return;
    }
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
        webPath: `${webPrefix}/${encodeWebPath(childRel)}`,
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

/**
 * Largest file a drag-and-drop can send through the local invoke body.
 * Bigger files still import through the file dialog, which copies by path.
 */
const MAX_DROPPED_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_DROPPED_ASSET_BASE64 = Math.ceil(MAX_DROPPED_ASSET_BYTES / 3) * 4;

export interface AssetDataUrlResult {
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

/**
 * Resolves one candidate segment list inside the public directory. Returns
 * null only when the candidate does not exist, so a missing decoded name can
 * fall back to a legacy raw name without hiding containment or symlink errors.
 */
function resolveAssetCandidate(
  publicRoot: string,
  realPublicRoot: string,
  segments: string[],
): { resolved: string; realResolved: string } | null {
  const resolved = path.join(publicRoot, ...segments);
  assertRealChild(publicRoot, resolved, "Path escapes the public directory.");
  try {
    fs.lstatSync(resolved);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
  const realResolved = fs.realpathSync.native(resolved);
  assertRealChild(
    realPublicRoot,
    realResolved,
    "Path escapes the public directory.",
  );
  return { resolved, realResolved };
}

/**
 * Resolves a web path to a real file inside the public directory. The decoded
 * name is tried first using standard URL semantics; when that file is absent,
 * the raw name is tried so legacy references with literal "%" keep working.
 * Both candidates use the same lexical and realpath containment checks.
 */
function resolvePublicAssetFile(
  projectPath: string,
  publicDir: string,
  webPath: string,
): { resolved: string; realResolved: string; publicRoot: string } {
  const candidates = decodeAssetWebPath(webPath);
  const publicRoot = resolveProjectRelativeDir(
    projectPath,
    publicDir,
    "public",
  ).absolute;
  const realPublicRoot = resolveRealPublicRoot(projectPath, publicRoot);
  const attempts: string[][] = [];
  if (candidates.decoded) {
    attempts.push(candidates.decoded);
  }
  const rawDiffers =
    !candidates.decoded ||
    candidates.decoded.some(
      (segment, index) => segment !== candidates.raw[index],
    );
  if (rawDiffers) {
    attempts.push(candidates.raw);
  }
  for (const segments of attempts) {
    const found = resolveAssetCandidate(publicRoot, realPublicRoot, segments);
    if (found) {
      return { ...found, publicRoot: realPublicRoot };
    }
  }
  throw new Error("Asset file not found.");
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
    const { realResolved } = resolvePublicAssetFile(
      projectPath,
      publicDir,
      webPath,
    );
    const ext = path.extname(realResolved).slice(1).toLowerCase();
    const mime = MIME_BY_EXTENSION[ext];
    if (!mime) return { ok: false, error: "Unsupported image type." };
    const stat = fs.statSync(realResolved);
    if (stat.size > MAX_DATA_URL_BYTES) {
      return { ok: false, error: "Image too large to preview." };
    }
    const buffer = fs.readFileSync(realResolved);
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
  const { resolved, realResolved, publicRoot } = resolvePublicAssetFile(
    projectPath,
    publicDir,
    webPath,
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
  return { file: realResolved, publicRoot };
}

/** Converts an absolute file inside the public root back to its web path. */
function webPathForFile(publicRoot: string, file: string): string {
  const rel = path.relative(publicRoot, file).split(path.sep).join("/");
  return `/${encodeWebPath(rel)}`;
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
    const reqExt = path.extname(requested);
    const stripExt =
      reqExt &&
      (reqExt.toLowerCase() === ext.toLowerCase() ||
        /^\.[a-zA-Z]{2,5}$/.test(reqExt))
        ? reqExt
        : "";
    const stem = path.basename(requested, stripExt).trim();
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
    const realPublicRoot = resolveRealPublicRoot(projectPath, publicRoot);
    const assetsRoot = path.join(publicRoot, ASSETS_ROOT);
    if (fs.existsSync(assetsRoot)) {
      collectAssets(
        assetsRoot,
        `/${ASSETS_ROOT}`,
        null,
        assets,
        realPublicRoot,
      );
    }

    // Legacy location from earlier Zephus versions.
    const legacyImages = path.join(publicRoot, "images");
    if (fs.existsSync(legacyImages)) {
      collectAssets(legacyImages, "/images", "images", assets, realPublicRoot);
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
