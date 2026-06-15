import * as fs from "fs";
import * as path from "path";
import log from "electron-log";

type ChangeCallback = (relativePath: string) => void;

interface ActiveWatch {
  watcher: fs.FSWatcher;
  relativePath: string;
}

let active: ActiveWatch | null = null;
let debounce: NodeJS.Timeout | null = null;

/**
 * Watches a single project file for external modifications. Replaces any
 * previously watched file. Debounces rapid events. Calls onChange when the
 * file changes on disk (e.g. edited by another tool or git).
 */
export function watchFile(
  projectPath: string,
  relativePath: string,
  onChange: ChangeCallback,
): void {
  stopWatching();
  const full = path.join(projectPath, relativePath);
  try {
    const watcher = fs.watch(full, (eventType) => {
      if (eventType !== "change" && eventType !== "rename") return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => onChange(relativePath), 150);
    });
    watcher.on("error", () => {
      // File may have been deleted or become inaccessible. Clean up.
      stopWatching();
    });
    active = { watcher, relativePath };
  } catch (error) {
    log.warn("Could not watch file", full, error);
  }
}

export function stopWatching(): void {
  if (debounce) {
    clearTimeout(debounce);
    debounce = null;
  }
  if (active) {
    try {
      active.watcher.close();
    } catch {
      /* ignore */
    }
    active = null;
  }
}
