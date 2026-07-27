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
  socialImage: string;
  canonicalUrl: string;
  noindex: boolean;
  publishDate: string;
  author: string;
  /** Absolute site URL, shown so the user can see the derived canonical URL. */
  siteUrl: string;
  route: string;
  onTitleChange: (value: string) => void;
  onSlugChange: (value: string) => void;
  onNavLabelChange: (value: string) => void;
  onMetaDescriptionChange: (value: string) => void;
  onNavVisibleChange: (value: boolean) => void;
  onSocialImageChange: (value: string) => void;
  onCanonicalUrlChange: (value: string) => void;
  onNoindexChange: (value: boolean) => void;
  onPickSocialImage: () => void;
  onPublishDateChange: (value: string) => void;
  onAuthorChange: (value: string) => void;
}

const DESCRIPTION_MAX = 160;

/** Describes what the page's canonical URL will be when this field is empty. */
function describeCanonicalDefault(state: PageSettingsModalState): string {
  if (!state.siteUrl.trim()) {
    return "Set a site URL in Site Shell to publish canonical and social tags.";
  }
  const derived = `${state.siteUrl.trim().replace(/\/+$/, "")}${state.route}`;
  return `Defaults to ${derived}`;
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
  const reservedNotFound = state.slug === "404";
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
            value={state.metaDescription}
            onInput={(event) =>
              state.onMetaDescriptionChange(event.currentTarget.value)
            }
          />
          <small class="meta-hint">
            Used by search engines and link previews. Around {DESCRIPTION_MAX}{" "}
            characters shows without being cut off.
          </small>
        </label>
        <label class="meta-field">
          <span>Show in nav</span>
          <input
            type="checkbox"
            checked={state.navVisible}
            disabled={reservedNotFound}
            onChange={(event) =>
              state.onNavVisibleChange(event.currentTarget.checked)
            }
          />
          {reservedNotFound ? (
            <small class="meta-hint">
              The 404 page is always hidden from site navigation.
            </small>
          ) : null}
        </label>

        <h4 class="meta-group-title">Blog post details</h4>
        <label class="meta-field">
          <span>Publish date</span>
          <input
            class="text"
            type="date"
            value={state.publishDate}
            onInput={(event) =>
              state.onPublishDateChange(event.currentTarget.value)
            }
          />
          <small class="meta-hint">
            Set this to treat the page as a blog post: Post List blocks and the
            RSS feed use it for ordering. Leave empty for ordinary pages.
          </small>
        </label>
        <label class="meta-field">
          <span>Author</span>
          <input
            class="text"
            placeholder="Name shown on the post"
            value={state.author}
            onInput={(event) => state.onAuthorChange(event.currentTarget.value)}
          />
        </label>

        <h4 class="meta-group-title">Search &amp; sharing</h4>
        <label class="meta-field">
          <span>Social share image</span>
          <div class="link-field">
            <input
              class="text"
              placeholder="/assets/images/share.png"
              value={state.socialImage}
              onInput={(event) =>
                state.onSocialImageChange(event.currentTarget.value)
              }
            />
            <button
              type="button"
              class="btn ghost mini-btn"
              onClick={state.onPickSocialImage}
            >
              Choose…
            </button>
          </div>
          <small class="meta-hint">
            Shown when the page is shared on social platforms and chat apps.
          </small>
        </label>
        <label class="meta-field">
          <span>Canonical URL</span>
          <input
            class="text"
            placeholder="Leave empty to use the page's own URL"
            value={state.canonicalUrl}
            onInput={(event) =>
              state.onCanonicalUrlChange(event.currentTarget.value)
            }
          />
          <small class="meta-hint">{describeCanonicalDefault(state)}</small>
        </label>
        <label class="meta-field">
          <span>Hide from search engines</span>
          <input
            type="checkbox"
            checked={state.noindex}
            disabled={reservedNotFound}
            onChange={(event) =>
              state.onNoindexChange(event.currentTarget.checked)
            }
          />
          <small class="meta-hint">
            {reservedNotFound
              ? "The 404 page is always hidden from search engines and sitemap.xml."
              : "Adds a noindex tag and leaves the page out of sitemap.xml. The page stays reachable by direct link."}
          </small>
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
