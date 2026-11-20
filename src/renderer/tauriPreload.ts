import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message, open } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { IPC } from "../main/ipcChannels";
import { createZephusApi } from "../main/zephusApi";
import type { GlobalSettings, OperationResult } from "../main/types";
import { runShellSmoke } from "./shellSmoke";

type UpdaterPayload = {
  status: string;
  version?: string;
  percent?: number;
  error?: string;
};

let lastUpdaterStatus: UpdaterPayload | null = null;
let updateCandidateId: number | null = null;
let lastShellChannel: string | null = null;
let updaterEventsReady: Promise<void> | null = null;

function ensureUpdaterEvents(): Promise<void> {
  if (updaterEventsReady) return updaterEventsReady;
  updaterEventsReady = (async () => {
    await listen<Record<string, unknown>>("updater-status", (event) => {
      const mapped = mapRustUpdaterStatus(event.payload);
      if (mapped) emitUpdater(mapped);
    });
    await listen<{ percent?: number }>("updater-progress", (event) => {
      emitUpdater({
        status: "downloading",
        percent: event.payload.percent ?? 0,
      });
    });
  })();
  return updaterEventsReady;
}

async function requestUpdateCheck(): Promise<UpdaterPayload> {
  await ensureUpdaterEvents();
  const refusal = await tauriInvoke<{
    reason?: string;
    message?: string;
  } | null>("check_for_updates");
  if (refusal?.message) {
    const payload: UpdaterPayload = {
      status: "error",
      error: refusal.message,
    };
    emitUpdater(payload);
    return payload;
  }
  return lastUpdaterStatus ?? { status: "checking" };
}
let backendBaseUrl: string | null = null;
let eventSource: EventSource | null = null;
const channelListeners = new Map<string, Set<(payload: unknown) => void>>();

function mapRustUpdaterStatus(
  event: Record<string, unknown>,
): UpdaterPayload | null {
  const status = event.status;
  if (status === "checking") return { status: "checking" };
  if (status === "cancelled") return { status: "cancelled" };
  if (status === "available") {
    const candidateId = event.candidateId ?? event.candidate_id;
    if (typeof candidateId === "number") {
      updateCandidateId = candidateId;
    }
    const version = event.version;
    return {
      status: "available",
      version: typeof version === "string" ? version : undefined,
    };
  }
  if (status === "not-available") {
    return {
      status: "not-available",
      version: typeof event.version === "string" ? event.version : undefined,
    };
  }
  if (status === "downloaded") {
    return {
      status: "downloaded",
      version: typeof event.version === "string" ? event.version : undefined,
    };
  }
  if (status === "error") {
    const message = event.message;
    return {
      status: "error",
      error: typeof message === "string" ? message : "Update failed.",
    };
  }
  return null;
}

function emitUpdater(payload: UpdaterPayload): void {
  lastUpdaterStatus = payload;
  const listeners = channelListeners.get(IPC.updaterStatus);
  if (!listeners) return;
  for (const cb of listeners) cb(payload);
}

