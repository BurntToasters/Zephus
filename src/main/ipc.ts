import { BrowserWindow, dialog, ipcMain, app, shell } from "electron";
import {
  GlobalSettings,
  OperationResult,
  PageDocument,
  PageMeta,
  SiteDocument,
} from "./types";
import { openProject, listPages } from "./services/project";
import {
  readGlobalSettings,
  readRepoSettings,
  getMergedSettings,
  recordRecentProject,
  removeRecentProject,
  writeGlobalSettings,
} from "./services/settings";
import { getGitStatus, initGitRepo } from "./services/git";
import { createPage, createSite } from "./services/wizard";
import { listThemes } from "./themes";
import { readProjectFile, writeProjectFile } from "./services/files";
import { licensesFilePath, readProductionLicenses } from "./services/licenses";
import { startDevServer, stopDevServer } from "./services/devServer";
import {
  ensureThemePreviewServer,
  stopThemePreviewServer,
} from "./services/themePreviewServer";
import { buildAndReveal } from "./services/publish";
import { importImage, listProjectImages } from "./services/assets";
import {
  deletePage,
  duplicatePage,
  listPageMetadata,
  readPageMetadata,
  renamePage,
  writePageMetadata,
} from "./services/pageManager";
import {
  deleteReusableSection,
  listReusableSections,
  saveReusableSection,
} from "./services/reusableSections";
import {
  clearDraft,
  readDraft,
  writeDraft,
} from "./services/drafts";
import {
  detachPageDocument,
  ensureVisualSchema,
  readPageDocument,
  readSiteDocument,
  reattachPageDocument,
  writePageDocument,
  writeSiteDocument,
} from "./services/schema";
import {
  checkForUpdates,
  downloadUpdate,
  cancelDownload,
  installUpdate,
} from "./updater";
import { watchFile, stopWatching } from "./services/watch";
import { IPC } from "./ipcChannels";

export { IPC };

