/**
 * Preview / publish / dependency-install for the editor. Extracted from the
 * engine so the ~370 lines and their three pieces of module state
 * (previewStartInFlight, publishInFlight, previewLogSubscriptions) live in
 * one place with an explicit deps contract.
 */

import { appendCappedLog } from "./editorLog";
import { renderPublishSuccessModalBody } from "./MiscModals";
import { isGlobalDirty } from "./editorSession";
import type { EditorSessionState } from "./editorSession";

export type InstallFlowResult = "installed" | "backgrounded" | "failed";

export interface PreviewPublishDeps {
  getState: () => EditorSessionState;
  $: (id: string) => HTMLElement;
  $maybe: (id: string) => HTMLElement | null;
  setStatus: (message: string) => void;
  refreshIcons: () => void;
  showModal: (
    title: string,
    body: string,
    actions: Array<{
      label: string;
      kind?: "primary" | "danger" | "ghost";
      onClick: () => void;
    }>,
    options?: { size?: "default" | "wide" },
  ) => void;
  showModalNode: (
    title: string,
    content: HTMLElement,
    actions: Array<{
      label: string;
      kind?: "primary" | "danger" | "ghost";
      onClick: () => void;
    }>,
    options?: { size?: "default" | "wide" },
  ) => void;
  closeModal: () => void;
  registerCleanup: (cleanup: (() => void) | null) => void;
  maybeResolveUnsavedWork: (options?: {
    reloadCurrentPageOnDiscard?: boolean;
  }) => Promise<boolean>;
  performSave: () => Promise<boolean>;
  refreshGuidancePanels: () => void;
  renderCanvas: () => void;
  renderProperties: () => void;
  friendlyError: (raw: string | undefined) => string;
}

