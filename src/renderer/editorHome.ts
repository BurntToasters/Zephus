/**
 * Home screen status + updater UI. Extracted from the engine: the home
 * recovery cards, recent-projects list, sidebar update status, and the
 * update prompts all read the same module state (updater snapshot, draft
 * summaries) — one module, one deps contract.
 */

import { updateHomeDraftRecovery } from "./HomeDraftRecovery";
import { updateRecentProjects } from "./RecentProjects";
import { updateSidebarUpdateStatus } from "./SidebarUpdateStatus";
import { updateSettingsTabUpdater } from "./SettingsTab";
import { isGlobalDirty } from "./editorSession";
import type { GlobalSettings } from "../main/types";

interface UpdaterSnapshotData {
  status: string;
  version?: string;
  percent?: number;
  error?: string;
}

export interface HomeDeps {
  $: (id: string) => HTMLElement;
  $maybe: (id: string) => HTMLElement | null;
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
  closeModal: () => void;
  getState: () => import("./editorSession").EditorSessionState;
  modalController: { isOpen: () => boolean };
  maybeResolveUnsavedWork: (options?: {
    reloadCurrentPageOnDiscard?: boolean;
  }) => Promise<boolean>;
  friendlyError: (raw: string | undefined) => string;
  projectBaseName: (projectPath: string) => string;
  formatRelativeTime: (value: string) => string;
  setAppSettings: (settings: GlobalSettings) => void;
  getAppSettings: () => GlobalSettings | null;
}

