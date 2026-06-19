import * as fs from "fs";
import * as path from "path";

export interface NpmCommand {
  command: string;
  args: string[];
}

export function npmCommand(
  args: string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): NpmCommand {
  if (platform === "win32") {
    const npm = resolveWindowsNpmCmd(env);
    return {
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        [quoteCmdArg(npm), ...args.map(quoteCmdArg)].join(" "),
      ],
    };
  }
  return { command: "npm", args };
}

function quoteCmdArg(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function pathEnvKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
}

export function resolveWindowsNpmCmd(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const candidates: string[] = [];
  const pathValue = env[pathEnvKey(env)] ?? "";
  for (const dir of pathValue.split(";")) {
    const trimmed = dir.trim().replace(/^"|"$/g, "");
    if (!trimmed || !path.win32.isAbsolute(trimmed)) continue;
    candidates.push(path.win32.join(trimmed, "npm.cmd"));
  }
  if (env.APPDATA) {
    candidates.push(path.win32.join(env.APPDATA, "npm", "npm.cmd"));
  }
  const programFiles = env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  candidates.push(
    path.win32.join(programFiles, "nodejs", "npm.cmd"),
    path.win32.join(programFilesX86, "nodejs", "npm.cmd"),
  );

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = path.win32.normalize(candidate);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (fs.existsSync(normalized)) return normalized;
    } catch {}
  }
  return path.win32.join(programFiles, "nodejs", "npm.cmd");
}
