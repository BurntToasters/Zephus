import { app, BrowserWindow } from "electron";
import * as path from "path";
import log from "electron-log";
import { registerIpcHandlers } from "./ipc";
import { stopDevServer } from "./services/devServer";
import { readGlobalSettings } from "./services/settings";
import { setupAutoUpdater, checkForUpdates } from "./updater";

const isDev =
  process.argv.includes("--dev") || process.env.NODE_ENV === "development";
const isSmoke =
  process.argv.includes("--smoke") || process.env.ZEPHUS_SMOKE === "1";

log.initialize();
log.transports.file.level = "info";

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

function rendererPath(file: string): string {
  // main.js runs from dist/main; renderer files live at <root>/src/renderer.
  return path.join(__dirname, "..", "..", "src", "renderer", file);
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
  });
  void splashWindow.loadFile(rendererPath("splash.html"));
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
    },
  });

  void mainWindow.loadFile(rendererPath("index.html"));

  mainWindow.once("ready-to-show", () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow?.show();

    if (isDev) {
      mainWindow?.webContents.openDevTools({ mode: "bottom" });
    }

    if (isSmoke) {
      // Runtime smoke: window rendered successfully, exit cleanly.
      log.info("Smoke run: main window ready, exiting.");
      setTimeout(() => app.exit(0), 500);
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

app.whenReady().then(() => {
  registerIpcHandlers(() => mainWindow);
  createSplash();
  createMainWindow();
  initAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  stopDevServer();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopDevServer();
});
