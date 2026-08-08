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
import {
  getGitStatus,
  initGitRepo,
  commitAllChanges,
  commitProjectPaths,
  pushCurrentBranch,
  pullCurrentBranch,
  type GetGitStatusOptions,
} from "./services/git";
import { createPage, createSite } from "./services/wizard";
import { listThemes } from "./themes";
import { readProjectFile } from "./services/files";
import { licensesFilePath, readProductionLicenses } from "./services/licenses";
import { startDevServer, stopDevServer } from "./services/devServer";
import { resolveProjectRelativeDir } from "./services/projectPaths";
import {
  ensureThemePreviewServer,
  stopThemePreviewServer,
} from "./services/themePreviewServer";
import { buildAndReveal } from "./services/publish";
import { installDependencies, dependenciesInstalled } from "./services/install";
import {
  importAssets,
  importAssetsFromPaths,
  deleteAsset,
  renameAsset,
  listProjectAssets,
  readAssetDataUrl,
} from "./services/assets";
import { findAssetUsage, repointAssetReferences } from "./services/assetUsage";
import { searchPages, replaceAllInPages } from "./services/findReplace";
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
  getLastUpdaterStatus,
} from "./updater";
import { watchFile, stopWatching } from "./services/watch";
import { checkNodeVersion, validateNodePath } from "./services/nodeCheck";
import { onDevServerExit } from "./services/devServer";
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

  ipcMain.handle(
    IPC.gitStatus,
    (_e, projectPath: string, options?: GetGitStatusOptions) =>
      approved(projectPath, () => getGitStatus(projectPath, options)),
  );

  ipcMain.handle(
    IPC.gitCommit,
    async (
      _e,
      projectPath: string,
      message: string,
      paths?: string[],
    ): Promise<OperationResult> => {
      try {
        assertApprovedProject(projectPath);
        const result =
          paths && paths.length > 0
            ? await commitProjectPaths(projectPath, message, paths)
            : await commitAllChanges(projectPath, message);
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(
    IPC.gitPush,
    async (_e, projectPath: string): Promise<OperationResult> => {
      try {
        assertApprovedProject(projectPath);
        const result = await pushCurrentBranch(projectPath);
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(
    IPC.gitPull,
    async (_e, projectPath: string): Promise<OperationResult> => {
      try {
        assertApprovedProject(projectPath);
        const result = await pullCurrentBranch(projectPath);
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
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
    // Validate selection. Renderer persists it only when user clicks Settings
    // Save; Cancel must not mutate global settings.
    const status = await checkNodeVersion(validation.path);
    if (status.status === "missing" || status.status === "unknown") {
      // The chosen file isn't a working Node binary; report without saving.
      return {
        ...status,
        message: `The selected file is not a working Node.js executable.\n\n${selected}`,
      };
    }

    return status;
  });

  ipcMain.handle(
    IPC.nodeSetPath,
    async (_e, customPath: string | null): Promise<unknown> => {
      // Probe requested path. Renderer persists it only on Settings Save;
      // choosing Auto-detect then Cancel must not change settings.json.
      if (
        customPath === null ||
        (typeof customPath === "string" && customPath.trim().length === 0)
      ) {
        return checkNodeVersion(null);
      }
      // Validate the path shape *before* persisting or probing it, so a
      // compromised renderer cannot point the app at an arbitrary executable.
      const validation = validateNodePath(customPath);
      if (!validation.ok || !validation.path) {
        return checkNodeVersion(readGlobalSettings().customNodePath);
      }
      return checkNodeVersion(validation.path);
    },
  );

  ipcMain.handle(IPC.settingsMerged, (_e, projectPath: string) =>
    approved(projectPath, () => getMergedSettings(projectPath)),
  );

  ipcMain.handle(IPC.licensesRead, () => readProductionLicenses());

  ipcMain.handle(IPC.licensesOpenFile, async (): Promise<OperationResult> => {
    const source = licensesFilePath();
    let file = source;
    try {
      if (app.isPackaged) {
        // shell.openPath cannot open paths inside app.asar; export a copy to
        // userData first so the user can actually read the file.
        const target = path.join(app.getPath("userData"), "licenses.json");
        fs.copyFileSync(source, target);
        file = target;
      }
      const result = await shell.openPath(file);
      return result ? { ok: false, error: result } : { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle(IPC.fileRead, (_e, projectPath: string, rel: string) =>
    approved(projectPath, () => readProjectFile(projectPath, rel)),
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

  ipcMain.handle(
    IPC.searchPages,
    (
      _e,
      projectPath: string,
      pagesDir: string,
      query: string,
      options: { caseSensitive?: boolean; wholeWord?: boolean },
    ) =>
      approved(projectPath, () =>
        searchPages(projectPath, pagesDir, query, options ?? {}),
      ),
  );

  ipcMain.handle(
    IPC.replaceAll,
    (
      _e,
      projectPath: string,
      pagesDir: string,
      query: string,
      replacement: string,
      options: { caseSensitive?: boolean; wholeWord?: boolean },
      onlyPages?: string[],
    ) =>
      approved(projectPath, () =>
        replaceAllInPages(
          projectPath,
          pagesDir,
          query,
          replacement,
          options ?? {},
          onlyPages,
        ),
      ),
  );

  ipcMain.handle(
    IPC.assetDelete,
    (_e, projectPath: string, publicDir: string, webPath: string) =>
      approved(projectPath, () => deleteAsset(projectPath, publicDir, webPath)),
  );

  ipcMain.handle(
    IPC.assetRename,
    (
      _e,
      projectPath: string,
      publicDir: string,
      pagesDir: string,
      webPath: string,
      nextName: string,
    ) =>
      approved(projectPath, () => {
        const renamed = renameAsset(projectPath, publicDir, webPath, nextName);
        if (!renamed.ok || !renamed.webPath) return renamed;
        // Repoint in the same call: a rename that left references behind would
        // silently break every page using the old file name.
        const repointed = repointAssetReferences(
          projectPath,
          pagesDir,
          webPath,
          renamed.webPath,
        );
        if (!repointed.ok) {
          return {
            ok: false,
            webPath: renamed.webPath,
            error: `Asset was renamed to ${renamed.webPath}, but references could not be updated: ${repointed.error ?? "unknown error"}`,
          };
        }
        return {
          ...renamed,
          updatedReferences: repointed.updated,
        };
      }),
  );

  ipcMain.handle(
    IPC.assetUsage,
    (_e, projectPath: string, pagesDir: string, webPath: string) =>
      approved(projectPath, () =>
        findAssetUsage(projectPath, pagesDir, webPath),
      ),
  );

  ipcMain.handle(IPC.listReusableSections, (_e, projectPath: string) =>
    approved(projectPath, () => listReusableSections(projectPath)),
  );

  ipcMain.handle(
    IPC.saveReusableSection,
    (_e, projectPath: string, label: string, html: string) =>
      approved(projectPath, () =>
        saveReusableSection(projectPath, label, html),
      ),
  );

  ipcMain.handle(
    IPC.deleteReusableSection,
    (_e, projectPath: string, id: string) =>
      approved(projectPath, () => deleteReusableSection(projectPath, id)),
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
      const started = watchFile(projectPath, rel, (changed) => {
        if (!event.sender.isDestroyed())
          event.sender.send(IPC.externalChange, changed);
      });
      // A failed start means NO file is being watched (single global
      // watcher) — the renderer must be told, or it believes external
      // change detection is active when it is not.
      if (!started) {
        return {
          ok: false,
          error:
            "Could not watch the page for external edits (path invalid or unreadable).",
        };
      }
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

  // When the running dev server dies on its own (crash, port conflict, killed
  // outside Zephus), tell the renderer so it can reset the preview UI instead
  // of showing a dead preview window forever.
  onDevServerExit(() => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.previewExited);
    }
  });

  ipcMain.handle(IPC.themePreviewEnsure, (event) => {
    // Long-lived HTTP server: only the main editor window may start it.
    if (
      !options?.assertUpdaterSender ||
      !options.assertUpdaterSender(event.sender.id)
    ) {
      return {
        ok: false,
        baseUrl: null,
        error: "Unauthorized sender.",
      };
    }
    return ensureThemePreviewServer();
  });

  ipcMain.handle(IPC.publish, (_e, projectPath: string, outDir: string) =>
    approved(projectPath, () => buildAndReveal(projectPath, outDir)),
  );

  ipcMain.handle(
    IPC.revealOutputFolder,
    async (
      _e,
      projectPath: string,
      outDir: string,
    ): Promise<OperationResult> => {
      try {
        assertApprovedProject(projectPath);
        const output = resolveProjectRelativeDir(
          projectPath,
          outDir,
          "dist",
        ).absolute;
        const error = await shell.openPath(output);
        return error ? { ok: false, error } : { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
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

  ipcMain.handle(IPC.updaterStatusGet, (event) => {
    if (!assertUpdaterSender(event.sender.id)) {
      return { status: "error", error: "Unauthorized sender." };
    }
    // The startup check can resolve before the renderer's listener attaches;
    // this lets the renderer claim the cached status instead of showing a
    // false "Up to date".
    return getLastUpdaterStatus();
  });
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
  ipcMain.handle(IPC.openConfigFolder, async () => {
    const error = await shell.openPath(app.getPath("userData"));
    return error ? { ok: false, error } : { ok: true };
  });

  app.on("before-quit", () => {
    stopThemePreviewServer();
  });
}
