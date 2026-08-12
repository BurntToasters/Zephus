/**
 * Canvas rendering + drag/drop + the properties (inspector) panel. Extracted
 * from the engine so the ~500 lines and their module state (drag slots, drop
 * indicator, double-click tracking, inspector selection key) live in one
 * place with an explicit deps contract.
 */

import { updateCanvas } from "./CanvasView";
import { renderBlockProperties } from "./BlockProperties";
import { renderSectionProperties } from "./SectionProperties";
import {
  KNOWN_BLOCK_TYPES,
  TEMPLATES,
  TEXT_EDITABLE,
  type SectionTemplate,
} from "./editorBlocks";
import type { EditorSessionState } from "./editorSession";
import type {
  BlockNode,
  BlockStyle,
  EditorBlock,
  EditorBlockType,
  SectionNode,
} from "../main/types";

type Block = EditorBlock;
type BlockType = EditorBlockType;

export interface CanvasDeps {
  getState: () => EditorSessionState;
  $: (id: string) => HTMLElement;
  setStatus: (message: string) => void;
  renderLayers: () => void;
  currentPageLabel: () => string;
  blockLabel: (block: Block) => string;
  activeSectionId: () => string | null;
  findSection: (id: string | null) => SectionNode | null;
  findSelectedBlock: () => Block | null;
  findBlockLocation: (
    id: string,
  ) => { section: SectionNode; block: Block; blockIndex: number } | null;
  isNodeLocked: (node: BlockNode | Block | SectionNode | undefined) => boolean;
  lockedMutationMessage: (
    kind: "section" | "block" | "target-section",
  ) => string;
  pushUndo: () => void;
  pushUndoForControlChange: () => void;
  commitBlockChange: (summary: string) => void;
  commitInspectorChange: (
    summary: string,
    rerenderProperties?: boolean,
  ) => void;
  beginInspectorEdit: () => void;
  endInspectorEdit: () => void;
  templateAllowed: (template: SectionTemplate) => boolean;
  addSectionAt: (index: number, template?: SectionTemplate) => void;
  addBlockAt: (
    type: BlockType,
    index: number,
    sectionId?: string | null,
  ) => void;
  resolveSavedSectionTemplate: (id: string) => SectionTemplate | null;
  applyDesignPreview: () => void;
  editorRules: { maxHeadingLevel: number };
  activateWorkspaceTab: (side: "left" | "right", tab: string) => void;
  renderPropertiesEmpty: (
    panel: HTMLElement,
    hasPage: boolean,
    onMeta: () => void,
  ) => void;
  openPageMetaModal: (page: string) => Promise<void>;
  openBlockInsertModal: (index: number, sectionId: string) => void;
  duplicateSection: (id: string) => void;
  moveSection: (id: string, direction: -1 | 1) => void;
  toggleSectionLock: (id: string) => void;
  deleteSection: (id: string) => Promise<void>;
  duplicateSelectedBlock: (block: Block) => void;
  moveBlock: (block: Block, direction: -1 | 1) => void;
  wrapBlockInSection: (block: Block) => void;
  toggleBlockLock: (block: Block) => void;
  deleteBlock: (block: Block) => Promise<void>;
  openLinkPicker: (current: string, onPick: (href: string) => void) => void;
  chooseAssetForImage: (block: Block) => Promise<void>;
  openAssetBrowser: (options: {
    filter?: "images" | "media" | "documents" | "other" | "all";
    title?: string;
    onSelect: (webPath: string) => void;
  }) => void;
  fetchAssetDataUrl: (webPath: string) => Promise<string | null>;
  renderTemplates: () => void;
  saveReusableSection: (
    projectPath: string,
    label: string,
    html: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  blockToHtml: (
    block: Block,
    viewport: "desktop" | "tablet" | "mobile",
    forCanvas?: boolean,
  ) => string;
  effectiveNodeStyle: (node: SectionNode | Block) => BlockStyle;
  isInlineEditing: () => boolean;
  finishInlineEdit: () => void;
  galleryImages: (block: Block) => string[];
  writeGallery: (block: Block, images: string[], alts: string[]) => void;
  modalController: {
    promptText: (
      title: string,
      opts?: {
        label?: string;
        placeholder?: string;
        value?: string;
        confirmLabel?: string;
        description?: string;
      },
    ) => Promise<string | null>;
  };
}

export function createCanvasActions(deps: CanvasDeps) {
  const {
    getState,
    $,
    setStatus,
    renderLayers,
    currentPageLabel,
    blockLabel,
    activeSectionId,
    findSection,
    findSelectedBlock,
    findBlockLocation,
    isNodeLocked,
    lockedMutationMessage,
    pushUndo,
    pushUndoForControlChange,
    commitBlockChange,
    commitInspectorChange,
    beginInspectorEdit,
    endInspectorEdit,
    templateAllowed,
    addSectionAt,
    addBlockAt,
    resolveSavedSectionTemplate,
    applyDesignPreview,
    editorRules,
    activateWorkspaceTab,
    renderPropertiesEmpty,
    openPageMetaModal,
    openBlockInsertModal,
    duplicateSection,
    moveSection,
    toggleSectionLock,
    deleteSection,
    duplicateSelectedBlock,
    moveBlock,
    wrapBlockInSection,
    toggleBlockLock,
    deleteBlock,
    openLinkPicker,
    chooseAssetForImage,
    openAssetBrowser,
    fetchAssetDataUrl,
    renderTemplates,
    saveReusableSection,
    blockToHtml,
    effectiveNodeStyle,
    isInlineEditing,
    finishInlineEdit,
    galleryImages,
    writeGallery,
    modalController,
  } = deps;

  const state = getState();

  // ---- Canvas drag/drop + click-tracking module state (see engine wiring
  // ---- for the section-shell callbacks that read/write these slots).

  let dropIndex = -1;
  let indicator: HTMLElement | null = null;
  let dropSectionId: string | null = null;
  let draggingSectionId: string | null = null;
  let sectionDropIndex = -1;

  function resetDropTargetState(): void {
    dropIndex = -1;
    dropSectionId = null;
    sectionDropIndex = -1;
    indicator?.remove();
    indicator = null;
  }

  function resetDragState(): void {
    resetDropTargetState();
    draggingSectionId = null;
  }

  let lastClickBlockId: string | null = null;
  let lastClickTime = 0;
  const DOUBLE_CLICK_MS = 400;

  // ---- Inspector selection tracking.

  let lastInspectorSelectionKey = "none";

  function renderCanvas(): void {
    // A canvas re-render while an inline text session is active REPLACES the
    // focused contenteditable node; blur never fires on the detached element,
    // leaving isInlineEditing stuck true — every canvas click then no-ops.
    // Finish the session before the repaint (drag of a block/section while
    // editing triggered this).
    if (isInlineEditing()) {
      finishInlineEdit();
    }
    const canvas = $("canvas");
    canvas.setAttribute("data-viewport", state.currentViewport);
    resetDragState();
    updateCanvas({
      sections: state.sections.map((section) => {
        // Canvas entries are immutable view snapshots. Session nodes are mutated
        // in place by editor commands, so passing those same object identities
        // through keyed reconciliation would hide nested lock/label changes from
        // Solid. Event handlers resolve snapshots back to live nodes by id.
        const sectionView: SectionNode = {
          ...section,
          children: [...section.children],
        };
        return {
          id: section.id,
          section: sectionView,
          selected: section.id === state.selectedSectionId && !state.selectedId,
          breadcrumb: `${currentPageLabel()} / section`,
          effectiveStyle: effectiveNodeStyle(section),
          // Hidden on the active viewport: still visible (marked) so it stays
          // selectable instead of disappearing entirely.
          hiddenOnViewport:
            section.style?.hideOn?.includes(state.currentViewport) ?? false,
          children: section.children.map((blockNode) => {
            const block = blockNode as Block;
            const blockView: Block = { ...block };
            return {
              id: block.id,
              block: blockView,
              label: blockLabel(block),
              breadcrumb: `${currentPageLabel()} / ${section.label} / ${block.type}`,
              html: blockToHtml(block, state.currentViewport, true),
              selected: block.id === state.selectedId,
              editableText: TEXT_EDITABLE.includes(block.type) && !block.locked,
              shellAriaLabel: `${blockLabel(block)} block${block.id === state.selectedId ? ", selected" : ""}`,
              htmlBlock: block.type === "html",
              effectiveStyle: effectiveNodeStyle(block),
              hiddenOnViewport:
                block.style?.hideOn?.includes(state.currentViewport) ?? false,
            };
          }),
        };
      }),
    });
    applyDesignPreview();

    canvas.ondragover = (e) => {
      e.preventDefault();
      // Section shells and their bodies own their own drag-over targeting.
      if ((e.target as Element | null)?.closest?.(".canvas-section")) return;
      if (state.sections.length === 0) {
        dropIndex = 0;
        dropSectionId = null;
      } else {
        // The pointer is over the empty canvas strip: default to appending to
        // the last section (blocks) or after all sections (sections) instead of
        // a stale first/last-hovered target.
        const last = state.sections[state.sections.length - 1]!;
        dropSectionId = last.id;
        dropIndex = last.children.length;
        sectionDropIndex = state.sections.length;
      }
    };
    canvas.ondragleave = (event) => {
      const nextTarget = event.relatedTarget;
      if (!(nextTarget instanceof Node) || !canvas.contains(nextTarget)) {
        resetDropTargetState();
      }
    };
    canvas.ondrop = (e) => handleDrop(e);
    canvas.onclick = () => {
      state.selectedId = null;
      state.selectedSectionId = null;
      renderLayers();
      renderCanvas();
      renderProperties();
    };
  }

  function showIndicator(
    canvas: HTMLElement,
    ref: HTMLElement,
    after: boolean,
  ): void {
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.className = "drop-indicator active";
    }
    if (after) ref.after(indicator);
    else canvas.insertBefore(indicator, ref);
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();

    try {
      const newType = e.dataTransfer?.getData("text/zephus-new");
      const moveBlockId = e.dataTransfer?.getData("text/zephus-move-block");
      const templateId = e.dataTransfer?.getData("text/zephus-template");
      const moveSectionId = e.dataTransfer?.getData("text/zephus-move-section");
      const targetSection =
        findSection(dropSectionId ?? activeSectionId()) ??
        state.sections[0] ??
        null;
      const target =
        dropIndex < 0 ? (targetSection?.children.length ?? 0) : dropIndex;

      if (moveSectionId) {
        const from = state.sections.findIndex(
          (section) => section.id === moveSectionId,
        );
        const moving = state.sections[from];
        if (isNodeLocked(moving)) {
          setStatus(lockedMutationMessage("section"));
          return;
        }
        if (from >= 0 && sectionDropIndex >= 0) {
          let to = sectionDropIndex;
          if (from < to) to -= 1;
          if (to !== from) {
            pushUndo();
            const [section] = state.sections.splice(from, 1);
            if (section) {
              state.sections.splice(to, 0, section);
              state.selectedSectionId = section.id;
              state.selectedId = null;
              commitBlockChange("Moved section");
            }
          }
        }
        return;
      }

      if (templateId) {
        const template =
          TEMPLATES.find((entry) => entry.id === templateId) ??
          resolveSavedSectionTemplate(templateId);
        if (!template) return;
        if (!templateAllowed(template)) {
          setStatus("This section contains blocks not allowed by site rules.");
          return;
        }
        // Honor the drop position: section shells/rails set sectionDropIndex
        // (whole-section payloads use section slots, not block slots). Fall
        // back to inserting after the section dropped onto, or append when
        // dropped on empty canvas space.
        const overSection = dropSectionId ? findSection(dropSectionId) : null;
        const insertAt =
          sectionDropIndex >= 0
            ? sectionDropIndex
            : overSection
              ? state.sections.indexOf(overSection) + 1
              : state.sections.length;
        addSectionAt(insertAt, template);
        return;
      }

      if (newType) {
        if (!KNOWN_BLOCK_TYPES.has(newType as BlockType)) return;
        addBlockAt(newType as BlockType, target, targetSection?.id);
        return;
      }

      if (moveBlockId) {
        const location = findBlockLocation(moveBlockId);
        if (!location || !targetSection) return;
        if (isNodeLocked(location.block)) {
          setStatus(lockedMutationMessage("block"));
          return;
        }
        if (isNodeLocked(targetSection)) {
          setStatus(lockedMutationMessage("target-section"));
          return;
        }
        const adjusted =
          location.section.id === targetSection.id &&
          location.blockIndex < target
            ? target - 1
            : target;
        if (
          location.section.id === targetSection.id &&
          adjusted === location.blockIndex
        ) {
          return;
        }

        pushUndo();
        const [moved] = location.section.children.splice(
          location.blockIndex,
          1,
        );
        if (!moved) return;
        targetSection.children.splice(adjusted, 0, moved);
        state.selectedId = moved.id;
        state.selectedSectionId = targetSection.id;
        commitBlockChange(`Reordered ${moved.type} block`);
      }
    } finally {
      resetDragState();
    }
  }

