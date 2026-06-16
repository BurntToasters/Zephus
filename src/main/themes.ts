// Bundled Zephus themes. Themes are authored as Zephus *schema* (a SiteDocument
// + per-page PageDocument section trees), not raw HTML. On site creation the
// sidecars are written and ensureVisualSchema() regenerates the real .astro
// pages, managed layout, and design CSS from them — so a brand-new site is
// fully visually editable from the first open, with perfect round-trip.

import {
  BlockNode,
  DesignTokenSet,
  NavItem,
  PageDocument,
  SectionNode,
  ShellConfig,
  SiteDocument,
} from "./types";

const ZEPHUS_SCHEMA_VERSION = 1;

export interface ThemeMeta {
  id: string;
  name: string;
  description: string;
  previewPath: string;
}

export interface Theme extends ThemeMeta {
  /** Files written relative to the project root. */
  files: Record<string, string>;
  /** Path (relative to project root) of the shared layout new pages extend. */
  baseLayout: string;
}

export const ASTRO_VERSION = "^6.0.0";

/* ---------- Static project files ---------- */

function packageJson(siteName: string): string {
  const pkg = {
    name: siteName,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      dev: "astro dev",
      build: "astro build",
      preview: "astro preview",
    },
    dependencies: { astro: ASTRO_VERSION },
  };
  return JSON.stringify(pkg, null, 2) + "\n";
}

const ASTRO_CONFIG = `import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({});
`;

const GITIGNORE = `# build output
dist/
# dependencies
node_modules/
# generated types
.astro/
# environment variables
.env
.env.production
# macOS
.DS_Store
# logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Zephus: DO NOT ignore .zephus/ — it is this project's save state
# (site config, page schemas, templates) and must be committed so the
# project opens correctly on other machines.
`;

// Base CSS shared by every theme. Maps generic helper classes onto the managed
// design tokens (--zephus-*) so themes look cohesive and respond to design
// changes made in the editor.
const GLOBAL_CSS = `:root {
  --accent: var(--zephus-accent, #4f46e5);
  --fg: var(--zephus-foreground, #0f172a);
  --bg: var(--zephus-background, #ffffff);
  --surface: var(--zephus-surface, #f8fafc);
  --muted: #64748b;
  --border: #e2e8f0;
  --font: var(--zephus-font-family, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; line-height: 1.65; -webkit-font-smoothing: antialiased; }
img { max-width: 100%; height: auto; display: block; border-radius: var(--zephus-radius, 12px); }
a { color: var(--accent); }
.lead { font-size: 1.2rem; color: var(--muted); }
.button {
  display: inline-block;
  padding: 0.8rem 1.6rem;
  background: var(--accent);
  color: #ffffff;
  border-radius: 999px;
  text-decoration: none;
  font-weight: 600;
}
.button:hover { opacity: 0.92; }
.button.secondary { background: transparent; color: var(--accent); border: 1.5px solid var(--border); }
.zephus-column { padding: 0.5rem; }
.zephus-column h3 { margin-top: 0; }
.zephus-feature { padding: 1rem 0; }
.zephus-feature-icon { font-size: 2rem; line-height: 1; margin-bottom: 0.5rem; }
.zephus-testimonial { margin: 1.5rem 0; padding: 1.5rem; background: var(--surface); border-radius: var(--zephus-radius, 12px); }
.zephus-testimonial blockquote { margin: 0 0 0.75rem; font-size: 1.15rem; }
.zephus-testimonial figcaption { color: var(--muted); }
.zephus-accordion details { border-bottom: 1px solid var(--border); padding: 0.75rem 0; }
.zephus-accordion summary { cursor: pointer; font-weight: 600; }
.zephus-stats { display: flex; flex-wrap: wrap; gap: 2rem; }
.zephus-stat { display: flex; flex-direction: column; }
.zephus-stat-num { font-size: 2rem; font-weight: 800; color: var(--accent); }
.zephus-stat-label { color: var(--muted); font-size: 0.9rem; }
.zephus-pricing { border: 1px solid var(--border); border-radius: var(--zephus-radius, 12px); padding: 1.5rem; }
.zephus-pricing ul { padding-left: 1.1rem; }
.zephus-price { margin: 0.5rem 0 1rem; }
.zephus-price-amount { font-size: 2rem; font-weight: 800; }
.zephus-price-period { color: var(--muted); }
.zephus-cta { text-align: center; padding: 2.5rem 1.5rem; background: var(--surface); border-radius: var(--zephus-radius, 12px); }
@media (max-width: 640px) {
  .zephus-shell-nav { flex-wrap: wrap; }
}
`;

export function themePreviewPath(themeId: string): string {
  return `/theme/${themeId}/`;
}

