// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStartViewActions } from "../editorStartView";

vi.mock("../MiscModals", () => ({
  renderThemePreviewModalBody: () => undefined,
}));
vi.mock("../AboutLicenses", () => ({ updateAboutLicenses: () => undefined }));
vi.mock("../SettingsTab", () => ({
  initializeSettingsTab: () => undefined,
  updateSettingsTabNode: () => undefined,
  updateSettingsTabUpdater: () => undefined,
}));
vi.mock("../ThemesTab", () => ({ updateThemesTab: () => undefined }));

function makeDeps() {
  const statuses: string[] = [];
  const modals: string[] = [];
  const deps = {
    getState: () => ({ project: null }) as never,
    $: (id: string) => {
      const el = document.getElementById(id);
      if (!el) throw new Error("missing #" + id);
      return el as HTMLElement;
    },
    $maybe: (id: string) => document.getElementById(id) as HTMLElement | null,
    setStatus: (m: string) => statuses.push(m),
    showModal: (t: string) => modals.push(t),
    showModalNode: () => modals.push("modal-node"),
    closeModal: () => undefined,
    openSettingsModal: vi.fn(async () => undefined),
    openProjectByPath: vi.fn(async () => undefined),
    updaterStatusMessage: () => "up to date",
    currentUpdaterActions: () => [
      { id: "check" as const, label: "Check", tone: "secondary" as const },
    ],
    nodeStatusMessage: (res: { status: string; version?: string }) =>
      res.status === "ok" ? "ok" : "missing",
    friendlyError: (raw?: string) => raw ?? "unknown",
    runInstallFlow: vi.fn(async () => "installed"),
  };
  return { deps, statuses, modals };
}

function mountStartTabs(): void {
  document.body.innerHTML = `
    <button id="tab-recent"></button><button id="tab-create"></button>
    <button id="tab-settings"></button><button id="tab-about"></button>
    <div class="start-nav" role="tablist"></div>
    <div id="pane-recent"></div><div id="pane-create"></div>
    <div id="pane-settings"></div><div id="pane-about"></div>
    <button id="btn-create" disabled></button>
    <div id="view-start"></div><div id="view-editor"></div>
    <div id="project-name"></div>
  `;
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  (window as unknown as { zephus?: unknown }).zephus = {
    getNodeStatus: () => Promise.resolve({ status: "missing" }),
    chooseNewSiteFolder: () => Promise.resolve(null),
  };
});

