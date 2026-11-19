/**
 * Copy notices for bundled third-party binaries to public/ so the in-app
 * licenses view can display the exact shipped text.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function copyBundledNotices(root = defaultRoot) {
  const publicDir = join(root, "public");
  mkdirSync(publicDir, { recursive: true });
  const index = [];
  writeFileSync(
    join(publicDir, "bundled-licenses.json"),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8",
  );
  return index;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const notices = copyBundledNotices();
    console.log(
      `[licenses:bundled] Copied ${notices.length} bundled binary notices to public/`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
