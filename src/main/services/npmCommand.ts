import * as fs from "fs";
import * as path from "path";
import { pathEnvKey } from "./envPath";

export interface NpmCommand {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

export function npmCommand(
  args: string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  cwd?: string,
): NpmCommand {
  if (platform === "win32") {
    const npm = resolveWindowsNpmCmd(env);
    const invocation = [
      quoteCmdArg(npm, true),
      ...args.map((arg) => quoteCmdArg(arg)),
    ].join(" ");
    const uncPrefix =
      cwd && /^\\\\/.test(cwd) ? `pushd ${quoteCmdArg(cwd, true)} && ` : "";
    return {
      command: "cmd.exe",
      // cmd /s strips the first and last quote. Wrap the entire command so
      // the quotes around an npm.cmd path containing spaces survive. Node
      // must pass this command line verbatim or it escapes those quotes and
      // cmd tries to execute a literal `\"C:\\Program` command instead.
      args: ["/d", "/s", "/c", `"${uncPrefix}${invocation}"`],
      windowsVerbatimArguments: true,
    };
  }
  return { command: "npm", args };
}

function quoteCmdArg(value: string, forceQuote = false): string {
  if (!forceQuote && /^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  // cmd.exe expands %VAR% even inside double quotes — a path containing % is
  // corrupted before the command runs. Doubling escapes it.
  return `"${value.replace(/"/g, '""').replace(/%/g, "%%")}"`;
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
