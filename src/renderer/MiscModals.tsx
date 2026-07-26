import { For } from "solid-js";
import { render } from "solid-js/web";

export interface ProductionLicenseModalEntry {
  packageId: string;
  licenses: string;
  repository: string | null;
  licenseUrl: string | null;
  parentsLabel: string;
}

export interface SiteShellModalState {
  siteTitle: string;
  logoText: string;
  announcementText: string;
  announcementVisible: boolean;
  ctaLabel: string;
  ctaHref: string;
  footerHtml: string;
  customHeadHtml: string;
  onSiteTitleChange: (value: string) => void;
  onLogoTextChange: (value: string) => void;
  onAnnouncementTextChange: (value: string) => void;
  onAnnouncementVisibleChange: (value: boolean) => void;
  onCtaLabelChange: (value: string) => void;
  onCtaHrefChange: (value: string) => void;
  onPickCtaHref: () => void;
  onFooterHtmlChange: (value: string) => void;
  onCustomHeadHtmlChange: (value: string) => void;
}

export interface PublishSuccessModalState {
  outputDir: string;
}

export interface ThemePreviewModalState {
  description: string;
  previewUrl: string;
  themeName: string;
}

export function renderProductionLicensesModalBody(
  container: HTMLElement,
  entryCount: number,
  entries: ProductionLicenseModalEntry[],
): void {
  container.innerHTML = "";
  render(
    () => (
      <div class="licenses-modal">
        <p class="licenses-summary">
          Generated from license-checker-rseidelsohn --production. {entryCount}{" "}
          packages listed.
        </p>

        <div class="licenses-table-wrap">
          <table class="licenses-table">
            <thead>
              <tr>
                <th>Package</th>
                <th>License</th>
                <th>Repository</th>
                <th>License URL</th>
              </tr>
            </thead>
            <tbody>
              <For each={entries}>
                {(entry) => (
                  <tr>
                    <td class="licenses-package-cell">
                      <div class="licenses-package-name">{entry.packageId}</div>
                      <div class="licenses-package-parents">
                        {entry.parentsLabel}
                      </div>
                    </td>
                    <td>{entry.licenses}</td>
                    <td class="licenses-link-cell">
                      {entry.repository ?? "—"}
                    </td>
                    <td class="licenses-link-cell">
                      {entry.licenseUrl ?? "—"}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </div>
    ),
    container,
  );
}

export function renderUnsavedWorkSummaryModalBody(
  container: HTMLElement,
  items: string[],
): void {
  container.innerHTML = "";
  render(
    () => (
      <div class="save-summary">
        <p>You have unsaved changes in Zephus.</p>
        <ul class="change-list">
          <For each={items}>{(item) => <li>{item}</li>}</For>
        </ul>
      </div>
    ),
    container,
  );
}

export function renderSiteShellModalBody(
  container: HTMLElement,
  state: SiteShellModalState,
): void {
  container.innerHTML = "";
  render(
    () => (
      <div class="meta-form">
        <p class="muted">
          Saving here switches the project shell into Zephus-managed layout mode
          so the header, announcement bar, and footer stay GUI-editable.
        </p>

        <label class="meta-field">
          <span>Site title</span>
          <input
            class="text"
            value={state.siteTitle}
            onInput={(event) =>
              state.onSiteTitleChange(event.currentTarget.value)
            }
          />
        </label>
        <label class="meta-field">
          <span>Logo text</span>
          <input
            class="text"
            value={state.logoText}
            onInput={(event) =>
              state.onLogoTextChange(event.currentTarget.value)
            }
          />
        </label>
        <label class="meta-field">
          <span>Announcement text</span>
          <textarea
            rows={3}
            value={state.announcementText}
            onInput={(event) =>
              state.onAnnouncementTextChange(event.currentTarget.value)
            }
          />
        </label>
        <label class="meta-field">
          <span>Show announcement</span>
          <input
            type="checkbox"
            checked={state.announcementVisible}
            onChange={(event) =>
              state.onAnnouncementVisibleChange(event.currentTarget.checked)
            }
          />
        </label>
        <label class="meta-field">
          <span>CTA label</span>
          <input
            class="text"
            value={state.ctaLabel}
            onInput={(event) =>
              state.onCtaLabelChange(event.currentTarget.value)
            }
          />
        </label>
        <label class="meta-field">
          <span>CTA link</span>
          <div class="link-field">
            <input
              class="text"
              value={state.ctaHref}
              onInput={(event) =>
                state.onCtaHrefChange(event.currentTarget.value)
              }
            />
            <button
              type="button"
              class="btn ghost mini-btn"
              onClick={state.onPickCtaHref}
            >
              Choose…
            </button>
          </div>
        </label>
        <label class="meta-field">
          <span>Footer HTML</span>
          <textarea
            rows={4}
            value={state.footerHtml}
            onInput={(event) =>
              state.onFooterHtmlChange(event.currentTarget.value)
            }
          />
        </label>
        <label class="meta-field">
          <span>Custom head HTML</span>
          <textarea
            rows={4}
            value={state.customHeadHtml}
            onInput={(event) =>
              state.onCustomHeadHtmlChange(event.currentTarget.value)
            }
          />
        </label>
      </div>
    ),
    container,
  );
}

export function renderPublishSuccessModalBody(
  container: HTMLElement,
  state: PublishSuccessModalState,
): void {
  container.innerHTML = "";
  render(
    () => (
      <div class="publish-done">
        <p>
          Your site was built into the <strong>{state.outputDir}</strong> folder
          (now open in your file manager).
        </p>
        <p>To put it online, upload that folder to a free static host:</p>
        <ul class="publish-hosts">
          <li>
            <a href="https://app.netlify.com/drop">Netlify Drop</a> - drag the
            folder onto the page, done.
          </li>
          <li>
            <a href="https://pages.cloudflare.com">Cloudflare Pages</a> -
            connect or upload.
          </li>
          <li>
            <a href="https://pages.github.com">GitHub Pages</a> - if your
            project is on GitHub.
          </li>
        </ul>
        <p class="muted">
          Tip: Netlify Drop is the easiest - no account needed to start.
        </p>
      </div>
    ),
    container,
  );
}

export function renderThemePreviewModalBody(
  container: HTMLElement,
  state: ThemePreviewModalState,
): void {
  container.innerHTML = "";
  render(
    () => (
      <div class="theme-preview-modal">
        <div class="theme-preview-meta">
          <p class="theme-preview-kicker">Read-only preview</p>
          <p class="theme-preview-description">{state.description}</p>
        </div>

        <div class="theme-preview-modal-frame">
          <iframe
            class="theme-preview-modal-iframe"
            src={state.previewUrl}
            sandbox="allow-same-origin allow-scripts"
            title={`${state.themeName} preview`}
          />
        </div>
      </div>
    ),
    container,
  );
}
