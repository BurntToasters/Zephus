> [!NOTE]
> 📢 This is a Beta build. This build is intended for testing and early feedback.

# ⬇️ Downloads

| <img height="20" src="https://raw.githubusercontent.com/BurntToasters/bcls/main/media/windows.png" /> Windows | <img height="20" src="https://raw.githubusercontent.com/BurntToasters/bcls/main/media/mac.png" /> macOS | <img height="20" src="https://raw.githubusercontent.com/BurntToasters/bcls/main/media/linux.png" /> Linux |
| :--- | :--- | :--- |
| **EXE:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.2/Zephus-Windows-x64.exe) / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.2/Zephus-Windows-arm64.exe) | **[Universal DMG](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.2/Zephus-MacOS-universal.dmg)** | **AppImage:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.2/Zephus-Linux-x86_64.AppImage) <!-- / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.2/Zephus-Linux-arm64.AppImage) --> |
| | **[Universal ZIP](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.2/Zephus-MacOS-universal.zip)** | **DEB:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.2/Zephus-Linux-amd64.deb) <!-- / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.2/Zephus-Linux-arm64.deb) --> |
| | | **RPM:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.2/Zephus-Linux-x86_64.rpm) <!-- / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.2/Zephus-Linux-aarch64.rpm) --> |
| | | **Flatpak:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.2/Zephus-Linux-x86_64.flatpak) <!-- / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.2/Zephus-Linux-aarch64.flatpak) --> |

> [!IMPORTANT]
> The `.sig` files in this repo are NOT normal GPG signatures — they are for Zephus's built-in updater to verify the integrity of updates before downloading and installing.
>
> The `.asc` files are my normal GPG signatures which you can verify using my GPG Public Key: https://tuxedo.rosie.run/GPG/BurntToasters_0xF2FBC20F_public.asc
>
> ⚠️ Arm64 Linux Binaries are NOT available at the moment. The logic is setup in the repo in case people would like to build their own :)

### ℹ️ Enjoying Zephus? Consider [❤️ Supporting Me! ❤️](https://rosie.run/support)

---

## Changes in `v0.1.0-beta.2:`

### Editor — save & drafts
- **Direct save:** **Ctrl/Cmd+S**, toolbar **Save**, and dashboard **Save All** write pages and site settings to disk immediately (no extra confirmation modal).
- **Autosave vs drafts:** Settings, Help, and [Workflows](./docs/WORKFLOWS.md) clarify that **Autosave** saves when you leave a page or the editor; **crash-recovery drafts** are a local safety net and are not a substitute for **Ctrl/Cmd+S** before publish.
- **Draft restore:** Page and site crash-recovery drafts prompt on open with restore/discard; site drafts use the shared `site-shell` target.

### Editor — stability & parity
- **Render parity:** Shared `blockRender` + `renderHelpers` for build and editor; saved markup uses build heading levels and the same responsive `<style>` block as production builds.
- **Section wrapper:** Parsing managed pages defaults missing `wrapper` to `none` so visual save matches build output.
- **Locks:** Locked blocks/sections block cut, delete, move, paste-into, drop, and inspector edits (unlock/duplicate still work) with clear status text.
- **HTML blocks:** Inspector markup field for editing raw HTML in Visual mode.
- **Panel mount failures:** Solid panel/canvas mount errors surface in status, the editor banner, and a reload prompt when the canvas fails.
- **Out-of-sync pages:** Copy points to Reload From Disk or detach in Code instead of misleading “reattach” wording.
- **Inspector performance:** Property edits debounce canvas repaints while typing in text fields; one undo snapshot per inspector focus session.

### Git (in-app)
- **Commit:** List working-tree changes, select files, commit all or selected paths.
- **Push / pull:** Push to upstream; fast-forward-only pull (`git pull --ff-only`).
- **Init:** Initialize a repository when the project folder is not yet a Git repo.
- **Upstream sync:** Branch label shows **↑ahead** / **↓behind** when tracking a remote; **Refresh** (and post-commit/push/pull) runs a quiet `git fetch` before updating counts.

### Documentation
- **User docs:** Git panel, autosave, and publish workflows in [WORKFLOWS.md](./docs/WORKFLOWS.md); troubleshooting and settings aligned.
- **Developer docs:** [DEVELOPMENT.md](./docs/DEVELOPMENT.md) — build/test, render parity, renderer module map.

