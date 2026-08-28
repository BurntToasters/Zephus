import * as fs from "fs";
import { app, BrowserWindow, dialog, shell, session, ipcMain } from "electron";
import { pathToFileURL } from "url";
import * as path from "path";
import log from "electron-log";
import { registerIpcHandlers } from "./ipc";
import { stopDevServer } from "./services/devServer";
import { stopThemePreviewServer } from "./services/themePreviewServer";
import { stopWatching } from "./services/watch";
import { readGlobalSettings, writeGlobalSettings } from "./services/settings";
import { setupAutoUpdater, checkForUpdates } from "./updater";
import { checkNodeVersion, validateNodePath } from "./services/nodeCheck";
import { createSite } from "./services/wizard";
import { execFileSync } from "child_process";
import { IPC } from "./ipcChannels";

// Dev mode ONLY when not packaged: a shipped binary launched with --dev (or
// NODE_ENV=development) previously got devTools AND silently disabled the
// auto-updater. Gate on app.isPackaged so release builds always update.
const isDev =
  !app.isPackaged &&
  (process.argv.includes("--dev") ||
    process.env.NODE_ENV === "development" ||
    // `electron .` (npm start) runs the app WITHOUT the --dev flag and with
    // process.defaultApp === true; it is still a dev run and needs devtools.
    process.defaultApp === true);
const isSmoke =
  !app.isPackaged &&
  (process.argv.includes("--smoke") || process.env.ZEPHUS_SMOKE === "1");
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
  if (splashCloseTimer) {
    clearTimeout(splashCloseTimer);
    splashCloseTimer = null;
  }
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
  closePreviewWindow();
  stopWatching();
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
  try {
    cleanupBackgroundServices();
  } catch (cleanupErr) {
    log.error("Cleanup failed during uncaught exception handling:", cleanupErr);
  }
  showFatalErrorDialog(error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection:", reason);
});

