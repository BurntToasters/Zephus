import * as fs from "fs";
import * as path from "path";
import { OperationResult } from "../types";

/** Resolves a project-relative path, rejecting traversal outside the project root. */
function safeResolve(projectPath: string, relativePath: string): string {
  const resolved = path.resolve(projectPath, relativePath);
  const root = path.resolve(projectPath);
  const rootWithSep = root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error("Path escapes the project directory.");
  }
  return resolved;
}

function realpathInsideProject(projectPath: string, targetPath: string): void {
  const root = fs.realpathSync.native(projectPath);
  let existingPath = targetPath;
  while (!fs.existsSync(existingPath)) {
    const parent = path.dirname(existingPath);
    if (parent === existingPath) {
      throw new Error("Path escapes the project directory.");
    }
    existingPath = parent;
  }
  const realTarget = fs.realpathSync.native(existingPath);
  if (realTarget !== root && !realTarget.startsWith(root + path.sep)) {
    throw new Error("Path escapes the project directory.");
  }
}

export function readProjectFile(
  projectPath: string,
  relativePath: string,
): { ok: boolean; content?: string; error?: string } {
  try {
    const full = safeResolve(projectPath, relativePath);
    realpathInsideProject(projectPath, full);
    return { ok: true, content: fs.readFileSync(full, "utf8") };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function writeProjectFile(
  projectPath: string,
  relativePath: string,
  content: string,
): OperationResult {
  try {
    const full = safeResolve(projectPath, relativePath);
    realpathInsideProject(projectPath, full);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
