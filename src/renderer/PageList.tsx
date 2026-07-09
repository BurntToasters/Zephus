import { render } from "solid-js/web";
import { For, Show, createEffect, createSignal } from "solid-js";

export interface PageListEntry {
  page: string;
  route: string;
  navLabel: string;
  navVisible: boolean;
  active?: boolean;
}

export interface PageListActionHandlers {
  onOpen: (page: string) => void;
  onManage: (page: string) => void;
}

const [entries, setEntries] = createSignal<PageListEntry[]>([]);
let handlers: PageListActionHandlers | null = null;

function runIconRefresh() {
  setTimeout(() => {
    if (typeof window.refreshIcons === "function") {
      window.refreshIcons();
    }
  }, 0);
}

export function PageListPanel() {
  createEffect(() => {
    entries();
    runIconRefresh();
  });

  return (
    <Show
      when={entries().length > 0}
      fallback={<li class="muted">No pages found.</li>}
    >
      <For each={entries()}>
        {(entry) => (
          <li
            classList={{
              "page-item": true,
              "hidden-page": !entry.navVisible,
              active: !!entry.active,
            }}
            data-page={entry.page}
          >
            <button
              class="page-main"
              onClick={() => handlers?.onOpen(entry.page)}
            >
              <i data-lucide="file-code"></i>
              <span>
                <strong>{entry.navLabel}</strong>
                <small>{entry.route}</small>
              </span>
            </button>
            <button
              class="mini-btn"
              onClick={(event) => {
                event.stopPropagation();
                handlers?.onManage(entry.page);
              }}
            >
              Manage
            </button>
          </li>
        )}
      </For>
    </Show>
  );
}

export function updatePageList(list: PageListEntry[]): void {
  setEntries(list);
}

export function registerPageListHandlers(
  nextHandlers: PageListActionHandlers,
): void {
  handlers = nextHandlers;
}

export function mountPageList(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <PageListPanel />, container);
}
