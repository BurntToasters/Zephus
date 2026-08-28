import { describe, expect, it, vi } from "vitest";

import type { GlobalSettings } from "../types";

const electronMock = vi.hoisted(() => ({
  app: {
    getVersion: vi.fn(() => "0.1.0"),
    isPackaged: true,
  },
}));

const updaterMock = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  const listeners = new Map<string, Listener[]>();
  const autoUpdater = {
    autoDownload: true as boolean,
    autoInstallOnAppQuit: true as boolean,
    channel: "latest" as string,
    allowPrerelease: false as boolean,
    allowDowngrade: false as boolean,
    logger: null as unknown,
    on: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return autoUpdater;
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    quitAndInstall: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    reset: () => {
      listeners.clear();
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.channel = "latest";
      autoUpdater.allowPrerelease = false;
      autoUpdater.allowDowngrade = false;
      autoUpdater.logger = null;
      autoUpdater.on.mockClear();
      autoUpdater.quitAndInstall.mockClear();
      autoUpdater.checkForUpdates.mockReset();
      autoUpdater.downloadUpdate.mockReset();
    },
  };
  return {
    autoUpdater,
    CancellationToken: class {
      cancel = vi.fn();
    },
  };
});

vi.mock("electron", () => electronMock);
vi.mock("electron-updater", () => updaterMock);
vi.mock("electron-log", () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

function settings(override: Partial<GlobalSettings> = {}): GlobalSettings {
  return { ...settingsBase(), ...override };
}

function settingsBase(): GlobalSettings {
  return {
    recentProjects: [],
    theme: "system",
    lastOpenedProject: null,
    autoCheckUpdates: true,
    updateChannel: "auto",
    restoreLastProject: false,
    confirmBlockDelete: true,
    autosave: false,
    codeFontSize: 13,
    customNodePath: null,
  };
}

describe("updater install lifecycle", () => {
  it("does not silently install on normal quit", async () => {
    vi.resetModules();
    updaterMock.autoUpdater.reset();
    const { setupAutoUpdater } = await import("../updater");

    setupAutoUpdater(() => null, settings);

    expect(updaterMock.autoUpdater.autoDownload).toBe(false);
    expect(updaterMock.autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it("applies developer channel feed settings", async () => {
    vi.resetModules();
    updaterMock.autoUpdater.reset();
    electronMock.app.getVersion.mockReturnValue("0.1.0-db.3");
    const { setupAutoUpdater } = await import("../updater");

    setupAutoUpdater(
      () => null,
      () => settings({ updateChannel: "developer" }),
    );
    expect(updaterMock.autoUpdater.channel).toBe("db");
    expect(updaterMock.autoUpdater.allowPrerelease).toBe(true);
    expect(updaterMock.autoUpdater.allowDowngrade).toBe(false);
    electronMock.app.getVersion.mockReturnValue("0.1.0");
  });

  it("reports events for progress, errors, and rejected updates", async () => {
    vi.resetModules();
    updaterMock.autoUpdater.reset();
    electronMock.app.getVersion.mockReturnValue("0.1.0");
    const { setupAutoUpdater } = await import("../updater");
    const send = vi.fn();
    const win = {
      isDestroyed: () => false,
      webContents: { send },
    };
    setupAutoUpdater(() => win as never, settings);

    updaterMock.autoUpdater.emit("update-not-available");
    expect(send).toHaveBeenLastCalledWith("updater-status", {
      status: "not-available",
      version: "0.1.0",
    });

    updaterMock.autoUpdater.emit("error", new Error("boom"));
    expect(send).toHaveBeenLastCalledWith("updater-status", {
      status: "error",
      error: "boom",
    });

    updaterMock.autoUpdater.emit("download-progress", { percent: 42 });
    expect(send).toHaveBeenLastCalledWith("updater-status", {
      status: "downloading",
      percent: 42,
    });

    // A rejected update (same base, less stable channel) sends not-available.
    updaterMock.autoUpdater.emit("update-available", { version: "0.1.0-db.9" });
    expect(send).toHaveBeenLastCalledWith("updater-status", {
      status: "not-available",
      version: "0.1.0",
    });
  });

  it("guards checkForUpdates during an active download", async () => {
    vi.resetModules();
    updaterMock.autoUpdater.reset();
    const { setupAutoUpdater, checkForUpdates, downloadUpdate } =
      await import("../updater");
    setupAutoUpdater(() => null, settings);

    // Force the isDownloading flag by starting a download that never settles.
    updaterMock.autoUpdater.emit("update-available", { version: "9.9.9" });
    let releaseDownload: () => void = () => undefined;
    updaterMock.autoUpdater.downloadUpdate = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseDownload = () => resolve(undefined);
        }),
    );
    const downloading = downloadUpdate();
    const status = await checkForUpdates(settings);
    expect(status).toEqual({ status: "downloading" });
    releaseDownload();
    await downloading;
  });

  it("checkForUpdates reports a thrown check as an error", async () => {
    vi.resetModules();
    updaterMock.autoUpdater.reset();
    const { checkForUpdates } = await import("../updater");
    updaterMock.autoUpdater.checkForUpdates = vi.fn(() =>
      Promise.reject(new Error("network down")),
    );
    const status = await checkForUpdates(settings);
    expect(status.status).toBe("error");
  });

  it("downloadUpdate reports a cancelled or failed transfer", async () => {
    vi.resetModules();
    updaterMock.autoUpdater.reset();
    const { setupAutoUpdater, downloadUpdate } = await import("../updater");
    setupAutoUpdater(() => null, settings);
    updaterMock.autoUpdater.emit("update-available", { version: "9.9.9" });

    updaterMock.autoUpdater.downloadUpdate = vi.fn(() =>
      Promise.reject(new Error("Download cancelled")),
    );
    const cancelled = await downloadUpdate();
    expect(cancelled.status).toBe("cancelled");

    updaterMock.autoUpdater.downloadUpdate = vi.fn(() =>
      Promise.reject(new Error("disk full")),
    );
    const failed = await downloadUpdate();
    expect(failed.status).toBe("error");
  });

  it("restarts and relaunches only after an update is downloaded", async () => {
    vi.resetModules();
    updaterMock.autoUpdater.reset();
    const { setupAutoUpdater, installUpdate } = await import("../updater");
    const send = vi.fn();
    const win = {
      isDestroyed: () => false,
      webContents: { send },
    };

    setupAutoUpdater(() => win as never, settings);
    expect(() => installUpdate()).toThrow("No downloaded update");

    updaterMock.autoUpdater.emit("update-available", { version: "0.2.0" });
    updaterMock.autoUpdater.emit("update-downloaded", { version: "0.2.0" });
    installUpdate();

    expect(send).toHaveBeenCalledWith("updater-status", {
      status: "downloaded",
      version: "0.2.0",
    });
    expect(updaterMock.autoUpdater.quitAndInstall).toHaveBeenCalledWith(
      false,
      true,
    );
  });

  it("rejects install when settings channel changed after download", async () => {
    vi.resetModules();
    updaterMock.autoUpdater.reset();
    electronMock.app.getVersion.mockReturnValue("0.1.0-db.3");
    const { setupAutoUpdater, installUpdate } = await import("../updater");
    let updateChannel: ReturnType<typeof settings>["updateChannel"] =
      "developer";

    setupAutoUpdater(
      () => null,
      () => settings({ updateChannel }),
    );
    updaterMock.autoUpdater.emit("update-available", { version: "0.1.0-db.4" });
    updaterMock.autoUpdater.emit("update-downloaded", {
      version: "0.1.0-db.4",
    });
    updateChannel = "stable";

    expect(() => installUpdate(() => settings({ updateChannel }))).toThrow(
      "Update channel changed",
    );
    expect(updaterMock.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    electronMock.app.getVersion.mockReturnValue("0.1.0");
  });

  it("rejects a downloaded update that was not the approved version", async () => {
    vi.resetModules();
    updaterMock.autoUpdater.reset();
    const { setupAutoUpdater, installUpdate } = await import("../updater");
    const send = vi.fn();
    const win = {
      isDestroyed: () => false,
      webContents: { send },
    };

    setupAutoUpdater(() => win as never, settings);
    updaterMock.autoUpdater.emit("update-available", { version: "0.2.0" });
    updaterMock.autoUpdater.emit("update-downloaded", { version: "0.3.0" });

    expect(() => installUpdate()).toThrow("No downloaded update");
    expect(send).toHaveBeenCalledWith("updater-status", {
      status: "error",
      error: "Downloaded update 0.3.0 was not approved for this channel.",
    });
    expect(updaterMock.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("refuses update checks in dev mode", async () => {
    electronMock.app.isPackaged = false;
    try {
      const updater = await import("../updater");
      const result = await updater.checkForUpdates(() =>
        settings({ updateChannel: "stable" }),
      );
      expect(result.status).toBe("error");
    } finally {
      electronMock.app.isPackaged = true;
    }
  });

  it("reports an approved update as available after a manual check", async () => {
    updaterMock.autoUpdater.checkForUpdates = vi.fn(async () => ({
      updateInfo: { version: "0.2.0" },
    }));
    try {
      const updater = await import("../updater");
      const result = await updater.checkForUpdates(() =>
        settings({ updateChannel: "stable" }),
      );
      expect(result.status).toBe("available");
      expect(result.version).toBe("0.2.0");
    } finally {
      updaterMock.autoUpdater.checkForUpdates.mockReset();
    }
  });

  it("reports not-available when the feed version is not an upgrade", async () => {
    updaterMock.autoUpdater.checkForUpdates = vi.fn(async () => ({
      updateInfo: { version: "0.1.0" },
    }));
    try {
      const updater = await import("../updater");
      const result = await updater.checkForUpdates(() =>
        settings({ updateChannel: "stable" }),
      );
      expect(result.status).toBe("not-available");
    } finally {
      updaterMock.autoUpdater.checkForUpdates.mockReset();
    }
  });

  it("rejects a download when no update was approved", async () => {
    const updater = await import("../updater");
    const result = await updater.downloadUpdate(() =>
      settings({ updateChannel: "stable" }),
    );
    expect(result.status).toBe("error");
    expect(result.error).toContain("No applicable update");
  });

  it("rejects a download when the channel changed after approval", async () => {
    updaterMock.autoUpdater.checkForUpdates = vi.fn(async () => ({
      updateInfo: { version: "0.2.0" },
    }));
    try {
      const updater = await import("../updater");
      await updater.checkForUpdates(() =>
        settings({ updateChannel: "stable" }),
      );
      const result = await updater.downloadUpdate(() =>
        settings({ updateChannel: "beta" }),
      );
      expect(result.status).toBe("error");
      expect(result.error).toContain("channel changed");
    } finally {
      updaterMock.autoUpdater.checkForUpdates.mockReset();
    }
  });

  it("cancels an in-flight download and notifies the renderer", async () => {
    updaterMock.autoUpdater.checkForUpdates = vi.fn(async () => ({
      updateInfo: { version: "0.2.0" },
    }));
    updaterMock.autoUpdater.downloadUpdate = vi.fn(
      (token: { cancel: () => void }) =>
        new Promise((_resolve, reject) => {
          token.cancel = () => reject(new Error("Download cancelled"));
        }),
    );
    try {
      const updater = await import("../updater");
      await updater.checkForUpdates(() =>
        settings({ updateChannel: "stable" }),
      );
      const promise = updater.downloadUpdate(() =>
        settings({ updateChannel: "stable" }),
      );
      await vi.waitFor(() =>
        expect(updaterMock.autoUpdater.downloadUpdate).toHaveBeenCalled(),
      );
      const win = {
        isDestroyed: () => false,
        webContents: { send: vi.fn() },
      };
      updater.cancelDownload(() => win as never);
      await expect(promise).resolves.toMatchObject({ status: "cancelled" });
      expect(win.webContents.send).toHaveBeenCalledWith("updater-status", {
        status: "cancelled",
      });
    } finally {
      updaterMock.autoUpdater.downloadUpdate.mockReset();
      updaterMock.autoUpdater.checkForUpdates.mockReset();
    }
  });
});