describe("start view tabs", () => {
  it("wires the tablist and switches panes", async () => {
    mountStartTabs();
    const actions = createStartViewActions(makeDeps().deps as never);
    actions.initStartTabs();

    const createTab = document.getElementById("tab-create")!;
    createTab.click();
    await Promise.resolve();

    expect(createTab.classList.contains("active")).toBe(true);
    expect(createTab.getAttribute("aria-selected")).toBe("true");
    expect(
      document.getElementById("pane-create")!.classList.contains("hidden"),
    ).toBe(false);
    expect(
      document.getElementById("pane-recent")!.classList.contains("hidden"),
    ).toBe(true);
  });

  it("moves focus with arrow keys (roving tabindex)", async () => {
    mountStartTabs();
    const actions = createStartViewActions(makeDeps().deps as never);
    actions.initStartTabs();

    const recent = document.getElementById("tab-recent")!;
    recent.focus();
    const tablist = document.querySelector(".start-nav")!;
    tablist.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(document.activeElement).toBe(document.getElementById("tab-create"));
  });

  it("keeps the create flow inert without a selected theme", async () => {
    mountStartTabs();
    const { deps, modals } = makeDeps();
    const actions = createStartViewActions(deps as never);
    await actions.createSiteFromTabFlow();
    expect(modals).toHaveLength(0);
    expect(deps.openProjectByPath).not.toHaveBeenCalled();
  });

  it("maps theme ids to header details by keyword", () => {
    const actions = createStartViewActions(makeDeps().deps as never);
    expect(actions.getThemeHeaderDetails("docs").icon).toBe("book-open");
    expect(actions.getThemeHeaderDetails("portfolio").icon).toBe("image");
    expect(actions.getThemeHeaderDetails("minimal").icon).toBe("terminal");
    expect(actions.getThemeHeaderDetails("starter").icon).toBe("rocket");
  });

  it("returns no preview URL before the preview server is known", () => {
    const actions = createStartViewActions(makeDeps().deps as never);
    expect(
      actions.previewUrlForTheme({
        id: "x",
        name: "X",
        description: "",
        previewPath: "/x.png",
      } as never),
    ).toBeNull();
  });

  it("selecting a theme enables the create button", () => {
    mountStartTabs();
    const actions = createStartViewActions(makeDeps().deps as never);
    actions.initStartTabs();
    const btn = document.getElementById("btn-create") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    actions.selectThemeCard("minimal");
    expect(btn.disabled).toBe(false);
  });

  it("switches to the settings tab and back", async () => {
    mountStartTabs();
    const actions = createStartViewActions(makeDeps().deps as never);
    actions.initStartTabs();
    await actions.switchStartTab("settings");
    expect(
      document.getElementById("pane-settings")!.classList.contains("hidden"),
    ).toBe(false);
    await actions.activateHomeSection("recent");
    expect(
      document.getElementById("pane-recent")!.classList.contains("hidden"),
    ).toBe(false);
  });

  it("stops the create flow at the Node gate before picking a folder", async () => {
    mountStartTabs();
    const { deps, modals } = makeDeps();
    const actions = createStartViewActions(deps as never);
    actions.selectThemeCard("minimal");
    // Node missing: the flow must stop at the Node gate, before any folder
    // picker, install, or open.
    await actions.createSiteFromTabFlow();
    expect(modals.length).toBeGreaterThan(0);
    expect(deps.runInstallFlow).not.toHaveBeenCalled();
    expect(deps.openProjectByPath).not.toHaveBeenCalled();
  });

  it("creates a site end to end when Node is available", async () => {
    mountStartTabs();
    const { deps, statuses } = makeDeps();
    (window as unknown as { zephus: Record<string, unknown> }).zephus = {
      ...((window as unknown as { zephus: object }).zephus as object),
      getNodeStatus: async () => ({ status: "ok", version: "22.12.0" }),
      chooseNewSiteFolder: async () => "/tmp/new-site",
      createSite: async () => ({ ok: true }),
    };
    const actions = createStartViewActions(deps as never);
    actions.selectThemeCard("minimal");
    await actions.createSiteFromTabFlow();
    expect(deps.runInstallFlow).toHaveBeenCalledWith("/tmp/new-site");
    expect(deps.openProjectByPath).toHaveBeenCalledWith("/tmp/new-site");
    expect(statuses.join(" ")).toContain("Creating site");
  });

  it("cancels the create flow when no folder is chosen", async () => {
    mountStartTabs();
    const { deps } = makeDeps();
    (window as unknown as { zephus: Record<string, unknown> }).zephus = {
      ...((window as unknown as { zephus: object }).zephus as object),
      getNodeStatus: async () => ({ status: "ok", version: "22.12.0" }),
      chooseNewSiteFolder: async () => null,
    };
    const actions = createStartViewActions(deps as never);
    actions.selectThemeCard("minimal");
    await actions.createSiteFromTabFlow();
    expect(deps.runInstallFlow).not.toHaveBeenCalled();
    expect(deps.openProjectByPath).not.toHaveBeenCalled();
  });

  it("opens the site even when the install fails", async () => {
    mountStartTabs();
    const { deps, statuses } = makeDeps();
    (window as unknown as { zephus: Record<string, unknown> }).zephus = {
      ...((window as unknown as { zephus: object }).zephus as object),
      getNodeStatus: async () => ({ status: "ok", version: "22.12.0" }),
      chooseNewSiteFolder: async () => "/tmp/new-site",
      createSite: async () => ({ ok: true }),
    };
    (deps.runInstallFlow as ReturnType<typeof vi.fn>).mockResolvedValue(
      "failed",
    );
    // Simulate a successful open: the module reads state.project after
    // openProjectByPath resolves to decide the install-result messaging.
    const session = { project: null as { path: string } | null };
    const actions = createStartViewActions({
      ...(deps as object),
      getState: () => session as never,
      openProjectByPath: async (folder: string) => {
        session.project = { path: folder };
      },
    } as never);
    actions.selectThemeCard("minimal");
    await actions.createSiteFromTabFlow();
    expect(session.project?.path).toBe("/tmp/new-site");
    expect(statuses.join(" ")).toContain("Dependencies failed to install");
  });

  it("shows a failure modal when the site scaffold fails", async () => {
    mountStartTabs();
    const { deps, modals } = makeDeps();
    (window as unknown as { zephus: Record<string, unknown> }).zephus = {
      ...((window as unknown as { zephus: object }).zephus as object),
      getNodeStatus: async () => ({ status: "ok", version: "22.12.0" }),
      chooseNewSiteFolder: async () => "/tmp/new-site",
      createSite: async () => ({ ok: false, error: "disk full" }),
    };
    const actions = createStartViewActions(deps as never);
    actions.selectThemeCard("minimal");
    await actions.createSiteFromTabFlow();
    expect(modals.join(" ")).toContain("Could Not Create Site");
    expect(deps.openProjectByPath).not.toHaveBeenCalled();
  });
});
