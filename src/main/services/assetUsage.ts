/** Finds where an asset is referenced, so the editor can warn before a delete or rename silently breaks a page. */

import * as fs from "fs";
import * as path from "path";
import { AssetUsageResult, PageDocument, SiteDocument } from "../types";
import { safeResolve } from "./fsSafe";
import { normalizePageSlug, slugFromPage } from "../../shared/pageIdentity";
import {
  listPageDocuments,
  readSiteDocument,
  sameCanonicalPageFile,
  writePageDocument,
  writeSiteDocument,
} from "./schema";
import { detectAstro, listPages } from "./project";
import {
  listReusableSections,
  writeStoredReusableSections,
} from "./reusableSections";
import { assetReferenceSpellings } from "./assets";

function pageSidecarRel(slug: string): string {
  const normalized = normalizePageSlug(slug);
  if (!normalized) {
    throw new Error("Invalid page schema slug.");
  }
  return path.posix.join(
    ".zephus",
    "pages",
    normalized === "index" ? "index.json" : `${normalized}.json`,
  );
}

function sidecarMatchesPageFile(
  projectPath: string,
  page: string,
  pagesDir: string,
): boolean {
  try {
    const sidecar = safeResolve(
      projectPath,
      pageSidecarRel(slugFromPage(page, pagesDir)),
    );
    if (!fs.existsSync(sidecar)) return false;
    const raw = JSON.parse(fs.readFileSync(sidecar, "utf8")) as {
      page?: unknown;
    };
    if (typeof raw.page !== "string" || raw.page.trim() === "") return false;
    return sameCanonicalPageFile(raw.page, page, pagesDir);
  } catch {
    return false;
  }
}

/** Pages on disk with no sidecar yet — checked before ensureVisualSchema can migrate them. */
function pagesMissingSidecar(projectPath: string, pagesDir: string): string[] {
  return listPages(projectPath, pagesDir).filter(
    (page) => !sidecarMatchesPageFile(projectPath, page, pagesDir),
  );
}

function formatMissingPagesError(missingPages: string[]): string {
  const shown = missingPages.slice(0, 4).join(", ");
  const extra =
    missingPages.length > 4 ? ` and ${missingPages.length - 4} more` : "";
  return `One or more pages are missing editor metadata (${shown}${extra}).`;
}

/** A match boundary: neither side may continue a filename/path token. */
function isTokenBoundary(char: string): boolean {
  return !/[A-Za-z0-9._/-]/.test(char);
}

/**
 * Reference spellings that can name the asset: its canonical web path plus the
 * legacy raw form older sidecars saved. Invalid managed paths fall back to
 * their literal spelling so hand-written values remain repointable.
 */
function referenceAliases(webPath: string): string[] {
  const normalized = String(webPath ?? "").trim();
  if (!normalized) return [];
  try {
    return assetReferenceSpellings(normalized);
  } catch {
    return [normalized.normalize("NFC")];
  }
}

/** Longest-first so a spelling containing another spelling still matches whole. */
function sortAliases(aliases: string[]): string[] {
  return [...new Set(aliases.filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
}

/**
 * Replaces whole-token occurrences of any reference spelling with `to`.
 * A single pass means an occurrence is counted once even when spellings
 * overlap, and identical aliases are de-duplicated first.
 */
function replaceReferences(
  value: string,
  aliases: string[],
  to: string,
): { value: string; count: number } {
  const ordered = sortAliases(aliases);
  if (!value || ordered.length === 0) return { value, count: 0 };
  let out = "";
  let count = 0;
  let index = 0;
  while (index < value.length) {
    let matched = "";
    for (const alias of ordered) {
      if (!value.startsWith(alias, index)) continue;
      const before = index > 0 ? value.charAt(index - 1) : "";
      const after = value.charAt(index + alias.length);
      if (isTokenBoundary(before) && isTokenBoundary(after)) {
        matched = alias;
        break;
      }
    }
    if (matched) {
      out += to;
      count += 1;
      index += matched.length;
      continue;
    }
    out += value.charAt(index);
    index += 1;
  }
  return { value: out, count };
}

const STRUCTURAL_BLOCK_PROP_KEYS = new Set([
  "cls",
  "level",
  "ordered",
  "variant",
]);

function replaceInProps(
  props: Record<string, string>,
  aliases: string[],
  to: string,
): { value: Record<string, string>; count: number } {
  let count = 0;
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(props)) {
    if (STRUCTURAL_BLOCK_PROP_KEYS.has(key) || typeof val !== "string") {
      out[key] = val;
      continue;
    }
    const next = replaceReferences(val, aliases, to);
    count += next.count;
    out[key] = next.value;
  }
  return { value: out, count };
}

/** Recursively replaces references inside style objects while preserving primitives. */
function replaceInStrings(
  value: unknown,
  aliases: string[],
  to: string,
): { value: unknown; count: number } {
  if (typeof value === "string") {
    return replaceReferences(value, aliases, to);
  }
  if (Array.isArray(value)) {
    let count = 0;
    const out = value.map((item) => {
      const next = replaceInStrings(item, aliases, to);
      count += next.count;
      return next.value;
    });
    return { value: out, count };
  }
  if (value && typeof value === "object") {
    let count = 0;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const next = replaceInStrings(val, aliases, to);
      count += next.count;
      out[key] = next.value;
    }
    return { value: out, count };
  }
  return { value, count: 0 };
}

