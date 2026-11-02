// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPreviewPublishActions,
  notePreviewServerExitedDuringStart,
} from "../editorPreviewPublish";
import { createEditorSession, type EditorSessionState } from "../editorSession";

vi.mock("../MiscModals", () => ({
  renderPublishSuccessModalBody: vi.fn(),
}));

interface ModalAction {
  label: string;
  onClick: () => void | Promise<void>;
}

interface RecordedModal {
  title: string;
  content: HTMLElement | null;
  actions: ModalAction[];
}

function projectState(path = "/proj"): EditorSessionState {
  const state = createEditorSession();
  state.project = {
    path,
    astro: { outDir: "dist" },
  } as EditorSessionState["project"];
  return state;
}

function harness(state = projectState()) {
  const statuses: string[] = [];
  const modals: RecordedModal[] = [];
  const deps = {
    getState: () => state,
    $: (id: string) => {
      let node = document.getElementById(id);
      if (!node) {
        node = document.createElement(id === "dev-log" ? "pre" : "button");
        node.id = id;
        document.body.append(node);
      }
      return node;
    },
    $maybe: (id: string) => document.getElementById(id),
    setStatus: (message: string) => statuses.push(message),
    refreshIcons: vi.fn(),
    showModal: (title: string, _body: string, actions: ModalAction[]) => {
      modals.push({ title, content: null, actions });
    },
    showModalNode: (
      title: string,
      content: HTMLElement,
      actions: ModalAction[],
    ) => {
      modals.push({ title, content, actions });
    },
    closeModal: vi.fn(),
    registerCleanup: vi.fn(),
    maybeResolveUnsavedWork: vi.fn(async () => true),
    performSave: vi.fn(async () => true),
    refreshGuidancePanels: vi.fn(),
    renderCanvas: vi.fn(),
    renderProperties: vi.fn(),
    friendlyError: (raw?: string) => raw ?? "unknown",
  };
  return { state, deps, statuses, modals };
}

interface ZephusStub {
  onInstallLog: ReturnType<typeof vi.fn>;
  onPreviewLog: ReturnType<typeof vi.fn>;
  onPublishLog: ReturnType<typeof vi.fn>;
  installDependencies: ReturnType<typeof vi.fn>;
  cancelInstall: ReturnType<typeof vi.fn>;
  dependenciesInstalled: ReturnType<typeof vi.fn>;
  closePreviewWindow: ReturnType<typeof vi.fn>;
  startPreview: ReturnType<typeof vi.fn>;
  stopPreview: ReturnType<typeof vi.fn>;
  openPreviewWindow: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  revealOutputFolder: ReturnType<typeof vi.fn>;
}

function installZephus(overrides: Partial<ZephusStub> = {}): ZephusStub {
  const api: ZephusStub = {
    onInstallLog: vi.fn(() => vi.fn()),
    onPreviewLog: vi.fn(() => vi.fn()),
    onPublishLog: vi.fn(() => vi.fn()),
    installDependencies: vi.fn(async () => ({ ok: true })),
    cancelInstall: vi.fn(async () => ({ ok: true })),
    dependenciesInstalled: vi.fn(async () => true),
    closePreviewWindow: vi.fn(async () => undefined),
    startPreview: vi.fn(async () => ({
      ok: true,
      url: "http://127.0.0.1:4321",
    })),
    stopPreview: vi.fn(async () => undefined),
    openPreviewWindow: vi.fn(async () => ({ ok: true })),
    publish: vi.fn(async () => ({ ok: true, outputDir: "/proj/dist" })),
    revealOutputFolder: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
  (window as unknown as { zephus: typeof api }).zephus = api;
  return api;
}

async function click(modals: RecordedModal[], label: string): Promise<void> {
  const modal = [...modals]
    .reverse()
    .find((entry) => entry.actions.some((action) => action.label === label));
  const action = modal?.actions.find((entry) => entry.label === label);
  if (!action) throw new Error("missing action " + label);
  await action.onClick();
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  vi.spyOn(window, "setInterval").mockImplementation((handler) => {
    if (typeof handler === "function") handler();
    return 1 as unknown as ReturnType<typeof setInterval>;
  });
  vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
});

