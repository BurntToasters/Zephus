/**
 * App settings modal + production licenses modal. Extracted from the engine:
 * the settings modal shares the updater status/actions and the node-path
 * status with the start-tab settings — one module, one deps contract.
 */

import { renderSettingsModalBody } from "./SettingsModal";
import { renderProductionLicensesModalBody } from "./MiscModals";
import {
  updateSettingsTabNode,
  updateSettingsTabSettings,
} from "./SettingsTab";
import type { GlobalSettings, ProductionLicensesResult } from "../main/types";

export interface SettingsModalDeps {
  $: (id: string) => HTMLElement;
  setStatus: (message: string) => void;
  showModal: (
    title: string,
    body: string,
    actions: Array<{
      label: string;
      kind?: "primary" | "danger" | "ghost";
      onClick: () => void;
    }>,
  ) => void;
  showModalNode: (
    title: string,
    content: HTMLElement,
    actions: Array<{
      label: string;
      kind?: "primary" | "danger" | "ghost";
      onClick: () => void;
    }>,
    options?: { size?: "default" | "wide" },
  ) => void;
  closeModal: () => void;
  registerCleanup: (cleanup: (() => void) | null) => void;
  modalController: {
    confirmDestructive: (
      title: string,
      message: string,
      confirmLabel: string,
    ) => Promise<boolean>;
  };
  applyCodeFontSize: (size: number) => void;
  nodeStatusMessage: (res: NodeCheckResult) => string;
  friendlyError: (raw: string | undefined) => string;
  updaterStatusMessage: () => string;
  currentUpdaterActions: () => Array<{
    id: "check" | "download" | "restart" | "cancel";
    label: string;
    tone: "secondary" | "primary" | "ghost";
  }>;
  restartToApplyUpdate: () => Promise<void>;
  setAppSettings: (settings: GlobalSettings) => void;
  getAppSettings: () => GlobalSettings | null;
}

