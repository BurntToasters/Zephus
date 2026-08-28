import { For, Show } from "solid-js";
import { render } from "solid-js/web";

export interface FindReplaceModalState {
  query: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Null until a search has been run. */
  matches: SearchMatch[] | null;
  totalMatches: number;
  /** The query the current results were searched with. */
  searchedQuery: string;
  onQueryChange: (value: string) => void;
  onReplacementChange: (value: string) => void;
  onCaseSensitiveChange: (value: boolean) => void;
  onWholeWordChange: (value: boolean) => void;
  onSearch: () => void;
  onOpenPage: (page: string) => void;
}

export function renderFindReplaceModalBody(
  container: HTMLElement,
  state: FindReplaceModalState,
): () => void {
  container.innerHTML = "";
  return render(
    () => (
      <div class="meta-form find-replace">
        <p class="muted">
          Searches text across every page in this site. Replacements are written
          to each page and cannot be undone with Ctrl/Cmd+Z, so review the
          matches first.
        </p>

        <label class="meta-field">
          <span>Find</span>
          <input
            class="text"
            value={state.query}
            placeholder="Text to find"
            onInput={(event) => state.onQueryChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                state.onSearch();
              }
            }}
          />
        </label>

        <label class="meta-field">
          <span>Replace with</span>
          <input
            class="text"
            value={state.replacement}
            placeholder="Leave empty to remove the text"
            onInput={(event) =>
              state.onReplacementChange(event.currentTarget.value)
            }
          />
        </label>

        <div class="find-replace-options">
          <label class="find-replace-toggle">
            <input
              type="checkbox"
              checked={state.caseSensitive}
              onChange={(event) =>
                state.onCaseSensitiveChange(event.currentTarget.checked)
              }
            />
            <span>Match case</span>
          </label>
          <label class="find-replace-toggle">
            <input
              type="checkbox"
              checked={state.wholeWord}
              onChange={(event) =>
                state.onWholeWordChange(event.currentTarget.checked)
              }
            />
            <span>Whole words only</span>
          </label>
        </div>

        <Show when={state.matches !== null}>
          <div class="find-replace-results" aria-live="polite">
            <Show
              when={
                state.searchedQuery === state.query &&
                (state.matches ?? []).length > 0
              }
              fallback={
                state.searchedQuery === state.query ? (
                  <p class="muted">No matches found.</p>
                ) : (
                  <p class="muted">
                    Search text changed — press Find to update the results.
                  </p>
                )
              }
            >
              <p class="find-replace-summary">
                {state.totalMatches} match
                {state.totalMatches === 1 ? "" : "es"} in{" "}
                {(state.matches ?? []).length} page
                {(state.matches ?? []).length === 1 ? "" : "s"}
              </p>
              <ul class="find-replace-list">
                <For each={state.matches ?? []}>
                  {(match) => (
                    <li>
                      <button
                        type="button"
                        class="find-replace-page"
                        onClick={() => state.onOpenPage(match.page)}
                      >
                        <strong>{match.label}</strong>
                        <span class="muted">
                          {match.count} match{match.count === 1 ? "" : "es"}
                        </span>
                      </button>
                      <For each={match.excerpts}>
                        {(excerpt) => (
                          <p class="find-replace-excerpt">{excerpt}</p>
                        )}
                      </For>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </Show>
      </div>
    ),
    container,
  );
}
