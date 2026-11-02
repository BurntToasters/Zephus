import * as fs from "fs";
import * as path from "path";
import { pathEnvKey } from "./envPath";

export interface NpmCommand {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

/** Locates npm-cli.js for a validated absolute Node binary (never a PATH shim). */
export function resolveNpmCliJs(
  nodeBinary: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const dir = path.dirname(nodeBinary);
  const candidates =
    platform === "win32"
      ? [path.join(dir, "node_modules", "npm", "bin", "npm-cli.js")]
      : [
          path.join(
            dir,
            "..",
            "lib",
            "node_modules",
            "npm",
            "bin",
            "npm-cli.js",
          ),
          path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"),
        ];
  for (const candidate of candidates) {
    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      const realCli = fs.realpathSync.native(candidate);
      if (!npmCliRealpathInsideNodeInstall(realCli, nodeBinary, platform)) {
        continue;
      }
      return path.normalize(candidate);
    } catch {
      /* unreadable candidate */
    }
  }
  return null;
}

function nodeInstallRealpathRoots(
  nodeBinary: string,
  platform: NodeJS.Platform,
): string[] {
  const binDir = path.dirname(nodeBinary);
  const dirCandidates =
    platform === "win32" ? [binDir] : [binDir, path.join(binDir, "..")];
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const dir of dirCandidates) {
    try {
      const real = fs.realpathSync.native(dir);
      const key = platform === "win32" ? real.toLowerCase() : real;
      if (seen.has(key)) continue;
      seen.add(key);
      roots.push(real);
    } catch {
      /* skip */
    }
  }
  return roots;
}

function npmCliRealpathInsideNodeInstall(
  realCli: string,
  nodeBinary: string,
  platform: NodeJS.Platform,
): boolean {
  const roots = nodeInstallRealpathRoots(nodeBinary, platform);
  return roots.some((root) => {
    if (realCli === root) return true;
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    return realCli.startsWith(prefix);
  });
}

export function npmCommand(
  args: string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  _cwd?: string,
  nodeBinary?: string | null,
): NpmCommand {
  const customNode = nodeBinary?.trim();
  if (customNode && customNode !== "node" && path.isAbsolute(customNode)) {
    const cli = resolveNpmCliJs(customNode, platform);
    if (!cli) {
      throw new Error(
        "npm-cli.js was not found for the custom Node.js install, or it is not a regular file inside that install.",
      );
    }
    return { command: customNode, args: [cli, ...args] };
  }
  if (platform === "win32") {
    return { command: resolveWindowsNpmCmd(env), args: [...args] };
  }
  return { command: "npm", args };
}

function splitPathValue(pathValue: string): string[] {
  // Windows PATH always uses ';'. On POSIX test hosts, use host delimiter.
  const delimiter = pathValue.includes(";") ? ";" : path.delimiter;
  return pathValue.split(delimiter);
}

function isAbsolutePathLike(value: string): boolean {
  return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

export function resolveWindowsNpmCmd(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const candidates: string[] = [];
  const pathValue = env[pathEnvKey(env)] ?? "";
  for (const dir of splitPathValue(pathValue)) {
    const trimmed = dir.trim().replace(/^"|"$/g, "");
    if (!trimmed || !isAbsolutePathLike(trimmed)) continue;
    // Keep host-style join first so POSIX tests can resolve temp dirs exactly.
    candidates.push(path.join(trimmed, "npm.cmd"));
    if (path.win32.isAbsolute(trimmed)) {
      candidates.push(path.win32.join(trimmed, "npm.cmd"));
    }
  }
  if (env.APPDATA) {
    // Host-style first (like the PATH candidates) so POSIX test hosts can
    // resolve temp dirs exactly; win32 join covers real Windows installs.
    candidates.push(path.join(env.APPDATA, "npm", "npm.cmd"));
    if (path.win32.isAbsolute(env.APPDATA)) {
      candidates.push(path.win32.join(env.APPDATA, "npm", "npm.cmd"));
    }
  }
  const programFiles = env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  candidates.push(
    path.win32.join(programFiles, "nodejs", "npm.cmd"),
    path.win32.join(programFilesX86, "nodejs", "npm.cmd"),
  );

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    const key = normalized.replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (fs.existsSync(normalized)) return normalized;
    } catch {
      // Ignore invalid/unreadable candidate paths and keep searching.
    }
  }
  return path.win32.join(programFiles, "nodejs", "npm.cmd");
}
