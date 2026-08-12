import * as fs from "fs";
import * as path from "path";
import { OperationResult, PageListResult, PageMeta } from "../types";
import { assertRealpathInside, safeResolve } from "./fsSafe";
import {
  createSchemaPage,
  deletePageSchema,
  duplicatePageSchema,
  ensureVisualSchema,
  isNotFoundSlug,
  listExistingPageDocuments,
  normalizePageSlug,
  pagePathFromSlug,
  readPageDocument,
  renamePageSchema,
  routeFromPage,
  writePageDocument,
  writePageDocumentFile,
  writePageMetadataPreservingSource,
  writeSiteDocument,
} from "./schema";

/** Resolves a project page path with symlink-aware containment. */
function resolvePage(projectPath: string, relativePath: string): string {
  const full = safeResolve(projectPath, relativePath);
  assertRealpathInside(projectPath, full);
  return full;
}

/** A page path must live under pagesDir and carry a page extension. Without
 *  this, delete/rename/duplicate accepted ANY in-root file (.env, .git/config,
 *  package.json) — arbitrary project-file deletion and exfiltration. */
function pageInsidePagesDir(page: string, pagesDir: string): boolean {
  const normPage = page.replace(/\\/g, "/").replace(/^\/+/, "");
  const normDir = pagesDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const prefix = normDir ? `${normDir}/` : "";
  return (
    normPage.startsWith(prefix) && /\.(astro|md|mdx|html)$/i.test(normPage)
  );
}

function assertPageInsidePagesDir(
  page: string,
  pagesDir: string,
): OperationResult {
  if (!pageInsidePagesDir(page, pagesDir)) {
    return {
      ok: false,
      error: "Not a page inside the site's pages directory.",
    };
  }
  return { ok: true };
}

export { normalizePageSlug, routeFromPage };

export function readPageMetadata(
  projectPath: string,
  page: string,
  pagesDir: string,
): PageMeta {
  const result = readPageDocument(projectPath, page, pagesDir);
  if (result.ok && result.pageDocument) {
    const doc = result.pageDocument;
    return {
      page: doc.page,
      route: doc.route,
      slug: doc.slug,
      title: doc.title,
      navLabel: doc.navLabel,
      metaDescription: doc.metaDescription,
      navVisible: doc.navVisible,
      isHome: doc.isHome,
      detached: doc.detached,
      socialImage: doc.socialImage,
      canonicalUrl: doc.canonicalUrl,
      noindex: doc.noindex,
      publishDate: doc.publishDate,
      author: doc.author,
    };
  }
  const slug =
    normalizePageSlug(page.replace(/^.*?src[\\/]+pages[\\/]+/, "")) ?? "index";
  const route = slug === "index" ? "/" : `/${slug}`;
  const title =
    slug === "index"
      ? "Home"
      : (slug
          .split("/")
          .pop()
          ?.replace(/[-_]/g, " ")
          .replace(/\b\w/g, (char) => char.toUpperCase()) ?? "Page");
  return {
    page,
    route,
    slug,
    title,
    navLabel: title,
    metaDescription: "",
    navVisible: true,
    isHome: route === "/",
    detached: false,
    socialImage: "",
    canonicalUrl: "",
    noindex: false,
    publishDate: "",
    author: "",
  };
}

export function listPageMetadata(
  projectPath: string,
  pagesDir: string,
): PageListResult {
  // Ensure once, then read sidecars directly (no second full pass per save).
  const ensured = ensureVisualSchema(projectPath, pagesDir);
  if (!ensured.ok) {
    return { ok: false, entries: [], error: ensured.error };
  }
  return {
    ok: true,
    entries: listExistingPageDocuments(projectPath, pagesDir).map((doc) => ({
      page: doc.page,
      route: doc.route,
      slug: doc.slug,
      title: doc.title,
      navLabel: doc.navLabel,
      metaDescription: doc.metaDescription,
      navVisible: doc.navVisible,
      isHome: doc.isHome,
      detached: doc.detached,
      socialImage: doc.socialImage,
      canonicalUrl: doc.canonicalUrl,
      noindex: doc.noindex,
      publishDate: doc.publishDate,
      author: doc.author,
    })),
  };
}

