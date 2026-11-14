/**
 * Git panel actions for the editor. Keeps IPC wiring out of zephusEngine.
 */

export interface GitStatusSnapshot {
  available: boolean;
  detachedHead: boolean;
  branch: string | null;
  zephusIgnored?: boolean;
  notARepository?: boolean;
  error?: string;
  ahead?: number;
  behind?: number;
  modified: string[];
  added: string[];
  deleted: string[];
}

export interface EditorGitDeps {
  getProjectPath: () => string | null;
  setStatus: (message: string) => void;
  setGitStatus: (status: GitStatusSnapshot | null) => void;
  onPullComplete?: () => void | Promise<void>;
  zephus: Pick<
    Window["zephus"],
    | "getGitStatus"
    | "commitGitChanges"
    | "pushGitChanges"
    | "pullGitChanges"
    | "initGitRepo"
  >;
}

export function createEditorGitActions(deps: EditorGitDeps) {
  // Serialize every git operation on a single chain: concurrent commits can
  // collide on git's index.lock (spurious "commit failed"), and a refresh
  // running during a push/pull could snapshot a mid-transition status.
  let gitChain: Promise<void> = Promise.resolve();

  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = gitChain.then(run);
    gitChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async function runGitAction<T>(
    label: string,
    run: () => Promise<T>,
    handle: (result: T) => Promise<void> | void,
  ): Promise<void> {
    let result: T;
    try {
      result = await enqueue(run);
    } catch (error) {
      deps.setStatus(
        `${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    await handle(result);
  }

  async function refreshGit(options?: {
    fetchRemote?: boolean;
  }): Promise<void> {
    const projectPath = deps.getProjectPath();
    if (!projectPath) {
      deps.setGitStatus(null);
      return;
    }
    try {
      const git = await enqueue(() =>
        deps.zephus.getGitStatus(projectPath, {
          fetchRemote: options?.fetchRemote ?? false,
        }),
      );
      deps.setGitStatus(git);
    } catch (error) {
      console.error("Failed to refresh Git status:", error);
      deps.setGitStatus(null);
    }
  }

  async function commitGitChanges(
    message: string,
    paths?: string[],
  ): Promise<void> {
    const projectPath = deps.getProjectPath();
    if (!projectPath) {
      deps.setStatus("No project open to commit.");
      return;
    }
    await runGitAction(
      "Git commit failed",
      () => deps.zephus.commitGitChanges(projectPath, message, paths),
      async (result) => {
        if (!result.ok) {
          const error = result.error ?? "unknown";
          // Fresh git installs have no user.name/email — raw "Please tell me who
          // you are" reads as the app being broken on a first commit.
          if (/Please tell me who you are|user\.(name|email)/i.test(error)) {
            deps.setStatus(
              'Git needs your identity first: run `git config --global user.name "Your Name"` and `git config --global user.email you@example.com`, then commit again.',
            );
            return;
          }
          deps.setStatus("Git commit failed: " + error);
          return;
        }
        deps.setStatus(
          paths?.length
            ? `Committed ${paths.length} file(s).`
            : "Committed changes.",
        );
        await refreshGit({ fetchRemote: true });
      },
    );
  }

  async function pushGitChanges(): Promise<void> {
    const projectPath = deps.getProjectPath();
    if (!projectPath) {
      deps.setStatus("No project open to push.");
      return;
    }
    await runGitAction(
      "Git push failed",
      () => deps.zephus.pushGitChanges(projectPath),
      async (result) => {
        if (!result.ok) {
          deps.setStatus("Git push failed: " + (result.error ?? "unknown"));
          return;
        }
        deps.setStatus("Pushed to remote.");
        await refreshGit({ fetchRemote: true });
      },
    );
  }

  async function pullGitChanges(): Promise<void> {
    const projectPath = deps.getProjectPath();
    if (!projectPath) {
      deps.setStatus("No project open to pull.");
      return;
    }
    await runGitAction(
      "Git pull failed",
      () => deps.zephus.pullGitChanges(projectPath),
      async (result) => {
        if (!result.ok) {
          deps.setStatus("Git pull failed: " + (result.error ?? "unknown"));
          return;
        }
        deps.setStatus(
          "Pulled from remote (fast-forward). Reload from disk if page sources changed outside Zephus.",
        );
        await deps.onPullComplete?.();
        await refreshGit({ fetchRemote: true });
      },
    );
  }

  async function initGitFromPanel(): Promise<void> {
    const projectPath = deps.getProjectPath();
    if (!projectPath) {
      deps.setStatus("No project open to initialize Git.");
      return;
    }
    await runGitAction(
      "Git init failed",
      () => deps.zephus.initGitRepo(projectPath),
      async (result) => {
        if (!result.ok) {
          deps.setStatus("Git init failed: " + (result.error ?? "unknown"));
          return;
        }
        deps.setStatus("Git repository initialized.");
        await refreshGit({ fetchRemote: false });
      },
    );
  }

  return {
    refreshGit,
    commitGitChanges,
    pushGitChanges,
    pullGitChanges,
    initGitFromPanel,
  };
}
