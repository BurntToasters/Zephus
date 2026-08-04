> [!NOTE]
> 📢 This is a Beta build.

# ⬇️ Downloads

| <img height="20" src="https://raw.githubusercontent.com/BurntToasters/bcls/main/media/windows.png" /> Windows                                                                                                              | <img height="20" src="https://raw.githubusercontent.com/BurntToasters/bcls/main/media/mac.png" /> macOS                 | <img height="20" src="https://raw.githubusercontent.com/BurntToasters/bcls/main/media/linux.png" /> Linux                                                                                                                                         |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **EXE:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.4/Zephus-Windows-x64.exe) / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.4/Zephus-Windows-arm64.exe) | **[Universal DMG](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.4/Zephus-MacOS-universal.dmg)** | **AppImage:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.4/Zephus-Linux-x86_64.AppImage) <!-- / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.4/Zephus-Linux-arm64.AppImage) --> |
|                                                                                                                                                                                                                            | **[Universal ZIP](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.4/Zephus-MacOS-universal.zip)** | **DEB:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.4/Zephus-Linux-amd64.deb) <!-- / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.4/Zephus-Linux-arm64.deb) -->                 |
|                                                                                                                                                                                                                            |                                                                                                                         | **RPM:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.4/Zephus-Linux-x86_64.rpm) <!-- / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.4/Zephus-Linux-aarch64.rpm) -->              |
|                                                                                                                                                                                                                            |                                                                                                                         | **Flatpak:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.4/Zephus-Linux-x86_64.flatpak) <!-- / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.4/Zephus-Linux-aarch64.flatpak) -->  |

> [!IMPORTANT]
> The `.sig` files in this repo are NOT normal GPG signatures — they are for Zephus's built-in updater to verify the integrity of updates before downloading and installing.
>
> The `.asc` files are my normal GPG signatures which you can verify using my GPG Public Key: https://tuxedo.rosie.run/GPG/BurntToasters_0xF2FBC20F_public.asc
>
> ⚠️ Arm64 Linux Binaries are NOT available at the moment. The logic is setup in the repo in case people would like to build their own :)

### ℹ️ Enjoying Zephus? Consider [❤️ Supporting Me! ❤️](https://rosie.run/support)

---

## Changes in `0.1.0 (unreleased):`

### Data safety

- **Never publish stale content:** Publish now saves or prompts about unsaved edits first (like Preview did), so the build can no longer silently ship older disk state while the editor holds newer content.
- **"Open Output Folder" no longer re-runs the build** — it reveals the folder only.
- **Hand-edited pages survive opens:** A page whose `.astro` file was edited outside Zephus is left alone instead of being regenerated over the user's changes when its sidecar predates generated hashes.
- **External `site.json` edits are no longer silently overwritten:** saving staged site shell/design changes now checks the disk copy against the staging baseline and stops with a clear message when another tool changed the file meanwhile.
- **Legacy text with literal `<` (e.g. "2 < 3") no longer truncates pages during migration**, and inline styles with colons (`background:url(…)`) parse fully.
- **Undoing the first block on an empty page returns to the empty page** (no phantom empty section), and deleting the open page fully resets its document state and clears its recovery draft.
- **Page Settings rename computes the new file path from the slug**, never by string-replacing the slug inside the path; renaming the open page re-arms the external-change watcher and no longer triggers a false "changed on disk" prompt.
- **Page files whose names aren't normalized slugs (e.g. `About.astro`) open correctly** instead of failing the whole project.
- **Renaming an asset ignores longer paths that merely end in it**, and renaming to the current name is a true no-op.
- **Replace All always re-searches the current text** before rewriting pages, and out-of-order searches can no longer overwrite newer results.
- **Code-mode page switches no longer pollute undo history**: programmatic document replacements reset the editor history, so Ctrl+Z after switching pages can no longer restore a different page's text.
- **Nested modals (Link Picker, Asset Browser, Production Licenses) now return to the modal they opened from** with in-progress edits intact, instead of destroying it.
- **Modal content is dropped on close**, so embedded previews stop running and resources are freed.

### Stability

- **Publish, preview, and install flows** are protected against overlap (no concurrent builds), leftover listeners, and stale completion handlers closing unrelated dialogs.
- **Preview/Publish/Close/Undo/Redo/viewport controls are inert while a page loads**, so actions can no longer run against a half-committed page.
- **A failed project open never strands a half-open session** — the app returns to the start screen with a clear error.
- **"Keep Mine" on an unreadable external change no longer re-prompts forever.**
- **Home-screen draft Resume no longer asks to restore the draft a second time.**
- **Concurrent theme-preview server starts are serialized**, errored servers are closed, and the served bundle is symlink-contained.
- **Node.js resolution is cached** (was re-probing up to 8 candidates with 10s timeouts on every build/preview/install).
- **The coverage gate passes again** (`assets.ts` was at 64% against an 80% threshold; now 97%+).

