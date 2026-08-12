/**
 * Find & Replace across the site (Cmd/Ctrl+F modal). Extracted from the
 * engine so the search-seq guard logic is unit-testable in isolation.
 */

import { renderFindReplaceModalBody } from "./FindReplaceModal";
import { isGlobalDirty } from "./editorSession";
import type { EditorSessionState } from "./editorSession";
import type { SearchMatch } from "../main/types";

export interface PageLoadOptions {
  skipUnsavedGuard?: boolean;
  skipDraftRestore?: boolean;
  /** Restore the recovery draft WITHOUT prompting (home-screen resume). */
  restoreDraftSilently?: boolean;
  forceReload?: boolean;
  afterLoad?: () => void | Promise<void>;
}

export interface FindReplaceDeps {
  getState: () => EditorSessionState;
  setStatus: (message: string) => void;
  showModalNode: (
    title: string,
    content: HTMLElement,
    actions: Array<{
      label: string;
      kind?: "primary" | "danger" | "ghost";
      onClick: () => void;
    }>,
    options?: { size?: "default" | "wide" },
  ) => void;
  closeModal: () => void;
  registerCleanup: (cleanup: (() => void) | null) => void;
  confirmDestructive: (
    title: string,
    message: string,
    confirmLabel: string,
  ) => Promise<boolean>;
  loadPage: (page: string, options?: PageLoadOptions) => Promise<void>;
  reloadPages: () => Promise<void>;
  maybeResolveUnsavedWork: (options?: {
    reloadCurrentPageOnDiscard?: boolean;
  }) => Promise<boolean>;
  searchPages: Window["zephus"]["searchPages"];
  replaceAllInPages: Window["zephus"]["replaceAllInPages"];
}