/** Replaces asset references only in editable content/style fields, preserving structural metadata. */
function replaceInSections(
  sections: PageDocument["sections"],
  aliases: string[],
  to: string,
): { value: PageDocument["sections"]; count: number } {
  let count = 0;
  const nextSections = sections.map((section) => {
    const nextStyle = section.style
      ? replaceInStrings(section.style, aliases, to)
      : { value: section.style, count: 0 };
    count += nextStyle.count;
    const nextChildren = section.children.map((block) => {
      const nextProps = replaceInProps(block.props, aliases, to);
      const nextBlockStyle = block.style
        ? replaceInStrings(block.style, aliases, to)
        : { value: block.style, count: 0 };
      const nextRaw =
        typeof block.raw === "string"
          ? replaceReferences(block.raw, aliases, to)
          : { value: block.raw, count: 0 };
      count += nextProps.count + nextBlockStyle.count + nextRaw.count;
      return {
        ...block,
        props: nextProps.value,
        ...(block.style !== undefined
          ? { style: nextBlockStyle.value as typeof block.style }
          : {}),
        ...(block.raw !== undefined ? { raw: nextRaw.value } : {}),
      };
    });
    return {
      ...section,
      ...(section.style !== undefined
        ? { style: nextStyle.value as typeof section.style }
        : {}),
      children: nextChildren,
    };
  });
  return { value: nextSections, count };
}

