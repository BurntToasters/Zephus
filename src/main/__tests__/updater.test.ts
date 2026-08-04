import { describe, expect, it, vi } from "vitest";

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
    autoDownload: true,
    autoInstallOnAppQuit: true,
    channel: "latest",
    allowPrerelease: false,
    allowDowngrade: false,
    logger: null as unknown,
    on: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return autoUpdater;
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    quitAndInstall: vi.fn(),
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

function settings(
  override: Partial<ReturnType<typeof settingsBase>> = {},
): ReturnType<typeof settingsBase> {
  return { ...settingsBase(), ...override };
}

function settingsBase() {
  return {
    recentProjects: [],
    theme: "system" as const,
    lastOpenedProject: null,
    autoCheckUpdates: true,
    updateChannel: "auto" as const,
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
      const result = await updater.checkForUpdates(() => ({
        updateChannel: "stable",
      }));
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
      const result = await updater.checkForUpdates(() => ({
        updateChannel: "stable",
      }));
      expect(result.status).toBe("available");
      expect(result.version).toBe("0.2.0");
    } finally {
      delete updaterMock.autoUpdater.checkForUpdates;
    }
  });

  it("reports not-available when the feed version is not an upgrade", async () => {
    updaterMock.autoUpdater.checkForUpdates = vi.fn(async () => ({
      updateInfo: { version: "0.1.0" },
    }));
    try {
      const updater = await import("../updater");
      const result = await updater.checkForUpdates(() => ({
        updateChannel: "stable",
      }));
      expect(result.status).toBe("not-available");
    } finally {
      delete updaterMock.autoUpdater.checkForUpdates;
    }
  });

  it("rejects a download when no update was approved", async () => {
    const updater = await import("../updater");
    const result = await updater.downloadUpdate(() => ({
      updateChannel: "stable",
    }));
    expect(result.status).toBe("error");
    expect(result.error).toContain("No applicable update");
  });

  it("rejects a download when the channel changed after approval", async () => {
    updaterMock.autoUpdater.checkForUpdates = vi.fn(async () => ({
      updateInfo: { version: "0.2.0" },
    }));
    try {
      const updater = await import("../updater");
      await updater.checkForUpdates(() => ({ updateChannel: "stable" }));
      const result = await updater.downloadUpdate(() => ({
        updateChannel: "beta",
      }));
      expect(result.status).toBe("error");
      expect(result.error).toContain("channel changed");
    } finally {
      delete updaterMock.autoUpdater.checkForUpdates;
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
      await updater.checkForUpdates(() => ({ updateChannel: "stable" }));
      const promise = updater.downloadUpdate(() => ({
        updateChannel: "stable",
      }));
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
      delete updaterMock.autoUpdater.downloadUpdate;
      delete updaterMock.autoUpdater.checkForUpdates;
    }
  });
});
