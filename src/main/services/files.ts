import * as fs from "fs";
import * as path from "path";
import { OperationResult } from "../types";

/**
 * Rejects reads/writes of sensitive project files that the visual editor never
 * needs but that a compromised renderer could try to exfiltrate or tamper with
 * (git internals and dotenv secret files). The `.zephus/` save state is managed
 * through dedicated schema/draft services, not this generic file bridge.
 */
function assertEditablePath(relativePath: string): void {
  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (lower === ".git") {
      throw new Error("Access to git internals is not allowed.");
    }
    if (lower === ".env" || lower.startsWith(".env.")) {
      throw new Error("Access to environment files is not allowed.");
    }
  }
}

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
    assertEditablePath(relativePath);
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
    assertEditablePath(relativePath);
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
