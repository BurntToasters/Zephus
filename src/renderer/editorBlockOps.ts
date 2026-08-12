/**
 * Page-structure operations: block/section add, move, duplicate, lock,
 * delete, wrap, and the in-app clipboard (copy/cut/paste). Extracted from
 * the engine — every page mutation outside the inspector flows through this
 * layer, so block-feature work lands here with one deps contract.
 */

import { renderInsertModal } from "./InsertModals";
import { renderSectionsMarkup } from "../shared/blockRender";
import {
  EditorClipboardPayload,
  isBlockTypeAllowed,
  isNodeLocked,
  lockedMutationMessage,
} from "./editorCommands";
import { PALETTE, TEMPLATES, type SectionTemplate } from "./editorBlocks";
import { isInspectorTextInputFocused } from "./editorInspector";
import type { EditorSessionState } from "./editorSession";
import { pushEditorUndo } from "./editorUndo";
import type {
  BlockNode,
  EditorBlock,
  EditorBlockType,
  SectionNode,
} from "../main/types";

type Block = EditorBlock;
type BlockType = EditorBlockType;

interface ReusableSection {
  id: string;
  label: string;
  html: string;
}

export interface BlockOpsDeps {
  getState: () => EditorSessionState;
  setStatus: (message: string) => void;
  closeModal: () => void;
  showModalNode: (
    title: string,
    content: HTMLElement,
    actions: Array<{
      label: string;
      kind?: "primary" | "danger" | "ghost";
      onClick: () => void;
    }>,
  ) => void;
  modalController: {
    confirmDestructive: (
      title: string,
      message: string,
      confirmLabel: string,
    ) => Promise<boolean>;
  };
  editorRules: {
    allowedBlocks: string[] | null;
  };
  appSettings: { confirmBlockDelete: boolean } | null;
  updateUndoRedoButtons: () => void;
  renderLayers: () => void;
  renderCanvas: () => void;
  renderProperties: () => void;
  syncBlocksFromSections: () => void;
  syncSelectionState: () => void;
  beginInspectorEdit: () => void;
  endInspectorEdit: () => void;
  scheduleCanvasRepaint: (debounce: boolean) => void;
  findSection: (id: string | null) => SectionNode | null;
  findBlockLocation: (id: string | null) => {
    section: SectionNode;
    sectionIndex: number;
    block: Block;
    blockIndex: number;
  } | null;
  findSelectedBlock: () => Block | null;
  activeSectionId: () => string | null;
  currentPageLabel: () => string;
  blockToHtml: (
    block: Block,
    viewport: "desktop" | "tablet" | "mobile",
    forCanvas?: boolean,
  ) => string;
  trackChange: (label: string) => void;
  markDirty: (dirty: boolean) => void;
  cloneBlock: (block: Block) => Block;
  cloneSections: (sections: SectionNode[]) => SectionNode[];
  ensureFallbackSection: () => SectionNode;
  defaultProps: (type: BlockType) => Record<string, string>;
  uid: () => string;
}