export function registerIpcHandlers(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle(IPC.openFolder, async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: "Open Zephus Site",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.chooseNewSiteFolder, async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: "Choose a Folder for the New Site",
      properties: ["openDirectory", "createDirectory", "promptToCreate"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.projectOpen, (_e, projectPath: string) => {
    const result = openProject(projectPath);
    // Strict open policy: only record Zephus projects in recents.
    if (result.ok && result.isZephusProject) recordRecentProject(projectPath);
    return result;
  });

  ipcMain.handle(IPC.listThemes, () => listThemes());

  ipcMain.handle(
    IPC.createSite,
    async (
      _e,
      targetPath: string,
      themeId: string,
    ): Promise<OperationResult> => {
      const created = createSite(targetPath, themeId);
      if (!created.ok) return created;
      try {
        await initGitRepo(targetPath);
      } catch {
        // Git is best-effort here; the renderer will offer git init on open if missing.
      }
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.createPage,
    (_e, projectPath: string, pageName: string, pagesDir: string) =>
      createPage(projectPath, pageName, pagesDir),
  );

  ipcMain.handle(
    IPC.renamePage,
    (_e, projectPath: string, page: string, pagesDir: string, nextSlug: string) =>
      renamePage(projectPath, page, pagesDir, nextSlug),
  );

  ipcMain.handle(
    IPC.duplicatePage,
    (
      _e,
      projectPath: string,
      page: string,
      pagesDir: string,
      slugInput?: string,
    ) => duplicatePage(projectPath, page, pagesDir, slugInput),
  );

  ipcMain.handle(IPC.deletePage, (_e, projectPath: string, page: string) =>
    deletePage(projectPath, page),
  );

  ipcMain.handle(IPC.listPageMeta, (_e, projectPath: string, pagesDir: string) =>
    listPageMetadata(projectPath, pagesDir),
  );

  ipcMain.handle(
    IPC.readPageMeta,
    (_e, projectPath: string, page: string, pagesDir: string): PageMeta =>
      readPageMetadata(projectPath, page, pagesDir),
  );

  ipcMain.handle(
    IPC.writePageMeta,
    (
      _e,
      projectPath: string,
      page: string,
      pagesDir: string,
      partial: Partial<PageMeta>,
    ) => writePageMetadata(projectPath, page, pagesDir, partial),
  );

  ipcMain.handle(IPC.schemaEnsure, (_e, projectPath: string, pagesDir: string) =>
    ensureVisualSchema(projectPath, pagesDir),
  );

  ipcMain.handle(IPC.siteDocumentRead, (_e, projectPath: string) =>
    readSiteDocument(projectPath),
  );

  ipcMain.handle(
    IPC.siteDocumentWrite,
    (_e, projectPath: string, site: SiteDocument, pagesDir: string) =>
      writeSiteDocument(projectPath, site, pagesDir),
  );

  ipcMain.handle(
    IPC.pageDocumentRead,
    (_e, projectPath: string, page: string, pagesDir: string) =>
      readPageDocument(projectPath, page, pagesDir),
  );

  ipcMain.handle(
    IPC.pageDocumentWrite,
    (_e, projectPath: string, pagesDir: string, doc: PageDocument) =>
      writePageDocument(projectPath, pagesDir, doc),
  );

  ipcMain.handle(
    IPC.pageDocumentDetach,
    (_e, projectPath: string, page: string, pagesDir: string, source: string) =>
      detachPageDocument(projectPath, page, pagesDir, source),
  );

  ipcMain.handle(
    IPC.pageDocumentReattach,
    (_e, projectPath: string, page: string, pagesDir: string) =>
      reattachPageDocument(projectPath, page, pagesDir),
  );

  ipcMain.handle(IPC.gitStatus, (_e, projectPath: string) =>
    getGitStatus(projectPath),
  );

  ipcMain.handle(
    IPC.gitInit,
    async (_e, projectPath: string): Promise<OperationResult> => {
      try {
        await initGitRepo(projectPath);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(IPC.settingsReadGlobal, () => readGlobalSettings());

  ipcMain.handle(
    IPC.settingsWriteGlobal,
    (_e, settings: GlobalSettings): OperationResult => {
      try {
        writeGlobalSettings(settings);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(IPC.settingsRemoveRecent, (_e, projectPath: string) =>
    removeRecentProject(projectPath),
  );

  ipcMain.handle(IPC.settingsReadRepo, (_e, projectPath: string) =>
    readRepoSettings(projectPath),
  );

  ipcMain.handle(IPC.settingsMerged, (_e, projectPath: string) =>
    getMergedSettings(projectPath),
  );

  ipcMain.handle(IPC.licensesRead, () => readProductionLicenses());

  ipcMain.handle(IPC.licensesOpenFile, async (): Promise<OperationResult> => {
    const file = licensesFilePath();
    const result = await shell.openPath(file);
    return result ? { ok: false, error: result } : { ok: true };
  });

  ipcMain.handle(IPC.fileRead, (_e, projectPath: string, rel: string) =>
    readProjectFile(projectPath, rel),
  );

  ipcMain.handle(
    IPC.fileWrite,
    (_e, projectPath: string, rel: string, content: string) =>
      writeProjectFile(projectPath, rel, content),
  );

  ipcMain.handle(
    IPC.importImage,
    (_e, projectPath: string, publicDir: string) =>
      importImage(getWindow(), projectPath, publicDir),
  );

  ipcMain.handle(IPC.listAssets, (_e, projectPath: string, publicDir: string) =>
    listProjectImages(projectPath, publicDir),
  );

  ipcMain.handle(IPC.listReusableSections, () => listReusableSections());

  ipcMain.handle(
    IPC.saveReusableSection,
    (_e, label: string, html: string) => saveReusableSection(label, html),
  );

  ipcMain.handle(IPC.deleteReusableSection, (_e, id: string) =>
    deleteReusableSection(id),
  );

  ipcMain.handle(IPC.draftRead, (_e, projectPath: string, page: string) =>
    readDraft(projectPath, page),
  );

  ipcMain.handle(
    IPC.draftWrite,
    (_e, projectPath: string, page: string, content: string) =>
      writeDraft(projectPath, page, content),
  );

  ipcMain.handle(IPC.draftClear, (_e, projectPath: string, page: string) =>
    clearDraft(projectPath, page),
  );

  ipcMain.handle(
    IPC.watchStart,
    (event, projectPath: string, rel: string): OperationResult => {
      watchFile(projectPath, rel, (changed) => {
        if (!event.sender.isDestroyed())
          event.sender.send(IPC.externalChange, changed);
      });
      return { ok: true };
    },
  );

  ipcMain.handle(IPC.watchStop, (): OperationResult => {
    stopWatching();
    return { ok: true };
  });

  ipcMain.handle(IPC.pagesList, (_e, projectPath: string, pagesDir: string) =>
    listPages(projectPath, pagesDir),
  );

  ipcMain.handle(IPC.previewStart, async (event, projectPath: string) => {
    return startDevServer(projectPath, (chunk) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.previewLog, chunk);
    });
  });

  ipcMain.handle(IPC.previewStop, () => {
    stopDevServer();
    return { ok: true };
  });

  ipcMain.handle(IPC.themePreviewEnsure, () => ensureThemePreviewServer());

  ipcMain.handle(IPC.publish, (_e, projectPath: string, outDir: string) =>
    buildAndReveal(projectPath, outDir),
  );

  ipcMain.handle(IPC.updaterCheck, () => checkForUpdates(readGlobalSettings));
  ipcMain.handle(IPC.updaterDownload, () => downloadUpdate());
  ipcMain.handle(IPC.updaterCancel, () => {
    cancelDownload(getWindow);
    return { ok: true };
  });
  ipcMain.handle(IPC.updaterInstall, () => {
    installUpdate();
    return { ok: true };
  });
  ipcMain.handle(IPC.getAppVersion, () => app.getVersion());
  ipcMain.handle(IPC.openConfigFolder, () => {
    shell.openPath(app.getPath("userData")).catch(() => {
      /* best-effort */
    });
    return { ok: true };
  });

  app.on("before-quit", () => {
    stopThemePreviewServer();
  });
}