/** Points every saved reference to `from` at `to`, after an asset was renamed. */
export function repointAssetReferences(
  projectPath: string,
  pagesDir: string,
  from: string,
  to: string,
): { ok: boolean; updated: number; error?: string } {
  try {
    // NFC-normalize both sides: macOS filenames can come back NFD (or NFC)
    // depending on how they were created, and references written by hand may
    // use the other form — matching must be form-agnostic. Legacy raw
    // spellings are repointed too, so old sidecars cannot keep a dead path.
    const aliases = referenceAliases(from);
    const next = String(to ?? "")
      .trim()
      .normalize("NFC");
    const sources = aliases.filter((alias) => alias !== next);
    if (!next || sources.length === 0) {
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
      // Detached/out-of-sync pages carry hand-authored content only on disk;
      // writing their (stale) sidecar tree back would un-detach them and
      // overwrite the user's file with regenerated output. Their references
      // can only be fixed by hand (the tooling cannot see inside them).
      if (doc.detached || doc.managedFileStatus === "out-of-sync") continue;
      const sections = replaceInSections(doc.sections, sources, next);
      const socialImage = replaceReferences(
        doc.socialImage ?? "",
        sources,
        next,
      );
      if (sections.count === 0 && socialImage.count === 0) continue;

      const result = writePageDocument(projectPath, pagesDir, {
        ...doc,
        sections: sections.value,
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
        sources,
        next,
      );
      const footer = replaceReferences(
        site.site.shell.footerHtml ?? "",
        sources,
        next,
      );
      const head = replaceReferences(
        site.site.shell.customHeadHtml ?? "",
        sources,
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

    const reusable = listReusableSections(projectPath);
    if (!reusable.ok && reusable.error) {
      return {
        ok: false,
        updated,
        error: reusable.error,
      };
    }
    if (reusable.ok && reusable.sections.length > 0) {
      let reusableCount = 0;
      const nextSections = reusable.sections.map((section) => {
        const replaced = replaceReferences(section.html, sources, next);
        reusableCount += replaced.count;
        return replaced.count > 0
          ? { ...section, html: replaced.value }
          : section;
      });
      if (reusableCount > 0) {
        const savedReusable = writeStoredReusableSections(
          projectPath,
          nextSections,
        );
        if (!savedReusable.ok) {
          return {
            ok: false,
            updated,
            error: savedReusable.error ?? "Could not update reusable sections.",
          };
        }
        updated += reusableCount;
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

/** Counts whole-token occurrences of any reference spelling, once per occurrence. */
function referenceCount(haystack: string, aliases: string[]): number {
  const ordered = sortAliases(aliases);
  if (!haystack || ordered.length === 0) return 0;
  let count = 0;
  let index = 0;
  while (index < haystack.length) {
    let matched = "";
    for (const alias of ordered) {
      if (!haystack.startsWith(alias, index)) continue;
      // A filename character on either side means this is a longer, different
      // path — not a reference to this asset.
      const before = index > 0 ? haystack.charAt(index - 1) : "";
      const after = haystack.charAt(index + alias.length);
      if (isTokenBoundary(before) && isTokenBoundary(after)) {
        matched = alias;
        break;
      }
    }
    if (matched) {
      count += 1;
      index += matched.length;
      continue;
    }
    index += 1;
  }
  return count;
}

function countInStrings(value: unknown, aliases: string[]): number {
  if (typeof value === "string") return referenceCount(value, aliases);
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countInStrings(item, aliases), 0);
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce(
      (sum: number, val) => sum + countInStrings(val, aliases),
      0,
    );
  }
  return 0;
}

function sectionsReferenceCount(
  sections: PageDocument["sections"],
  aliases: string[],
): number {
  let count = 0;
  for (const section of sections) {
    count += countInStrings(section.style, aliases);
    for (const block of section.children) {
      count += countInStrings(block.style, aliases);
      if (typeof block.raw === "string") {
        count += referenceCount(block.raw, aliases);
      }
      for (const [key, val] of Object.entries(block.props)) {
        if (STRUCTURAL_BLOCK_PROP_KEYS.has(key) || typeof val !== "string") {
          continue;
        }
        count += referenceCount(val, aliases);
      }
    }
  }
  return count;
}

function pageReferenceCount(doc: PageDocument, aliases: string[]): number {
  return (
    sectionsReferenceCount(doc.sections, aliases) +
    referenceCount(doc.socialImage ?? "", aliases)
  );
}

function siteReferences(site: SiteDocument, aliases: string[]): string[] {
  const places: string[] = [];
  if (referenceCount(site.faviconPath ?? "", aliases) > 0) {
    places.push("Site favicon");
  }
  if (referenceCount(site.shell.footerHtml ?? "", aliases) > 0) {
    places.push("Footer HTML");
  }
  if (referenceCount(site.shell.customHeadHtml ?? "", aliases) > 0) {
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
  _pagesDir: string,
  webPath: string,
): AssetUsageResult {
  try {
    const normalized = String(webPath ?? "")
      .trim()
      .normalize("NFC");
    if (!normalized) {
      return {
        ok: false,
        pages: [],
        siteReferences: [],
        error: "Missing asset path.",
      };
    }
    const aliases = referenceAliases(normalized);

    const pagesDir = detectAstro(projectPath).pagesDir;
    const missingSidecars = pagesMissingSidecar(projectPath, pagesDir);
    if (missingSidecars.length > 0) {
      return {
        ok: false,
        pages: [],
        siteReferences: [],
        error: formatMissingPagesError(missingSidecars),
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

    const missingPages = listed.missingPages ?? [];
    if (missingPages.length > 0) {
      return {
        ok: false,
        pages: [],
        siteReferences: [],
        error: formatMissingPagesError(missingPages),
      };
    }

    const unscanned: string[] = [];
    const pages = listed.entries.flatMap((doc) => {
      if (doc.detached || doc.managedFileStatus === "out-of-sync") {
        unscanned.push(doc.navLabel || doc.title || doc.slug);
        return [];
      }
      const count = pageReferenceCount(doc, aliases);
      if (count <= 0) return [];
      return [
        {
          page: doc.page,
          label: doc.navLabel || doc.title || doc.slug,
          count,
        },
      ];
    });

    const site = readSiteDocument(projectPath);
    let usageGap: string | undefined;
    if (unscanned.length > 0) {
      const shown = unscanned.slice(0, 4).join(", ");
      const extra =
        unscanned.length > 4 ? ` and ${unscanned.length - 4} more` : "";
      usageGap = `hand-written or out-of-sync pages were not scanned (${shown}${extra})`;
    }
    if (!site.ok) {
      return {
        ok: false,
        pages,
        siteReferences: [],
        error: site.error ?? "Could not read site settings.",
        ...(usageGap ? { usageGap } : {}),
      };
    }
    const places = site.site ? siteReferences(site.site, aliases) : [];
    const reusable = listReusableSections(projectPath);
    if (!reusable.ok && reusable.error) {
      return {
        ok: false,
        pages,
        siteReferences: places,
        error: reusable.error,
        ...(usageGap ? { usageGap } : {}),
      };
    }
    for (const section of reusable.sections) {
      if (referenceCount(section.html, aliases) > 0) {
        places.push(`Reusable section: ${section.label}`);
      }
    }
    return {
      ok: true,
      pages,
      siteReferences: places,
      ...(usageGap ? { usageGap } : {}),
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
