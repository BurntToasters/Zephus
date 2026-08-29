import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import {
  BlockNode,
  BlockStyle,
  DesignTokenSet,
  EditorBlockType,
  ManagedFileStatus,
  NavItem,
  OperationResult,
  PageDocument,
  PageDocumentResult,
  PageMeta,
  SchemaEnsureResult,
  SectionNode,
  ShellConfig,
  SiteDocument,
  SiteDocumentResult,
  VisualSchemaStatus,
} from "../types";
import { detectAstro, listPages } from "./project";
import { readRepoSettings } from "./settings";
import { readJsonSafe, writeFileAtomic } from "./fsSafe";
import { markSelfWritten, pruneSelfWrittenMarkers } from "./watch";
import { escapeAttr, escapeHtml, safeUrl } from "../../shared/renderHelpers";
import { decodeHTML } from "entities";

/** Escapes text for a quoted Astro attribute: HTML-escaping plus `{`/`}` as entities, because Astro evaluates `{...}`… */
export function escapeAstroAttr(value: string): string {
  return escapeAttr(value).replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
}
import {
  renderBlockHtml,
  renderSectionsMarkup,
  type RenderPostEntry,
} from "../../shared/blockRender";
import {
  assertRealpathInside,
  safeResolve as safeResolveString,
} from "./fsSafe";
import {
  resolveProjectRelativeDir,
  toProjectRelativePath,
} from "./projectPaths";

const FRONTMATTER_PATTERN = /^(---\r?\n[\s\S]*?\r?\n---\r?\n?)/;
// Quote-aware tag matcher: a `>` inside a quoted attribute value must not end
// the tag (mirrors DOM parsing used by the renderer).
const TAG_PATTERN_SOURCE = "(?:[^>\"']|\"[^\"]*\"|'[^']*')*>";
const TAG_TOKEN = new RegExp(
  `<!--[\\s\\S]*?-->|<\\/?([A-Za-z][\\w:-]*)\\b${TAG_PATTERN_SOURCE}`,
  "g",
);
const ZEPHUS_SCHEMA_VERSION = 1;
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function safeResolve(projectPath: string, relativePath: string): string {
  const full = safeResolveString(projectPath, relativePath);
  assertRealpathInside(projectPath, full); // reject symlink escapes
  return full;
}

function zephusDir(projectPath: string): string {
  return safeResolve(projectPath, ".zephus");
}

function siteDocumentFile(projectPath: string): string {
  return path.join(zephusDir(projectPath), "site.json");
}

function templatesDir(projectPath: string): string {
  return path.join(zephusDir(projectPath), "templates");
}

function pagesSchemaDir(projectPath: string): string {
  return path.join(zephusDir(projectPath), "pages");
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

export function routeFromPage(page: string, pagesDir: string): string {
  const normalizedPage = toProjectRelativePath(page).replace(/^\/+/, "");
  const normalizedPagesDir = toProjectRelativePath(pagesDir).replace(
    /^\/+|\/+$/g,
    "",
  );
  const prefix = normalizedPagesDir ? `${normalizedPagesDir}/` : "";
  const rel = (
    normalizedPage.startsWith(prefix)
      ? normalizedPage.slice(prefix.length)
      : normalizedPage
  )
    .replace(/\.(astro|md|mdx|html)$/i, "")
    .replace(/\\/g, "/");
  if (!rel || rel === "index") return "/";
  // Nested index routes: Astro serves src/pages/blog/index.astro at /blog,
  // but the raw slug "blog/index" produced nav/canonical/sitemap/RSS hrefs
  // of /blog/index — every one a 404 on the published site.
  const trimmed = rel.replace(/\/index$/, "");
  return trimmed ? `/${trimmed}` : "/";
}

function slugFromPage(page: string, pagesDir: string): string {
  const route = routeFromPage(page, pagesDir);
  return route === "/" ? "index" : route.slice(1);
}

export function pagePathFromSlug(
  pagesDir: string,
  slug: string,
  ext = ".astro",
): string {
  const normalizedPagesDir = toProjectRelativePath(pagesDir).replace(
    /\/+$/g,
    "",
  );
  if (slug === "index")
    return path.posix.join(normalizedPagesDir, `index${ext}`);
  return path.posix.join(normalizedPagesDir, `${slug}${ext}`);
}

function pageSchemaRelativePath(slug: string): string {
  // Resolve the sidecar key from the normalized slug: page files whose names
  // do not round-trip through normalizePageSlug (uppercase letters, spaces)
  // must still map to a stable sidecar instead of throwing "Invalid slug".
  const normalized = normalizePageSlug(slug);
  if (!normalized) {
    throw new Error("Invalid page schema slug.");
  }
  return path.join(
    ".zephus",
    "pages",
    normalized === "index" ? "index.json" : `${normalized}.json`,
  );
}

function pageSchemaFile(projectPath: string, slug: string): string {
  const normalized = normalizePageSlug(slug);
  if (!normalized) {
    throw new Error("Invalid page schema slug.");
  }
  const root = path.resolve(projectPath, ".zephus", "pages");
  const relative = normalized === "index" ? "index.json" : `${normalized}.json`;
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Page schema path escapes .zephus/pages.");
  }
  return resolved;
}

function splitFrontmatter(content: string): {
  frontmatter: string;
  body: string;
} {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match || !match[1]) return { frontmatter: "", body: content };
  return {
    frontmatter: match[1],
    body: content.slice(match[1].length),
  };
}

