# Zephus User Documentation

This guide explains how to create, edit, preview, and publish Astro sites with Zephus.

## Quick Navigation

### 📚 Main Guides

1. **[Getting Started](./GETTING_STARTED.md)**: First 5 minutes with Zephus
   - Create your first site from a template
   - Add pages and content
   - Preview and publish your site

2. **[Block Reference](./BLOCK_REFERENCE.md)**: All 20 content block types
   - Text, images, galleries, buttons
   - Cards, columns, pricing, testimonials
   - Sections, embeds, HTML custom blocks
   - Properties and examples for each

3. **[Workflows](./WORKFLOWS.md)**: Step-by-step tutorials
   - Manage pages (create, rename, duplicate, delete)
   - Configure site header, nav, and footer
   - Set up colors, fonts, and design tokens
   - Import and use images
   - Reuse section layouts
   - Edit in code mode
   - Handle external file changes
   - Manage auto-saves

4. **[Settings](./SETTINGS.md)**: Configuration & preferences
   - App theme and appearance
   - Auto-save and editor options
   - Node.js version management
   - Update channels
   - Keyboard shortcuts

5. **[Troubleshooting](./TROUBLESHOOTING.md)**: Common issues & fixes
   - Getting started issues
   - Preview and build errors
   - Page editing problems
   - Asset and image issues
   - Save and sync issues
   - Performance tips

---

## What is Zephus?