export function createPreviewPublishActions(deps: PreviewPublishDeps) {
  const {
    getState,
    $,
    $maybe,
    setStatus,
    refreshIcons,
    showModal,
    showModalNode,
    closeModal,
    maybeResolveUnsavedWork,
    refreshGuidancePanels,
    renderCanvas,
    renderProperties,
    friendlyError,
  } = deps;

  const state = getState();

  function setViewport(vp: "desktop" | "tablet" | "mobile"): void {
    state.currentViewport = vp;
    const wrap = document.querySelector(".canvas-wrap");
    if (!wrap) return;
    wrap.classList.remove("vp-tablet", "vp-mobile");
    if (vp === "tablet") wrap.classList.add("vp-tablet");
    if (vp === "mobile") wrap.classList.add("vp-mobile");
    for (const [id, value] of [
      ["vp-desktop", "desktop"],
      ["vp-tablet", "tablet"],
      ["vp-mobile", "mobile"],
    ] as const) {
      const button = $(id);
      button.classList.toggle("active", vp === value);
      button.setAttribute("aria-pressed", String(vp === value));
    }
    // Always repaint in visual mode: while the preview window is open the wrap
    // classes shrink the canvas container immediately, but the block HTML and
    // effectiveStyle were rendered for the previous viewport. Repainting here is
    // harmless (the preview is a separate window) and keeps the canvas honest.
    if (state.mode === "visual") {
      renderCanvas();
      renderProperties();
    }
  }

  async function runInstallFlow(
    projectPath: string,
  ): Promise<InstallFlowResult> {
    const wrap = document.createElement("div");
    wrap.className = "install-flow";
    const status = document.createElement("p");
    status.className = "muted";
    status.textContent =
      "Installing dependencies… This can take a minute on first run.";
    const logEl = document.createElement("pre");
    logEl.className = "dev-log install-log";
    wrap.append(status, logEl);

    const unsub = window.zephus.onInstallLog((chunk) => {
      appendCappedLog(logEl, chunk);
    });

    // npm can stay silent for long stretches on first run; a ticking elapsed
    // timer guarantees the modal always shows live activity (never a blank box).
    const startedAt = Date.now();
    const baseStatus =
      "Installing dependencies… This can take a minute on first run.";
    const heartbeat = window.setInterval(() => {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      status.textContent = `${baseStatus} (${secs}s)`;
    }, 1000);

    return new Promise<InstallFlowResult>((resolve) => {
      let done = false;
      // `done` also covers "user sent the install to the background": the
      // completion handler must then stay silent (no closeModal/setStatus) so
      // it cannot disturb a modal the user opened in the meantime.
      const stopHeartbeat = () => window.clearInterval(heartbeat);
      showModalNode("Setting Up Your Site", wrap, [
        {
          label: "Run in Background",
          kind: "ghost",
          onClick: () => {
            if (!done) {
              done = true;
              stopHeartbeat();
              unsub();
              closeModal();
              resolve("backgrounded");
            }
          },
        },
        {
          label: "Cancel",
          kind: "ghost",
          onClick: async () => {
            if (done) return;
            done = true;
            stopHeartbeat();
            unsub();
            await window.zephus.cancelInstall().catch(() => undefined);
            closeModal();
            resolve("failed");
          },
        },
      ]);

      void window.zephus
        .installDependencies(projectPath)
        .then((result) => {
          if (done) return;
          done = true;
          stopHeartbeat();
          unsub();
          if (result.ok) {
            status.textContent = "Dependencies installed. You're ready to go.";
            setStatus("Dependencies installed.");
            closeModal();
            resolve("installed");
          } else {
            // Failure must never leave the install modal open with a dead
            // "Run in Background" button: close it and surface the error.
            closeModal();
            setStatus("Dependency install failed.");
            showModal("Install Failed", friendlyError(result.error), [
              { label: "OK", kind: "primary", onClick: closeModal },
            ]);
            resolve("failed");
          }
        })
        .catch(() => {
          if (done) return;
          done = true;
          stopHeartbeat();
          unsub();
          closeModal();
          setStatus("Dependency install failed.");
          showModal(
            "Install Failed",
            "Dependencies could not be installed. Check the network connection or your project's package.json.",
            [{ label: "OK", kind: "primary", onClick: closeModal }],
          );
          resolve("failed");
        });
    });
  }

  /** Ensures deps are installed; offers to install if not. Returns true if ready. */
  async function ensureDependencies(): Promise<boolean> {
    if (!state.project) return false;
    const installed = await window.zephus.dependenciesInstalled(
      state.project.path,
    );
    if (installed) return true;
    return (await runInstallFlow(state.project.path)) === "installed";
  }

  function updatePreviewButton(
    state_: "running" | "stopped" | "starting",
  ): void {
    const btn = $maybe("btn-preview");
    if (!btn) return;
    // Persistent URL chip: the status bar clears after 6s, so the preview
    // address used to vanish.
    const chip = $maybe("preview-url-chip");
    if (chip) {
      const chipText = chip.querySelector("span");
      if (state_ === "running" && state.previewUrl) {
        chip.classList.remove("hidden");
        if (chipText) chipText.textContent = state.previewUrl;
      } else {
        chip.classList.add("hidden");
      }
    }
    if (state_ === "starting") {
      btn.innerHTML = `<i data-lucide="loader-circle"></i> Starting…`;
      btn.classList.add("disabled");
    } else {
      btn.innerHTML =
        state_ === "running"
          ? `<i data-lucide="square"></i> Stop Preview`
          : `<i data-lucide="play"></i> Start Preview`;
      btn.classList.remove("disabled");
    }
    refreshIcons();
  }

  // Every live preview-log subscription, tracked as a set: togglePreview can be
  // re-entered (double-click) and a single-slot reference would leak the first
  // subscription when the second call overwrites it.
  const previewLogSubscriptions = new Set<() => void>();

  /** Removes ONE live preview-log subscription (the caller's own). */
  function unsubscribePreviewLog(unsub: () => void): void {
    previewLogSubscriptions.delete(unsub);
    unsub();
  }

  function unsubscribeAllPreviewLogs(): void {
    for (const unsub of previewLogSubscriptions) unsub();
    previewLogSubscriptions.clear();
  }

  function resetPreviewState(message?: string): void {
    state.previewUrl = null;
    unsubscribeAllPreviewLogs();
    updatePreviewButton("stopped");
    refreshGuidancePanels();
    if (message) setStatus(message);
  }

  // Guards the start sequence: double-clicking Start would fire two
  // startPreview calls (the second fails with "already starting") and the
  // loser's cleanup would kill the winner's log subscription.
  let previewStartInFlight = false;

  async function togglePreview(): Promise<void> {
    if (!state.project) return;

    // Preview runs in a dedicated external window loading the dev server, so the
    // editor stays fully in edit mode. Stopping closes that window + the server.
    if (state.previewUrl) {
      await window.zephus.closePreviewWindow();
      resetPreviewState("Preview stopped.");
      return;
    }

    if (previewStartInFlight) return;
    previewStartInFlight = true;
    updatePreviewButton("starting");
    const projectPathAtStart = state.project.path;
    try {
      if (isGlobalDirty(state)) {
        const resolved = await maybeResolveUnsavedWork({
          reloadCurrentPageOnDiscard: true,
        });
        if (!resolved) return;
      }
      // The project may have been closed while the prompt/dep-check awaited;
      // continuing would open a preview window + dev server for a nulled
      // project (orphan window, dead server, "Stop Preview" stuck in start
      // view).
      if (state.project?.path !== projectPathAtStart) return;
      if (!(await ensureDependencies())) return;
      if (state.project?.path !== projectPathAtStart) return;
      setStatus("Starting dev server (npm run dev)…");
      // Clear the previous project's/server's log so output does not interleave
      // across sessions.
      const devLogEl = $("dev-log");
      devLogEl.textContent = "";
      const unsub = window.zephus.onPreviewLog((chunk) => {
        appendCappedLog(devLogEl, chunk);
      });
      previewLogSubscriptions.add(unsub);
      try {
        const result = await window.zephus.startPreview(projectPathAtStart);
        if (state.project?.path !== projectPathAtStart) {
          // Closed mid-start: tear the started server down rather than orphaning it.
          await window.zephus.stopPreview().catch(() => {});
          return;
        }
        if (!result.ok || !result.url) {
          setStatus("Preview failed: " + friendlyError(result.error));
          return;
        }
        const opened = await window.zephus.openPreviewWindow(result.url);
        if (state.project?.path !== projectPathAtStart) {
          await window.zephus.stopPreview().catch(() => {});
          return;
        }
        if (!opened.ok) {
          setStatus("Preview failed: " + friendlyError(opened.error));
          await window.zephus.stopPreview();
          return;
        }
        state.previewUrl = result.url;
        updatePreviewButton("running");
        refreshGuidancePanels();
        setStatus("Preview open in a separate window: " + result.url);
      } catch (error) {
        // An IPC rejection must not leave the log listener attached or the
        // Preview button wedged in "Starting…".
        setStatus(
          "Preview failed: " +
            (error instanceof Error ? error.message : String(error)),
        );
      } finally {
        // A successful start keeps the subscription for the server's lifetime
        // (main streams logs until the preview stops) — only failures tear it
        // down. Unsubscribing the WHOLE set here would freeze the Dev Server
        // Log panel immediately after startup.
        if (!state.previewUrl) unsubscribePreviewLog(unsub);
      }
    } finally {
      previewStartInFlight = false;
      if (!state.previewUrl) updatePreviewButton("stopped");
    }
  }

  /* ---------- Publish ---------- */

  // Guards the build sequence: double-clicking Publish (or Publish during a
  // build) would fire two full builds; the main process rejects the second with
  // "A build is already running", which the old code surfaced as a scary
  // "Build Failed" modal.
  let publishInFlight = false;

  async function publishSite(): Promise<void> {
    if (!state.project || publishInFlight) return;
    publishInFlight = true;
    try {
      const project = state.project;
      const dirtyAtStart = isGlobalDirty(state);
      // A build publishes whatever is on disk, so unsaved edits must be saved
      // (or discarded) first — otherwise the user confirms "built!" while their
      // newer content is not what got published.
      if (dirtyAtStart) {
        const resolved = await maybeResolveUnsavedWork({
          reloadCurrentPageOnDiscard: true,
        });
        if (!resolved) return;
      }
      if (!(await ensureDependencies())) return;
      // The project may have been closed while the dependency check ran.
      if (state.project?.path !== project.path) return;
      setStatus("Building site for production (npm run build)…");
      // Stream the build output into the Dev Server Log panel so a long first
      // build never reads as a hang.
      const devLogEl = $("dev-log");
      const unsubBuildLog = window.zephus.onPublishLog((chunk) => {
        appendCappedLog(devLogEl, chunk);
      });
      const r = await window.zephus.publish(project.path, project.astro.outDir);
      unsubBuildLog();
      if (state.project?.path !== project.path) return;
      if (!r.ok) {
        showModal("Build Failed", friendlyError(r.error), [
          { label: "OK", kind: "primary", onClick: closeModal },
        ]);
        setStatus("Build failed.");
        return;
      }
      // Edits that arrived while the build ran are NOT in the published output.
      // Say so instead of a misleading "Build complete". We resolved any
      // pre-existing unsaved work above, so the state was clean when the build
      // started — any dirtiness NOW is an edit made during the build. (Checking
      // `!dirtyAtStart` instead false-negatived when the user started dirty,
      // resolved, then edited again mid-build.)
      const newerEdits = isGlobalDirty(state);
      const outputDir = r.outputDir ?? project.astro.outDir;
      setStatus(
        newerEdits
          ? `Build complete, but newer unsaved edits are NOT included. Output: ${outputDir}`
          : `Build complete. Output: ${outputDir}`,
      );
      const pubWrap = document.createElement("div");
      renderPublishSuccessModalBody(pubWrap, {
        outputDir,
        newerEditsNotIncluded: newerEdits,
      });
      showModalNode("Site Built — Ready to Go Online", pubWrap, [
        {
          label: "Open Output Folder",
          kind: "ghost",
          onClick: () => {
            // Reveal only: calling publish() again would run a second full build.
            if (!state.project) return;
            void window.zephus
              .revealOutputFolder(
                state.project.path,
                state.project.astro.outDir,
              )
              .then((res) => {
                if (res && !res.ok) {
                  // The output folder is often deleted/cleaned after a rebuild
                  // or never created (custom build script) — say so instead of
                  // a silent no-op.
                  setStatus(
                    "Could not open the output folder: " +
                      (res.error ?? "it may not exist yet"),
                  );
                }
              })
              .catch(() => {
                setStatus("Could not open the output folder.");
              });
          },
        },
        { label: "Done", kind: "primary", onClick: closeModal },
      ]);
    } finally {
      publishInFlight = false;
    }
  }
  return {
    setViewport,
    runInstallFlow,
    ensureDependencies,
    updatePreviewButton,
    resetPreviewState,
    togglePreview,
    publishSite,
    unsubscribeAllPreviewLogs,
  };
}
