import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "./ipcChannels";
import type {
  AssetListResult,
  DraftResult,
  DraftScope,
  DraftSummaryResult,
  GitStatus,
  GlobalSettings,
  OperationResult,
  PageDocument,
  PageDocumentResult,
  PageListResult,
  PageMeta,
  ProjectOpenResult,
  ProductionLicensesResult,
  ReusableSectionsResult,
  RepoSettings,
  SchemaEnsureResult,
  SiteDocument,
  SiteDocumentResult,
  DevServerStartResult,
  ThemePreviewServerResult,
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

  renamePage: (
    projectPath: string,
    page: string,
    pagesDir: string,
    nextSlug: string,
  ): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.renamePage, projectPath, page, pagesDir, nextSlug),

  duplicatePage: (
    projectPath: string,
    page: string,
    pagesDir: string,
    slugInput?: string,
  ): Promise<OperationResult> =>
    ipcRenderer.invoke(
      IPC.duplicatePage,
      projectPath,
      page,
      pagesDir,
      slugInput,
    ),

  deletePage: (
    projectPath: string,
    page: string,
    pagesDir: string,
  ): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.deletePage, projectPath, page, pagesDir),

  listPageMeta: (
    projectPath: string,
    pagesDir: string,
  ): Promise<PageListResult> =>
    ipcRenderer.invoke(IPC.listPageMeta, projectPath, pagesDir),

  readPageMeta: (
    projectPath: string,
    page: string,
    pagesDir: string,
  ): Promise<PageMeta> =>
    ipcRenderer.invoke(IPC.readPageMeta, projectPath, page, pagesDir),

  writePageMeta: (
    projectPath: string,
    page: string,
    pagesDir: string,
    partial: Partial<PageMeta>,
  ): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.writePageMeta, projectPath, page, pagesDir, partial),

  ensureVisualSchema: (
    projectPath: string,
    pagesDir: string,
  ): Promise<SchemaEnsureResult> =>
    ipcRenderer.invoke(IPC.schemaEnsure, projectPath, pagesDir),

  readSiteDocument: (projectPath: string): Promise<SiteDocumentResult> =>
    ipcRenderer.invoke(IPC.siteDocumentRead, projectPath),

  writeSiteDocument: (
    projectPath: string,
    site: SiteDocument,
    pagesDir: string,
  ): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.siteDocumentWrite, projectPath, site, pagesDir),

  readPageDocument: (
    projectPath: string,
    page: string,
    pagesDir: string,
  ): Promise<PageDocumentResult> =>
    ipcRenderer.invoke(IPC.pageDocumentRead, projectPath, page, pagesDir),

  writePageDocument: (
    projectPath: string,
    pagesDir: string,
    doc: PageDocument,
  ): Promise<PageDocumentResult> =>
    ipcRenderer.invoke(IPC.pageDocumentWrite, projectPath, pagesDir, doc),

  detachPageDocument: (
    projectPath: string,
    page: string,
    pagesDir: string,
    source: string,
  ): Promise<PageDocumentResult> =>
    ipcRenderer.invoke(
      IPC.pageDocumentDetach,
      projectPath,
      page,
      pagesDir,
      source,
    ),

  reattachPageDocument: (
    projectPath: string,
    page: string,
    pagesDir: string,
  ): Promise<PageDocumentResult> =>
    ipcRenderer.invoke(IPC.pageDocumentReattach, projectPath, page, pagesDir),

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

  readProductionLicenses: (): Promise<ProductionLicensesResult> =>
    ipcRenderer.invoke(IPC.licensesRead),

  openProductionLicensesFile: (): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.licensesOpenFile),

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

  listAssets: (
    projectPath: string,
    publicDir: string,
  ): Promise<AssetListResult> =>
    ipcRenderer.invoke(IPC.listAssets, projectPath, publicDir),

  listReusableSections: (): Promise<ReusableSectionsResult> =>
    ipcRenderer.invoke(IPC.listReusableSections),

  saveReusableSection: (
    label: string,
    html: string,
  ): Promise<ReusableSectionsResult> =>
    ipcRenderer.invoke(IPC.saveReusableSection, label, html),

  deleteReusableSection: (id: string): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.deleteReusableSection, id),

  readDraft: (
    projectPath: string,
    scope: DraftScope,
    target: string,
  ): Promise<DraftResult> =>
    ipcRenderer.invoke(IPC.draftRead, projectPath, scope, target),

  listDrafts: (): Promise<DraftSummaryResult> =>
    ipcRenderer.invoke(IPC.draftList),

  writeDraft: (
    projectPath: string,
    scope: DraftScope,
    target: string,
    content: string,
  ): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.draftWrite, projectPath, scope, target, content),

  clearDraft: (
    projectPath: string,
    scope: DraftScope,
    target: string,
  ): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.draftClear, projectPath, scope, target),

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

  ensureThemePreviewServer: (): Promise<ThemePreviewServerResult> =>
    ipcRenderer.invoke(IPC.themePreviewEnsure),

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

  getNodeStatus: (): Promise<unknown> => ipcRenderer.invoke(IPC.nodeStatus),
  pickNodePath: (): Promise<unknown> => ipcRenderer.invoke(IPC.nodePickPath),
  setNodePath: (customPath: string | null): Promise<unknown> =>
    ipcRenderer.invoke(IPC.nodeSetPath, customPath),

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
