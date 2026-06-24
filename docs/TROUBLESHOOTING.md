# Troubleshooting

Common issues and how to fix them.

## Getting Started Issues

### "Choose an empty folder for the new site"

You selected a folder that already has files in it.

**Fix:**
1. Create a new, empty folder on your computer
2. In Zephus, click **Choose Folder & Create Site**
3. Select the empty folder
4. Try again

---

### Site Creation Fails with Error

Zephus couldn't scaffold the project.

**Likely causes:**
- Insufficient disk space
- Permission issues on the folder
- Corrupted theme data

**Fix:**
1. Ensure the folder is empty and writable
2. Try a different folder
3. Restart Zephus and try again
4. If persistent, check that Node.js is installed (`node --version`)

---

### "The app can't find your project"

Zephus couldn't open your site.

**Likely cause:** The `.zephus` folder is missing or corrupt.

**Fix:**
1. Open your project folder in file explorer
2. Check that a `.zephus/` folder exists
3. If missing, you'll need to recreate the project
4. If it exists but is corrupt, restore from Git: `git checkout .zephus/`

---

## Preview & Build Issues

### "Cannot start preview server"

Clicking **Preview** shows an error.

**Likely causes:**
- Node.js not installed or wrong version
- `npm install` hasn't been run
- Port 3000 is already in use
- `astro.config.mjs` is invalid

**Fix (in order):**
1. Check Node.js: `node --version` should be 22.12+
2. In your project folder, run: `npm install`
3. Try preview again
4. If port conflict, kill the process: `lsof -i :3000` (Linux/macOS) or `netstat -ano` (Windows)
5. Check `astro.config.mjs` syntax (should be valid JavaScript)
6. In Zephus Settings, try custom Node.js path

---

### "Preview loads but shows a blank page"

The dev server started, but nothing renders.

**Check:**
1. Are you on the homepage? (Navigate to `/` in the browser)
2. Do you have at least one page created?
3. Is the page's content saved?

**Fix:**
1. Ensure you have a page named `index` (homepage)
2. Add some blocks to it (e.g., a heading)
3. Save (Ctrl+S)
4. Refresh the preview browser (F5)

---

### "Preview works, but custom fonts don't load"

Google Fonts appear fine in the browser preview but not in the Zephus editor.

**This is expected.** The Zephus editor uses a sandbox with strict security, so external fonts won't load. But they **will** load in:
- The `npm run dev` preview
- The published production build

No action needed. This is by design.

---

### "Publish fails with npm build error"

Clicking **Publish** shows an error during the build.

**Check your build logs:**
1. Click **Publish**
2. If it fails, check the error message
3. Open terminal in your project folder
4. Run `npm run build` manually to see the full error

**Common causes:**
- Astro/dependency version conflict
- Invalid Astro component syntax
- Missing environment variables

**Fix:**
1. Try `npm install` to update dependencies
2. Check `package.json` for conflicting versions
3. Look for invalid Astro syntax in generated pages
4. Run `npm run build` locally to debug

---

## Page Editing Issues

### "Blocks won't reorder"

Drag-and-drop isn't working in visual mode.

**Check:**
1. Are you in **Visual** mode? (Not Code mode)
2. Is the block selected? (Click it first)
3. Are you dragging by the block's drag handle (⋯⋯)?

**Fix:**
1. Ensure you're in Visual mode (click **Visual** in toolbar)
2. Click a block to select it
3. Drag the block's drag handle (left side) up/down to reorder

---

### "Code mode won't parse back to visual"

You edited raw Astro code, but clicking **Visual** gives an error.

**Possible cause:** Your code doesn't fit the Zephus block schema.

**Fix:**
1. Stay in Code mode, which is a valid workflow
2. Or click **Detach** to permanently switch to code-only editing
3. If you want to revert to visual, restore from Git: `git checkout src/pages/yourpage.astro`

---

### "I accidentally deleted a block"

You can undo within the same session.

**Fix:**
1. Press **Ctrl+Z** (undo)
2. Or click the **↶** undo button if visible
3. If you already saved, restore from Git: `git checkout src/pages/yourpage.astro`

---

### "A page says 'out-of-sync'"

The page file was edited outside of Zephus.

**What happened:**
- You edited the page in VS Code, Git, or another tool
- Zephus detected the external change

**Fix:**
1. A prompt appears: **Reload** or **Keep**
2. Choose **Reload** to accept the external changes
3. Or **Keep** to stay with your Zephus edits
4. To prevent this: avoid editing the same file in two places simultaneously

---

### "I can't edit a detached page visually"

Detached pages are code-only by design.

**Fix:**
1. Click the **⋯ menu** on the page
2. Select **Reattach**
3. Confirm
4. The page switches back to visual editing

> ⚠️ **Warning**: Reattaching overwrites your code with the block schema. Commit to Git first.

---

## Asset & Image Issues

### "Image won't show on preview"

An image block displays as a placeholder or broken image icon.

**Check:**
1. Is the `src` path correct? (E.g., `/images/photo.jpg`)
2. Does the file exist in your project?
3. Is the file in the `public/` folder?

**Fix:**
1. Use **Import Image** to properly import the file
2. Or manually place the file in `public/images/` and reference it
3. Enter the path as `/images/filename.ext`

---

### "Imported images disappeared"

Assets you imported aren't accessible anymore.

**Possible cause:** You deleted the `.zephus/assets/` folder or moved files outside Zephus.

**Fix:**
1. Re-import the images using **Import Image**
2. Update any image blocks to use the new paths