export function createBlockOpsActions(deps: BlockOpsDeps) {
  const {
    getState,
    setStatus,
    closeModal,
    showModalNode,
    modalController,
    editorRules,
    appSettings,
    updateUndoRedoButtons,
    renderLayers,
    renderCanvas,
    renderProperties,
    syncBlocksFromSections,
    syncSelectionState,
    beginInspectorEdit,
    endInspectorEdit,
    scheduleCanvasRepaint,
    findSection,
    findBlockLocation,
    findSelectedBlock,
    activeSectionId,
    currentPageLabel,
    blockToHtml,
    trackChange,
    markDirty,
    cloneBlock,
    cloneSections,
    ensureFallbackSection,
    defaultProps,
    uid,
  } = deps;

  const state = getState();

  let editorClipboard: EditorClipboardPayload | null = null;
  let skipDeleteConfirm = false;
  let reusableSectionsCache: ReusableSection[] = [];

  function pushUndo(): void {
    pushEditorUndo(state, updateUndoRedoButtons);
  }

  function blockLabel(block: Block): string {
    if (block.type === "html") return "HTML / structural content";
    return block.type.charAt(0).toUpperCase() + block.type.slice(1);
  }

  function commitBlockChange(summary: string): void {
    syncBlocksFromSections();
    syncSelectionState();
    trackChange(summary);
    markDirty(true);
    renderLayers();
    renderCanvas();
    renderProperties();
  }

  function commitInspectorChange(
    summary: string,
    rerenderProperties = false,
  ): void {
    beginInspectorEdit();
    syncBlocksFromSections();
    syncSelectionState();
    trackChange(summary);
    markDirty(true);
    const typing =
      !rerenderProperties &&
      isInspectorTextInputFocused(document.activeElement);
    scheduleCanvasRepaint(typing);
    if (rerenderProperties) {
      endInspectorEdit();
      renderProperties();
    }
  }

  function addSectionAt(index: number, template?: SectionTemplate): void {
    pushUndo();
    let children: BlockNode[] = [];
    if (template?.blocks) {
      children = template.blocks();
    } else if (template?.html) {
      children = [{ id: uid(), type: "html", props: {}, raw: template.html }];
    }
    const section: SectionNode = {
      id: uid(),
      type: "section",
      label: template ? template.label : `Section ${state.sections.length + 1}`,
      props: { wrapper: "box", cls: "" },
      children,
    };
    state.sections.splice(index, 0, section);
    state.selectedId = null;
    state.selectedSectionId = section.id;
    commitBlockChange(
      template ? `Added ${template.label} section` : "Added section",
    );
  }

  function addBlockAt(
    type: BlockType,
    index: number,
    sectionId?: string | null,
  ): void {
    if (!isBlockTypeAllowed(type, editorRules.allowedBlocks)) {
      setStatus(`Block type "${type}" is not allowed on this site.`);
      return;
    }
    let targetSection =
      findSection(sectionId ?? activeSectionId()) ?? state.sections[0];
    if (!targetSection) {
      if (state.sections.length !== 0) return;
      // Capture the undo snapshot BEFORE creating the fallback section, so
      // undoing the first block returns to the truly empty page instead of
      // leaving a phantom empty section behind.
      pushUndo();
      state.sections.push(ensureFallbackSection());
      targetSection = state.sections[0];
    } else {
      // A blocked insertion must not leave a phantom undo entry (and must not
      // wipe the redo stack): validate the target first.
      if (!targetSection) return;
      if (isNodeLocked(targetSection)) {
        setStatus(lockedMutationMessage("target-section"));
        return;
      }
      pushUndo();
    }
    const block: Block =
      type === "html"
        ? {
            id: uid(),
            type,
            props: {},
            raw: "<section>\n  <p>Custom HTML</p>\n</section>",
          }
        : {
            id: uid(),
            type,
            props: defaultProps(type),
            style:
              type === "columns"
                ? { columns: "2", gap: "16px", stackOnMobile: true }
                : type === "gallery"
                  ? { columns: "3", gap: "12px" }
                  : undefined,
          };
    if (!targetSection) return;
    targetSection.children.splice(index, 0, block);
    state.selectedId = block.id;
    state.selectedSectionId = targetSection.id;
    commitBlockChange(`Added ${type} block`);
  }

  function duplicateSelectedBlock(block: Block): void {
    const location = findBlockLocation(block.id);
    if (!location) return;
    if (!isBlockTypeAllowed(block.type, editorRules.allowedBlocks)) {
      setStatus(`Block type "${block.type}" is not allowed on this site.`);
      return;
    }
    // Mirror the add/paste/drop guards: inserting INTO a locked section is
    // blocked ("unlock to add content there"). The duplicate previously
    // spliced the copy into the locked section unchecked.
    if (isNodeLocked(location.section)) {
      setStatus(lockedMutationMessage("target-section"));
      return;
    }
    pushUndo();
    const copy = cloneBlock(block);
    copy.id = uid();
    location.section.children.splice(location.blockIndex + 1, 0, copy);
    state.selectedId = copy.id;
    state.selectedSectionId = location.section.id;
    commitBlockChange(`Duplicated ${block.type} block`);
  }

  function moveBlock(block: Block, direction: -1 | 1): void {
    const location = findBlockLocation(block.id);
    if (!location) return;
    if (isNodeLocked(block)) {
      setStatus(lockedMutationMessage("block"));
      return;
    }
    const nextSection = state.sections[location.sectionIndex + direction];
    if (
      (location.blockIndex + direction < 0 ||
        location.blockIndex + direction >= location.section.children.length) &&
      isNodeLocked(nextSection)
    ) {
      setStatus(lockedMutationMessage("target-section"));
      return;
    }
    pushUndo();
    const siblings = location.section.children;
    const next = location.blockIndex + direction;
    let moved: Block | undefined;
    if (next >= 0 && next < siblings.length) {
      [moved] = siblings.splice(location.blockIndex, 1) as Block[];
      if (!moved) return;
      siblings.splice(next, 0, moved);
    } else {
      [moved] = siblings.splice(location.blockIndex, 1) as Block[];
      if (!moved || !nextSection) {
        if (moved) siblings.splice(location.blockIndex, 0, moved);
        return;
      }
      nextSection.children.splice(
        direction < 0 ? nextSection.children.length : 0,
        0,
        moved,
      );
      state.selectedSectionId = nextSection.id;
    }
    if (!moved) return;
    state.selectedId = moved.id;
    commitBlockChange(
      `Moved ${block.type} block ${direction < 0 ? "up" : "down"}`,
    );
  }

  function toggleBlockLock(block: Block): void {
    const location = findBlockLocation(block.id);
    if (!location) return;
    pushUndo();
    location.block.locked = !location.block.locked;
    commitBlockChange(
      `${location.block.locked ? "Locked" : "Unlocked"} ${block.type} block`,
    );
  }

  async function deleteBlock(block: Block): Promise<void> {
    if (isNodeLocked(block)) {
      setStatus(lockedMutationMessage("block"));
      return;
    }
    if (appSettings?.confirmBlockDelete && !skipDeleteConfirm) {
      const confirmed = await modalController.confirmDestructive(
        "Delete Block",
        `Delete this ${block.type} block from ${currentPageLabel()}?`,
        "Delete Block",
      );
      if (!confirmed) return;
    }
    const location = findBlockLocation(block.id);
    if (!location) return;
    pushUndo();
    location.section.children = location.section.children.filter(
      (item) => item.id !== block.id,
    );
    state.selectedId = null;
    state.selectedSectionId = location.section.id;
    commitBlockChange(`Deleted ${block.type} block`);
  }

  function wrapBlockInSection(block: Block): void {
    const location = findBlockLocation(block.id);
    if (!location) return;
    if (isNodeLocked(block)) {
      setStatus(lockedMutationMessage("block"));
      return;
    }
    pushUndo();
    const [moved] = location.section.children.splice(location.blockIndex, 1);
    if (!moved) return;
    const wrappedSection: SectionNode = {
      id: uid(),
      type: "section",
      label: `${blockLabel(block)} Section`,
      props: { wrapper: "box", cls: "zephus-wrap" },
      children: [moved],
    };
    state.sections.splice(location.sectionIndex + 1, 0, wrappedSection);
    state.selectedId = moved.id;
    state.selectedSectionId = wrappedSection.id;
    commitBlockChange(`Wrapped ${block.type} block in section`);
  }

  function moveSection(sectionId: string, direction: -1 | 1): void {
    const index = state.sections.findIndex(
      (section) => section.id === sectionId,
    );
    const next = index + direction;
    if (index < 0 || next < 0 || next >= state.sections.length) return;
    const section = state.sections[index];
    if (isNodeLocked(section)) {
      setStatus(lockedMutationMessage("section"));
      return;
    }
    pushUndo();
    const [moved] = state.sections.splice(index, 1);
    if (!moved) return;
    state.sections.splice(next, 0, moved);
    state.selectedSectionId = moved.id;
    commitBlockChange(`Moved section ${direction < 0 ? "up" : "down"}`);
  }

  function duplicateSection(sectionId: string): void {
    const index = state.sections.findIndex(
      (section) => section.id === sectionId,
    );
    const section = state.sections[index];
    if (!section) return;
    const disallowed = section.children.find(
      (block) => !isBlockTypeAllowed(block.type, editorRules.allowedBlocks),
    );
    if (disallowed) {
      setStatus(`Block type "${disallowed.type}" is not allowed on this site.`);
      return;
    }
    pushUndo();
    const copy = cloneSections([section])[0]!;
    copy.id = uid();
    copy.label = `${section.label} Copy`;
    copy.children = copy.children.map((child) => {
      const childCopy = cloneBlock(child);
      childCopy.id = uid();
      return childCopy;
    });
    state.sections.splice(index + 1, 0, copy);
    state.selectedSectionId = copy.id;
    state.selectedId = null;
    commitBlockChange(`Duplicated ${section.label}`);
  }

  function copySelectionToClipboard(): void {
    const block = findSelectedBlock();
    if (block) {
      editorClipboard = { kind: "block", block: cloneBlock(block) };
      void navigator.clipboard?.writeText(blockToHtml(block, "desktop")).then(
        () => setStatus("Copied block."),
        () => setStatus("Copied block (in-app only; clipboard unavailable)."),
      );
      return;
    }
    if (state.selectedSectionId && !state.selectedId) {
      const section = findSection(state.selectedSectionId);
      if (section) {
        editorClipboard = {
          kind: "section",
          section: cloneSections([section])[0]!,
        };
        // In-app paste (editorClipboard) always works; the OS clipboard write
        // is best-effort and its failure must not claim full success.
        const sectionCopy = cloneSections([section])[0]!;
        const html = renderSectionsMarkup([sectionCopy], (b) =>
          blockToHtml(b as Block, "desktop"),
        );
        void navigator.clipboard?.writeText(html).then(
          () => setStatus("Copied section."),
          () =>
            setStatus("Copied section (in-app only; clipboard unavailable)."),
        );
        return;
      }
    }
    setStatus("Select a block or section to copy.");
  }

  async function cutSelectionToClipboard(): Promise<void> {
    const block = findSelectedBlock();
    if (block) {
      if (isNodeLocked(block)) {
        setStatus(lockedMutationMessage("block"));
        return;
      }
      copySelectionToClipboard();
      skipDeleteConfirm = true;
      try {
        await deleteBlock(block);
      } finally {
        skipDeleteConfirm = false;
      }
      return;
    }
    if (state.selectedSectionId && !state.selectedId) {
      const section = findSection(state.selectedSectionId);
      if (!section) return;
      if (isNodeLocked(section)) {
        setStatus(lockedMutationMessage("section"));
        return;
      }
      copySelectionToClipboard();
      skipDeleteConfirm = true;
      try {
        await deleteSection(state.selectedSectionId);
      } finally {
        skipDeleteConfirm = false;
      }
    }
  }

  function pasteFromClipboard(): void {
    if (!editorClipboard) {
      setStatus("Clipboard is empty. Copy a block or section first.");
      return;
    }
    if (editorClipboard.kind === "block") {
      const source = editorClipboard.block;
      if (!isBlockTypeAllowed(source.type, editorRules.allowedBlocks)) {
        setStatus(`Block type "${source.type}" is not allowed on this site.`);
        return;
      }
      const location = findBlockLocation(state.selectedId);
      const targetSection =
        location?.section ??
        findSection(activeSectionId()) ??
        state.sections[0];
      if (!targetSection) return;
      if (isNodeLocked(targetSection)) {
        setStatus(lockedMutationMessage("target-section"));
        return;
      }
      pushUndo();
      const copy = cloneBlock(source as Block);
      copy.id = uid();
      if (location) {
        location.section.children.splice(location.blockIndex + 1, 0, copy);
        state.selectedId = copy.id;
        state.selectedSectionId = location.section.id;
      } else {
        targetSection.children.push(copy);
        state.selectedId = copy.id;
        state.selectedSectionId = targetSection.id;
      }
      commitBlockChange(`Pasted ${source.type} block`);
      return;
    }
    const sourceSection = editorClipboard.section;
    const disallowed = sourceSection.children.find(
      (block) => !isBlockTypeAllowed(block.type, editorRules.allowedBlocks),
    );
    if (disallowed) {
      setStatus(`Block type "${disallowed.type}" is not allowed on this site.`);
      return;
    }
    const index = state.selectedSectionId
      ? state.sections.findIndex(
          (section) => section.id === state.selectedSectionId,
        )
      : state.sections.length - 1;
    pushUndo();
    const copy = cloneSections([sourceSection])[0]!;
    copy.id = uid();
    copy.children = copy.children.map((child) => {
      const childCopy = cloneBlock(child);
      childCopy.id = uid();
      return childCopy;
    });
    state.sections.splice(Math.max(0, index) + 1, 0, copy);
    state.selectedSectionId = copy.id;
    state.selectedId = null;
    commitBlockChange(`Pasted ${sourceSection.label}`);
  }

  function toggleSectionLock(sectionId: string): void {
    const section = findSection(sectionId);
    if (!section) return;
    pushUndo();
    section.locked = !section.locked;
    commitBlockChange(
      `${section.locked ? "Locked" : "Unlocked"} ${section.label}`,
    );
  }

  async function deleteSection(sectionId: string): Promise<void> {
    const section = findSection(sectionId);
    if (!section) return;
    if (isNodeLocked(section)) {
      setStatus(lockedMutationMessage("section"));
      return;
    }
    if (appSettings?.confirmBlockDelete && !skipDeleteConfirm) {
      const confirmed = await modalController.confirmDestructive(
        "Delete Section",
        `Delete section "${section.label}" from ${currentPageLabel()}?`,
        "Delete Section",
      );
      if (!confirmed) return;
    }
    pushUndo();
    state.sections = state.sections.filter((entry) => entry.id !== sectionId);
    state.selectedId = null;
    state.selectedSectionId = state.sections[0]?.id ?? null;
    commitBlockChange(`Deleted ${section.label}`);
  }

  function openBlockInsertModal(index: number, sectionId: string): void {
    const section = findSection(sectionId);
    if (isNodeLocked(section)) {
      setStatus(lockedMutationMessage("target-section"));
      return;
    }
    const wrap = document.createElement("div");
    renderInsertModal(
      wrap,
      PALETTE.filter((item) => {
        const allowed = editorRules.allowedBlocks;
        return !allowed || allowed.includes(item.type);
      }).map((item) => ({
        label: item.label,
        onSelect: () => {
          closeModal();
          addBlockAt(item.type, index, sectionId);
        },
      })),
    );
    showModalNode("Add Block", wrap, [
      { label: "Close", kind: "ghost", onClick: closeModal },
    ]);
  }

  function openSectionInsertModal(index: number): void {
    const wrap = document.createElement("div");
    const options = [
      {
        label: "Blank Section",
        primary: true,
        onSelect: () => {
          closeModal();
          addSectionAt(index);
        },
      },
      ...TEMPLATES.filter(templateAllowed).map((template) => ({
        label: template.label,
        onSelect: () => {
          closeModal();
          addSectionAt(index, template);
        },
      })),
      ...reusableSectionsCache
        .map((saved) => {
          const tpl = resolveSavedSectionTemplate(saved.id);
          if (!tpl) return null;
          return {
            label: `${saved.label} (Saved)`,
            onSelect: () => {
              closeModal();
              addSectionAt(index, tpl);
            },
          };
        })
        .filter((option): option is NonNullable<typeof option> => !!option),
    ];
    renderInsertModal(wrap, options);

    showModalNode("Add Section", wrap, [
      { label: "Close", kind: "ghost", onClick: closeModal },
    ]);
  }

  /** A template is insertable only when EVERY block it contains is allowed
   *  (the palette and Add-Block modal filter per block, but the template/
   *  quick-insert paths inserted disallowed blocks wholesale, violating the
   *  repo's editorRules.allowedBlocks policy). */
  function templateAllowed(template: SectionTemplate): boolean {
    const allowed = editorRules.allowedBlocks;
    if (!allowed) return true;
    const blocks = template.blocks?.() ?? [];
    return blocks.every((block) => isBlockTypeAllowed(block.type, allowed));
  }

  /** Build an insertable template from a cached saved (HTML) reusable section. */
  function resolveSavedSectionTemplate(id: string): SectionTemplate | null {
    const saved = reusableSectionsCache.find((s) => s.id === id);
    if (!saved) return null;
    return { id: saved.id, label: saved.label, html: saved.html };
  }
  return {
    blockLabel,
    commitBlockChange,
    commitInspectorChange,
    addSectionAt,
    addBlockAt,
    duplicateSelectedBlock,
    moveBlock,
    toggleBlockLock,
    deleteBlock,
    wrapBlockInSection,
    moveSection,
    duplicateSection,
    copySelectionToClipboard,
    cutSelectionToClipboard,
    pasteFromClipboard,
    toggleSectionLock,
    deleteSection,
    openBlockInsertModal,
    openSectionInsertModal,
    templateAllowed,
    resolveSavedSectionTemplate,
    setReusableSections: (sections: ReusableSection[]): void => {
      reusableSectionsCache = sections;
    },
    clearClipboard: (): void => {
      editorClipboard = null;
    },
  };
}
