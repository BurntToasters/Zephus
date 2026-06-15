// Shared type definitions for the Zephus main process and the preload bridge.

export interface AstroInfo {
  isAstro: boolean;
  version: string | null;
  srcDir: string;
  pagesDir: string;
  publicDir: string;
  outDir: string;
  configFile: string | null;
  configReadError: boolean;
}

export interface PackageValidation {
  exists: boolean;
  parseable: boolean;
  hasAstroDependency: boolean;
  hasDevScript: boolean;
  hasBuildScript: boolean;
  /** True when the project is ready to edit/preview in Zephus. */
  ready: boolean;
}

export interface ProjectOpenResult {
  ok: boolean;
  path: string;
  name: string;
  isGitRepo: boolean;
  isZephusProject: boolean;
  pkg: PackageValidation;
  astro: AstroInfo;
  /** Editable page paths relative to the project root. */
  pages: string[];
  error?: string;
}

export interface GitStatus {
  available: boolean;
  branch: string | null;
  detachedHead: boolean;
  modified: string[];
  added: string[];
  deleted: string[];
  error?: string;
}

export interface GlobalSettings {
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

export interface RepoSettings {
  schemaVersion: number;
  editorRules: Record<string, unknown>;
}

export interface DevServerStartResult {
  ok: boolean;
  url: string | null;
  alreadyRunning: boolean;
  error?: string;
}

export interface OperationResult {
  ok: boolean;
  error?: string;
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  recentProjects: [],
  theme: "system",
  lastOpenedProject: null,
  autoCheckUpdates: true,
  updateChannel: "auto",
  restoreLastProject: false,
  confirmBlockDelete: true,
  autosave: false,
  codeFontSize: 13,
};

export const DEFAULT_REPO_SETTINGS: RepoSettings = {
  schemaVersion: 1,
  editorRules: {},
};

export const MAX_RECENT_PROJECTS = 10;
