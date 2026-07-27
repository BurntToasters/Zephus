import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import {
  AssetEntry,
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
import { listProjectImages } from "./assets";
import { detectAstro, listPages } from "./project";
import { readRepoSettings } from "./settings";
import { readJsonSafe, writeFileAtomic } from "./fsSafe";
import {
  escapeAttr,
  escapeHtml,
  safeUrl,
  splitLines,
  splitPair,
  styleAttr,
} from "../../shared/renderHelpers";
import {
  renderBlockHtml,
  renderSectionsMarkup,
  collectResponsiveCss,
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
  return path.join(projectPath, ".zephus");
}

function siteDocumentFile(projectPath: string): string {
  return path.join(zephusDir(projectPath), "site.json");
}

function templatesDir(projectPath: string): string {
  return path.join(zephusDir(projectPath), "templates");
}

function assetsIndexFile(projectPath: string): string {
  return path.join(zephusDir(projectPath), "assets-index.json");
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
  return `/${rel}`;
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
  const normalized = normalizePageSlug(slug);
  if (normalized !== slug) {
    throw new Error("Invalid page schema slug.");
  }
  return path.join(
    ".zephus",
    "pages",
    slug === "index" ? "index.json" : `${slug}.json`,
  );
}

function pageSchemaFile(projectPath: string, slug: string): string {
  const normalized = normalizePageSlug(slug);
  if (normalized !== slug) {
    throw new Error("Invalid page schema slug.");
  }
  const root = path.resolve(projectPath, ".zephus", "pages");
  const relative = slug === "index" ? "index.json" : `${slug}.json`;
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

.zephus-shell-nav a {
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

function mergePageNavItems(
  navItems: NavItem[],
  pageDocs: PageDocument[],
): NavItem[] {
  const existingByPage = new Map<string, NavItem>();
  const existingByHref = new Map<string, NavItem>();
  const customItems: NavItem[] = [];
  for (const item of navItems) {
    if (item.page) {
      existingByPage.set(item.page, item);
    } else {
      customItems.push(item);
    }
    existingByHref.set(item.href, item);
  }

  const pageItems = pageDocs.map((doc) => {
    const existing =
      existingByPage.get(doc.page) ?? existingByHref.get(doc.route);
    return {
      id: existing?.id ?? `nav-${doc.slug}`,
      label: doc.navLabel,
      href: doc.route,
      page: doc.page,
      visible: doc.navVisible,
      children: existing?.children ?? [],
    };
  });

  return [
    ...pageItems,
    ...customItems.filter(
      (item) => !pageItems.some((pageItem) => pageItem.href === item.href),
    ),
  ];
}

function listExistingPageDocuments(
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
  const fontLinks = /^https:\/\/fonts\.googleapis\.com\//.test(
    site.design.fontImportUrl ?? "",
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
${customCssLink}
    <link rel="stylesheet" href="/styles/zephus-managed.css" />
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

function textFromHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function attrValue(html: string, attr: string): string {
  const match = html.match(new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match?.[1] ?? "";
}

/**
 * Reads a double-quoted attribute value, allowing single quotes inside it.
 * Used for the data-zephus-* attributes, whose URI-encoded JSON payloads can
 * contain literal apostrophes (encodeURIComponent does not encode them), which
 * would truncate the generic attrValue regex.
 */
function dataAttrValue(html: string, attr: string): string {
  const match = html.match(new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "i"));
  return match?.[1] ?? "";
}

function parseInlineStyle(styleText: string): BlockStyle | undefined {
  if (!styleText.trim()) return undefined;
  const style: BlockStyle = {};
  for (const part of styleText.split(";")) {
    const [rawKey, rawValue] = part.split(":");
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
function openingTag(segment: string): string {
  return segment.match(/^<[A-Za-z][\w:-]*\b[^>]*>/)?.[0] ?? segment;
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
    return {
      id: "b" + Math.random().toString(36).slice(2, 9),
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
  const tokenRe = /<!--[\s\S]*?-->|<\/?([A-Za-z][\w:-]*)\b[^>]*>/g;

  while (index < inner.length) {
    while (/\s/.test(inner[index] ?? "")) index += 1;
    if (index >= inner.length) break;

    if (inner.startsWith("<!--", index)) {
      const end = inner.indexOf("-->", index);
      if (end < 0) break;
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
    if (!first || first.index !== index) break;
    const tagText = first[0];
    const tagName = (first[1] ?? "").toLowerCase();
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
    const cite = segment.match(/<cite[^>]*>([\s\S]*?)<\/cite>/i)?.[1] ?? "";
    return {
      id,
      type: "quote",
      props: {
        text: textFromHtml(segment.replace(/<cite[\s\S]*?<\/cite>/i, "")),
        cite: textFromHtml(cite),
        cls,
      },
      style,
    };
  }
  if (tag === "ul" || tag === "ol") {
    const items = Array.from(segment.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi))
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

function extractManagedInner(raw: string): string {
  const { body } = splitFrontmatter(raw);
  const layoutMatch = body.match(
    /<BaseLayout\b[^>]*>([\s\S]*?)<\/BaseLayout>/i,
  );
  if (layoutMatch?.[1]) return layoutMatch[1].trim();

  const bodyMatch = body.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[1]) return bodyMatch[1].trim();

  return body.trim();
}

function parseBlocksFromSource(raw: string): BlockNode[] {
  const inner = extractManagedInner(raw);
  return parseBlocksFromInner(inner);
}

function parseSectionsFromSource(raw: string): SectionNode[] {
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
    if (tagName === "section" && stored?.type === "section") {
      if (looseBlocks.length > 0) {
        sections.push(defaultSectionNode(looseBlocks.splice(0)));
      }
      const childInner = segment
        .replace(/^<section\b[^>]*>/i, "")
        .replace(/<\/section>\s*$/i, "");
      sections.push({
        id: stored.id,
        type: "section",
        label: stored.props["label"] || "Section",
        props: {
          wrapper: stored.props["wrapper"] ?? "none",
          cls: stored.props["cls"] ?? "",
        },
        style: stored.style,
        children: parseBlocksFromInner(childInner),
        locked: stored.locked,
      });
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
        .replace(/^<section\b[^>]*>/i, "")
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
    props: { wrapper: "none" },
    children: blocks,
  };
}

/**
 * Sanitizes a value destined for a CSS declaration. Strips characters that
 * could break out of the declaration/rule (`;{}<>` and newlines) to prevent
 * CSS injection from design-token values in site.json. Caps length.
 */
function cssValue(value: string): string {
  return (value ?? "")
    .replace(/[;{}<>:@*\\]/g, "")
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
export function buildPostIndex(docs: PageMeta[]): RenderPostEntry[] {
  return docs.map((doc) => ({
    route: doc.route,
    title: doc.title || doc.navLabel || doc.slug,
    description: doc.metaDescription,
    date: doc.publishDate,
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

function updateAssetsIndex(projectPath: string, publicDir: string): void {
  const result = listProjectImages(projectPath, publicDir);
  const payload = {
    updatedAt: new Date().toISOString(),
    assets: result.ok ? result.assets : ([] as AssetEntry[]),
  };
  writeJsonFile(assetsIndexFile(projectPath), payload);
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
function resolveAbsoluteHttpUrl(siteUrl: string, value: string): string {
  if (!value.trim()) return "";
  try {
    const base = new URL(siteUrl);
    if (base.protocol !== "http:" && base.protocol !== "https:") return "";
    base.search = "";
    base.hash = "";
    if (!base.pathname.endsWith("/")) base.pathname += "/";

    const absoluteOrProtocolRelative =
      /^[A-Za-z][A-Za-z\d+.-]*:/.test(value) || value.startsWith("//");
    const resolved = absoluteOrProtocolRelative
      ? new URL(value, base)
      : new URL(value.replace(/^\/+/, ""), base);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.href
      : "";
  } catch {
    return "";
  }
}

/** Astro serves `src/pages/404.astro` as the not-found response. */
export function isNotFoundSlug(slug: string): boolean {
  return slug === "404";
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
      fs.writeFileSync(pageFile, generated, "utf8");
      writePageDocumentFile(projectPath, {
        ...doc,
        generatedHash: hashText(generated),
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
        doc.publishDate.trim() !== "" &&
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

function renderRssFeed(
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
        `      <title>${escapeHtml(doc.title)}</title>`,
        `      <link>${escapeHtml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeHtml(link)}</guid>`,
        doc.metaDescription
          ? `      <description>${escapeHtml(doc.metaDescription)}</description>`
          : "",
        pubDate ? `      <pubDate>${escapeHtml(pubDate)}</pubDate>` : "",
        doc.author
          ? `      <dc:creator>${escapeHtml(doc.author)}</dc:creator>`
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
    templates: [],
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
  return {
    ...site,
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
    navVisible: reservedNotFound ? false : doc.navVisible,
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
  return withPageMetaDefaults({
    ...doc,
    page: toProjectRelativePath(doc.page),
  });
}

function writePageDocumentFile(projectPath: string, doc: PageDocument): void {
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
      ? `description="${escapeAttr(doc.metaDescription)}"`
      : "",
    doc.canonicalUrl
      ? `canonicalUrl="${escapeAttr(safeUrl(doc.canonicalUrl) || "")}"`
      : "",
    doc.socialImage
      ? `socialImage="${escapeAttr(safeUrl(doc.socialImage) || "")}"`
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
    .join("\n");
  const importPath = pageImportPath(
    projectPath,
    pageRel,
    site.shell.layoutPath,
  );
  const schemaRel = pageSchemaRelativePath(doc.slug).split(path.sep).join("/");
  // The import MUST live inside the frontmatter fence (Astro component script);
  // the schema marker is a JS comment so it is ignored by the frontmatter
  // metadata parser. Page metadata lives authoritatively in the JSON sidecar.
  return `---
import BaseLayout from '${importPath}';
// zephus:managed schema=${schemaRel}
---

<BaseLayout title="${escapeAttr(title)}"${layoutAttrs}>
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
        `        <a href="${escapeAttr(item.href)}">${escapeHtml(item.label)}</a>`,
    )
    .join("\n");
  const navBlock = `<nav>\n${links}\n      </nav>`;
  const content = fs.readFileSync(layoutFile, "utf8");
  if (!/<nav>[\s\S]*?<\/nav>/.test(content)) return;
  fs.writeFileSync(
    layoutFile,
    content.replace(/<nav>[\s\S]*?<\/nav>/, navBlock),
    "utf8",
  );
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
    fs.writeFileSync(
      layoutFile,
      renderManagedLayout(
        site,
        site.shell.navItems,
        customCssHref,
        customScriptHref,
        hasFeed,
      ),
      "utf8",
    );
    const styleFile = safeResolve(projectPath, MANAGED_STYLE_PATH);
    fs.mkdirSync(path.dirname(styleFile), { recursive: true });
    fs.writeFileSync(styleFile, renderManagedStyles(site), "utf8");
  } else {
    syncLegacyLayoutNav(projectPath, site, pagesDir);
  }

  return site;
}

function buildPageDocument(
  page: string,
  pagesDir: string,
  blocks: BlockNode[],
  frontmatter: Record<string, string | boolean>,
): PageDocument {
  return buildPageDocumentWithSections(
    page,
    pagesDir,
    [defaultSectionNode(blocks)],
    frontmatter,
  );
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
    templateId: null,
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
  return buildPageDocumentWithSections(
    page,
    pagesDir,
    parseSectionsFromSource(raw),
    parsedFrontmatter,
  );
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
    const site = siteCheck.data
      ? withSiteDefaults(siteCheck.data)
      : defaultSiteDocument(projectPath, layoutPath, nextThemeId);

    const pages = listPages(projectPath, pagesDir);
    const pageDocs = pages.map((page) => {
      const slug = slugFromPage(page, pagesDir);
      let doc = readPageDocumentFile(projectPath, slug);
      if (!doc) {
        doc = migratePageToDocument(projectPath, page, pagesDir);
        writePageDocumentFile(projectPath, doc);
      }
      return doc;
    });

    syncSiteShellOutputs(projectPath, site, pagesDir, pageDocs, site);
    site.generatedAt = new Date().toISOString();
    writeJsonFile(siteDocumentFile(projectPath), site);
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
      // would otherwise be published.
      const shouldWriteAstro =
        managedFileStatus !== "out-of-sync" &&
        (actualSource === null ||
          onDiskMatchesGenerated ||
          !doc.generatedHash ||
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
      writePageDocumentFile(projectPath, nextDoc);

      if (shouldWriteAstro) {
        fs.mkdirSync(path.dirname(pageFile), { recursive: true });
        if (actualSource === null || !onDiskMatchesGenerated) {
          fs.writeFileSync(pageFile, generatedSource, "utf8");
        }
      }
    }
    updateAssetsIndex(projectPath, astro.publicDir);

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
      generatedAt: new Date().toISOString(),
    });
    syncSiteShellOutputs(
      projectPath,
      nextSite,
      pagesDir,
      undefined,
      currentSite,
    );
    writeJsonFile(siteDocumentFile(projectPath), nextSite);
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
): ManagedFileStatus {
  if (doc.detached) return "detached";
  if (actualSource === null) return "missing";
  if (normalizeHashText(actualSource) === normalizeHashText(generatedSource)) {
    return "managed";
  }
  if (!doc.generatedHash) return "managed";
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
    const nextIsNotFound = isNotFoundSlug(nextSlug);
    const nextDoc: PageDocument = {
      ...doc,
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
    fs.mkdirSync(path.dirname(safeResolve(projectPath, nextDoc.page)), {
      recursive: true,
    });
    fs.writeFileSync(
      safeResolve(projectPath, nextDoc.page),
      generatedSource,
      "utf8",
    );
    syncSiteShellOutputs(projectPath, site, pagesDir);
    // This page's own metadata may have changed what other pages list.
    refreshPostListPages(projectPath, pagesDir, site, nextDoc.page);
    writeJsonFile(siteDocumentFile(projectPath), {
      ...site,
      generatedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      site,
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

export function detachPageDocument(
  projectPath: string,
  page: string,
  pagesDir: string,
  source: string,
): PageDocumentResult {
  try {
    const current = readPageDocument(projectPath, page, pagesDir);
    if (!current.ok || !current.pageDocument || !current.site) {
      return current;
    }
    const nextDoc: PageDocument = {
      ...current.pageDocument,
      detached: true,
      detachedAt: new Date().toISOString(),
      managedFileStatus: "detached",
    };
    writePageDocumentFile(projectPath, nextDoc);
    fs.writeFileSync(safeResolve(projectPath, page), source, "utf8");
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
    templateId: null,
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
    if (fs.existsSync(prevFile)) fs.rmSync(prevFile, { force: true });
    writeJsonFile(nextFile, nextDoc);
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
      detached: false,
      detachedAt: null,
      managedFileStatus: "managed",
      generatedHash: null,
    };
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
