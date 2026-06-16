import * as fs from "fs";
import * as path from "path";
import log from "electron-log";

/**
 * Writes a file atomically: write to a temp sibling, then rename over the
 * target. Rename is atomic on the same filesystem, so a crash mid-write can
 * never leave a half-written/corrupt file.
 */
export function writeFileAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    } catch {
      /* best-effort cleanup */
    }
    throw error;
  }
}

export interface SafeJsonResult<T> {
  data: T | null;
  /** True when the file existed but could not be parsed (and was backed up). */
  corrupt: boolean;
}

/**
 * Reads and parses a JSON file. On parse failure, the unreadable file is
 * preserved as a timestamped `.corrupt-*` backup (never silently overwritten)
 * and { data: null, corrupt: true } is returned so callers can warn instead
 * of clobbering user data.
 */
export function readJsonSafe<T>(file: string): SafeJsonResult<T> {
  if (!fs.existsSync(file)) return { data: null, corrupt: false };
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { data: null, corrupt: false };
  }
  try {
    return { data: JSON.parse(raw) as T, corrupt: false };
  } catch (error) {
    const backup = `${file}.corrupt-${Date.now()}`;
    try {
      fs.copyFileSync(file, backup);
      log.error(
        `Malformed JSON at ${file}; backed up to ${backup}. Not overwriting.`,
        error,
      );
    } catch (backupError) {
      log.error(`Malformed JSON at ${file}; backup failed.`, backupError);
    }
    return { data: null, corrupt: true };
  }
}
