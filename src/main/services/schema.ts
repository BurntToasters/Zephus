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
  const resolved = path.resolve(projectPath, relativePath);
  const root = path.resolve(projectPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Path escapes the project directory.");
  }
  return resolved;
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
  const rel = page
    .replace(
      new RegExp(`^${pagesDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[/\\\\]?`),
      "",
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
  if (slug === "index") return path.join(pagesDir, `index${ext}`);
  return path.join(pagesDir, `${slug}${ext}`);
}

function pageSchemaRelativePath(slug: string): string {
  return path.join(
    ".zephus",
    "pages",
    slug === "index" ? "index.json" : `${slug}.json`,
  );
}

function pageSchemaFile(projectPath: string, slug: string): string {
  return path.join(projectPath, pageSchemaRelativePath(slug));
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

function serializeScalar(value: string | boolean): string {
  return typeof value === "boolean" ? String(value) : JSON.stringify(value);
}

function serializeFrontmatter(data: Record<string, string | boolean>): string {
  const lines = Object.entries(data).map(
    ([key, value]) => `${key}: ${serializeScalar(value)}`,
  );
  return `---\n${lines.join("\n")}\n---\n`;
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
    foreground: "#111827",
    surface: "#f8fafc",
    fontFamily: "system-ui, sans-serif",
    headingFontFamily: "system-ui, sans-serif",
    radius: "12px",
    shadow: "sm",
    containerWidth: "960px",
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
  return `:root {
  --zephus-accent: ${site.design.accent};
  --zephus-background: ${site.design.background};
  --zephus-foreground: ${site.design.foreground};
  --zephus-surface: ${site.design.surface};
  --zephus-radius: ${site.design.radius};
  --zephus-shadow: ${managedShadowValue(site.design.shadow)};
  --zephus-container-width: ${site.design.containerWidth};
  --zephus-font-family: ${site.design.fontFamily};
  --zephus-heading-font: ${site.design.headingFontFamily};
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
): string {
  const navLinks = navItems
    .filter((item) => item.visible)
    .map(
      (item) =>
        `      <a href="${escapeAttr(item.href)}">${escapeHtml(item.label)}</a>`,
    )
    .join("\n");
  const cta =
    site.shell.navCtaLabel.trim() && site.shell.navCtaHref.trim()
      ? `\n      <a class="zephus-shell-cta" href="${escapeAttr(
          site.shell.navCtaHref,
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

  return `---
interface Props {
  title?: string;
}
const { title = ${JSON.stringify(site.shell.siteTitle || site.siteName)} } = Astro.props;
const customHeadHtml = ${JSON.stringify(site.shell.customHeadHtml)};
const footerHtml = ${JSON.stringify(site.shell.footerHtml)};
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <link rel="stylesheet" href="/styles/global.css" />
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
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
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
    navVisible:
      typeof frontmatter["navVisible"] === "boolean"
        ? frontmatter["navVisible"]
        : true,
    isHome: route === "/",
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

function parseStoredBlock(segment: string): BlockNode | null {
  const encodedType = attrValue(segment, "data-zephus-block");
  const encodedProps = attrValue(segment, "data-zephus-props");
  if (!encodedType || !encodedProps) return null;
  try {
    const type = decodeURIComponent(encodedType) as EditorBlockType;
    const props = JSON.parse(decodeURIComponent(encodedProps)) as Record<
      string,
      string
    >;
    const encodedStyle = attrValue(segment, "data-zephus-style");
    const style = encodedStyle
      ? (JSON.parse(decodeURIComponent(encodedStyle)) as BlockStyle)
      : undefined;
    return {
      id: "b" + Math.random().toString(36).slice(2, 9),
      type,
      props,
      style,
      locked: attrValue(segment, "data-zephus-locked") === "true",
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
  return segments.map((segment) => parseBlockSegment(segment));
}

function hashText(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function blockMetadataAttrs(block: BlockNode): string {
  const attrs = [
    `data-zephus-block="${escapeAttr(block.type)}"`,
    `data-zephus-props="${escapeAttr(
      encodeURIComponent(JSON.stringify(block.props)),
    )}"`,
  ];
  if (block.style) {
    attrs.push(
      `data-zephus-style="${escapeAttr(
        encodeURIComponent(JSON.stringify(block.style)),
      )}"`,
    );
  }
  if (block.locked) attrs.push(`data-zephus-locked="true"`);
  return " " + attrs.join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function plainTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br />");
}

function renderListItems(items: string): string {
  return items
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `<li>${plainTextToHtml(item)}</li>`)
    .join("");
}

