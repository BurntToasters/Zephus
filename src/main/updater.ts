import { app, BrowserWindow } from "electron";
import { autoUpdater, CancellationToken } from "electron-updater";
import log from "electron-log";
import type { GlobalSettings } from "./types";
import {
  resolveUpdateFeedChannel,
  isChannelUpgrade,
  shouldAllowFeedDowngrade,
} from "./services/updateChannel";
import type { ReleaseFeedChannel } from "./services/updateChannel";

let downloadToken: CancellationToken | null = null;
let isDownloading = false;
let downloadedVersion: string | null = null;
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

/**
 * Sets up the auto-updater event wiring. Called once on app startup.
 * Sends status events to the renderer via `updater-status`.
 */
export function setupAutoUpdater(
  getWindow: () => BrowserWindow | null,
  getSettings: () => GlobalSettings,
): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = log;

  applyChannel(getSettings());

  const send = (data: UpdaterStatus) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("updater-status", data);
    }
  };

  autoUpdater.on("checking-for-update", () => send({ status: "checking" }));

  autoUpdater.on("update-available", (info) => {
    // electron-updater compares with raw semver and may report a build that
    // our channel rules reject (e.g. a less-stable build at the same base, or
    // a base downgrade surfaced because allowDowngrade was enabled). Re-gate.
    if (isChannelUpgrade(app.getVersion(), info.version)) {
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
  try {
    const feedChannel = applyChannel(getSettings());
    const result = await autoUpdater.checkForUpdates();
    const latest = result?.updateInfo?.version;
    // result.updateInfo is always populated with the feed's newest entry, even
    // when no update applies, so compare explicitly with channel rules rather
    // than treating its presence as "available".
    if (latest && isChannelUpgrade(app.getVersion(), latest)) {
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
    await autoUpdater.downloadUpdate(downloadToken);
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
    isDownloading = false;
    downloadedVersion = null;
    downloadedFeedChannel = null;
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("updater-status", {
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
