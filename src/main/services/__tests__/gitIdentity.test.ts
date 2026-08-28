import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { commitAllChanges } from "../git";
import { getGitStatus } from "../git";

function expectFailure(result: {
  ok: boolean;
  error?: string;
}): asserts result is { ok: false; error: string } {
  expect(result.ok).toBe(false);
  expect(result.error).toBeTruthy();
}

describe("git identity and status", () => {
  it("reports a missing-identity error for the renderer to translate", async () => {
    if (
      !fs.existsSync("/usr/bin/git") &&
      !fs.existsSync("/opt/homebrew/bin/git")
    )
      return;
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-git-id-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
      fs.writeFileSync(path.join(repo, "a.txt"), "x");
      execFileSync("git", ["add", "-A"], { cwd: repo });
      // Wipe identity config so the commit fails with the telltale error
      // (git() spreads process.env, so a temporary HOME works).
      const realHome = process.env.HOME;
      const realGlobal = process.env.GIT_CONFIG_GLOBAL;
      const fakeHome = fs.mkdtempSync(
        path.join(os.tmpdir(), "zephus-git-home-"),
      );
      process.env.HOME = fakeHome;
      process.env.GIT_CONFIG_GLOBAL = "/dev/null";
      process.env.GIT_CONFIG_SYSTEM = "/dev/null";
      // Block git's username/email auto-guessing so the commit must fail.
      process.env.GIT_CONFIG_COUNT = "1";
      process.env.GIT_CONFIG_KEY_0 = "user.useConfigOnly";
      process.env.GIT_CONFIG_VALUE_0 = "true";
      let result;
      try {
        result = await commitAllChanges(repo, "msg");
      } finally {
        process.env.HOME = realHome;
        if (realGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
        else process.env.GIT_CONFIG_GLOBAL = realGlobal;
        delete process.env.GIT_CONFIG_SYSTEM;
        delete process.env.GIT_CONFIG_COUNT;
        delete process.env.GIT_CONFIG_KEY_0;
        delete process.env.GIT_CONFIG_VALUE_0;
        fs.rmSync(fakeHome, { recursive: true, force: true });
      }
      expect(result.ok).toBe(false);
      expectFailure(result);
      expect(result.error).toMatch(/Please tell me who you are|user\.name/i);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("reports status for a repo with no remote", async () => {
    if (
      !fs.existsSync("/usr/bin/git") &&
      !fs.existsSync("/opt/homebrew/bin/git")
    )
      return;
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-git-st-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
      fs.writeFileSync(path.join(repo, "a.txt"), "x");
      const status = await getGitStatus(repo);
      expect(status.available).toBe(true);
      expect(status.hasRemote).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
