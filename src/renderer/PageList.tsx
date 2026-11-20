import { For, Show, createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { render } from "solid-js/web";
import {
  onPageKeyDown as movePageFocus,
  pageStop,
  pageTabStop,
  type PageAction,
} from "./pageKeyboard";

export interface PageListEntry {
  page: string;
  route: string;
  navLabel: string;
  navVisible: boolean;
  /** True when the page is detached from visual editing (code only). */
  detached?: boolean;
  active?: boolean;
  loading?: boolean;
  interactionDisabled?: boolean;
}

export interface PageListActionHandlers {
  onOpen: (page: string) => void;
  onManage: (page: string) => void;
  onToggleNav: (page: string) => void;
}

const [entries, setEntries] = createStore<PageListEntry[]>([]);
const [tabStop, setTabStop] = createSignal<{
  page: string;
  kind: PageAction;
} | null>(null);
let handlers: PageListActionHandlers | null = null;

function runIconRefresh(): void {
  setTimeout(() => {
    window.refreshIcons?.();
  }, 0);
}

export function PageListPanel() {
  const stop = () => {
    const active = tabStop();
    return pageStop(entries, active?.page ?? null, active?.kind ?? null);
  };
  const onPageKeyDown = (event: KeyboardEvent) => {
    movePageFocus(event);
    const current = event.currentTarget;
    if (!(current instanceof HTMLElement)) return;
    const active = current.ownerDocument.activeElement;
    if (!(active instanceof HTMLButtonElement)) return;
    const page =
      active.closest("li.page-item")?.getAttribute("data-page") ?? "";
    const kind = active.dataset["pageAction"];
    if (kind !== "main" && kind !== "nav" && kind !== "manage") return;
    if (!page) return;
    setTabStop({ page, kind });
  };
  const tabIndexFor = (page: string, kind: PageAction) =>
    pageTabStop(page, kind, stop()?.page ?? null, stop()?.kind ?? null);
  return (
    <Show
      when={entries.length > 0}
      fallback={<li class="muted">No pages found.</li>}
    >
      <For each={entries}>
        {(entry) => (
          <li
            classList={{
              "page-item": true,
              "hidden-page": !entry.navVisible,
              active: !!entry.active,
              loading: !!entry.loading,
            }}
            data-page={entry.page}
            aria-busy={entry.loading ? "true" : undefined}
          >
            <button
              type="button"
              class="page-main"
              aria-current={entry.active ? "page" : undefined}
              data-page-action="main"
              tabIndex={tabIndexFor(entry.page, "main")}
              disabled={entry.loading}
              onClick={() => {
                setTabStop({ page: entry.page, kind: "main" });
                handlers?.onOpen(entry.page);
              }}
              onKeyDown={onPageKeyDown}
            >
              <span
                class="page-file-icon"
                aria-hidden="true"
                hidden={!!entry.loading}
                title={
                  entry.detached ? "Detached page — code mode only" : undefined
                }
              >
                <i
                  data-lucide={entry.detached ? "file-pen-line" : "file-code"}
                ></i>
              </span>
              <span
                class="page-loading-icon"
                aria-hidden="true"
                hidden={!entry.loading}
              >
                <i data-lucide="loader-circle"></i>
              </span>
              <span>
                <strong>{entry.navLabel}</strong>
                <small>{entry.loading ? "Loading…" : entry.route}</small>
              </span>
            </button>
            <button
              type="button"
              class="mini-btn page-nav-toggle"
              title={
                entry.navVisible
                  ? `Hide ${entry.navLabel} from navigation`
                  : `Show ${entry.navLabel} in navigation`
              }
              aria-label={`Toggle ${entry.navLabel} in navigation`}
              aria-pressed={entry.navVisible ? "true" : "false"}
              data-page-action="nav"
              tabIndex={tabIndexFor(entry.page, "nav")}
              disabled={entry.loading || entry.interactionDisabled}
              onClick={(event) => {
                event.stopPropagation();
                setTabStop({ page: entry.page, kind: "nav" });
                handlers?.onToggleNav(entry.page);
              }}
              onKeyDown={onPageKeyDown}
            >
              <i data-lucide={entry.navVisible ? "eye" : "eye-off"}></i>
            </button>
            <button
              type="button"
              class="mini-btn page-manage-button"
              title={`Manage ${entry.navLabel}`}
              aria-label={`Manage ${entry.navLabel} page`}
              data-page-action="manage"
              tabIndex={tabIndexFor(entry.page, "manage")}
              disabled={entry.loading || entry.interactionDisabled}
              onClick={(event) => {
                event.stopPropagation();
                setTabStop({ page: entry.page, kind: "manage" });
                handlers?.onManage(entry.page);
              }}
              onKeyDown={onPageKeyDown}
            >
              <i data-lucide="ellipsis"></i>
            </button>
          </li>
        )}
      </For>
    </Show>
  );
}

export function updatePageList(list: PageListEntry[]): void {
  setEntries(reconcile(list, { key: "page" }));
  runIconRefresh();
}

export function registerPageListHandlers(
  nextHandlers: PageListActionHandlers,
): void {
  handlers = nextHandlers;
}

export function mountPageList(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <PageListPanel />, container);
  runIconRefresh();
}