async function waitForBackendUrl(): Promise<string | null> {
  if (backendBaseUrl) return backendBaseUrl;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const url = await tauriInvoke<string | null>("backend_url");
    if (url) {
      backendBaseUrl = url.replace(/\/$/, "");
      return backendBaseUrl;
    }
    try {
      if (await tauriInvoke<boolean>("backend_start_failed")) return null;
    } catch {
      // Keep polling when the shell has not advertised a start failure.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function pickNodeExecutable(): Promise<string | null> {
  const isWindows = /Windows/i.test(navigator.userAgent);
  const picked = await open({
    title: "Select the Node.js Executable",
    directory: false,
    multiple: false,
    filters: isWindows
      ? [{ name: "Executable", extensions: ["exe"] }]
      : undefined,
  });
  return typeof picked === "string" ? picked : null;
}

async function promptForBackendNode(): Promise<string | null> {
  const locateLabel = "Set Custom Location…";
  for (;;) {
    const choice = await message(
      "Zephus could not start because Node.js was not found. Choose the node executable, or install Node.js from https://nodejs.org and reopen Zephus.",
      {
        title: "Node.js Not Found",
        kind: "warning",
        buttons: { ok: locateLabel, cancel: "OK" },
      },
    );
    if (choice !== locateLabel) return null;
    const picked = await pickNodeExecutable();
    if (!picked) return null;
    try {
      await tauriInvoke("set_backend_node", { path: picked });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await message(text, { title: "Invalid Node.js Location", kind: "error" });
      continue;
    }
    backendBaseUrl = null;
    const url = await waitForBackendUrl();
    if (url) return url;
    await message("That Node.js executable did not start the editor.", {
      title: "Node.js Not Found",
      kind: "error",
    });
  }
}

async function resolveBackendUrl(): Promise<string> {
  const ready = await waitForBackendUrl();
  if (ready) return ready;
  const smoke = (window as Window & { __ZEPHUS_SMOKE__?: boolean })
    .__ZEPHUS_SMOKE__;
  if (smoke) throw new Error("Node backend URL is not available.");
  const started = await promptForBackendNode();
  if (!started) throw new Error("Node backend URL is not available.");
  return started;
}

function ensureEventSource(base: string): void {
  if (eventSource) return;
  eventSource = new EventSource(`${base}/events`);
  eventSource.onmessage = (message) => {
    try {
      const parsed = JSON.parse(message.data) as {
        channel?: string;
        payload?: unknown;
      };
      if (!parsed.channel) return;
      const set = channelListeners.get(parsed.channel);
      if (!set) return;
      for (const cb of set) cb(parsed.payload);
    } catch {
      /* ignore malformed events */
    }
  };
}

async function httpInvoke(
  channel: string,
  ...args: unknown[]
): Promise<unknown> {
  const base = await resolveBackendUrl();
  const response = await fetch(`${base}/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, args }),
  });
  const body = (await response.json()) as {
    ok?: boolean;
    result?: unknown;
    error?: string;
  };
  if (!body.ok) {
    throw new Error(body.error ?? `Invoke failed for ${channel}`);
  }
  return body.result;
}

function shellChannel(channel: unknown): "auto" | "stable" | "beta" | "" {
  return channel === "auto" || channel === "stable" || channel === "beta"
    ? channel
    : "";
}

async function syncShellPreferences(
  settings: { theme?: unknown; updateChannel?: unknown },
  recheck: boolean,
): Promise<void> {
  const theme = typeof settings.theme === "string" ? settings.theme : "system";
  try {
    const native = theme === "light" || theme === "dark" ? theme : null;
    await getCurrentWindow().setTheme(native);
  } catch {
    // The saved theme is applied again the next time the window is created.
  }
  const channel = shellChannel(settings.updateChannel);
  const channelChanged = channel.length > 0 && channel !== lastShellChannel;
  if (channel.length > 0) lastShellChannel = channel;
  try {
    await tauriInvoke("apply_editor_settings", {
      theme,
      updateChannel: channel,
      recheck: recheck && channelChanged,
    });
  } catch {
    // The shell keeps the last theme and channel it was able to store.
  }
}

async function promptNodeIfNeeded(): Promise<void> {
  let status: { status?: string; message?: string };
  try {
    status = (await httpInvoke(IPC.nodeStatus)) as typeof status;
  } catch {
    return;
  }
  if (!status || status.status === "ok") return;
  const title =
    status.status === "missing"
      ? "Node.js Not Found"
      : status.status === "outdated"
        ? "Node.js Update Required"
        : "Node.js Check";
  const locateLabel = "Set Custom Location…";
  const choice = await message(status.message || title, {
    title,
    kind: "warning",
    buttons: { ok: locateLabel, cancel: "OK" },
  });
  if (choice !== locateLabel) return;
  const picked = await pickNodeExecutable();
  if (!picked) return;
  const probed = (await httpInvoke(IPC.nodeSetPath, picked)) as {
    status?: string;
    message?: string;
    version?: string | null;
    binaryPath?: string | null;
    usedCustomPath?: boolean;
  };
  const pickedNorm = picked.replace(/\\/g, "/").toLowerCase();
  const probedNorm = (probed.binaryPath ?? "")
    .replace(/\\/g, "/")
    .toLowerCase();
  if (
    !probed.usedCustomPath ||
    probedNorm !== pickedNorm ||
    probed.status === "missing" ||
    probed.status === "unknown"
  ) {
    await message(
      probed.message || "That file is not a working Node.js executable.",
      { title: "Invalid Node.js Location", kind: "error" },
    );
    return;
  }
  const settings = (await httpInvoke(IPC.settingsReadGlobal)) as GlobalSettings;
  settings.customNodePath = probed.binaryPath ?? picked;
  const saved = (await httpInvoke(
    IPC.settingsWriteGlobal,
    settings,
  )) as OperationResult;
  if (saved?.ok === false) {
    await message(saved.error || "Could not save the Node.js location.", {
      title: "Node.js Location",
      kind: "error",
    });
    return;
  }
  await message(
    probed.status === "ok"
      ? `Using Node.js ${probed.version}.`
      : "Saved, but this Node.js is still below the required version.",
    {
      title: "Node.js Location Saved",
      kind: probed.status === "ok" ? "info" : "warning",
    },
  );
}

function installReloadShortcut(): void {
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.repeat || event.altKey) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() !== "r") return;
      event.preventDefault();
      const set = channelListeners.get(IPC.reloadRequested);
      if (!set) return;
      for (const cb of set) cb(undefined);
    },
    true,
  );
}

async function finishEditorClose(generation: number): Promise<void> {
  const confirmer = (
    window as Window & { zephusConfirmClose?: () => Promise<boolean> }
  ).zephusConfirmClose;
  let proceed = true;
  if (typeof confirmer === "function") {
    try {
      proceed = await confirmer();
    } catch {
      proceed = false;
    }
  }
  if (!proceed) {
    await tauriInvoke("cancel_editor_close", { generation }).catch(
      () => undefined,
    );
    return;
  }
  try {
    await httpInvoke(IPC.previewStop);
  } catch {
    // The preview server may already be stopped.
  }
  await tauriInvoke("notify_settings_flushed", { generation }).catch(
    () => undefined,
  );
}

function installCloseHandler(): void {
  void listen<number>("prepare-for-close", (event) => {
    void finishEditorClose(event.payload);
  });
}

const MAX_DROPPED_ASSET_BYTES = 16 * 1024 * 1024;

type ImportedAsset = { webPath: string; category: string };

type AssetImportResult = {
  ok: boolean;
  imported: ImportedAsset[];
  errors: string[];
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(
      ...bytes.subarray(index, Math.min(index + chunk, bytes.length)),
    );
  }
  return btoa(binary);
}

function droppedFilePath(file: File): string {
  const candidate = (file as File & { path?: unknown }).path;
  return typeof candidate === "string" ? candidate : "";
}

/**
 * The editor drop hands over browser File objects. Electron can ask the shell
 * for a path; this webview cannot, so the bytes are written inside public/.
 * An explicit path string still uses the path importer.
 */
async function importDroppedAssets(
  projectPath: string,
  publicDir: string,
  files: Array<File | string>,
): Promise<AssetImportResult> {
  const list = Array.isArray(files) ? files : [];
  const imported: ImportedAsset[] = [];
  const errors: string[] = [];
  const paths: string[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      if (item.length > 0) paths.push(item);
      else errors.push("Dropped item is not a file.");
      continue;
    }
    const fromPath = droppedFilePath(item);
    if (fromPath) {
      paths.push(fromPath);
      continue;
    }
    if (
      typeof item?.arrayBuffer !== "function" ||
      typeof item.name !== "string"
    ) {
      errors.push("Dropped item is not a file.");
      continue;
    }
    if (item.size > MAX_DROPPED_ASSET_BYTES) {
      errors.push(
        `${item.name || "file"}: file is too large to drop. Use Import Files.`,
      );
      continue;
    }
    const data = bytesToBase64(new Uint8Array(await item.arrayBuffer()));
    const result = (await httpInvoke(
      IPC.importAssetBytes,
      projectPath,
      publicDir,
      item.name,
      data,
    )) as AssetImportResult;
    imported.push(...(result.imported ?? []));
    errors.push(...(result.errors ?? []));
  }
  if (paths.length > 0) {
    const result = (await httpInvoke(
      IPC.importAssetPaths,
      projectPath,
      publicDir,
      paths,
    )) as AssetImportResult;
    imported.push(...(result.imported ?? []));
    errors.push(...(result.errors ?? []));
  }
  return { ok: errors.length === 0, imported, errors };
}

function isTauriHost(): boolean {
  const w = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return w.__TAURI__ !== undefined || w.__TAURI_INTERNALS__ !== undefined;
}

async function bootstrapZephus(): Promise<void> {
  const base = await resolveBackendUrl();
  ensureEventSource(base);
  void listen("preview-closed", () => {
    void (async () => {
      try {
        await httpInvoke(IPC.previewStop);
      } catch {
        /* The Stop button may already have stopped the server. */
      }
      const set = channelListeners.get(IPC.previewClosed);
      if (!set) return;
      for (const cb of set) cb(undefined);
    })();
  });

  const invoke = (channel: string, ...args: unknown[]) =>
    httpInvoke(channel, ...args);

  const subscribe = <T>(channel: string, callback: (payload: T) => void) => {
    let set = channelListeners.get(channel);
    if (!set) {
      set = new Set();
      channelListeners.set(channel, set as Set<(payload: unknown) => void>);
    }
    set.add(callback as (payload: unknown) => void);
    return () => {
      set?.delete(callback as (payload: unknown) => void);
    };
  };

  const assetFilters = [
    {
      name: "All Assets",
      extensions: [
        "png",
        "jpg",
        "jpeg",
        "gif",
        "svg",
        "webp",
        "avif",
        "ico",
        "mp4",
        "webm",
        "mov",
        "mp3",
        "wav",
        "ogg",
        "m4a",
        "m4v",
        "pdf",
        "doc",
        "docx",
        "txt",
        "md",
        "csv",
        "xls",
        "xlsx",
        "ppt",
        "pptx",
        "odt",
        "rtf",
      ],
    },
    {
      name: "Images",
      extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico"],
    },
    {
      name: "Media",
      extensions: ["mp4", "webm", "mov", "mp3", "wav", "ogg", "m4a", "m4v"],
    },
    {
      name: "Documents",
      extensions: [
        "pdf",
        "doc",
        "docx",
        "txt",
        "md",
        "csv",
        "xls",
        "xlsx",
        "ppt",
        "pptx",
        "odt",
        "rtf",
      ],
    },
  ];

  const api = {
    ...createZephusApi(invoke, subscribe),
    writeGlobalSettings: async (
      settings: GlobalSettings,
    ): Promise<OperationResult> => {
      const result = (await invoke(
        IPC.settingsWriteGlobal,
        settings,
      )) as OperationResult;
      if (result?.ok !== false) {
        await syncShellPreferences(settings, true);
      }
      return result;
    },
    importAssets: async (
      projectPath: string,
      publicDir: string,
    ): Promise<{
      ok: boolean;
      imported: { webPath: string; category: string }[];
      errors: string[];
    }> => {
      const picked = await open({
        multiple: true,
        filters: assetFilters,
      });
      if (
        picked === null ||
        picked === undefined ||
        (Array.isArray(picked) && picked.length === 0)
      ) {
        return { ok: false, imported: [], errors: [] };
      }
      const paths = Array.isArray(picked) ? picked : [picked];
      return (await httpInvoke(
        IPC.importAssetPaths,
        projectPath,
        publicDir,
        paths,
      )) as {
        ok: boolean;
        imported: { webPath: string; category: string }[];
        errors: string[];
      };
    },
    importAssetPaths: async (
      projectPath: string,
      publicDir: string,
      files: Array<File | string>,
    ): Promise<{
      ok: boolean;
      imported: { webPath: string; category: string }[];
      errors: string[];
    }> => importDroppedAssets(projectPath, publicDir, files),
    pickNodePath: async (): Promise<unknown> => {
      const isWindows = /Windows/i.test(navigator.userAgent);
      const picked = await open({
        directory: false,
        multiple: false,
        filters: isWindows
          ? [{ name: "Executable", extensions: ["exe"] }]
          : undefined,
      });
      if (picked === null || picked === undefined) {
        return invoke(IPC.nodeStatus);
      }
      const selected = typeof picked === "string" ? picked : null;
      if (!selected) {
        return invoke(IPC.nodeStatus);
      }
      return invoke(IPC.nodeSetPath, selected);
    },
    openFolderDialog: async (): Promise<string | null> => {
      const picked = await open({ directory: true, multiple: false });
      return typeof picked === "string" ? picked : null;
    },
    chooseNewSiteFolder: async (): Promise<string | null> => {
      const picked = await open({ directory: true, multiple: false });
      return typeof picked === "string" ? picked : null;
    },
    openPreviewWindow: async (url: string): Promise<OperationResult> => {
      try {
        await tauriInvoke("open_preview_window", { url });
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      }
    },
    closePreviewWindow: async (): Promise<OperationResult> => {
      try {
        await tauriInvoke("close_preview_window");
        await httpInvoke(IPC.previewStop);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      }
    },
    publish: async (
      projectPath: string,
      outDir: string,
    ): Promise<{
      ok: boolean;
      outputDir?: string;
      revealed?: boolean;
      error?: string;
    }> => {
      const result = (await invoke(IPC.publish, projectPath, outDir)) as {
        ok: boolean;
        outputDir?: string;
        revealed?: boolean;
        error?: string;
      };
      if (!result?.ok || !result.outputDir) return result;
      try {
        await revealItemInDir(result.outputDir);
        return { ...result, revealed: true };
      } catch {
        // The build succeeded. A failed reveal must not be reported as opened.
        return { ...result, revealed: false };
      }
    },
    checkForUpdates: () => requestUpdateCheck(),
    downloadUpdate: async (): Promise<UpdaterPayload> => {
      if (updateCandidateId == null) {
        return {
          status: "error",
          error: "No update is available to download.",
        };
      }
      const outcome = await tauriInvoke<{
        success?: boolean;
        cancelled?: boolean;
        error?: string;
      }>("download_update", { candidateId: updateCandidateId });
      if (outcome?.cancelled) {
        const payload = { status: "cancelled" };
        emitUpdater(payload);
        return payload;
      }
      if (!outcome?.success) {
        const payload = {
          status: "error",
          error: outcome?.error ?? "Download failed.",
        };
        emitUpdater(payload);
        return payload;
      }
      return lastUpdaterStatus ?? { status: "downloading", percent: 0 };
    },
    cancelUpdateDownload: async (): Promise<OperationResult> => {
      await tauriInvoke("cancel_update_download");
      return { ok: true };
    },
    installUpdate: async (): Promise<OperationResult> => {
      if (updateCandidateId == null) {
        return { ok: false, error: "No downloaded update is ready." };
      }
      await tauriInvoke("install_update", {
        candidateId: updateCandidateId,
      });
      return { ok: true };
    },
    getLastUpdaterStatus: async () => lastUpdaterStatus,
    onUpdaterStatus: (callback: (data: UpdaterPayload) => void) => {
      void ensureUpdaterEvents();
      return subscribe(IPC.updaterStatus, callback);
    },
    revealOutputFolder: async (
      projectPath: string,
      outDir: string,
    ): Promise<OperationResult> => {
      const result = (await invoke(
        IPC.revealOutputFolder,
        projectPath,
        outDir,
      )) as OperationResult;
      if (result?.ok && result.path) {
        await revealItemInDir(result.path);
      }
      return result;
    },
    openConfigFolder: async (): Promise<OperationResult> => {
      const result = (await invoke(IPC.openConfigFolder)) as OperationResult & {
        path?: string;
      };
      if (result?.ok !== false && result.path) {
        await revealItemInDir(result.path);
      }
      return result;
    },
    openProductionLicensesFile: async (): Promise<OperationResult> => {
      const result = (await invoke(IPC.licensesOpenFile)) as OperationResult & {
        path?: string;
      };
      if (result?.ok && result.path) {
        try {
          await openPath(result.path);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return { ok: false, error: message };
        }
      }
      return result;
    },
  };

  (window as unknown as { zephus: typeof api }).zephus = api;
  window.dispatchEvent(new Event("zephus-ready"));
  await ensureUpdaterEvents();
  try {
    const settings = (await httpInvoke(IPC.settingsReadGlobal)) as {
      theme?: unknown;
      updateChannel?: unknown;
      autoCheckUpdates?: boolean;
    };
    await syncShellPreferences(settings, false);
    if (settings.autoCheckUpdates !== false) {
      void requestUpdateCheck();
    }
  } catch {
    // Defaults stay until the next settings save.
  }
  void tauriInvoke("mark_main_window_ready").catch(() => undefined);

  const smokeWindow = window as Window & { __ZEPHUS_SMOKE__?: boolean };
  if (!smokeWindow.__ZEPHUS_SMOKE__) {
    void promptNodeIfNeeded();
    return;
  }

  const runSmoke = async () => {
    try {
      const base = await resolveBackendUrl();
      const response = await fetch(`${base}/smoke-project`);
      const body = (await response.json()) as { path?: string | null };
      if (body.path) {
        (
          window as Window & { __zephusSmokeProjectPath?: string }
        ).__zephusSmokeProjectPath = body.path;
      }
      const failures = await runShellSmoke();
      await tauriInvoke("smoke_complete", { failures });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await tauriInvoke("smoke_complete", {
        failures: [`Smoke execution failed: ${message}`],
      });
    }
  };
  document.addEventListener("DOMContentLoaded", () => {
    void runSmoke();
  });
}

if (isTauriHost()) {
  installReloadShortcut();
  installCloseHandler();
  const bootWindow = window as Window & { __ZEPHUS_BOOT_CHECK__?: boolean };
  if (bootWindow.__ZEPHUS_BOOT_CHECK__) {
    void tauriInvoke("mark_main_window_ready").catch(() => undefined);
  } else {
    void bootstrapZephus().catch((error: unknown) => {
      console.error(error);
    });
  }
}
