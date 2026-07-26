import { render } from "solid-js/web";
import { For, Show, createSignal } from "solid-js";

export interface HomeDraftEntry {
  projectPath: string;
  title: string;
  body: string;
}

export interface HomeDraftRecoveryHandlers {
  onResumeDraft: (projectPath: string) => void;
}

const [entries, setEntries] = createSignal<HomeDraftEntry[]>([]);
let handlers: HomeDraftRecoveryHandlers | null = null;

export function HomeDraftRecoveryPanel() {
  return (
    <Show when={entries().length > 0}>
      <div class="pane-header-title" style={{ "margin-bottom": "12px" }}>
        <p class="pane-kicker" style={{ color: "var(--warning)" }}>
          Unsaved Work Recovery
        </p>
        <strong style={{ "font-size": "14px" }}>
          Zephus detected unsaved page or site drafts.
        </strong>
      </div>

      <div class="home-status-stack">
        <For each={entries()}>
          {(entry) => (
            <section class="home-status-card">
              <strong>{entry.title}</strong>
              <p>{entry.body}</p>
              <div class="home-status-actions">
                <button
                  class="mini-btn"
                  onClick={() => handlers?.onResumeDraft(entry.projectPath)}
                >
                  Resume Draft
                </button>
              </div>
            </section>
          )}
        </For>
      </div>
    </Show>
  );
}

export function updateHomeDraftRecovery(nextEntries: HomeDraftEntry[]): void {
  setEntries(nextEntries);
}

export function registerHomeDraftRecoveryHandlers(
  nextHandlers: HomeDraftRecoveryHandlers,
): void {
  handlers = nextHandlers;
}

export function mountHomeDraftRecovery(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <HomeDraftRecoveryPanel />, container);
}
