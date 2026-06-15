import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "./ipcChannels";
import type {
  GitStatus,
  GlobalSettings,
  OperationResult,
  ProjectOpenResult,
  RepoSettings,
  DevServerStartResult,
} from "./types";
import type { ThemeMeta } from "./themes";

// The single, explicit bridge exposed to the renderer under contextIsolation.
const api = {
  openFolderDialog: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.openFolder),

  chooseNewSiteFolder: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.chooseNewSiteFolder),

  openProject: (projectPath: string): Promise<ProjectOpenResult> =>
    ipcRenderer.invoke(IPC.projectOpen, projectPath),

  listThemes: (): Promise<ThemeMeta[]> => ipcRenderer.invoke(IPC.listThemes),

  createSite: (targetPath: string, themeId: string): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.createSite, targetPath, themeId),

  createPage: (
    projectPath: string,
    pageName: string,
    pagesDir: string,
  ): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.createPage, projectPath, pageName, pagesDir),

  getGitStatus: (projectPath: string): Promise<GitStatus> =>
    ipcRenderer.invoke(IPC.gitStatus, projectPath),

  initGitRepo: (projectPath: string): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.gitInit, projectPath),

  readGlobalSettings: (): Promise<GlobalSettings> =>
    ipcRenderer.invoke(IPC.settingsReadGlobal),

  writeGlobalSettings: (settings: GlobalSettings): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.settingsWriteGlobal, settings),

  removeRecentProject: (projectPath: string): Promise<GlobalSettings> =>
    ipcRenderer.invoke(IPC.settingsRemoveRecent, projectPath),

  readRepoSettings: (projectPath: string): Promise<RepoSettings> =>
    ipcRenderer.invoke(IPC.settingsReadRepo, projectPath),

  getMergedSettings: (
    projectPath: string,
  ): Promise<{
    global: GlobalSettings;
    repo: RepoSettings;
    theme: GlobalSettings["theme"];
  }> => ipcRenderer.invoke(IPC.settingsMerged, projectPath),

  readFile: (
    projectPath: string,
    rel: string,
  ): Promise<{ ok: boolean; content?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.fileRead, projectPath, rel),

  writeFile: (
    projectPath: string,
    rel: string,
    content: string,
  ): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.fileWrite, projectPath, rel, content),

  importImage: (
    projectPath: string,
    publicDir: string,
  ): Promise<{
    ok: boolean;
    webPath?: string;
    canceled?: boolean;
    error?: string;
  }> => ipcRenderer.invoke(IPC.importImage, projectPath, publicDir),

  watchFile: (projectPath: string, rel: string): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.watchStart, projectPath, rel),

  stopWatch: (): Promise<OperationResult> => ipcRenderer.invoke(IPC.watchStop),

  onExternalChange: (callback: (rel: string) => void): (() => void) => {
    const listener = (_e: unknown, rel: string) => callback(rel);
    ipcRenderer.on(IPC.externalChange, listener);
    return () => ipcRenderer.removeListener(IPC.externalChange, listener);
  },

  listPages: (projectPath: string, pagesDir: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC.pagesList, projectPath, pagesDir),

  startPreview: (projectPath: string): Promise<DevServerStartResult> =>
    ipcRenderer.invoke(IPC.previewStart, projectPath),

  stopPreview: (): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.previewStop),

  publish: (
    projectPath: string,
    outDir: string,
  ): Promise<{ ok: boolean; outputDir?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.publish, projectPath, outDir),

  onPreviewLog: (callback: (chunk: string) => void): (() => void) => {
    const listener = (_e: unknown, chunk: string) => callback(chunk);
    ipcRenderer.on(IPC.previewLog, listener);
    return () => ipcRenderer.removeListener(IPC.previewLog, listener);
  },

  checkForUpdates: (): Promise<unknown> => ipcRenderer.invoke(IPC.updaterCheck),
  downloadUpdate: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.updaterDownload),
  cancelUpdateDownload: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.updaterCancel),
  installUpdate: (): Promise<unknown> => ipcRenderer.invoke(IPC.updaterInstall),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC.getAppVersion),
  openConfigFolder: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC.openConfigFolder),

  onUpdaterStatus: (
    callback: (data: {
      status: string;
      version?: string;
      percent?: number;
      error?: string;
    }) => void,
  ): (() => void) => {
    const listener = (
      _e: unknown,
      data: {
        status: string;
        version?: string;
        percent?: number;
        error?: string;
      },
    ) => callback(data);
    ipcRenderer.on(IPC.updaterStatus, listener);
    return () => ipcRenderer.removeListener(IPC.updaterStatus, listener);
  },
};

export type ZephusApi = typeof api;

contextBridge.exposeInMainWorld("zephus", api);
