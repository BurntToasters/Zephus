import * as fs from "fs";
import * as path from "path";

const approvedProjectRoots = new Set<string>();

function canonicalProjectRoot(projectPath: string): string {
  if (typeof projectPath !== "string" || !projectPath) {
    throw new Error("Invalid project path.");
  }
  const resolved = path.resolve(projectPath);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function approveProjectRoot(projectPath: string): string {
  const root = canonicalProjectRoot(projectPath);
  approvedProjectRoots.add(root);
  return root;
}

export function assertApprovedProject(projectPath: string): void {
  const root = canonicalProjectRoot(projectPath);
  if (!approvedProjectRoots.has(root)) {
    throw new Error("Unauthorized project path.");
  }
}

export function approved<T>(projectPath: string, fn: () => T): T {
  assertApprovedProject(projectPath);
  return fn();
}
