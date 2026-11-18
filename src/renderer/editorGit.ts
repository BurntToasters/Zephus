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

  // Git IPC can resolve long after the user closed or switched projects.
  // Publish only while the originating project is still open so a late result
  // cannot overwrite the Git panel or status line of a different project.
  function isCurrentProject(projectPath: string): boolean {
    return deps.getProjectPath() === projectPath;
  }

  function publishIfCurrent(projectPath: string, publish: () => void): void {
    if (isCurrentProject(projectPath)) {
      publish();
    }
  }

  async function runGitAction<T>(
    projectPath: string,
    label: string,
    run: () => Promise<T>,
    handle: (result: T) => Promise<void> | void,
  ): Promise<void> {
    let result: T;
    try {
      result = await enqueue(run);
    } catch (error) {
      publishIfCurrent(projectPath, () => {
        deps.setStatus(
          `${label}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      return;
    }
    if (!isCurrentProject(projectPath)) {
      return;
    }
    await handle(result);
  }

  async function refreshGitForProject(
    projectPath: string,
    options?: { fetchRemote?: boolean },
  ): Promise<void> {
    if (!isCurrentProject(projectPath)) {
      return;
    }
    try {
      const git = await enqueue(() =>
        deps.zephus.getGitStatus(projectPath, {
          fetchRemote: options?.fetchRemote ?? false,
        }),
      );
      publishIfCurrent(projectPath, () => deps.setGitStatus(git));
    } catch (error) {
      console.error("Failed to refresh Git status:", error);
      publishIfCurrent(projectPath, () => deps.setGitStatus(null));
    }
  }

  async function refreshGit(options?: {
    fetchRemote?: boolean;
  }): Promise<void> {
    const projectPath = deps.getProjectPath();
    if (!projectPath) {
      // No project was open when the refresh started; clear immediately so a
      // project opened later cannot inherit this state.
      deps.setGitStatus(null);
      return;
    }
    await refreshGitForProject(projectPath, options);
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
      projectPath,
      "Git commit failed",
      () => deps.zephus.commitGitChanges(projectPath, message, paths),
      async (result) => {
        if (!result.ok) {
          const error = result.error ?? "unknown";
          // Fresh git installs have no user.name/email — raw "Please tell me who
          // you are" reads as the app being broken on a first commit.
          if (/Please tell me who you are|user\.(name|email)/i.test(error)) {
            publishIfCurrent(projectPath, () =>
              deps.setStatus(
                'Git needs your identity first: run `git config --global user.name "Your Name"` and `git config --global user.email you@example.com`, then commit again.',
              ),
            );
            return;
          }
          publishIfCurrent(projectPath, () =>
            deps.setStatus("Git commit failed: " + error),
          );
          return;
        }
        publishIfCurrent(projectPath, () =>
          deps.setStatus(
            paths?.length
              ? `Committed ${paths.length} file(s).`
              : "Committed changes.",
          ),
        );
        await refreshGitForProject(projectPath, { fetchRemote: true });
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
      projectPath,
      "Git push failed",
      () => deps.zephus.pushGitChanges(projectPath),
      async (result) => {
        if (!result.ok) {
          publishIfCurrent(projectPath, () =>
            deps.setStatus("Git push failed: " + (result.error ?? "unknown")),
          );
          return;
        }
        publishIfCurrent(projectPath, () =>
          deps.setStatus("Pushed to remote."),
        );
        await refreshGitForProject(projectPath, { fetchRemote: true });
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
      projectPath,
      "Git pull failed",
      () => deps.zephus.pullGitChanges(projectPath),
      async (result) => {
        if (!result.ok) {
          publishIfCurrent(projectPath, () =>
            deps.setStatus("Git pull failed: " + (result.error ?? "unknown")),
          );
          return;
        }
        publishIfCurrent(projectPath, () =>
          deps.setStatus(
            "Pulled from remote (fast-forward). Reload from disk if page sources changed outside Zephus.",
          ),
        );
        if (!isCurrentProject(projectPath)) {
          return;
        }
        await deps.onPullComplete?.();
        await refreshGitForProject(projectPath, { fetchRemote: true });
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
      projectPath,
      "Git init failed",
      () => deps.zephus.initGitRepo(projectPath),
      async (result) => {
        if (!result.ok) {
          publishIfCurrent(projectPath, () =>
            deps.setStatus("Git init failed: " + (result.error ?? "unknown")),
          );
          return;
        }
        publishIfCurrent(projectPath, () =>
          deps.setStatus("Git repository initialized."),
        );
        await refreshGitForProject(projectPath, { fetchRemote: false });
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
