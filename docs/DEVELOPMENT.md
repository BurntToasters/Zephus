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

`zephusEngine.ts` is still the central orchestrator (~7k lines). Prefer adding logic to focused modules:

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
| `editorSession.ts` | Dirty tracking, site/page session snapshots |
| `*Panel.tsx`, `CanvasView.tsx`, … | Solid UI mounted from `init()` |

New editor features should follow the same pattern: pure helpers + Vitest in `src/renderer/__tests__/`.

## Git panel (manual QA)

With a Zephus project open: sidebar **Git** panel — **Refresh** (fetches remote), selective commit, push, pull (`--ff-only`), init when not a repo. When the branch has an upstream, the top bar and panel show **↑ahead** / **↓behind** counts. See [Workflows — Version Control with Git](./WORKFLOWS.md#version-control-with-git).

## User-facing docs

End-user documentation lives under `docs/` (README, Getting Started, Workflows, Settings, Troubleshooting). Update those when behavior visible in the app changes.
