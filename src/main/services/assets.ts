import { BrowserWindow, dialog } from "electron";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { AssetEntry, AssetListResult } from "../types";

export interface ImportImageResult {
  ok: boolean;
  /** Web-root-relative path to reference in markup, e.g. /images/photo.png */
  webPath?: string;
  canceled?: boolean;
  error?: string;
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "svg", "webp", "avif"];

function uniqueName(dir: string, base: string): string {
  let candidate = base;
  let i = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    const ext = path.extname(base);
    const stem = path.basename(base, ext);
    candidate = `${stem}-${i}${ext}`;
    i += 1;
  }
  return candidate;
}

/**
 * Prompts the user to pick an image, copies it into the project's
 * public/images directory, and returns the web-root-relative path.
 */
export async function importImage(
  win: BrowserWindow | null,
  projectPath: string,
  publicDir: string,
): Promise<ImportImageResult> {
  const result = await dialog.showOpenDialog(win ?? undefined!, {
    title: "Choose an Image",
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }

  const source = result.filePaths[0]!;
  try {
    const imagesDir = path.join(projectPath, publicDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    const name = uniqueName(imagesDir, path.basename(source));
    fs.copyFileSync(source, path.join(imagesDir, name));
    return { ok: true, webPath: `/images/${name}` };
  } catch (error) {
    log.error("Image import failed", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function listProjectImages(
  projectPath: string,
  publicDir: string,
): AssetListResult {
  const imagesDir = path.join(projectPath, publicDir, "images");
  const assets: AssetEntry[] = [];

  function walk(dir: string, prefix = ""): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? path.join(prefix, entry.name) : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (!IMAGE_EXTENSIONS.includes(ext)) continue;
      const stat = fs.statSync(full);
      assets.push({
        fileName: rel.split(path.sep).join("/"),
        size: stat.size,
        webPath: `/images/${rel.split(path.sep).join("/")}`,
      });
    }
  }

  try {
    if (!fs.existsSync(imagesDir)) return { ok: true, assets: [] };
    walk(imagesDir);
    assets.sort((a, b) => a.fileName.localeCompare(b.fileName));
    return { ok: true, assets };
  } catch (error) {
    log.error("Failed to list project images", error);
    return {
      ok: false,
      assets: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