export function writePageMetadata(
  projectPath: string,
  page: string,
  pagesDir: string,
  partial: Partial<PageMeta>,
): OperationResult {
  const current = readPageDocument(projectPath, page, pagesDir);
  if (!current.ok || !current.pageDocument) {
    return { ok: false, error: current.error ?? "Page schema not found." };
  }
  const reservedNotFound = isNotFoundSlug(current.pageDocument.slug);
  const next = {
    ...current.pageDocument,
    title: partial.title ?? current.pageDocument.title,
    navLabel: partial.navLabel ?? current.pageDocument.navLabel,
    metaDescription:
      partial.metaDescription ?? current.pageDocument.metaDescription,
    navVisible: reservedNotFound
      ? false
      : (partial.navVisible ?? current.pageDocument.navVisible),
    socialImage: partial.socialImage ?? current.pageDocument.socialImage,
    canonicalUrl: partial.canonicalUrl ?? current.pageDocument.canonicalUrl,
    noindex: reservedNotFound
      ? true
      : (partial.noindex ?? current.pageDocument.noindex),
    publishDate: partial.publishDate ?? current.pageDocument.publishDate,
    author: partial.author ?? current.pageDocument.author,
  };
  // Detached / out-of-sync pages hold hand-authored code. A metadata edit must
  // never regenerate the .astro from the (stale) sidecar tree or reattach the
  // page — that silently destroys the author's work. Write sidecar-only.
  const preserveSource =
    current.pageDocument.detached ||
    current.pageDocument.managedFileStatus === "out-of-sync";
  const saved = preserveSource
    ? writePageMetadataPreservingSource(projectPath, pagesDir, next)
    : writePageDocument(projectPath, pagesDir, next);
  return saved.ok ? { ok: true } : { ok: false, error: saved.error };
}

export function createManagedPage(
  projectPath: string,
  slugInput: string,
  pagesDir: string,
): OperationResult {
  const slug = normalizePageSlug(slugInput);
  if (!slug) return { ok: false, error: "Invalid page slug." };
  const rel = pagePathFromSlug(pagesDir, slug);
  const full = path.join(projectPath, rel);
  if (fs.existsSync(full)) {
    return { ok: false, error: `A page at ${slug} already exists.` };
  }
  const created = createSchemaPage(projectPath, pagesDir, slug);
  return created.ok ? { ok: true } : { ok: false, error: created.error };
}

function uniqueSlug(
  projectPath: string,
  pagesDir: string,
  slug: string,
  ext: string,
): string {
  let candidate = slug;
  let index = 1;
  while (
    fs.existsSync(
      path.join(projectPath, pagePathFromSlug(pagesDir, candidate, ext)),
    )
  ) {
    candidate = `${slug}-copy-${index}`;
    index += 1;
  }
  return candidate;
}

