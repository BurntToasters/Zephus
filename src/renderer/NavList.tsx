import { render } from "solid-js/web";
import { For, Show, createEffect, createSignal } from "solid-js";

export interface NavListEntry {
  id: string;
  label: string;
  href: string;
  /** Project page path for the entry; null for custom (page-less) items. */
  page?: string | null;
}

export interface NavEmptyState {
  showPageSettings: boolean;
}

export interface NavListHandlers {
  onPageSettings: () => void;
  onReviewNavigation: () => void;
  /** Opens the page the nav entry points to (page-less items do nothing). */
  onOpenPage: (page: string) => void;
}

const [entries, setEntries] = createSignal<NavListEntry[]>([]);
const [emptyState, setEmptyState] = createSignal<NavEmptyState>({
  showPageSettings: false,
});
let handlers: NavListHandlers | null = null;

function runIconRefresh() {
  setTimeout(() => {
    if (typeof window.refreshIcons === "function") {
      window.refreshIcons();
    }
  }, 0);
}

export function NavListPanel() {
  createEffect(() => {
    entries();
    runIconRefresh();
  });

  return (
    <Show
      when={entries().length > 0}
      fallback={
        <li class="nav-empty-state">
          <strong>No visible nav items</strong>
          <span>
            Mark a page as visible in Page Settings or stage a navigation set
            from the Site Shell.
          </span>
          <div class="nav-empty-actions">
            <Show when={emptyState().showPageSettings}>
              <button
                class="mini-btn"
                onClick={() => handlers?.onPageSettings()}
              >
                Page Settings
              </button>
            </Show>
            <button
              class="mini-btn"
              onClick={() => handlers?.onReviewNavigation()}
            >
              Review Navigation
            </button>
          </div>
        </li>
      }
    >
      <For each={entries()}>
        {(entry) => (
          <li>
            <button
              type="button"
              class="nav-entry"
              disabled={!entry.page}
              title={
                entry.page
                  ? `Open ${entry.label}`
                  : "Custom link — not an editable page"
              }
              aria-label={`Open ${entry.label} (${entry.href})`}
              onClick={() => {
                if (entry.page) handlers?.onOpenPage(entry.page);
              }}
            >
              <i data-lucide="link"></i>{" "}
              <span class="nav-entry-label">
                {entry.label} <span class="nav-route">{entry.href}</span>
              </span>
            </button>
          </li>
        )}
      </For>
    </Show>
  );
}

export function updateNavList(
  list: NavListEntry[],
  nextEmptyState: NavEmptyState,
): void {
  setEntries(list);
  setEmptyState(nextEmptyState);
}

export function registerNavListHandlers(nextHandlers: NavListHandlers): void {
  handlers = nextHandlers;
}

export function mountNavList(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <NavListPanel />, container);
}
