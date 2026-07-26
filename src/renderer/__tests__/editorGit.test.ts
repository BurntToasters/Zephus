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

    expect(commitGitChanges).toHaveBeenCalledWith("/proj", "save", ["a.ts", "b.ts"]);
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
});
