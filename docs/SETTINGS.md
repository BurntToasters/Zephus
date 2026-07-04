# Settings & Preferences

Configure Zephus behavior and appearance to match your workflow.

## Opening Settings

1. On the **Start** screen, click the **Settings** tab
2. Or, if editing a project, look for **⚙️ Settings** in the top menu
3. The settings panel opens

---

## General Preferences

### Theme

Choose how Zephus looks:

- **System**: Match your OS theme (Light/Dark)
- **Light**: Always use light mode
- **Dark**: Always use dark mode

---

### Auto-Save

**Default:** Off

When enabled, Zephus saves your page work-in-progress every few seconds to `.zephus/drafts/`. This prevents losing work if the app crashes.

> 💡 **Recommendation:** Enable auto-save for safety, but always use **Ctrl+S** before publishing to ensure changes are committed to disk.

---

### Confirm Before Deleting

**Default:** On

When enabled, you'll see a confirmation dialog before deleting blocks or pages. Disable if you prefer quick deletions without confirmation.

---

### Restore Last Project on Startup

**Default:** Off

When enabled, Zephus automatically reopens the last project you were editing when you launch the app.

---

## Editor Settings

### Code Font Size

**Default:** 13px

Adjust the text size in Code mode editor. Range: 12px–18px.

---

## Update Settings

### Update Channel

Choose how Zephus checks for updates:

| Channel | Release Schedule | Stability |
|---------|------------------|-----------|
| **Auto** | Automatically chooses based on your version | Recommended for most users |
| **Stable** | Final releases only | Recommended for production use |
| **Beta** | Pre-release versions | For testers and early adopters |
| **Developer** | Nightly builds | For developers only |

---

### Check for Updates

Click **Check for Updates** to manually check for a newer version.

---

## Node.js & Dependency Management

### Custom Node.js Path

**Default:** Automatic (system Node.js)

If you have multiple Node.js versions installed or want to use a specific one, enter the full path here:

**Windows example:** `C:\Program Files\nodejs\node.exe`
**macOS example:** `/usr/local/bin/node`
**Linux example:** `/usr/bin/node`

Zephus uses this Node.js version to run:
- `npm run dev` (preview)
- `npm run build` (publish)
- Theme preview generation

> 💡 **Tip:** You need Node.js 22.12+ for Zephus to work properly. Check your version with `node --version` in terminal.

---

### View Node.js Status

1. In Settings, look for **Node.js Status**
2. See the detected Node.js version and path
3. If there's a problem, you'll see an error message with next steps

---

## About Zephus

### View App Version

See your current Zephus version (e.g., `0.1.0-db.5`).

---

### View Third-Party Licenses

Zephus bundles several open-source libraries:

- **Electron**: App framework
- **Chromium**: Browser engine
- **CodeMirror**: Code editor
- **Lucide**: Icon library
- And others...

Click **Open Licenses** to view the full list of licenses.

---

### Open Config Directory

Click **Open Config Directory** to reveal the folder where Zephus stores global settings:

```
~/.config/Zephus/  (Linux)
~/Library/Application Support/Zephus/  (macOS)
%APPDATA%\Zephus\  (Windows)
```

Inside, you'll find:
- `settings.json`: Global app settings
- `reusable-sections.json`: Saved section templates
- `drafts/`: Auto-saved work-in-progress

> 💡 **Tip:** You can manually edit `settings.json` if needed, but restart Zephus to apply changes.

---

## Project-Specific Settings

These settings are stored per project in `.zephus/settings.json`:

### Editor Rules

Control which blocks are allowed and editing behavior for this project:

```json
{
  "editorRules": {
    "allowedBlocks": ["heading", "text", "image", "button"],
    "maxHeadingLevel": 3
  }
}
```

- **allowedBlocks**: Array of block type IDs to show in the palette (null = all allowed)
- **maxHeadingLevel**: Maximum heading level (1–6)

> ⚠️ **Advanced feature:** These are typically managed programmatically. Edit `.zephus/settings.json` manually only if needed.

---

## Keyboard Shortcuts

### General

| Shortcut | Action |
|----------|--------|
| **Ctrl+S** | Save current page |
| **Ctrl+Z** | Undo |
| **Ctrl+Y** | Redo |

### Code Mode

| Shortcut | Action |
|----------|--------|
| **Ctrl+F** | Find |
| **Ctrl+H** | Find & Replace |
| **Ctrl+Enter** | Commit multi-line edits |
| **Tab** | Indent |
| **Shift+Tab** | Unindent |

### Visual Mode

| Shortcut | Action |
|----------|--------|
| **Enter** | Confirm single-line edit |
| **Ctrl+Enter** | Confirm multi-line edit |
| **Arrow Up/Down** | Reorder blocks (when block is selected) |

---

## Troubleshooting Settings

### "Node.js Not Found"

Zephus couldn't detect Node.js on your system.

**Fix:**
1. Install [Node.js 22.12+](https://nodejs.org)
2. Restart Zephus
3. If still not detected, manually enter the path in **Custom Node.js Path**

---

### "Cannot Start Preview"

The development server failed to start.

**Check:**
1. Node.js is installed (see above)
2. Your project has a valid `package.json`
3. Dependencies are installed (`npm install` in project folder)
4. Try manually running `npm run dev` in the project directory

---

### "Auto-Save Failed"

Zephus couldn't save a draft.

**Likely causes:**
1. Disk is full
2. Permission issue on `.zephus/drafts/` folder
3. Antivirus software blocking writes

**Fix:**
1. Check disk space
2. Ensure Zephus has write permissions
3. Check antivirus exclusions

---

## Advanced: Manual Config Edit

For power users, you can directly edit configuration files:

### Global Settings

**File:** `~/.config/Zephus/settings.json` (Linux/macOS) or `%APPDATA%\Zephus\settings.json` (Windows)

```json
{
  "theme": "dark",
  "autosave": true,
  "codeFontSize": 14,
  "customNodePath": "/usr/bin/node",
  "confirmBlockDelete": true,
  "restoreLastProject": false,
  "updateChannel": "stable",
  "recentProjects": ["/path/to/project1", "/path/to/project2"]
}
```

**After editing:** Restart Zephus to apply changes.

---

### Project Settings

**File:** `.zephus/settings.json` in your project folder

```json
{
  "schemaVersion": 1,
  "theme": "my-theme",
  "editorRules": {
    "allowedBlocks": null,
    "maxHeadingLevel": 6
  }
}
```

---

## Next Steps

- **Not sure how to do something?** Check [Workflows](./WORKFLOWS.md) for step-by-step guides
- **Block types confusing you?** See [Block Reference](./BLOCK_REFERENCE.md)
- **Running into issues?** See [Troubleshooting](./TROUBLESHOOTING.md)

---

**Still have questions?** Reach out to the Zephus community.
