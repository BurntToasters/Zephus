> [!NOTE]
> 📢 This is a Beta build. This build is intended for testing and early feedback.

# ⬇️ Downloads

| <img height="20" src="https://raw.githubusercontent.com/BurntToasters/bcls/main/media/windows.png" /> Windows | <img height="20" src="https://raw.githubusercontent.com/BurntToasters/bcls/main/media/mac.png" /> macOS | <img height="20" src="https://raw.githubusercontent.com/BurntToasters/bcls/main/media/linux.png" /> Linux |
| :--- | :--- | :--- |
| **EXE:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.1/Zephus-Windows-x64.exe) / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.1/Zephus-Windows-arm64.exe) | **[Universal DMG](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.1/Zephus-MacOS-universal.dmg)** | **AppImage:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.1/Zephus-Linux-x86_64.AppImage) <!-- / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.1/Zephus-Linux-arm64.AppImage) --> |
| | **[Universal ZIP](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.1/Zephus-MacOS-universal.zip)** | **DEB:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.1/Zephus-Linux-amd64.deb) <!-- / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.1/Zephus-Linux-arm64.deb) --> |
| | | **RPM:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.1/Zephus-Linux-x86_64.rpm) <!-- / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.1/Zephus-Linux-aarch64.rpm) --> |
| | | **Flatpak:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.1/Zephus-Linux-x86_64.flatpak) <!-- / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.1/Zephus-Linux-aarch64.flatpak) --> |

> [!IMPORTANT]
> The `.sig` files in this repo are NOT normal GPG signatures — they are for Zephus's built-in updater to verify the integrity of updates before downloading and installing.
>
> The `.asc` files are my normal GPG signatures which you can verify using my GPG Public Key: https://tuxedo.rosie.run/GPG/BurntToasters_0xF2FBC20F_public.asc
>
> ⚠️ Arm64 Linux Binaries are NOT available at the moment. The logic is setup in the repo in case people would like to build their own :)

### ℹ️ Enjoying Zephus? Consider [❤️ Supporting Me! ❤️](https://rosie.run/support)

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
- **Panel Mount Failures:** SolidJS panel mount errors now surface in status, the editor banner, and a reload prompt when the canvas fails.
- **HTML Blocks:** Inspector includes a markup textarea so HTML blocks can be edited without leaving Visual mode.
- **Help Guide:** Documents Code-mode undo/redo and reattach via the editor banner or Page Settings.

### Codebase & Quality
- **Shared Render Helpers:** Extracted mirrored HTML/CSS helpers into `src/shared/renderHelpers.ts` so the build and editor renderers stay single-sourced.
- **Editor Commands:** Pulled mode-guard and clipboard toolbar helpers into `src/renderer/editorCommands.ts`; removed unused Solid demo mount.
- **Tests:** Added unit coverage for shared helpers and editor command guards; all 178 unit tests pass.

## ℹ️ Release Info

- **GPG Signed:** My public key is attached to every release to ensure authenticity.
- **GPG Key:** You can get my public GPG key here: https://tuxedo.rosie.run/GPG/BurntToasters_0xF2FBC20F_public.asc
- **Code Signing:** macOS releases are fully signed. Windows releases are not signed by an org, but are signed by my GPG signature (same with Linux).
