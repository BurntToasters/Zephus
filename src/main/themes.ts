// Bundled Zephus themes. Each theme is a self-contained set of files written
// into a new project during site creation. Themes are plain data so they are
// packaged inside the app asar and require no network access.

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
    dependencies: {
      astro: ASTRO_VERSION,
    },
  };
  return JSON.stringify(pkg, null, 2) + "\n";
}

const ASTRO_CONFIG = `import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({});
`;

// Standard Astro ignores, plus an explicit note that .zephus MUST be committed:
// it holds the Zephus project save state (site.json, page schemas, templates).
// Ignoring it would corrupt the project when opened on another machine.
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

function previewAstroConfig(themeId: string): string {
  const base = themePreviewPath(themeId).replace(/\/$/, "");
  return `import { defineConfig } from 'astro/config';

// Static preview build for Zephus bundled template previews.
export default defineConfig({
  output: 'static',
  base: '${base}',
});
`;
}

/* ---------- Shared layout + page fragments ---------- */

function baseLayout(title: string, body: string): string {
  return `---
interface Props {
  title?: string;
}
const { title = '${title}' } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <link rel="stylesheet" href="/styles/global.css" />
  </head>
  <body>
${body}
  </body>
</html>
`;
}

function page(layoutImport: string, title: string, inner: string): string {
  return `---
import BaseLayout from '${layoutImport}';
---

<BaseLayout title="${title}">
${inner}
</BaseLayout>
`;
}

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

/* ---------- Themes ---------- */

function minimalTheme(): Record<string, string> {
  return {
    "src/layouts/BaseLayout.astro": baseLayout(
      "My Site",
      `    <main>\n      <slot />\n    </main>`,
    ),
    "src/pages/index.astro": page(
      "../layouts/BaseLayout.astro",
      "Home",
      `  <h1>Welcome</h1>\n  <p>Your new Zephus site. Start editing.</p>`,
    ),
    "public/styles/global.css": `:root { color-scheme: light dark; }
body { font-family: system-ui, sans-serif; margin: 0; line-height: 1.6; }
main { max-width: 720px; margin: 0 auto; padding: 2rem; }
`,
  };
}

function projectTheme(): Record<string, string> {
  return {
    "src/layouts/BaseLayout.astro": baseLayout(
      "Project",
      `    <header class="site-header">
      <a class="logo" href="/">Project</a>
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
        <a href="/contact">Contact</a>
      </nav>
    </header>
    <main>
      <slot />
    </main>
    <footer class="site-footer">
      <p>&copy; Project. Built with Zephus.</p>
    </footer>`,
    ),
    "src/pages/index.astro": page(
      "../layouts/BaseLayout.astro",
      "Home",
      `  <section class="hero">
    <h1>Build something great</h1>
    <p>A clean, modern starting point for your product or business.</p>
    <a class="button" href="/contact">Get in touch</a>
  </section>`,
    ),
    "src/pages/about.astro": page(
      "../layouts/BaseLayout.astro",
      "About",
      `  <h1>About</h1>\n  <p>Tell visitors about your project here.</p>`,
    ),
    "src/pages/contact.astro": page(
      "../layouts/BaseLayout.astro",
      "Contact",
      `  <h1>Contact</h1>\n  <p>How to reach you.</p>`,
    ),
    "public/styles/global.css": `:root { --accent: #3b82f6; --fg: #1f2937; --bg: #ffffff; }
* { box-sizing: border-box; }
body { font-family: system-ui, sans-serif; margin: 0; color: var(--fg); background: var(--bg); }
.site-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 2rem; border-bottom: 1px solid #e5e7eb; }
.site-header nav a { margin-left: 1rem; text-decoration: none; color: var(--fg); }
.logo { font-weight: 700; font-size: 1.25rem; text-decoration: none; color: var(--accent); }
main { max-width: 960px; margin: 0 auto; padding: 3rem 2rem; }
.hero { text-align: center; padding: 4rem 0; }
.hero h1 { font-size: 2.5rem; margin: 0 0 1rem; }
.button { display: inline-block; margin-top: 1rem; padding: 0.75rem 1.5rem; background: var(--accent); color: #fff; border-radius: 8px; text-decoration: none; }
.site-footer { text-align: center; padding: 2rem; color: #6b7280; border-top: 1px solid #e5e7eb; }
`,
  };
}

function docsTheme(): Record<string, string> {
  return {
    "src/layouts/BaseLayout.astro": baseLayout(
      "Documentation",
      `    <div class="docs">
      <aside class="sidebar">
        <h2>Docs</h2>
        <nav>
          <a href="/">Introduction</a>
          <a href="/getting-started">Getting Started</a>
        </nav>
      </aside>
      <main class="content">
        <slot />
      </main>
    </div>`,
    ),
    "src/pages/index.astro": page(
      "../layouts/BaseLayout.astro",
      "Introduction",
      `  <h1>Introduction</h1>\n  <p>Welcome to your documentation site.</p>`,
    ),
    "src/pages/getting-started.astro": page(
      "../layouts/BaseLayout.astro",
      "Getting Started",
      `  <h1>Getting Started</h1>\n  <p>Step-by-step instructions go here.</p>`,
    ),
    "public/styles/global.css": `body { font-family: system-ui, sans-serif; margin: 0; color: #1f2937; }
.docs { display: flex; min-height: 100vh; }
.sidebar { width: 240px; background: #f9fafb; border-right: 1px solid #e5e7eb; padding: 1.5rem; }
.sidebar nav { display: flex; flex-direction: column; gap: 0.5rem; }
.sidebar nav a { text-decoration: none; color: #374151; }
.content { flex: 1; padding: 2.5rem 3rem; max-width: 800px; }
`,
  };
}

