import { For, createSignal } from "solid-js";
import { render } from "solid-js/web";

export interface SettingsUpdaterAction {
  id: "check" | "download" | "restart" | "cancel";
  label: string;
  tone: "secondary" | "primary" | "ghost";
}

export interface SettingsTabHandlers {
  onReset: (settings: GlobalSettings) => void | Promise<void>;
  onSave: (settings: GlobalSettings) => void | Promise<void>;
  onPickNodePath: (settings: GlobalSettings) => void | Promise<void>;
  onAutoNodePath: (settings: GlobalSettings) => void | Promise<void>;
  onUpdaterAction: (
    actionId: SettingsUpdaterAction["id"],
  ) => void | Promise<void>;
}

const [draft, setDraft] = createSignal<GlobalSettings | null>(null);
const [updaterStatusText, setUpdaterStatusText] = createSignal(
  "Check the selected update channel.",
);
const [updaterActions, setUpdaterActions] = createSignal<
  SettingsUpdaterAction[]
>([]);
const [nodeStatusText, setNodeStatusText] = createSignal("Checking Node.js…");
const [nodeAutoDisabled, setNodeAutoDisabled] = createSignal(true);
const [nodeBrowseBusy, setNodeBrowseBusy] = createSignal(false);
const [nodeAutoBusy, setNodeAutoBusy] = createSignal(false);

let handlers: SettingsTabHandlers | null = null;

function updateDraft<K extends keyof GlobalSettings>(
  key: K,
  value: GlobalSettings[K],
): void {
  const current = draft();
  if (!current) return;
  setDraft({ ...current, [key]: value });
}

function buttonClass(tone: SettingsUpdaterAction["tone"]): string {
  return tone === "primary"
    ? "btn primary mini-btn"
    : tone === "ghost"
      ? "btn ghost mini-btn"
      : "btn secondary mini-btn";
}

export function SettingsTabPanel() {
  const current = () => draft();

  return (
    <div class="settings-form">
      <div class="settings-section">
        <h4 class="settings-section-title">Updates</h4>

        <div class="settings-row">
          <label for="set-auto-update">Startup check</label>
          <input
            id="set-auto-update"
            type="checkbox"
            checked={current()?.autoCheckUpdates ?? false}
            onChange={(event) =>
              updateDraft("autoCheckUpdates", event.currentTarget.checked)
            }
          />
        </div>

        <div class="field">
          <label for="set-update-channel">Update channel</label>
          <select
            id="set-update-channel"
            class="select"
            value={current()?.updateChannel ?? "auto"}
            onChange={(event) =>
              updateDraft(
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
          <span>{updaterStatusText()}</span>
          <div class="settings-inline-actions">
            <For each={updaterActions()}>
              {(action) => (
                <button
                  class={buttonClass(action.tone)}
                  onClick={() => void handlers?.onUpdaterAction(action.id)}
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
            <span>{nodeStatusText()}</span>
          </div>
          <div class="settings-inline-actions">
            <button
              class="btn secondary mini-btn"
              disabled={nodeBrowseBusy()}
              onClick={async () => {
                const currentSettings = current();
                if (!currentSettings) return;
                setNodeBrowseBusy(true);
                try {
                  await handlers?.onPickNodePath(currentSettings);
                } finally {
                  setNodeBrowseBusy(false);
                }
              }}
            >
              Set Custom Location…
            </button>
            <button
              class="btn ghost mini-btn"
              disabled={nodeAutoDisabled() || nodeAutoBusy()}
              onClick={async () => {
                const currentSettings = current();
                if (!currentSettings) return;
                setNodeAutoBusy(true);
                try {
                  await handlers?.onAutoNodePath(currentSettings);
                } finally {
                  setNodeAutoBusy(false);
                }
              }}
            >
              Use Auto-detect
            </button>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h4 class="settings-section-title">Appearance</h4>

        <div class="field">
          <label for="set-theme">Theme</label>
          <select
            id="set-theme"
            class="select"
            value={current()?.theme ?? "system"}
            onChange={(event) =>
              updateDraft(
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
          <label for="set-font-size">Editor font size</label>
          <select
            id="set-font-size"
            class="select"
            value={String(current()?.codeFontSize ?? 13)}
            onChange={(event) =>
              updateDraft("codeFontSize", Number(event.currentTarget.value))
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
          <label for="set-restore">Reopen last project</label>
          <input
            id="set-restore"
            type="checkbox"
            checked={current()?.restoreLastProject ?? false}
            onChange={(event) =>
              updateDraft("restoreLastProject", event.currentTarget.checked)
            }
          />
        </div>

        <div class="settings-row">
          <label for="set-autosave">Autosave changes</label>
          <input
            id="set-autosave"
            type="checkbox"
            checked={current()?.autosave ?? false}
            onChange={(event) =>
              updateDraft("autosave", event.currentTarget.checked)
            }
          />
        </div>

        <div class="settings-row">
          <label for="set-confirm-del">Confirm delete block</label>
          <input
            id="set-confirm-del"
            type="checkbox"
            checked={current()?.confirmBlockDelete ?? false}
            onChange={(event) =>
              updateDraft("confirmBlockDelete", event.currentTarget.checked)
            }
          />
        </div>
      </div>

      <div class="settings-panel-buttons">
        <button
          class="btn danger"
          onClick={() => {
            const currentSettings = current();
            if (currentSettings) void handlers?.onReset(currentSettings);
          }}
        >
          Reset to Defaults
        </button>
        <button
          class="btn primary"
          onClick={() => {
            const currentSettings = current();
            if (currentSettings) void handlers?.onSave(currentSettings);
          }}
        >
          Save Settings
        </button>
      </div>
    </div>
  );
}

export function initializeSettingsTab(nextSettings: GlobalSettings): void {
  setDraft({ ...nextSettings });
}

export function updateSettingsTabSettings(nextSettings: GlobalSettings): void {
  setDraft({ ...nextSettings });
}

export function updateSettingsTabUpdater(
  statusText: string,
  actions: SettingsUpdaterAction[],
): void {
  setUpdaterStatusText(statusText);
  setUpdaterActions(actions);
}

export function updateSettingsTabNode(
  statusText: string,
  autoDisabled: boolean,
): void {
  setNodeStatusText(statusText);
  setNodeAutoDisabled(autoDisabled);
}

export function registerSettingsTabHandlers(
  nextHandlers: SettingsTabHandlers,
): void {
  handlers = nextHandlers;
}

export function mountSettingsTab(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <SettingsTabPanel />, container);
}
