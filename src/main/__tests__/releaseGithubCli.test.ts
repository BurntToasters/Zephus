import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import githubCli from "../../../build-scripts/github-cli.js";
import releaseUploadPolicy from "../../../build-scripts/release-upload-policy.js";

const { githubCliEnvironment, githubStatusCode } = githubCli;
const { getReleaseUploadFiles, releaseSourceFailures, selectMatchingDraft } =
  releaseUploadPolicy;

describe("GitHub CLI release transport", () => {
  it("uses stored authentication instead of token environment variables", () => {
    const environment = {
      PATH: "/bin",
      GH_TOKEN: "old",
      GITHUB_TOKEN: "old-too",
    };

    expect(githubCliEnvironment(environment)).toEqual({ PATH: "/bin" });
    expect(environment).toEqual({
      PATH: "/bin",
      GH_TOKEN: "old",
      GITHUB_TOKEN: "old-too",
    });
  });

  it("extracts GitHub API status codes for retry and race handling", () => {
    expect(githubStatusCode("gh: Validation Failed (HTTP 422)")).toBe(422);
    expect(githubStatusCode("request failed with status code 503")).toBe(503);
    expect(githubStatusCode("network unavailable")).toBeUndefined();
  });

  it("uploads artifacts and every updater channel metadata file", () => {
    expect(
      getReleaseUploadFiles(
        [
          "Zephus.exe",
          "Zephus.exe.blockmap",
          "Zephus.exe.asc",
          "latest.yml",
          "beta.yml",
          "db-linux.yml",
          "SHA256SUMS-Windows.txt",
          "builder-debug.yml",
        ],
        "/release",
      ),
    ).toEqual([
      path.join("/release", "SHA256SUMS-Windows.txt"),
      path.join("/release", "Zephus.exe"),
      path.join("/release", "Zephus.exe.asc"),
      path.join("/release", "Zephus.exe.blockmap"),
      path.join("/release", "beta.yml"),
      path.join("/release", "db-linux.yml"),
      path.join("/release", "latest.yml"),
    ]);
  });

  it("disables electron-builder publishing in release commands", () => {
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    for (const [name, command] of Object.entries<string>(packageJson.scripts)) {
      if (name.startsWith("release:") && command.includes("electron-builder")) {
        expect(command).not.toContain("--publish always");
        expect(command).toContain("--publish never");
      }
    }
  });

  it("never reuses a published release as a draft", () => {
    const draft = { id: 1, tag_name: "v1.2.3", draft: true };
    const published = { id: 2, tag_name: "v1.2.3", draft: false };
    expect(selectMatchingDraft([published, draft], "v1.2.3")).toEqual({
      draft,
      published,
    });
    expect(selectMatchingDraft([published], "v1.2.3")).toEqual({
      draft: null,
      published,
    });
  });

  it("requires a clean checkout at the exact untagged target commit", () => {
    const sha = "a".repeat(40);
    expect(
      releaseSourceFailures({
        head: sha,
        targetCommit: sha,
        worktreeStatus: "",
        existingTagCommit: "",
      }),
    ).toEqual([]);
    expect(
      releaseSourceFailures({
        head: "b".repeat(40),
        targetCommit: sha,
        worktreeStatus: " M package.json",
        existingTagCommit: `${sha}\trefs/tags/v1.2.3`,
      }),
    ).toEqual([
      `Release checkout HEAD ${"b".repeat(40)} does not match target ${sha}.`,
      "Release checkout has uncommitted or untracked files.",
      "Release version already has a remote Git tag.",
    ]);
  });
});
