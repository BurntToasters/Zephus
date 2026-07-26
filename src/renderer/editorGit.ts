/**
 * Git panel actions for the editor. Keeps IPC wiring out of zephusEngine.
 */

export interface EditorGitDeps {
  getProjectPath: () => string | null;
  setStatus: (message: string) => void;
  refreshGit: () => Promise<void>;
  zephus: Pick<
    Window["zephus"],
    "commitGitChanges" | "pushGitChanges" | "pullGitChanges" | "initGitRepo"
  >;
}

export function createEditorGitActions(deps: EditorGitDeps) {
  async function commitGitChanges(
    message: string,
    paths?: string[],
  ): Promise<void> {
    const projectPath = deps.getProjectPath();
    if (!projectPath) {
      deps.setStatus("No project open to commit.");
      return;
    }
    const result = await deps.zephus.commitGitChanges(
      projectPath,
      message,
      paths,
    );
    if (!result.ok) {
      deps.setStatus("Git commit failed: " + (result.error ?? "unknown"));
      return;
    }
    deps.setStatus(
      paths?.length
        ? `Committed ${paths.length} file(s).`
        : "Committed changes.",
    );
    await deps.refreshGit();
  }

  async function pushGitChanges(): Promise<void> {
    const projectPath = deps.getProjectPath();
    if (!projectPath) {
      deps.setStatus("No project open to push.");
      return;
    }
    const result = await deps.zephus.pushGitChanges(projectPath);
    if (!result.ok) {
      deps.setStatus("Git push failed: " + (result.error ?? "unknown"));
      return;
    }
    deps.setStatus("Pushed to remote.");
    await deps.refreshGit();
  }

  async function pullGitChanges(): Promise<void> {
    const projectPath = deps.getProjectPath();
    if (!projectPath) {
      deps.setStatus("No project open to pull.");
      return;
    }
    const result = await deps.zephus.pullGitChanges(projectPath);
    if (!result.ok) {
      deps.setStatus("Git pull failed: " + (result.error ?? "unknown"));
      return;
    }
    deps.setStatus(
      "Pulled from remote (fast-forward). Reload from disk if page sources changed outside Zephus.",
    );
    await deps.refreshGit();
  }

  async function initGitFromPanel(): Promise<void> {
    const projectPath = deps.getProjectPath();
    if (!projectPath) {
      deps.setStatus("No project open to initialize Git.");
      return;
    }
    const result = await deps.zephus.initGitRepo(projectPath);
    if (!result.ok) {
      deps.setStatus("Git init failed: " + (result.error ?? "unknown"));
      return;
    }
    deps.setStatus("Git repository initialized.");
    await deps.refreshGit();
  }

  return {
    commitGitChanges,
    pushGitChanges,
    pullGitChanges,
    initGitFromPanel,
  };
}
