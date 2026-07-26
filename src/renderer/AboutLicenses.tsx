import { For, Show, createSignal } from "solid-js";
import { render } from "solid-js/web";

export interface AboutLicenseEntry {
  packageId: string;
  licenses: string;
  repository: string | null;
  licenseUrl: string | null;
  parentsLabel: string;
}

export interface AboutLicensesState {
  visible: boolean;
  loading: boolean;
  error: string | null;
  entries: AboutLicenseEntry[];
}

const [state, setState] = createSignal<AboutLicensesState>({
  visible: false,
  loading: false,
  error: null,
  entries: [],
});

export function AboutLicensesPanel() {
  const current = () => state();

  return (
    <Show when={current().visible}>
      <Show
        when={!current().loading}
        fallback={
          <p class="muted" style={{ padding: "16px" }}>
            Loading bundled production license data…
          </p>
        }
      >
        <Show
          when={!current().error}
          fallback={
            <p
              class="muted"
              style={{ padding: "16px", color: "var(--danger)" }}
            >
              {current().error}
            </p>
          }
        >
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
                <For each={current().entries}>
                  {(entry) => (
                    <tr>
                      <td class="licenses-package-cell">
                        <div class="licenses-package-name">
                          {entry.packageId}
                        </div>
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
        </Show>
      </Show>
    </Show>
  );
}

export function updateAboutLicenses(nextState: AboutLicensesState): void {
  setState(nextState);
}

export function mountAboutLicenses(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <AboutLicensesPanel />, container);
}
