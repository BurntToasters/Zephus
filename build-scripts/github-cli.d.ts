import type { SpawnSyncReturns } from "node:child_process";

interface GitHubCli {
  assertGitHubCliAuthenticated(): void;
  githubApi(method: string, endpoint: string, body?: unknown): unknown;
  githubCliEnvironment(environment?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  githubStatusCode(detail: unknown): number | undefined;
  runGitHub(
    args: string[],
    options?: { input?: string },
  ): SpawnSyncReturns<string>;
  uploadReleaseAsset(repository: string, tag: string, filePath: string): void;
}

declare const githubCli: GitHubCli;

export = githubCli;