let mainWindow: BrowserWindow | null = null;
let previewWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let splashCloseTimer: NodeJS.Timeout | null = null;
let isInstallingUpdate = false;
let smokeExitCode: number | null = null;

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
      devTools: isDev,
    },
  });
  void splashWindow.loadFile(rendererPath("splash.html"));
  splashCloseTimer = setTimeout(() => {
    splashCloseTimer = null;
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
          !!document.getElementById("tab-settings"),
          "Missing #tab-settings."
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
          !!document.getElementById("sidebar-update-status"),
          "Missing #sidebar-update-status."
        );
        assert(
          !!document.getElementById("theme-list-container"),
          "Missing #theme-list-container."
        );

        await wait(400);
        await closeModalIfOpen();

        const settingsBtn = document.getElementById("tab-settings");
        const overlay = document.getElementById("modal-overlay");
        if (settingsBtn instanceof HTMLElement && overlay instanceof HTMLElement) {
          settingsBtn.click();
          await wait(280);
          assert(
            document.getElementById("pane-settings")?.classList.contains("active"),
            "Settings pane did not open."
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

        if (typeof window.__zephusRunEditorSmoke === "function") {
          const editorFailures = await window.__zephusRunEditorSmoke();
          for (const failure of editorFailures) failures.push(failure);
        } else {
          failures.push("Editor smoke hook is missing.");
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

function finishSmokeProcess(exitCode: number): void {
  smokeExitCode = exitCode;
  process.exitCode = exitCode;

  let quitStarted = false;
  let sendFallback: NodeJS.Timeout | null = null;
  const quit = (): void => {
    if (quitStarted) return;
    quitStarted = true;
    process.off("disconnect", onDisconnect);
    if (sendFallback) {
      clearTimeout(sendFallback);
      sendFallback = null;
    }
    app.quit();
  };
  const onDisconnect = (): void => quit();

  if (typeof process.send !== "function") {
    quit();
    return;
  }

  // Stay alive beyond the launcher's complete TERM/KILL budget so Windows
  // taskkill /t never loses the root PID while traversing its process tree.
  process.once("disconnect", onDisconnect);
  sendFallback = setTimeout(quit, 10_000);
  try {
    process.send(
      { type: "zephus-smoke-complete", exitCode },
      (error: Error | null) => {
        if (!error) return;
        log.warn("Could not notify smoke launcher:", error);
        quit();
      },
    );
  } catch (error) {
    log.warn("Could not notify smoke launcher:", error);
    quit();
  }
}

let smokeCompletionStarted = false;

async function completeSmokeRun(windowRef: BrowserWindow): Promise<void> {
  if (smokeCompletionStarted) return;
  smokeCompletionStarted = true;

  let exitCode = 1;
  // A real on-disk project lets the editor smoke drive save/publish/git/
  // drafts end to end instead of synthesizing renderer-only state.
  let smokeProjectPath: string | null = null;
  try {
    if (isSmoke) {
      smokeProjectPath = scaffoldSmokeProject();
      if (smokeProjectPath) {
        await windowRef.webContents.executeJavaScript(
          `window.__zephusSmokeProjectPath = ${JSON.stringify(smokeProjectPath)};`,
          true,
        );
      }
    }
    const failures = await runRendererSmokeChecks(windowRef);
    if (failures.length > 0) {
      for (const failure of failures) {
        log.error("[smoke]", failure);
      }
    } else {
      exitCode = 0;
      log.info("Smoke run: renderer checks passed, shutting down.");
    }
  } catch (error) {
    log.error("Smoke run failed:", error);
  } finally {
    if (smokeProjectPath) {
      try {
        fs.rmSync(smokeProjectPath, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
    cleanupBackgroundServices();
    finishSmokeProcess(exitCode);
  }
}

/**
 * Scaffolds a real minimal site into a temp dir for the editor smoke suite.
 * Links the repo's node_modules so preview/publish builds resolve Astro
 * without a network install. Returns the project path, or null on failure.
 */
function scaffoldSmokeProject(): string | null {
  try {
    // Every smoke run leaves its scaffold behind when killed hard (timeout,
    // Ctrl+C) — the cleanup in completeSmokeRun's finally never runs. Purge
    // stale scaffolds before creating a new one so the temp dir does not
    // accumulate zephus-smoke-* folders.
    const tempRoot = app.getPath("temp");
    try {
      const stale = fs.readdirSync(tempRoot, { withFileTypes: true }).filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith("zephus-smoke-") &&
          // Never touch a scaffold from an in-flight run on another
          // machine profile: only purge when old enough that no smoke
          // could still be using it (a fresh run starts seconds ago).
          Date.now() - fs.statSync(path.join(tempRoot, entry.name)).mtimeMs >
            10 * 60 * 1000,
      );
      for (const entry of stale) {
        fs.rmSync(path.join(tempRoot, entry.name), {
          recursive: true,
          force: true,
        });
      }
    } catch {
      // Best-effort: a failed purge must not block the smoke scaffold.
    }
    const dir = fs.mkdtempSync(path.join(tempRoot, "zephus-smoke-"));
    const project = path.join(dir, "site");
    fs.mkdirSync(project);
    const created = createSite(project, "minimal");
    if (!created.ok) return null;
    // createSite does NOT init git (the IPC handler does); the smoke needs a
    // real repo with an identity so commit flows run end to end.
    execFileSync("git", ["init"], { cwd: project, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Zephus Smoke"], {
      cwd: project,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.email", "smoke@zephus.local"], {
      cwd: project,
      stdio: "ignore",
    });
    // Give the scaffolded site the repo's toolchain (mirrors the real build
    // tests) so `npm run build` resolves astro from the symlink.
    const rootModules = path.resolve(__dirname, "..", "..", "node_modules");
    if (fs.existsSync(rootModules)) {
      const target = path.join(project, "node_modules");
      try {
        // Windows: directory symlinks need admin/Developer Mode; junctions
        // work without either. macOS/Linux: plain dir symlink.
        fs.symlinkSync(
          rootModules,
          target,
          process.platform === "win32" ? "junction" : "dir",
        );
      } catch {
        // Best-effort: the real-project flows degrade to renderer-only
        // checks when the toolchain link cannot be created.
      }
    }
    return project;
  } catch (error) {
    log.error("Smoke scaffold failed", error);
    return null;
  }
}

/** Decodes a file:// URL to a normalized absolute path (Windows drive aware). */
function fileUrlToPath(url: URL): string {
  let p = decodeURIComponent(url.pathname);
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return path.normalize(p);
}

function isWithinPath(root: string, target: string): boolean {
  // Trailing separators (a URL root like file://…/renderer/) must not make
  // every containment test false: root + sep would become "…/renderer//".
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  return (
    target === normalizedRoot || target.startsWith(normalizedRoot + path.sep)
  );
}

/** True for the renderer's own file:// origin or the localhost dev-server preview. */
function isAllowedFrameUrl(target: string, rendererRootUrl: string): boolean {
  if (target === "about:blank") return true;
  if (target.startsWith("file://")) {
    // Normalize the path (resolving `..` and percent-encoding) before the
    // containment check: a raw prefix match would let
    // file://…/renderer/../../../../etc/passwd through while Chromium
    // normalizes the navigation to a file outside the app.
    try {
      return isWithinPath(
        fileUrlToPath(new URL(rendererRootUrl)),
        fileUrlToPath(new URL(target)),
      );
    } catch {
      return false;
    }
  }
  return isLocalhostPreviewUrl(target);
}

/**
 * Installs deny-by-default navigation/window-open guards on a webContents.
 * Top-frame navigations away from the renderer are blocked (external http(s)
 * opens in the OS browser); subframe navigations are restricted to the renderer
 * origin and the localhost preview; redirects outside those are blocked.
 */
function installNavigationGuards(contents: Electron.WebContents): void {
  const rendererRoot = pathToFileURL(rendererPath("")).toString();
  const rendererRootUrl = rendererRoot.endsWith("/")
    ? rendererRoot
    : `${rendererRoot}/`;
  const isInternal = (target: string): boolean => {
    if (!target.startsWith("file://")) return false;
    try {
      return isWithinPath(
        fileUrlToPath(new URL(rendererRootUrl)),
        fileUrlToPath(new URL(target)),
      );
    } catch {
      return false;
    }
  };
  const openExternal = (url: string): void => {
    // mailto:/tel: links (portfolio CTAs, restaurant reservation buttons)
    // must reach the OS handlers too, or clicking them silently does nothing.
    if (/^(https?:\/\/|mailto:|tel:)/i.test(url)) void shell.openExternal(url);
  };

  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    // The dedicated preview window hosts the localhost dev server, so in-site
    // navigation between its own pages must be allowed there (only there).
    const isPreviewContents =
      !!previewWindow &&
      !previewWindow.isDestroyed() &&
      contents === previewWindow.webContents;
    const allow =
      isInternal(url) ||
      (isPreviewContents && isAllowedFrameUrl(url, rendererRootUrl));
    if (!allow) {
      event.preventDefault();
      openExternal(url);
    }
  });
  contents.on("will-frame-navigate", (details) => {
    if (!isAllowedFrameUrl(details.url, rendererRootUrl)) {
      details.preventDefault();
    }
  });
  contents.on("will-redirect", (event, url) => {
    if (!isAllowedFrameUrl(url, rendererRootUrl)) {
      event.preventDefault();
    }
  });
}

/**
 * Applies navigation guards to every webContents the app creates (covers the
 * preview iframe and any future webviews), as defense in depth beyond the
 * per-window installation in createMainWindow.
 */
function installGlobalNavigationGuards(): void {
  app.on("web-contents-created", (_event, contents) => {
    installNavigationGuards(contents);
  });
}

/** Electron dialogs route by parent INSTANCE: passing undefined makes the
 *  second argument become the options object and the real options are
 *  dropped. Branch explicitly instead of passing undefined. */
function showOpenDialogFor(
  parent: BrowserWindow | null | undefined,
  options: Electron.OpenDialogOptions,
): Promise<Electron.OpenDialogReturnValue> {
  return parent && !parent.isDestroyed()
    ? dialog.showOpenDialog(parent, options)
    : dialog.showOpenDialog(options);
}

function showMessageBoxFor(
  parent: BrowserWindow | null | undefined,
  options: Electron.MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
  return parent && !parent.isDestroyed()
    ? dialog.showMessageBox(parent, options)
    : dialog.showMessageBox(options);
}

/** True for an http(s) localhost/127.0.0.1 URL (the dev-server preview). */
function isLocalhostPreviewUrl(target: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(
    target,
  );
}

/**
 * Opens (or refocuses) a dedicated preview window that loads the project's
 * running dev server. The window deliberately has NO preload bridge — it hosts
 * the user's own site, which must not see Zephus IPC. Closing the window stops
 * the dev server and notifies the editor so its Preview button resets.
 */
function openPreviewWindow(url: string): { ok: boolean; error?: string } {
  if (!isLocalhostPreviewUrl(url)) {
    return { ok: false, error: "Refused to open a non-local preview URL." };
  }
  if (previewWindow && !previewWindow.isDestroyed()) {
    void previewWindow.loadURL(url);
    previewWindow.focus();
    return { ok: true };
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 480,
    minHeight: 480,
    show: false,
    backgroundColor: "#ffffff",
    title: "Zephus Preview",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDev,
    },
  });
  previewWindow = win;
  void win.loadURL(url);
  win.once("ready-to-show", () => {
    if (previewWindow === win) win.show();
  });
  win.on("closed", () => {
    // Guard the captured window: a close/reopen race must not let the OLD
    // window's closed handler null out or tear down the NEW one (orphan
    // window, dev server killed, renderer UI reset while preview B stays up).
    if (previewWindow !== win) return;
    previewWindow = null;
    // Closing the preview always tears down the dev server it was showing.
    stopDevServer();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.previewClosed);
    }
  });
  return { ok: true };
}

