import { render } from "solid-js/web";
import { For, Show, createEffect, createSignal } from "solid-js";
import {
  formatGitUpstreamLabel,
  formatGitUpstreamPanelNote,
} from "./gitUpstreamLabel";

export interface GitStatusData {
  available: boolean;
  detachedHead: boolean;
  branch: string | null;
  zephusIgnored?: boolean;
  notARepository?: boolean;
  error?: string;
  ahead?: number;
  behind?: number;
  modified: string[];
  added: string[];
  deleted: string[];
}

const [gitStatus, setGitStatus] = createSignal<GitStatusData | null>(null);

let gitPanelHandlers: {
  onRefresh: () => void;
  onCommit: (message: string, paths?: string[]) => void | Promise<void>;
  onPush: () => void | Promise<void>;
  onPull: () => void | Promise<void>;
  onInitRepo: () => void | Promise<void>;
} | null = null;

function listChangedFiles(status: GitStatusData): string[] {
  return [...status.modified, ...status.added, ...status.deleted];
}

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
              <span>
                {status().branch ?? ""}
                {formatGitUpstreamLabel(status().ahead, status().behind)}
              </span>
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
  const [pushing, setPushing] = createSignal(false);
  const [pulling, setPulling] = createSignal(false);
  const [initializing, setInitializing] = createSignal(false);
  const [selectedFiles, setSelectedFiles] = createSignal<Set<string>>(
    new Set(),
  );

  const busy = () => committing() || pushing() || pulling() || initializing();

  const changedFilesSignature = (status: GitStatusData | null): string =>
    status ? listChangedFiles(status).join("\u0000") : "";
  let lastFilesSignature = "";

  createEffect(() => {
    gitStatus();
    runIconRefresh();
  });

  createEffect(() => {
    const status = gitStatus();
    if (!status) {
      lastFilesSignature = "";
      setSelectedFiles(new Set<string>());
      return;
    }
    const signature = changedFilesSignature(status);
    // Only auto-select when the working-tree file set actually changed. A plain
    // refresh (or a post-commit/push/pull status update) must not clobber a
    // manual subset selection the user made.
    if (signature !== lastFilesSignature) {
      lastFilesSignature = signature;
      setSelectedFiles(new Set(listChangedFiles(status)));
    }
  });

  const toggleFile = (file: string, checked: boolean) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (checked) next.add(file);
      else next.delete(file);
      return next;
    });
  };

  const selectAllFiles = () => {
    const status = gitStatus();
    if (!status) return;
    setSelectedFiles(new Set(listChangedFiles(status)));
  };

  const clearFileSelection = () => setSelectedFiles(new Set<string>());

  const hasChanges = () => {
    const status = gitStatus();
    if (!status) return false;
    return (
      status.modified.length > 0 ||
      status.added.length > 0 ||
      status.deleted.length > 0
    );
  };

  const canSyncRemote = () => {
    const status = gitStatus();
    return !!status?.available && !status.detachedHead && !!status.branch;
  };

  const submitCommit = async () => {
    const message = commitMessage().trim();
    if (!message || !gitPanelHandlers || busy()) return;
    const paths = [...selectedFiles()];
    if (paths.length === 0) return;
    const status = gitStatus();
    const allPaths = status ? listChangedFiles(status) : [];
    const commitAll = allPaths.length > 0 && paths.length === allPaths.length;
    setCommitting(true);
    try {
      await gitPanelHandlers.onCommit(message, commitAll ? undefined : paths);
      setCommitMessage("");
    } finally {
      setCommitting(false);
    }
  };

  const selectedCount = () => selectedFiles().size;

  const commitButtonLabel = () => {
    const status = gitStatus();
    if (!status) return "Commit";
    const all = listChangedFiles(status);
    const n = selectedCount();
    if (n === 0) return "Commit";
    if (n === all.length)
      return committing() ? "Committing…" : "Commit All Changes";
    return committing() ? "Committing…" : `Commit ${n} Selected`;
  };

  const runPull = async () => {
    if (!gitPanelHandlers || pulling() || pushing() || committing()) return;
    setPulling(true);
    try {
      await gitPanelHandlers.onPull();
    } finally {
      setPulling(false);
    }
  };

  const runPush = async () => {
    if (!gitPanelHandlers || pushing() || pulling() || committing()) return;
    setPushing(true);
    try {
      await gitPanelHandlers.onPush();
    } finally {
      setPushing(false);
    }
  };

  const runInitRepo = async () => {
    if (!gitPanelHandlers || initializing()) return;
    setInitializing(true);
    try {
      await gitPanelHandlers.onInitRepo();
    } finally {
      setInitializing(false);
    }
  };

  return (
    <Show
      when={gitStatus()}
      fallback={<p class="muted">Loading Git status…</p>}
    >
      {(status) => (
        <Show
          when={status().available}
          fallback={
            <div class="git-status-wrapper">
              <p class="muted">
                {status().notARepository
                  ? "This project is not a Git repository yet."
                  : "Git status unavailable."}
              </p>
              <Show when={status().error}>
                <p class="muted git-error-detail">{status().error}</p>
              </Show>
              <div class="git-panel-actions">
                <button
                  type="button"
                  class="btn ghost"
                  disabled={busy()}
                  onClick={() => {
                    if (busy()) return;
                    gitPanelHandlers?.onRefresh();
                  }}
                >
                  Refresh
                </button>
                <Show when={status().notARepository}>
                  <button
                    type="button"
                    class="btn primary"
                    disabled={initializing()}
                    onClick={() => void runInitRepo()}
                  >
                    {initializing()
                      ? "Initializing…"
                      : "Initialize Git Repository"}
                  </button>
                </Show>
              </div>
            </div>
          }
        >
          <div class="git-status-wrapper">
            <div class="git-panel-actions">
              <button
                type="button"
                class="btn ghost"
                disabled={busy()}
                onClick={() => {
                  if (busy()) return;
                  gitPanelHandlers?.onRefresh();
                }}
                title="Fetch remote and refresh working tree status"
              >
                Refresh
              </button>
              <Show when={canSyncRemote()}>
                <button
                  type="button"
                  class="btn"
                  disabled={busy()}
                  onClick={() => void runPull()}
                >
                  {pulling() ? "Pulling…" : "Pull (Fast-Forward)"}
                </button>
                <button
                  type="button"
                  class="btn"
                  disabled={busy()}
                  onClick={() => void runPush()}
                >
                  {pushing() ? "Pushing…" : "Push to Remote"}
                </button>
              </Show>
            </div>

            <Show when={gitStatus()?.detachedHead}>
              <p class="muted git-detached-note">
                Detached HEAD — commits won't update a branch until you check
                one out.
              </p>
            </Show>

            <Show
              when={(() => {
                const s = gitStatus();
                if (s?.ahead == null || s?.behind == null) return false;
                return formatGitUpstreamPanelNote(s.ahead, s.behind);
              })()}
            >
              {(note) => <p class="muted git-upstream-note">{note()}</p>}
            </Show>

            <Show when={gitStatus()?.zephusIgnored}>
              <div class="g-warning">
                <i data-lucide="alert-triangle" aria-hidden="true"></i>{" "}
                <span>
                  <strong>.zephus is git-ignored.</strong> Commit it — it stores
                  this project's Zephus save state and is required to open the
                  site on other machines.
                </span>
              </div>
            </Show>

            <Show
              when={hasChanges()}
              fallback={<p class="muted">No changes.</p>}
            >
              <div class="git-files-toolbar">
                <button
                  type="button"
                  class="btn ghost small"
                  onClick={() => selectAllFiles()}
                >
                  Select all
                </button>
                <button
                  type="button"
                  class="btn ghost small"
                  onClick={() => clearFileSelection()}
                >
                  Clear
                </button>
              </div>
              <div class="git-files-list">
                <For each={gitStatus()?.modified}>
                  {(file) => (
                    <label class="g-file">
                      <input
                        type="checkbox"
                        checked={selectedFiles().has(file)}
                        onChange={(event) =>
                          toggleFile(file, event.currentTarget.checked)
                        }
                      />
                      <span class="g-badge g-m">M</span>
                      <span>{file}</span>
                    </label>
                  )}
                </For>
                <For each={gitStatus()?.added}>
                  {(file) => (
                    <label class="g-file">
                      <input
                        type="checkbox"
                        checked={selectedFiles().has(file)}
                        onChange={(event) =>
                          toggleFile(file, event.currentTarget.checked)
                        }
                      />
                      <span class="g-badge g-a">A</span>
                      <span>{file}</span>
                    </label>
                  )}
                </For>
                <For each={gitStatus()?.deleted}>
                  {(file) => (
                    <label class="g-file">
                      <input
                        type="checkbox"
                        checked={selectedFiles().has(file)}
                        onChange={(event) =>
                          toggleFile(file, event.currentTarget.checked)
                        }
                      />
                      <span class="g-badge g-d">D</span>
                      <span>{file}</span>
                    </label>
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
                  onInput={(event) =>
                    setCommitMessage(event.currentTarget.value)
                  }
                />
              </label>
              <button
                type="button"
                class="btn primary"
                disabled={
                  !commitMessage().trim() || busy() || selectedCount() === 0
                }
                onClick={() => void submitCommit()}
              >
                {commitButtonLabel()}
              </button>
            </Show>
          </div>
        </Show>
      )}
    </Show>
  );
}

export function updateGitStatus(status: GitStatusData | null): void {
  setGitStatus(status);
}

export function registerGitPanelHandlers(handlers: {
  onRefresh: () => void;
  onCommit: (message: string, paths?: string[]) => void | Promise<void>;
  onPush: () => void | Promise<void>;
  onPull: () => void | Promise<void>;
  onInitRepo: () => void | Promise<void>;
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
