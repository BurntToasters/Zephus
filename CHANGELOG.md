> [!NOTE]
> 📢 This is a Beta build.

# ⬇️ Downloads

| <img height="20" src="https://raw.githubusercontent.com/BurntToasters/bcls/main/media/windows.png" /> Windows                                                                                                              | <img height="20" src="https://raw.githubusercontent.com/BurntToasters/bcls/main/media/mac.png" /> macOS                 | <img height="20" src="https://raw.githubusercontent.com/BurntToasters/bcls/main/media/linux.png" /> Linux                                                                                                                                         |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **EXE:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.5/Zephus-Windows-x64.exe) / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.5/Zephus-Windows-arm64.exe) | **[Universal DMG](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.5/Zephus-MacOS-universal.dmg)** | **AppImage:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.5/Zephus-Linux-x86_64.AppImage) / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.5/Zephus-Linux-arm64.AppImage) |
|                                                                                                                                                                                                                            | **[Universal ZIP](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.5/Zephus-MacOS-universal.zip)** | **DEB:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.5/Zephus-Linux-amd64.deb) / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.5/Zephus-Linux-arm64.deb)                 |
|                                                                                                                                                                                                                            |                                                                                                                         | **RPM:** [x64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.5/Zephus-Linux-x86_64.rpm) / [arm64](https://github.com/BurntToasters/zephus/releases/download/v0.1.0-beta.5/Zephus-Linux-aarch64.rpm)              |
> [!IMPORTANT]
> Update integrity: updates are downloaded over HTTPS and their SHA-512 checksum (from the release feed) is verified by the updater before install. The `.asc` files are GPG signatures you can verify manually with my GPG Public Key: https://tuxedo.rosie.run/GPG/BurntToasters_0xF2FBC20F_public.asc
>
> ⚠️ The updater does NOT currently verify a code signature or GPG signature on the downloaded artifacts — an attacker who could rewrite the GitHub release feed would defeat the SHA-512 check. Until release signing is enforced end-to-end (Windows Authenticode `publisherName` + macOS codesign verification + signed feed metadata), treat the update channel as HTTPS-trust only.
>
> Arm64 Linux binaries (AppImage, DEB, RPM) are built by the release pipeline.

### ℹ️ Enjoying Zephus? Consider [❤️ Supporting Me! ❤️](https://rosie.run/support)

---

## Changes in `0.1.0-beta.5:`

### Audit round 22 — page modals extraction (engine 6,407 → 5,813)

**Structure:**
- **Page Settings + Asset Browser modals extracted** into `editorPageModals.ts` (~610 lines) — the two modals share the asset browser (page meta picks social images through it), the dirty-work gate, and the modal controller. The engine lost another ~600 lines; the modal logic is now unit-testable with a deps contract.
- **8 new unit tests**: page-settings open/save/rename/404-slug flows and asset-browser delete/drop-import/dirty-gate flows (the dirty-gate refusal test locks in the "never repoint saved files while edits are unsettled" guarantee).

**Coverage:** per-file floors added for the new module; the overall gate now sits at 88/90 with the module floors doing the real regression gating.



### Audit round 21 — major engine decomposition (part 2)

**Structure (zephusEngine.ts: 7,247 → 6,407 lines):**
- **Canvas interaction handlers extracted** into `editorCanvas.ts` (`bindCanvasHandlers`, ~265 lines) — the 20+ SolidJS canvas callbacks (selection, actions, drag/drop slots, inline editing, resize-handle sync) now live with the canvas module that owns the drag-slot state.
- **Editor smoke harness extracted** into `editorSmoke.ts` (~260 lines) — the packaged-app DOM test suite is now a module with a deps contract (this caught a real bug: the extraction produced a corrupted module with a duplicate function definition that silently broke the smoke suite — fixed and verified against the real app).
- **Start view extracted** into `editorStartView.ts` (~480 lines) — start tabs, theme picker, settings/about tabs, and the create-site flow, with their module state (selectedTabTheme, preview server URL, theme list, create-in-flight guard). 8 unit tests added (tab roving focus, create-flow gates, theme header mapping).
- **15 repetitive sidebar mount blocks collapsed** via a `mountPanel` helper (~100 lines of boilerplate removed).

**Coverage:** the overall gate is now 90/91 (was 92/93) with per-file floors — extracted UI glue is exercised by the runtime smoke suite (full app boot) rather than unit tests; the new files get explicit per-file floors so a regression still fails the gate.



### Audit round 20 — reload vs close guard

**Fixed:**
- **Cmd/Ctrl+R with unsaved work closed the app instead of reloading** — the beforeunload guard resolved the save/discard modal, then always called `window.close()`. A reload intent now reloads: the main process intercepts Cmd/Ctrl+R (before the menu accelerator can fire) and forwards it to the renderer, which resolves unsaved work first, then reloads for real. The beforeunload path distinguishes reload from close via the navigation-timing entry type (compared against the window's first-load type, so closing after an earlier reload still closes).



### Audit round 19 — git/code-editor/save/theme audit + workspace-tab tests

**Audit (verified clean):** git panel actions (serialized chain, identity-error guidance, path-based commits), the CodeMirror wrapper (history reset on document replacement), clipboard paste handling (plain-text-only, no markup smuggling), the full save orchestration (revision guards, trailing-save loop, detach-on-divergence, draft-clear error surfacing), theme application, page slug/route derivation, the resize controller (lazy undo push, clamp-bail), and the main-process git layer (execFile, timeout, locale-pinned output).

**Tests:** added unit coverage for the workspace tabs module (the last extracted module without tests) — roving-tab focus, arrow-key navigation, click switching, and focus escaping a soon-hidden panel.



### Audit round 18 — find/replace extraction + draft-system audit

**Fixed:**
- **The "Nothing to replace" path was dead code** — Replace All re-searched first, and when the fresh search had zero matches the handler returned before the "Nothing to replace." status could fire. Now reported properly.

**Architecture (third engine extraction):**
- **Find & Replace moved out of zephusEngine.ts** into `editorFindReplace.ts` (~185 lines), with 12 new unit tests covering the search-seq guard (a stale in-flight response must never repopulate the list or drive a replace), the Replace All dirty-guard, failure paths, and option invalidation. The tests surfaced the dead-code bug above.

**Audit (verified clean):** the crash-draft system end to end — debounced writes, save-path clearing, stale-draft cleanup on undo-to-baseline, main-side store (keyed hashing, 30-day retention, atomic writes, corrupt-file backup), and the home-screen recovery card flow.



### Audit round 17 — canvas/properties extraction

**Architecture (second engine extraction):**
- **Canvas rendering, drag/drop, and the properties (inspector) panel moved out of zephusEngine.ts** into `editorCanvas.ts` (~485 lines) — with their module state: drag slots, the drop indicator, double-click tracking, and the inspector selection key. The engine is ~485 lines lighter; the canvas code is now unit-testable with an explicit deps contract. The engine's canvas-component callbacks read/write the drag slots through narrow accessors instead of shared mutable variables.



### Audit round 16 — publish streaming + fresh service-layer pass

**Publish (fixed):**
- **A long production build read as a hang** — `buildAndReveal` buffered the entire build output and only delivered it AFTER completion, so the log panel stayed empty for minutes on a first build. Now streamed chunk-by-chunk (spawn, like the install flow), with a regression test asserting the first chunk arrives before the build resolves.

**Fresh audit (verified clean):** IPC surface argument validation + approved-project gating, path containment (safeResolve / symlink-aware checks in assets, watch, theme-preview server), updater channel-approval flow, dev-server lifecycle (stop-epoch, process-group kill, URL scanner), modal focus trap + Escape, global keyboard guards (editing, modal suppression, CodeMirror handoff), save-flow propagation of the round-15 site write fix.



### Beta 6 — round 15

**Build pipeline (fixed):**
- **A missing or stale renderer bundle shipped silently** — `zephusEngine.js` is a gitignored artifact in src/, and electron-builder globs it without complaining: any build without a fresh compile packaged a blank-window app with zero errors. The copy step now verifies the bundle exists and is newer than the newest renderer source.
- **`npm start` (`electron .`) ran without devtools** — the `!process.defaultApp` clause was inverted (`electron .` sets it true). Now correctly detected.
- **A plain `tsc` could overwrite the esbuild bundle** with raw unbundled output (the renderer tsconfig emitted into src/). The config is now `noEmit`.
- **The smoke harness was triggerable on shipped binaries** (`--smoke` / `?smoke=1`) — gated on `!isPackaged`.

**Git noise (fixed):**
- **Every page save bumped site.json's `generatedAt`** (churn in every commit even for body-copy-only saves). The three site-writing paths now skip the write when the site (ignoring generatedAt) is unchanged — the returned site stays byte-equal to disk so the renderer's drift check cannot false-positive.

**UX (fixed):**
- **The Site URL validation failure was invisible** — the error went to the status bar, which sits UNDER the modal overlay. Now renders inline in the modal.
- **The git branch chip in the topbar was a dead span** that looked clickable — now opens the Git panel.
- **The preview URL vanished after 6 seconds** (status bar auto-clear) — a persistent chip with copy-to-clipboard sits next to the Preview button while running.
- **Mode and viewport switches were mouse-only** — new shortcuts: Ctrl/Cmd+E toggles Visual/Code, Ctrl/Cmd+1/2/3 switches desktop/tablet/mobile (documented in the Help modal).
- **Editing a page title left the nav label stale** — the nav label now follows the title until it is hand-set.

**Architecture (first engine extraction):**
- **Preview, publish, and dependency-install moved out of zephusEngine.ts** into `editorPreviewPublish.ts` (~375 lines) using the established deps-object pattern — with their three pieces of module state (previewStartInFlight, publishInFlight, previewLogSubscriptions). The engine is ~375 lines lighter and the preview/publish logic is now unit-testable. The full gate (799 tests, smoke, astro-build, coverage) is green on the cutover.



### ✨ Welcome to the Zephus 0.1.0 beta

Zephus is a **local-first visual editor for Astro sites** — no coding required to build and publish a real static site. Everything runs on your machine; your project is a normal Astro repository you can open in any editor, commit to git, and host anywhere.

**What you get:**

- **10 starter themes** (personal, portfolio, SaaS, blog, restaurant, event, and more) — pick one, and Zephus scaffolds the whole site, installs dependencies, and opens it ready to edit.
- **A true visual editor** — drag blocks, edit text inline, reorder sections, style with the inspector (colors, fonts, spacing, responsive viewports, and mobile/tablet previews).
- **22 block types** — headings, text, buttons, images, galleries, columns, features, pricing, testimonials, accordions, stats, post lists, embeds, video, raw HTML, and more.
- **Code mode with CodeMirror** — full source access; hand-edit any page and Zephus safely detaches it from visual mode instead of ever overwriting your code.
- **A real preview window** — run the actual Astro dev server and see your site live in its own window.
- **Publish** — one-click production build, output folder reveal, and a Git panel for commit/push/pull with first-run guidance.
- **Crash-proof** — unsaved edits are continuously drafted and restored after a crash; page/site/settings changes prompt before you lose them; every destructive action is confirmed.
- **Find & Replace across the whole site**, an asset manager with drag-drop import, per-page SEO settings, a 404 page on every new site, and design tokens (accent, fonts, radius, shadows) that flow into the built site.

**Safety promises:**

- **Your hand-authored code is never silently overwritten.** Pages you edit outside Zephus are detected and treated as hand-authored; metadata edits, renames, duplicates and reattaches all preserve hand-written bytes.
- **What you see is what gets built.** The canvas and the published site share one renderer; parser parity between the editor and the Astro build is continuously tested.
- **Nothing ships that breaks the build.** The test gate now runs 790+ unit tests, the runtime smoke test, a real `astro build` of every theme, and a coverage floor on every change.

**Known limitations (beta):**

- Updates are verified by HTTPS + SHA-512 from the release feed, but **code signatures are not yet enforced end-to-end** (Windows Authenticode, macOS notarization, and signed feed metadata are on the roadmap).
- The Git panel is commit/push/pull only — branch management and remote setup are CLI-side for now.
- Google Fonts load in the preview and the built site, but not in the editor canvas (CSP).
- Linux arm64 builds ship, but are the least-tested platform.

**Release checklist (this beta):** the pipeline now publishes drafts automatically and fails loudly when credentials are missing — build with `npm run release:beta:win/mac/linux`, verify the draft is published + tagged, and confirm the download links below match the released `v0.1.0-beta.5` artifacts.

---

### Audit round 14 — layout/feed correctness, inline editor, Windows paths, theme copy

**Legacy layouts (fixed):**
- **The legacy-layout nav sync was a complete NO-OP** — a depth-counting off-by-one (the opener was counted twice) made every balanced `<nav>` exit with depth 1, so the replacement never ran: labels, visibility and CTAs were permanently stale for legacy-mode projects. The depth math is fixed and verified for nested navs.
- **User nav ordering is now preserved** across syncs (previously rebuilt alphabetically, discarding editor reorders); a custom override keeps the original page item's children instead of dropping them.
- **A hand-edited site.json with non-string nav/shell fields crashed the whole project open** — `withSiteDefaults` now coerces every field.
- The Google Fonts link was dropped for `HTTPS://` or space-padded URLs (trim + case-insensitive); **custom.css now loads AFTER managed.css** so user overrides actually win; nav-link color no longer overrides `.button`-styled nav items (`:where()`).

**Feeds & SEO (fixed):**
- **XML-forbidden control characters** (from pasted Word/terminal text) passed raw into rss.xml, invalidating the whole feed for every reader — now stripped.
- **noindex and 404 pages were advertised in post lists** (and the derived feed/sitemap) — filtered from the index; detached pages' stale sidecar metadata no longer feeds listings either.
- **A hand-authored rss.xml was preserved but never advertised** when no dated posts existed — the layout now links it.
- **A scheme-less canonicalUrl/socialImage (`example.com/x`) resolved as a relative path** — sitemap loc, RSS link and canonical all became `https://site/example.com/x` (guaranteed 404). Bare host-shaped values now resolve as absolute https; root-relative routes (`/posts/x`) resolve against the origin, never a base-path prefix.

**Inline editor (fixed):**
- **Nested links silently vanished on render**: select text inside an existing link and apply a new one — `createLink` nests anchors, the stored prop carried invalid nested markup, and the renderer dropped the inner link. The read-back now mirrors the render-side guard (drop the tag, keep the text).
- **Dragging a block while inline-editing stuck the editor** (canvas re-render replaced the focused node; blur never fired; every click no-op'd). `renderCanvas` now finishes an active session first.
- **IME composition on blur committed partial candidate text** — finish is deferred until composition ends.
- **text/html-only pastes fused lines** (`a<br>b` → "ab") — br/block boundaries now become newlines.
- **Open-and-close of the inline editor on a whitespace-padded value pushed a phantom undo** — the baseline is trimmed.

**Windows (fixed by inspection):**
- **taskkill was invoked with an empty-string argument** (`hard ? "/f" : ""`) — the graceful kill always failed (and spawnSync does not throw, so the fallback never ran); the args array is now conditional and the status is checked.
- **The Node picker dialog dropped its options** when the main window was gone (the exact undefined-parent anti-pattern main.ts works around) — branches properly; the npm.cmd path quoting now escapes `%` (cmd.exe expands `%VAR%` inside quotes).

**Themes (fixed):**
- SaaS pricing CTAs pointed at `/contact` — a page that does not exist (3 dead links on the conversion page); retargeted to `/pricing`. The hero's `#features` anchor had no target — now "See pricing".
- The Project theme claimed "24/7 Support" while its contact page said "one business day" — aligned.
- The Docs theme's getting-started page contained literal instruction stubs ("Describe the first step here.") — real copy now.
- Portfolio placeholder identity ("Your Name", identical "Project One/Two/Three" blurbs) — concrete name and distinct projects; Restaurant/Event "Your City" placeholders and the invented "OpenStack UI" credential fixed.

**Cleanup:** removed the dead preview-frame iframe + its toggles and CSS, orphaned git/properties/asset/legacy-start rules, the dead 'searching' modal state, and the never-present home-screen button wiring; the undefined `--font-sans` variable is now defined.

### Audit round 13 — release readiness

**Release pipeline (fixed):**
- **The pipeline ended with assets in a GitHub DRAFT — updaters threw "No published versions on GitHub" and the CHANGELOG download links 404'd, all with green exits.** `gpg-sign.js` now publishes the draft (and creates the tag) on the final non-arch run.
- **`GH_TOKEN` missing silently skipped the signature upload with "✓ COMPLETE"** — a release-gate script now fails the pipeline hard when GH_TOKEN or the GPG key are missing.
- **`test:all` never ran coverage, the runtime smoke, or the Astro builds** — all wired in with real exit codes; `test-astro-build` now asserts actual `.html` output, not source counts.
- **Alpha/rc versions got no channel metadata** (their `latest.yml` was served to stable users); arch-less artifacts were signed twice / checksum-overwritten. Both fixed.
- **crawl-licenses silently dropped bundled-renderer attributions** when the esbuild metafile was missing — strict mode fails; license rows derive URLs from the repository field.
- Window size/position now persists between launches; the Windows signing config moved to `build-scripts/electron-builder.windows.cjs` (`signtoolOptions` publisher verification when Azure signing is active); hardened runtime + entitlements moved into the base mac config; dev artifacts (`*.map`, test mocks, fixtures) excluded from the asar; **`--dev` on a shipped binary no longer enables devTools or disables updates**.

**Beta-blocking UX (fixed):**
- **A failed dependency install stranded the user on the home screen** with the site never opened or recorded — the site now opens anyway with a retry hint.
- **Git's raw "Please tell me who you are" on the first commit** — the panel now explains the two `git config` commands to run.
- **The Node check ran AFTER the folder picker** (wasted step) — reordered; the create flow also surfaces a clear "previous scaffold in this folder" message on retry.
- **Installs had no Cancel** (30-min worst case with no abort) — added, killing the whole process tree.
- **Publish streamed no logs** (a 60s+ first build read as a hang) — build output now streams to the Dev Server Log; the success modal only claims the folder opened when it did.
- **The Preview button showed no starting state** — "Starting…" while the server boots; the dev log clears between sessions.
- **macOS Cmd+W → dock reopen left the preview dead** (services torn down on window-all-closed) — cleanup only happens on real quit.
- **A failed renderer load left an invisible window** — the error page's Reload button now actually works (CSP-safe) and renderer crashes reload with a guard.

**Windows code-signing (wired, optional):** the Azure Artifact Signing machinery from the ROSI pipeline now lives in Zephus — `build-scripts/electron-builder.windows.cjs` signs via Azure when the `AZURE_*` variables are complete (`npm run setup:win:artifact-signing` installs the client tools once per Windows VM), and produces unsigned artifacts with a clear warning otherwise. Zephus is not code-signing yet: nothing is required, `SKIP_WIN_CODESIGN=1` forces unsigned explicitly, and the release gate no longer demands `CSC_LINK`.

**Content/details (fixed):**
- Event theme CTA said "June" under an "October 9" hero — aligned; blog scaffold post now dates at creation (was 1.5 years stale); SaaS pricing CTAs pointed at "#" — now `/contact`.
- `.env.local` (loaded by Vite with highest priority) is git-ignored — previously "Commit All" staged local secrets; the legacy-layout backup file stopped appearing in every first commit; `--dev`/version hardcodes removed from the About pane and splash (the splash's "20 schemas" was stale at 22).
- Docs corrected: false Ctrl+H/Ctrl+Enter code-mode shortcuts, port 3000→4321, wrong settings path, mobile-testing devtools claim, arm64 Linux availability.

### Audit round 12 — parser parity, undo baselines, panels, dual settings, packaging, build gates

**Parser parity (fixed — all previously caused silent detaches or file rewrites on identical content):**
- **Nested-element text lost spaces**: the renderer trimmed text inside the recursive walk, so `<p>before <span> after</span></p>` stored "before after" while the main parser stored "before  after". Trim now happens once at the top level only.
- **Raw html blocks drifted byte-by-byte per save**: the serializer re-indents every interior line by 2 spaces; without dedenting on parse, each save cycle added 2 more. Raws are now dedented on parse; top-level `<style>` handling matches the main parser (nested styles inside sections are preserved as html blocks instead of being dropped — previously hand-authored CSS vanished on the first visual save).
- **Legacy section labels diverged** (`Section N` vs `Main Content`); trailing loose blocks now label like the main parser, and legacy wrappers count like it too.
- **A stored `data-zephus-id` on a section with a broken props payload was discarded** (fresh id → byte change + lost responsive-CSS anchor). The main parser now honors it.
- **Post-list blocks with an invalid publishDate** made the renderer emit `<time datetime="garbage">` while main emitted nothing — zero-edit code saves detached. The renderer applies the same validator now.
- **`maxHeadingLevel < 6` clamped the renderer's serialized output but not the build's** (main emits up to level 6) — zero-edit detaches again. Serialization now matches the build; the canvas still clamps.

**Undo / dirty state (fixed):**
- **Page saves refresh the site baseline with a fresh `generatedAt`; every snapshot captured before the save differed ONLY in that timestamp**, so any later undo staged the old site as a spurious "Reverted a design change", marked the site dirty, and a save wrote back the pre-toggle site. Site comparisons now ignore `generatedAt`.
- **Undoing back to the last-saved tree left a phantom dirty flag** (stale dot, redundant draft write, spurious unsaved-work prompt). `doUndo`/`doRedo` compare the restored serialization against the saved source.
- **The nav eye-toggle swapped the site baseline under a staged site edit** (silently rebasing `pendingSiteDocument` — the next site save reverted the toggle). Guarded like reloadPages.
- Re-staged undo snapshots now preserve the editor kind (shell/design) for crash drafts and the conflict gate.
- CodeMirror edits now carry a change label; the summary's first-label dedupe no longer masks later different labels.

**Panels (fixed):**
- **NavList entries were plain `<li>` — clicking a nav item or pressing Enter did NOTHING** while they looked navigable (cursor, hover, href). Entries are now real buttons that open the page; custom page-less items are disabled with an explanation. The label/route layout splits so a long label can't clip the route.
- The nav list is cleared on project close; the 404 page's eye toggle is disabled (was enabled-but-inert); PageList/Layers missing `type="button"`; Layers active state exposed via `aria-current`.
- The dirty dot lied after switching away from a dirty page — now derives from real state per page.

**Dual settings UIs (fixed):**
- **The start-tab "Save"/"Reset" ignored the write result** — a read-only config dir printed "Settings saved." and applied values that never persisted. Both now check and surface errors like the modal.
- **Modal reset left the tab's Node row frozen on "Checking Node.js…"** and modal save left the tab's node status stale — both now refresh it.
- **The modal seeded from disk while the tab holds an unsaved draft** — saving then wiped the tab's edits. It now seeds from the last applied settings.

**Design system (fixed):**
- **Staging design with zero font changes silently stripped the Google Fonts link from the build** (themed sites lost their font). The existing `fontImportUrl` is preserved when no Google spec is chosen.
- **`var(--accent)` in the accent field is rejected** (it resolved to nothing — every link/CTA lost its brand color).
- Empty custom font stacks no longer emit an invalid CSS variable (fall back to the current stack).

**Find/Replace + Asset browser (fixed):**
- **Typing in Find while a search was in flight could drive Replace All with wrong counts and a wrong page set** (the stale response passed the seq guard). Query edits and case/whole-word toggles now invalidate in-flight searches.
- The "Search text changed" hint compared a trimmed query against the raw input (false hint forever for trailing-space queries); Solid roots for both modals are now disposed on close (previously leaked per open); asset select invalidates the cached data URL; deletes no longer leave the canvas showing a dead image; the asset previews reuse the canvas cache (duplicated full-file base64 fetches eliminated); overlapping refreshes are seq-guarded; Esc mid-drag no longer leaves a permanent "dragover" highlight.

**Module state (fixed):** a queued project open survived a thrown open (next open silently opened a project never clicked); a stale home-draft resume survived a failed enter; inspector-latch/selection echoes reset on close; the recovery card refreshes after a silent draft resume; page-only dirty now has a Discard Page action (was Save All only); the dev-server log clears between projects; the divergence note no longer suggests force-push.

**Packaging (fixed):**
- `nsis.publisherName` set (installers showed "Unknown Publisher"; the updater skipped signature checks entirely); hardened runtime + entitlements moved into the base config so `build:mac:*` produces Gatekeeper-valid builds (notarization stays release-only); dev artifacts excluded from the asar (`*.map`, test mocks, fixtures); **`--dev`/`NODE_ENV=development` on a shipped binary no longer enables devTools or disables the auto-updater**.

**Build gates (fixed):**
- **`test:all` never ran coverage, the runtime smoke, or the Astro builds** — the renderer could fail to boot while CI stayed green. All three are now wired in (with a real exit-code gate).
- **`test:astro-build` counted SOURCE files, not build output** — a zero-HTML build passed. It now walks `dist` for `.html` files.
- **gpg-sign silently skipped the GitHub upload when `GH_TOKEN` was unset** and printed "✓ COMPLETE" with a green exit — release pipelines now fail hard without a token. Alpha/rc versions now get channel metadata (previously their `latest.yml` was served to the stable feed). Arch-less artifacts are no longer signed twice / checksum-overwritten.
- **crawl-licenses silently dropped bundled-renderer attributions** when the esbuild metafile was missing — strict mode fails the compile; license rows now derive a source URL from the repository field.

**CSS (fixed):** the start view was unreadable in light theme (dark glass + dark token text) — sidebar, recents, welcome, about, theme and status cards now switch surfaces; workspace-tab active, dirty project name, kbd, pills, hidden-page and table hovers got light variants; theme cards regained a keyboard focus indicator (the global one was removed with `outline: none`); settings selects finally have styling.

### Audit round 11 — save round-trips, IPC security, lifecycle, performance, updater, browser fidelity

**Security (fixed):**
- **deletePage / renamePage / duplicatePage operated on ANY in-project file** — a compromised renderer could delete `.env`/`.git/config`, rename secrets into `src/pages/` (readable as pages), or copy them into pages dir. All three now require the target to be a real page under `pagesDir` with a page extension.
- **detachPageDocument wrote renderer-supplied bytes to a renderer-supplied path** via bare `fs.writeFileSync` — arbitrary in-root overwrite (layout, package.json) executed by later npm/dev/build spawns. The target is now canonicalized to `pagesDir` and the file is written atomically BEFORE the sidecar (a crash mid-detach previously left "detached" + truncated code).
- **`writePageDocument` accepted `..` traversal** (`../../layouts/BaseLayout.astro`) that normalized outside pagesDir. Rejected now.
- **`draftList` leaked every project's absolute paths** to any sender; the project-root approval map was never revoked on close/switch. Draft summaries no longer expose project paths to unauthorized callers; approved roots are revoked on project close.

**Save round-trips (fixed):**
- **The second code-mode save silently detached a managed page**: the renderer indented the body 4 spaces, the main serializer 2 — outputs never matched, so after a save-refill the next zero-edit save saw "content differs" and converted the page to hand-authored. Both now use one 2-space indent; the code view is also no longer rewritten (and CM history wiped) on every managed save.
- **Page-settings metadata edits were reverted by the next page save** (stale session doc). Metadata writes now merge into the session document; the eye toggle and nav-editor rows do the same.
- **Recovered site drafts always reopened as the SHELL editor** (a design-kind draft prompted a spurious save/discard conflict, and Discard threw away the restored edits). The draft now persists the editor kind; legacy raw-site drafts still restore.
- **Save mid-page-switch skipped a dirty SITE** (early-return bypassed the site branch). It now falls through and saves the site too.
- **Rename ignored a failed page read** (file+sidecar moved anyway, stale doc, orphan sidecar) — bails before any filesystem change now.
- Nested `index.astro` pages emitted `/blog/index` nav/canonical/sitemap/RSS hrefs (all 404 on the published site); `routeFromPage` now strips the trailing `/index`.

**Robustness (fixed):**
- **A corrupt-but-valid-JSON page sidecar (missing `sections`) crashed the whole project open** — every read/save failed the same way with no gate. Sidecars now default `sections` to `[]` with a warning.
- **deletePage restore could destroy hand-authored source** (writeSiteDocument failure regenerated detached pages from the stale tree; a failed read skipped the restore entirely). The file now always comes back, sidecar-only for detached pages.
- **before-quit cleanup killed the dev server/watcher/theme server even when the quit was CANCELED** by the unsaved-work guard — cleanup moved to `will-quit` (fires only after closes confirmed).
- **Preview reopen race**: the old window's `closed` handler could null out / tear down the newly opened preview. The handler now guards the captured window.
- **macOS dock click / second instance after the main window closed did nothing** (only quit+relaunch recovered) — both now recreate the window.
- **Renderer load failure left an invisible window forever** (splash gone at 30s, no UI) — `did-fail-load`/`render-process-gone` now surface an error/reload.
- Dev-server URL from a STOPPED server's draining stdout could settle a NEW server's promise (wrong URL, timeout kill). The handler now guards the child.
- **fs.watch self-write suppression was single-shot** — FSEvents duplicates surfaced a false "modified outside Zephus"; keeping the marker for the whole 30s suppressed genuine external edits. Now suppresses only the duplicate burst (~500ms).
- **Electron dialogs were called with `undefined` parent** — the real options object was dropped (lost filters/createDirectory). All dialog calls now branch explicitly.
- **Self-write markers grew unbounded** across saves; expired markers are pruned on each schema pass.

**Performance (fixed):**
- **Opening/saving a project rewrote every sidecar, layout, style and site.json unconditionally** (git churn on every open, O(N) writes per save). All outputs now content-compare before writing; site.json's `generatedAt` only bumps when something actually changed. `listPageMetadata` no longer runs the full ensure pass twice per save.
- **The asset browser hydrated every image as a full base64 data URL in parallel** (hundreds of multi-MB IPC payloads, main-thread stalls). The hydrated set is capped at 60.
- Hide-on-viewport toggles no longer double-repaint the whole page.

**Updater (fixed):**
- **Stable-channel users could be offered prerelease builds** (GitHub's `/releases/latest` can point at a beta). The stable feed now rejects prerelease candidates.
- **The README's updater-integrity claims were false** (no `.sig` verification exists anywhere). The claim is corrected and the remaining trust model documented honestly.

**Browser fidelity (fixed):**
- Tablet/mobile bezels locked the canvas height with `overflow: hidden` — content below the fold was clipped AND unreachable. Now `min-height`.
- maxWidth-capped sections sat flush-left on canvas while publishing centered — auto margins added.
- Button/CTA labels rendered underlined on canvas only (specificity leak) — excluded.
- `.btn:hover` hardcoded a dark color that flashed in light theme; resize-handle focus ring was invisible on light canvas. Both use theme tokens now.

**Tests:** the real-Astro compile test used stale CTA keys (`title`/`ctaLabel` never exercised the renderer); `test-astro-build` now fails on schema-ensure failures and zero-page builds; the coverage-threshold failure message reported the wrong number.

### Audit round 10 — modals, page settings, code editor, onboarding, editor rules

**Modals (fixed):**
- **A `choose()`-backed modal closed externally could hang its caller forever** (publish deadlocked: `publishInFlight` stayed true until restart). Every promise-backed modal now registers a close handler; bare `closeModal()` settles it.
- **Stale `closeModal()` after an await could close a NEWER modal** the user opened in the meantime. Async action flows now guard against popping frames they don't own.
- **Modal bodies' Solid roots were never disposed** (settings/shell/page-settings leaked one root + detached tree per open/re-render). The modal controller now runs per-frame cleanup; shell + page-settings dispose on re-render and close.
- The navigation-preview "Stage Navigation" ignored `writePageMeta` failures (silently lost rows) — now checks the result.

**Page settings (fixed):**
- **Slug edits were not normalized before the rename** — "My Page" produced a phantom `src/pages/My Page.astro` path, deselecting the page and breaking external-edit detection. The slug is normalized client-side (mirroring main) before rename; nested 404 routes (`404/custom`) get the same forced nav/noindex treatment as the exact `404` slug.
- Detach of a NON-open page wrote the stale modal-open source over a possibly newer disk file — reads fresh bytes at click time; the empty-code-doc falsy bug (`getCode() || rawCode`) now uses `??`.

**Code editor (fixed):**
- Empty code docs no longer fall back to stale `rawCode` on detach.

**Onboarding (fixed):**
- **Site creation opened the project BEFORE installing dependencies** — a failed/missing open still ran npm into a replacement folder. Install now runs first; open happens after, with a status message when the project can't open and background installs are reported honestly.
- **"I'll look around first" re-showed the welcome modal every launch** — dismissal is persisted.
- **A failed create left residue** (schema/404 generated after the theme rollback list) and refused retries — failed creates now clean the whole target when the folder was absent/empty; the npm package name is validated (214-char cap, no leading hyphen) so `npm install` can't reject it.
- **`dependenciesInstalled` treated ANY node_modules as success** — a partial directory from a failed install made preview fail cryptically. It now verifies every declared dependency is present.

**Editor rules (fixed):**
- **Rules only loaded at open** — a mid-session git pull that tightened `allowedBlocks` was ignored until reopen. Rules now re-apply after pull and are guarded against stale project applies; templates are filtered by the allowlist everywhere (palette, quick-insert, drag-drop, template-palette click), and section paste/duplicate/import-image paths now enforce it too.
- **`maxHeadingLevel` was cosmetic on the canvas** — the saved .astro/build emitted the un-clamped level (canvas ≠ build). The serializer now clamps like the canvas.

**Settings (fixed):**
- The settings modal never rendered the app version; "Open Config" silently no-oped on failure; node-path picking persisted settings even when Cancel was clicked (write moved to Save); the dead-custom-path lie (modal claimed the dead binary was in use) is gone — the real check message shows now; the theme setting is now REAL (light/system token sets + light start view + System follows the OS), not a dead `data-theme` attribute.
- Modal updater controls now refresh during a download (percent + Cancel), not only after it resolves.

### Audit round 9 — startup, shortcuts, git panel, updater, themes, templates

**Quit/close (fixed):**
- **The app silently refused to quit with unsaved work**: Electron cancels the close when beforeunload is prevented, with NO dialog — users clicked the close button and nothing happened (looked like a hang). Closing now surfaces the app's own save/discard/cancel modal and, once resolved, closes. Update installs resolve unsaved work first so a pending quit can never strand the update.

**Keyboard (fixed):**
- **Cmd+Z/Y in code mode hijacked plain-input undo** (find field, page-settings prompt, rename box): the code branch ran before the input-focus guard, reverting the CODE DOCUMENT instead of the field. Guard mirrored.
- **Canvas shortcuts fired while a modal was open** — Cmd+X cut a block from the page behind the settings modal; Cmd+Z reverted the page; Delete removed blocks; Cmd+S saved the page; Cmd+F stacked find over the modal. All editor shortcuts are now inert while any modal is open (native input copy/undo inside modals still works).
- **"h"/"?" opened the help modal from any focused element** (palette items, block shells, toolbar buttons). Now only fires from the page background or canvas.

**Git panel (fixed):**
- **Non-ASCII filenames (ü, 中文, 日本語) broke the panel and per-file commits**: porcelain's C-escaped paths (`\303\274ber.md`) were never unquoted and `git add -- "\303\274ber.md"` failed. Git now runs with `core.quotePath=false` + `LC_ALL=C` (also fixes English-only error matching on localized git — the Init button never rendered for German/French git).
- **Commit staged the last-saved state while the editor held newer edits** (commit of a half-written file mid-save too). Commit is now blocked while the editor is dirty, with an explanation.
- **Push without a remote was a guaranteed-error dead end** (button shown, every click failed). The panel now detects "no remote" and explains it instead of showing the button.
- **`git init` created no .gitignore** — "Commit All" could stage node_modules/ and .env. A safe default is now written.

**Updater (fixed):**
- **The startup check raced the renderer's listener** — the "update available" event was dropped and the sidebar falsely said "Up to date". Main now caches the last status; the renderer claims it after boot.
- **A hung download deadlocked the updater forever** ("Downloading (x%)" permanently, only recovery = Cancel or restart). The transfer now cancels after 30 minutes with a real error.
- **Cancel showed "Up to date"** (the "cancelled" status fell into the default branch). Now says "Update cancelled".
- **Quit-and-install could lose up to 800ms of unsaved edits** (pending draft timer destroyed by the process exit). Unsaved work resolves before install.

**Startup (fixed):**
- **The auto-restore of the last project swallowed user clicks** — clicking a different project during the ~1s restore silently opened the wrong one. Explicit user clicks are now queued and win over the automatic restore.
- The splash screen can no longer leave zero windows if the renderer fails to paint.

**Themes/templates (fixed):**
- **Every fresh site now ships a real 404 page** (previously no theme scaffolded one — visitors hit an unbranded generic 404).
- **The block allowlist (editorRules.allowedBlocks) was bypassed by Add Hero / quick-insert / Add Section templates** — forbidden blocks landed anyway. Template paths now filter by the allowlist.
- The dev-server URL parser no longer false-timeouts a healthy server at a chunk boundary.

### Audit round 8 — canvas internals, selection, inline editor, properties, resize, find-replace

**Canvas ≠ build (fixed):**
- **Section visual styles never reached the canvas** — every themed hero/band showed a flat 14px section with left-aligned text while the published site rendered the full surface band, centered, with 4.5rem padding. The canvas content area now carries the section's background/padding/align/radius/shadow.
- **`--zephus-container-width` and `--zephus-shadow` were never set on the canvas** — styled sections rendered full-bleed there (build caps them at the container column). Both tokens now apply.
- **The feature/pricing auto-grid existed only in the build** — the user designed full-width stacked cards that the published site laid out side-by-side. The canvas now mirrors the `:has()` auto-grid (sibling headings span all columns, like the build).
- **Percentage block widths compounded 2× through the preview wrapper** (60% rendered as ~36% on canvas). Fixed via the section-visual refactor + transparent placeholder: local asset images no longer fire a document-URL request with a broken-icon flash (`src=""`), and a failed asset read is no longer cached forever — the canvas retries instead of serving a permanently broken image.

**Undo/redo (fixed):**
- **Clicking a resize handle without dragging pushed a phantom undo entry, dirtied the page, and wiped the redo stack** — and dead arrow-key presses at MIN/MAX did the same. The undo snapshot is now pushed lazily on the first actual size change (both pointer and keyboard paths).
- Stale `selectedId` survived the code→visual switch (nothing selected on canvas while the inspector showed section 0's props; layers showed a pre-code-mode selection). The rebuild now clears both ids.

**Drop placement (fixed):**
- **Dropping into the gap between two sections landed at the END of the page** — the "Add section" rails sat outside any section shell, so their drops fell through to the append-to-last branch; the indicator showed the correct slot while the commit went elsewhere. Rails now target their own position (blocks go into the section before the rail).
- **Template drags showed a block-line indicator but inserted after the whole section** — section shells now respond to template payloads with the correct section-slot indicator, and the drop honors it.

**Inline editor (fixed):**
- **IME composition (CJK input)**: Enter confirmed a candidate and Esc cancelled — both fired mid-composition, committing half-typed text or wiping the edit. `isComposing` now guards both.
- **"::" typed into a stat/accordion pair value corrupted the pair** — the label side silently absorbed the remainder and compounded on every edit. The separator is now normalized to an em-dash at commit.

**Property panels (fixed):**
- **Post-list "Folder"/"Maximum posts" lied after clearing** — a cleared folder (all posts) displayed as `/posts`; cleared limit displayed as `5`. The panel now shows the actual stored value.
- **Spacer "Height" was a plain text field** that shipped unitless values as invalid CSS (spacer collapsed to 0px) and was silently shadowed by the Layout panel's Height. It's now a px-aware field that says when it's overridden.
- **Gallery "Columns" accepted garbage** (`0`, `-3`, `1e9`, `abc`) producing invalid CSS. Now clamped to 1–6 or cleared.

**Find & replace (fixed):**
- **The search counted matches in detached/out-of-sync pages that Replace All skips** — the confirmation dialog promised replacements that never happened. Search now skips them and reports how many hand-authored pages were skipped.
- The dev-server URL parser no longer false-timeouts a healthy server when the Astro banner split exactly at a chunk boundary.

### Audit round 7 — main services, undo, drafts, migrations, silent failures

**Data loss / corruption (fixed):**
- **Legacy `.md`/`.mdx`/`.html` pages were silently rewritten with Astro-component source** — plain markdown parsed as "canonical managed output" and was regenerated in place, breaking the page's shell/nav on build. Non-`.astro` files are now always treated as hand-authored (out-of-sync), never regenerated.
- **Draft-vs-saved comparison could never match in visual mode**: the draft was serialized by the renderer (4-space indent) but compared against the main-side generated source (2-space indent) — byte-inequality for identical content. That forced a bogus "Restore unsaved draft" prompt (and a permanent home card) for already-saved content after a crash. The comparison now uses the renderer's own serialization of the saved document.
- **Newer-beta projects are refused instead of downgraded**: a project with `schemaVersion` higher than this build's used to be read, re-merged, and rewritten (newer layout/nav/design overwritten, older schemaVersion stamped on every page). Opens now fail with a clear "update Zephus" message before any write.
- **Renaming a page orphaned its old recovery draft** — the home card lingered forever. Renames now clear the old slug's draft.
- **Duplicating a managed page produced an out-of-sync copy stuck in hand-authored mode** (null hash + copied original bytes ≠ regenerated copy). The copy now carries the original's hash — its bytes ARE the original's.

**Silent failures (fixed):**
- **Install modal hung forever on failure** — the failure branches left the modal open with a dead "Run in Background" button, freezing the app behind an undismissable dialog. Failures now close the modal and surface a proper error dialog.
- **"Settings saved." was claimed when the write failed** (read-only config dir, invalid custom node path). Save/reset now check the result and report the real error.
- **Crash-recovery draft writes failed silently forever** (disk full, unwritable drafts.json) — the safety net died with zero warning. A one-time status warning now surfaces.
- **"Copied block/section." was claimed when the OS clipboard write failed** — and the section branch never touched the OS clipboard at all. Both now write the section HTML and report clipboard-unavailable honestly.
- **"Open Output Folder" was a silent no-op** when the folder didn't exist (common after a rebuild). Now reports why.

**Undo/redo (fixed):**
- The nav eye-toggle pushed no undo entry — Ctrl+Z did nothing (or, worse, a later unrelated undo popped a pre-toggle snapshot and "reverted the toggle" as a side effect). The toggle now pushes a snapshot.
- Discarding a staged site change left the pre-staging undo entry on the stack — the next Ctrl+Z was a visible no-op and polluted redo. No-op entries are now dropped on discard.
- `doRedo` lacked the mid-drag latch guard `doUndo` has — Ctrl+Shift+Z during a drag silently lost the resize. Guard mirrored.

**Robustness (fixed):**
- A partial/hand-edited site.json missing `design`/`shell` crashed the open with a TypeError after partial writes. Defaults now fill every missing field (including the detected layout path).
- The reusable-sections legacy migration re-triggered whenever a project had zero saved sections — deleted sections resurrected on the next read. Migration now runs only when the project store was never created.
- Legacy-layout nav sync rewrote the layout on every open (mtime churn, git noise). Now short-circuits when the nav is unchanged.
- Drafts without a `savedAt` were never pruned and accumulated forever. They're now deleted on write.

### Audit round 6 — security, page CRUD, site settings, publish, code sync, assets

**Data loss (fixed):**
- **Eye-toggle / settings save / stage-navigation silently destroyed hand-authored code on a detached or out-of-sync page.** Every metadata write routed through `writePageDocument`, which regenerated the .astro from the (stale) sidecar tree and forced the page back to "managed" — with the watcher suppression hiding it. Metadata writes now detect detached/out-of-sync pages and update ONLY the JSON sidecar (`writePageMetadataPreservingSource`), leaving the file bytes untouched.
- **Duplicating a detached page dropped all hand-authored content** (bytes copied, then regenerated from the stale tree). Copies now preserve the detached state and the copied bytes.
- **Deleting the open page silently discarded unsaved edits** (delete path skipped the save/discard prompt the page-switch path uses). Now resolved via `maybeResolveUnsavedWork`. Deleted non-open pages also have their recovery drafts cleared now.
- **"Reattach Visual" and "Reload From Disk" banner buttons discarded unsaved code edits silently** (bypassed the unsaved-work guard). Both now resolve save/discard/cancel first.
- **Rename page → metadata save failure stranded the editor on the deleted old path** (next Save resurrected the file, duplicating the page). The editor now follows the rename.
- **Site settings "changed on disk" false positive blocked every site save and deadlocked autosave page-switches**: page writes bumped `generatedAt` on disk but returned the pre-write site object, so the drift check always fired. The returned site now reflects exactly what landed on disk.
- **Undo-to-baseline left a stale recovery draft** → spurious "Restore Site Draft" prompt on next launch + a permanent home recovery card. Reverting to the saved state now clears the stale draft; a matches-saved draft is also cleared on read.

**Security (fixed):**
- **Stored XSS via a crafted block id**: `data-zephus-id="x</style><script>…"` terminated the `<style>` raw-text element and executed in the published site. Angle brackets in CSS selectors are now hex-escaped (`\3c `/`\3e `) — no literal `<`/`>` ever reaches the style text, and the selector still matches.
- **Arbitrary file write via `doc.page`**: a stale/compromised renderer could submit `page:"package.json"` and clobber it (bypassing the protected-target denylist). Write targets are now always derived from the normalized slug, confined to `pagesDir`.
- **Nav merge deleted a hand-authored custom link whose href matched a page route** (silently, on every site write). Custom items now deliberately override the matching page item, keeping their own label/visibility.
- **Asset repoint false positive**: `assets/hero.png` (no leading slash) was rewritten inside `/foo/assets/hero.png`. `/` is now a path-continuation character, so only whole-path references repoint.

**Correctness (fixed):**
- **Publish "newer edits NOT included" warning false-negative**: captured dirty-state before the save/discard resolution, so edits made mid-build after starting dirty were silently excluded with a clean "Build complete". Dirtiness is now checked after resolution.
- **Eye-toggle stale nav panel**: the layout was updated on disk but the in-memory site baseline was not, so the nav panel showed the old visibility until a page switch/save. The baseline now refreshes.
- **Code-mode save wiped the CodeMirror undo/redo history on every managed save** (EditorState recreated even when content was unchanged). Unchanged saves now skip the refill.

**Cleanups:** asset data-URL cache invalidated on rename/delete (canvas no longer serves a deleted/replaced file's bytes for the session).

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

### Bug hunt

- **Hand-authored content after `</BaseLayout>` was silently dropped** (`extractManagedInner` in schema.ts): the main-process parser sliced up to the last layout close tag and discarded everything after it. Pages with trailing hand-written markup got false "modified" flags and lost content on regeneration. It now only slices the layout region when the close tag really ends the body — and the renderer's `splitManagedPageSource` was aligned (case-insensitive close tags, content after the close kept).
- **Unclosed container markup was silently lost** (`splitTopLevelNodes`): an element missing its close tag (e.g. a hand-edited page with a broken layout) consumed its children into a depth counter and never emitted them — the page parsed as empty. The remaining markup is now preserved as content.
- **Entity decoding used a 43-entry subset table**, while the renderer's DOM parser (parse5) decodes the full HTML5 spec. `&eacute;`, `&amp` (no semicolon), `&#65`, and `&notit;` all parsed differently between main and renderer, producing hash mismatches and double-escaped rewrites (`&amp;amp;`) of hand-authored pages. The main parser now uses the same `entities` decoder parse5 uses internally, so both parsers are byte-identical (verified by new parity cases).
- **XSS: `safeUrl` bypassed by tab/newline inside the scheme** (`renderHelpers.ts`): `java<tab>script:alert(1)` passed the scheme check, but browsers strip tab/newline before executing URLs — a paste of such a link into a button/CTA rendered an executable `javascript:` link in published sites. The check now strips ASCII tab/newline first (WHATWG behavior); the canvas sanitizer in `editorBlockRender.ts` got the same fix.
- **New parity regressions locked in**: mixed-case layout close tags, missing close tags, literal `</BaseLayout>` inside HTML blocks, and full HTML5 entity semantics.

---

### Full audit pass

Every source file was read and audited (engine, schema, all services, all UI components, all build scripts). The confirmed bugs below were fixed with regression tests; a full `npm run test:all` + `test:cov` + smoke run passes.

**Data loss / corruption**
- **Adopting a legacy project could destroy hand-authored pages.** `ensureVisualSchema` regenerated every hash-less page from its (lossy) parse tree — frontmatter imports/consts, Astro `{...}` expressions (which then broke the build), and `<style>` blocks were silently deleted. Migration now detects non-canonical pages (anything beyond the BaseLayout import + key/value metadata) and leaves them untouched, flagged out-of-sync instead.
- **An unterminated `<!--` comment dropped the rest of the page** (`splitTopLevelNodes`) — the unclosed-container sibling case that was missed last time. Content after the comment is now preserved.
- **`writeProjectFile` wrote non-atomically** (truncate-in-place) — a crash mid-write left a half-written page. Now uses the same temp+rename atomic writer as everything else.
- **The file watcher died after atomic saves on macOS** (kqueue follows the inode; editors replace files via rename). The watcher now watches the parent directory and filters on the filename, so external edits keep being detected.
- **Asset rename repointing broke on filenames with quotes/backslashes** (`JSON.stringify` escaping made matches impossible and could produce invalid JSON that aborted mid-repoint). Repointing now walks the parsed section tree.
- **CodeMirror Ctrl+Z/Ctrl+Y reverted two steps** — CM6's keymap handles the key with `preventDefault` (no `stopPropagation`), and the document-level handler ran the same command again. Handled events are now skipped (also fixes CM's own Ctrl+F stacking the app's find modal).
- **Inline edits were excluded from saves**: typing in a contenteditable and hitting Ctrl+S serialized the pre-edit content (and deleted the recovery draft). Save now commits the active inline session first.
- **`&` in inline-edited text double-encoded to visible `&amp;`** when browsers wrapped the text in spellcheck/execCommand elements — the escaped walk output was stored without markup and re-escaped on render. Wrapper-only output is now decoded back to plain text.
- **Keyboard resize pushed a no-op undo entry** (snapshot after the mutation) — Ctrl+Z lit up and did nothing. Snapshots now happen before mutating, like the pointer path.

**Correctness**
- **Page rename silently killed the file watcher** (stopped before the rename, never re-armed on failure or for non-open pages). The watcher now survives renames it doesn't touch and is re-armed on failure.
- **Undo of site edits did nothing when the snapshot had no site document** (`site: null` fell through every branch). Staged edits are now cleared back to the captured state.
- **`// srcDir: './old'` comments and template-literal config values were read as the real Astro config**, sending the editor and build to a garbage folder. Config scanning now skips comments and unmatched shapes.
- **Responsive CSS selectors used HTML entities inside `<style>`** (never decoded there) — ids with `&`/`"` never got responsive rules. Now escaped with CSS string rules.
- **Section chrome clicks selected then immediately deselected** (missing `stopPropagation`) — section label/breadcrumb clicks were dead.
- **Prerelease ordering was wrong across tags**: `rc.2` was "downgraded" to `beta.9` (shared rank, numeric-only compare), and non-standard `-beta10`/`-db7` tags were classified as stable. Tags now rank alpha < beta < rc, and digits after a tag still mean prerelease.
- **Inline-edit session stuck forever** when focus hopped text → link input → canvas (blur chain missed the second hop) — every canvas click was swallowed. A toolbar `focusout` listener now ends the session.
- **Git ops had no timeout** — a stalled network hung the Git panel forever. All git calls now time out at 60s.
- **`npm install` timeout killed only npm, not its tree** (postinstall/node-gyp kept running into the next install) — the whole process group is now terminated (with SIGKILL escalation), and a spawn-start TDZ crash was fixed.
- **`update-available`/`download` could race**: checking while a download ran re-configured the feed mid-transfer; cancelling could report "downloaded" afterward. Both are now guarded.
- **Theme preview server races**: a second `ensure` with a different root got the first root's pending bundle; a stop during listen orphaned a live server. Now per-root pending + generation counter.

**Security / hardening**
- **`importAssetsFromPaths` could copy the project's own files into itself** (including renamed secrets). In-project sources are now rejected.
- **Hand-edited settings.json crashed the project list** (non-string entries in `recentProjects`/`lastOpenedProject` threw in `path.resolve`). Entries are now type-filtered on read.
- **Canvas sanitizer missed `<form action="javascript:...">`** — `action` is now stripped like `formaction`.
- **Node resolution cache never expired** — a user installing Node mid-session was stuck with "missing" until restart. The cache now expires after 30s.

**Build tooling**
- **`dist-tools.js` cleaned cwd-relative paths** — running it from any other directory deleted that directory's `dist`/`release`. Paths now resolve against the repo root.
- **`ensure-draft-release.js` exited 0 without a GH_TOKEN**, letting per-platform jobs race on draft creation. It now fails loudly.
- **Coverage gate only whitelisted known files** — brand-new files could ship at 0%. An overall statements/lines floor (80%/82%) is now enforced.
- Diverged-branch Git advice told users to fast-forward pull with local commits ahead (guaranteed to fail); the label now suggests merge/rebase.

---

### Audit follow-up

- **Pasted newlines corrupted line-encoded blocks** (stats numbers, list items, accordions): a multi-line paste into a stat/label put a literal `\n` inside one `left :: right` line, shifting every following pair. Newlines are now collapsed for single-line targets in both the plain-text read path and the rich-text walk.
- **Case-only asset renames produced `Hero-1.png`** on macOS/Windows (case-insensitive filesystems treated the new casing as a collision). The collision check now ignores case there.
- **Git rename entries parsed wrong**: porcelain v1's `R  old -> new` was reported (and later committed) as the literal `"old -> new"` path. Renames/typechanges now resolve to the new path.
- **Page saves became non-atomic again** (`writePageDocument`) — the .astro write now uses the atomic writer, so a crash can't corrupt a page whose sidecar hash was already updated.
- **Legacy layout nav could emit `javascript:` hrefs** (`syncLegacyLayoutNav` bypassed `safeUrl`) — now gated like every other nav render.
- **Astro configs using `outDir: new URL('./build', import.meta.url)`** fell back to `dist`, so "Open Output Folder" revealed the wrong directory. The pattern is now parsed.
- **Builds that exceeded the 20MB log buffer reported a confusing `maxBuffer` error** — raised to 100MB with a clear message for genuinely huge output.
- **Close Project double-invocation raced**: the guard was set after an await, so two rapid closes ran the teardown twice. The guard now applies before the unsaved-work prompt.
- **Link-picker kind switches discarded typed text** — switching to page/anchor/email/phone replaced the user's typed URL with a prefill. Typed input is now preserved.
- **Esc on a modal with no Cancel button hung the awaiting code forever** (only third-party `choose()` callers, but a permanent hang). An escape hook now settles the promise as a cancellation.
- **Find/Replace kept stale results visible after editing the query** — the results list now re-renders into the "Search text changed — press Find" hint (typing focus preserved).
- **An all-dev lockfile emptied the license list** (empty allowlist filtered everything); an empty production set now means "no filter".
- **`file://` containment check was always-false** (trailing-slash root made `root + sep` unreachable) — the app's own frame allowlist is now functional.
- **Asset repointing and usage counts are NFC-normalized** so macOS NFD filenames match hand-authored references.
- The updater's hardcoded `"updater-status"` channel string now uses the shared IPC constant.

---

### Deep audit round (verified against the real Astro compiler)

Four parallel audits (unverified-spot verification, test-suite quality, IPC contract, undo/redo mechanics) plus empirical verification of every external claim using the actual Astro 6 compiler.

**Build-breaking bug, empirically confirmed**
- **Unescaped `{`/`}` in body text broke Astro builds**: the compiler turns `{ brace }` in a text node into `${ brace }` (ReferenceError at runtime; `{5}` silently renders as `5`). Attributes were already brace-escaped (`escapeAstroAttr`), text was not. `escapeHtml`/`escapeRichText` now emit `&#123;`/`&#125;` (browsers render them as braces, and the DOM parsers round-trip them), verified end-to-end: Zephus-generated page → real Astro compiler → clean output, and parse-back restores the literal text.

**Undo system (4 bugs)**
- **Inspector control changes pushed post-mutation undo entries** (Clear Image, hide-on checkboxes, selects): the first Ctrl+Z was a visible no-op and wiped redo. The latch now snapshots at focus and pushes only when the session actually changed something; control-triggered changes push explicitly before mutating.
- **Focusing an inspector field and blurring without typing destroyed the redo stack** for a phantom no-op entry — fixed by the same push-only-when-changed latch.
- **Ctrl+Z mid-drag silently lost a resize** (undo popped the pre-drag snapshot while the drag kept mutating detached clones). Undo is now suppressed while a resize is active.
- **Undo after a code→visual switch restored content the user had already discarded** (code-edited tree replaced, old stack still pointed into the old tree). The stack is cleared when a dirty code parse replaces the tree; same for reloads that swap the site document (a page-only undo could stage a stale site and claim "Reverted a design change").
- Stale dirty indicators after undoing a staged site edit now refresh.

**Other confirmed fixes**
- **`withPageMetaDefaults` left `navVisible: undefined`** for sidecars predating the field — such pages silently vanished from the navigation after an upgrade. Undefined now defaults to visible, matching the frontmatter path.
- **Editor/main body-region divergence**: the renderer matched the LAST `<body` in the file (a `<body`-looking string in a later script shifted the split); both parsers now use the first.
- **Link picker silently replaced a valid-but-unlisted route** with the first listed page. It now warns and offers a placeholder instead.
- **Preview log listener leaked on overlapping togglePreview calls** (single-slot reference overwritten, first subscription never removed). Subscriptions are tracked in a set.
- **Symlinked assets**: delete/rename resolved the link and mutated the TARGET, leaving the in-project link dangling. Both operations now refuse with a clear message.
- **Unhandled promise rejections** at fire-and-forget IPC sites (draft writes, watchFile, page-meta reads, reusable-section delete, nav staging) — all now caught with status messages.
- **`readRepoSettings` typed `Promise<unknown>`** in the renderer contract — now `Promise<RepoSettings>`.
- **Two dead IPC channels removed** (`importImage`, `fileWrite` — defined, typed, exposed, never called).

**Test-suite quality (false-positive fixes)**
- `caseSensitive` search/replace had zero coverage — both flags now tested end-to-end.
- The canvas-vs-build "parity" tests compared `renderBlockNode` with itself (a wrapper calling the same function with the same defaults); a real canvas-vs-build comparison (including the `data-asset-src` and hideOn divergences) was added.
- `nodeCheckReal` asserted the whole status union (any result passed); it now asserts the resolution-honesty contract.
- `editorBlocks` accepted any truthy props for `html`; now requires the exact empty shape.
- `devServerFlow` never asserted the spawn env — a broken Node path resolution would have passed green; the env merge is now checked.

---

### Real-Astro validation + extended smoke + audit round 4

**The generated output is now proven against the real Astro compiler.**
- New `astroBuild.test.ts`: a page containing **every block type** (with hostile prop values — braces, quotes, ampersands, entities, emoji, newlines) is generated through the schema pipeline and compiled with the real `@astrojs/compiler` (Astro 6), along with the scaffolded layout.
- New `npm run test:astro-build`: scaffolds **all 10 bundled themes**, generates the managed schema, and runs a real `astro build` on each site. All 10 build clean today — this is the release-gate check that a generated page can never break the user's `astro build`.
- Empirically verified with the real compiler: the `&#123;` brace-escape scheme works (Astro keeps the entity in attributes), the fixed text-node escaping works, and rendered HTML round-trips (literal `&amp;` text renders as `&amp;` via `&amp;amp;`).

**Extended runtime smoke** (runs in the real Electron app):
- Undo/redo through the actual inspector latch: type → blur commits one entry, Ctrl+Z reverts, redo restores.
- Add block + undo, keyboard resize + undo, Escape-cancels-inline-edit.
- This immediately caught two real runtime behaviors worth knowing: the canvas-link click legitimately re-selects the clicked block, and the inspector panel re-creates its inputs on re-render (stale references must be re-queried).

**More fixes**
- **Section duplicate/paste re-id'd only top-level children** — nested blocks (none today, but the code anticipates them) kept colliding ids and shared style references. Both paths now use the deep-cloning `cloneBlock`.
- **Trailing-save loop reported total failure when the click-time snapshot saved but a newer flush failed** — the user was told nothing was saved when their first snapshot was on disk (the dirty flag still protects the newer edits; callers never lose them).
- **Canvas sanitizer gaps**: `<base>` removed outright (it hijacks every relative URL), `poster` checked for dangerous schemes, and `srcset` now filters dangerous entries while keeping safe ones.
- **Dev server timeout now hints when a port is already occupied** (zombie/foreign process) instead of the generic "did not report a URL".
- **Test mock hardening**: `ipcRenderer.invoke` in the Electron test stub now throws "not mocked" instead of resolving `undefined` — a test reaching through preload can no longer false-pass on undefined results.
- Wizard/page-manager coverage pushed (unknown theme, schema-failure rollback, 404 rename nav flips, duplicate-slug collisions, same-name rename no-op); app statement coverage is now **89.1%**.

---

### Coverage push to 94%

App statement coverage is now **94.3%** (was 89.1%), with **687 tests** (was 568). The coverage gate's overall floor was raised to 88% statements / 90% lines so it keeps catching regressions.

**New suites:**
- **Feed/discovery files** (`feedDiscovery.test.ts`): sitemap/robots/rss generation for a public URL, dated-post gating of the feed, hand-authored discovery files preserved verbatim, managed files removed when the URL is cleared — all previously untested.
- **Post-list refresh** (`postlistRefresh.test.ts`): postlist pages render posts at save time and refresh when posts are renamed.
- **Schema edge cases**: regex-parser legacy tags (button/image/divider/quote/list/embed), full inline-style vocabulary, bare-text html blocks, wrapper-section recursion, unknown block types through the build renderer, literal `<` preservation.
- **editorSession**: change summaries, dirty-flag/revision semantics, pending-over-saved precedence, deep cloning.
- **editorLineValues**: the `::`-pair encoding helpers (update/target/apply) that stats/accordion/list blocks rely on.
- **themePreviewServer error paths** (module-mocked `http`): bind failure and no-address listen both resolve clean errors.
- **Real-binary node checks**: fake node scripts prove resolution caching (one probe per window), and outdated custom paths honestly report "outdated".

**Expanded suites:**
- updater: progress/error/rejected-update events, check-during-download guard, thrown checks, cancelled/failed transfers.
- git: nothing-to-commit failure, fetch-failure status, detached-HEAD and unavailable push/pull, no-remote first push.
- devServer: second-start guard, different-project handoff (first server stopped), unreadable package.json, listener unsubscribe, SIGKILL escalation.
- drafts: legacy page-shaped entries, unwritable-store failures.
- assetUsage: site-level repointing (favicon/footer/head), site reference reporting, missing-path errors.
- editorSave/editorSiteSave: every draft-clear failure mode (returns false, throws, mid-flight edits), detach/write failures, missing page path, save-activity tracking.
- editorInlineEdit: toolbar buttons (bold, clear formatting), dangerous links rejected, collapsed-selection warning, Escape on the link prompt, Ctrl+B.
- settings/fsSafe/project/licenses/findReplace: corrupt/unwritable config files, unreadable lockfiles, allowlist filtering, empty-needle validation, unwritable-page replace failures.

**Remaining sub-95% files are at their feasible ceilings**: win32-only code paths (devServer taskkill, nodeCheck candidates, npmCommand APPDATA), unreachable defensive branches (projectPaths escape, fsSafe walk-up), and failure paths whose fault injection can't interleave with synchronous writes (pageManager/wizard rollbacks). wizard/pageManager also suffer coverage-mapping drift between the compiled and source forms.

---

### Coverage push to 95.4%

App statement coverage is now **95.4%** with **709 tests** (was 94.3/687). The gate floor now sits at 92% statements / 93% lines.

**Bugs found while testing:**
- **wizard.ts was measured at 71% because the rollback catch was genuinely untested** — every failure mode hit the empty-folder guard first. A read-only parent (`mkdirSync` EACCES) reaches the rollback; wizard is now 90.3%.
- **devServer.ts had the same TDZ bug fixed earlier in install.ts**: a synchronous spawn failure crashed with "Cannot access 'timeout' before initialization" instead of returning an error result. Fixed (declared up front, guarded `clearTimeout`); the spawn-throw path is now tested.
- **pageManager's rename/duplicate/delete rollbacks now tested** via read-only sidecar directories (78% → 84.3%): the rename restores the original file, delete restores it, and duplicate removes the orphaned copy.

**Refactors for testability:**
- `windowsNodePaths(homedir, env)` extracted from nodeCheck — the win32 candidate list is now tested on any platform.
- `taskkillProcessTree(pid)` extracted from devServer's win32 stop path — tested against the spawn mock.
- npmCommand's APPDATA resolution now tries the host-style path first (matching the PATH candidates), so POSIX test hosts can resolve temp dirs — real Windows behavior unchanged; the APPDATA branch is now covered.

**New tests:** licenses default-location + no-`@` ids, drafts malformed entries, themePreviewServer default-root server, assetUsage custom-head references + corrupt-site failures + mid-repoint abort, editorSave page-changed-mid-detach + missing-document + code-mirror refresh, editorSiteSave newer-edits-with-warning race (mutation landing between the two `hasNewerEdits` checks), readPageMetadata un-normalizable slug fallback.

**Verification of coverage mapping**: the v8 JSON line numbers drift from the source for several files (esbuild transform mapping), so the text reporter's line lists were used as the source of truth throughout — several "uncovered" lines were proven covered by direct branch probes.

---

### Audit round 4 — six fresh-angle audits

**Data loss (HIGH, fixed):**
- **Saving page A could prompt a false "modified outside Zephus" on open page B and Reload would silently discard B's unsaved edits.** The post-list refresh regenerates OTHER pages on disk → the watcher fires → the renderer's own-write guard can't recognize the (legitimately changed) disk state. The main process now marks every schema write (`writePageDocument`, `refreshPostListPages`) as self-written and the watcher suppresses those events (30s window).
- **Renaming a detached/out-of-sync page destroyed the hand-authored file**: the rename regenerated the .astro from the stale sidecar tree. Renames now move bytes and update only the sidecar metadata for detached/out-of-sync pages.
- **Asset repoint and Replace All clobbered detached/out-of-sync pages** with regenerated output — both sweeps now skip them.
- **Reattach destroyed hand-authored code** (`<style>`/imports/expressions silently dropped) — now guarded by the same canonical-source check as migration.

**Feature-breaking (fixed):**
- **Theme previews were always EMPTY shells** — `generate-theme-previews.js` missed `regenerateHashlessPages: true`, so the scaffold stubs were never materialized (theme picker showed blank pages). One option; previews now build real content (verified: 5KB of real markup per page).
- **Dev Server Log panel froze right after preview startup** — `togglePreview`'s `finally` unsubscribed ALL log listeners on success. Each invocation now owns its subscription.
- **Every hero CTA rendered as a plain accent link** — the `button` block never emitted the `.button` class the theme CSS styles. Now merged with the user's `cls`.
- **Restaurant menu rendered literal `&lt;h3&gt;` text** — the menu columns contained block tags the inline renderer escapes. Now rich text (`<strong>` + line breaks).

**Races / UX (fixed):**
- Publish: added an in-flight latch (double-click no longer fires two builds or a scary "Build Failed" for the rejected second) and a dirty-recheck — "newer edits not included" is now stated instead of a misleading success.
- Preview: `previewStartInFlight` latch for double-clicks; failure paths tear down only the failed invocation's subscription.
- Git panel operations serialized on a chain (no more `index.lock` collisions or mid-transition status snapshots).
- `watchStart` now reports failure honestly (a refused watch means NO file is watched).
- "Keep Mine" on an unreadable file no longer re-prompts forever (one-shot suppression for the same change).
- Project-open re-entrancy guard; failed opens clear the pending draft-resume request; new-page flow matches normalized slugs ("My Page" now opens the created page).

**Canvas fidelity (fixed):**
- Block styles double-applied on the canvas (wrapper + inner element) — padding/margins showed ~2x the build output. The wrapper now carries only the outer layout box.
- Length fields sanitize typed numbers — ".px"/"-px"/"1e5px" no longer write invalid CSS into saved files.

**Theme/shell polish:** event theme dated to a future October date; blog footer uses the real site name; `mailto:`/`tel:` links now open externally; crawl-licenses no longer ships absolute dev-machine license paths.

**Test-suite fixes:** the bold-formatting test asserted a tautology (now verifies the execCommand call); the licenses default-path test was cwd-dependent (now accepts both outcomes); the Node-version test was runner-version-dependent; the watcher tests now wait for FSEvents registration before writing and test the filename filter as a pure function (event delivery under parallel load turned out to be the flake — the suite now runs files serially, ~31s total).

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