### Security

- **Navigation guards now resolve `..` and percent-encoding** before containment checks, closing a file:// path-escape that could display arbitrary local files.
- **"Open licenses file" works in packaged builds** (exports from the asar), local filesystem paths no longer leak into the license list, and bundled-renderer packages are correctly attributed.
- The theme-preview server is only startable by the main editor window; invalid reusable-section entries no longer crash the list handler.

### Refactors & tests

- **Editor engine split further:** the block catalog (`editorBlocks.ts`), inline text editing (`editorInlineEdit.ts`), and canvas resize (`editorResize.ts`) are now standalone, unit-tested modules — the engine is down from ~7.9k to ~6.9k lines.
- **Test suite grown from 271 to 390+ tests**, including save-flow races, draft restore, git actions, asset safety, rich-text sanitization, schema round-trips, and a parser-parity suite.
- **Parser parity (round-trip integrity):** the main-process regex parser and the renderer's DOM parser now produce the same section/block trees from the same source, enforced by `editorParseParity.test.ts`. Fixed divergences: HTML entities (`&copy;`, numeric refs, double-encoded) now decode identically instead of double-escaping; `<br>` keeps line breaks; multi-paragraph blockquotes keep every paragraph; comments stay comments instead of becoming visible text; stored `data-zephus-id`s survive migration; `>` inside quoted attributes no longer truncates tags; legacy `<section>` wrappers parse as editable sections in both; top-level `<style>` is dropped in both; `</BaseLayout>` inside content no longer splits the parsers apart.
- **Generated output hardening:** page imports are JSON-escaped (apostrophes in project paths no longer break the build) and attribute text is brace-escaped (a `{` in a title can no longer become an Astro expression). Nested `404/…` routes are treated as reserved; hand-authored custom nav items sharing a page's href are no longer adopted/overridden; invalid publish dates no longer enter the post index or RSS feed; dead schema fields (`hidden`, `templates`, `templateId`) removed.
- **Preview lifecycle:** double-start race closed (servers can no longer be orphaned by rapid starts), URLs are matched across chunk boundaries, a failed spawn can no longer wedge the preview button, stopping during a start is honored, and a dev server that dies on its own now resets the editor's preview UI. A hung `npm install` times out after 30 minutes instead of locking installs forever.
- **Editor UX:** viewport switching repaints the canvas even while the preview window is open; dropping a block/section on empty canvas space appends to the last section instead of a stale target; undo/redo re-anchors the selection so palette inserts can't land in the wrong section; staged design changes repaint the canvas live; the block inspector derives its type list from the catalog (a new block can never silently show a blank panel); clicking a section's chrome selects it; first-run onboarding shows even when restoring the last project fails.
- **Smaller fixes:** global theme values are validated (hand-edited settings can't silently break theming); recent projects dedupe canonically; search/replace payloads are capped; Tab now indents in Code mode (as documented); the page list gained the documented eye toggle (show/hide in nav) and a detached-page indicator; Settings is now reachable from the editor toolbar.

### Smaller fixes

- **Hide-on-viewport actually hides now:** `style.hideOn` was previewed on the canvas but never emitted into the built site's responsive CSS — the published pages ignored it entirely. The build now emits the hide rules in the media queries, and the canvas shows hidden blocks with a dashed outline (still selectable/editable) instead of `display:none`.
- **Hide-on-viewport is configurable:** the inspector gained **Hide on desktop/tablet/mobile** toggles for both blocks and sections (previously the feature existed in the engine but had no UI to set it). Content hidden on the active viewport stays editable on the canvas with a dashed outline.
- **Publish-date guidance:** the Guide panel now warns when a page's publish date isn't a real `YYYY-MM-DD` date (such pages are excluded from RSS and post listings).
- **Dev server URL scanner:** URLs split across stdout chunks are matched correctly; a chunk ending mid-port no longer reports a truncated URL like `http://localhost:43` (and ANSI sequences split across chunks are handled). Covered by a new pure `DevServerUrlScanner` with unit tests.
- **Regression tests added** for: publish-date validation, nested-404 reservation, custom nav-item collision handling, `extractManagedInner` last-close matching, Astro attribute brace-escaping, settings theme validation + canonical recent dedupe, find/replace payload caps, and the dev server URL scanner.

### Reliability round

- **Fresh `git init` projects show the branch again:** `git rev-parse HEAD` fails on an unborn HEAD (no commits yet), which made the Git panel report "Git unavailable" on every newly initialized repo until the first commit. The branch is now resolved via `symbolic-ref` first, with `rev-parse` as the fallback.
- **`.zephus` git-ignore detection is robust:** `git check-ignore` needs `--no-index` for non-existent paths, and directory patterns (`.zephus/`) only match a trailing-slash path. Both path forms are now checked, so the "commit your .zephus folder" warning fires when it should.
- **Crash-recovery drafts are pruned:** recovery drafts older than 30 days are dropped on the next write, so `drafts.json` stops growing forever on long-running installs.
- **More regression tests:** real-repository Git service tests (init, status classification, ignore detection), Node version-check + spawn-env tests against the running Node binary, theme preview server symlink containment (in-root allowed, out-of-root refused), asset rename/usage boundary tests, and draft pruning.

---

### Test coverage push

- **Coverage raised from ~70% to ~77% overall** (main process at ~90%): the suite grew from 434 to **481 tests** with focused suites for every remaining weak spot.
- **jsdom renderer tests**: inline rich text read-back (formatting, links, scripts, line breaks — which surfaced and fixed a script-content leak through `innerText`), canvas HTML sanitization (scripts/objects/event handlers/`srcdoc`/URL schemes), resize handles (pointer/keyboard resizing, responsive writes), clipboard paste, toolbar sync.
- **Process-flow tests with mocked spawn**: dev server start/reuse/timeout/exit-notify flows, `npm install`-style concurrency guards, updater check/download/cancel flows.
- **Real-repository Git tests** (init, status, commit, ignore detection), real-Node version checks, theme-preview symlink containment, wizard rollback, licenses filtering edge cases, page manager CRUD + metadata writes, undo/site-save race paths.
- **Coverage gate strengthened**: `check-coverage-thresholds.js` now guards **34 files** (up from 5) with raised thresholds, so `npm run test:cov` (and CI's coverage job) fails the build if any of them regresses.

---

### Test coverage push, round 2

- **Coverage raised from ~77% to ~86% overall** (measured statements, including test mocks): the suite grew from 481 to **520 tests**.
- **Inline editing fully exercised**: `editorInlineEdit.ts` went from ~7% to **72%** with jsdom tests for every block type's editable targets, double-click/Enter/Escape/blur commit semantics, multiline Ctrl+Enter behavior, format-toolbar create/destroy, and toolbar-focus session retention.
- **Canvas resize drags**: `editorResize.ts` at **94.5%** — pointerdown/move/up/cancel, NW/SE corner math, parent-width clamping, minimum sizes, blur-cancel, and single-commit on repeated finishes.
- **DOM parser branches**: `editorParse.ts` at **84%** — dangerous-key stripping, legacy inline-style extraction, `<br>` line breaks, comment/loose-text preservation, stored props/style/id/lock reads, and missing-props fallback.
- **Git push/pull over a real bare remote**, which surfaced and fixed a real bug: the first push on a freshly initialized repo failed with "no upstream branch" — `pushCurrentBranch` now sets the upstream (origin, or the first configured remote) automatically.
- **Theme preview server HTTP handler**: 405 for non-GET/HEAD, 404s, HEAD without a body, MIME types, missing-bundle errors, and a fix for a dead branch where an unreadable file returned 200 with an empty body instead of 500 (the response now opens the file before writing headers).
- **Post-list rendering branches** (`blockRender.ts` at 94%): dated/undated sorting, meta toggles, empty states, content escaping, video blocks, and unknown-block placeholders.
- **Coverage gate tightened again** for the newly-covered files: `editorInlineEdit` 66%, `editorResize` 88%, `editorParse` 78%, `git.ts` 75%, `themePreviewServer` 78%, `blockRender` 88% (each ~5 pts below measured).

---

## Changes in `0.1.0-beta.4:`

> [!WARNING]
> **Beta 3 was broken.** Theme Discovery was completely non-functional, which blocked site creation. If you are on Beta 3, please update immediately.

### Critical fix

- **Theme Discovery panel:** Fixed a SolidJS reactivity bug that prevented the theme grid from ever rendering. The component used imperative early-return conditionals that SolidJS does not re-evaluate after mount. Replaced with reactive `<Switch>`/`<Match>` control flow so theme cards now appear, can be selected, and site creation works again.

### Quality

- **Tests:** **271** unit tests pass, alongside compile, lint, format, typecheck, syntax, and config checks (`npm run test:all`).

---

## Changes in `0.1.0-beta.3:`

### Blog publishing & RSS (new)

- **Post List block:** Add a live article index filtered by route folder, with configurable limits, dates, authors, descriptions, and social images. Listings refresh when posts are saved, renamed, or deleted.
- **Post metadata:** Set a publish date and author in Page Settings. The bundled Blog theme includes a working post index and sample article.
- **RSS feed:** Sites with a public Site URL and dated, indexable posts generate `public/rss.xml`, advertise it from managed pages, and order entries newest first.
- **Safe lifecycle:** Clearing the Site URL or removing the last RSS-eligible post removes only Zephus-managed discovery files; hand-authored sitemap, robots, and RSS files remain untouched.

### Search engines & social sharing (new)

- **Site URL, language, favicon:** Site Shell has a **Search & sharing** group. Setting your site address is what enables canonical links, social previews, and `sitemap.xml`; the address is validated so a typo cannot produce broken links.
- **Per-page SEO:** Page Settings gained a social share image (with the asset picker), a canonical URL override that shows the address it defaults to, and **Hide from search engines**.
- **Meta tags:** Built pages now include `<html lang>`, a favicon link, `<meta name="description">`, `<link rel="canonical">`, Open Graph (`og:title`/`description`/`image`/`url`/`type`/`site_name`) and Twitter card tags. Social image URLs are made absolute from your site address, which those platforms require.
- **sitemap.xml + robots.txt:** Generated into `public/` once a site URL is set. Pages marked hide-from-search are left out. A `sitemap.xml` or `robots.txt` you wrote yourself is never overwritten.
- **Publishing:** Building now refreshes managed pages from your saved content first, so a page that was edited on another machine (or by an older Zephus) can no longer be published stale.

### 404 page (new)

- **Create a 404 page** from the Guide panel, or by adding a page with the slug `404`. Astro serves it for unknown routes.
- It is created with starter content and a link home, and is kept out of your navigation, out of `sitemap.xml`, and out of search results automatically.

### Find and replace (new)

- **Search text across every page** from the Pages panel or **Ctrl/Cmd+F**, with **Match case** and **Whole words only**.
- Results are grouped per page with surrounding context, and clicking a result opens that page.
- **Replace All** shows exactly how many occurrences on how many pages will change and asks for confirmation first, since undo does not cover it.

### Text formatting (new)

- **Bold, italic, and links inside text** while editing on the canvas, via a floating toolbar or **Ctrl/Cmd+B / I / K**. Underline, strikethrough, and inline code are available too.
- Formatting is limited to a safe set of tags: pasted or generated markup outside that set is discarded rather than injected into your site, and link addresses are checked the same way the rest of the editor checks them.
- Text without formatting is stored and rendered exactly as before, so existing pages are untouched.

### Assets

- **Rename and delete assets** from the asset browser.
- Before either action, Zephus shows which pages and site settings use that file.
- Renaming **updates every reference** to the file across your pages and site settings in the same step, so a rename cannot leave broken images behind.

### Editor — workspace & layout

- **Grouped side panels:** The left rail is now **Pages / Build / Layers** and the right rail **Inspect / Guide / Git / Logs**, so each side shows one focused panel instead of a single long scroll.
- **Canvas controls:** Compact section and block toolbars, hover insertion rails, and clearer selection outlines.
- **Loading feedback:** Switching pages shows a per-row spinner and a canvas overlay; the toolbar button reads **Saving…** while a save is in flight.
- **Modals:** Focus is trapped per modal frame and restored to the control that opened it, including nested modals.

### Editor — data safety

- **Save gates:** Choosing **Save** before switching pages, starting a preview, or closing a project now re-checks state after the write. If you edited again while the save was in flight, the app keeps those edits and stops instead of continuing.
- **Repeat saves:** Pressing **Ctrl/Cmd+S** during an in-flight save now flushes the newer edits rather than coalescing them into the older snapshot.
- **Atomic page loads:** A page is staged fully and committed in one step, so a superseded or canceled load can no longer leave the canvas, code editor, inspector, and page list showing different pages.
- **Discard:** Discarding re-checks page _and_ site state before continuing, and re-arms crash-recovery for edits made while the discard was running.
- **Recovery drafts:** Failed draft cleanup is now surfaced in status instead of being silently ignored, and cleanup after a forced reload is skipped when newer edits exist.
- **Site settings:** A successful write is never reported as unsaved because of a follow-up cleanup or read-back failure, and newer edits made mid-write stay dirty.
- **Code mode:** A managed page detaches when its code differs from the current visual model, so intentionally restored older source is preserved instead of being overwritten.
- **External changes:** The "changed on disk" prompt is tied to the editor session, so it is not dropped by an unrelated page load.
- **Project close:** Closing clears loading state, undo/redo history, selection, and source state, so editor shortcuts on the start screen can no longer affect the next project opened.

### Editor — canvas & accessibility

- **Reactivity:** Canvas, page list, and layer rows reconcile by id from immutable snapshots, so lock and label changes always repaint and keyboard focus survives a refresh.
- **Inspector:** Code mode no longer exposes block/section property controls that would edit a page you cannot see; **Visual** stays disabled for detached pages.
- **Busy state:** While a page loads, editing surfaces, palettes, page/site controls, and destructive shortcuts are inert.

### Quality

- **Tests:** **271** unit tests pass, alongside compile, lint, format, typecheck, syntax, and config checks (`npm run test:all`).

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