**Zephus** is a local-first visual editor for [Astro](https://astro.build) websites. It combines:

- 🎨 **Visual drag-and-drop editor**: No coding required (optional)
- 📝 **Code mode**: Full Astro/JSX control when needed
- 💾 **Local-first**: Sites live on your machine, backed by Git
- 🚀 **One-click deploy**: Publish to Netlify, Cloudflare Pages, GitHub Pages, or anywhere
- 🔄 **No accounts**: No cloud databases, no lock-in, just Git

### Key Constraints

> ⚠️ **Important:** Zephus can **only edit sites created within Zephus**. If you try to open a regular Astro project, it won't work. Zephus uses a custom schema that's incompatible with standard Astro sites.

---

## Getting Started (30 Seconds)

1. **Open Zephus** and click **Explore Templates**
2. **Choose a theme** (Documentation, Blog, Portfolio, etc.)
3. **Select an empty folder** for your project
4. Zephus creates the site and opens the editor
5. Click **+ New Page** to add your first page
6. Drag blocks from the palette to build your content
7. Click **Preview** to see your site in a browser
8. Click **Publish** when ready to deploy

→ [Full Getting Started Guide](./GETTING_STARTED.md)

---

## The Editor Interface

### Left Sidebar
Your site's pages listed in a menu. Click to edit, click the eye icon to toggle visibility, use ⋯ menu for more options.

### Center (Canvas)
Your main editing area. Add blocks with the **+ Add Block** button, then click blocks to edit their content and properties.

### Right Sidebar (Inspector)
Properties for the currently selected block. Edit text, links, images, colors, and other settings here.

### Top Toolbar
**Left:** Mode switcher (Visual ↔ Code), project info
**Right:** Save, Preview, Publish buttons

---

## Content Blocks at a Glance

Zephus provides **20 content block types** organized by category:

| Category | Blocks |
|----------|--------|
| **Text** | Heading, Text, Quote, List, Divider, Spacer |
| **Media** | Image, Gallery, Embed |
| **Interactive** | Button, HTML |
| **Cards & Layouts** | Card, Columns, Section |
| **Marketing** | Feature, Testimonial, Stats, Pricing, CTA, Accordion |

→ [Full Block Reference](./BLOCK_REFERENCE.md)

---

## Common Workflows

### Create a Page
1. Click **+ New Page** in left sidebar
2. Enter a slug (URL path, e.g., `about`)
3. Set page title, nav label, etc.
4. Click **Done**

→ [Full Page Management Guide](./WORKFLOWS.md#manage-pages)

---

### Add Content
1. Click **+ Add Block** on the canvas
2. Choose a block type (heading, text, image, etc.)
3. Click the block to edit
4. Modify content and properties in the right inspector
5. Press **Ctrl+S** to save

→ [Block Reference](./BLOCK_REFERENCE.md)

---

### Customize Design
1. Find **Design System** in your project menu
2. Set colors (accent, background, foreground, surface)
3. Choose fonts (body, heading)
4. Set layout tokens (width, radius, shadows)
5. Click **Save**

→ [Design Configuration Guide](./WORKFLOWS.md#configure-your-site-design)

---

### Configure Header & Footer
1. Open **Site Shell** settings
2. Enter site title, logo text, nav button
3. Add announcement bar text (optional)
4. Add footer HTML
5. Click **Save**

→ [Site Shell Guide](./WORKFLOWS.md#configure-site-shell-header-nav-footer)

---

### Import Images & Assets
1. Click **Import Image** (or drag & drop an image onto the canvas)
2. Choose a file from your computer
3. Use the path in image blocks

→ [Asset Management Guide](./WORKFLOWS.md#work-with-images--assets)

---

### Preview Your Site
1. Click **Preview** in the top toolbar
2. Your site opens in a browser with live reload
3. Make changes in Zephus, then see them instantly in the browser
4. Click **Stop Preview** to close

---

### Publish to Production
1. Click **Publish** in the top toolbar
2. Zephus runs `npm run build`
3. Your site is output to `dist/` (or your configured output directory)
4. Deploy to:
   - **Netlify Drop**: Drag & drop deploy
   - **Cloudflare Pages**: Git-connected
   - **GitHub Pages**: Via Git
   - **Any host**: Upload `dist/` contents

---

## Visual vs. Code Mode

### Visual Mode (Default)
- Drag blocks up/down to reorder
- Click blocks to edit content
- Point-and-click styling
- Good for non-developers
- Can't use if page is "detached"

### Code Mode
- Edit raw Astro/JSX source
- Full control, no restrictions
- CodeMirror syntax highlighting
- Better for developers
- Required for "detached" pages

→ [Code Mode Guide](./WORKFLOWS.md#edit-pages-in-code-mode)

---

## Advanced Topics

### Detach & Reattach Pages
Sometimes you need full control. **Detach** a page to edit raw code, then **Reattach** to return to visual editing.

→ [Detach & Reattach Guide](./WORKFLOWS.md#detach--reattach-pages)

---

### Reusable Sections
Save a section layout as a template, then reuse it on other pages.

→ [Reusable Sections Guide](./WORKFLOWS.md#save--reuse-sections)

---

### Auto-Save Drafts
Enable **Auto-Save** in Settings to save work-in-progress automatically every few seconds. Recover unsaved work if Zephus crashes.

→ [Draft Management Guide](./WORKFLOWS.md#manage-draft-auto-saves)

---

### External File Changes
If you edit a page outside Zephus (in VS Code, Git, etc.), Zephus detects it and prompts you to reload or keep your version.

→ [External Changes Guide](./WORKFLOWS.md#handle-external-changes)

---

## Requirements

- **Node.js 22.12+** (check with `node --version`)
- **Git** (Zephus can initialize a repo if needed)
- **An empty folder** for your new site
- **macOS, Windows, or Linux**

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+S** | Save |
| **Ctrl+Z** | Undo |
| **Ctrl+Y** | Redo |
| **Ctrl+F** (in code mode) | Find |

---

## Tips for Success

✅ **Enable auto-save** in Settings (prevents losing work)
✅ **Use meaningful page slugs** (e.g., `/blog/my-post` instead of `/post-1`)
✅ **Add alt text to images** (helps accessibility and SEO)
✅ **Test on mobile** (use preview browser devtools)
✅ **Commit to Git regularly** (version control backup)
✅ **Use Ctrl+S frequently** (extra safety before publishing)
✅ **Avoid editing the same file in two places** (Git conflicts)

---

## Limitations & Important Notes

- **Zephus-only projects**: Can't edit existing Astro sites
- **No custom components**: Fixed 20 block types (no component builder)
- **Single schema version**: Major Zephus updates may require migration
- **Detach/reattach**: Reattaching overwrites code changes
- **Design tokens**: Live preview except Google Fonts (which don't load in CSP sandbox)

---

## Support & Resources

**Documentation Structure:**
- 📖 [Getting Started](./GETTING_STARTED.md): First steps
- 🧩 [Block Reference](./BLOCK_REFERENCE.md): All block types
- 📋 [Workflows](./WORKFLOWS.md): Detailed tutorials
- ⚙️ [Settings](./SETTINGS.md): Configuration
- 🐛 [Troubleshooting](./TROUBLESHOOTING.md): Common issues & fixes

**External Links:**
- [Astro Documentation](https://docs.astro.build): The framework Zephus uses
- [Zephus GitHub](https://github.com/yourusername/zephus): Source code

---

## What's New?

Zephus is actively developed. Check the **About** section in the app for your current version and check for updates in Settings.

---

## FAQ

### Can I use my existing Astro site?
No, Zephus can only edit sites created within Zephus. It uses a custom schema incompatible with standard Astro projects. You'll need to recreate your site in Zephus.

### Is my data safe?
Yes. Your site lives entirely on your machine. Everything is backed by Git, and Zephus does not send site data to cloud services.

### Can I edit my site in VS Code?
You can detach a page to edit raw code. For full control, we recommend using VS Code for advanced edits, then re-creating the visual structure in Zephus or staying in code mode.

### What if I need more control?
Code mode gives you full Astro/JSX control. You can switch to code mode for any page and edit raw markup.

### Can I use custom CSS?
Yes. Every block has a `cls` property for CSS classes. Use your site's custom CSS file (`public/styles/zephus-custom.css`), or add inline CSS via the HTML block.

### Can I add custom fonts?
Yes. In Design System settings, you can:
- Use Google Fonts (paste the import URL)
- Use system fonts (enter font stack)
- Add @font-face rules in custom CSS

### How do I deploy?
Zephus builds to `dist/` (by default). Deploy to:
- **Netlify Drop**: Drag & drop
- **Cloudflare Pages**: Git-connected
- **GitHub Pages**: Push `dist/` to `gh-pages` branch
- **Any host**: Upload `dist/` contents

### What's the performance like?
Astro sites are fast by default (static HTML). Zephus editor performance is good for typical pages. Large pages (100+ blocks) may feel slow, so split them into multiple pages when needed.

---

**Ready to get started?** → [Getting Started Guide](./GETTING_STARTED.md)

**Have questions?** → [Troubleshooting](./TROUBLESHOOTING.md)

**Want to learn more?** → [Block Reference](./BLOCK_REFERENCE.md)

---

*Zephus is a local-first, schema-backed visual editor for Astro websites. Your sites live on your machine, are backed by Git, and require no external accounts or cloud databases.*
