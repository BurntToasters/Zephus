import { describe, it, expect, vi } from "vitest";
import { createEditorGitActions } from "../editorGit";

describe("editorGit", () => {
  it("commits selected paths and refreshes", async () => {
    const refreshGit = vi.fn(async () => {});
    const commitGitChanges = vi.fn(async () => ({ ok: true as const }));
    const setStatus = vi.fn();
    const actions = createEditorGitActions({
      getProjectPath: () => "/proj",
      setStatus,
      refreshGit,
      zephus: {
        commitGitChanges,
        pushGitChanges: vi.fn(),
        pullGitChanges: vi.fn(),
        initGitRepo: vi.fn(),
      },
    });

    await actions.commitGitChanges("save", ["a.ts", "b.ts"]);

    expect(commitGitChanges).toHaveBeenCalledWith("/proj", "save", ["a.ts", "b.ts"]);
    expect(setStatus).toHaveBeenCalledWith("Committed 2 file(s).");
    expect(refreshGit).toHaveBeenCalled();
  });

  it("surfaces commit failures", async () => {
    const setStatus = vi.fn();
    const actions = createEditorGitActions({
      getProjectPath: () => "/proj",
      setStatus,
      refreshGit: vi.fn(),
      zephus: {
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
