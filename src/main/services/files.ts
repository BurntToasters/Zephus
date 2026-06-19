import * as fs from "fs";
import * as path from "path";
import { OperationResult } from "../types";
import { assertRealpathInside, safeResolve } from "./fsSafe";

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

// Files that get executed by the project's npm scripts (dev/build/install).
// The generic write bridge must not be able to rewrite them — a compromised
// renderer could otherwise inject a malicious script that main later spawns.
const PROTECTED_WRITE_TARGETS = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "npm",
  "npm.cmd",
  "npx",
  "npx.cmd",
  "node",
  "node.exe",
]);
const PROTECTED_WRITE_EXTENSIONS = new Set([
  ".bat",
  ".cmd",
  ".com",
  ".exe",
  ".msi",
  ".ps1",
  ".vbs",
]);

function assertWritablePath(relativePath: string): void {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const base = normalized.split("/").pop() ?? "";
  const ext = path.extname(base);
  if (
    PROTECTED_WRITE_TARGETS.has(base) ||
    PROTECTED_WRITE_EXTENSIONS.has(ext) ||
    /^astro\.config\.[mc]?[jt]s$/.test(base)
  ) {
    throw new Error(
      "This file is managed by the project and cannot be edited here.",
    );
  }
}

export function readProjectFile(
  projectPath: string,
  relativePath: string,
): { ok: boolean; content?: string; error?: string } {
  try {
    const full = safeResolve(projectPath, relativePath);
    assertEditablePath(relativePath);
    const { realRoot, realTarget } = assertRealpathInside(projectPath, full);
    // Re-check the denylist against the symlink-resolved path so an in-project
    // symlink (e.g. notes.txt -> .env) cannot bypass the name-based check.
    assertEditablePath(path.relative(realRoot, realTarget));
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
    assertWritablePath(relativePath);
    const { realRoot, realTarget } = assertRealpathInside(projectPath, full);
    const resolvedRel = path.relative(realRoot, realTarget);
    assertEditablePath(resolvedRel);
    assertWritablePath(resolvedRel);
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
