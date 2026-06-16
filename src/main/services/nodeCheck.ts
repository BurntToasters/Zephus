import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import log from "electron-log";

const execFileAsync = promisify(execFile);

export interface NodePathValidation {
  ok: boolean;
  /** The validated, normalized absolute path (only when ok). */
  path?: string;
  error?: string;
}

/**
 * Validates a user/renderer-supplied custom Node.js binary path *before* it is
 * persisted or executed. A renderer compromise must not be able to point the
 * app at an arbitrary executable that is later spawned (defense in depth on top
 * of contextIsolation/sandbox). Requirements:
 *   - absolute path
 *   - exists and is a regular file (symlinks to a file are allowed via stat)
 *   - basename is `node` or `node.exe` (case-insensitive)
 * Pure/synchronous and never spawns the binary; safe to call on every write.
 */
export function validateNodePath(input: unknown): NodePathValidation {
  if (typeof input !== "string" || input.trim().length === 0) {
    return { ok: false, error: "Node.js path must be a non-empty string." };
  }
  const candidate = input.trim();
  if (!path.isAbsolute(candidate)) {
    return { ok: false, error: "Node.js path must be absolute." };
  }
  const base = path.basename(candidate).toLowerCase();
  if (base !== "node" && base !== "node.exe") {
    return {
      ok: false,
      error: 'Node.js path must point at a file named "node" or "node.exe".',
    };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(candidate);
  } catch {
    return { ok: false, error: "Node.js path does not exist." };
  }
  if (!stat.isFile()) {
    return { ok: false, error: "Node.js path is not a regular file." };
  }
  return { ok: true, path: candidate };
}

/**
 * Minimum Node.js version required to build/preview Astro 6 projects.
 * Astro 6 dropped support for Node 18 and 20.
 */
export const MIN_NODE_VERSION = { major: 22, minor: 12, patch: 0 } as const;

export const MIN_NODE_VERSION_STRING = `${MIN_NODE_VERSION.major}.${MIN_NODE_VERSION.minor}.${MIN_NODE_VERSION.patch}`;

export type NodeCheckStatus = "ok" | "outdated" | "missing" | "unknown";