function parseScalar(value: string): string | boolean {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return JSON.parse(trimmed.replace(/^'/, '"').replace(/'$/, '"'));
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseFrontmatter(
  frontmatter: string,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  if (!frontmatter) return out;
  const lines = frontmatter
    .replace(/^---\r?\n/, "")
    .replace(/\r?\n---\r?\n?$/, "")
    .split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!match || !match[1]) continue;
    out[match[1]] = parseScalar(match[2] ?? "");
  }
  return out;
}

function defaultTitleFromSlug(slug: string): string {
  const last = slug.split("/").filter(Boolean).pop() ?? "index";
  if (last === "index") return "Home";
  return last
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function defaultDesignTokens(): DesignTokenSet {
  return {
    accent: "#4f46e5",
    background: "#ffffff",
    foreground: "#0f172a",
    surface: "#f8fafc",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    headingFontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    radius: "14px",
    shadow: "sm",
    containerWidth: "1080px",
  };
}

function defaultShell(siteName: string, layoutPath: string): ShellConfig {
  return {
    layoutMode: "legacy",
    layoutPath,
    siteTitle: siteName,
    logoText: siteName,
    announcementText: "",
    announcementVisible: false,
    navItems: [],
    navCtaLabel: "",
    navCtaHref: "#",
    footerHtml: `<p>&copy; ${siteName}. Built with Zephus.</p>`,
    customHeadHtml: "",
    customScriptsPath: "public/scripts/zephus-custom.js",
    customCssPath: "public/styles/zephus-custom.css",
  };
}

const MANAGED_STYLE_PATH = path.join("public", "styles", "zephus-managed.css");

function managedAssetWebPath(relativePath: string): string {
  const normalized = relativePath.split(path.sep).join("/").replace(/^\/+/, "");
  const publicPrefix = "public/";
  return `/${normalized.startsWith(publicPrefix) ? normalized.slice(publicPrefix.length) : normalized}`;
}

function resolveManagedInclude(
  projectPath: string,
  relativePath: string,
): string | null {
  if (!relativePath.trim()) return null;
  const target = safeResolve(projectPath, relativePath);
  if (!fs.existsSync(target)) return null;
  return managedAssetWebPath(relativePath);
}

function legacyLayoutBackupPath(layoutFile: string): string {
  const ext = path.extname(layoutFile) || ".astro";
  return layoutFile.slice(0, -ext.length) + `.zephus-legacy-backup${ext}`;
}

function ensureLegacyLayoutBackup(layoutFile: string): void {
  const backupFile = legacyLayoutBackupPath(layoutFile);
  if (fs.existsSync(backupFile) || !fs.existsSync(layoutFile)) return;
  fs.copyFileSync(layoutFile, backupFile);
}

function managedShadowValue(shadow: DesignTokenSet["shadow"]): string {
  switch (shadow) {
    case "sm":
      return "0 8px 20px rgba(15, 23, 42, 0.08)";
    case "md":
      return "0 18px 42px rgba(15, 23, 42, 0.12)";
    case "lg":
      return "0 26px 60px rgba(15, 23, 42, 0.18)";
    case "none":
    default:
      return "none";
  }
}

function renderManagedStyles(site: SiteDocument): string {
  const c = cssValue;
  return `:root {
  --zephus-accent: ${c(site.design.accent)};
  --zephus-background: ${c(site.design.background)};
  --zephus-foreground: ${c(site.design.foreground)};
  --zephus-surface: ${c(site.design.surface)};
  --zephus-radius: ${c(site.design.radius)};
  --zephus-shadow: ${managedShadowValue(site.design.shadow)};
  --zephus-container-width: ${c(site.design.containerWidth)};
  --zephus-font-family: ${c(site.design.fontFamily)};
  --zephus-heading-font: ${c(site.design.headingFontFamily)};
}

html, body {
  margin: 0;
  min-height: 100%;
  background: var(--zephus-background);
  color: var(--zephus-foreground);
}

body {
  font-family: var(--zephus-font-family);
  line-height: 1.6;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--zephus-heading-font);
  color: var(--zephus-foreground);
}

a {
  color: var(--zephus-accent);
}

.zephus-announcement {
  background: var(--zephus-accent);
  color: #ffffff;
  text-align: center;
  padding: 0.7rem 1rem;
  font-size: 0.95rem;
}

.zephus-shell-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.5rem;
  background: color-mix(in srgb, var(--zephus-surface) 92%, white 8%);
  border-bottom: 1px solid color-mix(in srgb, var(--zephus-foreground) 12%, transparent);
  backdrop-filter: blur(10px);
}

.zephus-shell-logo {
  color: var(--zephus-foreground);
  text-decoration: none;
  font-family: var(--zephus-heading-font);
  font-weight: 700;
  font-size: 1.1rem;
}

.zephus-shell-nav {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

/* :where() keeps specificity at zero so a .button-classed nav link keeps
   its pill styling (the plain nav-link color must not override it). */
.zephus-shell-nav a:where(:not(.button)) {
  color: var(--zephus-foreground);
  text-decoration: none;
}

.zephus-shell-nav a:hover {
  color: var(--zephus-accent);
}

.zephus-shell-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.7rem 1rem;
  border-radius: var(--zephus-radius);
  background: var(--zephus-accent);
  color: #ffffff !important;
  text-decoration: none;
  box-shadow: var(--zephus-shadow);
}

.zephus-shell-main {
  width: min(100%, var(--zephus-container-width));
  margin: 0 auto;
  padding: 3rem 1.5rem 4rem;
}

.zephus-shell-footer {
  margin-top: 4rem;
  padding: 2rem 1.5rem 3rem;
  background: var(--zephus-surface);
  border-top: 1px solid color-mix(in srgb, var(--zephus-foreground) 12%, transparent);
}

.zephus-shell-footer > * {
  width: min(100%, var(--zephus-container-width));
  margin: 0 auto;
}

@media (max-width: 820px) {
  .zephus-shell-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .zephus-shell-main {
    padding-inline: 1rem;
  }
}
`;
}

export function mergePageNavItems(
  navItems: NavItem[],
  pageDocs: PageDocument[],
): NavItem[] {
  const existingByPage = new Map<string, NavItem>();
  const customItems: NavItem[] = [];
  // Original ORDER of the surviving items: rebuilding page items in docs
  // (alphabetical) order discarded any reorder the user made in the editor —
  // the nav snapped back on the next sync.
  const order = new Map<string, number>();
  navItems.forEach((item, index) => {
    order.set(item.page || item.href || item.id, index);
    if (item.page) {
      existingByPage.set(item.page, item);
    } else {
      customItems.push(item);
    }
  });

  // A hand-authored custom item that targets a page's route is a deliberate
  // override: it must keep its own label/visibility instead of being deleted
  // (the previous filter dropped it on every site write) or overridden by the
  // page's navVisible flag.
  const customByHref = new Map(
    customItems
      .filter((item) => typeof item.href === "string" && item.href)
      .map((item) => [item.href, item]),
  );
  const pageItems = pageDocs.map((doc) => {
    const override = customByHref.get(doc.route);
    if (override) {
      // Keep the old page item's children (hand-authored subnav) when an
      // override replaces it — previously they vanished silently.
      const existing = existingByPage.get(doc.page);
      return {
        ...override,
        page: doc.page,
        children: override.children ?? existing?.children ?? [],
      };
    }
    const existing = existingByPage.get(doc.page);
    return {
      id: existing?.id ?? `nav-${doc.slug}`,
      label: doc.navLabel,
      href: doc.route,
      page: doc.page,
      visible: doc.navVisible,
      children: existing?.children ?? [],
    };
  });

  const pageHrefs = new Set(pageItems.map((item) => item.href));
  const merged = [
    ...pageItems,
    ...customItems.filter((item) => !pageHrefs.has(item.href)),
  ];
  // Restore the user's original order for items that survived, appending
  // anything new (a page just added) at the end.
  merged.sort((a, b) => {
    const ka = a.page || a.href || a.id;
    const kb = b.page || b.href || b.id;
    const oa = order.get(ka) ?? Number.MAX_SAFE_INTEGER;
    const ob = order.get(kb) ?? Number.MAX_SAFE_INTEGER;
    return oa - ob;
  });
  return merged;
}

export function listExistingPageDocuments(
  projectPath: string,
  pagesDir: string,
): PageDocument[] {
  return listPages(projectPath, pagesDir)
    .map((page) =>
      readPageDocumentFile(projectPath, slugFromPage(page, pagesDir)),
    )
    .filter((entry): entry is PageDocument => Boolean(entry));
}

function renderManagedLayout(
  site: SiteDocument,
  navItems: NavItem[],
  customCssHref: string | null,
  customScriptHref: string | null,
  hasFeed: boolean,
): string {
  const navLinks = navItems
    .filter((item) => item.visible)
    .map(
      (item) =>
        `      <a href="${escapeAttr(safeUrl(item.href) || "#")}">${escapeHtml(item.label)}</a>`,
    )
    .join("\n");
  const cta =
    site.shell.navCtaLabel.trim() && site.shell.navCtaHref.trim()
      ? `\n      <a class="zephus-shell-cta" href="${escapeAttr(
          safeUrl(site.shell.navCtaHref) || "#",
        )}">${escapeHtml(site.shell.navCtaLabel)}</a>`
      : "";
  const announcement =
    site.shell.announcementVisible && site.shell.announcementText.trim()
      ? `  <div class="zephus-announcement">${escapeHtml(
          site.shell.announcementText,
        )}</div>\n`
      : "";
  const customCssLink = customCssHref
    ? `\n    <link rel="stylesheet" href="${escapeAttr(customCssHref)}" />`
    : "";
  const customScriptTag = customScriptHref
    ? `\n    <script type="module" src="${escapeAttr(customScriptHref)}"></script>`
    : "";
  const fontLinks = /^https?:\/\/fonts\.googleapis\.com\//i.test(
    (site.design.fontImportUrl ?? "").trim(),
  )
    ? `    <link rel="preconnect" href="https://fonts.googleapis.com" />\n    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n    <link rel="stylesheet" href="${escapeAttr(
        site.design.fontImportUrl as string,
      )}" />\n`
    : "";

  const faviconHref = safeUrl(site.faviconPath.trim());
  const faviconLink = faviconHref
    ? `\n    <link rel="icon" href="${escapeAttr(faviconHref)}" />`
    : "";
  // Only advertise a feed that the discovery writer confirmed is present.
  const feedHref = resolveAbsoluteHttpUrl(site.siteUrl.trim(), "/rss.xml");
  const feedLink =
    hasFeed && feedHref
      ? `\n    <link rel="alternate" type="application/rss+xml" title="${escapeAttr(
          site.shell.siteTitle || site.siteName,
        )}" href="${escapeAttr(feedHref)}" />`
      : "";

  return `---
interface Props {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  socialImage?: string;
  noindex?: boolean;
}
const siteUrl = ${JSON.stringify(site.siteUrl.trim())};
const siteName = ${JSON.stringify(site.shell.siteTitle || site.siteName)};
const {
  title = siteName,
  description = "",
  canonicalUrl = "",
  socialImage = "",
  noindex = false,
} = Astro.props;
const customHeadHtml = ${JSON.stringify(site.shell.customHeadHtml)};
const footerHtml = ${JSON.stringify(site.shell.footerHtml)};

// Absolute URLs are required by canonical and Open Graph consumers.
const absolute = (value: string): string => {
  if (!value) return "";
  try {
    const absoluteOrProtocolRelative =
      /^[A-Za-z][A-Za-z\\d+.-]*:/.test(value) || value.startsWith("//");
    let resolved: URL;
    if (absoluteOrProtocolRelative) {
      resolved = new URL(value, siteUrl || undefined);
    } else {
      if (!siteUrl) return "";
      const base = new URL(siteUrl);
      base.search = "";
      base.hash = "";
      if (!base.pathname.endsWith("/")) base.pathname += "/";
      resolved = new URL(value.replace(/^\\/+/, ""), base);
    }
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.href
      : "";
  } catch {
    return "";
  }
};
const canonical =
  absolute(canonicalUrl) || absolute(Astro.url.pathname);
const socialImageUrl = absolute(socialImage);
---

<!doctype html>
<html lang=${JSON.stringify(site.language.trim() || "en")}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    {description ? <meta name="description" content={description} /> : null}
    {noindex ? <meta name="robots" content="noindex, nofollow" /> : null}
    {canonical ? <link rel="canonical" href={canonical} /> : null}
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content={siteName} />
    <meta property="og:title" content={title} />
    {description ? <meta property="og:description" content={description} /> : null}
    {canonical ? <meta property="og:url" content={canonical} /> : null}
    {socialImageUrl ? <meta property="og:image" content={socialImageUrl} /> : null}
    <meta name="twitter:card" content={socialImageUrl ? "summary_large_image" : "summary"} />
    <meta name="twitter:title" content={title} />
    {description ? <meta name="twitter:description" content={description} /> : null}
    {socialImageUrl ? <meta name="twitter:image" content={socialImageUrl} /> : null}${faviconLink}${feedLink}
${fontLinks}    <link rel="stylesheet" href="/styles/global.css" />
    <link rel="stylesheet" href="/styles/zephus-managed.css" />
${customCssLink}
    {customHeadHtml ? <Fragment set:html={customHeadHtml} /> : null}
  </head>
  <body>
${announcement}    <header class="zephus-shell-header">
      <a class="zephus-shell-logo" href="/">${escapeHtml(site.shell.logoText || site.siteName)}</a>
      <nav class="zephus-shell-nav">
${navLinks}${cta}
      </nav>
    </header>
    <main class="zephus-shell-main">
      <slot />
    </main>
    <footer class="zephus-shell-footer">
      {footerHtml ? <Fragment set:html={footerHtml} /> : null}
    </footer>${customScriptTag}
  </body>
</html>
`;
}

function readJsonFile<T>(file: string): T | null {
  return readJsonSafe<T>(file).data;
}

/** Reads JSON, distinguishing "absent" from "present but corrupt". */
function readJsonFileChecked<T>(file: string): {
  data: T | null;
  corrupt: boolean;
} {
  return readJsonSafe<T>(file);
}

function writeJsonFile(file: string, value: unknown): void {
  writeFileAtomic(file, JSON.stringify(value, null, 2) + "\n");
}

/** Writes site.json only when the site (ignoring generatedAt) actually
 *  changed — every page save previously bumped generatedAt, churning the
 *  committed file on body-copy-only saves. Returns the site byte-equal to
 *  what is on disk so the renderer's drift check cannot false-positive. */
function writeSiteJsonIfChanged(
  projectPath: string,
  site: SiteDocument,
): SiteDocument {
  const file = siteDocumentFile(projectPath);
  const onDisk = readJsonFile<SiteDocument>(file);
  const key = (value: SiteDocument): string =>
    JSON.stringify({ ...value, generatedAt: "" });
  if (onDisk && key(onDisk) === key(site)) {
    return onDisk;
  }
  const updated: SiteDocument = {
    ...site,
    generatedAt: new Date().toISOString(),
  };
  writeJsonFile(file, updated);
  return updated;
}

/** Writes only when content differs. Opening a project / saving a page used
 *  to rewrite layout, styles, discovery files and site.json unconditionally —
 *  git churn on every open, and O(N) writes per save. */
function writeFileAtomicIfChanged(file: string, content: string): void {
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) {
      return;
    }
  } catch {
    /* unreadable file: fall through and rewrite */
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, content);
}

function pageMetaFromFrontmatter(
  page: string,
  pagesDir: string,
  frontmatter: Record<string, string | boolean>,
): PageMeta {
  const slug = slugFromPage(page, pagesDir);
  const route = routeFromPage(page, pagesDir);
  const fallback = defaultTitleFromSlug(slug);
  return {
    page,
    route,
    slug,
    title:
      typeof frontmatter["title"] === "string" && frontmatter["title"]
        ? frontmatter["title"]
        : fallback,
    navLabel:
      typeof frontmatter["navLabel"] === "string" && frontmatter["navLabel"]
        ? frontmatter["navLabel"]
        : fallback,
    metaDescription:
      typeof frontmatter["metaDescription"] === "string"
        ? frontmatter["metaDescription"]
        : "",
    navVisible: isNotFoundSlug(slug)
      ? false
      : typeof frontmatter["navVisible"] === "boolean"
        ? frontmatter["navVisible"]
        : true,
    isHome: route === "/",
    detached: false,
    socialImage:
      typeof frontmatter["socialImage"] === "string"
        ? frontmatter["socialImage"]
        : "",
    canonicalUrl:
      typeof frontmatter["canonicalUrl"] === "string"
        ? frontmatter["canonicalUrl"]
        : "",
    noindex: isNotFoundSlug(slug) || frontmatter["noindex"] === true,
    publishDate:
      typeof frontmatter["publishDate"] === "string"
        ? frontmatter["publishDate"]
        : "",
    author:
      typeof frontmatter["author"] === "string" ? frontmatter["author"] : "",
  };
}

/**
 * Decodes HTML entities (named, decimal, hex) exactly like the DOM parser:
 * spec-conformant maximal-name matching, legacy no-semicolon references,
 * numeric refs without semicolons, and U+FFFD for invalid code points. Uses
 * the same `entities` decoder that parse5 (and therefore the renderer's DOM
 * parser) uses internally, so both parsers produce byte-identical text.
 * A literal `&amp;copy;` becomes the TEXT `&copy;` (never re-scanned).
 */
function decodeHtmlEntities(value: string): string {
  if (!value.includes("&")) return value;
  return decodeHTML(value);
}

function textFromHtml(html: string): string {
  // Only strip real tags, not arbitrary `<...>` runs: literal text like
  // "2 < 3" must survive (a `<` not followed by a letter, `/`, or `!` is not
  // a tag start). Comments are dropped; <br> becomes a newline. Entities are
  // decoded the same way the DOM parser decodes them.
  let out = "";
  let lastIndex = 0;
  TAG_TOKEN.lastIndex = 0;
  const tokenRe = TAG_TOKEN;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(html))) {
    out += html.slice(lastIndex, match.index);
    if (/^<\/?br\b/i.test(match[0])) out += "\n";
    lastIndex = tokenRe.lastIndex;
  }
  out += html.slice(lastIndex);
  return decodeHtmlEntities(out).trim();
}

function attrValue(html: string, attr: string): string {
  const match = html.match(new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match?.[1] ? decodeHtmlEntities(match[1]) : "";
}

/**
 * Reads a double-quoted attribute value, allowing single quotes inside it.
 * Used for the data-zephus-* attributes, whose URI-encoded JSON payloads can
 * contain literal apostrophes (encodeURIComponent does not encode them), which
 * would truncate the generic attrValue regex.
 */
function dataAttrValue(html: string, attr: string): string {
  const match = html.match(new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "i"));
  return match?.[1] ? decodeHtmlEntities(match[1]) : "";
}

