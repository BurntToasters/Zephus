export interface NpmCommand {
  command: string;
  args: string[];
}

/**
 * Builds a command that can run npm on every supported OS.
 * Recent Windows Node/Electron versions reject direct `.cmd` spawn/execFile
 * calls with EINVAL, so route npm.cmd through cmd.exe without enabling shell.
 */
export function npmCommand(
  args: string[],
  platform: NodeJS.Platform = process.platform,
): NpmCommand {
  if (platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", ...args],
    };
  }
  return { command: "npm", args };
}
