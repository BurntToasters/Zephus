import { app, BrowserWindow } from "electron";
import { autoUpdater, CancellationToken } from "electron-updater";
import log from "electron-log";
import { IPC } from "./ipcChannels";
import type { GlobalSettings } from "./types";
import {
  resolveUpdateFeedChannel,
  isChannelUpgrade,
  shouldAllowFeedDowngrade,
  isStableChannelCandidate,
} from "./services/updateChannel";
import type { ReleaseFeedChannel } from "./services/updateChannel";

let downloadToken: CancellationToken | null = null;
let isDownloading = false;
let downloadedVersion: string | null = null;
// The most recent status sent to the renderer, cached so a renderer that
// boots after an event can query it (startup check vs listener race).
let lastStatus: UpdaterStatus | null = null;
// The version most recently confirmed as a valid upgrade by isChannelUpgrade.
// Acts as a guard so a download can never install a build the channel rules
// rejected (electron-updater may surface semver-older builds when
// allowDowngrade is enabled for channel graduation).
let approvedVersion: string | null = null;
let activeFeedChannel: ReleaseFeedChannel | null = null;
let approvedFeedChannel: ReleaseFeedChannel | null = null;
let downloadedFeedChannel: ReleaseFeedChannel | null = null;

export interface UpdaterStatus {
  status:
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error"
    | "cancelled";
  version?: string;
  percent?: number;
  error?: string;
}

function applyChannel(settings: GlobalSettings): ReleaseFeedChannel {
  const installed = app.getVersion();
  const channel = resolveUpdateFeedChannel(settings.updateChannel, installed);
  if (channel === "latest") {
    autoUpdater.channel = "latest";
    autoUpdater.allowPrerelease = false;
  } else {
    autoUpdater.channel = channel;
    autoUpdater.allowPrerelease = true;
  }
  // Enable downgrade only when graduating to a more stable channel at the same
  // base version (e.g. db -> beta), where the target is a lower semver.
  // isChannelUpgrade is still the final gate, so real base downgrades are
  // never offered or downloaded.
  autoUpdater.allowDowngrade = shouldAllowFeedDowngrade(channel, installed);
  activeFeedChannel = channel;
  return channel;
}

function clearApprovedUpdate(): void {
  approvedVersion = null;
  approvedFeedChannel = null;
  downloadedVersion = null;
  downloadedFeedChannel = null;
}

/** Sets up the auto-updater event wiring. */
/** The most recent status sent to the renderer (queried at renderer boot to close the startup-check race). */
export function getLastUpdaterStatus(): UpdaterStatus | null {
  return lastStatus;
}

export function setupAutoUpdater(
  getWindow: () => BrowserWindow | null,
  getSettings: () => GlobalSettings,
): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = log;

  applyChannel(getSettings());

  const send = (data: UpdaterStatus) => {
    // Keep the latest status so a renderer that boots AFTER an event (the
    // startup check often resolves before the renderer's listener attaches —
    // those events were dropped and the sidebar falsely showed "Up to date")
    // can query it.
    lastStatus = data;
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.updaterStatus, data);
    }
  };

  autoUpdater.on("checking-for-update", () => send({ status: "checking" }));

  autoUpdater.on("update-available", (info) => {
    // electron-updater compares with raw semver and may report a build that
    // our channel rules reject (e.g. a less-stable build at the same base, or
    // a base downgrade surfaced because allowDowngrade was enabled). Re-gate.
    if (
      isChannelUpgrade(app.getVersion(), info.version) &&
      isStableChannelCandidate(activeFeedChannel ?? "latest", info.version)
    ) {
      approvedVersion = info.version;
      approvedFeedChannel = activeFeedChannel;
      downloadedVersion = null;
      downloadedFeedChannel = null;
      send({ status: "available", version: info.version });
    } else {
      clearApprovedUpdate();
      send({ status: "not-available", version: app.getVersion() });
    }
  });

  autoUpdater.on("update-not-available", () => {
    clearApprovedUpdate();
    send({ status: "not-available", version: app.getVersion() });
  });

  autoUpdater.on("error", (err) => {
    clearApprovedUpdate();
    log.error("Auto-updater error:", err);
    send({ status: "error", error: err.message });
  });

  autoUpdater.on("download-progress", (p) => {
    send({ status: "downloading", percent: p.percent });
  });

  autoUpdater.on("update-downloaded", (info) => {
    if (
      !approvedVersion ||
      !approvedFeedChannel ||
      info.version !== approvedVersion ||
      !isChannelUpgrade(app.getVersion(), info.version)
    ) {
      clearApprovedUpdate();
      const error = `Downloaded update ${info.version} was not approved for this channel.`;
      log.warn(error);
      send({ status: "error", error });
      return;
    }
    downloadedVersion = info.version;
    downloadedFeedChannel = approvedFeedChannel;
    send({ status: "downloaded", version: info.version });
  });
}