function parseInlineStyle(styleText: string): BlockStyle | undefined {
  if (!styleText.trim()) return undefined;
  const style: BlockStyle = {};
  for (const part of styleText.split(";")) {
    // Split on the first colon only: values like `url(http://…)` contain
    // colons of their own and must not be truncated.
    const separator = part.indexOf(":");
    if (separator < 0) continue;
    const rawKey = part.slice(0, separator);
    const rawValue = part.slice(separator + 1);
    if (!rawKey || !rawValue) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.trim();
    if (!value) continue;
    if (key === "text-align" && /^(left|center|right)$/.test(value)) {
      style.align = value as BlockStyle["align"];
    } else if (key === "width") {
      style.width = value;
    } else if (key === "height") {
      style.height = value;
    } else if (key === "max-width") {
      style.maxWidth = value;
    } else if (key === "background") {
      style.background = value;
    } else if (key === "color") {
      style.color = value;
    } else if (key === "padding") {
      style.padding = value;
    } else if (key === "margin") {
      style.margin = value;
    } else if (key === "border-radius") {
      style.radius = value;
    } else if (key === "gap") {
      style.gap = value;
    }
  }
  return Object.keys(style).length ? style : undefined;
}

/** Returns the opening tag of a segment (e.g. "<h1 ...>"), or the whole string. */
/** Returns the opening tag of a segment (e.g. */
function openingTag(segment: string): string {
  if (!segment.startsWith("<")) return segment;
  let quote: string | null = null;
  for (let i = 1; i < segment.length; i += 1) {
    const char = segment[i] as string;
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return segment.slice(0, i + 1);
    }
  }
  return segment;
}

function parseStoredBlock(segment: string): BlockNode | null {
  // Only inspect the outer opening tag so a wrapper element does not pick up a
  // descendant block's data-zephus-* attributes.
  const tag = openingTag(segment);
  const encodedType = dataAttrValue(tag, "data-zephus-block");
  const encodedProps = dataAttrValue(tag, "data-zephus-props");
  if (!encodedType || !encodedProps) return null;
  try {
    const type = decodeURIComponent(encodedType) as EditorBlockType;
    const props = JSON.parse(decodeURIComponent(encodedProps)) as Record<
      string,
      string
    >;
    const encodedStyle = dataAttrValue(tag, "data-zephus-style");
    const style = encodedStyle
      ? (JSON.parse(decodeURIComponent(encodedStyle)) as BlockStyle)
      : undefined;
    // Preserve the authored id (it anchors responsive CSS selectors) exactly
    // like the DOM parser does.
    const storedId = dataAttrValue(tag, "data-zephus-id").trim();
    return {
      id: storedId || "b" + Math.random().toString(36).slice(2, 9),
      type,
      props,
      style,
      locked: dataAttrValue(tag, "data-zephus-locked") === "true",
      raw: type === "html" ? segment : undefined,
    };
  } catch {
    return null;
  }
}

function splitTopLevelNodes(inner: string): string[] {
  const out: string[] = [];
  let index = 0;
  const tokenRe = TAG_TOKEN;

  while (index < inner.length) {
    while (/\s/.test(inner[index] ?? "")) index += 1;
    if (index >= inner.length) break;

    if (inner.startsWith("<!--", index)) {
      const end = inner.indexOf("-->", index);
      if (end < 0) {
        // Unterminated comment (truncated file, typod "--!>"): keep the rest
        // as content instead of silently dropping everything to EOF.
        out.push(inner.slice(index));
        index = inner.length;
        continue;
      }
      out.push(inner.slice(index, end + 3));
      index = end + 3;
      continue;
    }

    if (inner[index] !== "<") {
      const next = inner.indexOf("<", index);
      const segment = next < 0 ? inner.slice(index) : inner.slice(index, next);
      if (segment.trim()) out.push(segment);
      index = next < 0 ? inner.length : next;
      continue;
    }

    tokenRe.lastIndex = index;
    const first = tokenRe.exec(inner);
    if (!first || first.index !== index) {
      // A "<" that is not a tag or comment start (e.g. "2 < 3" in body
      // text). Emit it as literal text and advance, so the rest of the
      // content is not silently dropped by the parser.
      out.push("<");
      index += 1;
      continue;
    }
    const tagText = first[0];
    const tagName = (first[1] ?? "").toLowerCase();
    // `/>` self-closes here even for container tags: the regex parser cannot
    // replicate DOM tree-building for an unclosed `<div/>` (the DOM opens it
    // and swallows following siblings). Both parsers preserve the content as
    // html blocks either way — only the raw text differs.
    const selfClosing =
      tagText.endsWith("/>") ||
      VOID_TAGS.has(tagName) ||
      tagText.startsWith("</");
    if (selfClosing) {
      out.push(tagText);
      index = tokenRe.lastIndex;
      continue;
    }

    let depth = 1;
    while (depth > 0) {
      const next = tokenRe.exec(inner);
      if (!next) {
        // Unclosed container (e.g. a hand-edited page missing its close
        // tag): keep the remaining markup instead of silently dropping it.
        // The DOM parser leaves the element open and preserves it too.
        out.push(inner.slice(index));
        index = inner.length;
        break;
      }
      const full = next[0];
      const nextTag = (next[1] ?? "").toLowerCase();
      if (full.startsWith("<!--")) continue;
      if (full.startsWith("</")) {
        depth -= 1;
      } else if (!(full.endsWith("/>") || VOID_TAGS.has(nextTag))) {
        depth += 1;
      }
      if (depth === 0) {
        out.push(inner.slice(index, tokenRe.lastIndex));
        index = tokenRe.lastIndex;
      }
    }
  }

  return out.filter((segment) => segment.trim().length > 0);
}

function parseBlockSegment(segment: string): BlockNode {
  const stored = parseStoredBlock(segment);
  if (stored) return stored;

  const tagMatch = segment.match(/^<([A-Za-z][\w:-]*)\b/i);
  const tag = tagMatch?.[1]?.toLowerCase();
  const style = parseInlineStyle(attrValue(segment, "style"));
  const cls = attrValue(segment, "class");
  const id = "b" + Math.random().toString(36).slice(2, 9);

  if (!tag) {
    return { id, type: "html", props: {}, raw: segment };
  }

  if (/^h[1-6]$/.test(tag)) {
    return {
      id,
      type: "heading",
      props: { text: textFromHtml(segment), level: tag[1] ?? "2", cls },
      style,
    };
  }
  if (tag === "p") {
    return {
      id,
      type: "text",
      props: { text: textFromHtml(segment), cls },
      style,
    };
  }
  if (tag === "a") {
    return {
      id,
      type: "button",
      props: {
        text: textFromHtml(segment),
        href: attrValue(segment, "href") || "#",
        cls,
      },
      style,
    };
  }
  if (tag === "img") {
    return {
      id,
      type: "image",
      props: {
        src: attrValue(segment, "src"),
        alt: attrValue(segment, "alt"),
        cls,
      },
      style,
    };
  }
  if (tag === "hr") {
    return { id, type: "divider", props: { cls }, style };
  }
  if (tag === "blockquote") {
    const cite =
      segment.match(
        new RegExp(`<cite\\b${TAG_PATTERN_SOURCE}([\\s\\S]*?)<\\/cite>`, "i"),
      )?.[1] ?? "";
    // Join every paragraph with "\n" (not just the first), matching the
    // renderer's DOM parser.
    const paragraphs = Array.from(
      segment.matchAll(
        new RegExp(`<p\\b${TAG_PATTERN_SOURCE}([\\s\\S]*?)<\\/p>`, "gi"),
      ),
    )
      .map((match) => textFromHtml(match[1] ?? ""))
      .filter(Boolean);
    const text =
      paragraphs.length > 0
        ? paragraphs.join("\n")
        : textFromHtml(segment.replace(/<cite[\s\S]*?<\/cite>/i, ""));
    return {
      id,
      type: "quote",
      props: {
        text,
        cite: textFromHtml(cite),
        cls,
      },
      style,
    };
  }
  if (tag === "ul" || tag === "ol") {
    const items = Array.from(
      segment.matchAll(
        new RegExp(`<li\\b${TAG_PATTERN_SOURCE}([\\s\\S]*?)<\\/li>`, "gi"),
      ),
    )
      .map((match) => textFromHtml(match[1] ?? ""))
      .filter(Boolean)
      .join("\n");
    return {
      id,
      type: "list",
      props: { items, ordered: tag === "ol" ? "true" : "false", cls },
      style,
    };
  }
  if (tag === "iframe") {
    return {
      id,
      type: "embed",
      props: {
        src: attrValue(segment, "src"),
        title: attrValue(segment, "title") || "Embed",
        cls,
      },
      style,
    };
  }

  return { id, type: "html", props: {}, raw: segment };
}

export function extractManagedInner(raw: string): string {
  const { body } = splitFrontmatter(raw);
  // Match the SAME region as the renderer's splitManagedPageSource: the last
  // closing tag (greedy), so a literal "</BaseLayout>" inside an HTML block
  // cannot split the two parsers apart.
  const layoutOpen = body.match(
    new RegExp(`<BaseLayout\\b${TAG_PATTERN_SOURCE}`, "i"),
  );
  if (layoutOpen && layoutOpen.index !== undefined) {
    const openEnd = layoutOpen.index + layoutOpen[0].length;
    // Case-insensitive close so "<BaseLayout>" + "</baseLayout>" still match.
    const closeRegex = /<\/BaseLayout\s*>/gi;
    let lastClose: RegExpExecArray | null = null;
    let closeMatch: RegExpExecArray | null;
    while ((closeMatch = closeRegex.exec(body))) lastClose = closeMatch;
    // Only slice the layout region when it really wraps the whole body:
    // content after the closing tag belongs to the page (hand-authored) and
    // must survive parsing/regeneration — the renderer keeps it too.
    if (
      lastClose &&
      lastClose.index > openEnd &&
      body.slice(lastClose.index + lastClose[0].length).trim().length === 0
    ) {
      return body.slice(openEnd, lastClose.index).trim();
    }
  }

  const bodyMatch = body.match(
    new RegExp(`<body\\b${TAG_PATTERN_SOURCE}([\\s\\S]*?)<\\/body>`, "i"),
  );
  if (bodyMatch?.[1]) return bodyMatch[1].trim();

  return body.trim();
}

export function parseSectionsFromSource(raw: string): SectionNode[] {
  const inner = extractManagedInner(raw);
  const segments = splitTopLevelNodes(inner).filter((segment) => {
    const tag = openingTag(segment);
    return !/^<style\b/i.test(tag);
  });
  const sections: SectionNode[] = [];
  const looseBlocks: BlockNode[] = [];

  for (const segment of segments) {
    const tag = openingTag(segment);
    const tagName = tag.match(/^<([A-Za-z][\w:-]*)/)?.[1]?.toLowerCase();
    const stored = parseStoredBlock(segment);
    if (tagName === "section") {
      // Structural block types such as columns and gallery intentionally use
      // <section> as their outer element. They are blocks, not editable
      // SectionNode wrappers; only a stored type of "section" is a section.
      // Keeping this gate aligned with editorParse.ts preserves those blocks
      // when a page is migrated from source after its sidecar is unavailable.
      if (stored && stored.type !== "section") {
        looseBlocks.push(stored);
        continue;
      }
      if (looseBlocks.length > 0) {
        sections.push(defaultSectionNode(looseBlocks.splice(0)));
      }
      const childInner = segment
        .replace(new RegExp(`^<section\\b${TAG_PATTERN_SOURCE}`, "i"), "")
        .replace(/<\/section>\s*$/i, "");
      if (stored?.type === "section") {
        sections.push({
          id: stored.id,
          type: "section",
          label: stored.props["label"] || `Section ${sections.length + 1}`,
          props: {
            wrapper: stored.props["wrapper"] ?? "none",
            cls: stored.props["cls"] ?? "",
          },
          style: stored.style,
          children: parseBlocksFromInner(childInner),
          locked: stored.locked,
        });
      } else {
        // Legacy <section> wrapper without Zephus metadata: an editable
        // SectionNode, matching the renderer's parseSections so both parsers
        // migrate the same tree. Honor a stored data-zephus-id even when the
        // props payload failed to parse — a fresh id would change bytes on
        // the first save and break the responsive-CSS anchor.
        const storedSectionId = dataAttrValue(tag, "data-zephus-id").trim();
        sections.push({
          id: storedSectionId || "b" + Math.random().toString(36).slice(2, 9),
          type: "section",
          label: `Section ${sections.length + 1}`,
          props: {
            wrapper: "box",
            cls: attrValue(tag, "class"),
          },
          children: parseBlocksFromInner(childInner),
        });
      }
      continue;
    }
    looseBlocks.push(...parseBlocksFromInner(segment));
  }

  if (looseBlocks.length > 0 || sections.length === 0) {
    sections.push(defaultSectionNode(looseBlocks));
  }
  return sections;
}