function closePreviewWindow(): void {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.close();
  }
  previewWindow = null;
}

const WINDOW_STATE_FILE = "window-state.json";

interface WindowState {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  maximized?: boolean;
}

function readWindowState(): WindowState {
  try {
    const raw = fs.readFileSync(
      path.join(app.getPath("userData"), WINDOW_STATE_FILE),
      "utf8",
    );
    const parsed = JSON.parse(raw) as WindowState;
    if (typeof parsed.width !== "number" || typeof parsed.height !== "number") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function writeWindowState(state: WindowState): void {
  try {
    fs.writeFileSync(
      path.join(app.getPath("userData"), WINDOW_STATE_FILE),
      JSON.stringify(state),
    );
  } catch {
    // Non-fatal: window-state persistence is best effort.
  }
}

function denyAllPermissions(ses: Electron.Session): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  ses.setPermissionCheckHandler(() => false);
}

function createMainWindow(): void {
  // The editor needs no camera/mic/geolocation/notifications: embedded
  // iframes (video/embed blocks, theme previews) must never be able to
  // request them.
  denyAllPermissions(session.defaultSession);
  // Restore the window size/position from the previous session (every launch
  // used to reset to 1280x820 at an OS-chosen spot).
  const state = readWindowState();
  const win = new BrowserWindow({
    width: state.width ?? 1280,
    height: state.height ?? 820,
    minWidth: 960,
    minHeight: 640,
    x: state.x,
    y: state.y,
    show: false,
    backgroundColor: "#1e1e2e",
    title: "Zephus",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDev,
    },
  });
  mainWindow = win;
  if (state.maximized) win.maximize();

  // Persist bounds on close (and while moving/resizing, debounced) so the
  // layout survives restarts.
  let boundsTimer: NodeJS.Timeout | null = null;
  const persistBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      boundsTimer = null;
      if (!win || win.isDestroyed()) return;
      const bounds = win.getNormalBounds();
      writeWindowState({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: win.isMaximized(),
      });
    }, 300);
  };
  win.on("resize", persistBounds);
  win.on("move", persistBounds);

  void mainWindow.loadFile(rendererPath("index.html"), {
    query: isSmoke ? { smoke: "1" } : undefined,
  });

  // Security: navigation/window-open guards are applied to every webContents
  // via installGlobalNavigationGuards() (registered before this window is
  // created), so no per-window installation is needed here.

  // Cmd/Ctrl+R must not bypass the unsaved-work guard: the menu accelerator
  // fires before the renderer's keydown, so intercept it here and let the
  // renderer resolve save/discard before reloading.
  win.webContents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      input.key.toLowerCase() === "r" &&
      (input.control || input.meta)
    ) {
      event.preventDefault();
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.reloadRequested);
      }
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (splashCloseTimer) {
      clearTimeout(splashCloseTimer);
      splashCloseTimer = null;
    }
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow?.show();

    // ZEPHUS_BOOT_CHECK=1: verify the packaged binary boots — the renderer
    // loaded + became visible. Exit 0 immediately (no UI automation).
    if (process.env.ZEPHUS_BOOT_CHECK === "1") {
      log.info("[boot-check] packaged renderer loaded successfully");
      app.exit(0);
      return;
    }

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

  // A failed renderer load used to leave the window hidden forever (splash
  // closed after 30s, no UI, no error). Surface it instead of hanging.
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription) => {
      log.error("Renderer failed to load", errorCode, errorDescription);
      if (splashWindow) {
        splashWindow.close();
        splashWindow = null;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.webContents.executeJavaScript(
          `document.body.innerHTML =
            '<div style="font-family:system-ui;padding:2rem;color:#18181b">' +
            '<h2>Zephus could not load its interface</h2>' +
            '<p>Reload the window to try again. If it keeps failing, reinstall Zephus.</p>' +
            '<button id="z-reload">Reload Window</button></div>';` +
            `document.getElementById('z-reload').addEventListener('click', () => location.reload());`,
        );
      }
    },
  );
  let rendererCrashCount = 0;
  let lastCrashTime = 0;
  const MAX_CRASH_RELOADS = 3;
  const CRASH_WINDOW_MS = 30_000;

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log.error("Renderer process gone", details.reason);
    cleanupBackgroundServices();

    const now = Date.now();
    if (now - lastCrashTime > CRASH_WINDOW_MS) rendererCrashCount = 0;
    lastCrashTime = now;
    rendererCrashCount += 1;

    // Auto-reload on transient crashes, but cap to prevent infinite loops.
    if (
      rendererCrashCount <= MAX_CRASH_RELOADS &&
      mainWindow &&
      !mainWindow.isDestroyed()
    ) {
      mainWindow.webContents.reload();
    } else {
      log.error(
        `Renderer crashed ${rendererCrashCount} times in ${CRASH_WINDOW_MS}ms — not reloading`,
      );
    }
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
/**
 * Enforces a Content-Security-Policy from the main process for our own
 * file:// renderer responses (defense beyond the renderer meta tag). Skips
 * localhost responses so the dev-server preview iframe is unaffected.
 */
