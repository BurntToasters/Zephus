# Development Guide

Notes for working on the Zephus Electron app and editor.

## Prerequisites

- **Node.js** ≥ 24 and **npm** ≥ 10 (see `package.json` `engines`)
- **Git** (for project version control and for testing the in-editor Git panel)

## Common commands

| Command | Purpose |
|--------|---------|
| `npm test` | Run Vitest unit tests |
| `npm run compile:renderer` | Bundle `src/renderer/zephusEngine.ts` → `src/renderer/zephusEngine.js` |
| `npm run compile:main` | Compile main process + preload bundle |
| `npm run compile` | Full compile used before desktop builds |
| `npm run typecheck:main` | Typecheck main process |
| `npm run typecheck:renderer` | Typecheck renderer |

After changing **renderer TypeScript**, run `npm run compile:renderer` before manual app testing. The shipped app loads the bundled `zephusEngine.js`, not the `.ts` sources directly.

Some tests touch `.git` in a temp directory (`files.test.ts`); run the full suite outside restricted sandboxes if that test fails with `EPERM`.

Vitest aliases `electron` and `electron-log` to stubs in `src/test/mocks/` so `npm test` does not require a working Electron binary download. Running the desktop app (`npm run dev` / `electron .`) still needs Electron installed correctly (see [Troubleshooting — Electron install](./TROUBLESHOOTING.md#electron-failed-to-install-correctly)).

## Architecture overview

```
src/main/          Electron main process (IPC, schema, git, filesystem)
src/main/services/schema.ts   Build-side page generation (Astro output)
src/shared/        Code shared by main + renderer (no Node in renderer imports)
src/renderer/      Editor UI (Solid islands + zephusEngine orchestrator)
```

IPC crosses the boundary via `preload.ts` → `window.zephus` in the renderer.

## Render parity (important)

Managed pages must stay consistent between:

1. **Build** — `renderBlockNode` / `renderSectionsMarkup` in `src/shared/blockRender.ts` (used from `schema.ts`)
2. **Editor serialize** — visual save / detach compares via `assembleManagedPage` + `blockToHtmlForEditor` with `forCanvas: false` and build heading levels

Shared pieces live in:

| Module | Role |
|--------|------|
| `src/shared/renderHelpers.ts` | Escaping, `styleAttr`, `blockMetadataAttrs`, list helpers |
| `src/shared/blockRender.ts` | Block + section HTML, responsive `<style>` collection |
| `src/shared/blockRenderFixtures.ts` | Golden test fixtures |

Tests to run when changing markup:

- `src/shared/__tests__/blockRender.test.ts` — section wrappers, serialize vs build
- `src/main/services/__tests__/renderParity.test.ts` — `renderBlockNode` snapshots
- `src/renderer/__tests__/editorSerialize.test.ts` — frame split/assemble
- `src/renderer/__tests__/editorBlockRender.test.ts` — canvas vs serialize heading caps

If you change `renderBlockHtml`, update snapshots deliberately and mirror behavior in both code paths.

## Renderer module slices

`zephusEngine.ts` is still the central orchestrator (~7.2k lines). Prefer adding logic to focused modules:

| Module | Responsibility |
|--------|----------------|
| `editorCommands.ts` | Mode guard, clipboard rules, paste, toolbar undo state |
| `editorGit.ts` | Git panel IPC (status, commit, push, pull, init) |
| `editorSave.ts` | Page/site save flow, status messages, draft clear on save |
| `editorParse.ts` | DOM parse of managed inner HTML → sections/blocks (code/visual load) |
| `editorPageModel.ts` | Clone sections, flatten blocks, build page document snapshots |
| `editorUndo.ts` | Unified page + site undo snapshots, stack limit, restore |
| `editorDraft.ts` | Debounced crash-recovery draft writes (`site-shell` target) |
| `editorInspector.ts` | Inspector undo latch + debounced canvas repaint while typing |
| `editorUnsavedWork.ts` | Unsaved page/site summary lines for confirm modals |
| `editorLog.ts` | Capped install/dev log append helper |
| `editorSiteSave.ts` | Persist or discard pending site shell/design changes |
| `editorDraftRestore.ts` | Page/site crash-recovery draft restore prompts |
| `editorSerialize.ts` | Split/assemble managed page source (frontmatter + frame) |
| `editorBlockRender.ts` | Canvas HTML sanitization, heading caps, section/block HTML for editor |
| `editorSession.ts` | Dirty tracking, site/page session snapshots, page/site edit revisions |
| `editorWorkspace.ts` | Left/right rail tab switching (`activateWorkspaceTab`) + focus handoff |
| `inlineRichText.ts` | Reads an inline-edited element back into a stored text prop |
| `*Panel.tsx`, `CanvasView.tsx`, … | Solid UI mounted from `init()` |

New editor features should follow the same pattern: pure helpers + Vitest in `src/renderer/__tests__/`.

## Inline rich text

Text props may contain a small inline subset: `strong`, `em`, `u`, `s`, `code`, `br`, and `a[href]`.

- `richTextToHtml` (`src/shared/renderHelpers.ts`) renders it, and is used by **both** the canvas and the build, so parity is automatic. Everything outside the subset is escaped; the only attribute ever emitted is an `href` filtered through `safeUrl`.
- **A value with no inline markup falls back to `plainTextToHtml` byte-for-byte.** That is what keeps pages authored before this feature (and any literal `&`/`<` in them) rendering identically. Don't remove that fallback.
- `richTextFromElement` (`src/renderer/inlineRichText.ts`) reads the edited contenteditable back into a prop. It drops whatever `execCommand` and pasting produce (spans, styles, block wrappers) and returns **plain text when no formatting was used**, so props stay plain unless formatting is really present.
- Props stored one-per-line (list items, accordion, stats) pass `allowLineBreaks: false` — a newline there would corrupt the line encoding.
- Labels rendered inside an `<a>` (button, pricing CTA, CTA button) pass `allowLinks: false`, since nested anchors are invalid HTML.

## SEO output

`renderManagedLayout` owns the generated `<head>`. Canonical links, Open Graph image URLs, and `sitemap.xml` all require `site.siteUrl`; when it is empty they are omitted rather than emitted relative, because social platforms need absolute URLs.

`writeDiscoveryFiles` writes `sitemap.xml`/`robots.txt` only when they are absent or carry the `zephus:managed` marker, so hand-authored files survive.

Page SEO props reach the layout as attributes on `<BaseLayout>`. Booleans must be written as expressions (`noindex={true}`): a bare attribute serializes to the empty string, which is falsy in the layout's destructuring defaults.

## Editor state safety (async invariants)

Saves, loads, draft cleanup, and site writes are all async, and the user can keep editing while they run. Several rules exist to stop that from destroying work — keep them intact when touching these paths.

**Edit revisions.** `editorSession.ts` tracks `pageRevision` / `siteRevision`, bumped on every edit. Any async operation that captures a snapshot must re-check the revision before it treats that snapshot as the saved state.

**Save gates return "safe to leave", not "a write happened".** A save can succeed while newer edits remain unsaved. Navigation, preview, and close therefore go through `saveUnsavedWorkAndVerify()` / `maybeResolveUnsavedWork()`, which re-check `isGlobalDirty(state)` afterwards. Never continue a destructive action on the raw boolean from a write call.

**Page loads are staged, then committed.** `loadPageNow` builds the whole candidate page (document, sections, restored draft) *before* assigning any of it to `state`, then commits synchronously. This is what stops a superseded or canceled load from leaving the canvas, code editor, inspector, and page list on different pages. Do not move `state.page = …` earlier.

**Two different generations.** `latestPageLoadRequest` identifies one navigation (latest-wins). `editorSessionGeneration` identifies one open project. External-change handling must use the *session* generation, otherwise an unrelated page load silently discards a pending "changed on disk" prompt.

**Draft cleanup is fail-visible and revision-bound.** `clearDraft` returns an `OperationResult`; a failure must reach the user rather than being ignored, and cleanup after a forced reload is skipped when the revision advanced (deleting the newer recovery copy would be data loss).

**Busy means inert.** While a page loads, `setPageLoading` marks the editing surfaces and palettes `inert` and disables mutation controls; `onKeydown` also drops destructive shortcuts. Close does the same via `closingProject`, and clears loading state so the start screen is never left in a busy state.

## Git panel (manual QA)

With a Zephus project open: right rail **Git** tab — **Refresh** (fetches remote), selective commit, push, pull (`--ff-only`), init when not a repo. When the branch has an upstream, the top bar and panel show **↑ahead** / **↓behind** counts. See [Workflows — Version Control with Git](./WORKFLOWS.md#version-control-with-git).

## User-facing docs

End-user documentation lives under `docs/` (README, Getting Started, Workflows, Settings, Troubleshooting). Update those when behavior visible in the app changes.
