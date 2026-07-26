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

let gitPanelHandlers: {
  onRefresh: () => void;
  onCommit: (message: string) => void | Promise<void>;
} | null = null;

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
  const [commitMessage, setCommitMessage] = createSignal("");
  const [committing, setCommitting] = createSignal(false);

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

  const submitCommit = async () => {
    const message = commitMessage().trim();
    if (!message || !gitPanelHandlers || committing()) return;
    setCommitting(true);
    try {
      await gitPanelHandlers.onCommit(message);
      setCommitMessage("");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Show
      when={gitStatus() && gitStatus()?.available}
      fallback={<p class="muted">Git status unavailable.</p>}
    >
      <div class="git-status-wrapper">
        <div class="git-panel-actions">
          <button
            type="button"
            class="btn ghost"
            onClick={() => gitPanelHandlers?.onRefresh()}
          >
            Refresh
          </button>
        </div>

        <Show when={gitStatus()?.detachedHead}>
          <p class="muted git-detached-note">
            Detached HEAD — commits won't update a branch until you check one
            out.
          </p>
        </Show>

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

          <label class="meta-field git-commit-field">
            <span>Commit message</span>
            <textarea
              rows={3}
              value={commitMessage()}
              placeholder="Describe your changes"
              disabled={committing()}
              onInput={(event) => setCommitMessage(event.currentTarget.value)}
            />
          </label>
          <button
            type="button"
            class="btn primary"
            disabled={!commitMessage().trim() || committing()}
            onClick={() => void submitCommit()}
          >
            {committing() ? "Committing…" : "Commit All Changes"}
          </button>
        </Show>
      </div>
    </Show>
  );
}

export function updateGitStatus(status: GitStatusData | null): void {
  setGitStatus(status);
}

export function registerGitPanelHandlers(handlers: {
  onRefresh: () => void;
  onCommit: (message: string) => void | Promise<void>;
}): void {
  gitPanelHandlers = handlers;
}

export function mountGitBranch(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <GitBranchTag />, container);
}

export function mountGitPanel(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <GitPanelContent />, container);
}
