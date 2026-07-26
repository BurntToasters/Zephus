# Workflows & Tutorials

Step-by-step guides for common tasks in Zephus.

## Table of Contents

1. [Manage Pages](#manage-pages)
2. [Configure Site Shell (Header, Nav, Footer)](#configure-site-shell-header-nav-footer)
3. [Configure Your Site Design](#configure-your-site-design)
4. [Work with Images & Assets](#work-with-images--assets)
5. [Save & Reuse Sections](#save--reuse-sections)
6. [Edit Pages in Code Mode](#edit-pages-in-code-mode)
7. [Detach & Reattach Pages](#detach--reattach-pages)
8. [Handle External Changes](#handle-external-changes)
9. [Manage Draft Auto-Saves](#manage-draft-auto-saves)
10. [Version Control with Git](#version-control-with-git)

---

## Manage Pages

### Create a New Page

1. Click **+ New Page** in the left sidebar
2. Enter a **page slug** (URL):
   - Use lowercase letters, numbers, and hyphens
   - Spaces are auto-converted to hyphens
   - `index` creates the homepage at `/`
   - `about/team` creates `/about/team` (nested route)
3. Click **Create**
4. Edit page metadata:
   - **Title**: Browser tab and page heading (default)
   - **Nav Label**: Name shown in site navigation
   - **Meta Description**: Short summary for search engines and social media
   - **Show in Navigation**: Toggle visibility in the header menu
5. Click **Done**

Your new page appears in the page list. Click it to start editing.

---

### Rename a Page

1. Click the **⋯ menu** next to the page name
2. Select **Rename**
3. Enter a new slug (e.g., `about-us`)
4. Press **Enter** or click **Save**

> ⚠️ **Note**: Renaming changes the page's URL. Links pointing to the old URL will break. Update any button links or nav items that reference the old URL.

---

### Duplicate a Page

1. Click the **⋯ menu** next to the page name
2. Select **Duplicate**
3. Enter a new slug (e.g., `about-us-2`)
4. Click **Duplicate**

The new page copies all blocks and styling from the original. Modify it as needed.

---

### Delete a Page

1. Click the **⋯ menu** next to the page name
2. Select **Delete**
3. Confirm the deletion

> ⚠️ **Warning**: You cannot delete the homepage (`index`). If you want a blank homepage, edit it instead of deleting.

---

### Hide a Page from Navigation

1. In the left sidebar, click the **👁️ icon** next to the page name
2. The icon toggles between:
   - **👁️ visible**: Shown in site header navigation
   - **👁️‍🗨️ hidden**: Hidden from navigation (still accessible via direct URL)

> 💡 **Tip**: Use hidden pages for thank-you pages, landing pages, or pages you reference from buttons instead of the main nav.

---

### Manage Page Metadata

1. Click the **⋯ menu** next to the page name
2. Select **Manage**
3. Edit:
   - **Page Title**: Text shown in browser tab and default page heading
   - **Slug**: URL path (e.g., `/about`)
   - **Nav Label**: Name in navigation menu
   - **Meta Description**: SEO description (appears in search results)
   - **Show in Navigation**: Toggle visibility
4. Click **Save**

---

## Configure Site Shell (Header, Nav, Footer)

The "site shell" is the header, navigation bar, and footer that appear on every page.

### Customize Header & Navigation

1. Look for the **Site Shell** button or link in your project view
2. A modal opens with these fields:
   - **Site Title**: Main branding text
   - **Logo Text**: Text logo in the header (typically same as site title)
   - **Nav CTA Label**: Button text in the header (e.g., "Get Started")
   - **Nav CTA Href**: Button link (e.g., `/signup`)
   - **Announcement Bar**: Optional banner text
   - **Show Announcement**: Toggle visibility of banner

3. Edit the fields and click **Save**

> 💡 **Pro Tip**: If no pages have "Show in Navigation" enabled, users won't see your nav menu. The editor shows a friendly warning if this happens.

---

### Add a Footer

1. Open the **Site Shell** modal (see above)
2. Scroll to **Footer HTML**
3. Enter HTML for your footer, e.g.:
   ```html
   <p>&copy; 2024 My Company. All rights reserved.</p>
   <p><a href="/privacy">Privacy</a> | <a href="/terms">Terms</a></p>
   ```
4. Click **Save**

The footer appears on every page.

---

### Add Custom Head HTML (Advanced)

For analytics, meta tags, or scripts that belong in the `<head>`:

1. Open the **Site Shell** modal
2. Scroll to **Custom Head HTML**
3. Enter raw HTML, e.g.:
   ```html
   <meta name="og:title" content="My Site">
   <script async src="https://analytics.example.com/script.js"></script>
   ```
4. Click **Save**

> ⚠️ **Warning**: Custom head HTML bypasses safety checks. Only paste trusted code.

---

## Configure Your Site Design

Set colors, fonts, and layout tokens for your entire site.

### Open Design System Settings

1. Look for the **Design System** or **Colors & Fonts** button in your project
2. A modal opens with these sections:
   - **Colors**
   - **Typography**
   - **Layout**

---

### Set Colors

| Token | Purpose | Example |
|-------|---------|---------|
| **Accent** | Primary brand color (buttons, links) | `#4f46e5` (indigo) |
| **Background** | Page background | `#ffffff` (white) |
| **Foreground** | Text color | `#0f172a` (dark blue) |
| **Surface** | Secondary background (footer, cards) | `#f8fafc` (light gray) |

1. Click a color field
2. Enter a hex color (e.g., `#ff6b6b`) or use the color picker
3. Click **Save**

The canvas preview updates in real time (except Google Fonts, which won't load due to security).

---

### Set Fonts

| Token | Purpose | Example |
|--------|---------|---------|
| **Body Font** | Paragraph and body text | "Segoe UI, sans-serif" |
| **Heading Font** | H1–H6 and titles | "Inter, sans-serif" |

**Using Google Fonts:**

1. Visit [Google Fonts](https://fonts.google.com)
2. Select a font and click **Get font**
3. Copy the import URL (e.g., `https://fonts.googleapis.com/css2?family=Inter:wght@400;700`)
4. Paste into the **Font Import URL** field in Zephus
5. Paste the CSS font stack (e.g., `'Inter', sans-serif`) into the font field

**Fallback stacks (no download):**
```
ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif
```

---

### Set Layout Tokens

| Token | Purpose | Example |
|--------|---------|---------|
| **Container Width** | Max width of page content | `1080px`, `90vw` |
| **Border Radius** | Roundedness of elements | `14px`, `0px` |
| **Shadow** | Depth of shadows | "sm", "md", "lg", "none" |

1. Enter values for container width (e.g., `1200px`)
2. Choose shadow level (`sm` for subtle, `lg` for dramatic)
3. Click **Save**

---

## Work with Images & Assets

### Import an Image

**Method 1: Import Dialog**
1. Click **Import Image** or **+ Assets** button
2. Choose a file from your computer (`.jpg`, `.png`, `.svg`, `.gif`, `.webp`)
3. Click **Open**
4. The image is copied to `.zephus/assets/` and assigned a web path

**Method 2: Drag & Drop**
1. Drag an image file from your computer
2. Drop it into the editor canvas
3. A new image block is created with the image

---

### Use an Image in a Block

**Image Block:**
1. Add an **Image** block
2. In the right inspector, click on the `src` field
3. Paste the image path or click **Browse** to select from imported assets
4. Enter `alt` text (important for accessibility)
5. Optionally add CSS classes for styling

**Gallery Block:**
1. Add a **Gallery** block
2. In the inspector, enter image paths (one per line):
   ```
   /images/photo-1.jpg
   /images/photo-2.jpg
   /images/photo-3.jpg
   ```

---

### View All Assets

1. Click **Assets** in the sidebar or project view
2. See all imported images, videos, and documents
3. Browse by category:
   - **Images**: `.jpg`, `.png`, `.svg`, `.gif`, `.webp`
   - **Media**: Videos and audio
   - **Documents**: PDFs, Word docs
   - **Other**: Miscellaneous files
4. Copy the web path to use in blocks

---

### Delete an Asset

1. Open the **Assets** view
2. Find the asset you want to delete
3. Click the **X** or **Delete** button
4. Confirm

> ⚠️ **Warning**: Deleting an asset breaks any image blocks using it. Update those blocks before deleting.

---

## Save & Reuse Sections

Save a frequently-used layout as a reusable template.

### Create a Reusable Section

1. Edit your page and create a nice section layout (e.g., a three-column card grid)
2. Once you're happy with it, click **Save as Template** or **Save Section**
3. Give it a memorable name (e.g., "Three-Column Cards")
4. Click **Save**

The section is stored in your site's reusable sections library.

---

### Insert a Reusable Section

1. Click **+ Reusable Sections** or **Insert Template** in the block palette
2. Choose a saved section from the list
3. The section is inserted into your page
4. Edit the content as needed

---

### Manage Reusable Sections

1. Open the **Reusable Sections** or **Templates** view
2. See all saved templates
3. **Update** a template: Edit a page, then save the layout again with the same name
4. **Delete**: Remove a template (this does not affect pages already using it)
5. **Rename**: Change the template name

---

## Edit Pages in Code Mode

For developers or advanced customization, edit raw Astro/JSX.

### Switch to Code Mode

1. Open a page for editing
2. Click **Code** in the top toolbar (next to **Visual**)
3. The canvas switches to a code editor powered by CodeMirror
4. Edit the Astro/JSX source directly

---

### Code Mode Features

- **Syntax highlighting** for HTML, JSX, CSS
- **Line numbers** and error indicators
- **Ctrl+Enter** to commit multi-line changes
- **Ctrl+Z / Ctrl+Y** for undo/redo
- **Ctrl+F** to find and replace

---

### Return to Visual Mode

1. Click **Visual** in the toolbar
2. Your code is parsed back into blocks
3. If there are parsing errors, you'll see a warning

> ⚠️ **Warning**: If your code doesn't fit the Zephus block schema, you won't be able to return to visual mode. See [Detach & Reattach Pages](#detach--reattach-pages).

---

## Detach & Reattach Pages

Sometimes you need full control over a page's code. Zephus allows you to "detach" a page temporarily.

### What is a Detached Page?

- A **managed page** uses Zephus blocks and can be edited visually
- A **detached page** is pure Astro/JSX code, edited in Code mode only
- Detached pages lose visual editing until you reattach them

---

### Detach a Page

1. Open a page for editing
2. Click the **⋯ menu** or **Page Options**
3. Select **Detach**
4. A dialog appears asking you to confirm
5. Click **Detach**

The page is now in Code-only mode. The page list shows a special icon (e.g., 📝) to indicate it's detached.

---

### Reattach a Page

1. Open a detached page (in Code mode)
2. Click the **⋯ menu** or **Page Options**
3. Select **Reattach**
4. Confirm

Zephus attempts to parse your code back into blocks. If successful, you can return to visual editing.

> ⚠️ **Warning**: Reattaching **overwrites** your code changes with the block schema. Commit important changes to Git before reattaching.

---

## Handle External Changes

If you edit a page file outside of Zephus (e.g., in VS Code), Zephus detects the change.

### What Happens?

1. You're editing a page in Zephus
2. The file is modified externally (in VS Code, command line, etc.)
3. Zephus shows a prompt:
   - **"Reload"**: Discard your Zephus changes, then load the external version
   - **"Keep"**: Keep your Zephus changes, and ignore the external edit
   - **"Show Diff"**: Review changes before deciding

---

### Best Practice

- **Avoid editing the same page in two places simultaneously**
- If you need to hand-edit, detach the page first
- Use Git to merge changes if needed

---

## Manage Draft Auto-Saves

Zephus automatically saves work-in-progress drafts to `.zephus/drafts/`.

### Auto-Save Behavior

- **Default:** Off
- **When enabled:** Zephus saves the project when you **leave a page** or switch context (instead of prompting to save or discard)
- **Crash recovery:** Zephus still keeps local recovery drafts under `.zephus/drafts/` even when Auto-Save is off
- **Disk commits:** Use **Ctrl+S** or **Save** to write pages to disk anytime

---

### Enable Auto-Save

1. Click **Settings** on the start screen (or open Settings from the editor)
2. Enable **Autosave changes**
3. Read the hint under the toggle for how autosave differs from crash-recovery drafts

---

### Resume a Saved Draft

1. If Zephus detects unsaved work on startup, it may offer to resume a draft
2. Click **Resume** to continue editing
3. Or click **Discard** to start fresh

---

### Manual Save vs. Auto-Save

| Action | Effect |
|--------|--------|
| **Ctrl+S** | Saves page to disk immediately |
| **Click Save** | Same as Ctrl+S |
| **Auto-Save (if enabled)** | Saves when leaving a page or resolving site editor conflicts without a prompt |
| **Crash-recovery drafts** | Local safety net; not a substitute for **Ctrl+S** before publish |

> 💡 **Tip**: Enable auto-save if you often switch pages without saving. Still press **Ctrl+S** before publishing.

---

## Version Control with Git

Zephus projects are ordinary Git repositories on disk. You can use the terminal or the **Git** panel in the editor sidebar.

### Initialize a Repository

**When opening a project:** Zephus may offer to run `git init` if the folder is not yet a repo.

**From the editor:** Open the **Git** panel. If Git is unavailable because the folder is not a repository, click **Initialize Git Repository**, then **Refresh**.

> 💡 **Commit `.zephus/`:** Zephus stores managed page JSON and project state there. If `.zephus` is git-ignored, the panel warns you—remove it from `.gitignore` so the site opens correctly on other machines.

---

### Review Changes

1. Open the **Git** panel in the left sidebar
2. Click **Refresh** to update the file list
3. Changed files show badges: **M** (modified), **A** (added), **D** (deleted)

---

### Commit from Zephus

1. Check the files you want to include (use **Select all** / **Clear** as needed)
2. Enter a **commit message**
3. Click **Commit All Changes** when every changed file is selected, or **Commit N Selected** for a partial commit
4. Zephus runs `git add` on the selected paths and `git commit`

For full control (interactive staging, hooks, signing), use your terminal in the project folder.

---

### Push and Pull

When a branch is checked out (not detached HEAD), the Git panel toolbar includes:

- **Pull (Fast-Forward)** — runs `git pull --ff-only` (fails if a merge is required; resolve on the command line)
- **Push to Remote** — runs `git push` to the configured upstream

When the branch tracks a remote (`@{upstream}`), the branch label shows **↑N** / **↓N** (local commits to push / remote commits to pull), and the panel explains what to do next. Click **Refresh** to run a quiet `git fetch` and update those counts; routine status updates (e.g. after save) use the last fetch only.

After a pull, if Astro sources changed outside Zephus, use **Reload From Disk** on the editor banner when prompted, or reload the page from the page list.

---

### Detached HEAD

If you see **detached HEAD** in the branch tag, check out a branch in your terminal (`git checkout main`) before committing or pushing from Zephus.

---

**Need more help?** See [Troubleshooting](./TROUBLESHOOTING.md) or check the [Block Reference](./BLOCK_REFERENCE.md).
