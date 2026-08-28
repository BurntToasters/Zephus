import { render } from "solid-js/web";
import { For, Show, createEffect, createSignal } from "solid-js";

export interface RecentProjectEntry {
  path: string;
  name: string;
  badge: string;
  resumeLabel: string;
}

export interface RecentProjectsData {
  entries: RecentProjectEntry[];
}

export interface RecentProjectsHandlers {
  onOpenFolder: () => void;
  onExploreTemplates: () => void;
  onOpenProject: (path: string) => void;
  onRemoveProject: (path: string) => void | Promise<void>;
}

const [recentProjects, setRecentProjects] = createSignal<RecentProjectsData>({
  entries: [],
});
let handlers: RecentProjectsHandlers | null = null;

function runIconRefresh() {
  setTimeout(() => {
    if (typeof window.refreshIcons === "function") {
      window.refreshIcons();
    }
  }, 0);
}

export function RecentProjectsPanel() {
  createEffect(() => {
    recentProjects();
    runIconRefresh();
  });

  return (
    <Show
      when={recentProjects().entries.length > 0}
      fallback={
        <div class="welcome-card">
          <div class="welcome-icon-pill">
            <i data-lucide="layout"></i>
          </div>
          <h3 class="welcome-title">Welcome to Zephus</h3>
          <p class="welcome-copy">
            Create a new Astro site from one of the starter templates, or open
            an existing Zephus project from your computer.
          </p>
          <div class="welcome-buttons">
            <button
              class="btn primary"
              onClick={() => handlers?.onOpenFolder()}
            >
              <i data-lucide="folder-open"></i> Open Folder
            </button>
            <button class="btn" onClick={() => handlers?.onExploreTemplates()}>
              <i data-lucide="compass"></i> Explore Templates
            </button>
          </div>
        </div>
      }
    >
      <For each={recentProjects().entries}>
        {(entry) => (
          <li>
            <button
              class="recent-project"
              type="button"
              onClick={() => handlers?.onOpenProject(entry.path)}
            >
              <div class="recent-project-head">
                <span class="proj-name">{entry.name}</span>
                <span class="recent-badge">{entry.badge}</span>
              </div>
              <span class="path">{entry.path}</span>
              <div class="recent-project-meta">
                <span>Zephus-managed project</span>
                <span>{entry.resumeLabel}</span>
              </div>
            </button>
            <button
              type="button"
              class="recent-remove"
              title="Remove from recent projects"
              aria-label={`Remove ${entry.name} from recent projects`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void handlers?.onRemoveProject(entry.path);
              }}
            >
              <i data-lucide="x"></i>
            </button>
          </li>
        )}
      </For>
    </Show>
  );
}

export function updateRecentProjects(data: RecentProjectsData): void {
  setRecentProjects(data);
}

export function registerRecentProjectsHandlers(
  nextHandlers: RecentProjectsHandlers,
): void {
  handlers = nextHandlers;
}

export function mountRecentProjects(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <RecentProjectsPanel />, container);
}