export async function openFindReplaceModal(
  deps: FindReplaceDeps,
): Promise<void> {
  const {
    getState,
    setStatus,
    showModalNode,
    closeModal,
    registerCleanup,
    confirmDestructive,
    loadPage,
    reloadPages,
    maybeResolveUnsavedWork,
    searchPages,
    replaceAllInPages,
  } = deps;
  const state = getState();
  if (!state.project) return;
  const project = state.project;
  const wrap = document.createElement("div");
  const formState = {
    query: "",
    replacement: "",
    caseSensitive: false,
    wholeWord: false,
    matches: null as SearchMatch[] | null,
    totalMatches: 0,
    searchedQuery: "",
    skippedDetachedPages: 0,
  };
  let searchSeq = 0;
  let disposeFindBody: (() => void) | null = null;

  const mount = (): void => {
    disposeFindBody?.();
    disposeFindBody = renderFindReplaceModalBody(wrap, {
      query: formState.query,
      replacement: formState.replacement,
      caseSensitive: formState.caseSensitive,
      wholeWord: formState.wholeWord,
      matches: formState.matches,
      totalMatches: formState.totalMatches,
      searchedQuery: formState.searchedQuery,
      onQueryChange: (value) => {
        formState.query = value;
        // Editing the query invalidates any earlier results: Replace All must
        // never act on a match list that was searched with different text.
        // Bump searchSeq so a stale IN-FLIGHT response (old query) cannot
        // repopulate the list past the seq guard and drive a replace with
        // wrong counts/page sets.
        searchSeq += 1;
        formState.matches = null;
        formState.totalMatches = 0;
        formState.searchedQuery = "";
        formState.skippedDetachedPages = 0;
        // Re-render so the stale result list is replaced by the
        // "Search text changed — press Find" hint; keep typing by restoring
        // focus and the caret to the end of the input.
        mount();
        const input = wrap.querySelector<HTMLInputElement>(
          ".find-replace input",
        );
        input?.focus();
        const len = input?.value.length ?? 0;
        input?.setSelectionRange(len, len);
      },
      onReplacementChange: (value) => {
        formState.replacement = value;
      },
      onCaseSensitiveChange: (value) => {
        formState.caseSensitive = value;
        searchSeq += 1;
        formState.matches = null;
        formState.totalMatches = 0;
        formState.searchedQuery = "";
        formState.skippedDetachedPages = 0;
        mount();
      },
      onWholeWordChange: (value) => {
        formState.wholeWord = value;
        searchSeq += 1;
        formState.matches = null;
        formState.totalMatches = 0;
        formState.searchedQuery = "";
        formState.skippedDetachedPages = 0;
        mount();
      },
      onSearch: () => void runSearch(),
      onOpenPage: (page) => {
        closeModal();
        void loadPage(page);
      },
    });
  };

  const runSearch = async (): Promise<boolean> => {
    const query = formState.query.trim();
    if (!query) {
      setStatus("Enter text to find.");
      return false;
    }
    const seq = ++searchSeq;
    const result = await searchPages(
      project.path,
      project.astro.pagesDir,
      query,
      {
        caseSensitive: formState.caseSensitive,
        wholeWord: formState.wholeWord,
      },
    );
    // A newer search supersedes this one; ignore the stale response.
    if (seq !== searchSeq) return false;
    if (!result.ok) {
      setStatus("Search failed: " + (result.error ?? "unknown"));
      return false;
    }
    formState.matches = result.matches;
    formState.totalMatches = result.totalMatches;
    formState.skippedDetachedPages = result.skippedDetachedPages ?? 0;
    formState.searchedQuery = query;
    mount();
    return result.matches.length > 0;
  };

  mount();
  showModalNode(
    "Find and Replace",
    wrap,
    [
      { label: "Close", kind: "ghost", onClick: closeModal },
      { label: "Find", kind: "ghost", onClick: () => void runSearch() },
      {
        label: "Replace All",
        kind: "primary",
        onClick: async () => {
          // Always search the current text first: the visible match list is
          // what the user is agreeing to replace, and editing the query after
          // a search invalidates the old results.
          if (!(await runSearch())) {
            if (formState.matches && formState.matches.length === 0) {
              setStatus("Nothing to replace.");
            }
            return;
          }
          const matches = formState.matches ?? [];
          if (matches.length === 0) {
            setStatus("Nothing to replace.");
            return;
          }

          // Replacement rewrites saved page sidecars, so pending edits must be
          // settled or saving afterwards would undo the replacement.
          if (isGlobalDirty(state) && !(await maybeResolveUnsavedWork())) {
            setStatus("Replace canceled: save or discard your changes first.");
            return;
          }

          const confirmed = await confirmDestructive(
            "Replace Across Site",
            `Replace ${formState.totalMatches} occurrence(s) of "${formState.query.trim()}" across ${matches.length} page(s)? This cannot be undone with Ctrl/Cmd+Z.` +
              (formState.skippedDetachedPages
                ? `\n\n${formState.skippedDetachedPages} hand-authored page(s) with matches will be skipped (their text is replaced in code mode only).`
                : ""),
            "Replace All",
          );
          if (!confirmed) return;

          const result = await replaceAllInPages(
            project.path,
            project.astro.pagesDir,
            formState.query.trim(),
            formState.replacement,
            {
              caseSensitive: formState.caseSensitive,
              wholeWord: formState.wholeWord,
            },
            matches.map((match) => match.page),
          );
          if (!result.ok) {
            setStatus("Replace failed: " + (result.error ?? "unknown"));
            return;
          }
          closeModal();
          // Pages changed on disk; reload the open one rather than keeping a
          // stale copy in the editor.
          if (state.page) {
            await loadPage(state.page, {
              skipUnsavedGuard: true,
              skipDraftRestore: true,
              forceReload: true,
            });
          }
          await reloadPages();
          setStatus(
            `Replaced ${result.replaced} occurrence(s) across ${result.pagesChanged} page(s).`,
          );
        },
      },
    ],
    { size: "wide" },
  );
  registerCleanup(disposeFindBody);
}
