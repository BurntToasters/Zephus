import { BrowserWindow, dialog, ipcMain, app, shell } from "electron";
import * as fs from "fs";
import * as path from "path";
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
import { installDependencies, dependenciesInstalled } from "./services/install";
import {
  importImage,
  importAssets,
  importAssetsFromPaths,
  listProjectAssets,
  readAssetDataUrl,
} from "./services/assets";
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
  listDraftSummaries,
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
import { checkNodeVersion, validateNodePath } from "./services/nodeCheck";
import { IPC } from "./ipcChannels";

export { IPC };

interface IpcRegistrationOptions {
  assertUpdaterSender?: (senderId?: number) => boolean;
  markUpdateInstalling?: () => void;
  clearUpdateInstalling?: () => void;
}

const approvedProjectRoots = new Set<string>();

function canonicalProjectRoot(projectPath: string): string {
  if (typeof projectPath !== "string" || !projectPath) {
    throw new Error("Invalid project path.");
  }
  const resolved = path.resolve(projectPath);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function approveProjectRoot(projectPath: string): string {
  const root = canonicalProjectRoot(projectPath);
  approvedProjectRoots.add(root);
  return root;
}

function assertApprovedProject(projectPath: string): void {
  const root = canonicalProjectRoot(projectPath);
  if (!approvedProjectRoots.has(root)) {
    throw new Error("Unauthorized project path.");
  }
}

function approved<T>(projectPath: string, fn: () => T): T {
  assertApprovedProject(projectPath);
  return fn();
}

export function registerIpcHandlers(
  getWindow: () => BrowserWindow | null,
  options?: IpcRegistrationOptions,
): void {
  const assertUpdaterSender = (senderId?: number): boolean => {
    // Fail closed: if no asserter was provided, deny updater IPC rather than
    // allowing any sender.
    if (!options?.assertUpdaterSender) return false;
    return options.assertUpdaterSender(senderId);
  };

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
    if (result.ok && result.isZephusProject) {
      approveProjectRoot(projectPath);
      recordRecentProject(projectPath);
    }
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
      approveProjectRoot(targetPath);
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
      approved(projectPath, () => createPage(projectPath, pageName, pagesDir)),
  );

  ipcMain.handle(
    IPC.renamePage,
    (
      _e,
      projectPath: string,
      page: string,
      pagesDir: string,
      nextSlug: string,
    ) =>
      approved(projectPath, () =>
        renamePage(projectPath, page, pagesDir, nextSlug),
      ),
  );

  ipcMain.handle(
    IPC.duplicatePage,
    (
      _e,
      projectPath: string,
      page: string,
      pagesDir: string,
      slugInput?: string,
    ) =>
      approved(projectPath, () =>
        duplicatePage(projectPath, page, pagesDir, slugInput),
      ),
  );

  ipcMain.handle(
    IPC.deletePage,
    (_e, projectPath: string, page: string, pagesDir: string) =>
      approved(projectPath, () => deletePage(projectPath, page, pagesDir)),
  );

  ipcMain.handle(
    IPC.listPageMeta,
    (_e, projectPath: string, pagesDir: string) =>
      approved(projectPath, () => listPageMetadata(projectPath, pagesDir)),
  );

  ipcMain.handle(
    IPC.readPageMeta,
    (_e, projectPath: string, page: string, pagesDir: string): PageMeta =>
      approved(projectPath, () =>
        readPageMetadata(projectPath, page, pagesDir),
      ),
  );

  ipcMain.handle(
    IPC.writePageMeta,
    (
      _e,
      projectPath: string,
      page: string,
      pagesDir: string,
      partial: Partial<PageMeta>,
    ) =>
      approved(projectPath, () =>
        writePageMetadata(projectPath, page, pagesDir, partial),
      ),
  );

  ipcMain.handle(
    IPC.schemaEnsure,
    (_e, projectPath: string, pagesDir: string) =>
      approved(projectPath, () => ensureVisualSchema(projectPath, pagesDir)),
  );

  ipcMain.handle(IPC.siteDocumentRead, (_e, projectPath: string) =>
    approved(projectPath, () => readSiteDocument(projectPath)),
  );

  ipcMain.handle(
    IPC.siteDocumentWrite,
    (_e, projectPath: string, site: SiteDocument, pagesDir: string) =>
      approved(projectPath, () =>
        writeSiteDocument(projectPath, site, pagesDir),
      ),
  );

  ipcMain.handle(
    IPC.pageDocumentRead,
    (_e, projectPath: string, page: string, pagesDir: string) =>
      approved(projectPath, () =>
        readPageDocument(projectPath, page, pagesDir),
      ),
  );

  ipcMain.handle(
    IPC.pageDocumentWrite,
    (_e, projectPath: string, pagesDir: string, doc: PageDocument) =>
      approved(projectPath, () =>
        writePageDocument(projectPath, pagesDir, doc),
      ),
  );

  ipcMain.handle(
    IPC.pageDocumentDetach,
    (_e, projectPath: string, page: string, pagesDir: string, source: string) =>
      approved(projectPath, () =>
        detachPageDocument(projectPath, page, pagesDir, source),
      ),
  );

  ipcMain.handle(
    IPC.pageDocumentReattach,
    (_e, projectPath: string, page: string, pagesDir: string) =>
      approved(projectPath, () =>
        reattachPageDocument(projectPath, page, pagesDir),
      ),
  );

  ipcMain.handle(IPC.gitStatus, (_e, projectPath: string) =>
    approved(projectPath, () => getGitStatus(projectPath)),
  );

  ipcMain.handle(
    IPC.gitInit,
    async (_e, projectPath: string): Promise<OperationResult> => {
      try {
        assertApprovedProject(projectPath);
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
        // A compromised renderer must not be able to persist an arbitrary
        // customNodePath that is later spawned. Validate it; reject if bad.
        if (
          settings &&
          settings.customNodePath !== null &&
          settings.customNodePath !== undefined
        ) {
          const validation = validateNodePath(settings.customNodePath);
          if (!validation.ok) {
            return { ok: false, error: validation.error };
          }
          settings.customNodePath = validation.path ?? null;
        }
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
    approved(projectPath, () => readRepoSettings(projectPath)),
  );

  ipcMain.handle(IPC.nodeStatus, () =>
    checkNodeVersion(readGlobalSettings().customNodePath),
  );

  ipcMain.handle(IPC.nodePickPath, async () => {
    const win = getWindow();
    const isWindows = process.platform === "win32";
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: "Select the Node.js Executable",
      properties: ["openFile"],
      filters: isWindows
        ? [{ name: "Executable", extensions: ["exe"] }]
        : undefined,
    });
    if (result.canceled || result.filePaths.length === 0) {
      return checkNodeVersion(readGlobalSettings().customNodePath);
    }

    const selected = result.filePaths[0];
    if (!selected) {
      return checkNodeVersion(readGlobalSettings().customNodePath);
    }
    // Validate the path shape before probing/persisting (mirrors nodeSetPath).
    const validation = validateNodePath(selected);
    if (!validation.ok || !validation.path) {
      const current = await checkNodeVersion(
        readGlobalSettings().customNodePath,
      );
      return {
        ...current,
        message: validation.error ?? "The selected file is not valid.",
      };
    }
    // Validate the selection before persisting it.
    const status = await checkNodeVersion(validation.path);
    if (status.status === "missing" || status.status === "unknown") {
      // The chosen file isn't a working Node binary; report without saving.
      return {
        ...status,
        message: `The selected file is not a working Node.js executable.\n\n${selected}`,
      };
    }

    const settings = readGlobalSettings();
    settings.customNodePath = validation.path;
    writeGlobalSettings(settings);
    return status;
  });

  ipcMain.handle(
    IPC.nodeSetPath,
    async (_e, customPath: string | null): Promise<unknown> => {
      // Clearing the custom path is always allowed.
      if (
        customPath === null ||
        (typeof customPath === "string" && customPath.trim().length === 0)
      ) {
        const settings = readGlobalSettings();
        settings.customNodePath = null;
        writeGlobalSettings(settings);
        return checkNodeVersion(null);
      }
      // Validate the path shape *before* persisting or probing it, so a
      // compromised renderer cannot point the app at an arbitrary executable.
      const validation = validateNodePath(customPath);
      if (!validation.ok || !validation.path) {
        return checkNodeVersion(readGlobalSettings().customNodePath);
      }
      const settings = readGlobalSettings();
      settings.customNodePath = validation.path;
      writeGlobalSettings(settings);
      return checkNodeVersion(validation.path);
    },
  );

  ipcMain.handle(IPC.settingsMerged, (_e, projectPath: string) =>
    approved(projectPath, () => getMergedSettings(projectPath)),
  );

  ipcMain.handle(IPC.licensesRead, () => readProductionLicenses());

  ipcMain.handle(IPC.licensesOpenFile, async (): Promise<OperationResult> => {
    const file = licensesFilePath();
    const result = await shell.openPath(file);
    return result ? { ok: false, error: result } : { ok: true };
  });

  ipcMain.handle(IPC.fileRead, (_e, projectPath: string, rel: string) =>
    approved(projectPath, () => readProjectFile(projectPath, rel)),
  );

  ipcMain.handle(
    IPC.fileWrite,
    (_e, projectPath: string, rel: string, content: string) =>
      approved(projectPath, () => writeProjectFile(projectPath, rel, content)),
  );

  ipcMain.handle(
    IPC.importImage,
    (_e, projectPath: string, publicDir: string) =>
      approved(projectPath, () =>
        importImage(getWindow(), projectPath, publicDir),
      ),
  );

  ipcMain.handle(
    IPC.importAssets,
    (_e, projectPath: string, publicDir: string) =>
      approved(projectPath, () =>
        importAssets(getWindow(), projectPath, publicDir),
      ),
  );

  ipcMain.handle(
    IPC.importAssetPaths,
    (_e, projectPath: string, publicDir: string, paths: string[]) =>
      approved(projectPath, () =>
        importAssetsFromPaths(projectPath, publicDir, paths),
      ),
  );

  ipcMain.handle(IPC.listAssets, (_e, projectPath: string, publicDir: string) =>
    approved(projectPath, () => listProjectAssets(projectPath, publicDir)),
  );

  ipcMain.handle(
    IPC.assetDataUrl,
    (_e, projectPath: string, publicDir: string, webPath: string) =>
      approved(projectPath, () =>
        readAssetDataUrl(projectPath, publicDir, webPath),
      ),
  );

  ipcMain.handle(IPC.listReusableSections, () => listReusableSections());

  ipcMain.handle(IPC.saveReusableSection, (_e, label: string, html: string) =>
    saveReusableSection(label, html),
  );

  ipcMain.handle(IPC.deleteReusableSection, (_e, id: string) =>
    deleteReusableSection(id),
  );

  ipcMain.handle(
    IPC.draftRead,
    (_e, projectPath: string, scope: "page" | "site", target: string) =>
      approved(projectPath, () => readDraft(projectPath, scope, target)),
  );

  ipcMain.handle(IPC.draftList, () => listDraftSummaries());

  ipcMain.handle(
    IPC.draftWrite,
    (
      _e,
      projectPath: string,
      scope: "page" | "site",
      target: string,
      content: string,
    ) =>
      approved(projectPath, () =>
        writeDraft(projectPath, scope, target, content),
      ),
  );

  ipcMain.handle(
    IPC.draftClear,
    (_e, projectPath: string, scope: "page" | "site", target: string) =>
      approved(projectPath, () => clearDraft(projectPath, scope, target)),
  );

  ipcMain.handle(
    IPC.watchStart,
    (event, projectPath: string, rel: string): OperationResult => {
      assertApprovedProject(projectPath);
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
    approved(projectPath, () => listPages(projectPath, pagesDir)),
  );

  ipcMain.handle(IPC.previewStart, async (event, projectPath: string) => {
    assertApprovedProject(projectPath);
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
    approved(projectPath, () => buildAndReveal(projectPath, outDir)),
  );

  ipcMain.handle(IPC.depsInstalled, (_e, projectPath: string): boolean =>
    approved(projectPath, () => dependenciesInstalled(projectPath)),
  );

  ipcMain.handle(IPC.depsInstall, (event, projectPath: string) =>
    approved(projectPath, () =>
      installDependencies(projectPath, (chunk) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC.depsLog, chunk);
      }),
    ),
  );

  ipcMain.handle(IPC.updaterCheck, (event) => {
    if (!assertUpdaterSender(event.sender.id)) {
      return { status: "error", error: "Unauthorized sender." };
    }
    return checkForUpdates(readGlobalSettings);
  });
  ipcMain.handle(IPC.updaterDownload, (event) => {
    if (!assertUpdaterSender(event.sender.id)) {
      return { status: "error", error: "Unauthorized sender." };
    }
    return downloadUpdate(readGlobalSettings);
  });
  ipcMain.handle(IPC.updaterCancel, (event) => {
    if (!assertUpdaterSender(event.sender.id)) {
      return { ok: false, error: "Unauthorized sender." };
    }
    cancelDownload(getWindow);
    return { ok: true };
  });
  ipcMain.handle(IPC.updaterInstall, (event) => {
    if (!assertUpdaterSender(event.sender.id)) {
      return { ok: false, error: "Unauthorized sender." };
    }
    options?.markUpdateInstalling?.();
    try {
      installUpdate(readGlobalSettings);
      return { ok: true };
    } catch (error) {
      options?.clearUpdateInstalling?.();
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
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
