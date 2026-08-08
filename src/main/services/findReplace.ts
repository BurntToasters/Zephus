/**
 * Project-wide text search and replace across saved page content.
 *
 * Operates on the `.zephus/pages/*.json` sidecars (the source of truth), not on
 * generated `.astro` output, so a replace goes through `writePageDocument` and
 * regenerates pages the same way an editor save does.
 */

import {
  BlockNode,
  FindReplaceResult,
  PageDocument,
  ReplaceAllResult,
  SearchMatch,
  SectionNode,
} from "../types";
import { listPageDocuments, writePageDocument } from "./schema";

/** Props whose values are user-visible prose worth searching. */
const SEARCHABLE_PROPS = new Set([
  "text",
  "title",
  "heading",
  "quote",
  "author",
  "role",
  "cite",
  "items",
  "features",
  "plan",
  "price",
  "period",
  "buttonText",
  "ctaText",
  "col1",
  "col2",
  "col3",
  "col4",
  "alt",
  "label",
]);

export interface SearchOptions {
  caseSensitive?: boolean;
  /** Match only whole words. */
  wholeWord?: boolean;
}

const MAX_QUERY_LENGTH = 500;
const MAX_REPLACEMENT_LENGTH = 5000;

/** Rejects oversized or degenerate search payloads before they hit regex. */
function validatePayload(query: string, replacement?: string): string | null {
  const needle = String(query ?? "");
  if (!needle.trim()) return "Enter text to find.";
  if (needle.length > MAX_QUERY_LENGTH) {
    return `Search text is too long (max ${MAX_QUERY_LENGTH} characters).`;
  }
  if (
    replacement !== undefined &&
    replacement.length > MAX_REPLACEMENT_LENGTH
  ) {
    return `Replacement is too long (max ${MAX_REPLACEMENT_LENGTH} characters).`;
  }
  return null;
}