export function createSettingsModalActions(deps: SettingsModalDeps) {
  const {
    setStatus,
    showModal,
    showModalNode,
    closeModal,
    modalController,
    applyCodeFontSize,
    nodeStatusMessage,
    friendlyError,
    updaterStatusMessage,
    currentUpdaterActions,
    restartToApplyUpdate,
    setAppSettings,
    getAppSettings,
  } = deps;

  async function openSettingsModal(): Promise<void> {
    let settings: GlobalSettings;
    try {
      settings = await window.zephus.readGlobalSettings();
    } catch {
      setStatus("Could not load settings.");
      return;
    }
    // The start-tab settings are an UNSAVED draft; opening the modal and saving
    // would otherwise overwrite those edits with the stale disk values. Seed
    // from the last-known applied settings when they exist.
    const lastApplied = getAppSettings();
    if (lastApplied) settings = lastApplied;

    const wrap = document.createElement("div");
    const modalState = {
      settings: { ...settings },
      updaterStatusText: updaterStatusMessage(),
      updaterActions: currentUpdaterActions(),
      nodeStatusText: "Checking Node.js…",
      nodeAutoDisabled: !settings.customNodePath,
      nodeBrowseBusy: false,
      nodeAutoBusy: false,
      versionText: "Zephus",
    };
    // Dispose the previous Solid root before re-rendering so its effects and
    // listeners are cleaned up instead of accumulating per re-render.
    let disposeSettingsBody: (() => void) | null = null;

    // Late-resolving async status calls must NOT re-render the whole modal
    // body: that destroys the control the user is typing in. The status texts
    // are plain spans — patch them in place when the modal is open.
    const refreshSettingsStatusText = (): void => {
      const statusEl = wrap.querySelector(
        ".settings-inline-copy span, .settings-inline-copy > span",
      );
      if (statusEl) statusEl.textContent = modalState.nodeStatusText;
      const versionEl = wrap.querySelector(".version-info-text");
      if (versionEl) versionEl.textContent = modalState.versionText;
    };

    const renderModal = () => {
      disposeSettingsBody?.();
      disposeSettingsBody = renderSettingsModalBody(wrap, {
        ...modalState,
        onSettingChange: (key, value) => {
          // Mutate the host state only: re-rendering here would destroy the
          // control the user is interacting with (checkbox/select) and drop
          // focus. The next async re-render re-seeds from modalState.settings.
          modalState.settings = { ...modalState.settings, [key]: value };
        },
        onUpdaterAction: async (actionId) => {
          if (actionId === "check") {
            try {
              await window.zephus.checkForUpdates();
            } catch {
              /* status surfaced via updater listener */
            }
            modalState.updaterStatusText = updaterStatusMessage();
            modalState.updaterActions = currentUpdaterActions();
            renderModal();
            return;
          }
          if (actionId === "download") {
            const result = (await window.zephus.downloadUpdate()) as {
              status?: string;
              error?: string;
            };
            if (result?.status === "error") {
              showModal("Update Download Failed", friendlyError(result.error), [
                { label: "OK", kind: "primary", onClick: closeModal },
              ]);
            }
            modalState.updaterStatusText = updaterStatusMessage();
            modalState.updaterActions = currentUpdaterActions();
            renderModal();
            return;
          }
          if (actionId === "restart") {
            await restartToApplyUpdate();
            return;
          }
          if (actionId === "cancel") {
            await window.zephus.cancelUpdateDownload();
            modalState.updaterStatusText = updaterStatusMessage();
            modalState.updaterActions = currentUpdaterActions();
            renderModal();
          }
        },
        onPickNodePath: async () => {
          modalState.nodeBrowseBusy = true;
          renderModal();
          try {
            const res = await window.zephus.pickNodePath();
            if (
              (res.status === "ok" || res.status === "outdated") &&
              res.usedCustomPath &&
              res.binaryPath
            ) {
              modalState.settings = {
                ...modalState.settings,
                customNodePath: res.binaryPath,
              };
            }
            modalState.nodeStatusText = `${nodeStatusMessage(res)} · ${
              modalState.settings.customNodePath
                ? `Custom: ${modalState.settings.customNodePath}`
                : "Auto-detect (system PATH)"
            }`;
            modalState.nodeAutoDisabled = !modalState.settings.customNodePath;
          } catch {
            modalState.nodeStatusText = "Could not set Node.js location.";
          } finally {
            modalState.nodeBrowseBusy = false;
            renderModal();
          }
        },
        onAutoNodePath: async () => {
          modalState.nodeAutoBusy = true;
          renderModal();
          try {
            const res = await window.zephus.setNodePath(null);
            modalState.settings = {
              ...modalState.settings,
              customNodePath: null,
            };
            modalState.nodeStatusText = `${nodeStatusMessage(res)} · Auto-detect (system PATH)`;
            modalState.nodeAutoDisabled = true;
          } catch {
            modalState.nodeStatusText = "Could not reset Node.js location.";
          } finally {
            modalState.nodeAutoBusy = false;
            renderModal();
          }
        },
        onOpenProductionLicenses: () => void openProductionLicensesModal(),
        onOpenConfigFolder: async () => {
          const result = await window.zephus.openConfigFolder();
          if (!result.ok) {
            setStatus(
              "Could not open config folder: " +
                (result.error ?? "unknown error"),
            );
          }
        },
      });
    };

    renderModal();
    showModalNode("Settings", wrap, [
      {
        label: "Reset to Defaults",
        kind: "danger",
        onClick: async () => {
          if (
            !(await modalController.confirmDestructive(
              "Reset Settings",
              "Reset all Zephus settings to defaults?",
              "Reset",
            ))
          )
            return;
          const defaults: GlobalSettings = {
            ...modalState.settings,
            theme: "system",
            autoCheckUpdates: true,
            updateChannel: "auto",
            restoreLastProject: false,
            confirmBlockDelete: true,
            autosave: false,
            codeFontSize: 13,
            customNodePath: null,
          };
          const reset = await window.zephus.writeGlobalSettings(defaults);
          if (!reset.ok) {
            setStatus(
              "Could not reset settings: " + (reset.error ?? "unknown error"),
            );
            return;
          }
          document.documentElement.setAttribute("data-theme", "system");
          applyCodeFontSize(13);
          closeModal();
          setStatus("Settings reset to defaults.");
          setAppSettings(defaults);
          updateSettingsTabSettings(defaults);
          updateSettingsTabNode("Checking Node.js…", true);
          void window.zephus
            .getNodeStatus()
            .then((res) => {
              updateSettingsTabNode(
                `${nodeStatusMessage(res)} · Auto-detect (system PATH)`,
                true,
              );
            })
            .catch(() => {
              updateSettingsTabNode(
                "Node.js status could not be determined.",
                true,
              );
            });
        },
      },
      { label: "Cancel", kind: "ghost", onClick: closeModal },
      {
        label: "Save",
        kind: "primary",
        onClick: async () => {
          const saved = await window.zephus.writeGlobalSettings(
            modalState.settings,
          );
          if (!saved.ok) {
            // Never claim "Settings saved." when the write failed (read-only
            // config dir, invalid custom node path, etc.).
            setStatus(
              "Settings could not be saved: " +
                (saved.error ?? "unknown error"),
            );
            return;
          }
          document.documentElement.setAttribute(
            "data-theme",
            modalState.settings.theme,
          );
          applyCodeFontSize(modalState.settings.codeFontSize);
          setAppSettings(modalState.settings);
          updateSettingsTabSettings(modalState.settings);
          const customPath = modalState.settings.customNodePath;
          updateSettingsTabNode(
            customPath
              ? `Node.js · Custom: ${customPath}`
              : "Node.js · Auto-detect (system PATH)",
            !customPath,
          );
          closeModal();
          setStatus("Settings saved.");
        },
      },
    ]);

    void window.zephus
      .getNodeStatus()
      .then((res) => {
        modalState.nodeStatusText = `${nodeStatusMessage(res)} · ${
          modalState.settings.customNodePath
            ? `Custom: ${modalState.settings.customNodePath}`
            : "Auto-detect (system PATH)"
        }`;
        modalState.nodeAutoDisabled = !modalState.settings.customNodePath;
        refreshSettingsStatusText();
      })
      .catch(() => {
        modalState.nodeStatusText = "Could not check Node.js.";
        refreshSettingsStatusText();
      });

    void window.zephus
      .getAppVersion()
      .then((v) => {
        modalState.versionText = `Zephus v${v}`;
        refreshSettingsStatusText();
      })
      .catch(() => {
        modalState.versionText = "Zephus";
        refreshSettingsStatusText();
      });
  }

  function showProductionLicensesModal(result: ProductionLicensesResult): void {
    if (!result.ok) {
      showModal(
        "Production Licenses Unavailable",
        result.error ?? "Could not load production license data.",
        [
          {
            label: "Back to Settings",
            kind: "ghost",
            onClick: () => void openSettingsModal(),
          },
          {
            label: "Open Raw JSON",
            kind: "primary",
            onClick: async () => {
              const opened = await window.zephus.openProductionLicensesFile();
              if (!opened.ok) {
                setStatus(opened.error ?? "Could not open licenses.json.");
              }
            },
          },
        ],
      );
      return;
    }

    const wrap = document.createElement("div");
    renderProductionLicensesModalBody(
      wrap,
      result.entries.length,
      result.entries.map((entry) => ({
        packageId: entry.packageId,
        licenses: entry.licenses,
        repository: entry.repository,
        licenseUrl: entry.licenseUrl,
        parentsLabel:
          entry.parents.slice(0, 4).join(" > ") || "Direct dependency",
      })),
    );

    showModalNode(
      "Production Licenses",
      wrap,
      [
        {
          label: "Back to Settings",
          kind: "ghost",
          onClick: () => void openSettingsModal(),
        },
        {
          label: "Open Raw JSON",
          kind: "ghost",
          onClick: async () => {
            const opened = await window.zephus.openProductionLicensesFile();
            if (!opened.ok) {
              setStatus(opened.error ?? "Could not open licenses.json.");
            }
          },
        },
        { label: "Close", kind: "primary", onClick: closeModal },
      ],
      { size: "wide" },
    );
  }

  async function openProductionLicensesModal(): Promise<void> {
    showModal(
      "Production Licenses",
      "Loading bundled production license data…",
      [{ label: "Close", kind: "ghost", onClick: closeModal }],
    );
    const result = await window.zephus.readProductionLicenses();
    showProductionLicensesModal(result);
  }

  return {
    openSettingsModal,
    showProductionLicensesModal,
    openProductionLicensesModal,
  };
}