function styleAttr(block: BlockNode): string {
  const style = block.style ?? {};
  const css: string[] = [];
  if (style.align) css.push(`text-align:${style.align}`);
  if (style.maxWidth) css.push(`max-width:${style.maxWidth}`);
  if (style.background) css.push(`background:${style.background}`);
  if (style.color) css.push(`color:${style.color}`);
  if (style.padding) css.push(`padding:${style.padding}`);
  if (style.margin) css.push(`margin:${style.margin}`);
  if (style.radius) css.push(`border-radius:${style.radius}`);
  if (style.gap) css.push(`gap:${style.gap}`);
  if (style.columns && (block.type === "columns" || block.type === "gallery")) {
    css.push(
      `grid-template-columns:repeat(${Math.max(1, Number(style.columns) || 1)}, minmax(0, 1fr))`,
    );
  }
  if (style.shadow === "sm") css.push(`box-shadow:var(--shadow-sm)`);
  if (style.shadow === "md") css.push(`box-shadow:var(--shadow-md)`);
  if (style.shadow === "lg") css.push(`box-shadow:var(--shadow-lg)`);
  if (block.type === "spacer") {
    css.push(`height:${block.props["height"] || "48px"}`);
  }
  return css.length ? ` style="${escapeAttr(css.join(";"))}"` : "";
}

function classAttr(block: BlockNode): string {
  const cls = block.props["cls"];
  return cls ? ` class="${escapeAttr(cls)}"` : "";
}

function renderBlockNode(block: BlockNode): string {
  const common = `${blockMetadataAttrs(block)}${classAttr(block)}${styleAttr(block)}`;
  switch (block.type) {
    case "heading": {
      const level = Math.max(1, Math.min(6, Number(block.props["level"] ?? 2)));
      return `<h${level}${common}>${plainTextToHtml(
        block.props["text"] ?? "",
      )}</h${level}>`;
    }
    case "text":
      return `<p${common}>${plainTextToHtml(block.props["text"] ?? "")}</p>`;
    case "image":
      return `<img${common} src="${escapeAttr(block.props["src"] ?? "")}" alt="${escapeAttr(block.props["alt"] ?? "")}" />`;
    case "button":
      return `<a${common} href="${escapeAttr(block.props["href"] ?? "#")}">${plainTextToHtml(block.props["text"] ?? "")}</a>`;
    case "section":
      return `<section${common}>${plainTextToHtml(block.props["text"] ?? "")}</section>`;
    case "divider":
      return `<hr${common} />`;
    case "spacer":
      return `<div${common}></div>`;
    case "columns": {
      const cols = Number(block.style?.columns ?? block.props["count"] ?? 2);
      const parts = Array.from(
        { length: Math.max(2, Math.min(cols || 2, 4)) },
        (_, index) => {
          const key = `col${index + 1}`;
          return `<div class="zephus-column">${plainTextToHtml(
            block.props[key] ?? `Column ${index + 1}`,
          )}</div>`;
        },
      ).join("");
      return `<section${common}>${parts}</section>`;
    }
    case "card":
      return `<article${common}><h3>${plainTextToHtml(
        block.props["title"] ?? "Card title",
      )}</h3><p>${plainTextToHtml(block.props["text"] ?? "Card body")}</p></article>`;
    case "gallery": {
      const images = (block.props["images"] ?? "")
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
      return `<section${common}>${images
        .map(
          (src, index) =>
            `<img src="${escapeAttr(src)}" alt="${escapeAttr(
              block.props[`alt${index + 1}`] ?? `Gallery image ${index + 1}`,
            )}" />`,
        )
        .join("")}</section>`;
    }
    case "quote":
      return `<blockquote${common}><p>${plainTextToHtml(
        block.props["text"] ?? "",
      )}</p>${
        block.props["cite"]
          ? `<cite>${plainTextToHtml(block.props["cite"])}</cite>`
          : ""
      }</blockquote>`;
    case "list": {
      const tag = block.props["ordered"] === "true" ? "ol" : "ul";
      return `<${tag}${common}>${renderListItems(
        block.props["items"] ?? "",
      )}</${tag}>`;
    }
    case "embed":
      return `<iframe${common} src="${escapeAttr(block.props["src"] ?? "")}" title="${escapeAttr(block.props["title"] ?? "Embed")}" loading="lazy"></iframe>`;
    case "html":
      return block.raw ?? "";
  }
}

function renderSections(sections: SectionNode[]): string {
  return sections
    .map((section) => {
      const body = section.children
        .map((child) => renderBlockNode(child))
        .join("\n");
      if (section.props["wrapper"] === "none") return body;
      const cls = section.props["cls"]
        ? ` class="${escapeAttr(section.props["cls"])}"`
        : "";
      const style = styleAttr({
        id: section.id,
        type: "section",
        props: section.props,
        style: section.style,
      } as BlockNode);
      return `<section${cls}${style}>\n${body}\n</section>`;
    })
    .filter(Boolean)
    .join("\n");
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
  };
}

function readPageDocumentFile(
  projectPath: string,
  slug: string,
): PageDocument | null {
  return readJsonFile<PageDocument>(pageSchemaFile(projectPath, slug));
}

function writePageDocumentFile(projectPath: string, doc: PageDocument): void {
  writeJsonFile(pageSchemaFile(projectPath, doc.slug), doc);
}

function renderAstroPage(
  projectPath: string,
  pageRel: string,
  site: SiteDocument,
  doc: PageDocument,
): string {
  const title = doc.title || defaultTitleFromSlug(doc.slug);
  const body = renderSections(doc.sections)
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
  return `${serializeFrontmatter({
    title,
    navLabel: doc.navLabel,
    metaDescription: doc.metaDescription,
    navVisible: doc.navVisible,
    zephusManaged: true,
    zephusSchema: pageSchemaRelativePath(doc.slug).split(path.sep).join("/"),
  })}import BaseLayout from '${pageImportPath(
    projectPath,
    pageRel,
    site.shell.layoutPath,
  )}';

