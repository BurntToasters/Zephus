import { BrowserWindow, dialog, ipcMain, app, shell } from "electron";
import { GlobalSettings, OperationResult } from "./types";
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
import { startDevServer, stopDevServer } from "./services/devServer";
import { buildAndReveal } from "./services/publish";
import { importImage } from "./services/assets";
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
}
