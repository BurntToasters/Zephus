import { describe, it, expect, vi } from "vitest";
import { createEditorGitActions } from "../editorGit";

describe("editorGit", () => {
  it("refreshes git status for the open project", async () => {
    const setGitStatus = vi.fn();
    const getGitStatus = vi.fn(async () => ({
      available: true,
      detachedHead: false,
      branch: "main",
      modified: [],
      added: [],
      deleted: [],
    }));
    const actions = createEditorGitActions({
      getProjectPath: () => "/proj",
      setStatus: vi.fn(),
      setGitStatus,
      zephus: {
        getGitStatus,
        commitGitChanges: vi.fn(),
        pushGitChanges: vi.fn(),
        pullGitChanges: vi.fn(),
        initGitRepo: vi.fn(),
      },
    });

    await actions.refreshGit();

    expect(getGitStatus).toHaveBeenCalledWith("/proj", { fetchRemote: false });
    expect(setGitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "main" }),
    );
  });

  it("requests remote fetch when asked", async () => {
    const getGitStatus = vi.fn(async () => ({
      available: true,
      detachedHead: false,
      branch: "main",
      modified: [],
      added: [],
      deleted: [],
    }));
    const actions = createEditorGitActions({
      getProjectPath: () => "/proj",
      setStatus: vi.fn(),
      setGitStatus: vi.fn(),
      zephus: {
        getGitStatus,
        commitGitChanges: vi.fn(),
        pushGitChanges: vi.fn(),
        pullGitChanges: vi.fn(),
        initGitRepo: vi.fn(),
      },
    });

    await actions.refreshGit({ fetchRemote: true });

    expect(getGitStatus).toHaveBeenCalledWith("/proj", { fetchRemote: true });
  });

  it("commits selected paths and refreshes", async () => {
    const setGitStatus = vi.fn();
    const commitGitChanges = vi.fn(async () => ({ ok: true as const }));
    const setStatus = vi.fn();
    const actions = createEditorGitActions({
      getProjectPath: () => "/proj",
      setStatus,
      setGitStatus,
      zephus: {
        getGitStatus: vi.fn(async () => ({
          available: true,
          detachedHead: false,
          branch: "main",
          modified: [],
          added: [],
          deleted: [],
        })),
        commitGitChanges,
        pushGitChanges: vi.fn(),
        pullGitChanges: vi.fn(),
        initGitRepo: vi.fn(),
      },
    });

    await actions.commitGitChanges("save", ["a.ts", "b.ts"]);

    expect(commitGitChanges).toHaveBeenCalledWith("/proj", "save", [
      "a.ts",
      "b.ts",
    ]);
    expect(setStatus).toHaveBeenCalledWith("Committed 2 file(s).");
    expect(setGitStatus).toHaveBeenCalled();
  });

  it("surfaces commit failures", async () => {
    const setStatus = vi.fn();
    const actions = createEditorGitActions({
      getProjectPath: () => "/proj",
      setStatus,
      setGitStatus: vi.fn(),
      zephus: {
        getGitStatus: vi.fn(),
        commitGitChanges: vi.fn(async () => ({
          ok: false as const,
          error: "nothing to commit",
        })),
        pushGitChanges: vi.fn(),
        pullGitChanges: vi.fn(),
        initGitRepo: vi.fn(),
      },
    });

    await actions.commitGitChanges("empty");

    expect(setStatus).toHaveBeenCalledWith(
      "Git commit failed: nothing to commit",
    );
  });

  it("pushes and refreshes on success", async () => {
    const setStatus = vi.fn();
    const setGitStatus = vi.fn();
    const pushGitChanges = vi.fn(async () => ({ ok: true as const }));
    const actions = createEditorGitActions({
      getProjectPath: () => "/proj",
      setStatus,
      setGitStatus,
      zephus: {
        getGitStatus: vi.fn(async () => ({
          available: true,
          detachedHead: false,
          branch: "main",
          modified: [],
          added: [],
          deleted: [],
        })),
        commitGitChanges: vi.fn(),
        pushGitChanges,
        pullGitChanges: vi.fn(),
        initGitRepo: vi.fn(),
      },
    });

    await actions.pushGitChanges();

    expect(pushGitChanges).toHaveBeenCalledWith("/proj");
    expect(setStatus).toHaveBeenCalledWith("Pushed to remote.");
    expect(setGitStatus).toHaveBeenCalled();
  });

  it("surfaces push failures", async () => {
    const setStatus = vi.fn();
    const actions = createEditorGitActions({
      getProjectPath: () => "/proj",
      setStatus,
      setGitStatus: vi.fn(),
      zephus: {
        getGitStatus: vi.fn(),
        commitGitChanges: vi.fn(),
        pushGitChanges: vi.fn(async () => ({
          ok: false as const,
          error: "rejected",
        })),
        pullGitChanges: vi.fn(),
        initGitRepo: vi.fn(),
      },
    });

    await actions.pushGitChanges();
    expect(setStatus).toHaveBeenCalledWith("Git push failed: rejected");
  });

  it("pulls fast-forward and refreshes", async () => {
    const setStatus = vi.fn();
    const setGitStatus = vi.fn();
    const pullGitChanges = vi.fn(async () => ({ ok: true as const }));
    const actions = createEditorGitActions({
      getProjectPath: () => "/proj",
      setStatus,
      setGitStatus,
      zephus: {
        getGitStatus: vi.fn(async () => ({
          available: true,
          detachedHead: false,
          branch: "main",
          modified: [],
          added: [],
          deleted: [],
        })),
        commitGitChanges: vi.fn(),
        pushGitChanges: vi.fn(),
        pullGitChanges,
        initGitRepo: vi.fn(),
      },
    });

    await actions.pullGitChanges();

    expect(pullGitChanges).toHaveBeenCalledWith("/proj");
    expect(setStatus).toHaveBeenCalledWith(
      expect.stringContaining("Pulled from remote"),
    );
    expect(setGitStatus).toHaveBeenCalled();
  });

  it("surfaces pull failures", async () => {
    const setStatus = vi.fn();
    const actions = createEditorGitActions({
      getProjectPath: () => "/proj",
      setStatus,
      setGitStatus: vi.fn(),
      zephus: {
        getGitStatus: vi.fn(),
        commitGitChanges: vi.fn(),
        pushGitChanges: vi.fn(),
        pullGitChanges: vi.fn(async () => ({
          ok: false as const,
          error: "need merge",
        })),
        initGitRepo: vi.fn(),
      },
    });

    await actions.pullGitChanges();
    expect(setStatus).toHaveBeenCalledWith("Git pull failed: need merge");
  });

  it("initializes a repository and refreshes", async () => {
    const setStatus = vi.fn();
    const setGitStatus = vi.fn();
    const initGitRepo = vi.fn(async () => ({ ok: true as const }));
    const actions = createEditorGitActions({
      getProjectPath: () => "/proj",
      setStatus,
      setGitStatus,
      zephus: {
        getGitStatus: vi.fn(async () => ({
          available: true,
          detachedHead: false,
          branch: "main",
          modified: [],
          added: [],
          deleted: [],
        })),
        commitGitChanges: vi.fn(),
        pushGitChanges: vi.fn(),
        pullGitChanges: vi.fn(),
        initGitRepo,
      },
    });

    await actions.initGitFromPanel();

    expect(initGitRepo).toHaveBeenCalledWith("/proj");
    expect(setStatus).toHaveBeenCalledWith("Git repository initialized.");
    expect(setGitStatus).toHaveBeenCalled();
  });

  it("surfaces init failures", async () => {
    const setStatus = vi.fn();
    const actions = createEditorGitActions({
      getProjectPath: () => "/proj",
      setStatus,
      setGitStatus: vi.fn(),
      zephus: {
        getGitStatus: vi.fn(),
        commitGitChanges: vi.fn(),
        pushGitChanges: vi.fn(),
        pullGitChanges: vi.fn(),
        initGitRepo: vi.fn(async () => ({
          ok: false as const,
          error: "not allowed",
        })),
      },
    });

    await actions.initGitFromPanel();
    expect(setStatus).toHaveBeenCalledWith("Git init failed: not allowed");
  });

  it("handles a missing project for every action", async () => {
    const setStatus = vi.fn();
    const zephus = {
      getGitStatus: vi.fn(),
      commitGitChanges: vi.fn(),
      pushGitChanges: vi.fn(),
      pullGitChanges: vi.fn(),
      initGitRepo: vi.fn(),
    };
    const actions = createEditorGitActions({
      getProjectPath: () => null,
      setStatus,
      setGitStatus: vi.fn(),
      zephus,
    });

    await actions.refreshGit();
    await actions.commitGitChanges("msg");
    await actions.pushGitChanges();
    await actions.pullGitChanges();
    await actions.initGitFromPanel();

    expect(setStatus).toHaveBeenCalledWith("No project open to commit.");
    expect(setStatus).toHaveBeenCalledWith("No project open to push.");
    expect(setStatus).toHaveBeenCalledWith("No project open to pull.");
    expect(setStatus).toHaveBeenCalledWith(
      "No project open to initialize Git.",
    );
    expect(zephus.getGitStatus).not.toHaveBeenCalled();
  });
});
