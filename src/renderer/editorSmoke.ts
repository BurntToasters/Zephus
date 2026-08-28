/** Editor smoke harness (--smoke / ?smoke=1). */

import type { EditorSessionState } from "./editorSession";
import type { EditorBlock, SectionNode } from "../main/types";

type Block = EditorBlock;

export interface EditorSmokeDeps {
  getState: () => EditorSessionState;
  $: (id: string) => HTMLElement;
  setMode: (mode: "visual" | "code") => void;
  renderLayers: () => void;
  renderCanvas: () => void;
  renderProperties: () => void;
  syncBlocksFromSections: () => void;
  markPageDirty: (state: EditorSessionState, dirty: boolean) => void;
  addBlockAt: (
    type: "heading" | "text" | "image" | "html" | "section" | "card",
    index: number,
    sectionId?: string | null,
  ) => void;
  findBlockLocation: (id: string | null) => {
    section: SectionNode;
    block: Block;
    blockIndex: number;
  } | null;
  openProjectByPath: (folder: string) => Promise<void>;
  performSave: () => Promise<boolean>;
  publishSite: () => Promise<void>;
  closeProject: () => Promise<void>;
}

export function installEditorSmokeHook(deps: EditorSmokeDeps): void {
  const {
    getState,
    $,
    setMode,
    renderLayers,
    renderCanvas,
    renderProperties,
    syncBlocksFromSections,
    markPageDirty,
    addBlockAt,
    findBlockLocation,
    openProjectByPath,
    performSave,
    publishSite,
    closeProject,
  } = deps;

  window.__zephusRunEditorSmoke = async () => {
    const state = getState();
    const failures: string[] = [];
    const assert = (condition: unknown, message: string): void => {
      if (!condition) failures.push(message);
    };

    const section: SectionNode = {
      id: "smoke-section",
      type: "section",
      label: "Smoke Section",
      props: { wrapper: "none", cls: "" },
      children: [
        {
          id: "smoke-heading",
          type: "heading",
          props: { text: "Smoke Title", level: "2" },
          style: {},
        },
        {
          id: "smoke-button",
          type: "button",
          props: {
            text: "Smoke Link",
            href: "https://example.com",
            cls: "",
          },
          style: {},
        },
      ],
    };
    state.sections = [section];
    // A project object enables the document-level keyboard shortcuts
    // (undo/redo/delete) the smoke exercises below.
    state.project = {
      path: "/smoke-project",
      name: "Smoke Project",
    } as ProjectOpenResult;
    state.selectedSectionId = section.id;
    state.selectedId = "smoke-heading";
    state.page = "src/pages/index.astro";
    state.currentMeta = {
      page: state.page,
      route: "/",
      slug: "index",
      title: "Smoke",
      navLabel: "Smoke",
      metaDescription: "",
      navVisible: true,
      isHome: true,
      detached: false,
      socialImage: "",
      canonicalUrl: "",
      noindex: false,
      publishDate: "",
      author: "",
    };
    state.pageMeta = state.currentMeta ? [state.currentMeta] : [];
    state.currentViewport = "desktop";
    state.undo = [];
    state.redo = [];
    markPageDirty(state, false);
    syncBlocksFromSections();

    $("view-start").classList.add("hidden");
    $("view-editor").classList.remove("hidden");
    $("project-name").textContent = "Smoke Project";
    setMode("visual");
    renderLayers();
    renderCanvas();
    renderProperties();

    assert(
      !!document.querySelector(".block.selected"),
      "Editor smoke: selected block did not render.",
    );
    assert(
      document.querySelectorAll(".resize-handle").length === 4,
      "Editor smoke: selected block resize handles missing.",
    );

    const textInput = document.querySelector<HTMLInputElement>(
      "#properties input.text",
    );
    assert(!!textInput, "Editor smoke: inspector text input missing.");
    if (textInput) {
      textInput.focus();
      textInput.value = "";
      for (const char of "Smoke Typed") {
        textInput.value += char;
        textInput.dispatchEvent(new Event("input", { bubbles: true }));
        assert(
          document.activeElement === textInput,
          "Editor smoke: inspector input lost focus while typing.",
        );
      }
      assert(
        section.children[0]?.props["text"] === "Smoke Typed",
        "Editor smoke: inspector input did not update block props.",
      );
      textInput.blur();
    }

    const target = document.querySelector<HTMLElement>(
      ".block-preview .editable-text-target",
    );
    assert(!!target, "Editor smoke: inline editable target missing.");
    if (target) {
      target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      assert(
        target.isContentEditable,
        "Editor smoke: double-click did not start inline editing.",
      );
      target.textContent = "Inline Edited";
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      assert(
        section.children[0]?.props["text"] === "Inline Edited",
        "Editor smoke: inline edit did not update block props.",
      );
    }

    const canvasLink = document.querySelector<HTMLAnchorElement>(
      '.block-preview a[href="https://example.com"]',
    );
    assert(!!canvasLink, "Editor smoke: canvas link missing.");
    if (canvasLink) {
      const allowed = canvasLink.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      assert(!allowed, "Editor smoke: canvas link was not inert.");
    }

    // The canvas-link click above selected the button block; restore the
    // heading selection so the inspector edits the heading again.
    state.selectedId = "smoke-heading";
    state.selectedSectionId = section.id;
    renderProperties();

    // Undo/redo through the real inspector latch: typing commits one undo
    // entry on blur, Ctrl+Z reverts it, Ctrl+Shift+Z (or Cmd+Y) redoes.
    // Re-query the input: renderProperties() replaced the panel element.
    const redoKeys = (): void => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "z",
          ctrlKey: true,
          shiftKey: true,
        }),
      );
    };
    const undoKey = (): void => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "z",
          ctrlKey: true,
        }),
      );
    };
    const freshInput = document.querySelector<HTMLInputElement>(
      "#properties input.text",
    );
    assert(
      !!freshInput,
      "Editor smoke: inspector input missing after re-render.",
    );
    if (freshInput) {
      freshInput.focus();
      let directFired = false;
      const directListener = () => {
        directFired = true;
      };
      freshInput.addEventListener("input", directListener);
      freshInput.value = "Undo Me";
      freshInput.dispatchEvent(new Event("input", { bubbles: true }));
      freshInput.removeEventListener("input", directListener);
      const afterInput = section.children[0]?.props["text"];
      freshInput.blur();
      const afterBlur = section.children[0]?.props["text"];
      assert(
        afterBlur === "Undo Me",
        `Editor smoke: inspector blur did not commit (afterInput=${JSON.stringify(afterInput)} afterBlur=${JSON.stringify(afterBlur)} attached=${document.contains(freshInput)} direct=${directFired} selected=${state.selectedId} dirty=${state.pageDirty})`,
      );
      undoKey();
      assert(
        section.children[0]?.props["text"] !== "Undo Me",
        "Editor smoke: Ctrl+Z did not revert the inspector edit.",
      );
      redoKeys();
      assert(
        section.children[0]?.props["text"] === "Undo Me",
        "Editor smoke: redo did not restore the inspector edit.",
      );
    }

    // Add a block, duplicate the section, then undo both back to baseline.
    const beforeAdd = state.sections[0]?.children.length ?? 0;
    addBlockAt("text", 1, section.id);
    assert(
      (state.sections[0]?.children.length ?? 0) === beforeAdd + 1,
      "Editor smoke: addBlockAt did not insert a block.",
    );
    undoKey();
    assert(
      state.sections[0]?.children.length === beforeAdd,
      "Editor smoke: undo did not remove the added block.",
    );

    // The block-add above changed the selection; re-select the heading.
    state.selectedId = "smoke-heading";
    state.selectedSectionId = section.id;
    renderCanvas();
    renderProperties();

    // Keyboard resize of the selected block writes width + undo restores it.
    const selBlock = findBlockLocation(state.selectedId);
    const originalWidth = selBlock?.block.style?.width;
    const handle =
      document.querySelector<HTMLButtonElement>(".resize-handle.se");
    assert(!!handle, "Editor smoke: resize handle missing for keyboard test.");
    if (handle) {
      handle.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "ArrowRight",
        }),
      );
      assert(
        selBlock?.block.style?.width !== originalWidth,
        `Editor smoke: keyboard resize did not change the width (before=${JSON.stringify(originalWidth)} after=${JSON.stringify(selBlock?.block.style?.width)} selected=${state.selectedId} handles=${document.querySelectorAll(".resize-handle").length})`,
      );
      undoKey();
      const restored = findBlockLocation("smoke-heading");
      assert(
        restored?.block.style?.width === originalWidth,
        `Editor smoke: undo did not restore the pre-resize width (before=${JSON.stringify(originalWidth)} after=${JSON.stringify(restored?.block.style?.width)})`,
      );
    }

    // Inline edit Escape cancels and restores the original text.
    if (target) {
      target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      target.textContent = "Should Not Stick";
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
      assert(
        section.children[0]?.props["text"] === "Undo Me",
        "Editor smoke: Escape did not cancel the inline edit.",
      );
    }

    // Chrome-level flows that need no real project: the help modal, the
    // settings modal's node-status seeding, and the dirty-indicator wiring.
    const helpBtn = document.getElementById("btn-help");
    if (helpBtn instanceof HTMLButtonElement) {
      helpBtn.click();
      const helpModal = document.getElementById("modal-overlay");
      assert(
        helpModal && !helpModal.classList.contains("hidden"),
        "Editor smoke: Help modal did not open from the toolbar button.",
      );
      const closeBtn = Array.from(
        document.querySelectorAll("#modal-actions button"),
      ).find((button) => /close/i.test(button.textContent || ""));
      if (closeBtn instanceof HTMLButtonElement) closeBtn.click();
      assert(
        helpModal && helpModal.classList.contains("hidden"),
        "Editor smoke: Help modal did not close.",
      );
    }

    // Settings modal: opens, seeds the node-status line, and closes. The
    // modal body mounts after the settings read resolves, so yield first.
    const settingsBtn = document.getElementById("btn-settings");
    if (settingsBtn instanceof HTMLButtonElement) {
      settingsBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const settingsModal = document.getElementById("modal-overlay");
      assert(
        settingsModal && !settingsModal.classList.contains("hidden"),
        "Editor smoke: Settings modal did not open.",
      );
      const settingsClose = Array.from(
        document.querySelectorAll("#modal-actions button"),
      ).find((button) => /cancel/i.test(button.textContent || ""));
      if (settingsClose instanceof HTMLButtonElement) settingsClose.click();
      assert(
        settingsModal && settingsModal.classList.contains("hidden"),
        "Editor smoke: Settings modal did not close.",
      );
    }

    // Dirty state must be reflected in the save button + status indicator.
    markPageDirty(state, true);
    renderProperties();
    assert(
      state.pageDirty,
      "Editor smoke: markPageDirty did not set the dirty flag.",
    );
    markPageDirty(state, false);
    renderProperties();

    // Undo/redo buttons must track the session stacks.
    const undoButton = document.getElementById("btn-undo");
    if (undoButton instanceof HTMLButtonElement) {
      undoKey();
      assert(
        undoButton.disabled === (state.undo.length === 0),
        "Editor smoke: undo button state does not match the undo stack.",
      );
    }

    // ---- Real-project flows (save / drafts / publish / git) ----
    const zephus = (window as unknown as { zephus: typeof window.zephus })
      .zephus;
    const realProjectPath = (
      window as unknown as { __zephusSmokeProjectPath?: string }
    ).__zephusSmokeProjectPath;
    if (realProjectPath) {
      const wait = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));
      const closeAnyModal = async (): Promise<void> => {
        const overlay = document.getElementById("modal-overlay");
        if (!overlay || overlay.classList.contains("hidden")) return;
        const closeBtn = Array.from(
          document.querySelectorAll("#modal-actions button"),
        ).find((button) =>
          /close|cancel|done|later|ok/i.test(button.textContent || ""),
        );
        if (closeBtn instanceof HTMLButtonElement) {
          closeBtn.click();
          await wait(150);
        }
      };

      // Leave the synthesized session clean: any residual dirty flag or
      // undo entry would trigger the unsaved-work prompt inside the real
      // open (loadPage guards on isGlobalDirty) and hang the smoke on a
      // modal nobody can answer.
      state.pageDirty = false;
      state.siteDirty = false;
      state.undo = [];
      state.redo = [];

      await closeAnyModal();
      await openProjectByPath(realProjectPath);
      // The open resolves once the flow settles; the page document lands a
      // beat later. Wait for it before editing/saving.

      for (let i = 0; i < 40 && !state.pageDocument; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      await wait(800);
      assert(
        state.project?.path === realProjectPath,
        `Editor smoke: project did not open (path=${state.project?.path} expected=${realProjectPath})`,
      );

      const page = state.page;
      assert(!!page, "Editor smoke: no page loaded after project open.");
      assert(
        /Zephus/.test(document.title) && document.title !== "Zephus",
        `Editor smoke: window title did not pick up the project context (title="${document.title}")`,
      );

      // Recovery draft: an unsaved edit must surface a page draft after the
      // debounce window.
      const sectionId = state.sections[0]?.id ?? null;
      const before = state.sections[0]?.children.length ?? 0;
      if (sectionId) addBlockAt("text", 0, sectionId);
      await wait(1300);
      const draftsAfterEdit = await zephus.listDrafts();
      const hasPageDraft =
        draftsAfterEdit.ok &&
        draftsAfterEdit.entries.some(
          (entry) =>
            entry.projectPath === realProjectPath && entry.scope === "page",
        );
      assert(
        hasPageDraft,
        "Editor smoke: no recovery draft after an unsaved edit.",
      );

      // Save: draft must clear and the file on disk must reflect the edit.

      const saved = await performSave();
      const saveStatus =
        document.getElementById("status-bar")?.textContent ?? "";
      assert(
        saved,
        `Editor smoke: performSave failed (status="${saveStatus}" page=${state.page} project=${state.project?.path})`,
      );
      assert(
        !state.pageDirty,
        "Editor smoke: page still dirty after a successful save.",
      );
      await wait(400);
      const draftsAfterSave = await zephus.listDrafts();
      const pageDraftGone =
        !draftsAfterSave.ok ||
        !draftsAfterSave.entries.some(
          (entry) =>
            entry.projectPath === realProjectPath && entry.scope === "page",
        );
      assert(pageDraftGone, "Editor smoke: recovery draft survived a save.");
      if (page) {
        const onDisk = await zephus.readFile(realProjectPath, page);
        assert(
          onDisk.ok && (onDisk.content ?? "").length > 0,
          "Editor smoke: saved page file is empty or unreadable.",
        );
      }

      // Publish: the real Astro build must succeed and open the result modal.

      await publishSite();

      let built = false;
      for (let i = 0; i < 90; i += 1) {
        await wait(500);
        const title = document.getElementById("modal-title");
        if (title && /Built/i.test(title.textContent || "")) {
          built = true;
          break;
        }
      }
      assert(built, "Editor smoke: publish build did not complete.");
      await closeAnyModal();
      assert(
        (state.sections[0]?.children.length ?? 0) === before + 1,
        "Editor smoke: the added block was lost across save/publish.",
      );

      // Git: the scaffolded project is a repo (createSite inits it) — commit
      // the saved changes and verify the commit lands.

      const committed = await zephus.commitGitChanges(
        realProjectPath,
        "smoke commit",
      );
      assert(
        committed.ok,
        `Editor smoke: git commit failed (${committed.error ?? "unknown"})`,
      );

      // App-owned detach writes must not be mistaken for an external edit. The
      // watcher marker suppresses the atomic write event; real external edits
      // are covered by the watcher integration tests above.
      if (page && state.project) {
        const detached = await zephus.detachPageDocument(
          state.project.path,
          page,
          state.project.astro.pagesDir,
          "<h1>Detached by smoke</h1>",
        );
        assert(
          detached.ok,
          `Editor smoke: detach failed (${detached.error ?? "unknown"})`,
        );
        await wait(650);
        const title = document.getElementById("modal-title")?.textContent ?? "";
        assert(
          !/Changed on Disk/i.test(title),
          "Editor smoke: app-owned detach surfaced a false reload prompt.",
        );
      }

      await closeProject();

      assert(state.project === null, "Editor smoke: project did not close.");
    }

    return failures;
  };
}
