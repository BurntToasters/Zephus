import * as fs from "fs";
import * as path from "path";
import { OperationResult } from "../types";

/** Resolves a project-relative path, rejecting traversal outside the project root. */
function safeResolve(projectPath: string, relativePath: string): string {
  const resolved = path.resolve(projectPath, relativePath);
  const rootWithSep = path.resolve(projectPath) + path.sep;
  if (
    resolved !== path.resolve(projectPath) &&
    !resolved.startsWith(rootWithSep)
  ) {
    throw new Error("Path escapes the project directory.");
  }
  return resolved;
}

export function readProjectFile(
  projectPath: string,
  relativePath: string,
): { ok: boolean; content?: string; error?: string } {
  try {
    const full = safeResolve(projectPath, relativePath);
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
