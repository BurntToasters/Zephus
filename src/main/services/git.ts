import { execFile } from "child_process";
import { promisify } from "util";
import log from "electron-log";
import { GitStatus } from "../types";

const execFileAsync = promisify(execFile);

async function git(projectPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: projectPath,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Reports the git status of a project: branch (or detached HEAD) and the
 * lists of modified, added, and deleted files in the working tree.
 */
export async function getGitStatus(projectPath: string): Promise<GitStatus> {
  const empty: GitStatus = {
    available: false,
    branch: null,
    detachedHead: false,
    modified: [],
    added: [],
    deleted: [],
  };

  try {
    const branchRaw = (
      await git(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"])
    ).trim();
    const detachedHead = branchRaw === "HEAD";

    const statusRaw = await git(projectPath, ["status", "--porcelain"]);
    const modified: string[] = [];
    const added: string[] = [];
    const deleted: string[] = [];

    for (const line of statusRaw.split("\n")) {
      if (!line.trim()) continue;
      const code = line.slice(0, 2);
      const file = line.slice(3).trim();
      if (code.includes("D")) deleted.push(file);
      else if (code.includes("A") || code.includes("?")) added.push(file);
      else if (code.includes("M") || code.includes("R")) modified.push(file);
    }

    return {
      available: true,
      branch: detachedHead ? null : branchRaw,
      detachedHead,
      modified,
      added,
      deleted,
    };
  } catch (error) {
    log.warn("Git status unavailable for project", projectPath, error);
    return {
      ...empty,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function initGitRepo(projectPath: string): Promise<void> {
  await git(projectPath, ["init"]);
}
