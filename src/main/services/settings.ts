import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import {
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_REPO_SETTINGS,
  GlobalSettings,
  MAX_RECENT_PROJECTS,
  RepoSettings,
} from "../types";

/**
 * Resolves the OS-specific user config directory for Zephus.
 * Electron's app.getPath('userData') already maps to:
 *   - Windows: %APPDATA%/Zephus
 *   - macOS:   ~/Library/Application Support/Zephus
 *   - Linux:   $XDG_CONFIG_HOME/Zephus or ~/.config/Zephus
 */
function globalSettingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function readGlobalSettings(): GlobalSettings {
  const file = globalSettingsPath();
  try {
    if (!fs.existsSync(file)) {
      writeGlobalSettings(DEFAULT_GLOBAL_SETTINGS);
      return { ...DEFAULT_GLOBAL_SETTINGS };
    }
    const parsed = JSON.parse(
      fs.readFileSync(file, "utf8"),
    ) as Partial<GlobalSettings>;
    // Merge with defaults so missing keys are filled, invalid file falls back in catch.
    return {
      ...DEFAULT_GLOBAL_SETTINGS,
      ...parsed,
      recentProjects: Array.isArray(parsed.recentProjects)
        ? parsed.recentProjects
        : [],
    };
  } catch (error) {
    log.error(
      "Failed to read global settings; using defaults for this session.",
      error,
    );
    return { ...DEFAULT_GLOBAL_SETTINGS };
  }
}

export function writeGlobalSettings(settings: GlobalSettings): void {
  const file = globalSettingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

/** Records a project path at the top of the recent-projects list (deduped, capped). */
export function recordRecentProject(projectPath: string): GlobalSettings {
  const settings = readGlobalSettings();
  const deduped = settings.recentProjects.filter((p) => p !== projectPath);
  deduped.unshift(projectPath);
  settings.recentProjects = deduped.slice(0, MAX_RECENT_PROJECTS);
  settings.lastOpenedProject = projectPath;
  try {
    writeGlobalSettings(settings);
  } catch (error) {
    log.error("Failed to persist recent project list.", error);
  }
  return settings;
}

export function removeRecentProject(projectPath: string): GlobalSettings {
  const settings = readGlobalSettings();
  settings.recentProjects = settings.recentProjects.filter(
    (p) => p !== projectPath,
  );
  try {
    writeGlobalSettings(settings);
  } catch (error) {
    log.error("Failed to update recent project list.", error);
  }
  return settings;
}

function repoSettingsPath(projectPath: string): string {
  return path.join(projectPath, ".zephus", "settings.json");
}

export function isZephusProject(projectPath: string): boolean {
  return fs.existsSync(path.join(projectPath, ".zephus"));
}

export function readRepoSettings(projectPath: string): RepoSettings {
  const file = repoSettingsPath(projectPath);
  try {
    if (!fs.existsSync(file)) return { ...DEFAULT_REPO_SETTINGS };
    const parsed = JSON.parse(
      fs.readFileSync(file, "utf8"),
    ) as Partial<RepoSettings>;
    return { ...DEFAULT_REPO_SETTINGS, ...parsed };
  } catch (error) {
    log.error(
      "Failed to read repo settings; using defaults for this session.",
      error,
    );
    return { ...DEFAULT_REPO_SETTINGS };
  }
}

/**
 * Merges global + repo settings with repo-over-global precedence (R6.7).
 * Keys present in both: repo wins. Repo-only keys added. Global-only kept.
 */
export function getMergedSettings(projectPath: string): {
  global: GlobalSettings;
  repo: RepoSettings;
  theme: GlobalSettings["theme"];
} {
  const global = readGlobalSettings();
  const repo = readRepoSettings(projectPath);
  // Theme is a cross-cutting setting: repo can override the global theme.
  const repoTheme = (repo as unknown as Record<string, unknown>)["theme"] as
    | GlobalSettings["theme"]
    | undefined;
  const theme: GlobalSettings["theme"] =
    repoTheme && ["light", "dark", "system"].includes(repoTheme)
      ? repoTheme
      : global.theme;
  return { global, repo, theme };
}