export function createHomeActions(deps: HomeDeps) {
  const {
    $,
    $maybe,
    setStatus,
    showModal,
    closeModal,
    getState,
    modalController,
    maybeResolveUnsavedWork,
    friendlyError,
    projectBaseName,
    formatRelativeTime,
    setAppSettings,
    getAppSettings,
  } = deps;

  const state = getState();

  let homeDraftSummaries: DraftSummary[] = [];
  let updaterSnapshot: UpdaterSnapshotData | null = null;
  let promptedDownloadedUpdateVersion: string | null = null;

  async function refreshHomeDraftSummaries(): Promise<void> {
    const result = await window.zephus.listDrafts().catch(() => null);
    homeDraftSummaries = result?.ok ? result.entries : [];
  }

  function homeDraftLabel(entry: DraftSummary): string {
    if (entry.scope === "site") {
      return "Unsaved site shell and design settings";
    }
    const page = entry.target.replace(/^src\/pages\/?/, "");
    return page === "index.astro" || page === "index.md" || page === "index.mdx"
      ? "Unsaved draft for Home"
      : `Unsaved draft for ${page.replace(/\.(astro|md|mdx|html)$/i, "")}`;
  }

  function syncHomeActionState(): void {
    const resumeBtn = $("btn-resume-last") as HTMLButtonElement;
    const hasLastProject = Boolean(getAppSettings()?.lastOpenedProject);
    resumeBtn.disabled = !hasLastProject;
    resumeBtn.classList.toggle("disabled", !hasLastProject);
  }

  function renderHomeStatusPanels(): void {
    const recoveryHost = $maybe("home-recovery-list");
    if (recoveryHost) {
      const drafts = homeDraftSummaries.slice(0, 4);
      if (drafts.length === 0) {
        recoveryHost.classList.add("hidden");
      } else {
        recoveryHost.classList.remove("hidden");
      }
      updateHomeDraftRecovery(
        drafts.map((draft) => ({
          projectPath: draft.projectPath,
          scope: draft.scope,
          target: draft.target,
          title: `${projectBaseName(draft.projectPath)} - ${formatRelativeTime(draft.savedAt)}`,
          body: homeDraftLabel(draft),
        })),
      );
    }

    // Render sidebar status badge
    renderSidebarUpdateStatus();
  }

  function updateVersionLabel(version?: string): string {
    return version ? `v${version}` : "the latest update";
  }

  function updaterStatusMessage(): string {
    if (updaterSnapshot?.status === "available") {
      return `${updateVersionLabel(updaterSnapshot.version)} is available.`;
    }
    if (updaterSnapshot?.status === "downloaded") {
      return `${updateVersionLabel(updaterSnapshot.version)} is downloaded and ready to install.`;
    }
    if (updaterSnapshot?.status === "downloading") {
      return `Downloading update (${Math.round(updaterSnapshot.percent ?? 0)}%).`;
    }
    if (updaterSnapshot?.status === "error") {
      return friendlyError(updaterSnapshot.error ?? "Update check failed.");
    }
    return updaterSnapshot?.version
      ? `You're up to date (v${updaterSnapshot.version}).`
      : "You're up to date.";
  }

  async function restartToApplyUpdate(): Promise<void> {
    // Unsaved edits must not be lost to the quit-and-install (the draft timer
    // can hold up to 800ms of work the process is about to destroy). Resolve
    // save/discard first, then let the close through.
    if (state.project && isGlobalDirty(state)) {
      const resolved = await maybeResolveUnsavedWork();
      if (!resolved) return;
    }
    setStatus("Restarting to apply update...");
    window.zephusMarkForceCloseAllowed?.();
    const result = (await window.zephus.installUpdate()) as
      { ok?: boolean; error?: string } | undefined;
    if (result && result.ok === false) {
      setStatus("Update install could not start.");
      showModal(
        "Could Not Restart",
        friendlyError(result.error ?? "The downloaded update was not ready."),
        [{ label: "OK", kind: "primary", onClick: closeModal }],
      );
    }
  }

  function currentUpdaterActions(): Array<{
    id: "check" | "download" | "restart" | "cancel";
    label: string;
    tone: "secondary" | "primary" | "ghost";
  }> {
    const actions: Array<{
      id: "check" | "download" | "restart" | "cancel";
      label: string;
      tone: "secondary" | "primary" | "ghost";
    }> = [{ id: "check", label: "Check for Updates Now", tone: "secondary" }];

    if (updaterSnapshot?.status === "available") {
      actions.push({
        id: "download",
        label: "Download Update",
        tone: "primary",
      });
    } else if (updaterSnapshot?.status === "downloaded") {
      actions.push({ id: "restart", label: "Restart Now", tone: "primary" });
    } else if (updaterSnapshot?.status === "downloading") {
      actions.push({ id: "cancel", label: "Cancel Download", tone: "ghost" });
    }

    return actions;
  }

  function refreshUpdaterControls(): void {
    updateSettingsTabUpdater(updaterStatusMessage(), currentUpdaterActions());
  }

  function promptDownloadedUpdate(force = false): void {
    if (updaterSnapshot?.status !== "downloaded") return;
    const version = updaterSnapshot.version ?? "downloaded";
    if (!force) {
      if (promptedDownloadedUpdateVersion === version) return;
      if (modalController.isOpen()) return;
    }
    promptedDownloadedUpdateVersion = version;
    showModal(
      "Update Ready",
      `Zephus ${updateVersionLabel(updaterSnapshot.version)} has been downloaded. Restart now to apply it; Zephus will relaunch after the update finishes.`,
      [
        { label: "Later", kind: "ghost", onClick: closeModal },
        {
          label: "Restart Now",
          kind: "primary",
          onClick: () => void restartToApplyUpdate(),
        },
      ],
    );
  }

  function renderSidebarUpdateStatus(): void {
    if (!updaterSnapshot) {
      updateSidebarUpdateStatus({
        clickable: false,
        dotTone: "default",
        label: "Up to date",
      });
      return;
    }

    if (updaterSnapshot.status === "available") {
      updateSidebarUpdateStatus({
        clickable: true,
        dotTone: "active",
        label: "Update Available",
        emphasized: true,
      });
    } else if (updaterSnapshot.status === "downloading") {
      updateSidebarUpdateStatus({
        clickable: false,
        dotTone: "active",
        label: `Downloading (${Math.round(updaterSnapshot.percent ?? 0)}%)`,
      });
    } else if (updaterSnapshot.status === "downloaded") {
      updateSidebarUpdateStatus({
        clickable: true,
        dotTone: "active",
        label: "Restart to install",
      });
    } else if (updaterSnapshot.status === "checking") {
      updateSidebarUpdateStatus({
        clickable: false,
        dotTone: "default",
        label: "Checking updates…",
      });
    } else if (updaterSnapshot.status === "error") {
      updateSidebarUpdateStatus({
        clickable: true,
        dotTone: "error",
        label: "Update Error",
      });
    } else if (updaterSnapshot.status === "cancelled") {
      // After Cancel the sidebar falsely reported "Up to date" (it fell into
      // the default branch); say what actually happened.
      updateSidebarUpdateStatus({
        clickable: true,
        dotTone: "default",
        label: "Update cancelled",
      });
    } else {
      const versionStr = updaterSnapshot.version
        ? `v${updaterSnapshot.version}`
        : "";
      updateSidebarUpdateStatus({
        clickable: false,
        dotTone: "default",
        label: `Up to date${versionStr ? " · " + versionStr : ""}`,
      });
    }
  }

  async function renderRecent(): Promise<void> {
    const settings = await window.zephus.readGlobalSettings();
    setAppSettings(settings);
    updateRecentProjects({
      entries: settings.recentProjects.map((p, index) => ({
        path: p,
        name: projectBaseName(p),
        badge:
          settings.lastOpenedProject === p
            ? "Last Opened"
            : index === 0
              ? "Most Recent"
              : "Recent",
        resumeLabel:
          settings.lastOpenedProject === p ? "Resume ready" : "Open directly",
      })),
    });
    renderHomeStatusPanels();
    syncHomeActionState();
  }

  return {
    refreshHomeDraftSummaries,
    homeDraftLabel,
    syncHomeActionState,
    renderHomeStatusPanels,
    updateVersionLabel,
    updaterStatusMessage,
    restartToApplyUpdate,
    currentUpdaterActions,
    refreshUpdaterControls,
    promptDownloadedUpdate,
    renderSidebarUpdateStatus,
    renderRecent,
    setUpdaterSnapshot: (snapshot: UpdaterSnapshotData | null): void => {
      updaterSnapshot = snapshot;
    },
    getHomeDraftSummaries: (): DraftSummary[] => homeDraftSummaries,
    getUpdaterSnapshot: (): UpdaterSnapshotData | null => updaterSnapshot,
  };
}
