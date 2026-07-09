import { render } from "solid-js/web";
import { createSignal, For, Show, createEffect } from "solid-js";

export interface GitStatusData {
  available: boolean;
  detachedHead: boolean;
  branch: string | null;
  zephusIgnored?: boolean;
  modified: string[];
  added: string[];
  deleted: string[];
}

const [gitStatus, setGitStatus] = createSignal<GitStatusData | null>(null);

function runIconRefresh() {
  setTimeout(() => {
    if (typeof window.refreshIcons === "function") {
      window.refreshIcons();
    }
  }, 0);
}

export function GitBranchTag() {
  createEffect(() => {
    gitStatus();
    runIconRefresh();
  });

  return (
    <Show when={gitStatus()}>
      {(status) => (
        <Show
          when={status().available}
          fallback={
            <>
              <i data-lucide="git-branch" aria-hidden="true"></i>{" "}
              <span>git: unavailable</span>
            </>
          }
        >
          <Show
            when={!status().detachedHead}
            fallback={
              <>
                <i data-lucide="git-branch" aria-hidden="true"></i>{" "}
                <span>detached HEAD</span>
              </>
            }
          >
            <>
              <i data-lucide="git-branch" aria-hidden="true"></i>{" "}
              <span>{status().branch ?? ""}</span>
            </>
          </Show>
        </Show>
      )}
    </Show>
  );
}

export function GitPanelContent() {
  createEffect(() => {
    gitStatus();
    runIconRefresh();
  });

  const hasChanges = () => {
    const status = gitStatus();
    if (!status) return false;
    return (
      status.modified.length > 0 ||
      status.added.length > 0 ||
      status.deleted.length > 0
    );
  };

  return (
    <Show
      when={gitStatus() && gitStatus()?.available}
      fallback={<p class="muted">Git status unavailable.</p>}
    >
      <div class="git-status-wrapper">
        <Show when={gitStatus()?.zephusIgnored}>
          <div class="g-warning">
            <i data-lucide="alert-triangle" aria-hidden="true"></i>{" "}
            <span>
              <strong>.zephus is git-ignored.</strong> Commit it — it stores
              this project's Zephus save state and is required to open the site
              on other machines.
            </span>
          </div>
        </Show>

        <Show when={hasChanges()} fallback={<p class="muted">No changes.</p>}>
          <div class="git-files-list">
            <For each={gitStatus()?.modified}>
              {(file) => (
                <div class="g-file">
                  <span class="g-badge g-m">M</span>
                  <span>{file}</span>
                </div>
              )}
            </For>
            <For each={gitStatus()?.added}>
              {(file) => (
                <div class="g-file">
                  <span class="g-badge g-a">A</span>
                  <span>{file}</span>
                </div>
              )}
            </For>
            <For each={gitStatus()?.deleted}>
              {(file) => (
                <div class="g-file">
                  <span class="g-badge g-d">D</span>
                  <span>{file}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}

export function updateGitStatus(status: GitStatusData | null): void {
  setGitStatus(status);
}

export function mountGitBranch(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <GitBranchTag />, container);
}

export function mountGitPanel(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <GitPanelContent />, container);
}