<BaseLayout title="${escapeAttr(title)}">
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
      ),
      "utf8",
    );
    const styleFile = safeResolve(projectPath, MANAGED_STYLE_PATH);
    fs.mkdirSync(path.dirname(styleFile), { recursive: true });
    fs.writeFileSync(styleFile, renderManagedStyles(site), "utf8");
    return site;
  }

  syncLegacyLayoutNav(projectPath, site, pagesDir);
  return site;
}

function buildPageDocument(
  page: string,
  pagesDir: string,
  blocks: BlockNode[],
  frontmatter: Record<string, string | boolean>,
): PageDocument {
  const meta = pageMetaFromFrontmatter(page, pagesDir, frontmatter);
  return {
    ...meta,
    schemaVersion: ZEPHUS_SCHEMA_VERSION,
    templateId: null,
    sections: [
      {
        id: "section-main",
        type: "section",
        label: "Main Content",
        props: { wrapper: "none" },
        children: blocks,
      },
    ],
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
  const raw = fs.readFileSync(path.join(projectPath, page), "utf8");
  const { frontmatter } = splitFrontmatter(raw);
  const parsedFrontmatter = parseFrontmatter(frontmatter);
  const blocks = parseBlocksFromSource(raw);
  return buildPageDocument(page, pagesDir, blocks, parsedFrontmatter);
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

export function ensureVisualSchema(
  projectPath: string,
  pagesDir: string,
  themeId?: string,
): SchemaEnsureResult {
  try {
    const astro = detectAstro(projectPath);
    const layoutPath = path.join(astro.srcDir, "layouts", "BaseLayout.astro");
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

    let site = readJsonFile<SiteDocument>(siteDocumentFile(projectPath));
    if (!site) {
      site = defaultSiteDocument(projectPath, layoutPath, nextThemeId);
    }

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
    for (const doc of pageDocs) {
      if (doc.detached) continue;
      const generatedSource = renderAstroPage(projectPath, doc.page, site, doc);
      const nextDoc = {
        ...doc,
        generatedHash: hashText(generatedSource),
        managedFileStatus: "managed" as const,
      };
      writePageDocumentFile(projectPath, nextDoc);
      fs.mkdirSync(path.dirname(path.join(projectPath, doc.page)), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(projectPath, doc.page),
        generatedSource,
        "utf8",
      );
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
    return { ok: true, site };
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
    const nextSite: SiteDocument = {
      ...site,
      generatedAt: new Date().toISOString(),
    };
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
  return actualSource === generatedSource ? "managed" : "out-of-sync";
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
    const actualPath = path.join(projectPath, page);
    const actualSource = fs.existsSync(actualPath)
      ? fs.readFileSync(actualPath, "utf8")
      : null;
    const generatedSource = renderAstroPage(projectPath, page, site, doc);
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
      source: doc.detached
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
    const nextDoc: PageDocument = {
      ...doc,
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
    );
    nextDoc.generatedHash = hashText(generatedSource);
    writePageDocumentFile(projectPath, nextDoc);
    fs.mkdirSync(path.dirname(path.join(projectPath, nextDoc.page)), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(projectPath, nextDoc.page),
      generatedSource,
      "utf8",
    );
    syncSiteShellOutputs(projectPath, site, pagesDir);
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
    fs.writeFileSync(path.join(projectPath, page), source, "utf8");
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
    const source = fs.readFileSync(path.join(projectPath, page), "utf8");
    const { frontmatter } = splitFrontmatter(source);
    const nextDoc = buildPageDocument(
      page,
      pagesDir,
      parseBlocksFromSource(source),
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
  const title = defaultTitleFromSlug(slug);
  const doc: PageDocument = {
    schemaVersion: ZEPHUS_SCHEMA_VERSION,
    page,
    route: slug === "index" ? "/" : `/${slug}`,
    slug,
    title,
    navLabel: title,
    metaDescription: "",
    navVisible: true,
    isHome: slug === "index",
    templateId: null,
    sections: [
      {
        id: "section-main",
        type: "section",
        label: "Main Content",
        props: { wrapper: "none" },
        children: [
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
    const nextDoc: PageDocument = {
      ...doc,
      page: nextPage,
      slug: nextSlug,
      route: nextSlug === "index" ? "/" : `/${nextSlug}`,
      isHome: nextSlug === "index",
    };
    const prevFile = pageSchemaFile(projectPath, prevSlug);
    const nextFile = pageSchemaFile(projectPath, nextSlug);
    fs.mkdirSync(path.dirname(nextFile), { recursive: true });
    if (fs.existsSync(prevFile)) fs.rmSync(prevFile, { force: true });
    writeJsonFile(nextFile, nextDoc);
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
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
