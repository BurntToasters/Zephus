import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { OperationResult } from "../types";
import { buildTheme } from "../themes";
import { DEFAULT_REPO_SETTINGS } from "../types";
import { createManagedPage } from "./pageManager";
import { createSchemaPage, ensureVisualSchema } from "./schema";

function sanitizeSiteName(folderPath: string): string {
  const safe = path
    .basename(folderPath)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 214);
  return safe || "zephus-site";
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
  const zephusDir = path.join(targetPath, ".zephus");
  const targetExisted = fs.existsSync(targetPath);
  const targetWasEmpty =
    targetExisted && fs.readdirSync(targetPath).length === 0;
  const hadZephusDir = fs.existsSync(zephusDir);
  try {
    if (fs.existsSync(targetPath) && fs.readdirSync(targetPath).length > 0) {
      const looksLikeZephus =
        fs.existsSync(path.join(targetPath, ".zephus")) ||
        fs.existsSync(path.join(targetPath, "astro.config.mjs"));
      return {
        ok: false,
        error: looksLikeZephus
          ? "This folder already contains a Zephus site. Pick a new, empty folder — or delete/rename this one if a previous creation attempt failed."
          : "Choose an empty folder for the new site.",
      };
    }
    fs.mkdirSync(targetPath, { recursive: true });

    for (const [rel, content] of Object.entries(theme.files)) {
      const full = path.join(targetPath, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
      written.push(full);
    }

    const ensured = ensureVisualSchema(
      targetPath,
      path.join("src", "pages"),
      themeId,
      {
        // The scaffold's stub pages/layout are placeholders, not user work:
        // replace them with the real generated files (and record hashes) so
        // the site opens fully "managed" on the very first pass.
        regenerateHashlessPages: true,
      },
    );
    if (!ensured.ok) {
      throw new Error(ensured.error ?? "Could not initialize Zephus schema.");
    }

    // Fresh sites previously shipped without a 404 page (no theme scaffolded
    // one) — visitors hit the host's generic unstyled 404. The machinery
    // already exists (createSchemaPage's 404 branch forces navVisible=false
    // and noindex); scaffold one per site.
    const notFound = createSchemaPage(
      targetPath,
      path.join("src", "pages"),
      "404",
    );
    if (!notFound.ok && notFound.error) {
      throw new Error(notFound.error);
    }

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
    if (!targetExisted) {
      try {
        fs.rmSync(targetPath, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    } else if (targetWasEmpty) {
      try {
        for (const entry of fs.readdirSync(targetPath)) {
          fs.rmSync(path.join(targetPath, entry), {
            recursive: true,
            force: true,
          });
        }
      } catch {
        /* best-effort cleanup */
      }
    }
    for (const file of written) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
    if (!hadZephusDir) {
      try {
        fs.rmSync(zephusDir, { recursive: true, force: true });
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
  return createManagedPage(projectPath, pageName, pagesDir);
}
