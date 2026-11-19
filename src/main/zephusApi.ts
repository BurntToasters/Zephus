import { IPC } from "./ipcChannels";
import type {
  AssetListResult,
  AssetMutationResult,
  AssetUsageResult,
  FindReplaceResult,
  ReplaceAllResult,
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

export type ZephusInvoke = (
  channel: string,
  ...args: unknown[]
) => Promise<unknown>;

export type ZephusSubscribe = (
  channel: string,
  callback: (payload: unknown) => void,
) => () => void;

export function createZephusApi(
  invoke: ZephusInvoke,
  subscribe: ZephusSubscribe,
) {
  const rawInvoke = invoke;
  const call = <T>(channel: string, ...args: unknown[]): Promise<T> =>
    rawInvoke(channel, ...args) as Promise<T>;
  const on = (channel: string) => (callback: (payload: unknown) => void) =>
    subscribe(channel, callback);
  return {
    openFolderDialog: (): Promise<string | null> => call(IPC.openFolder),

    chooseNewSiteFolder: (): Promise<string | null> =>
      call(IPC.chooseNewSiteFolder),

    openProject: (projectPath: string): Promise<ProjectOpenResult> =>
      call(IPC.projectOpen, projectPath),

    listThemes: (): Promise<ThemeMeta[]> => call(IPC.listThemes),

    createSite: (
      targetPath: string,
      themeId: string,
    ): Promise<OperationResult> => call(IPC.createSite, targetPath, themeId),

    createPage: (
      projectPath: string,
      pageName: string,
      pagesDir: string,
    ): Promise<OperationResult> =>
      call(IPC.createPage, projectPath, pageName, pagesDir),

    renamePage: (
      projectPath: string,
      page: string,
      pagesDir: string,
      nextSlug: string,
    ): Promise<OperationResult> =>
      call(IPC.renamePage, projectPath, page, pagesDir, nextSlug),

    duplicatePage: (
      projectPath: string,
      page: string,
      pagesDir: string,
      slugInput?: string,
    ): Promise<OperationResult> =>
      call(IPC.duplicatePage, projectPath, page, pagesDir, slugInput),

    deletePage: (
      projectPath: string,
      page: string,
      pagesDir: string,
    ): Promise<OperationResult> =>
      call(IPC.deletePage, projectPath, page, pagesDir),

    listPageMeta: (
      projectPath: string,
      pagesDir: string,
    ): Promise<PageListResult> => call(IPC.listPageMeta, projectPath, pagesDir),

    readPageMeta: (
      projectPath: string,
      page: string,
      pagesDir: string,
    ): Promise<PageMeta> => call(IPC.readPageMeta, projectPath, page, pagesDir),

    writePageMeta: (
      projectPath: string,
      page: string,
      pagesDir: string,
      partial: Partial<PageMeta>,
    ): Promise<OperationResult> =>
      call(IPC.writePageMeta, projectPath, page, pagesDir, partial),

    ensureVisualSchema: (
      projectPath: string,
      pagesDir: string,
    ): Promise<SchemaEnsureResult> =>
      call(IPC.schemaEnsure, projectPath, pagesDir),

    readSiteDocument: (projectPath: string): Promise<SiteDocumentResult> =>
      call(IPC.siteDocumentRead, projectPath),

    writeSiteDocument: (
      projectPath: string,
      site: SiteDocument,
      pagesDir: string,
    ): Promise<OperationResult> =>
      call(IPC.siteDocumentWrite, projectPath, site, pagesDir),

    readPageDocument: (
      projectPath: string,
      page: string,
      pagesDir: string,
    ): Promise<PageDocumentResult> =>
      call(IPC.pageDocumentRead, projectPath, page, pagesDir),

    writePageDocument: (
      projectPath: string,
      pagesDir: string,
      doc: PageDocument,
    ): Promise<PageDocumentResult> =>
      call(IPC.pageDocumentWrite, projectPath, pagesDir, doc),

    detachPageDocument: (
      projectPath: string,
      page: string,
      pagesDir: string,
      source: string,
    ): Promise<PageDocumentResult> =>
      call(IPC.pageDocumentDetach, projectPath, page, pagesDir, source),

    reattachPageDocument: (
      projectPath: string,
      page: string,
      pagesDir: string,
    ): Promise<PageDocumentResult> =>
      call(IPC.pageDocumentReattach, projectPath, page, pagesDir),

    getGitStatus: (
      projectPath: string,
      options?: { fetchRemote?: boolean },
    ): Promise<GitStatus> => call(IPC.gitStatus, projectPath, options),

    initGitRepo: (projectPath: string): Promise<OperationResult> =>
      call(IPC.gitInit, projectPath),

    commitGitChanges: (
      projectPath: string,
      message: string,
      paths?: string[],
    ): Promise<OperationResult> =>
      call(IPC.gitCommit, projectPath, message, paths),

    pushGitChanges: (projectPath: string): Promise<OperationResult> =>
      call(IPC.gitPush, projectPath),

    pullGitChanges: (projectPath: string): Promise<OperationResult> =>
      call(IPC.gitPull, projectPath),

    readGlobalSettings: (): Promise<GlobalSettings> =>
      call(IPC.settingsReadGlobal),

    writeGlobalSettings: (settings: GlobalSettings): Promise<OperationResult> =>
      call(IPC.settingsWriteGlobal, settings),

    removeRecentProject: (projectPath: string): Promise<GlobalSettings> =>
      call(IPC.settingsRemoveRecent, projectPath),

    readRepoSettings: (projectPath: string): Promise<RepoSettings> =>
      call(IPC.settingsReadRepo, projectPath),

    getMergedSettings: (
      projectPath: string,
    ): Promise<{
      global: GlobalSettings;
      repo: RepoSettings;
      theme: GlobalSettings["theme"];
    }> => call(IPC.settingsMerged, projectPath),

    readProductionLicenses: (): Promise<ProductionLicensesResult> =>
      call(IPC.licensesRead),

    openProductionLicensesFile: (): Promise<OperationResult> =>
      call(IPC.licensesOpenFile),

    readFile: (
      projectPath: string,
      rel: string,
    ): Promise<{ ok: boolean; content?: string; error?: string }> =>
      call(IPC.fileRead, projectPath, rel),

    importAssets: (
      projectPath: string,
      publicDir: string,
    ): Promise<{
      ok: boolean;
      imported: { webPath: string; category: string }[];
      errors: string[];
    }> => call(IPC.importAssets, projectPath, publicDir),

    searchPages: (
      projectPath: string,
      pagesDir: string,
      query: string,
      options: { caseSensitive?: boolean; wholeWord?: boolean },
    ): Promise<FindReplaceResult> =>
      call(IPC.searchPages, projectPath, pagesDir, query, options),

    replaceAllInPages: (
      projectPath: string,
      pagesDir: string,
      query: string,
      replacement: string,
      options: { caseSensitive?: boolean; wholeWord?: boolean },
      onlyPages?: string[],
    ): Promise<ReplaceAllResult> =>
      call(
        IPC.replaceAll,
        projectPath,
        pagesDir,
        query,
        replacement,
        options,
        onlyPages,
      ),

    deleteAsset: (
      projectPath: string,
      publicDir: string,
      webPath: string,
    ): Promise<AssetMutationResult> =>
      call(IPC.assetDelete, projectPath, publicDir, webPath),

    renameAsset: (
      projectPath: string,
      publicDir: string,
      pagesDir: string,
      webPath: string,
      nextName: string,
    ): Promise<AssetMutationResult> =>
      call(
        IPC.assetRename,
        projectPath,
        publicDir,
        pagesDir,
        webPath,
        nextName,
      ),

    findAssetUsage: (
      projectPath: string,
      pagesDir: string,
      webPath: string,
    ): Promise<AssetUsageResult> =>
      call(IPC.assetUsage, projectPath, pagesDir, webPath),

    listAssets: (
      projectPath: string,
      publicDir: string,
    ): Promise<AssetListResult> => call(IPC.listAssets, projectPath, publicDir),

    readAssetDataUrl: (
      projectPath: string,
      publicDir: string,
      webPath: string,
    ): Promise<{ ok: boolean; dataUrl?: string; error?: string }> =>
      call(IPC.assetDataUrl, projectPath, publicDir, webPath),

    listReusableSections: (
      projectPath: string,
    ): Promise<ReusableSectionsResult> =>
      call(IPC.listReusableSections, projectPath),

    saveReusableSection: (
      projectPath: string,
      label: string,
      html: string,
    ): Promise<ReusableSectionsResult> =>
      call(IPC.saveReusableSection, projectPath, label, html),

    deleteReusableSection: (
      projectPath: string,
      id: string,
    ): Promise<OperationResult> =>
      call(IPC.deleteReusableSection, projectPath, id),

    readDraft: (
      projectPath: string,
      scope: DraftScope,
      target: string,
    ): Promise<DraftResult> => call(IPC.draftRead, projectPath, scope, target),

    listDrafts: (): Promise<DraftSummaryResult> => call(IPC.draftList),

    writeDraft: (
      projectPath: string,
      scope: DraftScope,
      target: string,
      content: string,
    ): Promise<OperationResult> =>
      call(IPC.draftWrite, projectPath, scope, target, content),

    clearDraft: (
      projectPath: string,
      scope: DraftScope,
      target: string,
    ): Promise<OperationResult> =>
      call(IPC.draftClear, projectPath, scope, target),

    watchFile: (projectPath: string, rel: string): Promise<OperationResult> =>
      call(IPC.watchStart, projectPath, rel),

    stopWatch: (): Promise<OperationResult> => call(IPC.watchStop),

    onExternalChange: on(IPC.externalChange),

    listPages: (projectPath: string, pagesDir: string): Promise<string[]> =>
      call(IPC.pagesList, projectPath, pagesDir),

    startPreview: (projectPath: string): Promise<DevServerStartResult> =>
      call(IPC.previewStart, projectPath),

    stopPreview: (): Promise<OperationResult> => call(IPC.previewStop),

    openPreviewWindow: (url: string): Promise<OperationResult> =>
      call(IPC.previewWindowOpen, url),

    closePreviewWindow: (): Promise<OperationResult> =>
      call(IPC.previewWindowClose),

    onPreviewClosed: on(IPC.previewClosed),

    onPreviewExited: on(IPC.previewExited),

    onReloadRequested: on(IPC.reloadRequested),

    ensureThemePreviewServer: (): Promise<ThemePreviewServerResult> =>
      call(IPC.themePreviewEnsure),

    publish: (
      projectPath: string,
      outDir: string,
    ): Promise<{
      ok: boolean;
      outputDir?: string;
      revealed?: boolean;
      error?: string;
    }> => call(IPC.publish, projectPath, outDir),
    onPublishLog: on(IPC.publishLog),

    revealOutputFolder: (
      projectPath: string,
      outDir: string,
    ): Promise<OperationResult> =>
      call(IPC.revealOutputFolder, projectPath, outDir),

    dependenciesInstalled: (projectPath: string): Promise<boolean> =>
      call(IPC.depsInstalled, projectPath),

    installDependencies: (
      projectPath: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      call(IPC.depsInstall, projectPath),
    cancelInstall: (): Promise<{ ok: boolean; error?: string }> =>
      call(IPC.depsCancel),

    onInstallLog: on(IPC.depsLog),

    onPreviewLog: on(IPC.previewLog),

    checkForUpdates: (): Promise<unknown> => call(IPC.updaterCheck),
    downloadUpdate: (): Promise<unknown> => call(IPC.updaterDownload),
    cancelUpdateDownload: (): Promise<unknown> => call(IPC.updaterCancel),
    installUpdate: (): Promise<unknown> => call(IPC.updaterInstall),
    getLastUpdaterStatus: (): Promise<unknown> => call(IPC.updaterStatusGet),
    getAppVersion: (): Promise<string> => call(IPC.getAppVersion),
    openConfigFolder: (): Promise<{ ok: boolean; error?: string }> =>
      call(IPC.openConfigFolder),

    getNodeStatus: (): Promise<unknown> => call(IPC.nodeStatus),
    pickNodePath: (): Promise<unknown> => call(IPC.nodePickPath),
    setNodePath: (customPath: string | null): Promise<unknown> =>
      call(IPC.nodeSetPath, customPath),

    smokeExternalWrite: (
      projectPath: string,
      relativePath: string,
      contents: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      call(IPC.smokeExternalWrite, projectPath, relativePath, contents),

    onUpdaterStatus: on(IPC.updaterStatus),
  } as const;
}

export type ZephusApi = ReturnType<typeof createZephusApi>;