function parseBlocksFromInner(inner: string): BlockNode[] {
  const segments = splitTopLevelNodes(inner);
  if (segments.length === 0 && inner.trim()) {
    return [
      {
        id: "b" + Math.random().toString(36).slice(2, 9),
        type: "html",
        props: {},
        raw: inner.trim(),
      },
    ];
  }

  const blocks: BlockNode[] = [];
  for (const segment of segments) {
    const tag = openingTag(segment);
    const tagName = tag.match(/^<([A-Za-z][\w:-]*)/)?.[1]?.toLowerCase();
    const isStoredBlock = Boolean(dataAttrValue(tag, "data-zephus-block"));
    // A wrapper <section> (no block marker of its own) that contains stored
    // blocks: recurse so all children are preserved with their types/styles
    // rather than collapsing to the first child or an opaque HTML blob.
    if (
      !isStoredBlock &&
      tagName === "section" &&
      /data-zephus-block=/.test(segment)
    ) {
      const childInner = segment
        .replace(new RegExp(`^<section\\b${TAG_PATTERN_SOURCE}`, "i"), "")
        .replace(/<\/section>\s*$/i, "");
      blocks.push(...parseBlocksFromInner(childInner));
      continue;
    }
    blocks.push(parseBlockSegment(segment));
  }
  return blocks;
}

function normalizeHashText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function hashText(value: string): string {
  return crypto
    .createHash("sha1")
    .update(normalizeHashText(value))
    .digest("hex");
}

function defaultSectionNode(blocks: BlockNode[]): SectionNode {
  return {
    id: "section-main",
    type: "section",
    label: "Main Content",
    props: { wrapper: "none", cls: "" },
    children: blocks,
  };
}

/**
 * Sanitizes a value destined for a CSS declaration. Strips characters that
 * could break out of the declaration/rule (`;{}<>` and newlines) to prevent
 * CSS injection from design-token values in site.json. Caps length.
 * `:` and `@` are preserved: tokens like `var(--accent)` or `calc(...)`
 * are advertised as valid inputs and would be destroyed otherwise.
 */