---

### "Can't import large files"

Importing a video or large file fails.

**Limit:** Zephus stores assets locally. Very large files may exceed available disk space.

**Fix:**
1. Check available disk space
2. Try a smaller file
3. For large media, consider hosting externally and embedding (use **Embed** block for YouTube, etc.)

---

## Save & Sync Issues

### "Changes aren't saving"

You edited a page but the changes don't persist.

**Check:**
1. Did you click **Save** or press **Ctrl+S**?
2. Are you in **Visual** mode?
3. Do you have write permissions on the project folder?

**Fix:**
1. Press **Ctrl+S** to save manually
2. If auto-save is enabled, wait a few seconds
3. Check that the project folder is writable (not read-only)

---

### "Unsaved work disappeared"

You were editing, then Zephus crashed or closed unexpectedly.

**Recovery:**
1. Reopen Zephus
2. If unsaved drafts exist, you'll see a **Resume Draft** option on the start screen
3. Click **Resume** to restore your work

**If no resume option appears:**
1. Your changes may be lost unless auto-save was enabled
2. Restore from Git: `git checkout src/pages/yourpage.astro`

**Prevention:**
- Enable **Auto-Save** in Settings (saves every few seconds)
- Press **Ctrl+S** frequently when editing

---

### "Files conflict in Git"

You edited a file in Zephus and in Git simultaneously.

**Fix:**
1. Check Git status: `git status`
2. Resolve conflicts manually:
   ```bash
   git pull origin main
   # Resolve conflicts
   git add .
   git commit -m "Resolve conflicts"
   git push origin main
   ```
3. Reopen the project in Zephus to load the merged version

---

## Project & Navigation Issues

### "I can't see my pages in the navigation"

Pages exist but don't appear in the site header menu.

**Likely cause:** No pages have "Show in Navigation" enabled.

**Fix:**
1. Click the **👁️ icon** next to a page name in the left sidebar
2. Change it from **👁️‍🗨️ hidden** to **👁️ visible**
3. That page now appears in the site navigation

---

### "Homepage won't delete"

You can't delete the `index` page.

**This is intentional.** Every site needs a homepage.

**Fix:**
- If you want a blank homepage, edit it instead of deleting
- Or rename it to something else by renaming the `index` slug
- Then create a new `index` page

---

### "My project folder structure looks wrong"

The project doesn't have the typical Astro layout.

**Expected structure:**
```
my-project/
  src/
    pages/          ← Your page files go here
  public/           ← Images and assets
  .zephus/          ← Zephus data
  astro.config.mjs
  package.json
```

**Fix:**
- Check `astro.config.mjs` for custom `srcDir` or `pagesDir` settings
- If these are unusual, Zephus might not find your pages
- Ensure the project was created by Zephus (has `.zephus/` folder)

---

## Performance Issues

### "Editor feels slow or laggy"

Zephus is sluggish or takes time to respond.

**Likely causes:**
- Large pages with many blocks (100+)
- Insufficient RAM
- Background processes consuming CPU

**Fix:**
1. Split large pages into smaller ones (multiple pages per section)
2. Close other applications
3. Restart Zephus
4. Check system resources (Task Manager on Windows, Activity Monitor on macOS)

---

### "Preview takes forever to load"

The dev server is slow to start.

**Likely cause:** Dependencies aren't optimized or first build is cold.

**Fix:**
1. Wait a bit longer (first start can be 30+ seconds)
2. Check terminal output for errors
3. Run `npm install` manually to ensure all dependencies are present
4. Delete `node_modules/` and `.astro/`, then run `npm install` again

---

## Advanced Issues

### "Node.js version is wrong"

Zephus detects the wrong Node.js version, or none at all.

**Fix:**
1. Check your system version: `node --version`
2. In Zephus Settings, set **Custom Node.js Path** to the full path:
   - **Windows:** `C:\Program Files\nodejs\node.exe`
   - **macOS:** `/usr/local/bin/node`
   - **Linux:** `/usr/bin/node`
3. Restart Zephus

---

### "Git won't initialize"

Zephus couldn't create a Git repo in your project.

**Check:**
1. Is Git installed? (`git --version`)
2. Is the folder writable?
3. Is it already a Git repo?

**Fix:**
1. Install Git if needed
2. Manually initialize: `git init` in the project folder
3. Reopen the project in Zephus

---

## Getting Help

### Check the Logs

Zephus stores error logs you can review:

**Windows:** `%APPDATA%\Zephus\logs\`
**macOS:** `~/Library/Logs/Zephus/`
**Linux:** `~/.config/Zephus/logs/`

---

### Common Resources

- [Block Reference](./BLOCK_REFERENCE.md): What each block type does
- [Workflows](./WORKFLOWS.md): Step-by-step guides
- [Getting Started](./GETTING_STARTED.md): First steps
- [Settings](./SETTINGS.md): Configuration help

---

### Still Stuck?

If you're still having trouble:

1. Check the error message carefully, as it often hints at the fix
2. Review the relevant guide above
3. Check the project folder structure (is `.zephus/` there?)
4. Try restarting Zephus
5. Reach out to the Zephus community for help

---

**Common mistakes to avoid:**
- ❌ Editing Zephus projects outside the app → ✅ Use Zephus or detach first
- ❌ Deleting the `.zephus/` folder → ✅ Keep it, as it is essential
- ❌ Using Node.js <22.12 → ✅ Upgrade to Node.js 22.12+
- ❌ Not saving before publishing → ✅ Always Ctrl+S before publish
