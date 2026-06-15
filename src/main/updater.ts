import { app, BrowserWindow } from "electron";
import { autoUpdater, CancellationToken } from "electron-updater";
import log from "electron-log";
import type { GlobalSettings } from "./types";

let downloadToken: CancellationToken | null = null;
let isDownloading = false;

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

function isBetaVersion(version: string): boolean {
  return /-(beta|alpha|rc)/i.test(version);
}

function resolveUseBeta(channel: GlobalSettings["updateChannel"]): boolean {
  if (channel === "beta") return true;
  if (channel === "stable") return false;
  // "auto" → match current install: beta installs get beta updates.
  return isBetaVersion(app.getVersion());
}

function applyChannel(settings: GlobalSettings): void {
  const useBeta = resolveUseBeta(settings.updateChannel);
  if (useBeta) {
    autoUpdater.channel = "beta";
    autoUpdater.allowPrerelease = true;
  } else {
    autoUpdater.channel = "latest";
    autoUpdater.allowPrerelease = false;
  }
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
  autoUpdater.autoInstallOnAppQuit = true;
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
    send({ status: "available", version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    send({ status: "not-available", version: app.getVersion() });
  });

  autoUpdater.on("error", (err) => {
    log.error("Auto-updater error:", err);
    send({ status: "error", error: err.message });
  });

  autoUpdater.on("download-progress", (p) => {
    send({ status: "downloading", percent: p.percent });
  });

  autoUpdater.on("update-downloaded", (info) => {
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
    applyChannel(getSettings());
    const result = await autoUpdater.checkForUpdates();
    if (result?.updateInfo) {
      return { status: "available", version: result.updateInfo.version };
    }
    return { status: "not-available", version: app.getVersion() };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function downloadUpdate(): Promise<UpdaterStatus> {
  if (isDownloading) {
    return { status: "downloading" };
  }
  try {
    isDownloading = true;
    downloadToken = new CancellationToken();
    await autoUpdater.downloadUpdate(downloadToken);
    downloadToken = null;
    isDownloading = false;
    return { status: "downloaded" };
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
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("updater-status", {
        status: "cancelled",
      } as UpdaterStatus);
    }
  }
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true);
}
