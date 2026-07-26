import { For } from "solid-js";
import { render } from "solid-js/web";

export interface SettingsModalAction {
  id: "check" | "download" | "restart" | "cancel";
  label: string;
  tone: "secondary" | "primary" | "ghost";
}

export interface SettingsModalState {
  settings: GlobalSettings;
  updaterStatusText: string;
  updaterActions: SettingsModalAction[];
  nodeStatusText: string;
  nodeAutoDisabled: boolean;
  nodeBrowseBusy: boolean;
  nodeAutoBusy: boolean;
  versionText: string;
  onSettingChange: <K extends keyof GlobalSettings>(
    key: K,
    value: GlobalSettings[K],
  ) => void;
  onUpdaterAction: (actionId: SettingsModalAction["id"]) => void | Promise<void>;
  onPickNodePath: () => void | Promise<void>;
  onAutoNodePath: () => void | Promise<void>;
  onOpenProductionLicenses: () => void;
  onOpenConfigFolder: () => void;
}

function buttonClass(tone: SettingsModalAction["tone"]): string {
  return tone === "primary"
    ? "btn primary mini-btn"
    : tone === "ghost"
      ? "btn ghost mini-btn"
      : "btn secondary mini-btn";
}

export function renderSettingsModalBody(
  container: HTMLElement,
  state: SettingsModalState,
): void {
  container.innerHTML = "";
  render(
    () => (
      <div class="settings-form">
        <div class="settings-section">
          <h4 class="settings-section-title">Updates</h4>

          <div class="settings-row">
            <label for="set-auto-update-modal">Startup check</label>
            <input
              id="set-auto-update-modal"
              type="checkbox"
              checked={state.settings.autoCheckUpdates}
              onChange={(event) =>
                state.onSettingChange(
                  "autoCheckUpdates",
                  event.currentTarget.checked,
                )
              }
            />
          </div>

          <div class="field">
            <label for="set-update-channel-modal">Update channel</label>
            <select
              id="set-update-channel-modal"
              class="select"
              value={state.settings.updateChannel}
              onChange={(event) =>
                state.onSettingChange(
                  "updateChannel",
                  event.currentTarget.value as GlobalSettings["updateChannel"],
                )
              }
            >
              <option value="auto">Auto (match install)</option>
              <option value="stable">Stable</option>
              <option value="beta">Beta</option>
              <option value="developer">Developer (db)</option>
            </select>
          </div>

          <div class="settings-row">
            <span>{state.updaterStatusText}</span>
            <div class="settings-inline-actions">
              <For each={state.updaterActions}>
                {(action) => (
                  <button
                    class={buttonClass(action.tone)}
                    onClick={() => void state.onUpdaterAction(action.id)}
                  >
                    {action.label}
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h4 class="settings-section-title">Environment</h4>

          <div class="settings-row">
            <div class="settings-inline-copy">
              <strong>Node.js (for build & preview)</strong>
              <span>{state.nodeStatusText}</span>
            </div>
            <div class="settings-inline-actions">
              <button
                class="btn secondary mini-btn"
                disabled={state.nodeBrowseBusy}
                onClick={() => void state.onPickNodePath()}
              >
                Set Custom Location…
              </button>
              <button
                class="btn ghost mini-btn"
                disabled={state.nodeAutoDisabled || state.nodeAutoBusy}
                onClick={() => void state.onAutoNodePath()}
              >
                Use Auto-detect
              </button>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h4 class="settings-section-title">Appearance</h4>

          <div class="field">
            <label for="set-theme-modal">Theme</label>
            <select
              id="set-theme-modal"
              class="select"
              value={state.settings.theme}
              onChange={(event) =>
                state.onSettingChange(
                  "theme",
                  event.currentTarget.value as GlobalSettings["theme"],
                )
              }
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>

          <div class="field">
            <label for="set-font-size-modal">Editor font size</label>
            <select
              id="set-font-size-modal"
              class="select"
              value={String(state.settings.codeFontSize)}
              onChange={(event) =>
                state.onSettingChange(
                  "codeFontSize",
                  Number(event.currentTarget.value),
                )
              }
            >
              <For each={[12, 13, 14, 15, 16, 18]}>
                {(size) => <option value={String(size)}>{size}px</option>}
              </For>
            </select>
          </div>
        </div>

        <div class="settings-section">
          <h4 class="settings-section-title">Editor</h4>

          <div class="settings-row">
            <label for="set-restore-modal">Reopen last project</label>
            <input
              id="set-restore-modal"
              type="checkbox"
              checked={state.settings.restoreLastProject}
              onChange={(event) =>
                state.onSettingChange(
                  "restoreLastProject",
                  event.currentTarget.checked,
                )
              }
            />
          </div>

          <div class="settings-row">
            <label for="set-autosave-modal">Autosave changes</label>
            <input
              id="set-autosave-modal"
              type="checkbox"
              checked={state.settings.autosave}
              onChange={(event) =>
                state.onSettingChange("autosave", event.currentTarget.checked)
              }
            />
          </div>
          <p class="settings-hint muted">
            Autosave writes the project when you leave a page. Unsaved crash
            recovery drafts are still kept locally either way.
          </p>

          <div class="settings-row">
            <label for="set-confirm-del-modal">Confirm delete block</label>
            <input
              id="set-confirm-del-modal"
              type="checkbox"
              checked={state.settings.confirmBlockDelete}
              onChange={(event) =>
                state.onSettingChange(
                  "confirmBlockDelete",
                  event.currentTarget.checked,
                )
              }
            />
          </div>
        </div>

        <div class="settings-section">
          <h4 class="settings-section-title">Legal</h4>

          <div class="settings-row">
            <div class="settings-inline-copy">
              <strong>Third-party licenses</strong>
              <span>
                Show production dependency licenses from bundled licenses.json.
              </span>
            </div>
            <button
              class="btn ghost mini-btn"
              onClick={state.onOpenProductionLicenses}
            >
              View Production Licenses
            </button>
          </div>
        </div>

        <div class="settings-footer">
          <span class="version-info-text">{state.versionText}</span>
          <button
            class="btn ghost mini-btn"
            onClick={state.onOpenConfigFolder}
          >
            Open Config
          </button>
        </div>
      </div>
    ),
    container,
  );
}