export interface NodeCheckResult {
  status: NodeCheckStatus;
  /** The detected version string (e.g. "22.12.0"), if any. */
  version: string | null;
  /** Absolute path (or "node") of the binary that produced the version. */
  binaryPath: string | null;
  /** Whether the resolved binary came from the user's custom setting. */
  usedCustomPath: boolean;
  /** Human-readable summary suitable for a dialog. */
  message: string;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

interface ResolvedNode {
  path: string;
  version: ParsedVersion;
  usedCustomPath: boolean;
}

/**
 * Parses the output of `node --version` (e.g. "v22.12.0\n") into components.
 * Returns null if the string cannot be parsed.
 */
export function parseNodeVersion(output: string): ParsedVersion | null {
  const match = /v?(\d+)\.(\d+)\.(\d+)/.exec(output.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/** Returns true if `version` is greater than or equal to the minimum. */
export function meetsMinimumNodeVersion(version: ParsedVersion): boolean {
  const { major, minor, patch } = version;
  if (major !== MIN_NODE_VERSION.major) return major > MIN_NODE_VERSION.major;
  if (minor !== MIN_NODE_VERSION.minor) return minor > MIN_NODE_VERSION.minor;
  return patch >= MIN_NODE_VERSION.patch;
}

/**
 * Common locations where a Node.js binary lands from the official .pkg
 * installer, Homebrew, system package managers, and version managers.
 * These are tried (in order) when `node` is not on the app's PATH, which is
 * common for GUI-launched apps on macOS that don't inherit the shell PATH.
 */
export function commonNodePaths(homedir: string = os.homedir()): string[] {
  if (process.platform === "darwin") {
    return [
      "/usr/local/bin/node", // official .pkg installer + Intel Homebrew
      "/opt/homebrew/bin/node", // Apple Silicon Homebrew
      "/usr/local/opt/node/bin/node", // Homebrew keg
      path.join(homedir, ".volta/bin/node"), // Volta
      path.join(homedir, ".nvm/current/bin/node"), // nvm "current" symlink
    ];
  }
  if (process.platform === "win32") {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 =
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    return [
      path.join(programFiles, "nodejs", "node.exe"),
      path.join(programFilesX86, "nodejs", "node.exe"),
      path.join(homedir, "AppData", "Roaming", "npm", "node.exe"),
    ];
  }
  // linux and others
  return [
    "/usr/local/bin/node",
    "/usr/bin/node",
    "/snap/bin/node",
    path.join(homedir, ".volta/bin/node"),
  ];
}

/** Runs `<binary> --version` and returns the parsed version, or null. */
async function probeNode(binary: string): Promise<ParsedVersion | null> {
  try {
    const { stdout } = await execFileAsync(binary, ["--version"], {
      windowsHide: true,
      timeout: 10_000,
    });
    return parseNodeVersion(stdout);
  } catch {
    return null;
  }
}

/**
 * Resolves a usable Node.js binary. Order of preference:
 *   1. The user's custom path (if set and working) — always respected.
 *   2. `node` on the app's PATH, then common install locations: the first that
 *      meets the minimum version wins; otherwise the first that works at all
 *      (so the result can still report an outdated version).
 */
async function resolveNodeBinary(
  customPath?: string | null,
): Promise<ResolvedNode | null> {
  const trimmedCustom = customPath?.trim();
  if (trimmedCustom) {
    const version = await probeNode(trimmedCustom);
    if (version) {
      return { path: trimmedCustom, version, usedCustomPath: true };
    }
  }

  const candidates = ["node", ...commonNodePaths()];
  const seen = new Set<string>();
  let firstWorking: ResolvedNode | null = null;

  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const version = await probeNode(candidate);
    if (!version) continue;
    const resolved: ResolvedNode = {
      path: candidate,
      version,
      usedCustomPath: false,
    };
    if (meetsMinimumNodeVersion(version)) return resolved;
    if (!firstWorking) firstWorking = resolved;
  }

  return firstWorking;
}

/**
 * Evaluates a raw `node --version` string into a check result. Pure function,
 * separated from process spawning so it can be unit tested.
 */
export function evaluateNodeVersionOutput(output: string): NodeCheckResult {
  const parsed = parseNodeVersion(output);
  if (!parsed) {
    return {
      status: "unknown",
      version: null,
      binaryPath: null,
      usedCustomPath: false,
      message:
        `Could not determine your Node.js version. Zephus needs Node.js ` +
        `${MIN_NODE_VERSION_STRING} or newer to build and preview Astro sites.`,
    };
  }

  const version = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  if (meetsMinimumNodeVersion(parsed)) {
    return {
      status: "ok",
      version,
      binaryPath: null,
      usedCustomPath: false,
      message: `Node.js ${version} detected.`,
    };
  }

  return {
    status: "outdated",
    version,
    binaryPath: null,
    usedCustomPath: false,
    message:
      `Zephus requires Node.js ${MIN_NODE_VERSION_STRING} or newer to build ` +
      `and preview Astro sites. Detected Node.js ${version}.`,
  };
}

const MISSING_MESSAGE =
  `Node.js was not found. Zephus needs Node.js ${MIN_NODE_VERSION_STRING} or ` +
  `newer installed to build and preview Astro sites.\n\n` +
  `Install Node.js from https://nodejs.org, or set a custom Node.js location ` +
  `in Settings if it is installed in a non-standard directory.`;

/**
 * Resolves and evaluates the Node.js the app will use to spawn builds.
 * Considers the optional user-configured custom path first. Never throws.
 */
export async function checkNodeVersion(
  customPath?: string | null,
): Promise<NodeCheckResult> {
  try {
    const resolved = await resolveNodeBinary(customPath);
    if (!resolved) {
      return {
        status: "missing",
        version: null,
        binaryPath: null,
        usedCustomPath: false,
        message: MISSING_MESSAGE,
      };
    }

    const version = `${resolved.version.major}.${resolved.version.minor}.${resolved.version.patch}`;
    const meets = meetsMinimumNodeVersion(resolved.version);
    const sourceNote = resolved.usedCustomPath
      ? ` (custom location: ${resolved.path})`
      : "";

    if (meets) {
      return {
        status: "ok",
        version,
        binaryPath: resolved.path,
        usedCustomPath: resolved.usedCustomPath,
        message: `Node.js ${version} detected${sourceNote}.`,
      };
    }

    return {
      status: "outdated",
      version,
      binaryPath: resolved.path,
      usedCustomPath: resolved.usedCustomPath,
      message:
        `Zephus requires Node.js ${MIN_NODE_VERSION_STRING} or newer to build ` +
        `and preview Astro sites. Detected Node.js ${version}${sourceNote}.\n\n` +
        `Please update Node.js or set a custom Node.js location in Settings, ` +
        `then restart Zephus.`,
    };
  } catch (error) {
    log.warn("Node version check failed:", error);
    return {
      status: "unknown",
      version: null,
      binaryPath: null,
      usedCustomPath: false,
      message:
        `Could not verify your Node.js version. Zephus needs Node.js ` +
        `${MIN_NODE_VERSION_STRING} or newer to build and preview Astro sites.`,
    };
  }
}

/** Returns the PATH-like key present in an env object (defaults to "PATH"). */
function pathEnvKey(env: NodeJS.ProcessEnv): string {
  const existing = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
  return existing ?? "PATH";
}

/**
 * Builds a spawn environment that guarantees the resolved Node.js (and its
 * sibling `npm`) are reachable, by prepending the resolved binary's directory
 * to PATH. When Node is already on PATH (resolved as bare "node"), the base
 * env is returned unchanged. Never throws.
 */
export async function buildSpawnEnv(
  customPath?: string | null,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  try {
    const resolved = await resolveNodeBinary(customPath);
    if (
      !resolved ||
      resolved.path === "node" ||
      !path.isAbsolute(resolved.path)
    ) {
      return { ...baseEnv };
    }
    const dir = path.dirname(resolved.path);
    const key = pathEnvKey(baseEnv);
    const sep = process.platform === "win32" ? ";" : ":";
    const current = baseEnv[key];
    return {
      ...baseEnv,
      [key]: current ? `${dir}${sep}${current}` : dir,
    };
  } catch (error) {
    log.warn("Failed to build spawn env for Node:", error);
    return { ...baseEnv };
  }
}