describe("preview and publish actions", () => {
  it("ignores a preview-server exit when start is not in flight", () => {
    notePreviewServerExitedDuringStart();
  });

  it("switches the canvas viewport and repaints in visual mode", () => {
    document.body.innerHTML = `<div class="canvas-wrap"></div>`;
    const { deps } = harness();
    const actions = createPreviewPublishActions(deps);
    actions.setViewport("tablet");
    const wrap = document.querySelector(".canvas-wrap")!;
    expect(wrap.classList.contains("vp-tablet")).toBe(true);
    expect(
      document.getElementById("vp-tablet")!.getAttribute("aria-checked"),
    ).toBe("true");
    expect(deps.renderCanvas).toHaveBeenCalled();
    actions.setViewport("mobile");
    expect(wrap.classList.contains("vp-mobile")).toBe(true);
    expect(wrap.classList.contains("vp-tablet")).toBe(false);
    actions.setViewport("desktop");
    expect(wrap.className).toBe("canvas-wrap");
  });

  it("does not repaint the canvas outside visual mode", () => {
    document.body.innerHTML = `<div class="canvas-wrap"></div>`;
    const { state, deps } = harness();
    state.mode = "code";
    createPreviewPublishActions(deps).setViewport("tablet");
    expect(deps.renderCanvas).not.toHaveBeenCalled();
  });

  it("returns from a viewport change when the canvas is not mounted", () => {
    const { deps } = harness();
    createPreviewPublishActions(deps).setViewport("mobile");
    expect(document.querySelector(".canvas-wrap")).toBeNull();
  });

  it("resolves installed when dependency install succeeds", async () => {
    const api = installZephus();
    const { deps, statuses } = harness();
    const result =
      await createPreviewPublishActions(deps).runInstallFlow("/proj");
    expect(result).toBe("installed");
    expect(statuses).toContain("Dependencies installed.");
    expect(api.onInstallLog).toHaveBeenCalled();
  });

  it("shows Install Failed when dependency install returns an error", async () => {
    installZephus({
      installDependencies: vi.fn(async () => ({
        ok: false,
        error: "npm down",
      })),
    });
    const { deps, statuses, modals } = harness();
    const result =
      await createPreviewPublishActions(deps).runInstallFlow("/proj");
    expect(result).toBe("failed");
    expect(modals.at(-1)?.title).toBe("Install Failed");
    expect(statuses).toContain("Dependency install failed.");
  });

  it("shows Install Failed when dependency install rejects", async () => {
    installZephus({
      installDependencies: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const { deps, modals } = harness();
    const result =
      await createPreviewPublishActions(deps).runInstallFlow("/proj");
    expect(result).toBe("failed");
    expect(modals.at(-1)?.title).toBe("Install Failed");
  });

  it("backgrounds an install and reports the later result for the open project", async () => {
    let finish: (value: { ok: boolean; error?: string }) => void = () =>
      undefined;
    const api = installZephus({
      installDependencies: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const { deps, statuses, modals } = harness();
    const actions = createPreviewPublishActions(deps);
    const pending = actions.runInstallFlow("/proj");
    await click(modals, "Run in Background");
    await click(modals, "Run in Background");
    await expect(pending).resolves.toBe("backgrounded");
    expect(statuses).toContain("Installing dependencies in background…");
    finish({ ok: true });
    await Promise.resolve();
    expect(statuses).toContain("Dependencies installed.");
    const failed = actions.runInstallFlow("/proj");
    await click(modals, "Run in Background");
    finish({ ok: false, error: "late" });
    await expect(failed).resolves.toBe("backgrounded");
    await Promise.resolve();
    expect(statuses).toContain("Dependency install failed.");
    expect(api.cancelInstall).not.toHaveBeenCalled();
  });

  it("does not announce a background install for a different open project", async () => {
    let finish: (value: { ok: boolean }) => void = () => undefined;
    installZephus({
      installDependencies: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const { state, deps, statuses, modals } = harness();
    const pending = createPreviewPublishActions(deps).runInstallFlow("/proj");
    await click(modals, "Run in Background");
    state.project = { path: "/else" } as EditorSessionState["project"];
    finish({ ok: true });
    await expect(pending).resolves.toBe("backgrounded");
    await Promise.resolve();
    expect(statuses).not.toContain("Dependencies installed.");
    expect(statuses).not.toContain("Dependency install failed.");
  });

  it("cancels an install and ignores the later npm result", async () => {
    let finish: (value: { ok: boolean }) => void = () => undefined;
    const api = installZephus({
      installDependencies: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
      cancelInstall: vi.fn(async () => {
        throw new Error("already gone");
      }),
    });
    const { deps, modals } = harness();
    const pending = createPreviewPublishActions(deps).runInstallFlow("/proj");
    await click(modals, "Cancel");
    await click(modals, "Cancel");
    await expect(pending).resolves.toBe("cancelled");
    finish({ ok: true });
    await Promise.resolve();
    expect(api.cancelInstall).toHaveBeenCalled();
    expect(modals.some((modal) => modal.title === "Install Failed")).toBe(
      false,
    );
  });

  it("treats a backgrounded install rejection as a failure for the open project", async () => {
    let rejectInstall: (error: unknown) => void = () => undefined;
    installZephus({
      installDependencies: vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            rejectInstall = reject;
          }),
      ),
    });
    const { deps, statuses, modals } = harness();
    const pending = createPreviewPublishActions(deps).runInstallFlow("/proj");
    await click(modals, "Run in Background");
    rejectInstall(new Error("npm crashed"));
    await expect(pending).resolves.toBe("backgrounded");
    await Promise.resolve();
    expect(statuses).toContain("Dependency install failed.");
  });

  it("skips dependency work when no project is open", async () => {
    const { deps } = harness(createEditorSession());
    const ready = await createPreviewPublishActions(deps).ensureDependencies();
    expect(ready).toBe(false);
  });

  it("joins an install that is already running for this project", async () => {
    let calls = 0;
    const api = installZephus({
      dependenciesInstalled: vi.fn(async () => false),
      installDependencies: vi.fn(
        () =>
          new Promise((resolve) => {
            calls += 1;
            if (calls > 1) resolve({ ok: true });
          }),
      ),
    });
    const { deps, modals } = harness();
    const actions = createPreviewPublishActions(deps);
    const backgrounded = actions.runInstallFlow("/proj");
    await click(modals, "Run in Background");
    await backgrounded;
    await expect(actions.ensureDependencies()).resolves.toBe(true);
    expect(api.installDependencies).toHaveBeenCalledTimes(2);
  });

  it("starts a fresh install when the background one belongs to another project", async () => {
    let calls = 0;
    installZephus({
      dependenciesInstalled: vi.fn(async () => false),
      installDependencies: vi.fn(
        () =>
          new Promise((resolve) => {
            calls += 1;
            if (calls > 1) resolve({ ok: false });
          }),
      ),
    });
    const { deps, modals } = harness();
    const actions = createPreviewPublishActions(deps);
    const backgrounded = actions.runInstallFlow("/other");
    await click(modals, "Run in Background");
    await backgrounded;
    await expect(actions.ensureDependencies()).resolves.toBe(false);
  });

  it("returns false when the install flow is cancelled", async () => {
    installZephus({
      dependenciesInstalled: vi.fn(async () => false),
      installDependencies: vi.fn(() => new Promise(() => undefined)),
    });
    const { deps, modals } = harness();
    const actions = createPreviewPublishActions(deps);
    const ready = actions.ensureDependencies();
    await Promise.resolve();
    await click(modals, "Cancel");
    await expect(ready).resolves.toBe(false);
  });

  it("hides the preview chip when the button is absent", () => {
    const { deps } = harness();
    createPreviewPublishActions(deps).updatePreviewButton("stopped");
    expect(document.getElementById("btn-preview")).toBeNull();
  });

  it("labels the preview button for starting, running, and stopped", () => {
    const { state, deps } = harness();
    state.previewUrl = "http://127.0.0.1:4321";
    const actions = createPreviewPublishActions(deps);
    const button = document.createElement("button");
    button.id = "btn-preview";
    const chip = document.createElement("div");
    chip.id = "preview-url-chip";
    chip.classList.add("hidden");
    chip.append(document.createElement("span"));
    document.body.append(button, chip);
    actions.updatePreviewButton("running");
    expect(button.getAttribute("aria-label")).toBe("Stop Preview");
    expect(chip.classList.contains("hidden")).toBe(false);
    expect(chip.textContent).toBe(state.previewUrl);
    actions.updatePreviewButton("starting");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("Starting…");
    state.previewUrl = null;
    chip.innerHTML = "";
    actions.updatePreviewButton("stopped");
    expect(button.getAttribute("aria-label")).toBe("Start Preview");
    expect(chip.classList.contains("hidden")).toBe(true);
  });

  it("resets preview state and drops log subscriptions", async () => {
    const unsub = vi.fn();
    installZephus({ onPreviewLog: vi.fn(() => unsub) });
    const { state, deps, statuses } = harness();
    const actions = createPreviewPublishActions(deps);
    await actions.togglePreview();
    expect(state.previewUrl).toBe("http://127.0.0.1:4321");
    actions.resetPreviewState("Preview stopped.");
    expect(state.previewUrl).toBeNull();
    expect(unsub).toHaveBeenCalled();
    expect(statuses).toContain("Preview stopped.");
  });

  it("does nothing when preview is toggled with no project", async () => {
    const api = installZephus();
    const { deps } = harness(createEditorSession());
    await createPreviewPublishActions(deps).togglePreview();
    expect(api.startPreview).not.toHaveBeenCalled();
  });

  it("stops an open preview", async () => {
    const api = installZephus();
    const { state, deps, statuses } = harness();
    state.previewUrl = "http://127.0.0.1:4321";
    await createPreviewPublishActions(deps).togglePreview();
    expect(api.closePreviewWindow).toHaveBeenCalled();
    expect(statuses).toContain("Preview stopped.");
  });

  it("leaves preview stopped when unsaved work is kept", async () => {
    installZephus();
    const { state, deps } = harness();
    state.pageDirty = true;
    deps.maybeResolveUnsavedWork.mockResolvedValue(false);
    await createPreviewPublishActions(deps).togglePreview();
    expect(state.previewUrl).toBeNull();
  });

  it("stops when the project changes while unsaved work is resolving", async () => {
    const api = installZephus();
    const { state, deps } = harness();
    state.pageDirty = true;
    deps.maybeResolveUnsavedWork.mockImplementation(async () => {
      state.project = { path: "/other" } as EditorSessionState["project"];
      return true;
    });
    await createPreviewPublishActions(deps).togglePreview();
    expect(api.startPreview).not.toHaveBeenCalled();
  });

  it("stops when dependencies are not ready", async () => {
    const api = installZephus({
      dependenciesInstalled: vi.fn(async () => false),
      installDependencies: vi.fn(async () => ({ ok: false, error: "nope" })),
    });
    const { deps } = harness();
    await createPreviewPublishActions(deps).togglePreview();
    expect(api.startPreview).not.toHaveBeenCalled();
  });

  it("stops a server that exits while preview is starting", async () => {
    const api = installZephus({
      startPreview: vi.fn(async () => {
        notePreviewServerExitedDuringStart();
        return { ok: true, url: "http://127.0.0.1:4321" };
      }),
    });
    const { deps, statuses } = harness();
    await createPreviewPublishActions(deps).togglePreview();
    expect(statuses).toContain("Preview server stopped before it was ready.");
    expect(api.stopPreview).toHaveBeenCalled();
  });

  it("reports a preview start that returns no url", async () => {
    installZephus({
      startPreview: vi.fn(async () => ({ ok: false, error: "port" })),
    });
    const { deps, statuses } = harness();
    await createPreviewPublishActions(deps).togglePreview();
    expect(statuses.some((line) => line.includes("port"))).toBe(true);
  });

  it("stops the server when the preview window fails to open", async () => {
    const api = installZephus({
      openPreviewWindow: vi.fn(async () => ({ ok: false, error: "blocked" })),
    });
    const { deps, statuses } = harness();
    await createPreviewPublishActions(deps).togglePreview();
    expect(api.stopPreview).toHaveBeenCalled();
    expect(statuses.some((line) => line.includes("blocked"))).toBe(true);
  });

  it("stops a preview that finishes after the project closes", async () => {
    const api = installZephus({
      startPreview: vi.fn(async () => {
        return { ok: true, url: "http://127.0.0.1:4321" };
      }),
    });
    const { state, deps } = harness();
    api.startPreview.mockImplementation(async () => {
      state.project = null;
      return { ok: true, url: "http://127.0.0.1:4321" };
    });
    await createPreviewPublishActions(deps).togglePreview();
    expect(api.stopPreview).toHaveBeenCalled();
  });

  it("stops a preview window that opens after the project closes", async () => {
    const api = installZephus();
    const { state, deps } = harness();
    api.openPreviewWindow.mockImplementation(async () => {
      state.project = { path: "/other" } as EditorSessionState["project"];
      return { ok: true };
    });
    await createPreviewPublishActions(deps).togglePreview();
    expect(api.stopPreview).toHaveBeenCalled();
    expect(state.previewUrl).toBeNull();
  });

  it("reports a thrown preview start and clears the log subscription", async () => {
    const unsub = vi.fn();
    installZephus({
      onPreviewLog: vi.fn(() => unsub),
      startPreview: vi.fn(async () => {
        throw new Error("ipc down");
      }),
    });
    const { deps, statuses } = harness();
    await createPreviewPublishActions(deps).togglePreview();
    expect(statuses.some((line) => line.includes("ipc down"))).toBe(true);
    expect(unsub).toHaveBeenCalled();
  });

  it("stringifies a non-Error preview failure", async () => {
    installZephus({
      startPreview: vi.fn(async () => {
        throw "nope";
      }),
    });
    const { deps, statuses } = harness();
    await createPreviewPublishActions(deps).togglePreview();
    expect(statuses.some((line) => line.includes("nope"))).toBe(true);
  });

  it("ignores a second preview start while one is in flight", async () => {
    let release: () => void = () => undefined;
    const api = installZephus({
      dependenciesInstalled: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            release = () => resolve(true);
          }),
      ),
    });
    const { deps } = harness();
    const actions = createPreviewPublishActions(deps);
    const first = actions.togglePreview();
    const second = actions.togglePreview();
    await second;
    release();
    await first;
    expect(api.startPreview).toHaveBeenCalledTimes(1);
  });

  it("does not publish without a project or while a build is running", async () => {
    const api = installZephus();
    const idle = harness(createEditorSession());
    await createPreviewPublishActions(idle.deps).publishSite();
    expect(api.publish).not.toHaveBeenCalled();

    let release: (value: { ok: boolean; outputDir: string }) => void = () =>
      undefined;
    api.publish.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { deps } = harness();
    const actions = createPreviewPublishActions(deps);
    const first = actions.publishSite();
    await Promise.resolve();
    await actions.publishSite();
    release({ ok: true, outputDir: "/proj/dist" });
    await first;
    expect(api.publish).toHaveBeenCalledTimes(1);
  });

  it("stops publishing when unsaved work is kept", async () => {
    const api = installZephus();
    const { state, deps } = harness();
    state.pageDirty = true;
    deps.maybeResolveUnsavedWork.mockResolvedValue(false);
    await createPreviewPublishActions(deps).publishSite();
    expect(api.publish).not.toHaveBeenCalled();
  });

  it("stops publishing when the project closes during the build", async () => {
    const api = installZephus();
    const { state, deps, modals } = harness();
    api.publish.mockImplementation(async () => {
      state.project = null;
      return { ok: true, outputDir: "/proj/dist" };
    });
    await createPreviewPublishActions(deps).publishSite();
    expect(
      modals.some((modal) => modal.title === "Site Built — Ready to Go Online"),
    ).toBe(false);
  });

  it("shows Build Failed when publish returns an error", async () => {
    installZephus({
      publish: vi.fn(async () => ({ ok: false, error: "astro" })),
    });
    const { deps, statuses, modals } = harness();
    await createPreviewPublishActions(deps).publishSite();
    expect(modals.at(-1)?.title).toBe("Build Failed");
    expect(statuses).toContain("Build failed.");
  });

  it("publishes and reveals the output folder", async () => {
    const api = installZephus({
      publish: vi.fn(async () => ({ ok: true })),
    });
    const { state, deps, statuses, modals } = harness();
    await createPreviewPublishActions(deps).publishSite();
    expect(statuses.some((line) => line.includes("dist"))).toBe(true);
    await click(modals, "Open Output Folder");
    expect(api.revealOutputFolder).toHaveBeenCalledWith("/proj", "dist");
    state.project = null;
    await click(modals, "Open Output Folder");
    expect(api.revealOutputFolder).toHaveBeenCalledTimes(1);
  });

  it("says when newer edits were not included and when reveal fails", async () => {
    const api = installZephus();
    const { state, deps, statuses, modals } = harness();
    api.publish.mockImplementation(async () => {
      state.pageDirty = true;
      return { ok: true, outputDir: "/proj/dist" };
    });
    api.revealOutputFolder
      .mockResolvedValueOnce({ ok: false, error: "missing" })
      .mockRejectedValueOnce(new Error("fs"));
    await createPreviewPublishActions(deps).publishSite();
    expect(statuses.some((line) => line.includes("NOT included"))).toBe(true);
    await click(modals, "Open Output Folder");
    await Promise.resolve();
    expect(statuses.some((line) => line.includes("missing"))).toBe(true);
    await click(modals, "Open Output Folder");
    await Promise.resolve();
    await Promise.resolve();
    expect(statuses).toContain("Could not open the output folder.");
  });
});
