import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { IPC } from "../main/ipcChannels";
import { createZephusApi } from "../main/zephusApi";
import type { OperationResult } from "../main/types";
import { runShellSmoke } from "./shellSmoke";

type UpdaterPayload = {
  status: string;
  version?: string;
  percent?: number;
  error?: string;
};

let lastUpdaterStatus: UpdaterPayload | null = null;
let updateCandidateId: number | null = null;
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

async function resolveBackendUrl(): Promise<string> {
  if (backendBaseUrl) return backendBaseUrl;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const url = await tauriInvoke<string | null>("backend_url");
    if (url) {
      backendBaseUrl = url.replace(/\/$/, "");
      return backendBaseUrl;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Node backend URL is not available.");
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
    checkForUpdates: async (): Promise<UpdaterPayload> => {
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
    },
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
      const unsub = subscribe(IPC.updaterStatus, callback);
      const unlistenPromise = listen<Record<string, unknown>>(
        "updater-status",
        (event) => {
          const mapped = mapRustUpdaterStatus(event.payload);
          if (mapped) emitUpdater(mapped);
        },
      );
      const unlistenProgress = listen<{ percent?: number }>(
        "updater-progress",
        (event) => {
          emitUpdater({
            status: "downloading",
            percent: event.payload.percent ?? 0,
          });
        },
      );
      return () => {
        unsub();
        void unlistenPromise.then((fn: UnlistenFn) => fn());
        void unlistenProgress.then((fn: UnlistenFn) => fn());
      };
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
  void tauriInvoke("mark_main_window_ready").catch(() => undefined);

  const smokeWindow = window as Window & { __ZEPHUS_SMOKE__?: boolean };
  if (!smokeWindow.__ZEPHUS_SMOKE__) return;

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
  const bootWindow = window as Window & { __ZEPHUS_BOOT_CHECK__?: boolean };
  if (bootWindow.__ZEPHUS_BOOT_CHECK__) {
    void tauriInvoke("mark_main_window_ready").catch(() => undefined);
  } else {
    void bootstrapZephus().catch((error: unknown) => {
      console.error(error);
    });
  }
}
