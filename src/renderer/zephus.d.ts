// Renderer-side typing for the preload bridge exposed on window.zephus.
// Kept independent of the main-process source (separate tsconfig rootDir).

interface PackageValidation {
  exists: boolean;
  parseable: boolean;
  hasAstroDependency: boolean;
  hasDevScript: boolean;
  hasBuildScript: boolean;
  ready: boolean;
}

interface AstroInfo {
  isAstro: boolean;
  version: string | null;
  srcDir: string;
  pagesDir: string;
  publicDir: string;
  outDir: string;
  configFile: string | null;
  configReadError: boolean;
}

interface ProjectOpenResult {
  ok: boolean;
  path: string;
  name: string;
  isGitRepo: boolean;
  isZephusProject: boolean;
  pkg: PackageValidation;
  astro: AstroInfo;
  pages: string[];
  error?: string;
}

interface GitStatus {
  available: boolean;
  branch: string | null;
  detachedHead: boolean;
  modified: string[];
  added: string[];
  deleted: string[];
  error?: string;
}

interface GlobalSettings {
  recentProjects: string[];
  theme: "light" | "dark" | "system";
  lastOpenedProject: string | null;
  autoCheckUpdates: boolean;
  updateChannel: "stable" | "beta" | "auto";
  restoreLastProject: boolean;
  confirmBlockDelete: boolean;
  autosave: boolean;
  codeFontSize: number;
}

interface OperationResult {
  ok: boolean;
  error?: string;
}

interface ThemeMeta {
  id: string;
  name: string;
  description: string;
}

interface DevServerStartResult {
  ok: boolean;
  url: string | null;
  alreadyRunning: boolean;
  error?: string;
}

interface ZephusApi {
  openFolderDialog(): Promise<string | null>;
  chooseNewSiteFolder(): Promise<string | null>;
  openProject(projectPath: string): Promise<ProjectOpenResult>;
  listThemes(): Promise<ThemeMeta[]>;
  createSite(targetPath: string, themeId: string): Promise<OperationResult>;
  createPage(
    projectPath: string,
    pageName: string,
    pagesDir: string,
  ): Promise<OperationResult>;
  getGitStatus(projectPath: string): Promise<GitStatus>;
  initGitRepo(projectPath: string): Promise<OperationResult>;
  readGlobalSettings(): Promise<GlobalSettings>;
  writeGlobalSettings(settings: GlobalSettings): Promise<OperationResult>;
  removeRecentProject(projectPath: string): Promise<GlobalSettings>;
  readRepoSettings(projectPath: string): Promise<unknown>;
  getMergedSettings(projectPath: string): Promise<{
    global: GlobalSettings;
    repo: { schemaVersion: number; editorRules: Record<string, unknown> };
    theme: "light" | "dark" | "system";
  }>;
  readFile(
    projectPath: string,
    rel: string,
  ): Promise<{ ok: boolean; content?: string; error?: string }>;
  writeFile(
    projectPath: string,
    rel: string,
    content: string,
  ): Promise<OperationResult>;
  importImage(
    projectPath: string,
    publicDir: string,
  ): Promise<{
    ok: boolean;
    webPath?: string;
    canceled?: boolean;
    error?: string;
  }>;
  watchFile(projectPath: string, rel: string): Promise<OperationResult>;
  stopWatch(): Promise<OperationResult>;
  onExternalChange(callback: (rel: string) => void): () => void;
  listPages(projectPath: string, pagesDir: string): Promise<string[]>;
  startPreview(projectPath: string): Promise<DevServerStartResult>;
  stopPreview(): Promise<OperationResult>;
  publish(
    projectPath: string,
    outDir: string,
  ): Promise<{ ok: boolean; outputDir?: string; error?: string }>;
  onPreviewLog(callback: (chunk: string) => void): () => void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  cancelUpdateDownload(): Promise<unknown>;
  installUpdate(): Promise<unknown>;
  getAppVersion(): Promise<string>;
  openConfigFolder(): Promise<unknown>;
  onUpdaterStatus(
    callback: (data: {
      status: string;
      version?: string;
      percent?: number;
      error?: string;
    }) => void,
  ): () => void;
}

interface Window {
  zephus: ZephusApi;
}
