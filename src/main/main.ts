import { app, BrowserWindow, dialog } from "electron";
import * as path from "path";
import log from "electron-log";
import { registerIpcHandlers } from "./ipc";
import { stopDevServer } from "./services/devServer";
import { stopThemePreviewServer } from "./services/themePreviewServer";
import { readGlobalSettings, writeGlobalSettings } from "./services/settings";
import { setupAutoUpdater, checkForUpdates } from "./updater";
import { checkNodeVersion } from "./services/nodeCheck";

const isDev =
  process.argv.includes("--dev") || process.env.NODE_ENV === "development";
const isSmoke =
  process.argv.includes("--smoke") || process.env.ZEPHUS_SMOKE === "1";
const isPrimaryInstance =
  isSmoke || typeof app.requestSingleInstanceLock !== "function"
    ? true
    : app.requestSingleInstanceLock();

try {
  const init = (log as unknown as { initialize?: () => void }).initialize;
  if (typeof init === "function") init.call(log);
} catch {
  // electron-log initialization should never block app startup.
}
if (log.transports?.file) {
  log.transports.file.level = "info";
}

process.setMaxListeners(48);

function cleanupBackgroundServices(): void {
  stopDevServer();
  stopThemePreviewServer();
}

function showFatalErrorDialog(error: Error): void {
  try {
    dialog.showErrorBox(
      "Fatal Error",
      `Zephus encountered an unexpected error and must close.\n\n${error.message}`,
    );
  } catch (dialogError) {
    log.error("Failed to show fatal error dialog:", dialogError);
  }
}

process.on("uncaughtException", (error) => {
  log.error("Uncaught exception:", error);
  cleanupBackgroundServices();
  showFatalErrorDialog(error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection:", reason);
});

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let isInstallingUpdate = false;

function rendererPath(file: string): string {
  // main.js runs from dist/main; renderer files live at <root>/src/renderer.
  return path.join(__dirname, "..", "..", "src", "renderer", file);
}

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function createSplash(): void {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    resizable: false,
    show: true,
    center: true,
    backgroundColor: "#1e1e2e",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  void splashWindow.loadFile(rendererPath("splash.html"));
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
  }, 30_000);
}

async function runRendererSmokeChecks(
  windowRef: BrowserWindow,
): Promise<string[]> {
  const script = `
    (async () => {
      const failures = [];
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const assert = (condition, message) => {
        if (!condition) failures.push(message);
      };

      const closeModalIfOpen = async () => {
        const overlay = document.getElementById("modal-overlay");
        if (!overlay || overlay.classList.contains("hidden")) return;
        const buttons = Array.from(
          document.querySelectorAll("#modal-actions button")
        );
        const closeBtn = buttons.find((button) =>
          /close|cancel|look around/i.test(button.textContent || "")
        );
        if (closeBtn instanceof HTMLElement) {
          closeBtn.click();
          await wait(180);
        }
      };

      try {
        assert(!!window.zephus, "window.zephus is missing.");
        assert(!!document.getElementById("view-start"), "Missing #view-start.");
        assert(!!document.getElementById("btn-open"), "Missing #btn-open.");
        assert(
          !!document.getElementById("btn-settings"),
          "Missing #btn-settings."
        );
        assert(
          !!document.getElementById("btn-home-create"),
          "Missing #btn-home-create."
        );
        assert(
          !!document.getElementById("tab-recent"),
          "Missing #tab-recent."
        );
        assert(
          !!document.getElementById("tab-create"),
          "Missing #tab-create."
        );
        assert(
          !!document.getElementById("recent-list"),
          "Missing #recent-list."
        );
        assert(
          !!document.getElementById("home-project-status"),
          "Missing #home-project-status."
        );
        assert(
          !!document.getElementById("theme-list-container"),
          "Missing #theme-list-container."
        );

        await wait(400);
        await closeModalIfOpen();

        const settingsBtn = document.getElementById("btn-settings");
        const overlay = document.getElementById("modal-overlay");
        if (settingsBtn instanceof HTMLElement && overlay instanceof HTMLElement) {
          settingsBtn.click();
          await wait(280);
          assert(
            !overlay.classList.contains("hidden"),
            "Settings modal did not open."
          );
          await closeModalIfOpen();
          assert(
            overlay.classList.contains("hidden"),
            "Settings modal did not close."
          );
        }

        const createTab = document.getElementById("tab-create");
        const themeContainer = document.getElementById("theme-list-container");
        if (createTab instanceof HTMLElement && themeContainer instanceof HTMLElement) {
          createTab.click();
          for (let i = 0; i < 20; i += 1) {
            if (themeContainer.querySelector(".theme-card")) break;
            await wait(250);
          }
          assert(
            themeContainer.querySelectorAll(".theme-card").length > 0,
            "Theme previews did not render."
          );
        }

        const createBtn = document.getElementById("btn-create");
        if (createBtn instanceof HTMLButtonElement) {
          assert(createBtn.disabled, "Create button should stay disabled until a theme is selected.");
        }
      } catch (error) {
        failures.push(
          "Smoke execution failed: " +
            (error && typeof error === "object" && "message" in error
              ? String(error.message)
              : String(error))
        );
      }

      return failures;
    })();
  `;

  return (await windowRef.webContents.executeJavaScript(
    script,
    true,
  )) as string[];
}