/** Check for updates (respects channel setting). */
export async function checkForUpdates(
  getSettings: () => GlobalSettings,
): Promise<UpdaterStatus> {
  if (!app.isPackaged) {
    return { status: "error", error: "Updates not available in dev mode." };
  }
  // Checking while a download is in flight would re-configure the feed under
  // the active transfer and could overwrite the approval it must verify.
  if (isDownloading) {
    return { status: "downloading" };
  }
  try {
    const feedChannel = applyChannel(getSettings());
    const result = await autoUpdater.checkForUpdates();
    const latest = result?.updateInfo?.version;
    // result.updateInfo is always populated with the feed's newest entry, even
    // when no update applies, so compare explicitly with channel rules rather
    // than treating its presence as "available".
    if (
      latest &&
      isChannelUpgrade(app.getVersion(), latest) &&
      isStableChannelCandidate(feedChannel, latest)
    ) {
      approvedVersion = latest;
      approvedFeedChannel = feedChannel;
      downloadedVersion = null;
      downloadedFeedChannel = null;
      return { status: "available", version: latest };
    }
    clearApprovedUpdate();
    return { status: "not-available", version: app.getVersion() };
  } catch (error) {
    clearApprovedUpdate();
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function downloadUpdate(
  getSettings?: () => GlobalSettings,
): Promise<UpdaterStatus> {
  if (isDownloading) {
    return { status: "downloading" };
  }
  if (!approvedVersion) {
    return {
      status: "error",
      error: "No applicable update available to download.",
    };
  }
  if (getSettings) {
    const currentFeed = resolveUpdateFeedChannel(
      getSettings().updateChannel,
      app.getVersion(),
    );
    if (!approvedFeedChannel || currentFeed !== approvedFeedChannel) {
      clearApprovedUpdate();
      return {
        status: "error",
        error:
          "Update channel changed. Check for updates again before downloading.",
      };
    }
  }
  try {
    isDownloading = true;
    downloadToken = new CancellationToken();
    // A hung connection used to deadlock the updater forever: isDownloading
    // stayed true, every later check/download returned "downloading", and the
    // only recovery was the settings-modal Cancel or an app restart. Cancel
    // the transfer after a generous timeout and surface a real error.
    const downloadTimeout = setTimeout(
      () => {
        downloadToken?.cancel();
      },
      30 * 60 * 1000,
    );
    try {
      await autoUpdater.downloadUpdate(downloadToken);
    } finally {
      clearTimeout(downloadTimeout);
    }
    downloadToken = null;
    isDownloading = false;
    if (!downloadedVersion || downloadedVersion !== approvedVersion) {
      downloadedVersion = null;
      downloadedFeedChannel = null;
      return {
        status: "error",
        error: "Downloaded update was not confirmed for this channel.",
      };
    }
    return {
      status: "downloaded",
      version: downloadedVersion,
    };
  } catch (error) {
    downloadToken = null;
    isDownloading = false;
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("cancelled")) return { status: "cancelled" };
    return { status: "error", error: msg };
  }
}

export function cancelDownload(getWindow: () => BrowserWindow | null): void {
  if (downloadToken) {
    downloadToken.cancel();
    downloadToken = null;
    // The in-flight downloadUpdate promise settles (rejects with "cancelled")
    // and clears isDownloading itself. Keeping it true here prevents a new
    // download from starting a second concurrent transfer on the same
    // autoUpdater before the first promise has resolved.
    approvedVersion = null;
    approvedFeedChannel = null;
    downloadedVersion = null;
    downloadedFeedChannel = null;
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.updaterStatus, {
        status: "cancelled",
      } as UpdaterStatus);
    }
  }
}

export function installUpdate(getSettings?: () => GlobalSettings): void {
  if (!downloadedVersion) {
    throw new Error("No downloaded update is ready to install.");
  }
  if (getSettings) {
    const currentFeed = resolveUpdateFeedChannel(
      getSettings().updateChannel,
      app.getVersion(),
    );
    if (!downloadedFeedChannel || currentFeed !== downloadedFeedChannel) {
      clearApprovedUpdate();
      throw new Error("Update channel changed. Check for updates again.");
    }
  }
  autoUpdater.quitAndInstall(false, true);
}
