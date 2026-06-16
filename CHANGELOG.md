> [!NOTE]
> ⛔️ This is a Developer Beta build. These builds are extremely unstable and are meant for testing only.
> 
> Zephus currently uses the app icons from the ROSI app as a placeholder while I work on creating a custom icon :)

# ⬇️ Downloads

| <img height="20" src="https://raw.githubusercontent.com/BurntToasters/bcls/main/media/windows.png" /> Windows | <img height="20" src="https://raw.githubusercontent.com/BurntToasters/bcls/main/media/mac.png" /> macOS | <img height="20" src="https://raw.githubusercontent.com/BurntToasters/bcls/main/media/linux.png" /> Linux |
| :--- | :--- | :--- |
| **EXE:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-db.6/Zephus-Windows-x64.exe) / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-db.6/Zephus-Windows-arm64.exe) | **[Universal DMG](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-db.6/Zephus-MacOS-universal.dmg)** | **AppImage:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-db.6/Zephus-Linux-x86_64.AppImage) <!-- / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-db.6/Zephus-Linux-arm64.AppImage) --> |
| | **[Universal ZIP](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-db.6/Zephus-MacOS-universal.zip)** | **DEB:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-db.6/Zephus-Linux-amd64.deb) <!-- / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-db.6/Zephus-Linux-arm64.deb) --> |
| | | **RPM:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-db.6/Zephus-Linux-x86_64.rpm) <!-- / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-db.6/Zephus-Linux-aarch64.rpm) --> |
| | | **Flatpak:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-db.6/Zephus-Linux-x86_64.flatpak) <!-- / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-db.6/Zephus-Linux-aarch64.flatpak) --> |

> [!IMPORTANT]
> The `.sig` files in this repo are NOT normal GPG signatures — they are for Zephus's built-in updater to verify the integrity of updates before downloading and installing.
>
> The `.asc` files are my normal GPG signatures which you can verify using my GPG Public Key: https://tuxedo.rosie.run/GPG/BurntToasters_0xF2FBC20F_public.asc
>
> ⚠️ Arm64 Linux Binaries are NOT available at the moment. The logic is setup in the repo in case people would like to build their own :)

### ℹ️ Enjoying Zephus? Consider [❤️ Supporting Me! ❤️](https://rosie.run/support)

---

## Changes in `v0.1.0-db.6:`
* **License:** Updated to comply with bundled license items.

## Changes in `v0.1.0-db.5:`
* **Codebase:** More optimizations and fixes to the WYSIWYG engine.
* **Misc:** Further back-end updater and front end GUI fixes.

## Changes in `v0.1.0-db.4:`
* **Updater:** Downloaded updates now ask users to restart instead of installing silently on quit.
* **Codebase:** Multiple fixes and improvements to the engine (including being able to click on text boxes to edit).

## Changes in `v0.1.0-db.3:`
* **Windows:** Fixed and npm/nodejs spawner error.
* **Recent Sites:** Users can now remove sites from the recent sites list.

## Changes in `v0.1.0-db.2:`
- **Icon:** Added the first concept icon to the app replacing the legacy ROSI icons.
- **Themes:**
  - Fully re-designed the theming backend.
  - Added more themes.
  - Improved all themes.
- **Engine:** Dramatically updated the engine and added more elements to add/use on sites.
- **Codebase:** Major bug fixes and improvements.

## Changes in `v0.1.0-db.1:`

Beta 1 releases of Zephus don't include any changes besides the initial build, and are meant to sync beta users to the first working version.

- **NEW - Visual Editor:** Added UI drag-and-drop WYSIWYG page editor with block palette (heading, text, image, button, section), inline text editing, typed property widgets, color/spacing controls, and undo/redo.
- **NEW - Code Editor:** Added CodeMirror 6 syntax-highlighted code view with HTML language support and one-dark theme. Bidirectional sync between visual and code modes.
- **NEW - Live Preview:** Added dev-server preview via the project's `npm run dev` — renders in an embedded iframe with desktop/tablet/mobile viewport toggle.
- **NEW - Theme Wizard:** Added site creation wizard with 5 bundled themes (Documentation, Project, Blog, Portfolio, Minimal). Creates a complete Astro project, initializes Git, and writes the `.zephus` marker.
- **NEW - Page Manager:** Added page creation from theme layouts, page list with active indicator, and navigation regeneration from the page tree.
- **NEW - Section Templates:** Added draggable prebuilt sections (Hero, Features, CTA, Footer) inserted as preserved HTML blocks.
- **NEW - Publish:** Added production build via `npm run build` with output folder reveal in the system file manager.
- **NEW - Git Awareness:** Added branch display (including detached HEAD), modified/added/deleted file lists in the right panel, and auto-refresh on save.
- **NEW - Image Import:** Added image picker dialog that copies assets into `public/images/` and inserts the correct web-root path.
- **NEW - File Watching:** Added external-change detection via `fs.watch` with reload/keep prompt when a file is modified outside Zephus.
- **NEW - Settings:** Added global `settings.json` in the OS user config directory with repo-over-global precedence via merged settings. Repo-scoped `.zephus/settings.json` controls editor rules (`allowedBlocks`, `maxHeadingLevel`).
- **NEW - Onboarding:** Added first-run welcome modal with "Create My First Site" action for new users.
- **Codebase:** Built the full Electron main/renderer/preload architecture in TypeScript mirroring the ROSI project structure. IPC layer with contextIsolation and sandboxed preload bridge.
- **Codebase:** Added esbuild renderer bundling pipeline replacing the previous tsc-in-place compilation for the renderer process.
- **Codebase:** Rebranded all ROSI-derived build tooling, scripts, manifests, and identifiers to Zephus (`run.rosie.zephus`).
- **Codebase:** Removed all yt-dlp/ffmpeg/binary-restore tooling that was specific to the ROSI downloader use case.
- **Codebase:** Added `astro.config` parsing for custom `srcDir`/`publicDir`/`outDir` directories.
- **Testing:** Added Vitest test suite with 13 tests covering project detection, package validation, page listing, file read/write, and path-traversal rejection.
- **Security:** Enforced CSP in the renderer, path-traversal guards on all file operations, and validated that the preload bridge exposes no raw Node APIs.
- **UI:** Dark theme (Catppuccin Mocha palette), responsive layout, modal system, status bar, dirty indicator, keyboard shortcuts (Ctrl/Cmd+S save, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo).
- **Ver:** Initial version `v0.1.0-beta.1`.
- **PKG:** Updated packages.

## ℹ️ Release Info

- **GPG Signed:** My public key is attached to every release to ensure authenticity.
- **GPG Key:** You can get my public GPG key here: https://tuxedo.rosie.run/GPG/BurntToasters_0xF2FBC20F_public.asc
- **Code Signing:** macOS releases are fully signed. Windows releases are not signed by an org, but are signed by my GPG signature (same with Linux).