### Codebase & quality
- **Renderer modules:** Editor logic split into focused modules (`editorSave`, `editorSiteSave`, `editorGit`, `editorSerialize`, `editorBlockRender`, `editorParse`, `editorPageModel`, `editorUndo`, `editorDraft`, `editorDraftRestore`, `editorInspector`, `editorUnsavedWork`, `editorLog`, `gitUpstreamLabel`) with `zephusEngine` as orchestrator.
- **Tests:** **263** unit tests pass (`npm test`), including block render parity, Git helpers, and editor module coverage.

---

## Changes in `v0.1.0-beta.1:`

### Splash Screen
- **Splash Screen:** Completely redesigned the launcher splash screen with a creative CLI-style boot diagnostics sequence, typewriter-effect prompts, and a blinking cursor. Added CRT scanline overlays for a sleek retro-tech aesthetic.

### UI & UX Polish
- **Layout Transitions:** Added smooth slide-in keyframe animations for the left and right panels on editor entrance, and lift-and-fade animations (`fade-in-up`) for the main editor canvas and home command center tabs.
- **Micro-interactions:** Applied bouncy, interactive scaling (`transform: scale(0.97)`) to active buttons, navigation tabs, and project list cards.
- **Modernized Highlights:** Updated primary buttons with a premium Indigo gradient, subtle borders, and inset overlays.
- **Help Guide Modal:** Designed an in-app interactive shortcuts modal detailing visual editor key bindings and workflow tips, accessible via a new Topbar Help button or by pressing <kbd>?</kbd> / <kbd>H</kbd> on the canvas.
- **Live Google Fonts Rendering:** Updated Content-Security-Policy headers and implemented dynamic stylesheet injection, allowing chosen Google Fonts to load and render instantly in real-time in the editor workspace.

### Responsive Device Simulator Bezels
- **Device Frames:** Replaced basic viewport dimensions with sleek mock hardware bezels (metallic bezels, screen reflections, and rounded corners) for mobile and tablet simulation states.
- **Animations:** Added smooth transitions on borders, spacing, and drop shadows when switching between preview device modes.

### Accessibility (A11y)
- **ARIA Labels:** Added descriptive screen-reader `aria-label` tags to topbar and sidebar buttons (Undo, Redo, Save, Publish, Start Preview, Close, Regen Nav).

### SEO Best Practices
- **SEO Warnings:** Integrated page meta description validation (warning if empty) and duplicate H1 tag checks into the "Next Actions" helper panel list, along with quick actions to navigate directly to Page Settings or focus the duplicate block.

### Editor Stability & Completeness
- **Visual/Code Mode:** Fixed a desync where switching to Visual on a managed page with unsaved code edits left the CodeMirror editor visible while tabs showed Visual.
- **Undo Stack:** Keyboard canvas resize no longer pushes duplicate undo snapshots; Undo/Redo toolbar buttons disable when empty (and follow CodeMirror history in Code mode).
- **Keyboard Shortcuts:** Delete/Backspace removes a selected section (not only blocks); Cmd/Ctrl+D duplicates sections; Cmd/Ctrl+C/X/V copy, cut, and paste blocks or sections.
- **Inline Editing:** Pasting into contenteditable text now inserts plain text only, matching the innerText commit model.
- **Code Mode Undo:** Toolbar and keyboard undo/redo work against CodeMirror history while in Code mode.
- **Save UX:** Save when nothing is dirty shows “Nothing to save” without running a full save pass.

### Codebase & Quality
- **Shared Render Helpers:** Extracted mirrored HTML/CSS helpers into `src/shared/renderHelpers.ts` so the build and editor renderers stay single-sourced.
- **Editor Commands:** Pulled mode-guard and clipboard toolbar helpers into `src/renderer/editorCommands.ts`; removed unused Solid demo mount.
- **Tests:** Added unit coverage for shared helpers and editor command guards; all 178 unit tests pass.

## ℹ️ Release Info

- **GPG Signed:** My public key is attached to every release to ensure authenticity.
- **GPG Key:** You can get my public GPG key here: https://tuxedo.rosie.run/GPG/BurntToasters_0xF2FBC20F_public.asc
- **Code Signing:** macOS releases are fully signed. Windows releases are not signed by an org, but are signed by my GPG signature (same with Linux).
