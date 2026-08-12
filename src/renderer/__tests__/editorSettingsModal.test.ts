// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSettingsModalActions } from "../editorSettingsModal";

interface ModalProps {
  onSettingChange: (key: string, value: unknown) => void;
  onUpdaterAction: (actionId: string) => Promise<void>;
}
let modalProps: ModalProps | null = null;
let modalActions: Array<{ label: string; kind?: string; onClick: () => void }> =
  [];

vi.mock("../SettingsModal", () => ({
  renderSettingsModalBody: (_wrap: HTMLElement, props: ModalProps) => {
    modalProps = props;
    return () => undefined;
  },
}));
vi.mock("../MiscModals", () => ({
  renderProductionLicensesModalBody: () => undefined,
}));
vi.mock("../SettingsTab", () => ({
  updateSettingsTabNode: () => undefined,
  updateSettingsTabSettings: () => undefined,
}));

function makeDeps() {
  let appSettings: { theme: string } | null = null;
  const writes: Record<string, unknown>[] = [];
  let checkCalls = 0;
  (window as unknown as { zephus?: unknown }).zephus = {
    readGlobalSettings: async () => ({
      theme: "dark",
      codeFontSize: 13,
      recentProjects: [],
      autoCheckUpdates: true,
      updateChannel: "auto",
      restoreLastProject: false,
      confirmBlockDelete: true,
      autosave: false,
      customNodePath: null,
    }),
    writeGlobalSettings: async (s: Record<string, unknown>) => {
      writes.push(s);
      return { ok: true };
    },
    getNodeStatus: async () => ({ status: "ok", version: "22.12.0" }),
    getAppVersion: async () => "1.0.0",
    checkForUpdates: async () => {
      checkCalls += 1;
      return { status: "not-available" };
    },
    downloadUpdate: async () => ({ status: "downloaded" }),
    cancelUpdateDownload: async () => undefined,
    openConfigFolder: async () => ({ ok: true }),
    setNodePath: async () => ({ status: "ok", version: "22.12.0" }),
    openProductionLicensesFile: async () => ({ ok: true }),
    readProductionLicenses: async () => ({ ok: true, entries: [] }),
  };
  const deps = {
    $: (id: string) => {
      const el = document.getElementById(id);
      if (!el) throw new Error("missing #" + id);
      return el as HTMLElement;
    },
    setStatus: () => undefined,
    showModal: () => undefined,
    showModalNode: (
      _t: string,
      _c: HTMLElement,
      actions: Array<{ label: string; kind?: string; onClick: () => void }>,
    ) => {
      modalActions = actions;
    },
    closeModal: () => undefined,
    registerCleanup: () => undefined,
    modalController: { confirmDestructive: vi.fn(async () => true) },
    applyCodeFontSize: vi.fn(),
    nodeStatusMessage: (res: { status: string; version?: string }) =>
      res.status === "ok" ? `Node.js ${res.version} detected` : "missing",
    friendlyError: (raw?: string) => raw ?? "unknown",
    updaterStatusMessage: () => "up to date",
    currentUpdaterActions: () => [
      { id: "check" as const, label: "Check", tone: "secondary" as const },
    ],
    restartToApplyUpdate: vi.fn(async () => undefined),
    setAppSettings: (s: { theme: string }) => {
      appSettings = s;
    },
    getAppSettings: () => appSettings,
  } as unknown as Parameters<typeof createSettingsModalActions>[0];
  return {
    deps,
    writes,
    getAppSettings: () => appSettings,
    getProps: () => modalProps,
    getActions: () => modalActions,
    getCheckCalls: () => checkCalls,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "<div id='status-bar'></div>";
  modalProps = null;
  modalActions = [];
});

describe("settings modal", () => {
  it("opens and seeds the node status text", async () => {
    const { deps, getProps } = makeDeps();
    const actions = createSettingsModalActions(deps);
    await actions.openSettingsModal();
    await new Promise((r) => setTimeout(r, 0));
    expect(getProps()).not.toBeNull();
  });

  it("saves settings and applies theme + font size", async () => {
    const { deps, writes, getProps, getActions } = makeDeps();
    const actions = createSettingsModalActions(deps);
    await actions.openSettingsModal();
    await new Promise((r) => setTimeout(r, 0));

    getProps()!.onSettingChange("theme", "light");
    const save = getActions().find((a) => a.label === "Save")!;
    await save.onClick();

    expect(writes).toHaveLength(1);
    expect((writes[0] as Record<string, unknown>)["theme"]).toBe("light");
    expect(
      deps.applyCodeFontSize as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalled();
  });

  it("resets settings to defaults after confirmation", async () => {
    const { deps, writes, getActions } = makeDeps();
    const actions = createSettingsModalActions(deps);
    await actions.openSettingsModal();
    await new Promise((r) => setTimeout(r, 0));

    const reset = getActions().find((a) => a.label === "Reset to Defaults")!;
    await reset.onClick();

    expect(writes).toHaveLength(1);
    expect((writes[0] as Record<string, unknown>)["theme"]).toBe("system");
    expect((writes[0] as Record<string, unknown>)["codeFontSize"]).toBe(13);
  });

  it("refuses to reset when confirmation is declined", async () => {
    const { deps, writes, getActions } = makeDeps();
    (
      deps.modalController as { confirmDestructive: unknown }
    ).confirmDestructive = vi.fn(async () => false);
    const actions = createSettingsModalActions(deps);
    await actions.openSettingsModal();
    await new Promise((r) => setTimeout(r, 0));

    const reset = getActions().find((a) => a.label === "Reset to Defaults")!;
    await reset.onClick();
    expect(writes).toHaveLength(0);
  });

  it("runs the updater check action", async () => {
    const { deps, getProps, getActions, getCheckCalls } = makeDeps();
    const actions = createSettingsModalActions(deps);
    await actions.openSettingsModal();
    await new Promise((r) => setTimeout(r, 0));

    await getProps()!.onUpdaterAction("check");
    expect(getCheckCalls()).toBe(1);
    void getActions;
  });
});