function cssValue(value: string): string {
  return (value ?? "")
    .replace(/[;{}<>\\]/g, "")
    .replace(/\//g, "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 200);
}

export function renderBlockNode(
  block: BlockNode,
  posts: RenderPostEntry[] = [],
): string {
  return renderBlockHtml(block, {
    posts,
    onUnknownBlockType: (unknownType) => {
      log.warn(
        `renderBlockNode: unknown block type "${unknownType}", preserving as HTML`,
      );
    },
  });
}

function renderSections(
  sections: SectionNode[],
  posts: RenderPostEntry[] = [],
): string {
  return renderSectionsMarkup(sections, (block) =>
    renderBlockNode(block, posts),
  );
}

/** Builds the Post List index from saved page sidecars. */
/**
 * True for an ISO-ish `YYYY-MM-DD` publish date on a real calendar date.
 * Invalid strings must not enter the post index or RSS feed: they would sort
 * lexically and produce feed items with no pubDate.
 */
export function isValidPublishDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function buildPostIndex(docs: PageMeta[]): RenderPostEntry[] {
  return docs.map((doc) => ({
    route: doc.route,
    title: doc.title || doc.navLabel || doc.slug,
    description: doc.metaDescription,
    date: isValidPublishDate(doc.publishDate) ? doc.publishDate.trim() : "",
    author: doc.author,
    image: doc.socialImage,
  }));
}

function pageImportPath(
  projectPath: string,
  pageRel: string,
  layoutRel: string,
): string {
  const layoutAbs = path.join(projectPath, layoutRel);
  const pageAbs = path.join(projectPath, pageRel);
  let importPath = path
    .relative(path.dirname(pageAbs), layoutAbs)
    .split(path.sep)
    .join("/");
  if (!importPath.startsWith(".")) importPath = "./" + importPath;
  return importPath;
}

function buildNavFromPages(pages: PageMeta[]): NavItem[] {
  return pages
    .filter((page) => page.navVisible)
    .map((page) => ({
      id: `nav-${page.slug}`,
      label: page.navLabel,
      href: page.route,
      page: page.page,
      visible: true,
      children: [],
    }));
}

/** Marker identifying files Zephus generates, so user-authored ones are kept. */
const MANAGED_FILE_MARKER = "zephus:managed";

function hasManagedPublicFileHeader(
  fileName: string,
  content: string,
): boolean {
  // Git may check generated files out with CRLF; normalize only line endings,
  // then still require the exact file-specific header at byte zero.
  const normalized = content.replace(/\r\n/g, "\n");
  if (fileName === "robots.txt") {
    return normalized.startsWith(`# ${MANAGED_FILE_MARKER} robots\n`);
  }
  if (fileName === "sitemap.xml") {
    return normalized.startsWith(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${MANAGED_FILE_MARKER} sitemap -->\n`,
    );
  }
  if (fileName === "rss.xml") {
    return normalized.startsWith(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${MANAGED_FILE_MARKER} rss -->\n`,
    );
  }
  return false;
}

/**
 * Writes a Zephus-managed file only when it is safe to do so: the file must be
 * absent, or already carry the managed marker. A hand-authored sitemap.xml or
 * robots.txt is never overwritten.
 */
function writeManagedPublicFile(
  publicRoot: string,
  fileName: string,
  content: string,
): boolean {
  const target = path.join(publicRoot, fileName);
  if (fs.existsSync(target)) {
    let existing: string;
    try {
      existing = fs.readFileSync(target, "utf8");
    } catch {
      return false;
    }
    // Existing user-authored discovery files count as available but are never
    // replaced. This lets users supply their own feed intentionally.
    if (!hasManagedPublicFileHeader(fileName, existing)) return true;
    if (existing === content) return true;
  }
  fs.mkdirSync(publicRoot, { recursive: true });
  writeFileAtomic(target, content);
  return true;
}

/** Removes a stale discovery file only when Zephus previously generated it. */
function removeManagedPublicFile(publicRoot: string, fileName: string): void {
  const target = path.join(publicRoot, fileName);
  if (!fs.existsSync(target)) return;
  try {
    const existing = fs.readFileSync(target, "utf8");
    if (hasManagedPublicFileHeader(fileName, existing)) {
      fs.rmSync(target, { force: true });
    }
  } catch {
    // A discovery enhancement must never block ordinary page editing.
  }
}

/** Resolves discovery metadata against the configured deployment base. */
export function resolveAbsoluteHttpUrl(siteUrl: string, value: string): string {
  if (!value.trim()) return "";
  try {
    const base = new URL(siteUrl);
    if (base.protocol !== "http:" && base.protocol !== "https:") return "";
    base.search = "";
    base.hash = "";
    if (!base.pathname.endsWith("/")) base.pathname += "/";

    // A scheme-less canonical/social value shaped like a host ("example.com/x")
    // resolved as a RELATIVE path — sitemap loc, RSS link and canonical all
    // became https://site/example.com/x (a guaranteed 404). Treat bare
    // host-shaped values as absolute https URLs.
    const trimmed = value.trim();
    const hasScheme = /^[A-Za-z][A-Za-z\d+.-]*:/.test(trimmed);
    const isProtocolRelative = trimmed.startsWith("//");
    const isHostShaped =
      !hasScheme &&
      !isProtocolRelative &&
      !trimmed.startsWith("/") &&
      /^[^/\s]+\.[a-z]{2,}([/?#]|$)/i.test(trimmed);
    const effectiveValue = isHostShaped ? `https://${trimmed}` : trimmed;

    const absoluteOrProtocolRelative =
      /^[A-Za-z][A-Za-z\d+.-]*:/.test(effectiveValue) ||
      effectiveValue.startsWith("//");
    // "/x" is ROOT-relative: it must resolve against the origin, never the
    // siteUrl's path base ("/blog/") — otherwise every sitemap/RSS/canonical
    // href gained a bogus base prefix while the published site kept serving
    // the root path.
    const resolved = absoluteOrProtocolRelative
      ? new URL(effectiveValue, base)
      : new URL(
          effectiveValue.startsWith("/")
            ? effectiveValue
            : effectiveValue.replace(/^\/+/, ""),
          effectiveValue.startsWith("/") ? base.origin : base,
        );
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.href
      : "";
  } catch {
    return "";
  }
}

/** Astro serves `src/pages/404.astro` as the not-found response. */
export function isNotFoundSlug(slug: string): boolean {
  // Nested 404 routes (src/pages/404/index.astro) are reserved too.
  return slug === "404" || slug.startsWith("404/");
}

function renderSitemap(siteUrl: string, docs: PageDocument[]): string {
  const entries = docs
    // An error page must never be advertised, even if its noindex flag was
    // cleared by hand.
    .filter((doc) => !doc.noindex && !isNotFoundSlug(doc.slug))
    .flatMap((doc) => {
      const loc =
        resolveAbsoluteHttpUrl(siteUrl, doc.canonicalUrl.trim()) ||
        resolveAbsoluteHttpUrl(siteUrl, doc.route);
      return loc
        ? [`  <url>\n    <loc>${escapeHtml(loc)}</loc>\n  </url>`]
        : [];
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${MANAGED_FILE_MARKER} sitemap -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

/** True when a page contains a Post List block anywhere in its section tree. */
function hasPostListBlock(doc: PageDocument): boolean {
  const scan = (nodes: Array<BlockNode | SectionNode>): boolean =>
    nodes.some((node) => {
      if (node.type === "postlist") return true;
      const children = (node as SectionNode).children;
      return Array.isArray(children) ? scan(children) : false;
    });
  return scan(doc.sections);
}

/**
 * Regenerates pages whose Post List content depends on other pages.
 *
 * Post lists are rendered into the page at generation time, so adding, dating,
 * renaming, or deleting a post would otherwise leave every listing page stale
 * until the next build. Only pages that are provably unmodified on disk are
 * rewritten; hand-edited ones are left alone.
 */
function refreshPostListPages(
  projectPath: string,
  pagesDir: string,
  site: SiteDocument,
  skipPage?: string,
): void {
  try {
    const docs = listExistingPageDocuments(projectPath, pagesDir);
    const posts = buildPostIndex(docs);
    // Precompute every regeneration before writing anything, so a failure
    // midway cannot leave some pages refreshed and others stale with no
    // retry marker.
    const pending: Array<{ file: string; doc: PageDocument; html: string }> =
      [];
    for (const doc of docs) {
      if (doc.detached || doc.page === skipPage) continue;
      if (!hasPostListBlock(doc)) continue;
      const pageFile = safeResolve(projectPath, doc.page);
      if (!fs.existsSync(pageFile)) continue;
      const actual = fs.readFileSync(pageFile, "utf8");
      // Only touch files Zephus generated and the user has not edited.
      if (!doc.generatedHash || hashText(actual) !== doc.generatedHash)
        continue;
      const generated = renderAstroPage(
        projectPath,
        doc.page,
        site,
        doc,
        posts,
      );
      if (normalizeHashText(generated) === normalizeHashText(actual)) continue;
      pending.push({ file: pageFile, doc, html: generated });
    }
    for (const { file, doc, html } of pending) {
      writeFileAtomic(file, html);
      // A post-list refresh regenerates OTHER pages: suppress the watcher so
      // the open page does not get a false "modified outside Zephus" prompt.
      markSelfWritten(doc.page);
      writePageDocumentFile(projectPath, {
        ...doc,
        generatedHash: hashText(html),
      });
    }
  } catch (error) {
    log.warn("Could not refresh post list pages", error);
  }
}

/** Pages that count as blog posts for the feed: dated, indexable, not the 404. */
function feedPosts(docs: PageDocument[]): PageDocument[] {
  return docs
    .filter(
      (doc) =>
        isValidPublishDate(doc.publishDate) &&
        !doc.noindex &&
        !isNotFoundSlug(doc.slug),
    )
    .sort((a, b) => (a.publishDate < b.publishDate ? 1 : -1));
}

/** RFC 822 date, which is what RSS readers expect. */
function rssDate(value: string): string {
  const parsed = new Date(`${value.trim()}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toUTCString();
}

/** XML-1.0-safe escaping: like escapeHtml plus stripping of C0 control
 *  characters XML forbids (pasted Word/terminal text carries them; a raw
 *  \u0000- would make the whole feed invalid for every reader). */
function escapeXml(value: string): string {
  // C0 controls stripped individually (no-control-regex).
  let cleaned = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (
      code === 0 ||
      code === 1 ||
      code === 2 ||
      code === 3 ||
      code === 4 ||
      code === 5 ||
      code === 6 ||
      code === 7 ||
      code === 8 ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31)
    ) {
      continue;
    }
    cleaned += char;
  }
  return escapeHtml(cleaned);
}

export function renderRssFeed(
  siteUrl: string,
  site: SiteDocument,
  docs: PageDocument[],
): string {
  const base = resolveAbsoluteHttpUrl(siteUrl, "/");
  const feedUrl = resolveAbsoluteHttpUrl(siteUrl, "/rss.xml");
  const title = site.shell.siteTitle || site.siteName;
  const items = feedPosts(docs)
    .map((doc) => {
      const link =
        resolveAbsoluteHttpUrl(siteUrl, doc.canonicalUrl.trim()) ||
        resolveAbsoluteHttpUrl(siteUrl, doc.route);
      const pubDate = rssDate(doc.publishDate);
      return [
        "    <item>",
        `      <title>${escapeXml(doc.title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        doc.metaDescription
          ? `      <description>${escapeXml(doc.metaDescription)}</description>`
          : "",
        pubDate ? `      <pubDate>${escapeXml(pubDate)}</pubDate>` : "",
        doc.author
          ? `      <dc:creator>${escapeXml(doc.author)}</dc:creator>`
          : "",
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${MANAGED_FILE_MARKER} rss -->\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">\n  <channel>\n    <title>${escapeHtml(
    title,
  )}</title>\n    <link>${escapeHtml(base)}</link>\n    <description>${escapeHtml(
    site.shell.announcementText.trim() || `Updates from ${title}`,
  )}</description>\n    <language>${escapeHtml(site.language.trim() || "en")}</language>\n    <atom:link href="${escapeHtml(
    feedUrl,
  )}" rel="self" type="application/rss+xml" />\n${items}\n  </channel>\n</rss>\n`;
}

function renderRobotsTxt(siteUrl: string): string {
  const sitemapUrl = resolveAbsoluteHttpUrl(siteUrl, "/sitemap.xml");
  return `# ${MANAGED_FILE_MARKER} robots\nUser-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`;
}

/**
 * Generates sitemap.xml + robots.txt into the project's public directory.
 * Both require a configured site URL: without an absolute base, a sitemap
 * cannot contain valid `<loc>` values, so nothing is written.
 */
function writeDiscoveryFiles(
  projectPath: string,
  publicDir: string,
  site: SiteDocument,
  docs: PageDocument[],
): boolean {
  try {
    const publicRoot = resolveProjectRelativeDir(
      projectPath,
      publicDir,
      "public",
    ).absolute;
    const siteUrl = resolveAbsoluteHttpUrl(site.siteUrl.trim(), "/");
    if (!siteUrl) {
      removeManagedPublicFile(publicRoot, "sitemap.xml");
      removeManagedPublicFile(publicRoot, "robots.txt");
      removeManagedPublicFile(publicRoot, "rss.xml");
      return false;
    }

    writeManagedPublicFile(
      publicRoot,
      "sitemap.xml",
      renderSitemap(siteUrl, docs),
    );
    writeManagedPublicFile(publicRoot, "robots.txt", renderRobotsTxt(siteUrl));
    // Only publish and advertise a feed once there is an eligible dated post.
    if (feedPosts(docs).length > 0) {
      return writeManagedPublicFile(
        publicRoot,
        "rss.xml",
        renderRssFeed(siteUrl, site, docs),
      );
    }

    removeManagedPublicFile(publicRoot, "rss.xml");
    return false;
  } catch (error) {
    // Discovery files are an enhancement; never fail schema generation for them.
    log.warn("Could not write sitemap/robots/feed", error);
    return false;
  }
}

function defaultSiteDocument(
  projectPath: string,
  layoutPath: string,
  themeId: string,
): SiteDocument {
  const siteName = path.basename(projectPath);
  return {
    schemaVersion: ZEPHUS_SCHEMA_VERSION,
    themeId,
    siteName,
    generatedAt: new Date().toISOString(),
    design: defaultDesignTokens(),
    shell: defaultShell(siteName, layoutPath),
    siteUrl: "",
    language: "en",
    faviconPath: "",
  };
}

/**
 * Fills in SEO fields added after a project was scaffolded. Projects created by
 * older versions have no `siteUrl`/`language`/`faviconPath`, and reading them
 * as `undefined` would emit `lang="undefined"` into the managed layout.
 */
function withSiteDefaults(site: SiteDocument): SiteDocument {
  const siteName = site.siteName || "Site";
  // A site.json missing design/shell (ancient, hand-edited, or partially
  // corrupted shape) must not crash downstream code (syncSiteShellOutputs
  // reads site.shell.navItems, renderManagedStyles reads site.design.accent).
  const design =
    site.design && typeof site.design === "object"
      ? { ...defaultDesignTokens(), ...site.design }
      : defaultDesignTokens();
  const shell =
    site.shell && typeof site.shell === "object"
      ? { ...defaultShell(siteName, ""), ...site.shell }
      : defaultShell(siteName, "");
  // A hand-edited site.json with non-string nav fields used to THROW in
  // renderManagedLayout (label.trim()/safeUrl) and refuse the whole project.
  if (Array.isArray(shell.navItems)) {
    const sanitized: NavItem[] = [];
    for (const item of shell.navItems) {
      if (typeof item !== "object" || item === null) continue;
      sanitized.push({
        ...item,
        id:
          typeof item.id === "string"
            ? item.id
            : `nav-${Math.random().toString(36).slice(2, 8)}`,
        label: typeof item.label === "string" ? item.label : "",
        href: typeof item.href === "string" ? item.href : "#",
        visible: item.visible !== false,
        page: typeof item.page === "string" ? item.page : undefined,
        children: Array.isArray(item.children) ? item.children : [],
      });
    }
    shell.navItems = sanitized;
  }
  if (typeof shell.siteTitle !== "string") shell.siteTitle = siteName;
  if (typeof shell.logoText !== "string") shell.logoText = siteName;
  if (typeof shell.announcementText !== "string") shell.announcementText = "";
  if (typeof shell.navCtaLabel !== "string") shell.navCtaLabel = "";
  if (typeof shell.navCtaHref !== "string") shell.navCtaHref = "#";
  if (typeof shell.footerHtml !== "string") shell.footerHtml = "";
  if (typeof shell.customHeadHtml !== "string") shell.customHeadHtml = "";
  return {
    ...site,
    schemaVersion: site.schemaVersion ?? ZEPHUS_SCHEMA_VERSION,
    themeId: site.themeId ?? "project",
    siteName,
    design,
    shell,
    siteUrl: typeof site.siteUrl === "string" ? site.siteUrl : "",
    language:
      typeof site.language === "string" && site.language.trim()
        ? site.language
        : "en",
    faviconPath: typeof site.faviconPath === "string" ? site.faviconPath : "",
  };
}

/** Fills in per-page SEO fields added after a page sidecar was written. */
function withPageMetaDefaults<T extends PageMeta>(doc: T): T {
  const reservedNotFound = isNotFoundSlug(doc.slug);
  return {
    ...doc,
    // Sidecars predating the field have `navVisible: undefined` — treat that
    // as the default (visible), matching the frontmatter path, or the page
    // silently vanishes from the generated navigation after an upgrade.
    navVisible: reservedNotFound ? false : doc.navVisible !== false,
    socialImage: typeof doc.socialImage === "string" ? doc.socialImage : "",
    canonicalUrl: typeof doc.canonicalUrl === "string" ? doc.canonicalUrl : "",
    noindex: reservedNotFound || doc.noindex === true,
    publishDate: typeof doc.publishDate === "string" ? doc.publishDate : "",
    author: typeof doc.author === "string" ? doc.author : "",
  };
}

function readPageDocumentFile(
  projectPath: string,
  slug: string,
): PageDocument | null {
  const doc = readJsonFile<PageDocument>(pageSchemaFile(projectPath, slug));
  if (!doc) return null;
  // Shape guard: a corrupt-but-valid-JSON sidecar (hand-edited or truncated
  // with `sections` missing/non-array) used to throw inside renderAstroPage
  // during ensureVisualSchema — the WHOLE project refused to open and every
  // subsequent read/save failed the same way, with no gate catching it.
  if (!Array.isArray(doc.sections)) {
    log.warn(
      "Page sidecar for",
      slug,
      "has a malformed sections array; defaulting to empty.",
    );
    doc.sections = [];
  }
  return withPageMetaDefaults({
    ...doc,
    page: toProjectRelativePath(doc.page),
  });
}

export function writePageDocumentFile(
  projectPath: string,
  doc: PageDocument,
): void {
  writeJsonFile(pageSchemaFile(projectPath, doc.slug), doc);
}

function renderAstroPage(
  projectPath: string,
  pageRel: string,
  site: SiteDocument,
  doc: PageDocument,
  posts: RenderPostEntry[] = [],
): string {
  const title = doc.title || defaultTitleFromSlug(doc.slug);
  const seoAttrs = [
    doc.metaDescription
      ? `description="${escapeAstroAttr(doc.metaDescription)}"`
      : "",
    doc.canonicalUrl
      ? `canonicalUrl="${escapeAstroAttr(safeUrl(doc.canonicalUrl) || "")}"`
      : "",
    doc.socialImage
      ? `socialImage="${escapeAstroAttr(safeUrl(doc.socialImage) || "")}"`
      : "",
    // Must be an expression, not a bare attribute: Astro serializes `noindex`
    // to the empty string, which is falsy in the layout's default destructuring.
    doc.noindex ? `noindex={true}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const layoutAttrs = seoAttrs ? ` ${seoAttrs}` : "";
  const body = renderSections(doc.sections, posts)
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n")
    // Restore real newlines inside html-block raws AFTER the indent (same
    // sentinel the shared renderer emits) so interior lines never grow.
    .replace(/\uE000/g, "\n");
  const importPath = pageImportPath(
    projectPath,
    pageRel,
    site.shell.layoutPath,
  );
  const schemaRel = pageSchemaRelativePath(doc.slug).split(path.sep).join("/");
  // The import MUST live inside the frontmatter fence (Astro component script);
  // the schema marker is a JS comment so it is ignored by the frontmatter
  // metadata parser. Page metadata lives authoritatively in the JSON sidecar.
  // The import path is JSON-escaped (handles quotes/backslashes in project
  // paths), and attribute text is brace-escaped — Astro evaluates `{...}`
  // inside quoted attributes, so a literal brace in a title/description would
  // otherwise become a JS expression or crash the build.
  return `---
import BaseLayout from ${JSON.stringify(importPath)};
// zephus:managed schema=${schemaRel}
---

<BaseLayout title="${escapeAstroAttr(title)}"${layoutAttrs}>
${body}
</BaseLayout>
`;
}

function syncLegacyLayoutNav(
  projectPath: string,
  site: SiteDocument,
  pagesDir: string,
): void {
  const layoutFile = safeResolve(projectPath, site.shell.layoutPath);
  if (!fs.existsSync(layoutFile)) return;
  const pageDocs = listPages(projectPath, pagesDir)
    .map((page) =>
      readPageDocumentFile(projectPath, slugFromPage(page, pagesDir)),
    )
    .filter((entry): entry is PageDocument => Boolean(entry));
  const navItems =
    site.shell.navItems.filter((item) => item.visible).length > 0
      ? site.shell.navItems.filter((item) => item.visible)
      : buildNavFromPages(pageDocs);
  const links = navItems
    .map(
      (item) =>
        // safeUrl before escapeAttr: a javascript: nav href must not reach
        // the layout (matches renderManagedLayout).
        `        <a href="${escapeAttr(safeUrl(item.href) || "#")}">${escapeHtml(item.label)}</a>`,
    )
    .join("\n");
  const navBlock = `<nav>\n${links}\n      </nav>`;
  const content = fs.readFileSync(layoutFile, "utf8");
  // Find the outer <nav>…</nav> by depth counting (a layout with nested navs
  // must not be truncated at the first closing tag) and replace only that
  // region, leaving everything else untouched.
  const navOpen = content.search(
    new RegExp(`<nav\\b${TAG_PATTERN_SOURCE}`, "i"),
  );
  if (navOpen < 0) return;
  // Depth counting from AFTER the opener: starting at 1 and re-counting the
  // opener (depth 2) meant every balanced nav exited with depth 1 and the
  // replacement NEVER fired — legacy-layout nav labels/visibility/CTAs were
  // permanently stale (the function was a complete no-op).
  let depth = 0;
  let index = navOpen;
  const depthRe = new RegExp(`<\\/?nav\\b${TAG_PATTERN_SOURCE}`, "gi");
  depthRe.lastIndex = navOpen;
  let match: RegExpExecArray | null;
  while (depth >= 0 && (match = depthRe.exec(content))) {
    if (match[0].startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) {
      index = depthRe.lastIndex;
      break;
    }
  }
  if (depth !== 0) return;
  const updated = content.slice(0, navOpen) + navBlock + content.slice(index);
  // No-op short-circuit: opening a legacy-layout project rewrote this file on
  // EVERY open (mtime churn, git noise). Only write when the nav differs.
  if (updated === content) return;
  writeFileAtomic(layoutFile, updated);
}

function syncSiteShellOutputs(
  projectPath: string,
  site: SiteDocument,
  pagesDir: string,
  pageDocs?: PageDocument[],
  previousSite?: SiteDocument | null,
): SiteDocument {
  const docs = pageDocs ?? listExistingPageDocuments(projectPath, pagesDir);
  const astro = detectAstro(projectPath);
  // Write discovery files first so the managed layout advertises only a feed
  // that is confirmed to exist (including a preserved hand-authored feed).
  const hasFeed = writeDiscoveryFiles(projectPath, astro.publicDir, site, docs);
  site.shell.navItems = mergePageNavItems(site.shell.navItems, docs);

  if (site.shell.layoutMode === "managed") {
    const layoutFile = safeResolve(projectPath, site.shell.layoutPath);
    if (previousSite?.shell.layoutMode !== "managed") {
      ensureLegacyLayoutBackup(layoutFile);
    }
    const customCssHref = resolveManagedInclude(
      projectPath,
      site.shell.customCssPath,
    );
    const customScriptHref = resolveManagedInclude(
      projectPath,
      site.shell.customScriptsPath,
    );
    fs.mkdirSync(path.dirname(layoutFile), { recursive: true });
    writeFileAtomicIfChanged(
      layoutFile,
      renderManagedLayout(
        site,
        site.shell.navItems,
        customCssHref,
        customScriptHref,
        hasFeed,
      ),
    );
    const styleFile = safeResolve(projectPath, MANAGED_STYLE_PATH);
    fs.mkdirSync(path.dirname(styleFile), { recursive: true });
    writeFileAtomicIfChanged(styleFile, renderManagedStyles(site));
  } else {
    syncLegacyLayoutNav(projectPath, site, pagesDir);
  }

  return site;
}

function buildPageDocumentWithSections(
  page: string,
  pagesDir: string,
  sections: SectionNode[],
  frontmatter: Record<string, string | boolean>,
): PageDocument {
  const meta = pageMetaFromFrontmatter(page, pagesDir, frontmatter);
  return {
    ...meta,
    schemaVersion: ZEPHUS_SCHEMA_VERSION,
    sections,
    detached: false,
    detachedAt: null,
    generatedHash: null,
    managedFileStatus: "managed",
  };
}

function migratePageToDocument(
  projectPath: string,
  page: string,
  pagesDir: string,
): PageDocument {
  const raw = fs.readFileSync(safeResolve(projectPath, page), "utf8");
  const { frontmatter } = splitFrontmatter(raw);
  const parsedFrontmatter = parseFrontmatter(frontmatter);
  const doc = buildPageDocumentWithSections(
    page,
    pagesDir,
    parseSectionsFromSource(raw),
    parsedFrontmatter,
  );
  // Non-.astro files (legacy .md/.mdx/.html pages) can never be regenerated:
  // writing Astro-component source (BaseLayout import, <section> markup) into
  // a .md/.mdx/.html file corrupts it in place — the file keeps its old
  // extension while its content becomes invalid for that format. They are
  // always reported as hand-authored (out-of-sync), never just-migrated.
  if (path.extname(page).toLowerCase() !== ".astro") {
    return { ...doc, managedFileStatus: "out-of-sync" };
  }
  // A page that parses as canonical Zephus output (BaseLayout import only,
  // no Astro expressions/script/style blocks) round-trips losslessly and may
  // be regenerated from its tree. Anything else is hand-authored: the parse
  // tree cannot represent imports, consts, expressions, or style blocks, and
  // materializing it would destroy the user's file. Such pages are kept
  // untouched and reported as out-of-sync instead.
  if (!isCanonicalManagedSource(raw)) {
    return { ...doc, managedFileStatus: "out-of-sync" };
  }
  return doc;
}

/**
 * True when the page source looks like canonical Zephus output that can be
 * regenerated losslessly: frontmatter limited to the BaseLayout import,
 * key/value metadata (legacy Zephus pages store title/navLabel etc. there),
 * and comments — and no Astro `{...}` expressions, <script>, or <style>.
 */
function isCanonicalManagedSource(raw: string): boolean {
  const { frontmatter, body } = splitFrontmatter(raw);
  for (const line of frontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "---") continue;
    if (trimmed.startsWith("//")) continue;
    if (/^[A-Za-z][\w-]*\s*:/.test(trimmed)) continue;
    if (
      /^import\s+(?:[^'"\n]*?\s+from\s+)?['"][^'"]*BaseLayout[^'"]*['"]/i.test(
        trimmed,
      )
    ) {
      continue;
    }
    return false;
  }
  if (/<style\b|<script\b/i.test(body)) return false;
  if (/\{[^{}\n]*\}/.test(body)) return false;
  return true;
}

export function getVisualSchemaStatus(
  projectPath: string,
  pagesDir: string,
): VisualSchemaStatus {
  const siteFile = siteDocumentFile(projectPath);
  if (!fs.existsSync(siteFile)) {
    return {
      exists: false,
      integrity: "legacy",
      detachedPages: [],
      pageDocumentCount: 0,
    };
  }
  const site = readJsonFile<SiteDocument>(siteFile);
  if (!site || site.schemaVersion !== ZEPHUS_SCHEMA_VERSION) {
    return {
      exists: true,
      integrity: "invalid",
      detachedPages: [],
      pageDocumentCount: 0,
    };
  }
  const pages = listPages(projectPath, pagesDir);
  const detachedPages: string[] = [];
  let pageDocumentCount = 0;
  for (const page of pages) {
    const slug = slugFromPage(page, pagesDir);
    const doc = readPageDocumentFile(projectPath, slug);
    if (!doc) {
      return {
        exists: true,
        integrity: "invalid",
        detachedPages,
        pageDocumentCount,
      };
    }
    pageDocumentCount += 1;
    if (doc.detached) detachedPages.push(page);
  }
  return {
    exists: true,
    integrity: "ready",
    detachedPages,
    pageDocumentCount,
  };
}

export interface EnsureVisualSchemaOptions {
  /**
   * Regenerate managed `.astro` pages that are unmodified on disk but stale
   * relative to their sidecar (or to a newer generator). Off by default so
   * opening a project never rewrites the user's files.
   */
  refreshManagedPages?: boolean;
  /**
   * Regenerate pages whose sidecar has no stored hash, whatever the disk
   * content is. Used by site creation right after scaffolding: the on-disk
   * files are the scaffold's placeholders, not user work, and must become
   * the real generated pages before the first open.
   */
  regenerateHashlessPages?: boolean;
}

export function ensureVisualSchema(
  projectPath: string,
  pagesDir: string,
  themeId?: string,
  options?: EnsureVisualSchemaOptions,
): SchemaEnsureResult {
  try {
    const astro = detectAstro(projectPath);
    const layoutPath = path.posix.join(
      astro.srcDir,
      "layouts",
      "BaseLayout.astro",
    );
    const repoSettings = readRepoSettings(projectPath) as unknown as Record<
      string,
      unknown
    >;
    const nextThemeId =
      themeId ??
      (typeof repoSettings["theme"] === "string"
        ? repoSettings["theme"]
        : "project");

    fs.mkdirSync(pagesSchemaDir(projectPath), { recursive: true });
    fs.mkdirSync(templatesDir(projectPath), { recursive: true });

    // Single read that distinguishes genuinely-absent (first run) from
    // corrupt-on-disk. A corrupt site.json is backed up by readJsonSafe; do
    // NOT regenerate defaults over it — that would destroy the user's saved
    // design/shell.
    const siteCheck = readJsonFileChecked<SiteDocument>(
      siteDocumentFile(projectPath),
    );
    if (siteCheck.corrupt) {
      return {
        ok: false,
        status: null,
        error:
          "Zephus site config (.zephus/site.json) is corrupt. A backup was " +
          "saved next to it. Restore it from version control to continue.",
      };
    }
    // Never downgrade: a project created by a NEWER Zephus (higher
    // schemaVersion) must not be read, re-merged, and rewritten by this older
    // build — that silently overwrites the newer layout/nav/design with this
    // version's markup and stamps the older schemaVersion onto the pages.
    if (
      siteCheck.data &&
      typeof (siteCheck.data as SiteDocument).schemaVersion === "number" &&
      (siteCheck.data as SiteDocument).schemaVersion! > ZEPHUS_SCHEMA_VERSION
    ) {
      return {
        ok: false,
        status: null,
        error:
          "This project was created with a newer version of Zephus " +
          `(schema v${(siteCheck.data as SiteDocument).schemaVersion}). ` +
          "Please update Zephus to open it — this build would overwrite " +
          "newer data.",
      };
    }
    const site = siteCheck.data
      ? withSiteDefaults(siteCheck.data)
      : defaultSiteDocument(projectPath, layoutPath, nextThemeId);
    // A partial/hand-edited site.json may carry an empty or missing
    // layoutPath; the shell defaults cannot know the project layout, so fill
    // it from the detected layout here (an empty layoutPath made
    // syncLegacyLayoutNav read a directory and fail the whole open).
    if (!site.shell?.layoutPath) {
      site.shell.layoutPath = layoutPath;
    }

    const pages = listPages(projectPath, pagesDir);
    const justMigratedSlugs = new Set<string>();
    const pageDocs = pages.map((page) => {
      const slug = slugFromPage(page, pagesDir);
      let doc = readPageDocumentFile(projectPath, slug);
      if (!doc) {
        doc = migratePageToDocument(projectPath, page, pagesDir);
        writePageDocumentFile(projectPath, doc);
        // Only losslessly-round-trippable pages may be regenerated from their
        // tree. Hand-authored pages (imports/expressions/style blocks) are
        // flagged out-of-sync by migratePageToDocument; writing them back
        // would destroy content, so they are never marked just-migrated.
        if (doc.managedFileStatus !== "out-of-sync") {
          justMigratedSlugs.add(slug);
        }
      }
      return doc;
    });

    syncSiteShellOutputs(projectPath, site, pagesDir, pageDocs, site);
    // Skip the site.json rewrite (and its generatedAt bump → git churn on
    // every open) when nothing about the site actually changed.
    const previousDefaults = siteCheck.data
      ? withSiteDefaults(siteCheck.data)
      : null;
    const siteChanged =
      !previousDefaults ||
      JSON.stringify({ ...site, generatedAt: "" }) !==
        JSON.stringify({ ...previousDefaults, generatedAt: "" });
    if (siteChanged) {
      site.generatedAt = new Date().toISOString();
      writeJsonFile(siteDocumentFile(projectPath), site);
    } else {
      site.generatedAt = previousDefaults?.generatedAt ?? site.generatedAt;
    }
    const postIndex = buildPostIndex(pageDocs);
    for (const doc of pageDocs) {
      if (doc.detached) continue;
      const generatedSource = renderAstroPage(
        projectPath,
        doc.page,
        site,
        doc,
        postIndex,
      );
      const pageFile = safeResolve(projectPath, doc.page);
      const actualSource = fs.existsSync(pageFile)
        ? fs.readFileSync(pageFile, "utf8")
        : null;
      const managedFileStatus = resolveManagedStatus(
        doc,
        actualSource,
        generatedSource,
        justMigratedSlugs.has(doc.slug) ||
          (options?.regenerateHashlessPages === true && !doc.generatedHash),
      );
      const normalizedGenerated = normalizeHashText(generatedSource);
      const normalizedActual =
        actualSource !== null ? normalizeHashText(actualSource) : null;
      const onDiskMatchesGenerated =
        normalizedActual !== null && normalizedActual === normalizedGenerated;

      const onDiskMatchesStoredHash =
        actualSource !== null &&
        Boolean(doc.generatedHash) &&
        hashText(actualSource) === doc.generatedHash;

      let nextGeneratedHash = doc.generatedHash ?? hashText(generatedSource);
      if (actualSource === null) {
        nextGeneratedHash = hashText(generatedSource);
      } else if (onDiskMatchesGenerated) {
        nextGeneratedHash = hashText(generatedSource);
      } else if (onDiskMatchesStoredHash) {
        nextGeneratedHash = doc.generatedHash!;
      }

      // Opening a project must not rewrite the user's .astro files (that would
      // create spurious diffs on every open), so a page whose disk copy still
      // matches the recorded hash is left alone here. `refreshManagedPages`
      // opts into regenerating those — used before a build, where stale output
      // would otherwise be published. A hash-less sidecar is only rewritten
      // when the page was migrated in this same pass, or when site creation
      // explicitly asks for it (its scaffold placeholders are not user work).
      const justMigrated =
        justMigratedSlugs.has(doc.slug) ||
        (options?.regenerateHashlessPages === true && !doc.generatedHash);
      const shouldWriteAstro =
        managedFileStatus !== "out-of-sync" &&
        (actualSource === null ||
          onDiskMatchesGenerated ||
          (justMigrated && !doc.generatedHash) ||
          (options?.refreshManagedPages === true && onDiskMatchesStoredHash));

      if (
        shouldWriteAstro &&
        actualSource !== null &&
        !onDiskMatchesGenerated
      ) {
        nextGeneratedHash = hashText(generatedSource);
      }

      const nextDoc = {
        ...doc,
        generatedHash: nextGeneratedHash,
        managedFileStatus:
          managedFileStatus === "missing"
            ? ("managed" as const)
            : managedFileStatus,
      };
      // No-op short-circuit: previously every open rewrote every sidecar,
      // even when nothing changed (hundreds of writes on large projects).
      writeFileAtomicIfChanged(
        pageSchemaFile(projectPath, doc.slug),
        JSON.stringify(nextDoc, null, 2) + "\n",
      );

      if (shouldWriteAstro) {
        fs.mkdirSync(path.dirname(pageFile), { recursive: true });
        if (actualSource === null || !onDiskMatchesGenerated) {
          writeFileAtomic(pageFile, generatedSource);
          // Directory watches also observe atomic rename events. Mark every
          // page regenerated here so publish/schema refreshes cannot look like
          // edits made by another tool in the open editor.
          markSelfWritten(doc.page);
        }
      }
    }

    pruneSelfWrittenMarkers();
    return {
      ok: true,
      status: getVisualSchemaStatus(projectPath, pagesDir),
    };
  } catch (error) {
    log.error("Failed to ensure Zephus visual schema", error);
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readSiteDocument(projectPath: string): SiteDocumentResult {
  try {
    const site = readJsonFile<SiteDocument>(siteDocumentFile(projectPath));
    if (!site) {
      return { ok: false, site: null, error: "Site schema not found." };
    }
    return { ok: true, site: withSiteDefaults(site) };
  } catch (error) {
    return {
      ok: false,
      site: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function writeSiteDocument(
  projectPath: string,
  site: SiteDocument,
  pagesDir: string,
): OperationResult {
  try {
    const currentSite = readJsonFile<SiteDocument>(
      siteDocumentFile(projectPath),
    );
    const nextSite: SiteDocument = withSiteDefaults({
      ...site,
      generatedAt: currentSite?.generatedAt ?? new Date().toISOString(),
    });
    syncSiteShellOutputs(
      projectPath,
      nextSite,
      pagesDir,
      undefined,
      currentSite,
    );
    writeSiteJsonIfChanged(projectPath, nextSite);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function listPageDocuments(
  projectPath: string,
  pagesDir: string,
): { ok: boolean; entries: PageDocument[]; error?: string } {
  try {
    const ensured = ensureVisualSchema(projectPath, pagesDir);
    if (!ensured.ok) {
      return { ok: false, entries: [], error: ensured.error };
    }
    const pages = listPages(projectPath, pagesDir);
    const entries = pages
      .map((page) =>
        readPageDocumentFile(projectPath, slugFromPage(page, pagesDir)),
      )
      .filter((entry): entry is PageDocument => Boolean(entry));
    return { ok: true, entries };
  } catch (error) {
    return {
      ok: false,
      entries: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveManagedStatus(
  doc: PageDocument,
  actualSource: string | null,
  generatedSource: string,
  justMigrated = false,
): ManagedFileStatus {
  if (doc.detached) return "detached";
  if (actualSource === null) return "missing";
  if (normalizeHashText(actualSource) === normalizeHashText(generatedSource)) {
    return "managed";
  }
  if (!doc.generatedHash) {
    // A sidecar without a stored hash is only trusted right after a migration
    // that just regenerated the page in this pass. Any other hash-less sidecar
    // whose disk copy differs from current output may be hand-edited — do not
    // treat it as managed or its source will be rewritten on open.
    return justMigrated ? "managed" : "out-of-sync";
  }
  return hashText(actualSource) === doc.generatedHash
    ? "managed"
    : "out-of-sync";
}

export function readPageDocument(
  projectPath: string,
  page: string,
  pagesDir: string,
): PageDocumentResult {
  try {
    const ensured = ensureVisualSchema(projectPath, pagesDir);
    if (!ensured.ok) {
      return {
        ok: false,
        site: null,
        pageDocument: null,
        source: null,
        generatedSource: null,
        error: ensured.error,
      };
    }
    const site = readJsonFile<SiteDocument>(siteDocumentFile(projectPath));
    if (!site) {
      return {
        ok: false,
        site: null,
        pageDocument: null,
        source: null,
        generatedSource: null,
        error: "Site schema not found.",
      };
    }
    const slug = slugFromPage(page, pagesDir);
    const doc = readPageDocumentFile(projectPath, slug);
    if (!doc) {
      return {
        ok: false,
        site,
        pageDocument: null,
        source: null,
        generatedSource: null,
        error: `Page schema missing for ${page}.`,
      };
    }
    if (doc.schemaVersion > ZEPHUS_SCHEMA_VERSION) {
      return {
        ok: false,
        site,
        pageDocument: null,
        source: null,
        generatedSource: null,
        error:
          `Page "${page}" was saved by a newer version of Zephus ` +
          `(schema v${doc.schemaVersion}, this version supports v${ZEPHUS_SCHEMA_VERSION}). ` +
          `Please update Zephus to open this project.`,
      };
    }
    const actualPath = safeResolve(projectPath, page);
    const actualSource = fs.existsSync(actualPath)
      ? fs.readFileSync(actualPath, "utf8")
      : null;
    const generatedSource = renderAstroPage(
      projectPath,
      page,
      site,
      doc,
      buildPostIndex(listExistingPageDocuments(projectPath, pagesDir)),
    );
    const managedFileStatus = resolveManagedStatus(
      doc,
      actualSource,
      generatedSource,
    );
    const nextDoc: PageDocument = {
      ...doc,
      managedFileStatus,
      generatedHash: hashText(generatedSource),
    };
    return {
      ok: true,
      site,
      pageDocument: nextDoc,
      source:
        doc.detached || managedFileStatus === "out-of-sync"
          ? (actualSource ?? generatedSource)
          : generatedSource,
      generatedSource,
    };
  } catch (error) {
    return {
      ok: false,
      site: null,
      pageDocument: null,
      source: null,
      generatedSource: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * INVARIANT: This function (and its callees ensureVisualSchema,
 * refreshPostListPages, syncSiteShellOutputs) must remain SYNCHRONOUS.
 * The Electron IPC main thread serializes handler calls — two concurrent async
 * writes could interleave reads and produce inconsistent schema state. If any
 * path within this function becomes async, introduce a per-project write mutex.
 */
export function writePageDocument(
  projectPath: string,
  pagesDir: string,
  doc: PageDocument,
): PageDocumentResult {
  try {
    const ensured = ensureVisualSchema(projectPath, pagesDir);
    if (!ensured.ok) {
      return {
        ok: false,
        site: null,
        pageDocument: null,
        source: null,
        generatedSource: null,
        error: ensured.error,
      };
    }
    const site = readJsonFile<SiteDocument>(siteDocumentFile(projectPath));
    if (!site) {
      return {
        ok: false,
        site: null,
        pageDocument: null,
        source: null,
        generatedSource: null,
        error: "Site schema not found.",
      };
    }
    const nextSlug = slugFromPage(doc.page, pagesDir);
    if (nextSlug.split("/").some((segment) => segment === "..")) {
      // Path traversal: "../../layouts/BaseLayout.astro" would make
      // pagePathFromSlug normalize OUTSIDE pagesDir and clobber any project
      // file with generated page content. Reject, never canonicalize around.
      return {
        ok: false,
        site: null,
        pageDocument: null,
        source: null,
        generatedSource: null,
        error: "Page path must stay inside the pages directory.",
      };
    }
    const nextIsNotFound = isNotFoundSlug(nextSlug);
    // Derive the write target from the normalized slug — never trust doc.page.
    // A stale/compromised renderer could otherwise submit page:"package.json"
    // (or any project-relative path) and clobber that file with generated page
    // content, bypassing the files.ts protected-target denylist. Canonicalizing
    // to pagesDir/<slug>.astro confines every write to a real page file.
    const nextExt = path.extname(doc.page) || ".astro";
    const nextPage = pagePathFromSlug(pagesDir, nextSlug, nextExt);
    const nextDoc: PageDocument = {
      ...doc,
      page: nextPage,
      slug: nextSlug,
      // The 404 route has a non-negotiable navigation/search policy, even if
      // a stale or compromised renderer submits conflicting metadata.
      navVisible: nextIsNotFound ? false : doc.navVisible,
      noindex: nextIsNotFound ? true : doc.noindex,
      schemaVersion: ZEPHUS_SCHEMA_VERSION,
      detached: false,
      detachedAt: null,
      managedFileStatus: "managed",
    };
    const generatedSource = renderAstroPage(
      projectPath,
      nextDoc.page,
      site,
      nextDoc,
      // The saved page itself may be a post, so index after merging it in.
      buildPostIndex(
        listExistingPageDocuments(projectPath, pagesDir).map((entry) =>
          entry.page === nextDoc.page ? nextDoc : entry,
        ),
      ),
    );
    nextDoc.generatedHash = hashText(generatedSource);
    writePageDocumentFile(projectPath, nextDoc);
    // Atomic write: a crash mid-write must not corrupt the .astro (the
    // sidecar hash was already written above, so a half-written page would
    // be flagged out-of-sync on the next open).
    writeFileAtomic(safeResolve(projectPath, nextDoc.page), generatedSource);
    // The file watcher (open-page external-change detection) must not treat
    // this save as an external edit.
    markSelfWritten(nextDoc.page);
    // Pass the ON-DISK site as previousSite so the legacy-layout backup only
    // fires on a genuine legacy -> managed transition. Without it, every
    // first save committed a permanent-stale BaseLayout.zephus-legacy-backup.
    const onDiskSite = readJsonFile<SiteDocument>(
      siteDocumentFile(projectPath),
    );
    syncSiteShellOutputs(projectPath, site, pagesDir, undefined, onDiskSite);
    // This page's own metadata may have changed what other pages list.
    refreshPostListPages(projectPath, pagesDir, site, nextDoc.page);
    // The returned site MUST reflect what lands on disk (byte-equal), or the
    // renderer's drift check false-positives "site changed on disk". A page
    // write whose shell outputs did not change no longer bumps generatedAt.
    const updatedSite = writeSiteJsonIfChanged(projectPath, site);
    return {
      ok: true,
      site: updatedSite,
      pageDocument: nextDoc,
      source: generatedSource,
      generatedSource,
    };
  } catch (error) {
    log.error("Failed to write page document", error);
    return {
      ok: false,
      site: null,
      pageDocument: null,
      source: null,
      generatedSource: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Metadata-only write for detached / out-of-sync pages. Unlike
 * writePageDocument it does NOT regenerate the .astro from the sidecar tree
 * and does NOT reattach the page — the hand-authored source stays byte-for-
 * byte intact. Only the JSON sidecar's metadata fields change, then the site
 * shell outputs (layout nav) are resynced so visibility edits still publish.
 *
 * This is what protects eye-toggle / settings-save / stage-navigation on a
 * detached page from silently destroying hand-authored code: the previous
 * code path routed through writePageDocument, which regenerated the file from
 * the (stale) sidecar tree and flipped the page back to "managed".
 */
export function writePageMetadataPreservingSource(
  projectPath: string,
  pagesDir: string,
  doc: PageDocument,
): PageDocumentResult {
  try {
    const site = readJsonFile<SiteDocument>(siteDocumentFile(projectPath));
    if (!site) {
      return {
        ok: false,
        site: null,
        pageDocument: null,
        source: null,
        generatedSource: null,
        error: "Site schema not found.",
      };
    }
    const nextSlug = slugFromPage(doc.page, pagesDir);
    const nextIsNotFound = isNotFoundSlug(nextSlug);
    const nextDoc: PageDocument = {
      ...doc,
      slug: nextSlug,
      navVisible: nextIsNotFound ? false : doc.navVisible,
      noindex: nextIsNotFound ? true : doc.noindex,
      schemaVersion: ZEPHUS_SCHEMA_VERSION,
      // Preserve the hand-authored state exactly as read.
      detached: doc.detached,
      detachedAt: doc.detachedAt,
      managedFileStatus: doc.managedFileStatus,
      generatedHash: doc.generatedHash,
    };
    writePageDocumentFile(projectPath, nextDoc);
    syncSiteShellOutputs(projectPath, site, pagesDir);
    const updatedSite = writeSiteJsonIfChanged(projectPath, site);
    return {
      ok: true,
      site: updatedSite,
      pageDocument: nextDoc,
      source: null,
      generatedSource: null,
    };
  } catch (error) {
    log.error("Failed to write page metadata (preserving source)", error);
    return {
      ok: false,
      site: null,
      pageDocument: null,
      source: null,
      generatedSource: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function detachPageDocument(
  projectPath: string,
  page: string,
  pagesDir: string,
  source: string,
): PageDocumentResult {
  try {
    // Confine the write target to a real page under pagesDir: the renderer
    // supplies both path and bytes, and a bare writeFileSync would overwrite
    // ANY in-root file (BaseLayout.astro, package.json, astro.config.mjs)
    // with attacker-chosen content executed by later npm/dev/build spawns.
    const slug = slugFromPage(page, pagesDir);
    if (slug.split("/").some((segment) => segment === "..")) {
      return {
        ok: false,
        site: null,
        pageDocument: null,
        source: null,
        generatedSource: null,
        error: "Page path must stay inside the pages directory.",
      };
    }
    const canonical = pagePathFromSlug(
      pagesDir,
      slug,
      path.extname(page) || ".astro",
    );
    const current = readPageDocument(projectPath, page, pagesDir);
    if (!current.ok || !current.pageDocument || !current.site) {
      return current;
    }
    const nextDoc: PageDocument = {
      ...current.pageDocument,
      page: canonical,
      slug,
      detached: true,
      detachedAt: new Date().toISOString(),
      managedFileStatus: "detached",
    };
    // Write the FILE first, atomically, then the sidecar: the user's code is
    // the only copy once detached (the sidecar tree is stale by definition),
    // so a crash mid-detach must never leave the page "detached" on disk with
    // old managed content — or a truncated file.
    writeFileAtomic(safeResolve(projectPath, canonical), source);
    // Detaching is an app-owned atomic page write; suppress its watcher event
    // so switching to hand-authored code does not immediately prompt reload.
    markSelfWritten(canonical);
    writePageDocumentFile(projectPath, nextDoc);
    return {
      ok: true,
      site: current.site,
      pageDocument: nextDoc,
      source,
      generatedSource: current.generatedSource ?? current.source,
    };
  } catch (error) {
    return {
      ok: false,
      site: null,
      pageDocument: null,
      source: null,
      generatedSource: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function reattachPageDocument(
  projectPath: string,
  page: string,
  pagesDir: string,
): PageDocumentResult {
  try {
    const slug = slugFromPage(page, pagesDir);
    const existing = readPageDocumentFile(projectPath, slug);
    if (existing && !existing.detached) {
      // Already managed — nothing to reattach. Return the current state.
      const site = readJsonFile<SiteDocument>(siteDocumentFile(projectPath));
      const actualSource = fs.readFileSync(
        safeResolve(projectPath, page),
        "utf8",
      );
      return {
        ok: true,
        site: site ?? null,
        pageDocument: existing,
        source: actualSource,
        generatedSource: actualSource,
      };
    }

    const source = fs.readFileSync(safeResolve(projectPath, page), "utf8");
    // Same lossless guard as migration: a hand-authored page (imports beyond
    // BaseLayout, Astro expressions, <style>/<script>) cannot be represented
    // by the parse tree — reattaching would silently drop those and rewrite
    // the file. Refuse instead of destroying content.
    if (!isCanonicalManagedSource(source)) {
      return {
        ok: false,
        site: null,
        pageDocument: null,
        source,
        generatedSource: null,
        error:
          "This page contains hand-authored code that visual mode cannot " +
          "represent (imports, expressions, or style/script blocks). " +
          "Reattaching would discard them.",
      };
    }
    const { frontmatter } = splitFrontmatter(source);
    const nextDoc = buildPageDocumentWithSections(
      page,
      pagesDir,
      parseSectionsFromSource(source),
      parseFrontmatter(frontmatter),
    );
    return writePageDocument(projectPath, pagesDir, nextDoc);
  } catch (error) {
    return {
      ok: false,
      site: null,
      pageDocument: null,
      source: null,
      generatedSource: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createSchemaPage(
  projectPath: string,
  pagesDir: string,
  slug: string,
): PageDocumentResult {
  const page = pagePathFromSlug(pagesDir, slug);
  const notFound = isNotFoundSlug(slug);
  const title = notFound ? "Page not found" : defaultTitleFromSlug(slug);
  const doc: PageDocument = {
    schemaVersion: ZEPHUS_SCHEMA_VERSION,
    page,
    route: slug === "index" ? "/" : `/${slug}`,
    slug,
    title,
    navLabel: notFound ? "404" : title,
    metaDescription: "",
    // A 404 page is an error response, not a destination: keep it out of the
    // site navigation and out of search results.
    navVisible: !notFound,
    isHome: slug === "index",
    socialImage: "",
    canonicalUrl: "",
    noindex: notFound,
    publishDate: "",
    author: "",
    sections: [
      {
        id: "section-main",
        type: "section",
        label: "Main Content",
        props: { wrapper: "none" },
        children: notFound
          ? [
              {
                id: "b" + Math.random().toString(36).slice(2, 9),
                type: "heading",
                props: { text: "Page not found", level: "1", cls: "" },
              },
              {
                id: "b" + Math.random().toString(36).slice(2, 9),
                type: "text",
                props: {
                  text: "Sorry, we could not find the page you were looking for.",
                  cls: "lead",
                },
              },
              {
                id: "b" + Math.random().toString(36).slice(2, 9),
                type: "button",
                props: { text: "Back to home", href: "/", cls: "" },
              },
            ]
          : [
              {
                id: "b" + Math.random().toString(36).slice(2, 9),
                type: "heading",
                props: { text: title, level: "1", cls: "" },
              },
              {
                id: "b" + Math.random().toString(36).slice(2, 9),
                type: "text",
                props: { text: "New page. Start editing.", cls: "" },
              },
            ],
      },
    ],
    detached: false,
    detachedAt: null,
    generatedHash: null,
    managedFileStatus: "managed",
  };
  return writePageDocument(projectPath, pagesDir, doc);
}

export function renamePageSchema(
  projectPath: string,
  pagesDir: string,
  previousPage: string,
  nextSlug: string,
): OperationResult {
  try {
    const prevSlug = slugFromPage(previousPage, pagesDir);
    const doc = readPageDocumentFile(projectPath, prevSlug);
    if (!doc) return { ok: true };
    const nextPage = pagePathFromSlug(
      pagesDir,
      nextSlug,
      path.extname(previousPage) || ".astro",
    );
    const nextIsNotFound = isNotFoundSlug(nextSlug);
    const previousWasNotFound = isNotFoundSlug(prevSlug);
    const nextDoc: PageDocument = {
      ...doc,
      page: nextPage,
      slug: nextSlug,
      route: nextSlug === "index" ? "/" : `/${nextSlug}`,
      isHome: nextSlug === "index",
      // Entering/leaving the reserved 404 route applies the same search and
      // navigation policy as creating that page directly.
      navVisible: nextIsNotFound
        ? false
        : previousWasNotFound
          ? true
          : doc.navVisible,
      noindex: nextIsNotFound
        ? true
        : previousWasNotFound
          ? false
          : doc.noindex,
    };
    const prevFile = pageSchemaFile(projectPath, prevSlug);
    const nextFile = pageSchemaFile(projectPath, nextSlug);
    fs.mkdirSync(path.dirname(nextFile), { recursive: true });
    // Write the new sidecar first, then remove the old one: deleting before
    // the write would permanently lose the schema if the write fails.
    writeJsonFile(nextFile, nextDoc);
    if (prevFile !== nextFile && fs.existsSync(prevFile)) {
      fs.rmSync(prevFile, { force: true });
    }
    // The route changed, so Post List links pointing at it must be rebuilt.
    const site = readJsonFile<SiteDocument>(siteDocumentFile(projectPath));
    if (site) {
      refreshPostListPages(projectPath, pagesDir, withSiteDefaults(site));
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function duplicatePageSchema(
  projectPath: string,
  pagesDir: string,
  page: string,
  nextSlug: string,
): OperationResult {
  try {
    const prevSlug = slugFromPage(page, pagesDir);
    const doc = readPageDocumentFile(projectPath, prevSlug);
    if (!doc) return { ok: true };
    const nextDoc: PageDocument = {
      ...doc,
      page: pagePathFromSlug(
        pagesDir,
        nextSlug,
        path.extname(page) || ".astro",
      ),
      slug: nextSlug,
      route: nextSlug === "index" ? "/" : `/${nextSlug}`,
      title: `${doc.title} Copy`,
      navLabel: `${doc.navLabel} Copy`,
      isHome: nextSlug === "index",
      // A duplicate must not claim the original's canonical URL, or search
      // engines are told the copy is the same page as the original.
      canonicalUrl: "",
      // Preserve the original's authorship state: duplicating a detached /
      // out-of-sync page must yield a detached copy whose hand-authored bytes
      // (copied verbatim by duplicatePage) stay intact. Forcing "managed" here
      // made the subsequent write regenerate the copy from the stale tree and
      // drop all hand-authored content.
      detached: doc.detached,
      detachedAt: doc.detachedAt,
      managedFileStatus: doc.managedFileStatus,
      // The copied .astro is the ORIGINAL's bytes, so its hash carries over.
      // A null hash on a managed copy made resolveManagedStatus see "disk !=
      // generated (title differs) + no hash" → the duplicate was flagged
      // out-of-sync on the next open and stuck in hand-authored mode.
      generatedHash: doc.generatedHash,
    };
    // Refuse to silently overwrite a stale sidecar (e.g. from a previously
    // deleted page whose .astro was recreated by hand).
    if (fs.existsSync(pageSchemaFile(projectPath, nextSlug))) {
      return { ok: false, error: `A schema already exists for ${nextSlug}.` };
    }
    writePageDocumentFile(projectPath, nextDoc);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function deletePageSchema(
  projectPath: string,
  page: string,
  pagesDir: string,
): OperationResult {
  try {
    const slug = slugFromPage(page, pagesDir);
    const file = pageSchemaFile(projectPath, slug);
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    // A deleted post must disappear from other pages' Post List blocks.
    const site = readJsonFile<SiteDocument>(siteDocumentFile(projectPath));
    if (site) {
      refreshPostListPages(projectPath, pagesDir, withSiteDefaults(site), page);
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
