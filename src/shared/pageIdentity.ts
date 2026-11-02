function toSlashPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function normalizePageSlug(input: string): string | null {
  const normalized = input
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.(astro|md|mdx|html)$/i, "");
  if (!normalized) return "index";
  const safe = normalized
    .split("/")
    .map((segment) =>
      segment
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-_]+|[-_]+$/g, ""),
    )
    .filter(Boolean);
  if (safe.length === 0) return null;
  return safe.join("/");
}

export function isNotFoundSlug(slug: string): boolean {
  return slug === "404" || slug.startsWith("404/");
}

function pageRelFromPagesDir(page: string, pagesDir: string): string {
  const normalizedPage = toSlashPath(page).replace(/^\/+/, "");
  const normalizedPagesDir = toSlashPath(pagesDir).replace(/^\/+|\/+$/g, "");
  const prefix = normalizedPagesDir ? `${normalizedPagesDir}/` : "";
  return (
    normalizedPage.startsWith(prefix)
      ? normalizedPage.slice(prefix.length)
      : normalizedPage
  )
    .replace(/\.(astro|md|mdx|html)$/i, "")
    .replace(/\\/g, "/");
}

export function routeFromPage(page: string, pagesDir: string): string {
  const rel = pageRelFromPagesDir(page, pagesDir);
  if (!rel || rel === "index") return "/";
  const trimmed = rel.replace(/\/index$/, "");
  return trimmed ? `/${trimmed}` : "/";
}

export function slugFromPage(page: string, pagesDir: string): string {
  const rel = pageRelFromPagesDir(page, pagesDir);
  if (!rel || rel === "index") return "index";
  return rel;
}

export function routeForSlug(slug: string): string {
  if (!slug || slug === "index") return "/";
  const trimmed = slug.replace(/\/index$/, "");
  return trimmed ? `/${trimmed}` : "/";
}