function occurrences(
  haystack: string,
  needle: string,
  options: SearchOptions,
): number {
  if (!needle) return 0;
  const flags = options.caseSensitive ? "g" : "gi";
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Whole-word = not surrounded by word characters. Explicit lookarounds (not
  // `\b`, which requires word characters and so can never match needles that
  // start or end with non-word characters like "C++").
  const pattern = options.wholeWord
    ? `(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`
    : escaped;
  const matches = haystack.match(new RegExp(pattern, flags));
  return matches ? matches.length : 0;
}

/** Counts occurrences across every searchable prop of one document. */
function countOnDoc(
  doc: PageDocument,
  needle: string,
  options: SearchOptions,
): number {
  let count = 0;
  eachSearchableProp(doc.sections, (_node, _prop, value) => {
    count += occurrences(value, needle, options);
  });
  return count;
}

function replaceOccurrences(
  haystack: string,
  needle: string,
  replacement: string,
  options: SearchOptions,
): string {
  if (!needle) return haystack;
  const flags = options.caseSensitive ? "g" : "gi";
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = options.wholeWord
    ? `(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`
    : escaped;
  // `$` sequences in the replacement must be literal, not capture references.
  return haystack.replace(
    new RegExp(pattern, flags),
    replacement.replace(/\$/g, "$$$$"),
  );
}

/** Walks every searchable prop of a page, calling back with each value. */
function eachSearchableProp(
  sections: SectionNode[],
  visit: (
    block: BlockNode | SectionNode,
    prop: string,
    value: string,
    setValue: (next: string) => void,
  ) => void,
): void {
  const visitNode = (node: BlockNode | SectionNode): void => {
    for (const [prop, value] of Object.entries(node.props ?? {})) {
      if (typeof value !== "string") continue;
      if (!SEARCHABLE_PROPS.has(prop)) continue;
      visit(node, prop, value, (next) => {
        node.props[prop] = next;
      });
    }
    const children = (node as SectionNode).children;
    if (Array.isArray(children)) {
      for (const child of children) visitNode(child as BlockNode);
    }
  };
  for (const section of sections) visitNode(section);
}

/** Builds a short excerpt centered on the first match, for the results list. */
function excerptFor(
  value: string,
  query: string,
  options: SearchOptions,
): string {
  const haystack = options.caseSensitive ? value : value.toLowerCase();
  const needle = options.caseSensitive ? query : query.toLowerCase();
  const at = haystack.indexOf(needle);
  if (at === -1) return value.slice(0, 80);
  const start = Math.max(0, at - 30);
  const end = Math.min(value.length, at + needle.length + 30);
  return `${start > 0 ? "…" : ""}${value.slice(start, end)}${
    end < value.length ? "…" : ""
  }`;
}

export function searchPages(
  projectPath: string,
  pagesDir: string,
  query: string,
  options: SearchOptions = {},
): FindReplaceResult {
  try {
    const needle = String(query ?? "");
    const payloadError = validatePayload(needle);
    if (payloadError) {
      return { ok: false, matches: [], totalMatches: 0, error: payloadError };
    }
    if (!needle) return { ok: true, matches: [], totalMatches: 0 };

    const listed = listPageDocuments(projectPath, pagesDir);
    if (!listed.ok) {
      return {
        ok: false,
        matches: [],
        totalMatches: 0,
        error: listed.error ?? "Could not read pages.",
      };
    }

    const matches: SearchMatch[] = [];
    let totalMatches = 0;
    let skippedDetachedPages = 0;
    for (const doc of listed.entries) {
      // Detached/out-of-sync pages hold hand-authored content: replaceAll
      // SKIPS them (replacing via the stale sidecar would un-detach the page
      // and overwrite the file). The search must skip them too, or the
      // confirmation dialog counts matches that will never be replaced.
      if (doc.detached || doc.managedFileStatus === "out-of-sync") {
        const pageCount = countOnDoc(doc, needle, options);
        if (pageCount > 0) skippedDetachedPages += 1;
        continue;
      }
      let pageCount = 0;
      const samples: string[] = [];
      eachSearchableProp(doc.sections, (node, _prop, value) => {
        const count = occurrences(value, needle, options);
        if (count === 0) return;
        pageCount += count;
        if (samples.length < 3) {
          samples.push(excerptFor(value, needle, options));
        }
        void node;
      });
      if (pageCount > 0) {
        matches.push({
          page: doc.page,
          label: doc.navLabel || doc.title || doc.slug,
          count: pageCount,
          excerpts: samples,
        });
        totalMatches += pageCount;
      }
    }

    return { ok: true, matches, totalMatches, skippedDetachedPages };
  } catch (error) {
    return {
      ok: false,
      matches: [],
      totalMatches: 0,
      skippedDetachedPages: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function replaceAllInPages(
  projectPath: string,
  pagesDir: string,
  query: string,
  replacement: string,
  options: SearchOptions = {},
  onlyPages?: string[],
): ReplaceAllResult {
  try {
    const needle = String(query ?? "");
    const next = String(replacement ?? "");
    const payloadError = validatePayload(needle, next);
    if (payloadError) {
      return {
        ok: false,
        replaced: 0,
        pagesChanged: 0,
        error: payloadError,
      };
    }
    if (!needle) {
      return {
        ok: false,
        replaced: 0,
        pagesChanged: 0,
        error: "Enter text to find.",
      };
    }

    const listed = listPageDocuments(projectPath, pagesDir);
    if (!listed.ok) {
      return {
        ok: false,
        replaced: 0,
        pagesChanged: 0,
        error: listed.error ?? "Could not read pages.",
      };
    }

    const limit = onlyPages && onlyPages.length > 0 ? new Set(onlyPages) : null;
    let replaced = 0;
    let pagesChanged = 0;

    for (const doc of listed.entries) {
      if (limit && !limit.has(doc.page)) continue;
      // Detached/out-of-sync pages have hand-authored content only on disk:
      // replacing through their stale sidecar tree would un-detach them and
      // overwrite the file. Their text cannot be replaced safely.
      if (doc.detached || doc.managedFileStatus === "out-of-sync") continue;
      let pageReplacements = 0;
      const sections = JSON.parse(
        JSON.stringify(doc.sections),
      ) as PageDocument["sections"];

      eachSearchableProp(sections, (_node, _prop, value, setValue) => {
        const count = occurrences(value, needle, options);
        if (count === 0) return;
        setValue(replaceOccurrences(value, needle, next, options));
        pageReplacements += count;
      });

      if (pageReplacements === 0) continue;
      const written = writePageDocument(projectPath, pagesDir, {
        ...doc,
        sections,
      });
      if (!written.ok) {
        return {
          ok: false,
          replaced,
          pagesChanged,
          error: written.error ?? `Could not update ${doc.page}.`,
        };
      }
      replaced += pageReplacements;
      pagesChanged += 1;
    }

    return { ok: true, replaced, pagesChanged };
  } catch (error) {
    return {
      ok: false,
      replaced: 0,
      pagesChanged: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
