/** Editor smoke harness (--smoke / ?smoke=1). */

import { EditorView } from "@codemirror/view";
import type { EditorSessionState } from "./editorSession";
import type { EditorBlock, SectionNode } from "../main/types";
import { renderPublishSuccessModalBody } from "./MiscModals";

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
  loadPage: (page: string) => Promise<void>;
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
    loadPage,
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
    // Synthetic shortcuts must not try to clear drafts for the deliberately
    // unapproved /smoke-project placeholder. Real draft IPC is exercised below.
    state.siteDirty = true;
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
    const focusCanvas = (): void => {
      // Model the real shortcut path: after leaving an inspector field, focus
      // returns to the canvas. A detached input can otherwise remain Chromium's
      // activeElement briefly and the editable-focus guard correctly ignores
      // the synthetic document-level shortcut.
      $("canvas").focus();
    };
    const redoKeys = (): void => {
      focusCanvas();
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "z",
          ctrlKey: true,
          shiftKey: true,
        }),
      );
    };
    let lastUndoPrevented = false;
    const undoKey = (): void => {
      focusCanvas();
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "z",
        ctrlKey: true,
      });
      document.dispatchEvent(event);
      lastUndoPrevented = event.defaultPrevented;
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
      // Electron smoke windows are not guaranteed to be OS-focused; Chromium
      // can update activeElement without delivering the native blur callback.
      // Dispatch the event explicitly so this harness exercises the same
      // inspector commit path as a real focus transition.
      freshInput.dispatchEvent(new FocusEvent("blur"));
      const afterBlur = section.children[0]?.props["text"];
      assert(
        afterBlur === "Undo Me",
        `Editor smoke: inspector blur did not commit (afterInput=${JSON.stringify(afterInput)} afterBlur=${JSON.stringify(afterBlur)} attached=${document.contains(freshInput)} direct=${directFired} selected=${state.selectedId} dirty=${state.pageDirty})`,
      );
      undoKey();
      assert(
        findBlockLocation("smoke-heading")?.block.props["text"] !== "Undo Me",
        `Editor smoke: Ctrl+Z did not revert the inspector edit (undo=${state.undo.length} redo=${state.redo.length} prevented=${lastUndoPrevented} active=${(document.activeElement as HTMLElement | null)?.id || (document.activeElement as HTMLElement | null)?.tagName || "none"} mode=${state.mode} modalHidden=${document.getElementById("modal-overlay")?.classList.contains("hidden")}).`,
      );
      redoKeys();
      assert(
        findBlockLocation("smoke-heading")?.block.props["text"] === "Undo Me",
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

    // Arrow-key traversal: selection and DOM focus follow the flat block order
    // (across sections), Home/End jump to the page edges, Escape deselects.
    const blockShellsInOrder = (): HTMLElement[] =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          "#canvas > .canvas-section > .section-body > .block",
        ),
      );
    const flatBlockIds = (): string[] =>
      state.sections.flatMap((entry) =>
        entry.children.map((child) => child.id),
      );
    const activeBlockId = (): string | null => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return null;
      const index = blockShellsInOrder().indexOf(active);
      return index >= 0 ? (flatBlockIds()[index] ?? null) : null;
    };
    const pressBlockKey = (shell: HTMLElement, key: string): boolean => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
      });
      shell.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const shells = blockShellsInOrder();
    const headingShell = shells[0];
    const buttonShell = shells[1];
    assert(
      !!headingShell && !!buttonShell,
      `Editor smoke: block shells missing for keyboard traversal (shells=${shells.length}).`,
    );
    if (headingShell && buttonShell) {
      headingShell.focus();
      assert(
        pressBlockKey(headingShell, "ArrowDown"),
        "Editor smoke: ArrowDown on a block was not handled.",
      );
      assert(
        state.selectedId === "smoke-button",
        `Editor smoke: ArrowDown did not select the next block (selected=${state.selectedId}).`,
      );
      assert(
        activeBlockId() === "smoke-button",
        `Editor smoke: ArrowDown did not move DOM focus (focused=${activeBlockId()}).`,
      );
      pressBlockKey(buttonShell, "ArrowDown");
      assert(
        state.selectedId === "smoke-button" &&
          activeBlockId() === "smoke-button",
        `Editor smoke: ArrowDown on the last block did not stay put (selected=${state.selectedId} focused=${activeBlockId()}).`,
      );
      pressBlockKey(buttonShell, "ArrowUp");
      assert(
        state.selectedId === "smoke-heading" &&
          activeBlockId() === "smoke-heading",
        `Editor smoke: ArrowUp did not return to the previous block (selected=${state.selectedId} focused=${activeBlockId()}).`,
      );
      pressBlockKey(headingShell, "End");
      assert(
        state.selectedId === "smoke-button" &&
          activeBlockId() === "smoke-button",
        `Editor smoke: End did not select the last block (selected=${state.selectedId} focused=${activeBlockId()}).`,
      );
      pressBlockKey(buttonShell, "Home");
      assert(
        state.selectedId === "smoke-heading" &&
          activeBlockId() === "smoke-heading",
        `Editor smoke: Home did not select the first block (selected=${state.selectedId} focused=${activeBlockId()}).`,
      );
      pressBlockKey(headingShell, "Escape");
      assert(
        state.selectedId === null && state.selectedSectionId === null,
        `Editor smoke: Escape did not clear the selection (block=${state.selectedId} section=${state.selectedSectionId}).`,
      );
      assert(
        !document.querySelector(".block.selected") &&
          !document.querySelector(".canvas-section.selected"),
        "Editor smoke: Escape did not clear the rendered canvas selection.",
      );
    }

    // The document-level Escape path must clear a click selection too.
    state.selectedId = "smoke-heading";
    state.selectedSectionId = section.id;
    renderCanvas();
    renderProperties();
    $("canvas").focus();
    const escapeEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    document.dispatchEvent(escapeEvent);
    assert(
      state.selectedId === null && state.selectedSectionId === null,
      `Editor smoke: document Escape did not clear the selection (block=${state.selectedId} section=${state.selectedSectionId}).`,
    );
    assert(
      escapeEvent.defaultPrevented,
      "Editor smoke: document Escape was not handled.",
    );

    // Delete on a locked block must keep the block and say why.
    const headingBlock = findBlockLocation("smoke-heading")?.block;
    if (headingBlock) {
      headingBlock.locked = true;
      state.selectedId = "smoke-heading";
      state.selectedSectionId = section.id;
      renderCanvas();
      renderProperties();
      const lockedDelete = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Delete",
      });
      document.dispatchEvent(lockedDelete);
      assert(
        state.sections[0]?.children.length === 2 &&
          state.sections[0]?.children[0]?.id === "smoke-heading",
        "Editor smoke: Delete removed a locked block.",
      );
      assert(
        (document.getElementById("status-bar")?.textContent ?? "").includes(
          "locked",
        ),
        `Editor smoke: Delete on a locked block did not set a status (status="${document.getElementById("status-bar")?.textContent ?? ""}").`,
      );
      assert(
        !lockedDelete.defaultPrevented,
        "Editor smoke: Delete on a locked block changed preventDefault behavior.",
      );
      headingBlock.locked = false;
      renderCanvas();
      renderProperties();
    }

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

      const indexPage = state.project?.pages.find((candidate) =>
        /(?:^|\/)index\.astro$/.test(candidate),
      );
      if (indexPage && state.page !== indexPage) {
        await loadPage(indexPage);
        await wait(400);
      }

      const page = state.page;
      assert(!!page, "Editor smoke: no page loaded after project open.");
      assert(
        /Zephus/.test(document.title) && document.title !== "Zephus",
        `Editor smoke: window title did not pick up the project context (title="${document.title}")`,
      );

      // ARIA radiogroups: Arrow/Home/End must move selection and keep exactly
      // one roving tab stop. Run these before edit/save/publish so a broken
      // keyboard path cannot hide behind later smoke steps.
      const pressRadioKey = (element: HTMLElement, key: string): void => {
        element.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key,
          }),
        );
      };
      const ariaChecked = (id: string): string =>
        $(id).getAttribute("aria-checked") ?? "";
      const radioTabIndex = (id: string): number => $(id).tabIndex;
      // Read through a call so TypeScript does not keep the earlier
      // `state.currentViewport = "desktop"` assignment's literal narrowing.
      const currentViewport = (): string => state.currentViewport;

      $("vp-desktop").focus();
      pressRadioKey($("vp-desktop"), "ArrowRight");
      const canvasWrap = document.querySelector<HTMLElement>(".canvas-wrap");
      assert(
        currentViewport() === "tablet",
        `Editor smoke: viewport ArrowRight did not select tablet (viewport=${currentViewport()}).`,
      );
      assert(
        ariaChecked("vp-tablet") === "true" &&
          ariaChecked("vp-desktop") === "false",
        `Editor smoke: viewport ArrowRight aria-checked wrong (desktop=${ariaChecked("vp-desktop")} tablet=${ariaChecked("vp-tablet")}).`,
      );
      assert(
        radioTabIndex("vp-tablet") === 0 &&
          radioTabIndex("vp-desktop") === -1 &&
          radioTabIndex("vp-mobile") === -1,
        `Editor smoke: viewport ArrowRight roving tabindex wrong (desktop=${radioTabIndex("vp-desktop")} tablet=${radioTabIndex("vp-tablet")} mobile=${radioTabIndex("vp-mobile")}).`,
      );
      assert(
        !!canvasWrap?.classList.contains("vp-tablet"),
        `Editor smoke: canvas wrap missing vp-tablet after ArrowRight (class="${canvasWrap?.className ?? "missing"}").`,
      );

      pressRadioKey($("vp-tablet"), "End");
      assert(
        currentViewport() === "mobile" &&
          ariaChecked("vp-mobile") === "true" &&
          radioTabIndex("vp-mobile") === 0,
        `Editor smoke: viewport End did not select mobile (viewport=${currentViewport()} checked=${ariaChecked("vp-mobile")} tabindex=${radioTabIndex("vp-mobile")}).`,
      );

      pressRadioKey($("vp-mobile"), "Home");
      assert(
        currentViewport() === "desktop" &&
          ariaChecked("vp-desktop") === "true" &&
          radioTabIndex("vp-desktop") === 0 &&
          radioTabIndex("vp-mobile") === -1,
        `Editor smoke: viewport Home did not select desktop (viewport=${currentViewport()} checked=${ariaChecked("vp-desktop")} tabindex=${radioTabIndex("vp-desktop")} mobileTabindex=${radioTabIndex("vp-mobile")}).`,
      );

      $("mode-visual").focus();
      pressRadioKey($("mode-visual"), "ArrowRight");
      const codeEditor = $("code-editor");
      const visualCanvas = $("canvas");
      assert(
        state.mode === "code",
        `Editor smoke: mode ArrowRight did not switch to code (mode=${state.mode}).`,
      );
      assert(
        ariaChecked("mode-code") === "true" &&
          ariaChecked("mode-visual") === "false",
        `Editor smoke: mode ArrowRight aria-checked wrong (visual=${ariaChecked("mode-visual")} code=${ariaChecked("mode-code")}).`,
      );
      assert(
        !codeEditor.classList.contains("hidden") &&
          codeEditor.getClientRects().length > 0,
        `Editor smoke: code editor not visible after mode ArrowRight (hidden=${codeEditor.classList.contains("hidden")} rects=${codeEditor.getClientRects().length}).`,
      );
      assert(
        radioTabIndex("mode-code") === 0 && radioTabIndex("mode-visual") === -1,
        `Editor smoke: mode ArrowRight roving tabindex wrong (visual=${radioTabIndex("mode-visual")} code=${radioTabIndex("mode-code")}).`,
      );

      // CodeMirror names its contenteditable so screen readers announce the
      // page source, and its documented tab-focus toggle must genuinely release
      // Tab from indentation. Synthetic keydowns need Chromium's legacy keyCode
      // for CodeMirror's tab-focus check, so the helper pins it per key.
      const cmContent = codeEditor.querySelector<HTMLElement>(".cm-content");
      assert(
        !!cmContent && cmContent.isContentEditable,
        "Editor smoke: CodeMirror contenteditable missing after switching to code.",
      );
      if (cmContent) {
        assert(
          cmContent.getAttribute("aria-label") === "Page source code",
          `Editor smoke: CodeMirror contenteditable is unnamed (aria-label=${JSON.stringify(cmContent.getAttribute("aria-label"))} role=${JSON.stringify(cmContent.getAttribute("role"))}).`,
        );
        assert(
          cmContent.getAttribute("spellcheck") === "false" &&
            cmContent.getAttribute("autocorrect") === "off" &&
            cmContent.getAttribute("autocapitalize") === "off",
          `Editor smoke: CodeMirror source-editing attributes wrong (spellcheck=${JSON.stringify(cmContent.getAttribute("spellcheck"))} autocorrect=${JSON.stringify(cmContent.getAttribute("autocorrect"))} autocapitalize=${JSON.stringify(cmContent.getAttribute("autocapitalize"))}).`,
        );

        const cmView = EditorView.findFromDOM(codeEditor);
        assert(
          !!cmView,
          "Editor smoke: CodeMirror view not found from the editor DOM.",
        );
        if (cmView) {
          const pressCodeKey = (
            init: KeyboardEventInit,
            keyCode?: number,
          ): boolean => {
            const event = new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              ...init,
            });
            if (keyCode !== undefined) {
              Object.defineProperty(event, "keyCode", { value: keyCode });
            }
            cmContent.dispatchEvent(event);
            return event.defaultPrevented;
          };
          const mac = /Mac/.test(navigator.platform);
          const mod = mac ? { metaKey: true } : { ctrlKey: true };
          const toggleTabFocus = mac
            ? { key: "m", shiftKey: true, altKey: true }
            : { key: "m", ctrlKey: true };
          const sourceBeforeTab = cmView.state.doc.toString();

          assert(
            pressCodeKey({ key: "Tab" }, 9),
            "Editor smoke: Tab was not captured for code indentation.",
          );
          assert(
            cmView.state.doc.toString() !== sourceBeforeTab,
            "Editor smoke: Tab did not indent the page source.",
          );
          pressCodeKey({ key: "z", ...mod }, 90);
          assert(
            cmView.state.doc.toString() === sourceBeforeTab,
            "Editor smoke: undo did not restore the source after the Tab test.",
          );

          assert(
            pressCodeKey(toggleTabFocus, 77),
            `Editor smoke: documented tab-focus toggle (${mac ? "Shift+Alt+M" : "Ctrl+M"}) was not handled.`,
          );
          assert(
            !pressCodeKey({ key: "Tab" }, 9),
            "Editor smoke: Tab remained captured after enabling tab-focus mode.",
          );
          assert(
            pressCodeKey(toggleTabFocus, 77),
            "Editor smoke: tab-focus mode could not be toggled back off.",
          );
          assert(
            pressCodeKey({ key: "Tab" }, 9),
            "Editor smoke: Tab was not captured again after restoring tab-focus mode.",
          );
          pressCodeKey({ key: "z", ...mod }, 90);
          assert(
            cmView.state.doc.toString() === sourceBeforeTab,
            "Editor smoke: tab-focus test left the page source modified.",
          );
        }
      }

      pressRadioKey($("mode-code"), "ArrowLeft");
      assert(
        state.mode === "visual",
        `Editor smoke: mode ArrowLeft did not switch back to visual (mode=${state.mode}).`,
      );
      assert(
        !visualCanvas.classList.contains("hidden") &&
          visualCanvas.getClientRects().length > 0,
        `Editor smoke: visual canvas not visible after mode ArrowLeft (hidden=${visualCanvas.classList.contains("hidden")} rects=${visualCanvas.getClientRects().length}).`,
      );
      assert(
        ariaChecked("mode-visual") === "true" &&
          ariaChecked("mode-code") === "false" &&
          radioTabIndex("mode-visual") === 0 &&
          radioTabIndex("mode-code") === -1,
        `Editor smoke: mode ArrowLeft did not sync radios (visual=${ariaChecked("mode-visual")}/${radioTabIndex("mode-visual")} code=${ariaChecked("mode-code")}/${radioTabIndex("mode-code")}).`,
      );
      assert(
        state.mode === "visual" && currentViewport() === "desktop",
        `Editor smoke: keyboard checks did not leave visual/desktop state (mode=${state.mode} viewport=${currentViewport()}).`,
      );

      // Recovery draft: an unsaved edit must surface a page draft after the
      // debounce window.
      const sectionId = state.sections[0]?.id ?? null;
      const before = state.sections[0]?.children.length ?? 0;
      const smokeMarker = "ZEPHUS_SMOKE_BLOCK";
      if (sectionId) {
        addBlockAt("text", 0, sectionId);
        const added = state.sections[0]?.children[0];
        if (added && added.type === "text") {
          added.props["text"] = smokeMarker;
        }
        markPageDirty(state, true);
      }
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
          onDisk.ok && (onDisk.content ?? "").includes(smokeMarker),
          "Editor smoke: saved page file missing ZEPHUS_SMOKE_BLOCK marker.",
        );
      }

      // Publish-success copy must match the real reveal result: render both
      // states into a throwaway detached container (never the live modal).
      try {
        const copyFor = (revealed: boolean): string => {
          const host = document.createElement("div");
          const dispose = renderPublishSuccessModalBody(host, {
            outputDir: "dist",
            revealed,
          });
          try {
            return (host.textContent ?? "").replace(/\s+/g, " ").trim();
          } finally {
            dispose();
            host.remove();
          }
        };
        const revealedCopy = copyFor(true);
        const failedCopy = copyFor(false);
        assert(
          /opened in your file manager/i.test(revealedCopy),
          `Editor smoke: publish-success copy omitted the reveal confirmation ("${revealedCopy}").`,
        );
        assert(
          !/opened in your file manager/i.test(failedCopy),
          `Editor smoke: publish-success copy claimed a failed reveal was open ("${failedCopy}").`,
        );
        assert(
          /open output folder/i.test(failedCopy),
          `Editor smoke: publish-success copy did not point at Open Output Folder ("${failedCopy}").`,
        );
        assert(
          revealedCopy !== failedCopy,
          "Editor smoke: publish-success copy ignored the reveal result.",
        );
      } catch (error) {
        assert(
          false,
          `Editor smoke: publish-success copy check crashed (${error instanceof Error ? error.message : String(error)}).`,
        );
      }

      // Publish: the real Astro build must succeed and open the result modal.

      await publishSite();

      let built = false;
      let publishModalTitle = "";
      for (let i = 0; i < 90; i += 1) {
        await wait(500);
        const title = document.getElementById("modal-title");
        publishModalTitle = title?.textContent ?? "";
        if (title && /Built/i.test(title.textContent || "")) {
          built = true;
          break;
        }
      }
      assert(
        built,
        `Editor smoke: publish build did not complete (modal="${publishModalTitle}" log="${($("dev-log").textContent ?? "").slice(-1200)}").`,
      );
      await closeAnyModal();
      assert(
        (state.sections[0]?.children.length ?? 0) === before + 1,
        "Editor smoke: the added block was lost across save/publish.",
      );

      let distHasMarker = false;
      for (const rel of [
        "dist/index.html",
        "dist/index/index.html",
        "dist/0/index.html",
      ]) {
        const builtFile = await zephus.readFile(realProjectPath, rel);
        if (builtFile.ok && (builtFile.content ?? "").includes(smokeMarker)) {
          distHasMarker = true;
          break;
        }
      }
      assert(
        distHasMarker,
        "Editor smoke: built HTML under dist/ missing ZEPHUS_SMOKE_BLOCK.",
      );

      if (page) {
        const diskOnly = "<!-- ZEPHUS_DISK_ONLY -->";
        const currentOnDisk = await zephus.readFile(realProjectPath, page);
        const nextContents = currentOnDisk.ok
          ? `${currentOnDisk.content ?? ""}\n${diskOnly}\n`
          : "";
        const external = await zephus.smokeExternalWrite(
          realProjectPath,
          page,
          nextContents,
        );
        assert(
          external.ok,
          `Editor smoke: smokeExternalWrite failed (${external.error ?? "unknown"})`,
        );
        let sawDiskPrompt = false;
        for (let i = 0; i < 40; i += 1) {
          await wait(250);
          const title =
            document.getElementById("modal-title")?.textContent ?? "";
          if (/Changed on Disk/i.test(title)) {
            sawDiskPrompt = true;
            break;
          }
        }
        assert(
          sawDiskPrompt,
          "Editor smoke: external disk edit did not surface Changed on Disk.",
        );
        const reloadBtn = Array.from(
          document.querySelectorAll("#modal-actions button"),
        ).find((button) => /^reload$/i.test(button.textContent?.trim() ?? ""));
        if (reloadBtn instanceof HTMLButtonElement) {
          reloadBtn.click();
          for (let i = 0; i < 40; i += 1) {
            await wait(250);
            const overlay = document.getElementById("modal-overlay");
            if (overlay?.classList.contains("hidden")) break;
          }
          setMode("code");
          await wait(400);
          const reloaded = getState().rawCode.includes(diskOnly);
          assert(
            reloaded,
            "Editor smoke: Reload did not show ZEPHUS_DISK_ONLY in the code buffer.",
          );
        } else {
          failures.push(
            "Editor smoke: Reload button missing after external disk change.",
          );
        }
      }

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
        const overlay = document.getElementById("modal-overlay");
        const modalVisible = !!overlay && !overlay.classList.contains("hidden");
        const title = document.getElementById("modal-title")?.textContent ?? "";
        assert(
          !(modalVisible && /Changed on Disk/i.test(title)),
          "Editor smoke: app-owned detach surfaced a false reload prompt.",
        );
      }

      await closeProject();

      assert(state.project === null, "Editor smoke: project did not close.");
    }

    return failures;
  };
}
