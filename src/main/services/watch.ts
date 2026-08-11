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
// Paths the app itself wrote recently (relative to the project root). A save
// can regenerate OTHER pages (post-list refresh), whose disk changes would
// otherwise surface as a false "modified outside Zephus" prompt on the open
// page — and the user clicking Reload would silently discard unsaved edits.
const selfWritten = new Map<string, number>();
// Generous window: fs.watch event delivery can lag under load; a self-write
// is always immediate in real usage, so a long window only ever suppresses
// our own writes (never a genuine external edit).
const SELF_WRITE_SUPPRESSION_MS = 30_000;

/** Records that the app wrote `relativePath` itself (schema write paths). */
export function markSelfWritten(relativePath: string): void {
  selfWritten.set(relativePath, Date.now());
}

/**
 * True when a watcher event's filename refers to the watched file itself.
 * Platforms differ: some deliver the bare name ("index.astro"), some the full
 * path; a null filename (event for the directory itself) is treated as
 * relevant because it cannot be distinguished.
 */
export function watchedFileMatches(
  filename: string | null,
  base: string,
  full: string,
): boolean {
  if (filename === null) return true;
  return (
    filename === base || filename === full || filename.endsWith(path.sep + base)
  );
}

function wasSelfWritten(relativePath: string): boolean {
  const at = selfWritten.get(relativePath);
  if (at === undefined) return false;
  const now = Date.now();
  if (now - at >= SELF_WRITE_SUPPRESSION_MS) {
    selfWritten.delete(relativePath);
    return false;
  }
  // fs.watch (FSEvents) can deliver 2+ events for ONE write. Consuming the
  // marker on the first let duplicates surface as a false "modified outside
  // Zephus"; keeping it for the whole 30s window suppressed genuine external
  // edits. Suppress only the duplicate burst, then clear so a real external
  // edit after ~500ms fires normally.
  if (now - at > 500) {
    selfWritten.delete(relativePath);
    return false;
  }
  return true;
}

/** Prunes expired self-write markers so the map stays bounded across many
 *  saves (every post-list refresh marks every regenerated page). */
export function pruneSelfWrittenMarkers(): void {
  const cutoff = Date.now() - SELF_WRITE_SUPPRESSION_MS;
  for (const [key, at] of selfWritten) {
    if (at < cutoff) selfWritten.delete(key);
  }
}

/**
 * Watches a single project file for external modifications. Replaces any
 * previously watched file. Debounces rapid events. Calls onChange when the
 * file changes on disk (e.g. edited by another tool or git). Returns false
 * when no watch could be established (bad path, symlink escape, or an
 * fs.watch failure) so callers can surface the missing change detection.
 */
export function watchFile(
  projectPath: string,
  relativePath: string,
  onChange: ChangeCallback,
): boolean {
  stopWatching();
  const root = path.resolve(projectPath);
  const full = path.resolve(root, relativePath);
  if (full !== root && !full.startsWith(root + path.sep)) {
    log.warn("Refusing to watch path outside project", full);
    return false;
  }
  // Resolve symlinks: an in-project symlink must not let us watch a file
  // outside the project root.
  try {
    const realRoot = fs.realpathSync.native(root);
    let existing = full;
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
    const realTarget = fs.realpathSync.native(existing);
    if (
      realTarget !== realRoot &&
      !realTarget.startsWith(realRoot + path.sep)
    ) {
      log.warn("Refusing to watch symlinked path outside project", full);
      return false;
    }
  } catch (error) {
    log.warn("Could not verify watch path containment", full, error);
    return false;
  }
  try {
    // Watch the parent DIRECTORY, not the file itself: editors (and Zephus's
    // own atomic saves) replace files via write-temp + rename, which unlinks
    // the watched inode — a direct file watch (kqueue on macOS) fires once
    // and then goes permanently silent. Directory watches survive renames.
    const dir = path.dirname(full);
    const base = path.basename(full);
    const watcher = fs.watch(dir, (eventType, filename) => {
      if (eventType !== "change" && eventType !== "rename") return;
      const changed = filename ? filename.toString() : null;
      if (!watchedFileMatches(changed, base, full)) {
        // Another file in the same directory changed; not ours.
        return;
      }
      if (debounce) clearTimeout(debounce);
      if (wasSelfWritten(relativePath)) {
        // Our own write (or a post-list refresh regenerating this page) — the
        // renderer must NOT be prompted, or "Reload" could discard its
        // unsaved edits.
        return;
      }
      debounce = setTimeout(() => onChange(relativePath), 150);
    });
    watcher.on("error", () => {
      // Directory may have been deleted or become inaccessible. Clean up.
      stopWatching();
    });
    active = { watcher, relativePath };
    return true;
  } catch (error) {
    log.warn("Could not watch file", full, error);
    return false;
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