export function renamePage(
  projectPath: string,
  page: string,
  pagesDir: string,
  nextSlugInput: string,
): OperationResult {
  const membership = assertPageInsidePagesDir(page, pagesDir);
  if (!membership.ok) return membership;
  const nextSlug = normalizePageSlug(nextSlugInput);
  if (!nextSlug) return { ok: false, error: "Invalid page slug." };
  const ext = path.extname(page) || ".astro";
  const from = resolvePage(projectPath, page);
  const nextRel = pagePathFromSlug(pagesDir, nextSlug, ext);
  const to = resolvePage(projectPath, nextRel);
  if (from === to) return { ok: true };
  if (fs.existsSync(to)) {
    return { ok: false, error: `A page at ${nextSlug} already exists.` };
  }
  try {
    const current = readPageDocument(projectPath, page, pagesDir);
    if (!current.ok || !current.pageDocument) {
      // A corrupt/foreign project must not be renamed: the sidecar cannot be
      // moved with the file, leaving a stale orphan behind. Bail before any
      // filesystem change.
      return {
        ok: false,
        error: current.error ?? "Page schema could not be read.",
      };
    }
    const originalSource = fs.readFileSync(from, "utf8");
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    const moved = renamePageSchema(projectPath, pagesDir, page, nextSlug);
    if (!moved.ok) {
      fs.renameSync(to, from);
      return moved;
    }
    if (current.ok && current.pageDocument) {
      const nextIsNotFound = isNotFoundSlug(nextSlug);
      const previousWasNotFound = isNotFoundSlug(current.pageDocument.slug);
      const nextDoc = {
        ...current.pageDocument,
        page: nextRel,
        slug: nextSlug,
        route: nextSlug === "index" ? "/" : `/${nextSlug}`,
        isHome: nextSlug === "index",
        navVisible: nextIsNotFound
          ? false
          : previousWasNotFound
            ? true
            : current.pageDocument.navVisible,
        noindex: nextIsNotFound
          ? true
          : previousWasNotFound
            ? false
            : current.pageDocument.noindex,
      };
      // Detached/out-of-sync pages carry hand-authored content ONLY on disk:
      // the sidecar tree is stale, and writePageDocument would force them
      // back to "managed" and regenerate the file from that stale tree —
      // destroying the user's edits. A rename must move bytes, not content.
      if (
        current.pageDocument.detached ||
        current.pageDocument.managedFileStatus === "out-of-sync"
      ) {
        writePageDocumentFile(projectPath, nextDoc);
        return { ok: true };
      }
      const saved = writePageDocument(projectPath, pagesDir, nextDoc);
      if (!saved.ok) {
        fs.writeFileSync(from, originalSource, "utf8");
        if (fs.existsSync(to)) {
          fs.rmSync(to, { force: true });
        }
        renamePageSchema(
          projectPath,
          pagesDir,
          nextRel,
          current.pageDocument.slug,
        );
        writePageDocument(projectPath, pagesDir, current.pageDocument);
        return { ok: false, error: saved.error };
      }
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function duplicatePage(
  projectPath: string,
  page: string,
  pagesDir: string,
  slugInput?: string,
): OperationResult {
  try {
    const membership = assertPageInsidePagesDir(page, pagesDir);
    if (!membership.ok) return membership;
    const from = resolvePage(projectPath, page);
    const ext = path.extname(page) || ".astro";
    const currentSlug =
      normalizePageSlug(routeFromPage(page, pagesDir).replace(/^\//, "")) ??
      path.basename(page, ext);
    const baseSlug = normalizePageSlug(slugInput ?? `${currentSlug}-copy`);
    if (!baseSlug) return { ok: false, error: "Invalid duplicate slug." };
    const nextSlug = uniqueSlug(projectPath, pagesDir, baseSlug, ext);
    const nextRel = pagePathFromSlug(pagesDir, nextSlug, ext);
    const to = resolvePage(projectPath, nextRel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    const copied = duplicatePageSchema(projectPath, pagesDir, page, nextSlug);
    if (!copied.ok) {
      fs.rmSync(to, { force: true });
      return copied;
    }
    const next = readPageDocument(projectPath, nextRel, pagesDir);
    if (next.ok && next.pageDocument) {
      // Detached / out-of-sync originals were copied byte-for-byte above;
      // regenerating them via writePageDocument would rebuild the copy from
      // the stale sidecar tree and silently drop the hand-authored content.
      // For those, only sync metadata + shell outputs (no .astro rewrite).
      const preserveSource =
        next.pageDocument.detached ||
        next.pageDocument.managedFileStatus === "out-of-sync";
      const saved = preserveSource
        ? writePageMetadataPreservingSource(
            projectPath,
            pagesDir,
            next.pageDocument,
          )
        : writePageDocument(projectPath, pagesDir, next.pageDocument);
      if (!saved.ok) {
        fs.rmSync(to, { force: true });
        deletePageSchema(projectPath, nextRel, pagesDir);
        return { ok: false, error: saved.error };
      }
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function deletePage(
  projectPath: string,
  page: string,
  pagesDir: string,
): OperationResult {
  try {
    const membership = assertPageInsidePagesDir(page, pagesDir);
    if (!membership.ok) return membership;
    const full = resolvePage(projectPath, page);
    if (!fs.existsSync(full)) {
      return { ok: false, error: "Page does not exist." };
    }
    const originalSource = fs.readFileSync(full, "utf8");
    const current = readPageDocument(projectPath, page, pagesDir);
    fs.rmSync(full, { force: true });
    const deleted = deletePageSchema(projectPath, page, pagesDir);
    if (!deleted.ok) {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, originalSource, "utf8");
      return deleted;
    }
    if (current.ok && current.site) {
      const synced = writeSiteDocument(projectPath, current.site, pagesDir);
      if (!synced.ok) {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, originalSource, "utf8");
        // Restore with a sidecar-only write for detached/out-of-sync pages:
        // regenerating via writePageDocument would reattach and rebuild from
        // the stale tree, destroying the hand-authored source just restored.
        if (current.pageDocument) {
          const preserveSource =
            current.pageDocument.detached ||
            current.pageDocument.managedFileStatus === "out-of-sync";
          if (preserveSource) {
            writePageDocumentFile(projectPath, current.pageDocument);
          } else {
            writePageDocument(projectPath, pagesDir, current.pageDocument);
          }
        }
        return synced;
      }
    } else if (current.error) {
      // The read failed (corrupt sidecar/site): the file is already deleted —
      // restore the bytes so the user loses nothing, even though the schema
      // cannot be synced.
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, originalSource, "utf8");
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