function blogTheme(): Record<string, string> {
  return {
    "src/layouts/BaseLayout.astro": baseLayout(
      "Blog",
      `    <header class="blog-header"><a href="/">My Blog</a></header>
    <main class="blog-main">
      <slot />
    </main>`,
    ),
    "src/pages/index.astro": page(
      "../layouts/BaseLayout.astro",
      "Blog",
      `  <h1>Latest Posts</h1>
  <ul class="post-list">
    <li><a href="/posts/hello-world">Hello World</a></li>
  </ul>`,
    ),
    "src/pages/posts/hello-world.astro": page(
      "../../layouts/BaseLayout.astro",
      "Hello World",
      `  <article>
    <h1>Hello World</h1>
    <p>Your first blog post.</p>
  </article>`,
    ),
    "public/styles/global.css": `body { font-family: Georgia, serif; margin: 0; color: #1f2937; }
.blog-header { padding: 1.5rem 2rem; border-bottom: 1px solid #e5e7eb; }
.blog-header a { font-size: 1.5rem; font-weight: 700; text-decoration: none; color: inherit; }
.blog-main { max-width: 720px; margin: 0 auto; padding: 2.5rem 2rem; }
.post-list { list-style: none; padding: 0; }
.post-list li { padding: 0.5rem 0; }
`,
  };
}

function portfolioTheme(): Record<string, string> {
  return {
    "src/layouts/BaseLayout.astro": baseLayout(
      "Portfolio",
      `    <header class="pf-header">
      <a class="pf-name" href="/">Your Name</a>
      <nav><a href="/">Work</a><a href="/about">About</a></nav>
    </header>
    <main class="pf-main">
      <slot />
    </main>`,
    ),
    "src/pages/index.astro": page(
      "../layouts/BaseLayout.astro",
      "Work",
      `  <h1>Selected Work</h1>
  <div class="grid">
    <a class="card" href="#">Project One</a>
    <a class="card" href="#">Project Two</a>
    <a class="card" href="#">Project Three</a>
  </div>`,
    ),
    "src/pages/about.astro": page(
      "../layouts/BaseLayout.astro",
      "About",
      `  <h1>About</h1>\n  <p>A short bio about you and your work.</p>`,
    ),
    "public/styles/global.css": `body { font-family: system-ui, sans-serif; margin: 0; color: #111827; }
.pf-header { display: flex; justify-content: space-between; align-items: center; padding: 1.5rem 2rem; }
.pf-header nav a { margin-left: 1rem; text-decoration: none; color: #374151; }
.pf-name { font-weight: 700; text-decoration: none; color: #111827; }
.pf-main { max-width: 1040px; margin: 0 auto; padding: 2rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; margin-top: 2rem; }
.card { display: flex; align-items: flex-end; min-height: 180px; padding: 1rem; background: #f3f4f6; border-radius: 12px; text-decoration: none; color: #111827; font-weight: 600; }
`,
  };
}

const THEME_BUILDERS: Record<string, () => Record<string, string>> = {
  documentation: docsTheme,
  project: projectTheme,
  blog: blogTheme,
  portfolio: portfolioTheme,
  minimal: minimalTheme,
};

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
];

export function listThemes(): ThemeMeta[] {
  return THEME_META;
}

/** Returns the full file set for a theme, including package.json and astro config. */
export function buildTheme(themeId: string, siteName: string): Theme | null {
  const builder = THEME_BUILDERS[themeId];
  const meta = THEME_META.find((t) => t.id === themeId);
  if (!builder || !meta) return null;
  const files: Record<string, string> = {
    "package.json": packageJson(siteName),
    "astro.config.mjs": ASTRO_CONFIG,
    ".gitignore": GITIGNORE,
    ...builder(),
  };
  return { ...meta, files, baseLayout: "src/layouts/BaseLayout.astro" };
}

export function buildPreviewTheme(
  themeId: string,
  siteName: string,
): Theme | null {
  const theme = buildTheme(themeId, siteName);
  if (!theme) return null;
  const files = Object.fromEntries(
    Object.entries(theme.files).map(([rel, content]) => [
      rel,
      rel.endsWith(".astro")
        ? rewritePreviewAbsoluteUrls(content, themeId)
        : content,
    ]),
  );
  files["astro.config.mjs"] = previewAstroConfig(themeId);
  return { ...theme, files };
}