  function renderProperties(): void {
    const panel = $("properties");
    if (state.mode === "code") {
      lastInspectorSelectionKey = "none";
      renderPropertiesEmpty(panel, !!state.page, () => {
        if (state.page) void openPageMetaModal(state.page);
      });
      return;
    }
    const block = findSelectedBlock();
    const section =
      (block ? findBlockLocation(block.id)?.section : null) ??
      findSection(state.selectedSectionId);
    const selectionKey = block
      ? `block:${block.id}`
      : section
        ? `section:${section.id}`
        : "none";
    if (selectionKey !== lastInspectorSelectionKey && selectionKey !== "none") {
      activateWorkspaceTab("right", "inspect");
    }
    lastInspectorSelectionKey = selectionKey;
    panel.innerHTML = "";

    if (!block && !section) {
      renderPropertiesEmpty(panel, !!state.page, () => {
        if (state.page) void openPageMetaModal(state.page);
      });
      return;
    }

    if (!block && section) {
      const commitSection = (key: string, value: string) => {
        if (isNodeLocked(section)) {
          setStatus(lockedMutationMessage("section"));
          return;
        }
        pushUndoForControlChange();
        section.props[key] = value;
        if (key === "label") section.label = value || section.label;
        commitInspectorChange(`Updated ${section.label}`);
      };

      const commitSectionStyle = (
        key: keyof BlockStyle,
        value: string | boolean | string[],
      ) => {
        if (isNodeLocked(section)) {
          setStatus(lockedMutationMessage("section"));
          return;
        }
        pushUndoForControlChange();
        section.style = section.style ?? {};
        (section.style as Record<string, unknown>)[key] = value;
        commitInspectorChange(`Updated ${section.label} style`);
      };
      renderSectionProperties(panel, {
        sectionLabel: section.label,
        currentPageLabel: currentPageLabel(),
        wrapper: section.props["wrapper"] ?? "none",
        cssClass: section.props["cls"] ?? "",
        width: section.style?.width ?? "",
        height: section.style?.height ?? "",
        padding: section.style?.padding ?? "",
        margin: section.style?.margin ?? "",
        maxWidth: section.style?.maxWidth ?? "",
        gap: section.style?.gap ?? "",
        background: section.style?.background ?? "",
        color: section.style?.color ?? "",
        radius: section.style?.radius ?? "",
        hideOn: section.style?.hideOn,
        locked: !!section.locked,
        onFocus: beginInspectorEdit,
        onBlur: endInspectorEdit,
        onSectionLabelChange: (value) => {
          if (isNodeLocked(section)) {
            setStatus(lockedMutationMessage("section"));
            return;
          }
          pushUndoForControlChange();
          section.label = value.trim() || "Section";
          commitInspectorChange("Renamed section");
        },
        onWrapperChange: (value) => commitSection("wrapper", value),
        onCssClassChange: (value) => commitSection("cls", value),
        onWidthChange: (value) => commitSectionStyle("width", value),
        onHeightChange: (value) => commitSectionStyle("height", value),
        onPaddingChange: (value) => commitSectionStyle("padding", value),
        onMarginChange: (value) => commitSectionStyle("margin", value),
        onMaxWidthChange: (value) => commitSectionStyle("maxWidth", value),
        onGapChange: (value) => commitSectionStyle("gap", value),
        onBackgroundChange: (value) => commitSectionStyle("background", value),
        onColorChange: (value) => commitSectionStyle("color", value),
        onRadiusChange: (value) => commitSectionStyle("radius", value),
        onHideOnChange: (viewport, hidden) => {
          pushUndoForControlChange();
          section.style = section.style ?? {};
          const hideOn = section.style.hideOn ?? [];
          section.style.hideOn = hidden
            ? [...new Set([...hideOn, viewport])]
            : hideOn.filter((v) => v !== viewport);
          if (section.style.hideOn.length === 0) delete section.style.hideOn;
          // commitInspectorChange already repaints; the extra renderCanvas()
          // below doubled every toggle into two full-page repaints.
          commitInspectorChange(
            `${hidden ? "Hidden" : "Shown"} section on ${viewport}`,
            false,
          );
        },
        onAddBlock: () =>
          openBlockInsertModal(section.children.length, section.id),
        onDuplicate: () => duplicateSection(section.id),
        onMoveUp: () => moveSection(section.id, -1),
        onMoveDown: () => moveSection(section.id, 1),
        onToggleLock: () => toggleSectionLock(section.id),
        onDelete: () => void deleteSection(section.id),
      });
      return;
    }

    if (!block) return;

    // Derived from the catalog so a new block type can never silently yield a
    // blank inspector (the properties panel is the single source of truth for
    // per-type content fields).
    const supportedBlockTypes = new Set<string>(KNOWN_BLOCK_TYPES);

    if (supportedBlockTypes.has(block.type)) {
      renderBlockProperties(panel, {
        title: blockLabel(block),
        subtitle: `${currentPageLabel()} / ${section?.label ?? "section"} / ${block.type}`,
        blockType: block.type,
        props: block.props,
        style: block.style,
        raw: block.raw,
        currentViewport: state.currentViewport,
        maxHeadingLevel: editorRules.maxHeadingLevel,
        locked: !!block.locked,
        responsive: block.style?.responsive?.[state.currentViewport] ?? {},
        onFocus: beginInspectorEdit,
        onBlur: endInspectorEdit,
        onPropChange: (key, value, rerenderProperties) => {
          if (isNodeLocked(block)) {
            setStatus(lockedMutationMessage("block"));
            return;
          }
          pushUndoForControlChange();
          block.props[key] = value;
          commitInspectorChange(
            `Updated ${block.type} ${key}`,
            rerenderProperties,
          );
        },
        onRawChange:
          block.type === "html"
            ? (value) => {
                if (isNodeLocked(block)) {
                  setStatus(lockedMutationMessage("block"));
                  return;
                }
                pushUndoForControlChange();
                block.raw = value;
                commitInspectorChange("Updated HTML markup");
              }
            : undefined,
        onStyleChange: (key, value, rerenderProperties) => {
          if (isNodeLocked(block)) {
            setStatus(lockedMutationMessage("block"));
            return;
          }
          pushUndoForControlChange();
          block.style = block.style ?? {};
          if (Array.isArray(value) && value.length === 0) {
            delete (block.style as Record<string, unknown>)[key];
          } else {
            (block.style as Record<string, unknown>)[key] = value;
          }
          commitInspectorChange(
            `Updated ${block.type} style`,
            rerenderProperties,
          );
        },
        onPickLink: openLinkPicker,
        onResponsiveStyleChange: (key, value) => {
          if (isNodeLocked(block)) {
            setStatus(lockedMutationMessage("block"));
            return;
          }
          pushUndoForControlChange();
          block.style = block.style ?? {};
          block.style.responsive = block.style.responsive ?? {};
          block.style.responsive[state.currentViewport] = {
            ...block.style.responsive[state.currentViewport],
            [key]: value,
          };
          commitInspectorChange(`Updated ${state.currentViewport} override`);
        },
        resolveAssetPreviewSrc: fetchAssetDataUrl,
        onPickImage:
          block.type === "image"
            ? () => void chooseAssetForImage(block)
            : undefined,
        onClearImage:
          block.type === "image"
            ? () => {
                pushUndoForControlChange();
                block.props["src"] = "";
                commitInspectorChange(`Updated ${block.type} src`, true);
              }
            : undefined,
        onAddGalleryImage:
          block.type === "gallery"
            ? () =>
                openAssetBrowser({
                  filter: "images",
                  title: "Add Gallery Image",
                  onSelect: (webPath) => {
                    pushUndo();
                    const existing = (block.props["images"] ?? "").trim();
                    block.props["images"] = existing
                      ? `${existing}\n${webPath}`
                      : webPath;
                    commitBlockChange("Added gallery image");
                  },
                })
            : undefined,
        onReorderGalleryImage:
          block.type === "gallery"
            ? (from, to) => {
                const images = galleryImages(block);
                if (to < 0 || to >= images.length) return;
                if (from < 0 || from >= images.length || from === to) return;
                const alts = images.map(
                  (_, index) => block.props[`alt${index + 1}`] ?? "",
                );
                pushUndo();
                const [image] = images.splice(from, 1);
                const [alt] = alts.splice(from, 1);
                images.splice(to, 0, image ?? "");
                alts.splice(to, 0, alt ?? "");
                writeGallery(block, images, alts);
                commitBlockChange("Reordered gallery image");
              }
            : undefined,
        onRemoveGalleryImage:
          block.type === "gallery"
            ? (index) => {
                const images = galleryImages(block);
                const alts = images.map(
                  (_, altIndex) => block.props[`alt${altIndex + 1}`] ?? "",
                );
                pushUndo();
                images.splice(index, 1);
                alts.splice(index, 1);
                writeGallery(block, images, alts);
                commitBlockChange("Removed gallery image");
              }
            : undefined,
        onSaveReusable:
          block.type === "section" ||
          block.type === "card" ||
          block.type === "html"
            ? async () => {
                const label = await modalController.promptText(
                  "Save as Reusable Section",
                  {
                    label: "Section name",
                    placeholder: "e.g. Hero with CTA",
                    confirmLabel: "Save",
                  },
                );
                if (!label) return;
                if (!state.project) return;
                const result = await saveReusableSection(
                  state.project.path,
                  label,
                  blockToHtml(block, "desktop"),
                );
                if (!result.ok) {
                  setStatus(
                    "Could not save reusable section: " +
                      (result.error ?? "unknown"),
                  );
                  return;
                }
                setStatus(`Saved reusable section "${label}".`);
                renderTemplates();
              }
            : undefined,
        onDuplicate: () => duplicateSelectedBlock(block),
        onMoveUp: () => moveBlock(block, -1),
        onMoveDown: () => moveBlock(block, 1),
        onWrap: () => wrapBlockInSection(block),
        onToggleLock: () => toggleBlockLock(block),
        onDelete: () => void deleteBlock(block),
      });
      return;
    }
  }

  return {
    renderCanvas,
    handleDrop,
    renderProperties,
    resetDragState,
    showIndicator,
    getDraggingSectionId: (): string | null => draggingSectionId,
    setDraggingSectionId: (id: string | null): void => {
      draggingSectionId = id;
    },
    setDropSlot: (sectionId: string | null, index: number): void => {
      dropSectionId = sectionId;
      dropIndex = index;
    },
    setSectionDropIndex: (index: number): void => {
      sectionDropIndex = index;
    },
    setDropIndex: (index: number): void => {
      dropIndex = index;
    },
    setDropSectionId: (sectionId: string | null): void => {
      dropSectionId = sectionId;
    },
    resetInspectorSelectionKey: (): void => {
      lastInspectorSelectionKey = "none";
    },
    resetCanvasClickTracking: (): void => {
      lastClickBlockId = null;
      lastClickTime = 0;
    },
    trackBlockClick: (blockId: string): boolean => {
      const now = Date.now();
      const isSecondClick =
        lastClickBlockId === blockId && now - lastClickTime < DOUBLE_CLICK_MS;
      lastClickBlockId = blockId;
      lastClickTime = now;
      return isSecondClick;
    },
  };
}
