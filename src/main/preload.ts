import { contextBridge, ipcRenderer, webUtils } from "electron";
import { createZephusApi } from "./zephusApi";
import { IPC } from "./ipcChannels";

const invoke = (channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, ...args);

const subscribe = <T>(channel: string, callback: (payload: T) => void) => {
  const listener = (_e: unknown, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const base = createZephusApi(invoke, subscribe);

const api = {
  ...base,
  importAssetPaths: (
    projectPath: string,
    publicDir: string,
    files: File[],
  ): Promise<{
    ok: boolean;
    imported: { webPath: string; category: string }[];
    errors: string[];
  }> => {
    const paths = files
      .map((file) => {
        try {
          return webUtils.getPathForFile(file);
        } catch {
          return "";
        }
      })
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    return ipcRenderer.invoke(
      IPC.importAssetPaths,
      projectPath,
      publicDir,
      paths,
    );
  },
};

export type ZephusApi = typeof api;

if (process.isMainFrame === true) {
  contextBridge.exposeInMainWorld("zephus", api);
}