function setupSecurityHeaders(): void {
  const CSP =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' data: https://fonts.gstatic.com; " +
    "img-src 'self' data:; connect-src 'self'; object-src 'none'; " +
    "base-uri 'self'; frame-ancestors 'none'; form-action 'self'; " +
    "frame-src 'self' http://localhost:* http://127.0.0.1:* http://[::1]:*";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith("file://")) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [CSP],
      },
    });
  });
}

function initNodeVersionCheck(): void {
  if (isSmoke) return;
  void runNodeVersionCheck();
}

async function promptLocateNode(): Promise<void> {
  const target =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const isWindows = process.platform === "win32";
  const picked = await showOpenDialogFor(target, {
    title: "Select the Node.js Executable",
    properties: ["openFile"],
    filters: isWindows
      ? [{ name: "Executable", extensions: ["exe"] }]
      : undefined,
  });
  if (picked.canceled || picked.filePaths.length === 0) return;

  const selected = picked.filePaths[0];
  if (!selected) return;
  const validation = validateNodePath(selected);
  if (!validation.ok || !validation.path) {
    await showMessageBoxFor(target, {
      type: "error",
      title: "Invalid Node.js Location",
      message: validation.error ?? "That file is not a valid Node.js path.",
      detail: selected,
      buttons: ["OK"],
      noLink: true,
    });
    return;
  }
  const status = await checkNodeVersion(validation.path);
  if (status.status === "missing" || status.status === "unknown") {
    await showMessageBoxFor(target, {
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
  settings.customNodePath = validation.path;
  writeGlobalSettings(settings);

  await showMessageBoxFor(target, {
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
    const response = await showMessageBoxFor(target, {
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
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow();
      return;
    }
    focusMainWindow();
  });

  app.whenReady().then(() => {
    setupSecurityHeaders();
    installGlobalNavigationGuards();
    registerIpcHandlers(getMainWindow, {
      isSmoke,
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
    // Preview-window IPC lives here because it owns BrowserWindow lifecycle.
    // Only the main editor window may drive it.
    const isMainSender = (senderId?: number): boolean =>
      Boolean(
        mainWindow &&
        !mainWindow.isDestroyed() &&
        senderId === mainWindow.webContents.id,
      );
    ipcMain.handle(IPC.previewWindowOpen, (event, url: string) => {
      if (!isMainSender(event.sender.id)) {
        return { ok: false, error: "Unauthorized sender." };
      }
      return openPreviewWindow(url);
    });
    ipcMain.handle(IPC.previewWindowClose, (event) => {
      if (!isMainSender(event.sender.id)) {
        return { ok: false, error: "Unauthorized sender." };
      }
      closePreviewWindow();
      return { ok: true };
    });
    createSplash();
    createMainWindow();
    initAutoUpdater();
    initNodeVersionCheck();

    app.on("activate", () => {
      // macOS dock click: recreate when the main window is gone, even if a
      // preview window is still open (previously a no-op — only quit+relaunch
      // recovered the app).
      if (!mainWindow || mainWindow.isDestroyed()) {
        createMainWindow();
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
        return;
      }
      focusMainWindow();
    });
  });
}

app.on("window-all-closed", () => {
  // On macOS the app stays alive after the window closes; tearing the dev
  // server/watcher down here made every Cmd+W -> dock-reopen a dead preview
  // that never restarted. Cleanup happens on real quit (will-quit).
  if (process.platform !== "darwin") {
    cleanupBackgroundServices();
    app.quit();
  }
});

app.on("before-quit", () => {
  if (isInstallingUpdate) {
    log.info("App quitting to install an update.");
  }
  // NOTE: cleanup intentionally does NOT run here. before-quit fires before
  // window close; the renderer's unsaved-work guard can CANCEL the close, and
  // a cancel after cleanup left the dev server/watcher/theme server dead while
  // the app kept running. will-quit fires only after every close confirmed.
});

app.on("will-quit", (event) => {
  cleanupBackgroundServices();
  if (smokeExitCode === null) return;
  event.preventDefault();
  const exitCode = smokeExitCode;
  smokeExitCode = null;
  app.exit(exitCode);
});
