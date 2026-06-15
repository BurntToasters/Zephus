import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { OperationResult } from "../types";
import { buildTheme } from "../themes";
import { DEFAULT_REPO_SETTINGS } from "../types";

function sanitizeSiteName(folderPath: string): string {
  return (
    path
      .basename(folderPath)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-") || "zephus-site"
  );
}

/**
 * Scaffolds a brand-new Zephus site into targetPath from a bundled theme.
 * Writes theme files, package.json, astro config, the .zephus marker, then the
 * caller initializes git. Fails atomically: on any write error nothing partial
 * is left claiming to be a Zephus_Project (the .zephus dir is written last).
 */
export function createSite(
  targetPath: string,
  themeId: string,
): OperationResult {
  const theme = buildTheme(themeId, sanitizeSiteName(targetPath));
  if (!theme) {
    return { ok: false, error: `Unknown theme: ${themeId}` };
  }

  const written: string[] = [];
  try {
    fs.mkdirSync(targetPath, { recursive: true });

    for (const [rel, content] of Object.entries(theme.files)) {
      const full = path.join(targetPath, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
      written.push(full);
    }

    // .zephus marker written last so the project only counts as a Zephus_Project
    // once everything else succeeded.
    const zephusDir = path.join(targetPath, ".zephus");
    fs.mkdirSync(zephusDir, { recursive: true });
    fs.writeFileSync(
      path.join(zephusDir, "settings.json"),
      JSON.stringify({ ...DEFAULT_REPO_SETTINGS, theme: themeId }, null, 2) +
        "\n",
      "utf8",
    );

    return { ok: true };
  } catch (error) {
    log.error("Site creation failed; rolling back written files.", error);
    for (const file of written) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Creates a new page that extends the project's base theme layout. */
export function createPage(
  projectPath: string,
  pageName: string,
  pagesDir: string,
): OperationResult {
  const safeName = pageName.replace(/[^a-zA-Z0-9-_]/g, "").toLowerCase();
  if (!safeName) return { ok: false, error: "Invalid page name." };

  const rel = path.join(pagesDir, `${safeName}.astro`);
  const full = path.join(projectPath, rel);

  if (fs.existsSync(full)) {
    return { ok: false, error: `A page named ${safeName} already exists.` };
  }

  // Compute relative import from the new page to src/layouts/BaseLayout.astro.
  const layoutAbs = path.join(
    projectPath,
    "src",
    "layouts",
    "BaseLayout.astro",
  );
  let importPath = path
    .relative(path.dirname(full), layoutAbs)
    .split(path.sep)
    .join("/");
  if (!importPath.startsWith(".")) importPath = "./" + importPath;

  const title = safeName.charAt(0).toUpperCase() + safeName.slice(1);
  const content = `---
import BaseLayout from '${importPath}';
---

<BaseLayout title="${title}">
  <h1>${title}</h1>
  <p>New page. Start editing.</p>
</BaseLayout>
`;

  try {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
