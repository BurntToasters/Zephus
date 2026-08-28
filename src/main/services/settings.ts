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
import { readJsonSafe, writeFileAtomic } from "./fsSafe";

/** Resolves the OS-specific user config directory for Zephus. */
function globalSettingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function readGlobalSettings(): GlobalSettings {
  const file = globalSettingsPath();
  if (!fs.existsSync(file)) {
    try {
      writeGlobalSettings(DEFAULT_GLOBAL_SETTINGS);
    } catch (error) {
      // A read must never throw (callers like getMergedSettings assume reads
      // cannot fail). A read-only config directory just means defaults for
      // this session; the write surfaces as a save error if the user changes
      // a setting.
      log.error("Could not create default settings.json", error);
    }
    return { ...DEFAULT_GLOBAL_SETTINGS };
  }
  // Corrupt settings are backed up (not overwritten) by readJsonSafe; we fall
  // back to in-memory defaults for the session without clobbering the backup.
  const { data, corrupt } = readJsonSafe<Partial<GlobalSettings>>(file);
  if (corrupt || !data) {
    if (corrupt) {
      log.error(
        "Using default settings this session; settings.json backed up.",
      );
    }
    return { ...DEFAULT_GLOBAL_SETTINGS };
  }
  const theme =
    data.theme && ["light", "dark", "system"].includes(data.theme)
      ? data.theme
      : DEFAULT_GLOBAL_SETTINGS.theme;
  return {
    ...DEFAULT_GLOBAL_SETTINGS,
    ...data,
    // A hand-edited settings.json must not be able to point the app at an
    // unknown theme (data-theme matches no CSS rule and theming silently
    // breaks).
    theme,
    recentProjects: Array.isArray(data.recentProjects)
      ? // Hand-edited settings.json must not crash the project list: entries
        // that are not strings (e.g. `123`) would throw in path.resolve.
        data.recentProjects.filter(
          (entry): entry is string => typeof entry === "string" && entry !== "",
        )
      : [],
    lastOpenedProject:
      typeof data.lastOpenedProject === "string"
        ? data.lastOpenedProject
        : null,
  };
}

export function writeGlobalSettings(settings: GlobalSettings): void {
  writeFileAtomic(
    globalSettingsPath(),
    JSON.stringify(settings, null, 2) + "\n",
  );
}

/** Canonical form for deduping: resolved absolute path, case-folded on win32. */
function canonicalProjectPath(projectPath: string): string {
  const resolved = path.resolve(projectPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Records a project path at the top of the recent-projects list (deduped, capped). */
export function recordRecentProject(projectPath: string): GlobalSettings {
  const settings = readGlobalSettings();
  const canonical = canonicalProjectPath(projectPath);
  const deduped = settings.recentProjects.filter(
    (p) => canonicalProjectPath(p) !== canonical,
  );
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
  const canonical = canonicalProjectPath(projectPath);
  settings.recentProjects = settings.recentProjects.filter(
    (p) => canonicalProjectPath(p) !== canonical,
  );
  if (canonicalProjectPath(settings.lastOpenedProject ?? "") === canonical) {
    settings.lastOpenedProject = null;
  }
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
  const { data } = readJsonSafe<Partial<RepoSettings>>(file);
  if (!data) return { ...DEFAULT_REPO_SETTINGS };
  return { ...DEFAULT_REPO_SETTINGS, ...data };
}

/** Merges global + repo settings with repo-over-global precedence (R6.7). */
export function getMergedSettings(projectPath: string): {
  global: GlobalSettings;
  repo: RepoSettings;
  theme: GlobalSettings["theme"];
} {
  const global = readGlobalSettings();
  const repo = readRepoSettings(projectPath);
  // Theme is a cross-cutting setting: repo can override the global theme.
  const repoTheme = (repo as unknown as Record<string, unknown>)["theme"] as
    GlobalSettings["theme"] | undefined;
  const theme: GlobalSettings["theme"] =
    repoTheme && ["light", "dark", "system"].includes(repoTheme)
      ? repoTheme
      : global.theme;
  return { global, repo, theme };
}
