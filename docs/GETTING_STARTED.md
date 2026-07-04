# Getting Started with Zephus

Zephus is a local-first visual editor for Astro websites. Use it to create and edit sites with a drag-and-drop interface, fully on your machine, and backed by Git.

## Before You Start

**Important Requirements:**
- **Node.js 22.12+** installed on your system
- **Git** installed (Zephus can initialize a Git repo for you)
- An empty folder for your new site, or an existing Zephus project

> ⚠️ **Warning**: Zephus can only edit sites created within the app. If you try to open a regular Astro project, it won't work. Zephus uses a custom schema that's incompatible with standard Astro sites.

## Your First Site: The 5-Minute Setup

### 1. Open Zephus and Choose a Template

When you launch Zephus, you'll see the **Start** screen with several options:

- **Recent Projects**: Reopen sites you've worked on
- **Explore Templates**: Create a new site from a theme
- **App Settings**: Configure preferences
- **About & Licenses**: View app information

Click **Explore Templates** to see the available themes:
- **Documentation**: Clean, focused documentation pages
- **Project**: Marketing / landing site template
- **Blog**: Post list and article pages
- **Portfolio**: Project showcase grid
- **Minimal**: Blank Astro starter with a single page
- **Agency**: Bold creative studio / agency site
- **SaaS**: App landing page with features and pricing
- **Restaurant**: Menu, hours, and reservations
- **Event**: Conference site with schedule and speakers
- **Store**: Product / shop landing page

### 2. Choose a Folder for Your Site

1. Select the theme that matches your project
2. Click **Choose Folder & Create Site**
3. Select an **empty folder** on your computer (Zephus will create the project inside)
4. Zephus initializes the project:
   - Creates theme files, `package.json`, and Astro config
   - Sets up Git (if not already a repo)
   - Installs the `.zephus` marker directory

### 3. Start Editing

Once the project is created, Zephus opens the **Editor** view. You now have:
- **Canvas** (center): Your page editor
- **Page List** (left): All your site pages
- **Inspector** (right): Properties for the current block
- **Toolbar** (top): Save, Preview, Publish buttons

## The Editor Interface

### Left Sidebar: Page List

Your site's pages are listed here. You can:
- **Click** a page name to edit it
- **👁️ Icon**: Toggle visibility in site navigation
- **⋯ Menu**: Rename, duplicate, or delete pages
- **+ New Page**: Create a new page

### Center: Canvas

The main editing area where you compose your pages with content blocks. You can:
- **+ Add Block**: Insert new content
- **Drag blocks** up/down to reorder
- **Click a block** to select and edit it
- Toggle between **Visual** (drag-and-drop) and **Code** (raw Astro) modes

### Right Sidebar: Inspector

Shows properties for the currently selected block:
- Text content
- Links (href)
- Images (src, alt text)
- Styling (CSS class)
- Section properties (background, padding, etc.)

Edit these fields to customize your content.

### Top Toolbar

**Left section:**
- Mode switcher (Visual ↔ Code)
- Project info
- Dirty indicator (● = unsaved changes)

**Right section:**
- **Save**: Save your page
- **Preview**: Start the development server and open a preview in your browser
- **Publish**: Build for production

## Creating Your First Page

1. On the left sidebar, click **+ New Page**
2. Enter a page slug (e.g., `about` → `/about`):
   - Slugs must be lowercase
   - Hyphens `-` are allowed, and spaces are auto-converted
   - `index` creates the homepage
3. Click **Create**
4. Manage the page metadata:
   - **Title**: Page title (shows in browser tab)
   - **Nav Label**: Name in site navigation
   - **Meta Description**: SEO description
   - **Show in Navigation**: Toggle visibility in header menu
5. Click **Done**

## Adding Content to Your Page

### Visual Mode (Default)

1. Click the **+ Add Block** button to open the block palette
2. Choose a block type (heading, text, image, button, gallery, etc.)
3. Click the block to edit it
4. In the right inspector, update:
   - Content (text, links, image URLs)
   - Styling (colors, sizing, CSS classes)
5. Press **Ctrl+Enter** to confirm multi-line edits, or **Enter** to save single-line edits

### Code Mode

For advanced users or detached pages:

1. Click **Code** in the top toolbar
2. Edit the raw Astro/JSX source directly
3. Use CodeMirror's syntax highlighting
4. Click **Visual** to return to drag-and-drop editing

> 💡 **Tip**: Some pages may be "detached" (shown in the page list with a special icon). Detached pages can only be edited in Code mode. See [Workflows](./WORKFLOWS.md#detach--reattach-pages) for details.

## Previewing Your Site

Click **Preview** to:
1. Start the Astro development server (`npm run dev`)
2. Open your site in a web browser
3. See live changes as you edit (with hot reload)
4. Review design tokens and custom fonts

The preview window stays open while you edit. Click **Stop Preview** to shut down the server.

> 💡 **Note**: If you're using custom Google Fonts, they won't load in the editor preview due to security settings, but they will load in the real dev server and production build.

## Publishing Your Site

When you're ready to go live:

1. Click **Publish**
2. Zephus runs `npm run build` to create a production build
3. Your site is output to the project's `dist/` folder (by default)

From here, you can deploy to:
- **Netlify Drop**: Drag and drop to deploy
- **Cloudflare Pages**: Git-connected deployment
- **GitHub Pages**: Host from your repository
- **Any static host**: Upload the `dist/` folder contents

## Next Steps

- **Learn all content blocks**: See [Block Reference](./BLOCK_REFERENCE.md) for the 20 available block types
- **Customize your site design**: See [Workflows: Configure Design](./WORKFLOWS.md#configure-your-site-design)
- **Configure the site header/footer**: See [Workflows: Site Shell](./WORKFLOWS.md#configure-site-shell-header-nav-footer)
- **Manage reusable sections**: See [Workflows: Reusable Sections](./WORKFLOWS.md#save--reuse-sections)
- **Adjust app preferences**: See [Settings](./SETTINGS.md)

---

**Have questions?** Check out [Troubleshooting](./TROUBLESHOOTING.md) or explore the full [Workflows Guide](./WORKFLOWS.md).
