import { For } from "solid-js";
import { render } from "solid-js/web";

export interface NewPageModalState {
  value: string;
  onValueChange: (value: string) => void;
}

export interface PageSettingsModalState {
  title: string;
  slug: string;
  slugDisabled: boolean;
  navLabel: string;
  metaDescription: string;
  navVisible: boolean;
  onTitleChange: (value: string) => void;
  onSlugChange: (value: string) => void;
  onNavLabelChange: (value: string) => void;
  onMetaDescriptionChange: (value: string) => void;
  onNavVisibleChange: (value: boolean) => void;
}

export interface NavigationPreviewRowState {
  id: string;
  href: string;
  label: string;
  visible: boolean;
  onLabelChange: (value: string) => void;
  onVisibleChange: (value: boolean) => void;
}

export function renderNewPageModal(
  container: HTMLElement,
  state: NewPageModalState,
): void {
  container.innerHTML = "";
  render(
    () => (
      <div class="meta-form">
        <p class="muted">
          New pages inherit the project theme layout. Nested routes like
          `docs/getting-started` are supported.
        </p>
        <input
          class="text"
          placeholder="docs/getting-started"
          value={state.value}
          onInput={(event) => state.onValueChange(event.currentTarget.value)}
        />
      </div>
    ),
    container,
  );
}

export function renderPageSettingsModal(
  container: HTMLElement,
  state: PageSettingsModalState,
): void {
  container.innerHTML = "";
  render(
    () => (
      <div class="meta-form">
        <label class="meta-field">
          <span>Page title</span>
          <input
            class="text"
            value={state.title}
            onInput={(event) => state.onTitleChange(event.currentTarget.value)}
          />
        </label>
        <label class="meta-field">
          <span>Slug</span>
          <input
            class="text"
            value={state.slug}
            disabled={state.slugDisabled}
            onInput={(event) => state.onSlugChange(event.currentTarget.value)}
          />
        </label>
        <label class="meta-field">
          <span>Nav label</span>
          <input
            class="text"
            value={state.navLabel}
            onInput={(event) =>
              state.onNavLabelChange(event.currentTarget.value)
            }
          />
        </label>
        <label class="meta-field">
          <span>Meta description</span>
          <textarea
            rows={3}
            onInput={(event) =>
              state.onMetaDescriptionChange(event.currentTarget.value)
            }
          >
            {state.metaDescription}
          </textarea>
        </label>
        <label class="meta-field">
          <span>Show in nav</span>
          <input
            type="checkbox"
            checked={state.navVisible}
            onChange={(event) =>
              state.onNavVisibleChange(event.currentTarget.checked)
            }
          />
        </label>
      </div>
    ),
    container,
  );
}

export function renderNavigationPreviewModal(
  container: HTMLElement,
  rows: NavigationPreviewRowState[],
): void {
  container.innerHTML = "";
  render(
    () => (
      <div class="meta-form">
        <p class="muted">
          Preview and adjust the Zephus-managed navigation before saving the
          site shell.
        </p>
        <For each={rows}>
          {(row) => (
            <div class="meta-grid" data-nav-id={row.id}>
              <input
                type="checkbox"
                checked={row.visible}
                onChange={(event) =>
                  row.onVisibleChange(event.currentTarget.checked)
                }
              />
              <input
                class="text"
                value={row.label}
                onInput={(event) =>
                  row.onLabelChange(event.currentTarget.value)
                }
              />
              <span class="muted">{row.href}</span>
            </div>
          )}
        </For>
      </div>
    ),
    container,
  );
}
