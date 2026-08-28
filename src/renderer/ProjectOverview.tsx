import { render } from "solid-js/web";
import { For, Show, createSignal } from "solid-js";

export interface ProjectOverviewAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface ProjectOverviewPill {
  label: string;
  tone: "good" | "warn" | "info";
}

export interface ProjectOverviewData {
  hasProject: boolean;
  pageTitle?: string;
  route?: string;
  navState?: string;
  canvasState?: string;
  pills?: ProjectOverviewPill[];
  hint?: string;
  actions?: ProjectOverviewAction[];
}

const [overview, setOverview] = createSignal<ProjectOverviewData>({
  hasProject: false,
});

export function ProjectOverviewPanel() {
  return (
    <Show
      when={overview().hasProject}
      fallback={
        <p class="muted">Open a Zephus site to see page and project status.</p>
      }
    >
      <div class="overview-grid">
        <section class="overview-card">
          <div class="overview-title">
            <strong>{overview().pageTitle}</strong>
            <span class="overview-pill info">{overview().route}</span>
          </div>
          <div class="overview-meta">
            <div class="overview-row">
              <span>Route</span>
              <span>{overview().route}</span>
            </div>
            <div class="overview-row">
              <span>Navigation</span>
              <span>{overview().navState}</span>
            </div>
            <div class="overview-row">
              <span>Canvas</span>
              <span>{overview().canvasState}</span>
            </div>
          </div>
        </section>

        <section class="overview-card">
          <div class="overview-pills">
            <For each={overview().pills ?? []}>
              {(pill) => (
                <span class={`overview-pill ${pill.tone}`}>{pill.label}</span>
              )}
            </For>
          </div>
          <p class="overview-hint">{overview().hint}</p>
        </section>

        <section class="overview-card">
          <div class="overview-title">
            <strong>Quick controls</strong>
          </div>
          <div class="overview-actions">
            <For each={overview().actions ?? []}>
              {(action) => (
                <button
                  class="mini-btn"
                  disabled={action.disabled}
                  onClick={action.onClick}
                >
                  {action.label}
                </button>
              )}
            </For>
          </div>
        </section>
      </div>
    </Show>
  );
}

export function updateProjectOverview(data: ProjectOverviewData): void {
  setOverview(data);
}

export function mountProjectOverview(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <ProjectOverviewPanel />, container);
}
