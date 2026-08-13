// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHomeActions } from "../editorHome";

function makeDeps() {
  const statuses: string[] = [];
  const modals: string[] = [];
  let appSettings: { lastOpenedProject?: string } | null = null;
  (window as unknown as { zephus?: unknown }).zephus = {
    listDrafts: async () => ({
      ok: true,
      entries: [
        {
          projectPath: "/p",
          scope: "page",
          target: "index",
          savedAt: "2026-01-01",
        },
      ],
    }),
    readGlobalSettings: async () => ({
      recentProjects: ["/a", "/b"],
      lastOpenedProject: "/a",
      theme: "system",
    }),
    installUpdate: async () => ({ ok: true }),
  };
  const deps = {
    $: (id: string) => {
      const el = document.getElementById(id);
      if (!el) throw new Error("missing #" + id);
      return el as HTMLElement;
    },
    $maybe: (id: string) => document.getElementById(id) as HTMLElement | null,
    setStatus: (m: string) => statuses.push(m),
    showModal: () => modals.push("modal"),
    closeModal: () => undefined,
    getState: () => ({ project: null }) as never,
    modalController: { isOpen: () => false },
    maybeResolveUnsavedWork: vi.fn(async () => true),
    friendlyError: (raw?: string) => raw ?? "unknown",
    projectBaseName: (p: string) => p.split("/").pop() ?? p,
    formatRelativeTime: () => "now",
    setAppSettings: (s: typeof appSettings) => {
      appSettings = s;
    },
    getAppSettings: () => appSettings,
  } as never;
  return {
    deps,
    statuses,
    modals,
    getAppSettings: () => appSettings,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = `
    <button id="btn-resume-last"></button>
    <div id="home-recovery-list" class="hidden"></div>
    <div id="status-bar"></div>
  `;
});

describe("home actions", () => {
  it("refreshes draft summaries from the store", async () => {
    const { deps } = makeDeps();
    const home = createHomeActions(deps);
    await home.refreshHomeDraftSummaries();
    expect(home.getHomeDraftSummaries()).toHaveLength(1);
  });

  it("renders updater status messages per state", () => {
    const { deps } = makeDeps();
    const home = createHomeActions(deps);
    home.setUpdaterSnapshot({ status: "available", version: "1.2.3" });
    expect(home.updaterStatusMessage()).toContain("1.2.3");
    expect(home.currentUpdaterActions().map((a) => a.id)).toContain("download");

    home.setUpdaterSnapshot({ status: "downloaded", version: "1.2.3" });
    expect(home.currentUpdaterActions().map((a) => a.id)).toContain("restart");

    home.setUpdaterSnapshot({ status: "downloading", percent: 42 });
    expect(home.updaterStatusMessage()).toContain("42");
    expect(home.currentUpdaterActions().map((a) => a.id)).toContain("cancel");

    home.setUpdaterSnapshot({ status: "error", error: "boom" });
    expect(home.updaterStatusMessage()).toContain("boom");
  });

  it("renders the recent projects list and stores the settings", async () => {
    const { deps, getAppSettings } = makeDeps();
    const home = createHomeActions(deps);
    await home.renderRecent();
    expect(getAppSettings()?.lastOpenedProject).toBe("/a");
  });

  it("prompts only once per downloaded version", () => {
    const { deps, modals } = makeDeps();
    const home = createHomeActions(deps);
    home.setUpdaterSnapshot({ status: "downloaded", version: "2.0.0" });
    home.promptDownloadedUpdate();
    home.promptDownloadedUpdate();
    expect(modals).toHaveLength(1);
  });

  it("reports the cancel state in the sidebar", () => {
    const { deps } = makeDeps();
    const home = createHomeActions(deps);
    home.setUpdaterSnapshot({ status: "cancelled" });
    expect(home.updaterStatusMessage()).toContain("up to date");
  });
});