async function completeSmokeRun(windowRef: BrowserWindow): Promise<void> {
  try {
    const failures = await runRendererSmokeChecks(windowRef);
    if (failures.length > 0) {
      for (const failure of failures) {
        log.error("[smoke]", failure);
      }
      app.exit(1);
      return;
    }
    log.info("Smoke run: renderer checks passed, exiting.");
    app.exit(0);
  } catch (error) {
    log.error("Smoke run failed:", error);
    app.exit(1);
  }
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#1e1e2e",
    title: "Zephus",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  void mainWindow.loadFile(rendererPath("index.html"));

  mainWindow.once("ready-to-show", () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow?.show();

    if (isDev && !isSmoke) {
      mainWindow?.webContents.openDevTools({ mode: "bottom" });
    }

    if (isSmoke && mainWindow) {
      void (async () => {
        await new Promise((resolve) => setTimeout(resolve, 350));
        await completeSmokeRun(mainWindow!);
      })();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function initAutoUpdater(): void {
  if (isDev || isSmoke || !app.isPackaged) return;
  setupAutoUpdater(() => mainWindow, readGlobalSettings);
  const settings = readGlobalSettings();
  if (settings.autoCheckUpdates) {
    checkForUpdates(readGlobalSettings).catch((error) => {
      log.warn("Update check failed", error);
    });
  }
}

/**
 * Verifies the system Node.js (used to spawn `astro build`/`astro dev`) meets
 * the minimum version Astro requires. Shows a non-fatal warning dialog if not,
 * with an option to locate a custom Node.js binary. Runs in the background so
 * it never blocks startup.
 */
function initNodeVersionCheck(): void {
  if (isSmoke) return;
  void runNodeVersionCheck();
}

async function promptLocateNode(): Promise<void> {
  const target =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const isWindows = process.platform === "win32";
  const picked = await dialog.showOpenDialog(target as BrowserWindow, {
    title: "Select the Node.js Executable",
    properties: ["openFile"],
    filters: isWindows
      ? [{ name: "Executable", extensions: ["exe"] }]
      : undefined,
  });
  if (picked.canceled || picked.filePaths.length === 0) return;

  const selected = picked.filePaths[0];
  if (!selected) return;
  const status = await checkNodeVersion(selected);
  if (status.status === "missing" || status.status === "unknown") {
    await dialog.showMessageBox(target as BrowserWindow, {
      type: "error",
      title: "Invalid Node.js Location",
      message: "That file is not a working Node.js executable.",
      detail: selected,
      buttons: ["OK"],
      noLink: true,
    });
    return;
  }

  const settings = readGlobalSettings();
  settings.customNodePath = selected;
  writeGlobalSettings(settings);

  await dialog.showMessageBox(target as BrowserWindow, {
    type: status.status === "ok" ? "info" : "warning",
    title: "Node.js Location Saved",
    message:
      status.status === "ok"
        ? `Using Node.js ${status.version}.`
        : `Saved, but this Node.js is still below the required version.`,
    detail: status.message,
    buttons: ["OK"],
    noLink: true,
  });
}

async function runNodeVersionCheck(): Promise<void> {
  try {
    const result = await checkNodeVersion(readGlobalSettings().customNodePath);
    if (result.status === "ok") {
      log.info(`Node version check: ${result.message}`);
      return;
    }

    log.warn(`Node version check (${result.status}): ${result.message}`);
    const title =
      result.status === "missing"
        ? "Node.js Not Found"
        : result.status === "outdated"
          ? "Node.js Update Required"
          : "Node.js Check";
    const target =
      mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const response = await dialog.showMessageBox(target as BrowserWindow, {
      type: "warning",
      title,
      message: title,
      detail: result.message,
      buttons: ["Set Custom Location…", "OK"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });

    if (response.response === 0) {
      await promptLocateNode();
    }
  } catch (error) {
    log.warn("Node version check failed unexpectedly", error);
  }
}

if (!isPrimaryInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusMainWindow();
  });

  app.whenReady().then(() => {
    registerIpcHandlers(getMainWindow, {
      assertUpdaterSender: (senderId) =>
        Boolean(
          mainWindow &&
          !mainWindow.isDestroyed() &&
          senderId === mainWindow.webContents.id,
        ),
      markUpdateInstalling: () => {
        isInstallingUpdate = true;
      },
      clearUpdateInstalling: () => {
        isInstallingUpdate = false;
      },
    });
    createSplash();
    createMainWindow();
    initAutoUpdater();
    initNodeVersionCheck();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
        return;
      }
      focusMainWindow();
    });
  });
}

app.on("window-all-closed", () => {
  cleanupBackgroundServices();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (isInstallingUpdate) {
    log.info("App quitting to install an update.");
  }
  cleanupBackgroundServices();
});