export function rewritePreviewAbsoluteUrls(
  content: string,
  themeId: string,
): string {
  return content.replace(
    /((?:href|src)=["'])\/(?!\/)/g,
    `$1${themePreviewPath(themeId)}`,
  );
}

/* ---------- Block / section builders ---------- */

let __nodeCounter = 0;
function nid(prefix: string): string {
  __nodeCounter += 1;
  return `${prefix}${__nodeCounter.toString(36)}`;
}

type Style = SectionNode["style"];

function heading(text: string, level = 2, style?: Style): BlockNode {
  return {
    id: nid("b"),
    type: "heading",
    props: { text, level: String(level), cls: "" },
    style,
  };
}
function paragraph(text: string, cls = "", style?: Style): BlockNode {
  return { id: nid("b"), type: "text", props: { text, cls }, style };
}
function image(src: string, alt: string, style?: Style): BlockNode {
  return { id: nid("b"), type: "image", props: { src, alt, cls: "" }, style };
}
function button(
  text: string,
  href: string,
  cls = "",
  style?: Style,
): BlockNode {
  return { id: nid("b"), type: "button", props: { text, href, cls }, style };
}
function list(items: string[], ordered = false): BlockNode {
  return {
    id: nid("b"),
    type: "list",
    props: { items: items.join("\n"), ordered: String(ordered), cls: "" },
  };
}
function quote(text: string, cite = ""): BlockNode {
  return { id: nid("b"), type: "quote", props: { text, cite, cls: "" } };
}
function columns(count: number, cols: string[]): BlockNode {
  const props: Record<string, string> = { count: String(count), cls: "" };
  cols.forEach((c, i) => (props[`col${i + 1}`] = c));
  return {
    id: nid("b"),
    type: "columns",
    props,
    style: { columns: String(count), gap: "1.5rem", stackOnMobile: true },
  };
}
function feature(icon: string, title: string, body: string): BlockNode {
  return {
    id: nid("b"),
    type: "feature",
    props: { icon, title, text: body, cls: "" },
  };
}
function testimonial(q: string, author: string, role = ""): BlockNode {
  return {
    id: nid("b"),
    type: "testimonial",
    props: { quote: q, author, role, cls: "" },
  };
}
function stats(items: Array<[string, string]>): BlockNode {
  return {
    id: nid("b"),
    type: "stats",
    props: { items: items.map(([n, l]) => `${n} :: ${l}`).join("\n"), cls: "" },
  };
}
function accordion(items: Array<[string, string]>): BlockNode {
  return {
    id: nid("b"),
    type: "accordion",
    props: { items: items.map(([q, a]) => `${q} :: ${a}`).join("\n"), cls: "" },
  };
}
function pricing(
  plan: string,
  price: string,
  period: string,
  features: string[],
  ctaText: string,
  ctaHref: string,
): BlockNode {
  return {
    id: nid("b"),
    type: "pricing",
    props: {
      plan,
      price,
      period,
      features: features.join("\n"),
      ctaText,
      ctaHref,
      cls: "",
    },
  };
}
function cta(
  headingText: string,
  body: string,
  buttonText: string,
  buttonHref: string,
): BlockNode {
  return {
    id: nid("b"),
    type: "cta",
    props: {
      heading: headingText,
      text: body,
      buttonText,
      buttonHref,
      cls: "",
    },
  };
}

function section(
  label: string,
  children: BlockNode[],
  opts: { wrapper?: "none" | "box"; cls?: string; style?: Style } = {},
): SectionNode {
  return {
    id: nid("s"),
    type: "section",
    label,
    props: { wrapper: opts.wrapper ?? "box", cls: opts.cls ?? "" },
    style: opts.style,
    children,
  };
}

/** A centered hero section with surface background. */
function hero(children: BlockNode[]): SectionNode {
  return section("Hero", children, {
    wrapper: "box",
    cls: "zephus-hero",
    style: {
      background: "var(--zephus-surface)",
      padding: "4.5rem 1.5rem",
      align: "center",
      radius: "0",
    },
  });
}

/** A normal content band (no background). */
function band(label: string, children: BlockNode[]): SectionNode {
  return section(label, children, {
    wrapper: "box",
    style: {
      padding: "3rem 1.5rem",
      maxWidth: "var(--zephus-container-width)",
    },
  });
}

/* ---------- Theme definition model ---------- */

interface ThemePage {
  slug: string;
  title: string;
  navLabel?: string;
  navVisible?: boolean;
  metaDescription?: string;
  sections: SectionNode[];
}

interface ThemeDef {
  name: string;
  description: string;
  design: DesignTokenSet;
  shell: Partial<ShellConfig> & { siteTitle?: string };
  pages: ThemePage[];
}

const LAYOUT_PATH = "src/layouts/BaseLayout.astro";

type GFont = { name: string; weights?: number[] };
const SANS_FALLBACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF_FALLBACK = 'Georgia, "Times New Roman", serif';

/**
 * Build per-theme Google Fonts design tokens. Produces a `fontImportUrl`
 * pointing at the Google Fonts css2 endpoint plus matching `fontFamily` /
 * `headingFontFamily` stacks with sensible system fallbacks.
 */
function fonts(
  body: GFont,
  heading: GFont,
  bodySerif = false,
  headingSerif = false,
): Pick<DesignTokenSet, "fontFamily" | "headingFontFamily" | "fontImportUrl"> {
  const families: string[] = [];
  const spec = (f: GFont) =>
    `family=${f.name.replace(/ /g, "+")}:wght@${(f.weights ?? [400, 600, 700]).join(";")}`;
  families.push(spec(body));
  if (heading.name !== body.name) families.push(spec(heading));
  const stack = (f: GFont, serif: boolean) =>
    `"${f.name}", ${serif ? SERIF_FALLBACK : SANS_FALLBACK}`;
  return {
    fontFamily: stack(body, bodySerif),
    headingFontFamily: stack(heading, headingSerif),
    fontImportUrl: `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`,
  };
}

function makeDesign(overrides: Partial<DesignTokenSet>): DesignTokenSet {
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
    ...overrides,
  };
}

function routeForSlug(slug: string): string {
  return slug === "index" ? "/" : `/${slug}`;
}

/**
 * Generate a set of lightweight, accent-tinted SVG placeholder images that
 * ship in every scaffolded site under `public/assets/images/`. Astro copies
 * the `public/` tree into the build output automatically, so these are
 * available at `/assets/images/<name>.svg` with no extra build step.
 */
function placeholderImages(accent: string): Record<string, string> {
  const svg = (w: number, h: number, label: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label} placeholder">
  <rect width="${w}" height="${h}" fill="#eef2f7"/>
  <rect x="0" y="0" width="${w}" height="6" fill="${accent}"/>
  <g fill="none" stroke="#cbd5e1" stroke-width="2">
    <circle cx="${w * 0.32}" cy="${h * 0.42}" r="${Math.min(w, h) * 0.1}"/>
    <path d="M0 ${h} L${w * 0.4} ${h * 0.55} L${w * 0.62} ${h * 0.74} L${w * 0.82} ${h * 0.5} L${w} ${h}"/>
  </g>
  <text x="50%" y="${h - 14}" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${Math.round(Math.min(w, h) * 0.08)}" fill="#94a3b8">${w}×${h}</text>
</svg>
`;
  const avatar = (label: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="${label} placeholder">
  <rect width="160" height="160" rx="80" fill="#eef2f7"/>
  <circle cx="80" cy="62" r="30" fill="${accent}" opacity="0.85"/>
  <path d="M28 150 a52 52 0 0 1 104 0 Z" fill="${accent}" opacity="0.85"/>
</svg>
`;
  return {
    "public/assets/images/placeholder-landscape.svg": svg(
      1200,
      675,
      "Landscape",
    ),
    "public/assets/images/placeholder-square.svg": svg(800, 800, "Square"),
    "public/assets/images/placeholder-portrait.svg": svg(720, 960, "Portrait"),
    "public/assets/images/placeholder-wide.svg": svg(1600, 600, "Wide banner"),
    "public/assets/images/placeholder-avatar.svg": avatar("Avatar"),
  };
}

function pageFileForSlug(slug: string): string {
  return `src/pages/${slug === "index" ? "index" : slug}.astro`;
}

function navItemsFromPages(pages: ThemePage[]): NavItem[] {
  return pages
    .filter((p) => p.navVisible !== false)
    .map((p) => ({
      id: `nav-${p.slug}`,
      label: p.navLabel ?? p.title,
      href: routeForSlug(p.slug),
      page: pageFileForSlug(p.slug),
      visible: true,
      children: [],
    }));
}

function buildSiteDocument(
  themeId: string,
  siteName: string,
  def: ThemeDef,
): SiteDocument {
  const shell: ShellConfig = {
    layoutMode: "managed",
    layoutPath: LAYOUT_PATH,
    siteTitle: def.shell.siteTitle ?? siteName,
    logoText: def.shell.logoText ?? siteName,
    announcementText: def.shell.announcementText ?? "",
    announcementVisible: def.shell.announcementVisible ?? false,
    navItems: navItemsFromPages(def.pages),
    navCtaLabel: def.shell.navCtaLabel ?? "",
    navCtaHref: def.shell.navCtaHref ?? "#",
    footerHtml: def.shell.footerHtml ?? `<p>&copy; ${siteName}.</p>`,
    customHeadHtml: "",
    customScriptsPath: "public/scripts/zephus-custom.js",
    customCssPath: "public/styles/zephus-custom.css",
  };
  return {
    schemaVersion: ZEPHUS_SCHEMA_VERSION,
    themeId,
    siteName,
    generatedAt: new Date(0).toISOString(),
    design: def.design,
    shell,
    templates: [],
  };
}

function buildPageDocument(page: ThemePage): PageDocument {
  const route = routeForSlug(page.slug);
  return {
    schemaVersion: ZEPHUS_SCHEMA_VERSION,
    page: pageFileForSlug(page.slug),
    route,
    slug: page.slug,
    title: page.title,
    navLabel: page.navLabel ?? page.title,
    metaDescription: page.metaDescription ?? "",
    navVisible: page.navVisible !== false,
    isHome: route === "/",
    templateId: null,
    sections: page.sections,
    detached: false,
    detachedAt: null,
    generatedHash: null,
    managedFileStatus: "managed",
  };
}

function stubAstro(slug: string, title: string): string {
  const ups = slug.split("/").length;
  const prefix = "../".repeat(ups);
  return `---
import BaseLayout from '${prefix}layouts/BaseLayout.astro';
---
<BaseLayout title="${title.replace(/"/g, "&quot;")}"></BaseLayout>
`;
}

function stubLayout(siteName: string): string {
  return `---
interface Props { title?: string }
const { title = '${siteName.replace(/'/g, "")}' } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <link rel="stylesheet" href="/styles/global.css" />
  </head>
  <body><slot /></body>
</html>
`;
}

/* ---------- Theme definitions ---------- */

function buildThemeDef(id: string, siteName: string): ThemeDef | null {
  switch (id) {
    case "minimal":
      return minimalDef();
    case "project":
      return projectDef();
    case "documentation":
      return docsDef();
    case "blog":
      return blogDef(siteName);
    case "portfolio":
      return portfolioDef();
    case "agency":
      return agencyDef();
    case "saas":
      return saasDef();
    case "restaurant":
      return restaurantDef();
    case "event":
      return eventDef();
    case "store":
      return storeDef();
    default:
      return null;
  }
}

function minimalDef(): ThemeDef {
  return {
    name: "Minimal",
    description: "A clean one-page starting point.",
    design: makeDesign({
      accent: "#4f46e5",
      ...fonts({ name: "Inter" }, { name: "Inter" }),
    }),
    shell: { logoText: "My Site", footerHtml: "<p>Built with Zephus.</p>" },
    pages: [
      {
        slug: "index",
        title: "Home",
        sections: [
          hero([
            heading("Welcome to your new site", 1),
            paragraph(
              "A clean, blank canvas. Double-click any text to edit it, or drag blocks in from the left panel.",
              "lead",
            ),
            button("Get started", "/"),
            image("/assets/images/placeholder-wide.svg", "Your hero image"),
          ]),
          band("Highlights", [
            heading("Everything in one place", 2),
            feature(
              "✏️",
              "Edit visually",
              "Click any element on the page and change it — no code required.",
            ),
            feature(
              "🧩",
              "Drag in blocks",
              "Headings, images, buttons, galleries, pricing, and more.",
            ),
            feature(
              "🚀",
              "Publish fast",
              "Build a real Astro site you can host anywhere.",
            ),
          ]),
          band("Intro", [
            heading("Make it yours", 2),
            paragraph(
              "Replace this copy with your own. Add headings, images, buttons, lists, and more — everything here is fully editable.",
            ),
          ]),
          band("CTA", [
            cta(
              "Ready to build?",
              "Start with this page and shape it into your own.",
              "Get started",
              "/",
            ),
          ]),
        ],
      },
    ],
  };
}

function projectDef(): ThemeDef {
  return {
    name: "Project",
    description: "Marketing / landing site for a product or business.",
    design: makeDesign({
      accent: "#2563eb",
      ...fonts(
        { name: "Inter" },
        { name: "Plus Jakarta Sans", weights: [600, 700, 800] },
      ),
    }),
    shell: {
      logoText: "Project",
      navCtaLabel: "Get started",
      navCtaHref: "/contact",
      footerHtml: "<p>&copy; Project. Built with Zephus.</p>",
    },
    pages: [
      {
        slug: "index",
        title: "Home",
        navLabel: "Home",
        sections: [
          hero([
            heading("Build something people love", 1),
            paragraph(
              "A clean, modern starting point for your product, service, or business. Launch faster with a site you can edit visually.",
              "lead",
            ),
            button("Get started", "/contact"),
            button("Learn more", "/about", "secondary"),
            image("/assets/images/placeholder-wide.svg", "Product preview"),
          ]),
          band("Features", [
            heading("Why choose us", 2),
            feature("⚡", "Fast", "Modern, lightweight, and built for speed."),
            feature(
              "🛡️",
              "Reliable",
              "Dependable from day one, backed by real support.",
            ),
            feature(
              "🎨",
              "Yours",
              "Fully editable — make every page your own.",
            ),
          ]),
          band("Stats", [
            stats([
              ["2k+", "Happy customers"],
              ["4.9/5", "Average rating"],
              ["24/7", "Support"],
            ]),
          ]),
          band("Social proof", [
            heading("What customers say", 2),
            testimonial(
              "We launched in a weekend and our customers noticed. The site finally feels like us.",
              "Jamie Doe",
              "Founder, Northwind",
            ),
          ]),
          band("FAQ", [
            heading("Common questions", 2),
            accordion([
              [
                "How do I edit my site?",
                "Open it in Zephus and click any element to change it.",
              ],
              [
                "Can I add more pages?",
                "Yes — add pages from the left panel and they appear in the nav.",
              ],
              [
                "Where can I host it?",
                "Anywhere that serves static sites — Netlify, Vercel, Cloudflare, and more.",
              ],
            ]),
          ]),
          band("Call to action", [
            cta(
              "Ready to begin?",
              "Tell us what you need and we'll help you get there.",
              "Contact us",
              "/contact",
            ),
          ]),
        ],
      },
      {
        slug: "about",
        title: "About",
        sections: [
          band("About", [
            heading("About us", 1),
            paragraph(
              "A sentence or two about who you are and the problem you solve.",
              "lead",
            ),
            paragraph(
              "Share your story, your mission, and why customers should trust you. Replace this text with your own.",
            ),
            heading("Our values", 2),
            list([
              "Quality — we sweat the details.",
              "Honesty — clear, fair, and transparent.",
              "Care — your success is our success.",
            ]),
          ]),
        ],
      },
      {
        slug: "contact",
        title: "Contact",
        sections: [
          band("Contact", [
            heading("Get in touch", 1),
            paragraph("We'd love to hear from you.", "lead"),
            paragraph(
              "Email us and we'll get back to you within one business day.",
            ),
            button("Email us", "mailto:hello@example.com"),
          ]),
        ],
      },
    ],
  };
}

function docsDef(): ThemeDef {
  return {
    name: "Documentation",
    description: "Docs site with clear, focused content pages.",
    design: makeDesign({
      accent: "#0ea5e9",
      containerWidth: "820px",
      ...fonts({ name: "Inter" }, { name: "Inter" }),
    }),
    shell: {
      logoText: "Docs",
      navCtaLabel: "",
      footerHtml: "<p>Documentation built with Zephus.</p>",
    },
    pages: [
      {
        slug: "index",
        title: "Introduction",
        navLabel: "Introduction",
        sections: [
          band("Intro", [
            heading("Introduction", 1),
            paragraph(
              "Welcome to the documentation. Explain what your product does and how to use it.",
              "lead",
            ),
            paragraph(
              "Add new pages from the left panel and they'll appear in the navigation automatically.",
            ),
            heading("What you'll find here", 2),
            list([
              "Getting started guides.",
              "Step-by-step tutorials.",
              "Reference and FAQs.",
            ]),
            quote(
              "Keep each page focused on a single topic so readers find answers fast.",
            ),
          ]),
        ],
      },
      {
        slug: "getting-started",
        title: "Getting Started",
        sections: [
          band("Getting started", [
            heading("Getting Started", 1),
            paragraph("Get up and running in a few minutes.", "lead"),
            heading("1. Install", 2),
            paragraph("Describe the first step here."),
            heading("2. Configure", 2),
            paragraph("Explain any setup the reader needs to do."),
            heading("3. Run", 2),
            paragraph("Show them what success looks like."),
          ]),
        ],
      },
    ],
  };
}

function blogDef(siteName: string): ThemeDef {
  return {
    name: "Blog",
    description: "Blog with a post list and article pages.",
    design: makeDesign({
      accent: "#db2777",
      ...fonts(
        { name: "Inter" },
        { name: "Lora", weights: [600, 700] },
        false,
        true,
      ),
      containerWidth: "720px",
    }),
    shell: {
      logoText: siteName,
      announcementText: "Welcome to the blog",
      footerHtml: "<p>&copy; My Blog. Built with Zephus.</p>",
    },
    pages: [
      {
        slug: "index",
        title: "Blog",
        navLabel: "Home",
        sections: [
          band("Posts", [
            heading("Latest posts", 1),
            paragraph(
              "Welcome to the blog. Add new posts as pages and link them here.",
              "lead",
            ),
            image("/assets/images/placeholder-landscape.svg", "Featured post"),
            list(["Hello World — our first post"]),
            button("Read: Hello World", "/posts/hello-world", "secondary"),
          ]),
          band("Topics", [
            heading("What we write about", 2),
            feature(
              "📝",
              "Tutorials",
              "Step-by-step guides you can follow along.",
            ),
            feature(
              "💡",
              "Ideas",
              "Short essays and things we're thinking about.",
            ),
            feature("📣", "Updates", "What's new and what's next."),
          ]),
        ],
      },
      {
        slug: "posts/hello-world",
        title: "Hello World",
        navVisible: false,
        sections: [
          band("Article", [
            heading("Hello World", 1),
            paragraph(
              "This is your first blog post. Write something worth reading.",
              "lead",
            ),
            paragraph(
              "Replace this with your own words. Add headings to break up long articles, and images to bring them to life.",
            ),
            quote("A great post answers one question really well."),
            button("Back to all posts", "/", "secondary"),
          ]),
        ],
      },
    ],
  };
}

function portfolioDef(): ThemeDef {
  return {
    name: "Portfolio",
    description: "Personal portfolio to showcase your work.",
    design: makeDesign({
      accent: "#f97316",
      containerWidth: "920px",
      ...fonts(
        { name: "Inter" },
        { name: "Space Grotesk", weights: [500, 600, 700] },
      ),
    }),
    shell: {
      logoText: "Your Name",
      navCtaLabel: "Contact",
      navCtaHref: "mailto:hello@example.com",
      footerHtml: "<p>&copy; Your Name. Built with Zephus.</p>",
    },
    pages: [
      {
        slug: "index",
        title: "Work",
        navLabel: "Work",
        sections: [
          hero([
            heading("Hi, I'm Your Name", 1),
            paragraph(
              "I design and build things for the web. Here's a selection of my recent work.",
              "lead",
            ),
            button("About me", "/about"),
            image("/assets/images/placeholder-wide.svg", "Featured work"),
          ]),
          band("Work", [
            heading("Selected work", 2),
            feature(
              "🎨",
              "Project One",
              "What it is, your role, and the outcome.",
            ),
            feature(
              "🛠️",
              "Project Two",
              "What it is, your role, and the outcome.",
            ),
            feature(
              "📐",
              "Project Three",
              "What it is, your role, and the outcome.",
            ),
          ]),
          band("Reviews", [
            heading("Kind words", 2),
            testimonial(
              "A joy to work with — sharp, fast, and genuinely cared about the result.",
              "Pat Morgan",
              "Product Lead, Lumen",
            ),
          ]),
        ],
      },
      {
        slug: "about",
        title: "About",
        sections: [
          band("About", [
            heading("About me", 1),
            paragraph(
              "A short, friendly intro about who you are and what you do.",
              "lead",
            ),
            paragraph(
              "Share your background, the kind of work you enjoy, and what you're looking for.",
            ),
            heading("Skills", 2),
            list(["Design", "Development", "Strategy"]),
            button("Work with me", "mailto:hello@example.com"),
          ]),
        ],
      },
    ],
  };
}

function agencyDef(): ThemeDef {
  return {
    name: "Agency",
    description: "Bold studio / creative agency site.",
    design: makeDesign({
      accent: "#7c3aed",
      containerWidth: "1120px",
      ...fonts({ name: "Inter" }, { name: "Sora", weights: [600, 700, 800] }),
    }),
    shell: {
      logoText: "Studio",
      navCtaLabel: "Start a project",
      navCtaHref: "/contact",
      footerHtml: "<p>&copy; Studio. Built with Zephus.</p>",
    },
    pages: [
      {
        slug: "index",
        title: "Home",
        navLabel: "Home",
        sections: [
          hero([
            heading("We design brands people remember", 1),
            paragraph(
              "A creative studio crafting identity, web, and product experiences for ambitious teams.",
              "lead",
            ),
            button("Start a project", "/contact"),
            button("See our work", "/work", "secondary"),
            image("/assets/images/placeholder-wide.svg", "Studio showreel"),
          ]),
          band("Services", [
            heading("What we do", 2),
            feature(
              "✏️",
              "Brand",
              "Identity, logo, and visual systems that stand out.",
            ),
            feature("🌐", "Web", "Fast, beautiful sites built to convert."),
            feature("📱", "Product", "UX and UI for apps people love to use."),
          ]),
          band("Approach", [
            heading("How we work", 2),
            list([
              "Discovery — we learn your goals and audience.",
              "Design — we explore, refine, and perfect.",
              "Delivery — we ship and support what we build.",
            ]),
          ]),
          hero([
            heading("Have a project in mind?", 2),
            paragraph("Tell us about it — we reply within a day.", "lead"),
            button("Get in touch", "/contact"),
          ]),
        ],
      },
      {
        slug: "work",
        title: "Work",
        sections: [
          band("Work", [
            heading("Selected work", 1),
            paragraph("A few recent projects we're proud of.", "lead"),
            feature(
              "📦",
              "Northwind",
              "Brand + website for a logistics startup.",
            ),
            feature("💳", "Lumen", "Product design for a fintech app."),
            feature(
              "🌱",
              "Verdant",
              "Identity for a sustainability nonprofit.",
            ),
          ]),
        ],
      },
      {
        slug: "contact",
        title: "Contact",
        sections: [
          band("Contact", [
            heading("Start a project", 1),
            paragraph("Tell us what you're building.", "lead"),
            button("Email us", "mailto:hello@example.com"),
          ]),
        ],
      },
    ],
  };
}

function saasDef(): ThemeDef {
  return {
    name: "SaaS",
    description: "App / software landing page with pricing.",
    design: makeDesign({
      accent: "#6366f1",
      ...fonts(
        { name: "Plus Jakarta Sans" },
        { name: "Plus Jakarta Sans", weights: [600, 700, 800] },
      ),
    }),
    shell: {
      logoText: "Apply",
      navCtaLabel: "Try free",
      navCtaHref: "/pricing",
      announcementText: "New: faster dashboards are here",
      announcementVisible: true,
      footerHtml: "<p>&copy; Apply. Built with Zephus.</p>",
    },
    pages: [
      {
        slug: "index",
        title: "Home",
        navLabel: "Home",
        sections: [
          hero([
            heading("Ship faster with Apply", 1),
            paragraph(
              "The all-in-one platform that helps your team plan, build, and launch — without the busywork.",
              "lead",
            ),
            button("Try it free", "/pricing"),
            button("See features", "#features", "secondary"),
            image("/assets/images/placeholder-wide.svg", "Apply dashboard"),
          ]),
          band("Features", [
            heading("Everything you need", 2),
            feature("🗺️", "Plan", "Roadmaps and tasks in one shared space."),
            feature("⚙️", "Build", "Automations that cut the manual work."),
            feature("📊", "Launch", "Insights to ship with confidence."),
          ]),
          band("Stats", [
            stats([
              ["10k+", "Teams onboarded"],
              ["99.9%", "Uptime"],
              ["4.9/5", "Average rating"],
            ]),
          ]),
          band("Social proof", [
            testimonial(
              "Apply cut our release cycle in half. It's the first tool the whole team actually enjoys.",
              "Alex Rivera",
              "Head of Product, Northwind",
            ),
          ]),
          band("CTA", [
            cta(
              "Start free today",
              "No credit card required.",
              "Create your account",
              "/pricing",
            ),
          ]),
        ],
      },
      {
        slug: "pricing",
        title: "Pricing",
        sections: [
          band("Pricing", [
            heading("Simple, fair pricing", 1),
            paragraph("Start free, upgrade when you grow.", "lead"),
            pricing(
              "Free",
              "$0",
              "/mo",
              ["1 project", "Community support"],
              "Get started",
              "#",
            ),
            pricing(
              "Pro",
              "$12",
              "/mo",
              ["Unlimited projects", "Automations", "Priority support"],
              "Choose Pro",
              "#",
            ),
            pricing(
              "Business",
              "$29",
              "/mo",
              ["Everything in Pro", "SSO & roles", "Dedicated support"],
              "Choose Business",
              "#",
            ),
          ]),
          band("FAQ", [
            heading("Questions", 2),
            accordion([
              ["Can I cancel anytime?", "Yes — there are no contracts."],
              ["Is there a free trial?", "Pro is free for 14 days."],
              ["Do you offer discounts?", "Yes, for nonprofits and students."],
            ]),
          ]),
        ],
      },
    ],
  };
}

function restaurantDef(): ThemeDef {
  return {
    name: "Restaurant",
    description: "Menu, hours, and location for a cafe or restaurant.",
    design: makeDesign({
      accent: "#b45309",
      surface: "#fdf6ec",
      ...fonts(
        { name: "Inter" },
        { name: "Playfair Display", weights: [600, 700, 800] },
        false,
        true,
      ),
      containerWidth: "960px",
    }),
    shell: {
      logoText: "Olive & Vine",
      navCtaLabel: "Reserve",
      navCtaHref: "/contact",
      footerHtml: "<p>&copy; Olive & Vine. Built with Zephus.</p>",
    },
    pages: [
      {
        slug: "index",
        title: "Home",
        navLabel: "Home",
        sections: [
          hero([
            heading("Olive & Vine", 1),
            paragraph(
              "Seasonal Mediterranean plates and natural wine, served in a warm neighborhood room.",
              "lead",
            ),
            button("Reserve a table", "/contact"),
            button("View menu", "/menu", "secondary"),
            image("/assets/images/placeholder-wide.svg", "Our dining room"),
          ]),
          band("About", [
            heading("Fresh, simple, local", 2),
            paragraph(
              "We cook with what's in season and source from farms we trust. The menu changes often — come hungry and curious.",
            ),
          ]),
          band("Reviews", [
            testimonial(
              "The best meal we've had all year. Warm service and a menu that surprises.",
              "Casey N.",
              "Regular guest",
            ),
          ]),
          band("Hours", [
            heading("Hours & location", 2),
            list([
              "Tue–Thu: 5pm – 10pm",
              "Fri–Sat: 5pm – 11pm",
              "Sunday: 11am – 9pm",
              "123 Garden Street, Your City",
            ]),
          ]),
        ],
      },
      {
        slug: "menu",
        title: "Menu",
        sections: [
          band("Menu", [
            heading("Menu", 1),
            paragraph("A taste of what we're serving this season.", "lead"),
            columns(2, [
              "<h3>To Start</h3><p>Marinated olives · Whipped feta · Grilled bread</p>",
              "<h3>Mains</h3><p>Lamb skewers · Roasted branzino · Garden orzo</p>",
            ]),
            columns(2, [
              "<h3>Sides</h3><p>Charred greens · Herbed potatoes</p>",
              "<h3>Sweet</h3><p>Olive oil cake · Seasonal sorbet</p>",
            ]),
          ]),
        ],
      },
      {
        slug: "contact",
        title: "Reserve",
        sections: [
          band("Reserve", [
            heading("Reserve a table", 1),
            paragraph("Call us or send a note and we'll confirm.", "lead"),
            button("Call (555) 123-4567", "tel:+15551234567"),
            button("Email us", "mailto:hello@example.com", "secondary"),
          ]),
        ],
      },
    ],
  };
}

function eventDef(): ThemeDef {
  return {
    name: "Event",
    description: "Conference / event site with schedule and speakers.",
    design: makeDesign({
      accent: "#0d9488",
      containerWidth: "1040px",
      ...fonts({ name: "Inter" }, { name: "Sora", weights: [600, 700, 800] }),
    }),
    shell: {
      logoText: "DevConf",
      navCtaLabel: "Register",
      navCtaHref: "/register",
      announcementText: "Early-bird tickets end soon",
      announcementVisible: true,
      footerHtml: "<p>&copy; DevConf. Built with Zephus.</p>",
    },
    pages: [
      {
        slug: "index",
        title: "Home",
        navLabel: "Home",
        sections: [
          hero([
            heading("DevConf 2026", 1),
            paragraph(
              "One day, two stages, and the people building the future of the web. June 12 · Your City.",
              "lead",
            ),
            button("Register now", "/register"),
            button("View schedule", "/schedule", "secondary"),
            image("/assets/images/placeholder-wide.svg", "DevConf stage"),
          ]),
          band("Speakers", [
            heading("Featured speakers", 2),
            feature("🎤", "Jordan Lee", "Principal Engineer, Northwind"),
            feature("🎤", "Sam Patel", "Creator of OpenStack UI"),
            feature("🎤", "Riya Chen", "Design Lead, Lumen"),
          ]),
          band("CTA", [
            cta(
              "Join us in June",
              "Seats are limited — grab yours today.",
              "Register",
              "/register",
            ),
          ]),
        ],
      },
      {
        slug: "schedule",
        title: "Schedule",
        sections: [
          band("Schedule", [
            heading("Schedule", 1),
            paragraph("A full day of talks and workshops.", "lead"),
            list([
              "09:00 — Doors open & coffee",
              "10:00 — Opening keynote",
              "11:30 — Workshops (track A & B)",
              "13:00 — Lunch",
              "14:30 — Lightning talks",
              "16:00 — Closing panel",
            ]),
          ]),
        ],
      },
      {
        slug: "register",
        title: "Register",
        sections: [
          band("Register", [
            heading("Get your ticket", 1),
            paragraph("Early-bird pricing available now.", "lead"),
            button("Buy a ticket", "mailto:tickets@example.com"),
          ]),
        ],
      },
    ],
  };
}

function storeDef(): ThemeDef {
  return {
    name: "Store",
    description: "Product / shop landing page.",
    design: makeDesign({
      accent: "#e11d48",
      containerWidth: "1080px",
      ...fonts(
        { name: "Poppins", weights: [400, 500, 600] },
        { name: "Poppins", weights: [600, 700] },
      ),
    }),
    shell: {
      logoText: "Maker Goods",
      navCtaLabel: "Shop now",
      navCtaHref: "/products",
      footerHtml: "<p>&copy; Maker Goods. Built with Zephus.</p>",
    },
    pages: [
      {
        slug: "index",
        title: "Home",
        navLabel: "Home",
        sections: [
          hero([
            heading("Goods made to last", 1),
            paragraph(
              "Thoughtfully designed everyday objects, crafted in small batches from durable materials.",
              "lead",
            ),
            button("Shop the collection", "/products"),
            image("/assets/images/placeholder-wide.svg", "Featured products"),
          ]),
          band("Products", [
            heading("Bestsellers", 2),
            feature("👜", "The Tote", "Waxed canvas · $89"),
            feature("🍶", "The Bottle", "Insulated steel · $34"),
            feature("📓", "The Notebook", "Lay-flat binding · $18"),
          ]),
          band("Why us", [
            heading("Built to a higher standard", 2),
            feature("💪", "Durable", "Materials chosen to outlast trends."),
            feature("🤝", "Ethical", "Made by makers paid fairly."),
            feature("✅", "Guaranteed", "Love it or return it, no fuss."),
          ]),
          band("Reviews", [
            testimonial(
              "Easily the best tote I've owned. Three years in and it looks better than new.",
              "Morgan T.",
              "Verified buyer",
            ),
          ]),
        ],
      },
      {
        slug: "products",
        title: "Shop",
        sections: [
          band("Shop", [
            heading("The collection", 1),
            paragraph("Everything we make, in one place.", "lead"),
            columns(3, [
              "<h3>The Tote</h3><p>$89</p>",
              "<h3>The Bottle</h3><p>$34</p>",
              "<h3>The Notebook</h3><p>$18</p>",
            ]),
            columns(3, [
              "<h3>The Wallet</h3><p>$48</p>",
              "<h3>The Cap</h3><p>$28</p>",
              "<h3>The Mug</h3><p>$22</p>",
            ]),
          ]),
        ],
      },
    ],
  };
}

export const THEME_META: ThemeMeta[] = [
  {
    id: "documentation",
    name: "Documentation",
    description: "Sidebar navigation and content pages.",
    previewPath: themePreviewPath("documentation"),
  },
  {
    id: "project",
    name: "Project",
    description: "General marketing / landing site.",
    previewPath: themePreviewPath("project"),
  },
  {
    id: "blog",
    name: "Blog",
    description: "Post list and article pages.",
    previewPath: themePreviewPath("blog"),
  },
  {
    id: "portfolio",
    name: "Portfolio",
    description: "Project showcase grid.",
    previewPath: themePreviewPath("portfolio"),
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Blank Astro starter with a single page.",
    previewPath: themePreviewPath("minimal"),
  },
  {
    id: "agency",
    name: "Agency",
    description: "Bold creative studio / agency site.",
    previewPath: themePreviewPath("agency"),
  },
  {
    id: "saas",
    name: "SaaS",
    description: "App landing page with features and pricing.",
    previewPath: themePreviewPath("saas"),
  },
  {
    id: "restaurant",
    name: "Restaurant",
    description: "Menu, hours, and reservations.",
    previewPath: themePreviewPath("restaurant"),
  },
  {
    id: "event",
    name: "Event",
    description: "Conference site with schedule and speakers.",
    previewPath: themePreviewPath("event"),
  },
  {
    id: "store",
    name: "Store",
    description: "Product / shop landing page.",
    previewPath: themePreviewPath("store"),
  },
];

export function listThemes(): ThemeMeta[] {
  return THEME_META;
}

/**
 * Builds the full file set for a theme: static project files plus the Zephus
 * schema sidecars (.zephus/site.json + .zephus/pages/*.json) and stub pages.
 * ensureVisualSchema() turns the sidecars into the real pages/layout/CSS.
 */
export function buildTheme(themeId: string, siteName: string): Theme | null {
  const def = buildThemeDef(themeId, siteName);
  const meta = THEME_META.find((t) => t.id === themeId);
  if (!def || !meta) return null;

  const site = buildSiteDocument(themeId, siteName, def);
  const files: Record<string, string> = {
    "package.json": packageJson(siteName),
    "astro.config.mjs": ASTRO_CONFIG,
    ".gitignore": GITIGNORE,
    "public/styles/global.css": GLOBAL_CSS,
    "src/layouts/BaseLayout.astro": stubLayout(siteName),
    ".zephus/site.json": JSON.stringify(site, null, 2) + "\n",
    ...placeholderImages(def.design.accent),
  };

  for (const page of def.pages) {
    const doc = buildPageDocument(page);
    const sidecar = page.slug === "index" ? "index.json" : `${page.slug}.json`;
    files[`.zephus/pages/${sidecar}`] = JSON.stringify(doc, null, 2) + "\n";
    files[pageFileForSlug(page.slug)] = stubAstro(page.slug, page.title);
  }

  return { ...meta, files, baseLayout: LAYOUT_PATH };
}

/**
 * Preview variant. Same files as buildTheme; the preview generator runs
 * ensureVisualSchema then rewrites root-absolute URLs for the base path.
 */
export function buildPreviewTheme(
  themeId: string,
  siteName: string,
): Theme | null {
  return buildTheme(themeId, siteName);
}
