/**
 * Finds where an asset is referenced, so the editor can warn before a delete or
 * rename silently breaks a page. Lives apart from `assets.ts` to keep that
 * module free of schema imports.
 */

import { AssetUsageResult, PageDocument, SiteDocument } from "../types";
import {
  listPageDocuments,
  readSiteDocument,
  writePageDocument,
  writeSiteDocument,
} from "./schema";

/** A match boundary: neither side may continue a filename/path token. */
function isTokenBoundary(char: string): boolean {
  return !/[A-Za-z0-9._-]/.test(char);
}

/** Replaces whole-token occurrences of `from` with `to`, counting replacements. */
function replaceReferences(
  value: string,
  from: string,
  to: string,
): { value: string; count: number } {
  if (!value || !from) return { value, count: 0 };
  let out = "";
  let count = 0;
  let index = 0;
  for (;;) {
    const found = value.indexOf(from, index);
    if (found === -1) {
      out += value.slice(index);
      break;
    }
    // A filename character before or after the match means this is a longer,
    // different path (e.g. `/a/hero.png` inside `/my/a/hero.png`) — leave it.
    const before = found > 0 ? value.charAt(found - 1) : "";
    const after = value.charAt(found + from.length);
    out += value.slice(index, found);
    if (!isTokenBoundary(before) || !isTokenBoundary(after)) {
      out += from;
    } else {
      out += to;
      count += 1;
    }
    index = found + from.length;
  }
  return { value: out, count };
}

/**
 * Points every saved reference to `from` at `to`, after an asset was renamed.
 * Without this, a rename would leave pages requesting a file that no longer
 * exists. Returns the number of references updated.
 */
export function repointAssetReferences(
  projectPath: string,
  pagesDir: string,
  from: string,
  to: string,
): { ok: boolean; updated: number; error?: string } {
  try {
    const previous = String(from ?? "").trim();
    const next = String(to ?? "").trim();
    if (!previous || !next || previous === next) {
      return { ok: true, updated: 0 };
    }

    const listed = listPageDocuments(projectPath, pagesDir);
    if (!listed.ok) {
      return {
        ok: false,
        updated: 0,
        error: listed.error ?? "Could not read pages.",
      };
    }

    let updated = 0;
    for (const doc of listed.entries) {
      const sections = replaceReferences(
        JSON.stringify(doc.sections),
        previous,
        next,
      );
      const socialImage = replaceReferences(
        doc.socialImage ?? "",
        previous,
        next,
      );
      if (sections.count === 0 && socialImage.count === 0) continue;

      const result = writePageDocument(projectPath, pagesDir, {
        ...doc,
        sections: JSON.parse(sections.value) as PageDocument["sections"],
        socialImage: socialImage.value,
      });
      if (!result.ok) {
        return {
          ok: false,
          updated,
          error: result.error ?? `Could not update ${doc.page}.`,
        };
      }
      updated += sections.count + socialImage.count;
    }

    const site = readSiteDocument(projectPath);
    if (site.ok && site.site) {
      const favicon = replaceReferences(
        site.site.faviconPath ?? "",
        previous,
        next,
      );
      const footer = replaceReferences(
        site.site.shell.footerHtml ?? "",
        previous,
        next,
      );
      const head = replaceReferences(
        site.site.shell.customHeadHtml ?? "",
        previous,
        next,
      );
      const siteCount = favicon.count + footer.count + head.count;
      if (siteCount > 0) {
        const written = writeSiteDocument(
          projectPath,
          {
            ...site.site,
            faviconPath: favicon.value,
            shell: {
              ...site.site.shell,
              footerHtml: footer.value,
              customHeadHtml: head.value,
            },
          },
          pagesDir,
        );
        if (!written.ok) {
          return {
            ok: false,
            updated,
            error: written.error ?? "Could not update site settings.",
          };
        }
        updated += siteCount;
      }
    }

    return { ok: true, updated };
  } catch (error) {
    return {
      ok: false,
      updated: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Matches the web path as a whole token, so `/a/hero.png` ignores `/a/hero.png.bak`. */
function referenceCount(haystack: string, webPath: string): number {
  if (!webPath) return 0;
  let count = 0;
  let index = haystack.indexOf(webPath);
  while (index !== -1) {
    // A filename character on either side means this is a longer, different
    // path — not a reference to this asset.
    const before = index > 0 ? haystack.charAt(index - 1) : "";
    const after = haystack.charAt(index + webPath.length);
    if (isTokenBoundary(before) && isTokenBoundary(after)) count += 1;
    index = haystack.indexOf(webPath, index + webPath.length);
  }
  return count;
}

function pageReferenceCount(doc: PageDocument, webPath: string): number {
  return (
    referenceCount(JSON.stringify(doc.sections), webPath) +
    referenceCount(doc.socialImage ?? "", webPath)
  );
}

function siteReferences(site: SiteDocument, webPath: string): string[] {
  const places: string[] = [];
  if (referenceCount(site.faviconPath ?? "", webPath) > 0) {
    places.push("Site favicon");
  }
  if (referenceCount(site.shell.footerHtml ?? "", webPath) > 0) {
    places.push("Footer HTML");
  }
  if (referenceCount(site.shell.customHeadHtml ?? "", webPath) > 0) {
    places.push("Custom head HTML");
  }
  return places;
}

/**
 * Reports which pages and site-level settings reference an asset. Reference
 * counting is textual: it inspects saved page section trees and site settings,
 * so it cannot see references inside hand-written code in detached pages.
 */
export function findAssetUsage(
  projectPath: string,
  pagesDir: string,
  webPath: string,
): AssetUsageResult {
  try {
    const normalized = String(webPath ?? "").trim();
    if (!normalized) {
      return {
        ok: false,
        pages: [],
        siteReferences: [],
        error: "Missing asset path.",
      };
    }

    const listed = listPageDocuments(projectPath, pagesDir);
    if (!listed.ok) {
      return {
        ok: false,
        pages: [],
        siteReferences: [],
        error: listed.error ?? "Could not read pages.",
      };
    }

    const pages = listed.entries
      .map((doc) => ({
        page: doc.page,
        label: doc.navLabel || doc.title || doc.slug,
        count: pageReferenceCount(doc, normalized),
      }))
      .filter((entry) => entry.count > 0);

    const site = readSiteDocument(projectPath);
    return {
      ok: true,
      pages,
      siteReferences:
        site.ok && site.site ? siteReferences(site.site, normalized) : [],
    };
  } catch (error) {
    return {
      ok: false,
      pages: [],
      siteReferences: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
