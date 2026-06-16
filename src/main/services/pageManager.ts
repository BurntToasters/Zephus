import * as fs from "fs";
import * as path from "path";
import { OperationResult, PageListResult, PageMeta } from "../types";
import { assertRealpathInside, safeResolve } from "./fsSafe";
import {
  createSchemaPage,
  deletePageSchema,
  duplicatePageSchema,
  ensureVisualSchema,
  listPageDocuments,
  normalizePageSlug,
  pagePathFromSlug,
  readPageDocument,
  renamePageSchema,
  routeFromPage,
  writeSiteDocument,
  writePageDocument,
} from "./schema";

/** Resolves a project page path with symlink-aware containment. */
function resolvePage(projectPath: string, relativePath: string): string {
  const full = safeResolve(projectPath, relativePath);
  assertRealpathInside(projectPath, full);
  return full;
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
  };
}

export function listPageMetadata(
  projectPath: string,
  pagesDir: string,
): PageListResult {
  const ensured = ensureVisualSchema(projectPath, pagesDir);
  if (!ensured.ok) {
    return { ok: false, entries: [], error: ensured.error };
  }
  const listed = listPageDocuments(projectPath, pagesDir);
  if (!listed.ok) {
    return { ok: false, entries: [], error: listed.error };
  }
  return {
    ok: true,
    entries: listed.entries.map((doc) => ({
      page: doc.page,
      route: doc.route,
      slug: doc.slug,
      title: doc.title,
      navLabel: doc.navLabel,
      metaDescription: doc.metaDescription,
      navVisible: doc.navVisible,
      isHome: doc.isHome,
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
  const next = {
    ...current.pageDocument,
    title: partial.title ?? current.pageDocument.title,
    navLabel: partial.navLabel ?? current.pageDocument.navLabel,
    metaDescription:
      partial.metaDescription ?? current.pageDocument.metaDescription,
    navVisible: partial.navVisible ?? current.pageDocument.navVisible,
  };
  const saved = writePageDocument(projectPath, pagesDir, next);
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
    const originalSource = fs.readFileSync(from, "utf8");
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    const moved = renamePageSchema(projectPath, pagesDir, page, nextSlug);
    if (!moved.ok) {
      fs.renameSync(to, from);
      return moved;
    }
    if (current.ok && current.pageDocument) {
      const saved = writePageDocument(projectPath, pagesDir, {
        ...current.pageDocument,
        page: nextRel,
        slug: nextSlug,
        route: nextSlug === "index" ? "/" : `/${nextSlug}`,
        isHome: nextSlug === "index",
      });
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
      const saved = writePageDocument(projectPath, pagesDir, next.pageDocument);
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
        writePageDocument(projectPath, pagesDir, current.pageDocument!);
        return synced;
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
