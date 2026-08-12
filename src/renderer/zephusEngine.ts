// Zephus renderer logic. Talks to the main process exclusively through
// window.zephus (the preload bridge). No Node APIs are used here.

// TODO: The engine is still large. Further extraction candidates:
// the start view (theme picker, settings, onboarding), page structure
// helpers, and the section-shell drag callbacks still bound in init().

import { createCodeEditor, type CodeEditor } from "./codeEditor";
import {
  activateWorkspaceTab,
  initEditorWorkspaceTabs,
} from "./editorWorkspace";
import { bindCanvasHandlers, createCanvasActions } from "./editorCanvas";
import { installEditorSmokeHook } from "./editorSmoke";
import { createStartViewActions } from "./editorStartView";
import { createPageModalActions } from "./editorPageModals";
import { createBlockOpsActions } from "./editorBlockOps";
import { createHomeActions } from "./editorHome";
import { createSettingsModalActions } from "./editorSettingsModal";
import { createNextActionsRenderer } from "./editorNextActions";
import { createKeyboardHandler } from "./editorKeyboard";
import { createUndoOps } from "./editorUndoOps";
import * as editorFindReplace from "./editorFindReplace";
import { createPreviewPublishActions } from "./editorPreviewPublish";
import { collectUnsavedWorkSummaryLines } from "./editorUnsavedWork";
import { createEditorGitActions } from "./editorGit";
import { createEditorSaveActions } from "./editorSave";
import { createEditorSiteSaveActions } from "./editorSiteSave";
import {
  createEditorDraftRestoreActions,
  encodeSiteDraftContent,
} from "./editorDraftRestore";
import { createEditorPageParser } from "./editorParse";
import {
  blocksFromSections,
  buildPageDocumentFromSections,
  cloneSections,
} from "./editorPageModel";
import {
  cancelScheduledEditorDraftWrite,
  scheduleEditorDraftWrite,
  SITE_DRAFT_TARGET,
} from "./editorDraft";
import {
  createDebouncedCanvasRepaint,
  createInspectorUndoLatch,
  isInspectorTextInputFocused,
} from "./editorInspector";
import {
  editorSnapshotSectionsChanged,
  popEditorRedoEntry,
  popEditorUndoEntry,
  pushEditorRedoFromCurrent,
  pushEditorSnapshot,
  pushEditorUndo,
  pushEditorUndoFromCurrent,
  restoreEditorSnapshot,
  captureEditorSnapshot,
} from "./editorUndo";
import { blockToHtmlForEditor } from "./editorBlockRender";
import { assembleManagedPage, splitManagedPageSource } from "./editorSerialize";
import {
  EditorClipboardPayload,
  formatPanelMountFailureStatus,
  handlePlainTextPaste,
  isBlockTypeAllowed,
  isNodeLocked,
  lockedMutationMessage,
  shouldBlockManagedVisualSwitch,
  syncUndoRedoToolbar,
} from "./editorCommands";
import {
  clearPageChanges,
  clearSiteChanges,
  cloneSiteDocument,
  createEditorSession,
  effectiveSiteDocument,
  EditorSnapshot,
  isGlobalDirty,
  markPageDirty,
  markSiteDirty,
  SiteEditorKind,
  trackPageChange,
  trackSiteChange,
} from "./editorSession";
import { createModalController } from "./modalController";
import { createIcons } from "./editorIcons";
import { default as Settings } from "lucide/dist/esm/icons/settings.mjs";
import { default as Clock } from "lucide/dist/esm/icons/clock.mjs";
import { default as Compass } from "lucide/dist/esm/icons/compass.mjs";
import { default as FolderOpen } from "lucide/dist/esm/icons/folder-open.mjs";
import { default as Plus } from "lucide/dist/esm/icons/plus.mjs";
import { default as Eye } from "lucide/dist/esm/icons/eye.mjs";
import { default as EyeOff } from "lucide/dist/esm/icons/eye-off.mjs";
import { default as FilePenLine } from "lucide/dist/esm/icons/file-pen-line.mjs";
import { default as CodeXml } from "lucide/dist/esm/icons/code-xml.mjs";
import { default as Monitor } from "lucide/dist/esm/icons/monitor.mjs";
import { default as Tablet } from "lucide/dist/esm/icons/tablet.mjs";
import { default as Smartphone } from "lucide/dist/esm/icons/smartphone.mjs";
import { default as Undo2 } from "lucide/dist/esm/icons/undo-2.mjs";
import { default as Redo2 } from "lucide/dist/esm/icons/redo-2.mjs";
import { default as Play } from "lucide/dist/esm/icons/play.mjs";
import { default as Globe } from "lucide/dist/esm/icons/globe.mjs";
import { default as Save } from "lucide/dist/esm/icons/save.mjs";
import { default as LogOut } from "lucide/dist/esm/icons/log-out.mjs";
import { default as RefreshCw } from "lucide/dist/esm/icons/refresh-cw.mjs";
import { default as Square } from "lucide/dist/esm/icons/square.mjs";
import { default as Heading } from "lucide/dist/esm/icons/heading.mjs";
import { default as AlignLeft } from "lucide/dist/esm/icons/text-align-start.mjs";
import { default as ImageIcon } from "lucide/dist/esm/icons/image.mjs";
import { default as Layout } from "lucide/dist/esm/icons/panels-top-left.mjs";
import { default as LayoutTemplate } from "lucide/dist/esm/icons/layout-template.mjs";
import { default as FileCode } from "lucide/dist/esm/icons/file-code.mjs";
import { default as Link } from "lucide/dist/esm/icons/link.mjs";
import { default as GitBranch } from "lucide/dist/esm/icons/git-branch.mjs";
import { default as AlertTriangle } from "lucide/dist/esm/icons/triangle-alert.mjs";
import { default as Star } from "lucide/dist/esm/icons/star.mjs";
import { default as Quote } from "lucide/dist/esm/icons/quote.mjs";
import { default as ChevronDown } from "lucide/dist/esm/icons/chevron-down.mjs";
import { default as BarChart } from "lucide/dist/esm/icons/chart-no-axes-column-increasing.mjs";
import { default as Tag } from "lucide/dist/esm/icons/tag.mjs";
import { default as Megaphone } from "lucide/dist/esm/icons/megaphone.mjs";
import { default as Newspaper } from "lucide/dist/esm/icons/newspaper.mjs";
import { default as X } from "lucide/dist/esm/icons/x.mjs";
import { default as Info } from "lucide/dist/esm/icons/info.mjs";
import type { RenderPostEntry } from "../shared/blockRender";
import { renderSectionsMarkup } from "../shared/blockRender";
import { renderHelpModal } from "./HelpModal";
import { mountAboutLicenses, updateAboutLicenses } from "./AboutLicenses";
import {
  AssetBrowserModalEntry,
  renderAssetBrowserModalBody,
} from "./AssetBrowserModal";
import { renderBlockProperties } from "./BlockProperties";
import {
  mountCanvas,
  registerCanvasHandlers,
  updateCanvas,
} from "./CanvasView";
import {
  googleFontForStack,
  renderDesignSystemModalBody,
} from "./DesignSystemModal";
import { renderInsertModal } from "./InsertModals";
import {
  renderProductionLicensesModalBody,
  renderPublishSuccessModalBody,
  renderSiteShellModalBody,
  renderThemePreviewModalBody,
  renderUnsavedWorkSummaryModalBody,
} from "./MiscModals";
import { renderFindReplaceModalBody } from "./FindReplaceModal";
import { mountNextActions, updateNextActions } from "./NextActions";
import { LinkPickerKind, renderLinkPickerModal } from "./LinkPickerModal";
import {
  renderPropertiesEmpty,
  renderSectionProperties,
} from "./SectionProperties";
import {
  initializeSettingsTab,
  mountSettingsTab,
  registerSettingsTabHandlers,
  updateSettingsTabNode,
  updateSettingsTabSettings,
  updateSettingsTabUpdater,
} from "./SettingsTab";
import { renderSettingsModalBody } from "./SettingsModal";
import {
  mountGitBranch,
  mountGitPanel,
  registerGitPanelHandlers,
  updateGitPanelEditorDirty,
  updateGitStatus,
} from "./GitPanel";
import {
  mountHomeDraftRecovery,
  registerHomeDraftRecoveryHandlers,
  updateHomeDraftRecovery,
} from "./HomeDraftRecovery";
import { mountLayers, registerLayersHandlers, updateLayers } from "./Layers";
import {
  mountBlockPalette,
  updateAllowedBlocks,
  registerInsertBlockCallback,
} from "./Palette";
import {
  mountRecentProjects,
  registerRecentProjectsHandlers,
  updateRecentProjects,
} from "./RecentProjects";
import { mountProjectOverview, updateProjectOverview } from "./ProjectOverview";
import {
  mountPageList,
  registerPageListHandlers,
  updatePageList,
} from "./PageList";
import {
  renderNavigationPreviewModal,
  renderNewPageModal,
  renderPageSettingsModal,
} from "./PageModals";
import {
  mountNavList,
  registerNavListHandlers,
  updateNavList,
} from "./NavList";
import {
  mountEditorStateBanner,
  updateEditorStateBanners,
} from "./EditorStateBanner";
import {
  mountSidebarUpdateStatus,
  registerSidebarUpdateStatusHandlers,
  updateSidebarUpdateStatus,
} from "./SidebarUpdateStatus";
import {
  mountThemesTab,
  registerThemesTabHandlers,
  updateThemesTab,
} from "./ThemesTab";
import {
  mountTemplatePalette,
  registerInsertTemplateCallback,
  updateTemplates,
} from "./Templates";
import {
  defaultProps,
  KNOWN_BLOCK_TYPES,
  PALETTE,
  setUidGenerator,
  TEMPLATES,
  TEXT_EDITABLE,
  type BlockType,
  type SectionTemplate,
} from "./editorBlocks";
import { createInlineEditController } from "./editorInlineEdit";
import { createResizeController } from "./editorResize";

type Mode = "visual" | "code";
type Block = EditorBlock;

function refreshIcons(): void {
  createIcons({
    attrs: { "aria-hidden": "true", focusable: "false" },
    icons: {
      Settings,
      Clock,
      Compass,
      FolderOpen,
      Plus,
      Eye,
      EyeOff,
      FilePenLine,
      CodeXml,
      Monitor,
      Tablet,
      Smartphone,
      Undo2,
      Redo2,
      Play,
      Globe,
      Save,
      LogOut,
      RefreshCw,
      Square,
      Heading,
      AlignLeft,
      Image: ImageIcon,
      Layout,
      LayoutTemplate,
      FileCode,
      Link,
      GitBranch,
      AlertTriangle,
      Star,
      Quote,
      ChevronDown,
      BarChart,
      Tag,
      Megaphone,
      Newspaper,
      X,
      Info,
    },
  });
}

const editorRules = {
  allowedBlocks: null as string[] | null,
  maxHeadingLevel: 6,
};

const panelMountFailures: string[] = [];

/** Cache of saved reusable sections, refreshed by renderTemplates(). */

const state = createEditorSession();

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

/** Like $ but returns null if element absent (for optional UI elements). */
function $maybe(id: string): HTMLElement | null {
  return document.getElementById(id);
}

// Cached app settings, loaded at startup and refreshed on save.
let appSettings: GlobalSettings | null = null;
let pendingHomeDraftResume: DraftSummary | null = null;
const modalController = createModalController(refreshIcons);
const { closeModal, showModal, showModalNode, registerCleanup } =
  modalController;
const pageModals = createPageModalActions({
  getState: () => state,
  setStatus,
  closeModal,
  registerCleanup,
  refreshIcons,
  modalController,
  maybeResolveUnsavedWork,
  reloadPages,
  loadPage,
  getCode,
  syncCurrentMeta,
  resetOpenPageState,
  normalizePageSlugInput,
  isReservedNotFoundSlug,
  invalidateAssetCache,
  fetchAssetDataUrl,
  reloadSiteDocumentFromDisk,
  showModalNode,
});

const { openPageMetaModal, openAssetBrowser } = pageModals;

const homeActions = createHomeActions({
  $,
  $maybe,
  setStatus,
  showModal,
  closeModal,
  getState: () => state,
  modalController,
  maybeResolveUnsavedWork,
  friendlyError,
  projectBaseName,
  formatRelativeTime,
  setAppSettings: (settings) => {
    appSettings = settings;
  },
  getAppSettings: () => appSettings,
});

const {
  refreshHomeDraftSummaries,
  homeDraftLabel,
  syncHomeActionState,
  renderHomeStatusPanels,
  updateVersionLabel,
  updaterStatusMessage,
  restartToApplyUpdate,
  currentUpdaterActions,
  refreshUpdaterControls,
  promptDownloadedUpdate,
  renderSidebarUpdateStatus,
  renderRecent,
} = homeActions;

const nextActions = createNextActionsRenderer({
  getState: () => state,
  setStatus,
  updateNextActions,
  openPageMetaModal,
  openSiteShellModal,
  createNotFoundPage,
  newPageFlow,
  addImageBlockWithAssetFlow,
  addSectionAt: (index, template) => addSectionAt(index, template),
  chooseAssetForImage,
  regenerateNav,
  performSave: () => performSave(),
  discardPendingSiteChanges,
  clearChanges,
  markDirty,
  renderDirtyIndicators,
  renderLayers,
  renderCanvas: () => renderCanvas(),
  renderProperties: () => renderProperties(),
  loadPage: (page, options) => loadPage(page, options),
  findBlockLocation,
  isValidDateString,
  visibleNavCount,
  templateAllowed: (template) => templateAllowed(template),
});

const { renderNextActions } = nextActions;

const undoOps = createUndoOps({
  getState: () => state,
  isLatchActive: () => inspectorEditLatch.isActive(),
  restoreSnapshot,
  syncSelectionAfterRestore,
  serializeBlocks,
  trackChange,
  markDirty,
  renderLayers,
  renderCanvas: () => renderCanvas(),
  renderProperties: () => renderProperties(),
  updateUndoRedoButtons,
});

const { doUndo, doRedo } = undoOps;

const keyboard = createKeyboardHandler({
  getState: () => state,
  isBusy: () => loadingPage !== null || closingProject,
  modalController,
  openHelpModal,
  performSave: () => performSave(),
  setViewport: (vp) => setViewport(vp),
  setMode: (mode) => setMode(mode),
  openFindReplaceModal: () => openFindReplaceModal(),
  updateUndoRedoButtons,
  doUndo: () => doUndo(),
  doRedo: () => doRedo(),
  findSelectedBlock,
  findSection,
  duplicateSelectedBlock: (block) => duplicateSelectedBlock(block),
  duplicateSection: (id) => duplicateSection(id),
  copySelectionToClipboard: () => copySelectionToClipboard(),
  cutSelectionToClipboard: () => cutSelectionToClipboard(),
  pasteFromClipboard: () => pasteFromClipboard(),
  deleteBlock: (block) => deleteBlock(block),
  deleteSection: (id) => deleteSection(id),
  cmUndo: () => cm?.undo(),
  cmRedo: () => cm?.redo(),
});

const { onKeydown } = keyboard;

const settingsModalActions = createSettingsModalActions({
  $,
  setStatus,
  showModal,
  showModalNode,
  closeModal,
  registerCleanup,
  modalController,
  applyCodeFontSize,
  nodeStatusMessage,
  friendlyError,
  updaterStatusMessage,
  currentUpdaterActions,
  restartToApplyUpdate,
  setAppSettings: (settings) => {
    appSettings = settings;
  },
  getAppSettings: () => appSettings,
});

const {
  openSettingsModal,
  showProductionLicensesModal,
  openProductionLicensesModal,
} = settingsModalActions;

const blockOps = createBlockOpsActions({
  getState: () => state,
  setStatus,
  closeModal,
  showModalNode,
  modalController,
  editorRules,
  appSettings,
  updateUndoRedoButtons,
  renderLayers,
  renderCanvas: () => renderCanvas(),
  renderProperties: () => renderProperties(),
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
});

const {
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
} = blockOps;

const canvasActions = createCanvasActions({
  getState: () => state,
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
  galleryImages,
  writeGallery,
  openAssetBrowser,
  fetchAssetDataUrl,
  renderTemplates,
  saveReusableSection: (projectPath, label, html) =>
    window.zephus.saveReusableSection(projectPath, label, html),
  blockToHtml,
  effectiveNodeStyle: (node) => resize.effectiveNodeStyle(node),
  isInlineEditing: () => inlineEdit.isInlineEditing(),
  finishInlineEdit: () => inlineEdit.finishInlineEdit(),
  modalController,
});

const {
  renderCanvas,
  handleDrop,
  renderProperties,
  resetDragState,
  showIndicator,
} = canvasActions;
// Inline text editing (double-click, format toolbar) — created at module
// level; all deps are hoisted function declarations.
const inlineEdit = createInlineEditController({
  setStatus,
  refreshIcons,
  handlePlainTextPaste,
  pushUndo,
  commitBlockChange,
  renderCanvas,
  renderProperties,
});

let statusTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(message: string): void {
  if (statusTimer !== null) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  $("status-bar").textContent = message;
  // Auto-clear transient confirmations so the bar doesn't show stale text.
  if (message) {
    statusTimer = setTimeout(() => {
      $("status-bar").textContent = "";
      statusTimer = null;
    }, 6000);
  }
}

/**
 * Maps raw build/preview/install errors to plain-language guidance for
 * non-technical users. Falls back to the shortest meaningful line.
 */
function friendlyError(raw: string | undefined): string {
  const e = (raw ?? "").toString();
  if (!e.trim()) return "Something went wrong. Please try again.";
  if (/not installed|run npm install/i.test(e))
    return "Your site's dependencies aren't installed yet. Zephus will install them — try again.";
  if (/node(\.js)?\s*\/?\s*npm not found|ENOENT|not recognized/i.test(e))
    return "Node.js was not found. Install it from nodejs.org, or set a custom Node.js location in Settings.";
  if (/did not report a URL|timeout/i.test(e))
    return "The preview took too long to start. Check the Dev Server Log panel for details.";
  if (/EADDRINUSE|address already in use|port/i.test(e))
    return "The preview port is already in use. Close any other running dev servers and try again.";
  if (/EACCES|permission denied/i.test(e))
    return "Permission denied writing to the project folder. Check the folder's permissions.";
  if (/ENOSPC|no space/i.test(e))
    return "Your disk is full. Free up space and try again.";
  // Fallback: first non-empty line, trimmed to something readable.
  const firstLine = e.split("\n").find((l) => l.trim()) ?? e;
  return firstLine.length > 240 ? firstLine.slice(0, 240) + "…" : firstLine;
}

function nodeStatusMessage(res: NodeCheckResult): string {
  if (res.message) return res.message;
  if (res.status === "missing") {
    return "Node.js was not found. Install Node.js 22.12 or newer, or set a custom Node.js location in Settings.";
  }
  if (res.status === "outdated") {
    return `Node.js ${res.version ?? "?"} was found, but Zephus needs Node.js 22.12 or newer.`;
  }
  return res.message || "Node.js status could not be determined.";
}

/** True for a real calendar date in YYYY-MM-DD form (mirrors the main process). */
function isValidDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function uid(): string {
  return "b" + Math.random().toString(36).slice(2, 9);
}

// Template blocks (editorBlocks.ts) must use the same id scheme as the
// session, so register the engine's generator once.
setUidGenerator(uid);

function cloneBlock(block: Block): Block {
  const copy: Block = {
    ...block,
    props: { ...block.props },
    style: block.style ? JSON.parse(JSON.stringify(block.style)) : undefined,
  };
  // Deep-clone nested structures so a duplicate never shares mutable state with
  // its source, and give nested children fresh ids to avoid id collisions.
  const nested = block as unknown as {
    children?: Block[];
    asset?: unknown;
    link?: unknown;
    form?: unknown;
  };
  const target = copy as unknown as {
    children?: Block[];
    asset?: unknown;
    link?: unknown;
    form?: unknown;
  };
  if (Array.isArray(nested.children)) {
    target.children = nested.children.map((child) => {
      const childCopy = cloneBlock(child);
      childCopy.id = uid();
      return childCopy;
    });
  }
  if (nested.asset !== undefined) {
    target.asset = JSON.parse(JSON.stringify(nested.asset));
  }
  if (nested.link !== undefined) {
    target.link = JSON.parse(JSON.stringify(nested.link));
  }
  if (nested.form !== undefined) {
    target.form = JSON.parse(JSON.stringify(nested.form));
  }
  return copy;
}

function trackChange(label: string): void {
  trackPageChange(state, label);
}

function clearChanges(): void {
  clearPageChanges(state);
}

function syncBlocksFromSections(): void {
  state.blocks = blocksFromSections(state.sections);
}

function sectionsFromPageDocument(doc: PageDocument): SectionNode[] {
  return cloneSections(doc.sections);
}

function clampSavedHeadingLevels(doc: PageDocument): PageDocument {
  for (const section of doc.sections) {
    for (const block of section.children) {
      if (block.type !== "heading") continue;
      const level = Number(block.props["level"] ?? "1");
      block.props["level"] = String(
        Math.min(
          editorRules.maxHeadingLevel,
          Math.max(1, Number.isFinite(level) ? Math.floor(level) : 1),
        ),
      );
    }
  }
  return doc;
}

function pageDocumentFromState(): PageDocument | null {
  if (!state.pageDocument || !state.page) return null;
  return clampSavedHeadingLevels(
    buildPageDocumentFromSections(
      state.pageDocument,
      state.page,
      state.sections,
    ),
  );
}

function syncVisualModeState(): void {
  const visualBtn = $("mode-visual") as HTMLButtonElement;
  visualBtn.disabled = !state.visualEditable;
  visualBtn.classList.toggle("disabled", !state.visualEditable);
  visualBtn.title =
    state.managedStatus === "out-of-sync"
      ? "This page was edited outside Zephus. Reload from disk or detach in Code mode to continue."
      : state.visualEditable
        ? "Visual"
        : "Detached pages are code-only until reattached.";
}

// CodeMirror code editor, mounted once on first editor entry.
let cm: CodeEditor | null = null;
let settingCode = false;

function ensureCodeEditor(): void {
  if (cm) return;
  cm = createCodeEditor(
    $("code-editor"),
    () => {
      if (state.mode === "code" && !settingCode) {
        trackChange("Edited page code");
        markDirty(true);
      }
      updateUndoRedoButtons();
    },
    updateUndoRedoButtons,
  );
}

function setCode(value: string): void {
  settingCode = true;
  cm?.setValue(value);
  settingCode = false;
}

function getCode(): string {
  return cm ? cm.getValue() : state.rawCode;
}

function currentPageLabel(): string {
  return (
    state.currentMeta?.navLabel ||
    state.currentMeta?.title ||
    state.page ||
    "page"
  );
}

function projectBaseName(projectPath: string): string {
  return projectPath.split(/[\\/]/).pop() ?? projectPath;
}

function formatRelativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "recently";
  const diffMs = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "just now";
  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))}m ago`;
  if (diffMs < day) return `${Math.max(1, Math.round(diffMs / hour))}h ago`;
  return `${Math.max(1, Math.round(diffMs / day))}d ago`;
}

function visibleNavCount(): number {
  const currentSite = effectiveSiteDocument(state);
  if (currentSite?.shell.navItems?.length) {
    return currentSite.shell.navItems.filter((item) => item.visible).length;
  }
  return state.pageMeta.filter((entry) => entry.navVisible).length;
}

function renderThemePlaceholder(): void {
  if (startView.hasLoadedStartThemes()) return;
  updateThemesTab({ mode: "placeholder", themes: [] });
}

function renderProjectOverview(): void {
  if (!state.project) {
    updateProjectOverview({ hasProject: false });
    return;
  }
  const navState = state.currentMeta
    ? state.currentMeta.navVisible
      ? "Visible in nav"
      : "Hidden from nav"
    : "No page metadata";
  const canvasState = state.sections.length
    ? `${state.sections.length} section${state.sections.length === 1 ? "" : "s"}`
    : "Empty page";
  const pills: Array<[string, string]> = [];
  pills.push([
    state.pageDirty ? "Page Dirty" : "Page Saved",
    state.pageDirty ? "warn" : "good",
  ]);
  pills.push([
    state.siteDirty ? "Site Pending" : "Site Synced",
    state.siteDirty ? "warn" : "good",
  ]);
  pills.push([
    state.managedStatus === "detached"
      ? "Detached"
      : state.managedStatus === "out-of-sync"
        ? "Out Of Sync"
        : "Managed",
    state.managedStatus === "managed" ? "good" : "warn",
  ]);
  pills.push([state.previewUrl ? "Preview Live" : "Preview Idle", "info"]);
  const hint =
    state.sections.length === 0
      ? "This page is blank. Start with a hero, a blank section, or a reusable section."
      : visibleNavCount() === 0
        ? "No visible navigation items are live yet. Review page metadata or staged navigation."
        : state.pageDirty || state.siteDirty
          ? "Save your changes to keep preview and publish flows predictable."
          : state.previewUrl
            ? "Preview is running. Review the live page, then publish when ready."
            : "This project is ready for preview and publish checks.";
  const quickActions: Array<{ label: string; onClick: () => void }> = [
    {
      label: "Page Settings",
      onClick: () => {
        if (state.page) void openPageMetaModal(state.page);
      },
    },
    { label: "New Page", onClick: () => void newPageFlow() },
    { label: "Site Shell", onClick: () => void openSiteShellModal() },
    { label: "Design System", onClick: () => void openDesignSystemModal() },
    {
      label: state.previewUrl ? "Stop Preview" : "Start Preview",
      onClick: () => void togglePreview(),
    },
    { label: "Publish", onClick: () => void publishSite() },
  ];
  updateProjectOverview({
    hasProject: true,
    pageTitle:
      state.currentMeta?.navLabel ??
      state.currentMeta?.title ??
      state.page ??
      "No page selected",
    route: state.currentMeta?.route ?? "No route",
    navState,
    canvasState,
    pills: pills.map(([label, tone]) => ({
      label,
      tone: tone as "good" | "warn" | "info",
    })),
    hint,
    actions: quickActions.map((action) => ({
      ...action,
      disabled: action.label === "Page Settings" && !state.page,
    })),
  });
}

async function addImageBlockWithAssetFlow(): Promise<void> {
  if (!isBlockTypeAllowed("image", editorRules.allowedBlocks)) {
    setStatus('Block type "image" is not allowed on this site.');
    return;
  }
  const sectionId = activeSectionId();
  const section = findSection(sectionId);
  addBlockAt("image", section?.children.length ?? 0, sectionId);
  const block = findSelectedBlock();
  if (block) {
    await chooseAssetForImage(block);
  }
}

function refreshGuidancePanels(): void {
  renderProjectOverview();
  renderNextActions();
}

function findSection(sectionId: string | null): SectionNode | null {
  if (!sectionId) return null;
  return state.sections.find((section) => section.id === sectionId) ?? null;
}

function findBlockLocation(blockId: string | null): {
  section: SectionNode;
  sectionIndex: number;
  block: Block;
  blockIndex: number;
} | null {
  if (!blockId) return null;
  for (
    let sectionIndex = 0;
    sectionIndex < state.sections.length;
    sectionIndex += 1
  ) {
    const section = state.sections[sectionIndex];
    if (!section) continue;
    const blockIndex = section.children.findIndex(
      (child) => child.id === blockId,
    );
    if (blockIndex >= 0) {
      const block = section.children[blockIndex] as Block;
      return { section, sectionIndex, block, blockIndex };
    }
  }
  return null;
}

function findSelectedBlock(): Block | null {
  return findBlockLocation(state.selectedId)?.block ?? null;
}

/** Resolve reactive canvas view models back to the mutable session objects. */
function liveCanvasBlock(block: EditorBlock): Block {
  return findBlockLocation(block.id)?.block ?? (block as Block);
}

function liveCanvasSection(section: SectionNode): SectionNode {
  return findSection(section.id) ?? section;
}

function activeSectionId(): string | null {
  // The selected block's real section wins: `selectedSectionId` can point at
  // a stale section after an undo/redo that moved the block back.
  return (
    findBlockLocation(state.selectedId)?.section.id ??
    state.selectedSectionId ??
    state.sections[0]?.id ??
    null
  );
}

/** Re-anchors selection after an undo/redo restored a different tree. */
function syncSelectionAfterRestore(): void {
  if (state.selectedId) {
    const location = findBlockLocation(state.selectedId);
    if (location) {
      state.selectedSectionId = location.section.id;
      return;
    }
    state.selectedId = null;
  }
  if (state.selectedSectionId && findSection(state.selectedSectionId)) return;
  state.selectedSectionId = state.sections[0]?.id ?? null;
}

function ensureFallbackSection(): SectionNode {
  return {
    id: uid(),
    type: "section",
    label: "Main Content",
    props: { wrapper: "none", cls: "" },
    children: [],
  };
}

const { parseSections } = createEditorPageParser({
  uid,
  createFallbackSection: ensureFallbackSection,
  knownBlockTypes: KNOWN_BLOCK_TYPES,
});

function syncSelectionState(): void {
  if (state.selectedId && !findBlockLocation(state.selectedId)) {
    state.selectedId = null;
  }
  if (state.selectedSectionId && !findSection(state.selectedSectionId)) {
    state.selectedSectionId = null;
  }
  if (!state.selectedSectionId && state.sections[0]) {
    state.selectedSectionId = state.sections[0].id;
  }
}

function draftContentForCurrentState(): string {
  return state.mode === "code" ? getCode() : serializeBlocks();
}

function siteDraftContentForCurrentState(): string {
  return encodeSiteDraftContent(
    effectiveSiteDocument(state) ?? state.siteDocument!,
    state.pendingSiteEditorKind,
  );
}

// Warns once per session: the crash-recovery net failing silently (disk full,
// unwritable drafts.json) would mean unsaved work is unrecoverable after a
// crash, with zero user-visible sign.
let draftWriteFailureWarned = false;

function scheduleDraftWrite(): void {
  scheduleEditorDraftWrite(state, {
    writeDraft: window.zephus.writeDraft.bind(window.zephus),
    pageDraftContent: draftContentForCurrentState,
    siteDraftContent: siteDraftContentForCurrentState,
    onDraftWriteFailure: () => {
      if (draftWriteFailureWarned) return;
      draftWriteFailureWarned = true;
      setStatus(
        "Warning: the crash-recovery draft could not be saved. " +
          "Unsaved work may not be recoverable if the app closes unexpectedly.",
      );
    },
  });
}

function renderDirtyIndicators(): void {
  const name = $("project-name");
  const existing = name.querySelector(".dirty-dot");
  const globalDirty = isGlobalDirty(state);
  if (globalDirty && !existing) {
    const dot = document.createElement("span");
    dot.className = "dirty-dot";
    dot.textContent = "●";
    name.appendChild(dot);
  } else if (!globalDirty && existing) {
    existing.remove();
  }
  name.classList.toggle("dirty", globalDirty);

  const saveBtn = $("btn-save");
  saveBtn.classList.toggle("dirty", globalDirty);
  saveBtn.setAttribute("title", globalDirty ? "Unsaved changes" : "Save");

  for (const li of Array.from($("page-list").children) as HTMLElement[]) {
    const isCurrent = li.dataset["page"] === state.page;
    li.classList.toggle("dirty", state.pageDirty && isCurrent);
  }

  for (const id of ["btn-site-shell", "btn-design-system"]) {
    $(id).classList.toggle("dirty-flag", state.siteDirty);
  }

  // The Git panel must not let a commit stage the last-saved disk state
  // while the editor holds newer unsaved edits.
  updateGitPanelEditorDirty(globalDirty);

  renderEditorStateBanner();
  refreshGuidancePanels();
}

function markDirty(d: boolean): void {
  markPageDirty(state, d);
  renderDirtyIndicators();
  if (d) scheduleDraftWrite();
}

/* ---------- Start view ---------- */

async function chooseFolder(): Promise<void> {
  const folder = await window.zephus.openFolderDialog();
  if (!folder) return;
  await openProjectByPath(folder);
}

/* ---------- App Settings ---------- */

function applyCodeFontSize(size: number): void {
  document.documentElement.style.setProperty("--code-font-size", `${size}px`);
}

/**
 * Mirrors the project's design tokens onto the canvas so users see live
 * font/color changes while editing, without needing to save and reload.
 * Note: Google Fonts won't load in the renderer (CSP), so custom webfonts
 * fall back to their stack here. Real font visible in dev-server preview.
 */
function applyDesignPreview(): void {
  const canvas = document.getElementById("canvas");
  if (!canvas) return;
  const design = effectiveSiteDocument(state)?.design;
  const shadowValue =
    design?.shadow === "md"
      ? "0 18px 42px rgba(15, 23, 42, 0.12)"
      : design?.shadow === "lg"
        ? "0 26px 60px rgba(15, 23, 42, 0.18)"
        : design?.shadow === "none"
          ? "none"
          : "0 8px 20px rgba(15, 23, 42, 0.08)";
  const props: Array<[string, string | undefined]> = [
    ["--zephus-accent", design?.accent],
    ["--zephus-foreground", design?.foreground],
    ["--zephus-background", design?.background],
    ["--zephus-surface", design?.surface],
    ["--zephus-font-family", design?.fontFamily],
    ["--zephus-heading-font", design?.headingFontFamily],
    ["--zephus-radius", design?.radius],
    // The build's bands cap content at var(--zephus-container-width) and the
    // shell uses var(--zephus-shadow); without these on the canvas, styled
    // sections render full-bleed there (build: capped column) and shadow
    // tokens fall back to nothing.
    ["--zephus-container-width", design?.containerWidth],
    ["--zephus-shadow", shadowValue],
  ];
  for (const [name, value] of props) {
    if (value && value.trim()) canvas.style.setProperty(name, value);
    else canvas.style.removeProperty(name);
  }

  // Load Google Fonts link in the editor if a fontImportUrl exists
  const fontImportUrl = design?.fontImportUrl;
  let fontLink = document.getElementById(
    "zephus-canvas-google-fonts",
  ) as HTMLLinkElement | null;
  if (fontImportUrl && fontImportUrl.trim()) {
    if (!fontLink) {
      fontLink = document.createElement("link");
      fontLink.id = "zephus-canvas-google-fonts";
      fontLink.rel = "stylesheet";
      document.head.appendChild(fontLink);
    }
    if (fontLink.href !== fontImportUrl) {
      fontLink.href = fontImportUrl;
    }
  } else if (fontLink) {
    fontLink.remove();
  }
}

/* ---------- Open + strict gating ---------- */

// Guards concurrent opens (double-click on a recent entry): two overlapping
// flows would both mutate state.project and interleave their page loads.
let projectOpenInFlight = false;
// An open requested while another is in flight (the startup auto-restore is
// the common case): user intent must WIN over the automatic restore, so the
// request is queued and run once the in-flight open settles instead of being
// silently dropped.
let queuedProjectOpen: string | null = null;

async function openProjectByPath(folder: string): Promise<void> {
  if (projectOpenInFlight) {
    // The auto-restore (bootstrap) is running; remember the user's explicit
    // choice and open it right after, so their click is never swallowed.
    queuedProjectOpen = folder;
    setStatus("Opening " + folder + "…");
    return;
  }
  projectOpenInFlight = true;
  try {
    await openProjectByPathInner(folder);
    const queued = queuedProjectOpen;
    queuedProjectOpen = null;
    if (queued && queued !== folder) {
      // The user clicked another project while the auto-restore ran: honor
      // their explicit choice (the freshly-opened project has no unsaved
      // work, so switching is safe).
      setStatus("Opening " + queued + "…");
      await openProjectByPathInner(queued);
    }
  } catch (error) {
    // A thrown open must not leave a stale queued path: the next open would
    // silently open a project the user never clicked.
    queuedProjectOpen = null;
    throw error;
  } finally {
    projectOpenInFlight = false;
  }
}

async function openProjectByPathInner(folder: string): Promise<void> {
  setStatus("Opening " + folder + "…");
  const result = await window.zephus.openProject(folder);
  if (!result.ok) {
    // A failed open must not leave a stale resume request pending: the next
    // successful open of the same path would silently resume a draft with no
    // second prompt (and if its target page no longer exists, the draft would
    // linger on the home screen forever).
    const pending = pendingHomeDraftResume;
    pendingHomeDraftResume = null;
    if (pending?.projectPath === folder) {
      // The project cannot be opened (deleted folder): clear its recovery
      // drafts so the card does not stay on the home screen.
      const cleared = await window.zephus.clearDraft(
        folder,
        pending.scope,
        pending.target,
      );
      void cleared;
      await refreshHomeDraftSummaries();
    }
    // Recent-project validation: drop entries that no longer resolve.
    await window.zephus.removeRecentProject(folder);
    await renderRecent();
    showModal("Could Not Open Project", result.error ?? "Unknown error.", [
      { label: "OK", kind: "primary", onClick: closeModal },
    ]);
    return;
  }

  if (!result.isZephusProject) {
    showModal(
      "Not a Zephus Site",
      "Zephus can only open sites it created. This folder has no .zephus marker. " +
        'Use "Create New Site" to start a new project from a theme.',
      [{ label: "OK", kind: "primary", onClick: closeModal }],
    );
    return;
  }

  latestPageLoadRequest += 1;
  ignoredExternalChange = null;
  state.project = result;
  clearAssetCache();
  await renderRecent();

  if (!result.pkg.ready) {
    state.project = null;
    showModal(
      "Project Appears Damaged",
      "This Zephus project is missing a valid package.json (Astro dependency and a " +
        "dev script). The project may be incomplete or damaged.",
      [{ label: "OK", kind: "primary", onClick: closeModal }],
    );
    return;
  }

  if (!result.isGitRepo) {
    showModal(
      "Not a Git Repository",
      "This project has no Git repository. Initialize one?",
      [
        {
          label: "Skip",
          kind: "ghost",
          onClick: () => {
            closeModal();
            void enterEditor(result);
          },
        },
        {
          label: "Initialize Git",
          kind: "primary",
          onClick: async () => {
            closeModal();
            try {
              await window.zephus.initGitRepo(folder);
            } catch (error) {
              state.project = null;
              showModal(
                "Could Not Initialize Git",
                error instanceof Error ? error.message : String(error),
                [{ label: "OK", kind: "primary", onClick: closeModal }],
              );
              return;
            }
            await enterEditor(result);
          },
        },
      ],
    );
    return;
  }

  await enterEditor(result);
}

/* ---------- Editor ---------- */

async function enterEditor(result: ProjectOpenResult): Promise<void> {
  editorSessionGeneration += 1;
  $("view-start").classList.add("hidden");
  const editorView = $("view-editor");
  editorView.classList.remove("hidden");
  // Move focus into the editor so keyboard/SR users aren't dropped on <body>.
  editorView.setAttribute("tabindex", "-1");
  editorView.focus();
  $("project-name").textContent = result.name;
  // A fresh editor session has no page open yet. Clearing it matters when a
  // second project is opened without closing the first: both can contain the
  // same page path, and a stale value would make the load look redundant.
  state.page = null;
  state.currentMeta = null;
  try {
    const ensured = await window.zephus.ensureVisualSchema(
      result.path,
      result.astro.pagesDir,
    );
    if (!ensured.ok) {
      throw new Error(
        ensured.error ?? "Could not initialize Zephus schema sidecars.",
      );
    }
    const siteResult = await window.zephus.readSiteDocument(result.path);
    state.siteDocument = siteResult.ok ? siteResult.site : null;
    state.pendingSiteDocument = null;
    state.pendingSiteEditorKind = null;
    markSiteDirty(state, false);
    ensureCodeEditor();
    const siteDraftCleanupWarning = await maybeRestoreSiteDraft();
    void editorGit.refreshGit();
    await applyRepoRules();
    void applyMergedTheme();
    await reloadPages();
    renderPageList(result);
    renderNavEditor(result);
    setMode("visual");
    renderDirtyIndicators();

    // Subscribe once to external file-change notifications.
    state.unsubExternal?.();
    state.unsubExternal = window.zephus.onExternalChange((rel) => {
      if (rel === state.page) void onExternalChange();
    });

    const integrity = ensured.status?.integrity ?? result.schema.integrity;
    setStatus(
      siteDraftCleanupWarning ??
        (integrity === "legacy"
          ? "Migrated project into schema-backed visual mode."
          : "Ready — " + result.path),
    );
    const pendingDraft =
      pendingHomeDraftResume?.projectPath === result.path
        ? pendingHomeDraftResume
        : null;
    pendingHomeDraftResume = null;
    if (pendingDraft?.scope === "site") {
      // The user already chose to resume the site draft on the home screen;
      // restore it silently instead of prompting again.
      const warning = await editorDraftRestore.maybeRestoreSiteDraft({
        skipPrompt: true,
      });
      if (warning) setStatus(warning);
    }
    if (
      pendingDraft?.scope === "page" &&
      state.project?.pages.includes(pendingDraft.target)
    ) {
      // The user already chose to resume this draft on the home screen; do
      // not prompt "Restore Page Draft?" a second time — but DO restore the
      // draft content (skipping the restore entirely opened the stale disk
      // copy and left the card looping forever).
      await loadPage(pendingDraft.target, {
        restoreDraftSilently: true,
      });
      // The cleared draft's home card would otherwise linger for the whole
      // session (stale timestamp, phantom).
      await refreshHomeDraftSummaries();
      return;
    }
    if (pendingDraft?.scope === "page") {
      // The draft's page was renamed or deleted: clear the stale draft so
      // the card does not linger on the home screen forever.
      const cleared = await window.zephus.clearDraft(
        result.path,
        "page",
        pendingDraft.target,
      );
      if (!cleared.ok) {
        setStatus(
          "Could not clear the recovery draft: " +
            (cleared.error ?? "unknown error"),
        );
      }
      await refreshHomeDraftSummaries();
    }
    if (!state.page && state.project?.pages[0]) {
      await loadPage(state.project.pages[0]);
    }
  } catch (error) {
    // Never leave a half-open project: reset the editor session and return
    // to the start screen so the UI cannot act on a phantom project.
    pendingHomeDraftResume = null;
    state.project = null;
    state.siteDocument = null;
    state.pendingSiteDocument = null;
    state.pendingSiteEditorKind = null;
    resetOpenPageState();
    $("view-editor").classList.add("hidden");
    $("view-start").classList.remove("hidden");
    setStatus("");
    showModal(
      "Could Not Open Project",
      error instanceof Error ? error.message : String(error),
      [{ label: "OK", kind: "primary", onClick: closeModal }],
    );
  }
}

const editorGit = createEditorGitActions({
  getProjectPath: () => state.project?.path ?? null,
  setStatus,
  setGitStatus: updateGitStatus,
  onPullComplete: () => applyRepoRules(),
  zephus: window.zephus,
});

function renderPalette(): void {
  updateAllowedBlocks(editorRules.allowedBlocks);
}

async function renderTemplates(): Promise<void> {
  const allowed = editorRules.allowedBlocks;
  const htmlAllowed = !allowed || allowed.includes("html");
  const projectPath = state.project?.path;
  const saved = projectPath
    ? await window.zephus.listReusableSections(projectPath).catch(() => null)
    : null;
  // A stale write must not land: an unawaited renderTemplates from a previous
  // project could resolve after the user already opened another project and
  // overwrite its saved-sections cache with the old project's list.
  if (state.project?.path !== projectPath) return;
  // Built-in templates insert editable schema blocks; saved sections are
  // preserved HTML and only shown when HTML blocks are permitted.
  const savedSections = htmlAllowed && saved?.ok ? saved.sections : [];
  blockOps.setReusableSections(savedSections);
  const merged: SectionTemplate[] = [
    ...TEMPLATES.filter(templateAllowed),
    ...savedSections.map((section) => ({
      id: section.id,
      label: `${section.label} (Saved)`,
      html: section.html,
      deletable: true,
      onDelete: async () => {
        if (!projectPath) return;
        try {
          await window.zephus.deleteReusableSection(projectPath, section.id);
        } catch (error) {
          setStatus(
            "Could not delete: " +
              (error instanceof Error ? error.message : String(error)),
          );
          return;
        }
        await renderTemplates();
      },
    })),
  ];
  updateTemplates(merged);
}

/* ---------- Multi-page nav editor ---------- */

function pageToRoute(page: string): string {
  // src/pages/about.astro → /about, src/pages/index.astro → /
  const route = page
    .replace(/^src\/pages\/?/, "")
    .replace(/\.(astro|md|mdx|html)$/i, "");
  if (route === "index" || route === "") return "/";
  return "/" + route;
}

function normalizePageSlugInput(input: string): string | null {
  const normalized = input
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.(astro|md|mdx|html)$/i, "");
  if (!normalized) return "index";
  const safe = normalized
    .split("/")
    .map((segment) =>
      segment
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-_]+|[-_]+$/g, ""),
    )
    .filter(Boolean);
  return safe.length > 0 ? safe.join("/") : null;
}

function isReservedNotFoundSlug(slug: string): boolean {
  return slug === "404" || slug.startsWith("404/");
}

function findPageMeta(page: string): PageMeta | null {
  return state.pageMeta.find((entry) => entry.page === page) ?? null;
}

function syncCurrentMeta(): void {
  state.currentMeta = state.page ? findPageMeta(state.page) : null;
}

function renderNavEditor(result: ProjectOpenResult): void {
  const currentSite = effectiveSiteDocument(state);
  const entries = currentSite?.shell.navItems?.length
    ? currentSite.shell.navItems.filter((item) => item.visible)
    : state.pageMeta.length
      ? state.pageMeta
          .filter((entry) => entry.navVisible)
          .map((entry) => ({
            id: `nav-${entry.slug}`,
            label: entry.navLabel,
            href: entry.route,
            page: entry.page,
            visible: entry.navVisible,
            children: [],
          }))
      : result.pages.map((page) => ({
          id: `nav-${page}`,
          label: pageToRoute(page) === "/" ? "Home" : page,
          href: pageToRoute(page),
          page,
          visible: true,
          children: [],
        }));
  updateNavList(
    entries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      href: entry.href,
      page: "page" in entry && entry.page ? String(entry.page) : null,
    })),
    { showPageSettings: !!state.page },
  );
  refreshGuidancePanels();
}

async function regenerateNav(): Promise<void> {
  if (!state.project || !effectiveSiteDocument(state)) return;
  if (!(await resolveSiteEditorConflict("shell"))) return;
  const nextSite = cloneSiteDocument(
    effectiveSiteDocument(state),
  ) as SiteDocument;

  const currentEntries = nextSite.shell.navItems.length
    ? nextSite.shell.navItems
    : state.pageMeta.map((entry) => ({
        id: `nav-${entry.slug}`,
        label: entry.navLabel,
        href: entry.route,
        page: entry.page,
        visible: entry.navVisible,
        children: [],
      }));
  const rows: {
    entry: NavItem;
    label: string;
    visible: boolean;
  }[] = [];

  for (const entry of currentEntries) {
    rows.push({ entry, label: entry.label, visible: entry.visible });
  }

  const wrap = document.createElement("div");
  renderNavigationPreviewModal(
    wrap,
    rows.map((row) => ({
      id: row.entry.id,
      href: row.entry.href,
      label: row.label,
      visible: row.visible,
      onLabelChange: (value) => {
        row.label = value;
      },
      onVisibleChange: (value) => {
        row.visible = value;
      },
    })),
  );

  showModalNode("Navigation Preview", wrap, [
    { label: "Cancel", kind: "ghost", onClick: closeModal },
    {
      label: "Stage Navigation",
      kind: "primary",
      onClick: async () => {
        if (!state.project) return;
        for (const row of rows) {
          if (!row.entry.page) continue;
          try {
            const saved = await window.zephus.writePageMeta(
              state.project.path,
              row.entry.page,
              state.project.astro.pagesDir,
              {
                navLabel: row.label.trim() || row.entry.label,
                navVisible: row.visible,
              },
            );
            if (!saved.ok) {
              setStatus(
                "Could not save navigation: " +
                  (saved.error ?? "unknown error"),
              );
              return;
            }
            // Keep the session document in sync, or the next page save
            // regenerates from the stale doc and reverts this edit.
            if (state.pageDocument?.page === row.entry.page) {
              state.pageDocument = {
                ...state.pageDocument,
                navLabel: row.label.trim() || row.entry.label,
                navVisible: row.visible,
              };
            }
          } catch (error) {
            setStatus(
              "Could not save navigation: " +
                (error instanceof Error ? error.message : String(error)),
            );
            return;
          }
        }
        nextSite.shell.layoutMode = "managed";
        nextSite.shell.navItems = rows.map((row) => ({
          ...row.entry,
          label: row.label.trim() || row.entry.label,
          visible: row.visible,
        }));
        closeModal();
        await writeSiteDocumentFromRenderer(
          nextSite,
          "shell",
          "Updated navigation",
          "Staged navigation changes. Click Save to write them.",
        );
        await reloadPages();
      },
    },
  ]);
}

function renderEditorStateBanner(): void {
  const host = $("editor-state-banner");
  const banners: Array<{
    tone: "warning" | "info";
    message: string;
    actions: Array<{ label: string; onClick: () => void }>;
  }> = [];

  const addBanner = (
    tone: "warning" | "info",
    message: string,
    actions: Array<{ label: string; onClick: () => void }>,
  ) => {
    banners.push({ tone, message, actions });
  };

  if (state.managedStatus === "detached" && state.page && state.project) {
    addBanner(
      "warning",
      "This page is detached from visual mode. Reattach it to resume GUI editing.",
      [
        {
          label: "Reattach Visual",
          onClick: () => {
            void (async () => {
              if (!state.project || !state.page) return;
              // Unsaved code edits must not vanish silently: resolve them
              // (save/discard/cancel) before the reattach overwrites the doc.
              const resolved = await maybeResolveUnsavedWork();
              if (!resolved) return;
              const reattached = await window.zephus.reattachPageDocument(
                state.project.path,
                state.page,
                state.project.astro.pagesDir,
              );
              if (!reattached.ok) {
                setStatus(
                  "Reattach failed: " + (reattached.error ?? "unknown"),
                );
                return;
              }
              await loadPage(state.page, {
                skipUnsavedGuard: true,
                skipDraftRestore: true,
                forceReload: true,
              });
            })();
          },
        },
      ],
    );
  }

  if (state.managedStatus === "out-of-sync" && state.page) {
    addBanner(
      "warning",
      "The current managed page has changed on disk and is out of sync with the visual model.",
      [
        {
          label: "Reload From Disk",
          onClick: () => {
            const page = state.page;
            const projectPath = state.project?.path;
            if (!page || !projectPath) return;
            void (async () => {
              // Unsaved edits must not be silently dropped by the reload.
              const resolved = await maybeResolveUnsavedWork();
              if (!resolved) return;
              void loadPage(page, {
                skipUnsavedGuard: true,
                skipDraftRestore: true,
                forceReload: true,
                afterLoad: async () => {
                  await clearPageDraftAfterReload(projectPath, page);
                },
              });
            })();
          },
        },
        {
          label: "Detach In Code",
          onClick: () => {
            setMode("code");
            setStatus(
              "Edit in code and save to detach this page from visual mode.",
            );
          },
        },
      ],
    );
  }

  if (state.recoveredPageDraft && state.page && state.project) {
    addBanner(
      "info",
      `Recovered unsaved draft for ${currentPageLabel()}. Save to keep it, or discard to return to the last saved page.`,
      [
        {
          label: "Keep Draft",
          onClick: () => {
            state.recoveredPageDraft = null;
            renderDirtyIndicators();
          },
        },
        {
          label: "Discard Draft",
          onClick: () => {
            const page = state.page;
            const projectPath = state.project?.path;
            if (!page || !projectPath) return;
            void loadPage(page, {
              skipUnsavedGuard: true,
              skipDraftRestore: true,
              forceReload: true,
              afterLoad: async () => {
                await clearPageDraftAfterReload(projectPath, page);
              },
            });
          },
        },
      ],
    );
  }

  if (state.siteDirty) {
    addBanner(
      "info",
      state.recoveredSiteDraft
        ? "Recovered unsaved site settings. Save them to apply, or discard to return to the last saved shell and design state."
        : "You have unsaved site shell or design settings pending.",
      [
        {
          label: "Save Site Settings",
          onClick: () => {
            void persistPendingSiteDocument();
          },
        },
        {
          label: "Discard",
          onClick: () => {
            void discardPendingSiteChanges();
          },
        },
      ],
    );
  }

  if (panelMountFailures.length > 0) {
    addBanner(
      "warning",
      formatPanelMountFailureStatus(panelMountFailures) +
        (panelMountFailures.includes("Canvas")
          ? " Reload the window to retry the canvas."
          : " Some sidebar panels may be unavailable."),
      panelMountFailures.includes("Canvas")
        ? [
            {
              label: "Reload Window",
              onClick: () => window.location.reload(),
            },
          ]
        : [],
    );
  }

  updateEditorStateBanners(banners);
  host.classList.toggle("hidden", banners.length === 0);
}

function renderLayers(): void {
  updateLayers(
    state.sections.map((section) => ({
      id: section.id,
      label: section.label,
      active: section.id === state.selectedSectionId && !state.selectedId,
      children: section.children.map((child) => ({
        id: child.id,
        label: blockLabel(child as Block),
        active: state.selectedId === child.id,
      })),
    })),
  );
}

async function writeSiteDocumentFromRenderer(
  nextSite: SiteDocument,
  editorKind: SiteEditorKind,
  changeLabel: string,
  statusMessage: string,
): Promise<void> {
  if (!state.project || !state.siteDocument) return;
  if (JSON.stringify(nextSite) === JSON.stringify(state.siteDocument)) {
    await discardPendingSiteChanges();
    setStatus("No site-level changes to keep.");
    return;
  }
  pushUndo(); // capture pre-change design/shell so the edit is undoable
  state.pendingSiteDocument = cloneSiteDocument(nextSite);
  state.pendingSiteEditorKind = editorKind;
  trackSiteChange(state, changeLabel);
  markSiteDirty(state, true);
  renderDirtyIndicators();
  scheduleDraftWrite();
  if (state.project) {
    renderNavEditor(state.project);
  }
  // Live design feedback: staged design tokens must reach the canvas CSS
  // variables immediately, not on the next unrelated repaint.
  applyDesignPreview();
  setStatus(statusMessage);
}

async function openSiteShellModal(): Promise<void> {
  if (!state.project || !effectiveSiteDocument(state)) return;
  if (!(await resolveSiteEditorConflict("shell"))) return;
  const nextSite = cloneSiteDocument(
    effectiveSiteDocument(state),
  ) as SiteDocument;
  const shellState = {
    siteTitle: nextSite.shell.siteTitle,
    siteUrlError: "" as string,
    logoText: nextSite.shell.logoText,
    announcementText: nextSite.shell.announcementText,
    announcementVisible: nextSite.shell.announcementVisible,
    ctaLabel: nextSite.shell.navCtaLabel,
    ctaHref: nextSite.shell.navCtaHref,
    footerHtml: nextSite.shell.footerHtml,
    customHeadHtml: nextSite.shell.customHeadHtml,
    siteUrl: nextSite.siteUrl ?? "",
    language: nextSite.language ?? "en",
    faviconPath: nextSite.faviconPath ?? "",
  };

  const wrap = document.createElement("div");
  let shellModalDispose: (() => void) | null = null;
  const mountShellModal = () => {
    shellModalDispose?.();
    shellModalDispose = renderSiteShellModalBody(wrap, {
      siteTitle: shellState.siteTitle,
      logoText: shellState.logoText,
      announcementText: shellState.announcementText,
      announcementVisible: shellState.announcementVisible,
      ctaLabel: shellState.ctaLabel,
      ctaHref: shellState.ctaHref,
      footerHtml: shellState.footerHtml,
      customHeadHtml: shellState.customHeadHtml,
      onSiteTitleChange: (value) => {
        shellState.siteTitle = value;
      },
      onLogoTextChange: (value) => {
        shellState.logoText = value;
      },
      onAnnouncementTextChange: (value) => {
        shellState.announcementText = value;
      },
      onAnnouncementVisibleChange: (value) => {
        shellState.announcementVisible = value;
      },
      onCtaLabelChange: (value) => {
        shellState.ctaLabel = value;
      },
      onCtaHrefChange: (value) => {
        shellState.ctaHref = value;
      },
      onPickCtaHref: () => {
        openLinkPicker(shellState.ctaHref, (href) => {
          shellState.ctaHref = href;
          mountShellModal();
        });
      },
      onFooterHtmlChange: (value) => {
        shellState.footerHtml = value;
      },
      onCustomHeadHtmlChange: (value) => {
        shellState.customHeadHtml = value;
      },
      siteUrl: shellState.siteUrl,
      siteUrlError: shellState.siteUrlError || undefined,
      language: shellState.language,
      faviconPath: shellState.faviconPath,
      onSiteUrlChange: (value) => {
        shellState.siteUrl = value;
      },
      onLanguageChange: (value) => {
        shellState.language = value;
      },
      onFaviconPathChange: (value) => {
        shellState.faviconPath = value;
      },
      onPickFavicon: () => {
        openAssetBrowser({
          filter: "images",
          title: "Choose Favicon",
          onSelect: (webPath) => {
            shellState.faviconPath = webPath;
            mountShellModal();
          },
        });
      },
    });
    registerCleanup(shellModalDispose);
  };
  mountShellModal();

  showModalNode(
    "Site Shell",
    wrap,
    [
      { label: "Cancel", kind: "ghost", onClick: closeModal },
      {
        label: "Stage Shell",
        kind: "primary",
        onClick: async () => {
          const newFooter = shellState.footerHtml.trim();
          const newHead = shellState.customHeadHtml.trim();
          const hadFooter = Boolean(nextSite.shell.footerHtml.trim());
          const hadHead = Boolean(nextSite.shell.customHeadHtml.trim());
          // Gate: warn user when they first add raw HTML (they might not
          // understand it injects unescaped content into their site).
          if ((newFooter && !hadFooter) || (newHead && !hadHead)) {
            const proceed = await modalController.confirmDestructive(
              "Custom HTML Warning",
              "Footer HTML and Custom head HTML are injected directly into " +
                "your site without escaping. Only add content you trust " +
                "(analytics, fonts, embeds). Proceed?",
              "I understand, save it",
            );
            if (!proceed) return;
          }
          nextSite.shell.layoutMode = "managed";
          nextSite.shell.siteTitle =
            shellState.siteTitle.trim() || nextSite.siteName;
          nextSite.shell.logoText =
            shellState.logoText.trim() || nextSite.siteName;
          nextSite.shell.announcementText = shellState.announcementText.trim();
          nextSite.shell.announcementVisible = shellState.announcementVisible;
          nextSite.shell.navCtaLabel = shellState.ctaLabel.trim();
          nextSite.shell.navCtaHref = shellState.ctaHref.trim() || "#";
          nextSite.shell.footerHtml = shellState.footerHtml.trim();
          nextSite.shell.customHeadHtml = shellState.customHeadHtml.trim();
          const normalizedSiteUrl = normalizeSiteUrl(shellState.siteUrl);
          if (normalizedSiteUrl === null) {
            // Inline error: the status bar sits UNDER the modal overlay, so
            // the old setStatus failure was completely invisible.
            shellState.siteUrlError =
              "Site URL must be a full http(s) address, for example https://example.com.";
            mountShellModal();
            return;
          }
          nextSite.siteUrl = normalizedSiteUrl;
          nextSite.language = shellState.language.trim() || "en";
          nextSite.faviconPath = shellState.faviconPath.trim();
          closeModal();
          await writeSiteDocumentFromRenderer(
            nextSite,
            "shell",
            "Updated site shell settings",
            "Staged site shell changes. Click Save to write them.",
          );
        },
      },
    ],
    { size: "wide" },
  );
  registerCleanup(shellModalDispose);
}

/**
 * Validates the site URL and strips any trailing slash. Returns null when the
 * value is not a usable absolute http(s) origin, so the caller can reject it —
 * a malformed base would otherwise produce broken canonical/sitemap URLs.
 */
function normalizeSiteUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const candidate = /^[a-z][\w+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") {
    return null;
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

async function openDesignSystemModal(): Promise<void> {
  if (!state.project || !effectiveSiteDocument(state)) return;
  if (!(await resolveSiteEditorConflict("design"))) return;
  const nextSite = cloneSiteDocument(
    effectiveSiteDocument(state),
  ) as SiteDocument;
  const designState = {
    accent: nextSite.design.accent,
    background: nextSite.design.background,
    foreground: nextSite.design.foreground,
    surface: nextSite.design.surface,
    bodyFont: nextSite.design.fontFamily,
    bodyFontGoogle: googleFontForStack(nextSite.design.fontFamily),
    headingFont: nextSite.design.headingFontFamily,
    headingFontGoogle: googleFontForStack(nextSite.design.headingFontFamily),
    radius: nextSite.design.radius,
    containerWidth: nextSite.design.containerWidth,
    shadow: nextSite.design.shadow,
  };

  const wrap = document.createElement("div");
  renderDesignSystemModalBody(wrap, {
    accent: designState.accent,
    background: designState.background,
    foreground: designState.foreground,
    surface: designState.surface,
    bodyFont: designState.bodyFont,
    headingFont: designState.headingFont,
    radius: designState.radius,
    containerWidth: designState.containerWidth,
    shadow: designState.shadow,
    onAccentChange: (value) => {
      designState.accent = value;
    },
    onBackgroundChange: (value) => {
      designState.background = value;
    },
    onForegroundChange: (value) => {
      designState.foreground = value;
    },
    onSurfaceChange: (value) => {
      designState.surface = value;
    },
    onBodyFontChange: (stack, google) => {
      designState.bodyFont = stack;
      designState.bodyFontGoogle = google;
    },
    onHeadingFontChange: (stack, google) => {
      designState.headingFont = stack;
      designState.headingFontGoogle = google;
    },
    onRadiusChange: (value) => {
      designState.radius = value;
    },
    onContainerWidthChange: (value) => {
      designState.containerWidth = value;
    },
    onShadowChange: (value) => {
      designState.shadow = value;
    },
  });

  showModalNode("Design System", wrap, [
    { label: "Cancel", kind: "ghost", onClick: closeModal },
    {
      label: "Stage Design",
      kind: "primary",
      onClick: async () => {
        // A staged accent must not reference itself: --zephus-accent:
        // var(--accent) resolves to nothing and silently strips the brand
        // color from every link/CTA/announcement.
        if (/var\(\s*--accent\s*\)/i.test(designState.accent.trim())) {
          setStatus(
            "Accent color cannot reference itself (var(--accent)). Pick a concrete color.",
          );
          return;
        }
        nextSite.shell.layoutMode = "managed";
        nextSite.design.accent = designState.accent.trim();
        nextSite.design.background = designState.background.trim();
        nextSite.design.foreground = designState.foreground.trim();
        nextSite.design.surface = designState.surface.trim();
        // Empty custom font stacks silently emitted an invalid CSS variable
        // (every font inherited). Fall back to the existing/current stack.
        const currentFonts = nextSite.design.fontFamily;
        nextSite.design.fontFamily =
          designState.bodyFont.trim() || currentFonts;
        nextSite.design.headingFontFamily =
          designState.headingFont.trim() || currentFonts;
        const googleSpecs = [
          designState.bodyFontGoogle,
          designState.headingFontGoogle,
        ].filter(Boolean) as string[];
        // Staging with zero font changes must PRESERVE the existing Google
        // Fonts link — previously buildFontImportUrl([]) returned "" and the
        // themed site's font link silently vanished from the build.
        nextSite.design.fontImportUrl =
          googleSpecs.length > 0
            ? buildFontImportUrl(googleSpecs)
            : (nextSite.design.fontImportUrl ?? "");
        nextSite.design.radius = designState.radius.trim();
        nextSite.design.containerWidth = designState.containerWidth.trim();
        nextSite.design.shadow = designState.shadow;
        closeModal();
        await writeSiteDocumentFromRenderer(
          nextSite,
          "design",
          "Updated design system settings",
          "Staged design system changes. Click Save to write them.",
        );
      },
    },
  ]);
}

/**
 * Loads repository-scoped editing rules (.zephus settings) and applies them to
 * the editing surface. Falls back to defaults and notifies on malformed rules.
 */
async function applyRepoRules(): Promise<void> {
  const projectPath = state.project?.path ?? null;
  const sessionGeneration = editorSessionGeneration;
  editorRules.allowedBlocks = null;
  editorRules.maxHeadingLevel = 6;
  if (!projectPath) return;
  try {
    const settings = (await window.zephus.readRepoSettings(projectPath)) as {
      editorRules?: Record<string, unknown>;
    } | null;
    if (
      state.project?.path !== projectPath ||
      editorSessionGeneration !== sessionGeneration
    ) {
      return;
    }
    const rules = settings?.editorRules ?? {};
    const allowed = rules["allowedBlocks"];
    if (Array.isArray(allowed) && allowed.every((x) => typeof x === "string")) {
      editorRules.allowedBlocks = allowed as string[];
    }
    const maxLevel = rules["maxHeadingLevel"];
    if (typeof maxLevel === "number" && maxLevel >= 1 && maxLevel <= 6) {
      editorRules.maxHeadingLevel = maxLevel;
    }
  } catch {
    if (
      state.project?.path !== projectPath ||
      editorSessionGeneration !== sessionGeneration
    ) {
      return;
    }
    setStatus("Custom editor rules could not be applied; using defaults.");
  }
  renderPalette();
  void renderTemplates();
}

async function applyMergedTheme(): Promise<void> {
  if (!state.project) return;
  try {
    const merged = await window.zephus.getMergedSettings(state.project.path);
    const theme = merged.theme;
    document.documentElement.setAttribute("data-theme", theme);
  } catch {
    // Non-fatal.
  }
}

function renderPageList(result: ProjectOpenResult): void {
  const entries = state.pageMeta.length
    ? state.pageMeta
    : result.pages.map((page) => ({
        page,
        route: pageToRoute(page),
        slug: pageToRoute(page) === "/" ? "index" : pageToRoute(page).slice(1),
        title: pageToRoute(page) === "/" ? "Home" : page,
        navLabel: pageToRoute(page) === "/" ? "Home" : page,
        metaDescription: "",
        navVisible: true,
        isHome: pageToRoute(page) === "/",
        detached: false,
      }));
  updatePageList(
    entries.map((entry) => ({
      page: entry.page,
      route: entry.route,
      navLabel: entry.navLabel,
      navVisible: entry.navVisible,
      detached: entry.detached,
      active: entry.page === state.page,
      loading: entry.page === loadingPage,
      interactionDisabled: loadingPage !== null,
    })),
  );
}

function openHelpModal(): void {
  const content = document.createElement("div");
  renderHelpModal(content);
  showModalNode("Keyboard Shortcuts & Help", content, [
    { label: "Close", kind: "primary", onClick: closeModal },
  ]);
}

async function reloadPages(): Promise<void> {
  const project = state.project;
  if (!project) return;
  const projectPath = project.path;
  const pagesDir = project.astro.pagesDir;
  const [pages, meta, site] = await Promise.all([
    window.zephus.listPages(projectPath, pagesDir),
    window.zephus.listPageMeta(projectPath, pagesDir),
    window.zephus.readSiteDocument(projectPath),
  ]);
  if (state.project?.path !== projectPath) return;
  project.pages = pages;
  state.pageMeta = meta.ok ? meta.entries : [];
  if (site.ok && site.site && !state.siteDirty) {
    // Keep the staging baseline while the user has staged (unsaved) site
    // changes: replacing it with the disk copy would let a later save
    // silently overwrite external site.json edits made since staging.
    const siteChanged =
      JSON.stringify(state.siteDocument) !== JSON.stringify(site.site);
    state.siteDocument = site.site;
    if (siteChanged && (state.undo.length > 0 || state.redo.length > 0)) {
      // Undo snapshots captured the OLD site document; undoing a page edit
      // would stage the stale site and claim "Reverted a design change".
      state.undo = [];
      state.redo = [];
      updateUndoRedoButtons();
    }
  }
  syncCurrentMeta();
  renderPageList(project);
  renderNavEditor(project);
  refreshGuidancePanels();
}

async function newPageFlow(): Promise<void> {
  if (!state.project) return;
  let nextName = "";
  const wrap = document.createElement("div");
  renderNewPageModal(wrap, {
    value: nextName,
    onValueChange: (value) => {
      nextName = value;
    },
  });

  showModalNode("New Page", wrap, [
    { label: "Cancel", kind: "ghost", onClick: closeModal },
    {
      label: "Create Page",
      kind: "primary",
      onClick: async () => {
        const name = nextName.trim();
        if (!name || !state.project) return;
        closeModal();
        const r = await window.zephus.createPage(
          state.project.path,
          name,
          state.project.astro.pagesDir,
        );
        if (!r.ok) {
          setStatus("Create page failed: " + r.error);
          return;
        }
        await reloadPages();
        // Match the NORMALIZED slug ("My Page" -> "my-page"), or the list
        // may have refreshed with the normalized name while the raw input
        // still holds the original — the page would be created but never
        // opened and the editor would stay on the old page. Mirrors the
        // main-process slug normalization (schema.ts).
        const normalizedName = name
          .toLowerCase()
          .replace(/[^a-z0-9-_]+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^[-_]+|[-_]+$/g, "");
        const created = state.pageMeta.find(
          (entry) =>
            entry.slug === name ||
            entry.slug === normalizedName ||
            entry.route === "/" + name,
        );
        if (created) await loadPage(created.page);
        setStatus("Created page " + name);
      },
    },
  ]);
}

/** Eye toggle in the page list: show/hide a page in the navigation. */
async function togglePageNavVisibility(page: string): Promise<void> {
  if (!state.project) return;
  const entry = state.pageMeta.find((meta) => meta.page === page);
  if (!entry) return;
  if (entry.slug === "404" || entry.slug.startsWith("404/")) {
    setStatus("The 404 page is always hidden from navigation.");
    return;
  }
  const nextVisible = !entry.navVisible;
  // Push an undo snapshot BEFORE mutating: the eye toggle is a user mutation
  // and must be undoable (Ctrl+Z restores the nav visibility + the site
  // baseline). Without this, a fresh-session toggle was undo-less, and an
  // unrelated later undo would pop a snapshot holding the pre-toggle site
  // and "revert the toggle" as a side effect.
  pushUndo();
  const result = await window.zephus.writePageMeta(
    state.project.path,
    page,
    state.project.astro.pagesDir,
    { navVisible: nextVisible },
  );
  if (!result.ok) {
    setStatus("Could not update navigation: " + (result.error ?? "unknown"));
    return;
  }
  const meta = state.pageMeta.find((m) => m.page === page);
  if (meta) meta.navVisible = nextVisible;
  // Keep the session document in sync, or the next page save regenerates from
  // the stale doc and silently reverts the visibility edit.
  if (state.pageDocument?.page === page) {
    state.pageDocument = { ...state.pageDocument, navVisible: nextVisible };
  }
  // The layout + site.json navItems were resynced on disk by the write; the
  // in-memory site baseline is stale, and renderNavEditor prefers
  // siteDocument.shell.navItems — so refresh the baseline (without touching
  // any staged site edits) before re-rendering, or the panel shows the old
  // visibility until the next page switch/save.
  if (state.project) {
    const fresh = await window.zephus.readSiteDocument(state.project.path);
    // Guard the baseline like reloadPages/loadPageNow do: swapping it while a
    // staged site edit exists silently rebases pendingSiteDocument, and the
    // next site save passes the drift check and overwrites the navItems just
    // written to disk (reverting this toggle).
    if (fresh.ok && fresh.site && !state.siteDirty) {
      state.siteDocument = fresh.site;
    }
    renderNavEditor(state.project);
    renderPageList(state.project);
  }
  setStatus(
    nextVisible
      ? `Added ${entry.navLabel} to the navigation.`
      : `Hidden ${entry.navLabel} from the navigation.`,
  );
}

function buildUnsavedWorkSummary(): HTMLElement {
  const wrap = document.createElement("div");
  renderUnsavedWorkSummaryModalBody(
    wrap,
    collectUnsavedWorkSummaryLines({
      pageDirty: state.pageDirty,
      pageChangeSummary: state.pageChangeSummary,
      pageFallbackLabel: `Unsaved page edits for ${currentPageLabel()}`,
      siteDirty: state.siteDirty,
      siteChangeSummary: state.siteChangeSummary,
    }),
  );
  return wrap;
}

async function discardPendingSiteChanges(): Promise<void> {
  await editorSiteSave.discardPendingSiteChanges();
  // Staging a site change pushed a pre-staging snapshot; after discarding,
  // the current state equals that snapshot — the top undo entry is a visible
  // no-op that would also pollute redo. Drop it.
  const top = state.undo[state.undo.length - 1];
  if (top) {
    const currentSite = effectiveSiteDocument(state);
    const siteMatches =
      JSON.stringify(top.site) === JSON.stringify(currentSite);
    if (!editorSnapshotSectionsChanged(top, state.sections) && siteMatches) {
      state.undo.pop();
      updateUndoRedoButtons();
    }
  }
}

async function persistPendingSiteDocument(): Promise<boolean> {
  return editorSiteSave.persistPendingSiteDocument();
}

async function maybeRestoreSiteDraft(): Promise<string | null> {
  return editorDraftRestore.maybeRestoreSiteDraft();
}

async function saveUnsavedWorkAndVerify(): Promise<boolean> {
  const projectPath = state.project?.path ?? null;
  const page = state.page;
  const saved = await performSave();
  if (!saved) return false;
  const safeToLeave =
    state.project?.path === projectPath &&
    state.page === page &&
    !isGlobalDirty(state);
  if (!safeToLeave) {
    setStatus(
      "The saved snapshot is safe, but newer edits are still unsaved. Finish saving or discard them before leaving.",
    );
  }
  return safeToLeave;
}

async function maybeResolveUnsavedWork(options?: {
  reloadCurrentPageOnDiscard?: boolean;
}): Promise<boolean> {
  if (!isGlobalDirty(state)) return true;
  if (appSettings?.autosave) {
    return saveUnsavedWorkAndVerify();
  }
  const choice = await modalController.confirmUnsavedWork(
    "Unsaved Changes",
    buildUnsavedWorkSummary(),
  );
  if (choice === "cancel") return false;
  if (choice === "save") return saveUnsavedWorkAndVerify();

  const projectPath = state.project?.path ?? null;
  const page = state.page;
  const pageRevision = state.pageRevision;
  const siteRevision = state.siteRevision;
  if (projectPath && state.pageDirty && page) {
    const cleared = await window.zephus.clearDraft(projectPath, "page", page);
    if (!cleared.ok) {
      setStatus(
        "Could not discard page changes: " +
          (cleared.error ?? "recovery draft cleanup failed"),
      );
      return false;
    }
    if (
      state.project?.path !== projectPath ||
      state.page !== page ||
      state.pageRevision !== pageRevision ||
      state.siteRevision !== siteRevision
    ) {
      setStatus("New edits were made while discarding; they were kept.");
      scheduleDraftWrite();
      return false;
    }
    clearChanges();
    markDirty(false);
  }
  if (state.project && state.siteDirty) {
    await discardPendingSiteChanges();
  }
  if (
    state.project?.path !== projectPath ||
    state.page !== page ||
    state.pageRevision !== pageRevision ||
    state.siteRevision !== siteRevision ||
    isGlobalDirty(state)
  ) {
    setStatus("New edits were made while discarding; they were kept.");
    scheduleDraftWrite();
    return false;
  }
  if (options?.reloadCurrentPageOnDiscard && state.project && state.page) {
    await loadPage(state.page, {
      skipUnsavedGuard: true,
      skipDraftRestore: true,
      forceReload: true,
    });
    if (
      state.project?.path !== projectPath ||
      state.page !== page ||
      isGlobalDirty(state)
    ) {
      return false;
    }
  }
  return true;
}

async function persistSiteChangesAndVerify(): Promise<boolean> {
  const projectPath = state.project?.path ?? null;
  const saved = await persistPendingSiteDocument();
  const safeToSwitch =
    saved && state.project?.path === projectPath && !state.siteDirty;
  if (saved && !safeToSwitch) {
    setStatus(
      "Newer site edits are still unsaved. Save or discard them before switching editors.",
    );
  }
  return safeToSwitch;
}

async function resolveSiteEditorConflict(
  kind: SiteEditorKind,
): Promise<boolean> {
  if (
    !state.siteDirty ||
    !state.pendingSiteEditorKind ||
    state.pendingSiteEditorKind === kind
  ) {
    return true;
  }
  if (appSettings?.autosave) {
    return persistSiteChangesAndVerify();
  }
  const choice = await modalController.confirmUnsavedWork(
    "Unsaved Site Settings",
    buildUnsavedWorkSummary(),
  );
  if (choice === "cancel") return false;
  if (choice === "save") return persistSiteChangesAndVerify();
  await discardPendingSiteChanges();
  return !state.siteDirty;
}

async function clearPageDraftAfterReload(
  projectPath: string,
  page: string,
): Promise<void> {
  const cleared = await window.zephus.clearDraft(projectPath, "page", page);
  if (!cleared.ok) {
    throw new Error(cleared.error ?? "recovery draft cleanup failed");
  }
}

interface PageLoadOptions {
  skipUnsavedGuard?: boolean;
  skipDraftRestore?: boolean;
  /** Restore the recovery draft WITHOUT prompting (home-screen resume). */
  restoreDraftSilently?: boolean;
  forceReload?: boolean;
  afterLoad?: () => void | Promise<void>;
}

let editorSessionGeneration = 0;
let latestPageLoadRequest = 0;
let loadingPage: string | null = null;
let closingProject = false;
let pageLoadChain: Promise<void> = Promise.resolve();
let externalChangeInFlight: Promise<void> | null = null;
let externalChangeQueued = false;
let ignoredExternalChange: {
  projectPath: string;
  page: string;
  /** null when the file could not be read (missing/unreadable). */
  content: string | null;
} | null = null;

function setPageLoading(page: string | null): void {
  loadingPage = page;
  const canvas = $("canvas");
  const busy = page !== null;
  canvas.classList.toggle("loading", busy);
  if (busy) {
    canvas.setAttribute("aria-busy", "true");
    canvas.dataset["loadingLabel"] =
      `Loading ${findPageMeta(page)?.navLabel ?? page}…`;
  } else {
    canvas.removeAttribute("aria-busy");
    delete canvas.dataset["loadingLabel"];
  }

  const interactionSurfaces = [
    canvas,
    $("code-editor"),
    $("workspace-left-build"),
    $("workspace-left-layers"),
    $("nav-list"),
    document.querySelector<HTMLElement>(".panel.right"),
  ];
  for (const surface of interactionSurfaces) {
    surface?.toggleAttribute("inert", busy);
  }
  for (const id of [
    "mode-visual",
    "mode-code",
    "btn-save",
    "btn-new-page",
    "btn-find-replace",
    "btn-regen-nav",
    "btn-site-shell",
    "btn-design-system",
    "btn-preview",
    "btn-publish",
    "btn-close",
    "btn-undo",
    "btn-redo",
    "vp-desktop",
    "vp-tablet",
    "vp-mobile",
  ] as const) {
    ($(id) as HTMLButtonElement).disabled = busy;
  }
  if (!busy) syncVisualModeState();
  updateUndoRedoButtons();
  if (state.project) renderPageList(state.project);
}

function loadPage(page: string, options?: PageLoadOptions): Promise<void> {
  const projectPath = state.project?.path;
  if (!projectPath) return Promise.resolve();
  const requestId = ++latestPageLoadRequest;
  setPageLoading(page);
  const run = pageLoadChain.then(() =>
    loadPageNow(page, projectPath, requestId, options),
  );
  const handled = run.catch((error: unknown) => {
    if (
      requestId === latestPageLoadRequest &&
      state.project?.path === projectPath
    ) {
      setStatus(
        `Could not load ${page}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  pageLoadChain = handled.finally(() => {
    if (requestId === latestPageLoadRequest) setPageLoading(null);
  });
  return pageLoadChain;
}

async function loadPageNow(
  page: string,
  projectPath: string,
  requestId: number,
  options?: PageLoadOptions,
): Promise<void> {
  const isCurrentRequest = (): boolean =>
    requestId === latestPageLoadRequest && state.project?.path === projectPath;

  await editorSave.waitForIdle();
  if (!isCurrentRequest()) return;
  if (page === state.page && !options?.forceReload) return;
  if (!options?.skipUnsavedGuard && !(await maybeResolveUnsavedWork())) {
    return;
  }
  if (!isCurrentRequest()) return;

  const sourcePage = state.page;
  const pageRevisionAtRead = state.pageRevision;
  const siteRevisionAtRead = state.siteRevision;
  const codeAtRead = state.mode === "code" ? getCode() : null;
  const sourceChangedDuringRead = (): boolean =>
    state.page !== sourcePage ||
    state.pageRevision !== pageRevisionAtRead ||
    state.siteRevision !== siteRevisionAtRead ||
    (codeAtRead !== null && getCode() !== codeAtRead);

  const project = state.project;
  if (!project) return;
  setStatus(`Loading ${findPageMeta(page)?.navLabel ?? page}…`);
  const res = await window.zephus.readPageDocument(
    projectPath,
    page,
    project.astro.pagesDir,
  );
  if (!isCurrentRequest()) return;
  if (sourceChangedDuringRead()) {
    setStatus(
      "Page switch canceled because the open page changed while the next page was loading.",
    );
    return;
  }
  if (!res.ok || !res.pageDocument) {
    setStatus("Could not load " + page + ": " + (res.error ?? "unknown"));
    return;
  }

  const nextManagedStatus = res.pageDocument.managedFileStatus;
  const nextVisualEditable = nextManagedStatus !== "detached";
  const initialSource = res.source ?? "";
  const generatedSource = res.generatedSource ?? initialSource;
  let pageDraftCleanupWarning: string | undefined;
  let restoredPageContent: string | undefined;
  let restoredPageDraft: DraftData | undefined;
  if (!options?.skipDraftRestore) {
    // The visual draft was written as serializeBlocks() — the RENDERER's
    // serialization of the live state. Comparing it against the main-side
    // generatedSource can never be byte-equal (different body indentation,
    // post-index source), which forced a bogus "Restore unsaved draft"
    // prompt for already-saved content. Compare against the renderer's own
    // serialization of the SAVED document instead: equality then means the
    // live state would serialize identically — nothing to restore.
    const savedRendererSource =
      nextVisualEditable && res.pageDocument
        ? (() => {
            const savedFrame = splitManagedPageSource(generatedSource);
            return assembleManagedPage(
              savedFrame.frame,
              sectionsFromPageDocument(res.pageDocument),
              (block) => blockToHtml(block as Block, "desktop", false),
            );
          })()
        : nextVisualEditable
          ? generatedSource
          : initialSource;
    const draftOutcome = await editorDraftRestore.maybeRestorePageDraft(
      page,
      findPageMeta(page)?.navLabel ?? page,
      savedRendererSource,
      options?.restoreDraftSilently ? { skipPrompt: true } : undefined,
    );
    pageDraftCleanupWarning = draftOutcome.cleanupWarning;
    restoredPageContent = draftOutcome.restoredContent;
    restoredPageDraft = draftOutcome.restoredDraft;
  }
  if (!isCurrentRequest()) return;

  // Commit the complete page in one synchronous step. Until draft resolution
  // finishes, the current editor session remains untouched, so a superseding
  // request can safely abandon this candidate without leaving partial state.
  const frameSource =
    restoredPageContent && nextVisualEditable
      ? restoredPageContent
      : initialSource;
  const { frame, inner } = splitManagedPageSource(frameSource);
  const nextSections =
    restoredPageContent && nextVisualEditable
      ? parseSections(inner)
      : sectionsFromPageDocument(res.pageDocument);

  ignoredExternalChange = null;
  state.page = page;
  if (!state.siteDirty) {
    // See reloadPages: never swap the staging baseline mid-staging.
    state.siteDocument = res.site;
  }
  state.pageDocument = res.pageDocument;
  state.managedStatus = nextManagedStatus;
  state.visualEditable = nextVisualEditable;
  state.frontmatter = frame.frontmatter;
  state.prefix = frame.prefix;
  state.suffix = frame.suffix;
  syncCurrentMeta();
  state.sections = nextSections;
  syncBlocksFromSections();
  state.generatedCode = res.generatedSource ?? currentManagedSource();
  state.rawCode =
    restoredPageContent ??
    (state.visualEditable ? state.generatedCode : initialSource);
  state.recoveredPageDraft = restoredPageDraft ?? null;

  state.undo = [];
  state.redo = [];
  updateUndoRedoButtons();
  state.selectedId = null;
  state.selectedSectionId = state.sections[0]?.id ?? null;
  clearChanges();
  markDirty(Boolean(state.recoveredPageDraft));
  const loadedPageRevision = state.pageRevision;
  const loadedSiteRevision = state.siteRevision;
  renderLayers();

  for (const li of Array.from($("page-list").children) as HTMLElement[]) {
    li.classList.toggle("active", li.dataset["page"] === page);
  }
  syncVisualModeState();
  setCode(state.rawCode);
  setMode(state.visualEditable ? "visual" : "code");
  renderDirtyIndicators();

  // Watch the open file for external changes. Serialized page loads guarantee
  // that an older request cannot replace the watcher for a newer page.
  if (!isCurrentRequest()) return;
  await window.zephus.watchFile(projectPath, page).catch(() => {
    setStatus("Warning: could not watch the page for external edits.");
  });
  if (!isCurrentRequest()) return;
  if (pageDraftCleanupWarning) {
    setStatus(pageDraftCleanupWarning);
  } else if (state.managedStatus === "out-of-sync") {
    setStatus(
      "Managed page drift detected. Save visually to overwrite or edit in code and detach.",
    );
  } else if (state.managedStatus === "detached") {
    setStatus(
      "Detached page loaded in code mode. Reattach it from the editor banner or Page Settings to restore visual editing.",
    );
  } else {
    setStatus("Editing " + page);
  }

  if (options?.afterLoad) {
    if (
      state.pageRevision !== loadedPageRevision ||
      state.siteRevision !== loadedSiteRevision
    ) {
      setStatus(
        `Editing ${page}; recovery cleanup was postponed because newer edits exist.`,
      );
      return;
    }
    try {
      await options.afterLoad();
    } catch (error) {
      setStatus(
        `Editing ${page}, but recovery cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function handleExternalChange(): Promise<void> {
  const project = state.project;
  const page = state.page;
  if (!project || !page) return;
  const projectPath = project.path;
  const sessionGeneration = editorSessionGeneration;
  const isCurrentPage = (): boolean =>
    state.project?.path === projectPath &&
    state.page === page &&
    editorSessionGeneration === sessionGeneration;

  await editorSave.waitForIdle();
  if (!isCurrentPage()) return;

  let diskContent: string | null = null;
  try {
    const onDisk = await window.zephus.readFile(projectPath, page);
    if (!isCurrentPage()) return;
    if (onDisk.ok && typeof onDisk.content === "string") {
      diskContent = onDisk.content;
      if (
        diskContent === state.rawCode ||
        diskContent === state.generatedCode
      ) {
        return;
      }
      if (
        ignoredExternalChange?.projectPath === projectPath &&
        ignoredExternalChange.page === page
      ) {
        if (ignoredExternalChange.content === diskContent) return;
        if (ignoredExternalChange.content === null) {
          // The file was unreadable when the user chose Keep Mine; the next
          // watcher event is almost certainly the same change becoming
          // readable. Suppress it once instead of re-prompting forever.
          ignoredExternalChange = null;
          return;
        }
      }
    }
  } catch {
    // If the file cannot be read, still let the user decide how to proceed.
  }

  if (!isCurrentPage()) return;
  const choice = await modalController.choose<"keep" | "reload">(
    "File Changed on Disk",
    "The current page was modified outside Zephus. Reload it from disk or keep your in-app version?",
    [
      { label: "Keep Mine", value: "keep", kind: "ghost" },
      { label: "Reload", value: "reload", kind: "primary" },
    ],
  );
  if (!isCurrentPage()) return;
  if (choice === "keep") {
    // Record the ignored state even when the file could not be read: without
    // a marker, the next debounced watcher event for the same change would
    // prompt again forever.
    ignoredExternalChange = { projectPath, page, content: diskContent };
    trackChange("Kept in-app version after an external file change");
    markDirty(true);
    setStatus(
      "Keeping your in-app version. Save to overwrite the disk change.",
    );
    return;
  }

  ignoredExternalChange = null;
  await loadPage(page, {
    skipUnsavedGuard: true,
    skipDraftRestore: true,
    forceReload: true,
    afterLoad: async () => {
      await clearPageDraftAfterReload(projectPath, page);
    },
  });
}

function onExternalChange(): Promise<void> {
  if (externalChangeInFlight) {
    externalChangeQueued = true;
    return externalChangeInFlight;
  }
  const pending = handleExternalChange();
  externalChangeInFlight = pending;
  void pending.finally(() => {
    if (externalChangeInFlight === pending) externalChangeInFlight = null;
    if (externalChangeQueued) {
      externalChangeQueued = false;
      void onExternalChange();
    }
  });
  return pending;
}

/* ---------- Page structure parse / serialize ---------- */
// Preserves frontmatter and the markup surrounding the editable region so that
// untouched content round-trips. Unknown nodes become verbatim "html" blocks.

function capturePageFrame(raw: string): string {
  const { frame, inner } = splitManagedPageSource(raw);
  state.frontmatter = frame.frontmatter;
  state.prefix = frame.prefix;
  state.suffix = frame.suffix;
  return inner;
}

function parsePage(raw: string): void {
  const inner = capturePageFrame(raw);
  state.sections = parseSections(inner);
  syncBlocksFromSections();
  // The tree was rebuilt from code: the old selection ids may point at nodes
  // that no longer exist. Anchor to the first section and clear the block
  // selection (previously only selectedSectionId was set, so the canvas could
  // show NOTHING selected while the inspector showed section 0's props, and
  // layers showed a stale pre-code-mode selection).
  state.selectedId = null;
  state.selectedSectionId = state.sections[0]?.id ?? null;
}

/**
 * Pages a Post List block can show, in the same shape the build uses, so the
 * canvas preview and the generated page list identical posts.
 */
function editorPostIndex(): RenderPostEntry[] {
  return state.pageMeta.map((meta) => ({
    route: meta.route,
    title: meta.title || meta.navLabel || meta.slug,
    description: meta.metaDescription,
    date: isValidDateString(meta.publishDate) ? meta.publishDate : "",
    author: meta.author,
    image: meta.socialImage,
  }));
}

function editorRenderOptions(
  viewport = state.currentViewport,
  forCanvas = false,
): {
  viewport: typeof state.currentViewport;
  forCanvas: boolean;
  canvasMaxHeadingLevel: number;
  serializeMaxHeadingLevel: number;
  posts: RenderPostEntry[];
} {
  return {
    viewport,
    forCanvas,
    canvasMaxHeadingLevel: editorRules.maxHeadingLevel,
    // The BUILD renderer always emits up to level 6 (no repo-rule plumbing);
    // serialize must match it or zero-edit code-mode saves see "content
    // differs" and detach. Clamping happens on the canvas only.
    serializeMaxHeadingLevel: 6,
    posts: editorPostIndex(),
  };
}

function blockToHtml(
  block: Block,
  viewport = state.currentViewport,
  forCanvas = false,
): string {
  return blockToHtmlForEditor(block, editorRenderOptions(viewport, forCanvas));
}

function serializeBlocks(): string {
  return assembleManagedPage(
    {
      frontmatter: state.frontmatter,
      prefix: state.prefix,
      suffix: state.suffix,
    },
    state.sections,
    (block) => blockToHtml(block as Block, "desktop", false),
  );
}

function currentManagedSource(): string {
  return serializeBlocks();
}

// True while an inline contenteditable session is active. Used to stop the
// block click/select logic from hijacking clicks during editing (which would
// re-enter edit mode and collapse the user's text selection — e.g. when
// double-clicking a word to highlight it).

const undoSnapshotEffects = {
  syncBlocksFromSections,
  syncSelectionState,
  applyDesignPreview,
  renderDirtyIndicators,
};

function pushUndo(): void {
  pushEditorUndo(state, updateUndoRedoButtons);
}

function restoreSnapshot(snap: EditorSnapshot): void {
  restoreEditorSnapshot(state, snap, undoSnapshotEffects);
}

const inspectorCanvasRepaint = createDebouncedCanvasRepaint(() => {
  renderLayers();
  renderCanvas();
});
const inspectorEditLatch = createInspectorUndoLatch({
  captureSnapshot: () => captureEditorSnapshot(state),
  pushSnapshot: (snapshot) => {
    pushEditorSnapshot(state, snapshot, updateUndoRedoButtons);
  },
});

// Canvas resize handles — same injection pattern as inlineEdit.
const resize = createResizeController({
  getViewport: () => state.currentViewport,
  pushUndo,
  commitInspectorChange,
  endInspectorEdit,
  inspectorEditLatch,
});

function scheduleCanvasRepaint(debounce: boolean): void {
  inspectorCanvasRepaint.schedule(debounce);
}

function beginInspectorEdit(): void {
  inspectorEditLatch.begin();
}

function endInspectorEdit(): void {
  inspectorEditLatch.end(() => inspectorCanvasRepaint.flush());
}

/**
 * Pushes undo for control-triggered inspector changes (buttons, checkboxes,
 * selects). Text-input typing is covered by the latch (snapshot at focus,
 * push at blur when changed) — pushing here too would create phantom entries
 * and wipe redo on every keystroke.
 */
function pushUndoForControlChange(): void {
  if (!inspectorEditLatch.isActive()) pushUndo();
}

/** Cache of webPath → data URL for canvas image hydration. */
const assetDataUrlCache = new Map<string, Promise<string | null>>();

function clearAssetCache(): void {
  assetDataUrlCache.clear();
}

/** Drops one asset's cached data-URL so a delete/rename/replace is not served
 *  stale bytes for the rest of the session. */
function invalidateAssetCache(webPath: string): void {
  assetDataUrlCache.delete(webPath);
}

function fetchAssetDataUrl(webPath: string): Promise<string | null> {
  if (!state.project) return Promise.resolve(null);
  const cached = assetDataUrlCache.get(webPath);
  if (cached) return cached;
  const project = state.project;
  const promise = window.zephus
    .readAssetDataUrl(project.path, project.astro.publicDir, webPath)
    .then((res) => (res.ok && res.dataUrl ? res.dataUrl : null))
    .catch(() => null);
  assetDataUrlCache.set(webPath, promise);
  // A failed read must not be cached forever: the file may be temporarily
  // unreadable (transient FS error, mid-copy) or the name reclaimed later —
  // drop the entry so the next hydration retries instead of serving a
  // permanently broken image for the whole session.
  void promise.then((dataUrl) => {
    if (!dataUrl) assetDataUrlCache.delete(webPath);
  });
  return promise;
}

function hydrateCanvasAssets(root: HTMLElement): void {
  const imgs = root.querySelectorAll<HTMLImageElement>("img[data-asset-src]");
  imgs.forEach((img) => {
    const webPath = img.getAttribute("data-asset-src");
    if (!webPath) return;
    void fetchAssetDataUrl(webPath).then((dataUrl) => {
      if (dataUrl) img.src = dataUrl;
    });
  });
}

function galleryImages(block: Block): string[] {
  return (block.props["images"] ?? "")
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Rewrites the gallery's image list + position-indexed alt props together. */
function writeGallery(block: Block, images: string[], alts: string[]): void {
  for (const key of Object.keys(block.props)) {
    if (/^alt\d+$/.test(key)) delete block.props[key];
  }
  block.props["images"] = images.join("\n");
  alts.forEach((alt, i) => {
    if (alt) block.props[`alt${i + 1}`] = alt;
  });
}

/** Stops canvas links from navigating while editing (keep/reload or preview). */
function makeCanvasLinksInert(root: HTMLElement): void {
  root.querySelectorAll<HTMLIFrameElement>("iframe").forEach((frame) => {
    frame.tabIndex = -1;
  });
  if (root.dataset["canvasLinksInert"] === "true") return;
  root.dataset["canvasLinksInert"] = "true";
  root.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("a[href]")) event.preventDefault();
    },
    true,
  );
}

/* ---------- Properties panel ---------- */

function detectLinkKind(value: string): LinkPickerKind {
  const t = value.trim();
  if (t.startsWith("mailto:")) return "email";
  if (t.startsWith("tel:")) return "phone";
  if (t.startsWith("#")) return "anchor";
  if (/^(https?:)?\/\//i.test(t)) return "url";
  if (state.pageMeta.some((p) => p.route === t)) return "page";
  return t ? "url" : "page";
}

/**
 * Opens a modal to build a link as a project page, external URL, email,
 * phone, or on-page anchor, returning the resulting href string.
 */
function openLinkPicker(current: string, onPick: (href: string) => void): void {
  const wrap = document.createElement("div");
  const prefillFor = (kind: LinkPickerKind, value: string): string => {
    const t = value.trim();
    if (kind === "email") return t.startsWith("mailto:") ? t.slice(7) : "";
    if (kind === "phone") return t.startsWith("tel:") ? t.slice(4) : "";
    if (kind === "anchor") return t.startsWith("#") ? t.slice(1) : "";
    if (kind === "url") return /^(https?:)?\/\//i.test(t) ? t : "";
    return "";
  };

  const pageOptions = state.pageMeta.map((meta) => ({
    value: meta.route,
    label: `${meta.title} (${meta.route})`,
  }));
  const modalState = {
    kind: detectLinkKind(current),
    // A route that is not in the current page list (detached/code-only page,
    // or trailing-slash mismatch) must NOT silently fall back to the first
    // listed page — "Use Link" would replace the link with a different page.
    pageValueMissing:
      current.startsWith("/") &&
      !state.pageMeta.some((meta) => meta.route === current),
    pageValue:
      state.pageMeta.find((meta) => meta.route === current)?.route ?? "",
    rawValue: "",
    rawEdited: false,
  };
  modalState.rawValue = prefillFor(modalState.kind, current);

  let disposeLinkBody: (() => void) | null = null;
  const renderModal = () => {
    disposeLinkBody?.();
    disposeLinkBody = renderLinkPickerModal(wrap, {
      kind: modalState.kind,
      pageOptions,
      pageValue: modalState.pageValue,
      pageValueMissing: modalState.pageValueMissing,
      rawValue: modalState.rawValue,
      onKindChange: (value) => {
        modalState.kind = value;
        if (value === "page" && !modalState.pageValue) {
          modalState.pageValue = pageOptions[0]?.value ?? "";
        }
        // Only re-derive the raw value when the user has not typed anything:
        // overwriting their typed URL with a prefill on every kind switch
        // silently discards their input.
        if (!modalState.rawEdited) {
          modalState.rawValue = prefillFor(value, current);
        }
        renderModal();
      },
      onPageValueChange: (value) => {
        modalState.pageValue = value;
      },
      onRawValueChange: (value) => {
        modalState.rawValue = value;
        modalState.rawEdited = true;
      },
    });
  };

  renderModal();

  showModalNode("Choose Link", wrap, [
    { label: "Cancel", kind: "ghost", onClick: closeModal },
    {
      label: "Use Link",
      kind: "primary",
      onClick: () => {
        const raw = modalState.rawValue.trim();
        let href = modalState.pageValue || "/";
        if (modalState.kind === "email") href = raw ? `mailto:${raw}` : "";
        else if (modalState.kind === "phone") href = raw ? `tel:${raw}` : "";
        else if (modalState.kind === "anchor")
          href = raw ? `#${raw.replace(/^#/, "")}` : "";
        else if (modalState.kind === "url") href = raw;
        closeModal();
        onPick(href);
      },
    },
  ]);
}

/** Builds a Google Fonts css2 URL from family specs, or "" if none. */
function buildFontImportUrl(googleSpecs: (string | null)[]): string {
  const unique = [...new Set(googleSpecs.filter((g): g is string => !!g))];
  if (unique.length === 0) return "";
  const families = unique.map((g) => `family=${g}`).join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

async function chooseAssetForImage(block: Block): Promise<void> {
  openAssetBrowser({
    filter: "images",
    title: "Image Browser",
    onSelect: (webPath) => {
      pushUndo();
      block.props["src"] = webPath;
      commitBlockChange(`Updated image asset for ${block.type}`);
    },
  });
}

/** Creates src/pages/404.astro, which Astro serves for unknown routes. */
async function createNotFoundPage(): Promise<void> {
  if (!state.project) return;
  const created = await window.zephus.createPage(
    state.project.path,
    "404",
    state.project.astro.pagesDir,
  );
  if (!created.ok) {
    setStatus("Could not create the 404 page: " + (created.error ?? "unknown"));
    return;
  }
  await reloadPages();
  const entry = state.pageMeta.find((meta) => meta.slug === "404");
  if (entry) await loadPage(entry.page);
  setStatus(
    "Created the 404 page. It stays out of your navigation and search results.",
  );
}

async function openFindReplaceModal(): Promise<void> {
  return editorFindReplace.openFindReplaceModal({
    getState: () => state,
    setStatus,
    showModalNode,
    closeModal,
    registerCleanup,
    confirmDestructive: (title, message, confirmLabel) =>
      modalController.confirmDestructive(title, message, confirmLabel),
    loadPage,
    reloadPages,
    maybeResolveUnsavedWork,
    searchPages: (projectPath, pagesDir, query, options) =>
      window.zephus.searchPages(projectPath, pagesDir, query, options),
    replaceAllInPages: (
      projectPath,
      pagesDir,
      query,
      replacement,
      options,
      onlyPages,
    ) =>
      window.zephus.replaceAllInPages(
        projectPath,
        pagesDir,
        query,
        replacement,
        options,
        onlyPages,
      ),
  });
}

/** Re-reads site.json after main mutated it, so the editor is not left stale. */
async function reloadSiteDocumentFromDisk(): Promise<void> {
  if (!state.project) return;
  const site = await window.zephus.readSiteDocument(state.project.path);
  if (!site.ok || !site.site) return;
  state.siteDocument = site.site;
  state.pendingSiteDocument = null;
  state.pendingSiteEditorKind = null;
  clearSiteChanges(state);
  markSiteDirty(state, false);
  renderDirtyIndicators();
  void applyMergedTheme();
  if (state.project) renderNavEditor(state.project);
}

/* ---------- Mode switching ---------- */

function syncModeToggle(mode: Mode): void {
  const visual = $("mode-visual");
  const code = $("mode-code");
  visual.classList.toggle("active", mode === "visual");
  code.classList.toggle("active", mode === "code");
  visual.setAttribute("aria-pressed", String(mode === "visual"));
  code.setAttribute("aria-pressed", String(mode === "code"));
}

function setMode(mode: Mode): void {
  if (mode === "visual" && !state.visualEditable) {
    showModal(
      "Visual Mode Unavailable",
      state.managedStatus === "out-of-sync"
        ? "This page was edited outside Zephus. Use Reload From Disk on the editor banner, or edit in Code mode and save to detach."
        : "This page was detached from visual mode after a structural code edit. Reattach it from the editor banner or Page Settings to resume GUI editing.",
      [{ label: "OK", kind: "primary", onClick: closeModal }],
    );
    return;
  }

  const codeEl = $("code-editor");

  // Re-selecting the active mode should only restore its view. In particular,
  // never refill CodeMirror here: doing so would discard unsaved code edits.
  if (mode === state.mode) {
    syncModeToggle(mode);
    codeEl.classList.toggle("hidden", mode !== "code");
    $("canvas").classList.toggle("hidden", mode !== "visual");
    if (mode === "code") {
      cm?.focus();
      renderProperties();
    } else {
      renderCanvas();
      renderProperties();
    }
    updateUndoRedoButtons();
    return;
  }

  if (mode === "code") {
    state.mode = mode;
    syncModeToggle(mode);
    state.rawCode =
      state.managedStatus === "detached" ||
      state.managedStatus === "out-of-sync"
        ? (getCode() ?? state.rawCode)
        : currentManagedSource();
    setCode(state.rawCode);
    codeEl.classList.remove("hidden");
    $("canvas").classList.add("hidden");
    cm?.focus();
    renderProperties();
    updateUndoRedoButtons();
    return;
  }

  const codeVal = getCode();
  if (
    shouldBlockManagedVisualSwitch(codeVal, state.rawCode, state.managedStatus)
  ) {
    showModal(
      "Save Code Changes First",
      "Managed pages cannot safely round-trip structural Astro edits back into visual mode. Save to detach this page, or discard your code changes first.",
      [{ label: "OK", kind: "primary", onClick: closeModal }],
    );
    return;
  }
  if (codeVal !== state.rawCode) {
    state.rawCode = codeVal;
    parsePage(state.rawCode);
    // The tree was wholesale replaced by content from a different lineage
    // (the code edits). The old undo stack points into the replaced tree —
    // undoing would restore content the user already discarded by editing
    // code — so clear it rather than mix the two.
    state.undo = [];
    state.redo = [];
    markDirty(true);
    updateUndoRedoButtons();
  }

  state.mode = mode;
  syncModeToggle(mode);
  $("canvas").classList.remove("hidden");
  codeEl.classList.add("hidden");
  renderCanvas();
  renderProperties();
  updateUndoRedoButtons();
}

/* ---------- Save ---------- */

const editorSiteSave = createEditorSiteSaveActions({
  getState: () => state,
  setStatus,
  onSiteStateChanged: () => {
    renderDirtyIndicators();
    if (state.siteDirty) scheduleDraftWrite();
    if (state.project) renderNavEditor(state.project);
  },
  zephus: window.zephus,
});

const editorDraftRestore = createEditorDraftRestoreActions({
  getState: () => state,
  setStatus,
  confirmRestoreDraft: (title, message) =>
    modalController.confirmRestoreDraft(title, message),
  onSiteDraftRestored: () => {
    renderDirtyIndicators();
    scheduleDraftWrite();
    if (state.project) renderNavEditor(state.project);
  },
  zephus: window.zephus,
});

const editorSave = createEditorSaveActions({
  getState: () => state,
  setStatus,
  getCode,
  setCode,
  serializeBlocks,
  pageDocumentFromState,
  syncVisualModeState,
  sectionsFromPageDocument,
  syncBlocksFromSections,
  clearChanges,
  markDirty,
  scheduleDraftWrite,
  renderDirtyIndicators,
  reloadPages,
  persistPendingSiteDocument,
  afterSave: () => void editorGit.refreshGit(),
  zephus: window.zephus,
});
const performSave = async (): Promise<boolean> => {
  const saveButton = $("btn-save") as HTMLButtonElement;
  const saveLabel = $("save-label");
  const startedSave = !editorSave.isSaving();
  const wasSavingPage = state.pageDirty;
  if (startedSave) setStatus("Saving…");
  saveLabel.textContent = "Saving…";
  saveButton.disabled = true;
  saveButton.setAttribute("aria-busy", "true");
  saveButton.setAttribute("aria-label", "Saving changes");
  saveButton.classList.add("saving");
  try {
    // An in-flight contenteditable edit lives in the DOM, not in the section
    // tree — commit it first or the save serializes stale content (and the
    // just-deleted recovery draft would be the only copy of the edit).
    inlineEdit.finishInlineEdit();
    const saved = await editorSave.performSave();
    if (saved && wasSavingPage && !state.pageDirty) {
      ignoredExternalChange = null;
    }
    return saved;
  } finally {
    saveLabel.textContent = "Save";
    saveButton.disabled = loadingPage !== null;
    saveButton.removeAttribute("aria-busy");
    saveButton.setAttribute("aria-label", "Save changes");
    saveButton.classList.remove("saving");
  }
};

/* ---------- Preview + responsive viewport ---------- */

const previewPublish = createPreviewPublishActions({
  getState: () => state,
  $,
  $maybe,
  setStatus,
  refreshIcons,
  showModal,
  showModalNode,
  closeModal,
  registerCleanup,
  maybeResolveUnsavedWork,
  performSave,
  refreshGuidancePanels,
  renderCanvas,
  renderProperties,
  friendlyError,
});

const {
  setViewport,
  runInstallFlow,
  ensureDependencies,
  updatePreviewButton,
  resetPreviewState,
  togglePreview,
  publishSite,
  unsubscribeAllPreviewLogs,
} = previewPublish;

/* ---------- Close ---------- */

/** Resets every piece of per-page editor state (used on close and after
 *  deleting the open page). Site/project state is left untouched. */
function resetOpenPageState(): void {
  state.pageDocument = null;
  state.page = null;
  state.currentMeta = null;
  state.managedStatus = "missing";
  state.visualEditable = true;
  state.generatedCode = "";
  state.rawCode = "";
  state.frontmatter = "";
  state.prefix = "";
  state.suffix = "";
  state.mode = "visual";
  state.sections = [];
  state.blocks = [];
  state.selectedId = null;
  state.selectedSectionId = null;
  state.undo = [];
  state.redo = [];
  state.recoveredPageDraft = null;
  // Stale selection/drag-echo state from the previous page must not carry
  // into the next project (first click misread as double-click, spurious
  // "activate inspect tab").
  canvasActions.resetCanvasClickTracking();
  canvasActions.resetInspectorSelectionKey();
  cancelScheduledEditorDraftWrite(state);
  clearChanges();
  markDirty(false);
}

async function closeProject(): Promise<void> {
  if (closingProject) return;
  // Set the guard BEFORE the await: two rapid Close invocations (double-click,
  // or Enter on the confirm dialog) must not both pass the unsaved-work prompt
  // and run the teardown twice.
  closingProject = true;
  const proceed = await maybeResolveUnsavedWork();
  if (!proceed) {
    closingProject = false;
    return;
  }

  const editorView = $("view-editor");
  editorView.setAttribute("inert", "");
  setStatus("Closing project…");
  updateUndoRedoButtons();

  try {
    editorSessionGeneration += 1;
    latestPageLoadRequest += 1;
    setPageLoading(null);
    externalChangeQueued = false;
    ignoredExternalChange = null;
    if (state.previewUrl) {
      await window.zephus.closePreviewWindow();
      resetPreviewState();
    }
    await window.zephus.stopWatch();
    // A preview starting while the project closed (previewUrl not yet set)
    // would otherwise keep the dev server + window alive for a nulled
    // project, and the next project's log panel would receive its stream.
    unsubscribeAllPreviewLogs();
    state.previewUrl = null;
    updatePreviewButton("stopped");
    state.unsubExternal?.();
    state.unsubExternal = null;
    state.project = null;
    // Cross-project paste: a block/section copied in project A must not be
    // insertable into project B.
    blockOps.clearClipboard();
    // Saved sections are per-project: the palette must not expose project
    // A's saved sections inside project B (a stale unawaited renderTemplates
    // could also re-fill the cache after close).
    blockOps.setReusableSections([]);
    clearAssetCache();
    state.siteDocument = null;
    state.pendingSiteDocument = null;
    state.pendingSiteEditorKind = null;
    state.pageMeta = [];
    state.recoveredSiteDraft = null;
    resetOpenPageState();
    // A fresh session should start on the desktop viewport, not inherit the
    // previous project's mobile/tablet preview.
    state.currentViewport = "desktop";
    clearSiteChanges(state);
    markSiteDirty(state, false);
    editorView.classList.add("hidden");
    $("view-start").classList.remove("hidden");
    // Return focus to the active start tab rather than leaving it on <body>.
    document.querySelector<HTMLElement>(".start-nav-item.active")?.focus();
    renderLayers();
    renderProjectOverview();
    renderNextActions();
    await refreshHomeDraftSummaries();
    renderThemePlaceholder();
    await renderRecent();
    setStatus("");
    // A transient mount failure must not poison every later session's status
    // bar and banner (they are re-rendered on the next open).
    panelMountFailures.length = 0;
  } catch (error) {
    setStatus(
      `Could not close project: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    closingProject = false;
    editorView.removeAttribute("inert");
    updateUndoRedoButtons();
  }
}

/* ---------- Undo / redo ---------- */

function updateUndoRedoButtons(): void {
  const undoButton = $("btn-undo") as HTMLButtonElement;
  const redoButton = $("btn-redo") as HTMLButtonElement;
  syncUndoRedoToolbar({
    mode: state.mode,
    visualUndoDepth: state.undo.length,
    visualRedoDepth: state.redo.length,
    codeCanUndo: cm?.canUndo() ?? false,
    codeCanRedo: cm?.canRedo() ?? false,
    undoButton,
    redoButton,
  });
  if (loadingPage || closingProject) {
    undoButton.disabled = true;
    redoButton.disabled = true;
  }
}

/* ---------- Start view tabs and theme picker ---------- */

const startView = createStartViewActions({
  getState: () => state,
  $,
  $maybe,
  setStatus,
  showModal,
  showModalNode,
  closeModal,
  openSettingsModal,
  openProjectByPath,
  updaterStatusMessage,
  currentUpdaterActions,
  nodeStatusMessage,
  friendlyError,
  runInstallFlow: (folder) => previewPublish.runInstallFlow(folder),
});

const {
  initStartTabs,
  switchStartTab,
  activateHomeSection,
  selectThemeCard,
  createSiteFromTabFlow,
  renderThemesInTab,
  renderSettingsInTab,
  renderAboutAndLicensesInTab,
  openThemePreviewModal,
} = startView;

function init(): void {
  if (window.location.search.includes("smoke=1")) {
    installEditorSmokeHook({
      getState: () => state,
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
    });
  }
  window.refreshIcons = refreshIcons;
  initStartTabs();
  initEditorWorkspaceTabs();

  // Prevent stray file drops from navigating the window away from the app.
  // Specific dropzones call preventDefault + stopPropagation to handle drops.
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => event.preventDefault());

  // Warn before closing/reloading with unsaved work. Drafts also auto-save,
  // but this is an explicit last-chance rail.
  // NOTE: in Electron, preventing beforeunload CANCELS the close with NO
  // dialog (Chromium's confirm is suppressed) — the app used to silently
  // refuse to quit. Instead, surface the app's own save/discard/cancel modal
  // and, once resolved, re-close with the guard lifted.
  let forceCloseAllowed = false;
  // Distinguishes CLOSE from RELOAD in beforeunload: a reload replaces the
  // navigation entry (type "reload"); a close leaves it untouched. Closing
  // after an earlier reload must still close — compare against the type of
  // the FIRST load this window performed.
  const initialNavType =
    (
      performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined
    )?.type ?? "navigate";
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (forceCloseAllowed) return;
    if (!state.project || !isGlobalDirty(state)) return;
    event.preventDefault();
    event.returnValue = "";
    const navType = (
      performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined
    )?.type;
    const isReload = navType === "reload" && navType !== initialNavType;
    void (async () => {
      const resolved = await maybeResolveUnsavedWork();
      if (!resolved) return;
      if (isReload) {
        location.reload();
        return;
      }
      forceCloseAllowed = true;
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.close();
    })();
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  // Cmd/Ctrl+R is intercepted in the main process (the menu accelerator would
  // otherwise fire before this keydown handler). Resolve unsaved work first,
  // then reload for real — reloading while dirty used to resolve the modal
  // and then CLOSE the app (the guard could not tell reload from close).
  window.zephus.onReloadRequested(() => {
    void (async () => {
      if (state.project && isGlobalDirty(state)) {
        const resolved = await maybeResolveUnsavedWork();
        if (!resolved) return;
      }
      location.reload();
    })();
  });
  // Update installs quit the app programmatically; the dirty guard must not
  // strand the update. restartToApplyUpdate resolves unsaved work first and
  // then calls this.
  window.zephusMarkForceCloseAllowed = () => {
    forceCloseAllowed = true;
  };

  // Populate sidebar version label.
  const sidebarVersion = $("sidebar-app-version");
  if (sidebarVersion) {
    window.zephus
      .getAppVersion()
      .then((v) => {
        sidebarVersion.textContent = `v${v}`;
      })
      .catch(() => {
        sidebarVersion.textContent = "";
      });
  }

  const btnCreate = $("btn-create");
  if (btnCreate) btnCreate.onclick = () => void createSiteFromTabFlow();
  const btnSettings = $maybe("btn-settings");
  if (btnSettings) btnSettings.onclick = () => void openSettingsModal();
  const previewUrlChip = $maybe("preview-url-chip");
  if (previewUrlChip) {
    previewUrlChip.onclick = () => {
      const url = state.previewUrl;
      if (!url) return;
      void navigator.clipboard?.writeText(url).then(
        () => setStatus("Preview URL copied."),
        () => setStatus("Preview URL: " + url),
      );
    };
  }
  const btnResumeLast = $("btn-resume-last");
  if (btnResumeLast) {
    btnResumeLast.onclick = () => {
      const lastProject = appSettings?.lastOpenedProject;
      if (lastProject) {
        void openProjectByPath(lastProject);
      }
    };
  }

  const btnOpen = $("btn-open");
  if (btnOpen) btnOpen.onclick = () => void chooseFolder();

  $("btn-new-page").onclick = () => void newPageFlow();
  $("btn-find-replace").onclick = () => void openFindReplaceModal();
  $("btn-regen-nav").onclick = () => void regenerateNav();
  $("btn-site-shell").onclick = () => void openSiteShellModal();
  $("btn-design-system").onclick = () => void openDesignSystemModal();
  $("mode-visual").onclick = () => setMode("visual");
  $("mode-code").onclick = () => setMode("code");
  $("btn-undo").onclick = () => {
    if (state.mode === "code") cm?.undo();
    else doUndo();
    updateUndoRedoButtons();
  };
  $("btn-redo").onclick = () => {
    if (state.mode === "code") cm?.redo();
    else doRedo();
    updateUndoRedoButtons();
  };
  updateUndoRedoButtons();
  $("btn-save").onclick = () => void performSave();
  $("btn-publish").onclick = () => void publishSite();
  $("btn-preview").onclick = () => void togglePreview();
  $("btn-help").onclick = () => void openHelpModal();
  $("btn-close").onclick = () => void closeProject();
  // The preview window can be closed by the user (native close button); when
  // that happens the main process tears down the dev server and tells us, so
  // the Preview button + status reset to match.
  window.zephus.onPreviewClosed(() => {
    if (state.previewUrl) resetPreviewState("Preview stopped.");
  });
  // The dev server can die on its own (crash, port conflict, killed outside
  // Zephus) while the preview window is still open. Reset the preview UI and
  // close the dead window so the editor never shows a stale "preview open".
  window.zephus.onPreviewExited(() => {
    if (state.previewUrl) {
      void window.zephus.closePreviewWindow().catch(() => undefined);
      resetPreviewState("Preview server stopped.");
    }
  });
  $("vp-desktop").onclick = () => setViewport("desktop");
  $("vp-tablet").onclick = () => setViewport("tablet");
  $("vp-mobile").onclick = () => setViewport("mobile");
  document.addEventListener("keydown", onKeydown);
  renderLayers();
  renderThemePlaceholder();
  refreshGuidancePanels();

  // Mount the SolidJS Next Actions app in the sidebar panel
  mountPanel("Next Actions", "next-actions", (nextActionsContainer) => {
    mountNextActions(nextActionsContainer);
  });

  mountPanel("Git Branch", "git-branch", (gitBranchContainer) => {
    mountGitBranch(gitBranchContainer);
  });

  mountPanel("Git Panel", "git-panel", (gitPanelContainer) => {
    mountGitPanel(gitPanelContainer);
    registerGitPanelHandlers({
      onRefresh: () => void editorGit.refreshGit({ fetchRemote: true }),
      onCommit: (message, paths) => editorGit.commitGitChanges(message, paths),
      onPush: () => editorGit.pushGitChanges(),
      onPull: () => editorGit.pullGitChanges(),
      onInitRepo: () => editorGit.initGitFromPanel(),
    });
  });

  mountPanel("Block Palette", "block-palette", (blockPaletteContainer) => {
    mountBlockPalette(blockPaletteContainer);
    registerInsertBlockCallback((type) => {
      const sectionId = activeSectionId();
      const section = findSection(sectionId) ?? state.sections[0];
      addBlockAt(type, section ? section.children.length : 0, sectionId);
    });
  });

  mountPanel("Page List", "page-list", (pageListContainer) => {
    mountPageList(pageListContainer);
    registerPageListHandlers({
      onOpen: (page) => void loadPage(page),
      onManage: (page) => void openPageMetaModal(page),
      onToggleNav: (page) => void togglePageNavVisibility(page),
    });
  });

  mountPanel("Nav List", "nav-list", (navListContainer) => {
    mountNavList(navListContainer);
    registerNavListHandlers({
      onPageSettings: () => {
        if (state.page) void openPageMetaModal(state.page);
      },
      onReviewNavigation: () => void regenerateNav(),
      onOpenPage: (page) => void loadPage(page),
    });
  });

  mountPanel("Recent Projects", "recent-list", (recentListContainer) => {
    mountRecentProjects(recentListContainer);
    registerRecentProjectsHandlers({
      onOpenFolder: () => void chooseFolder(),
      onExploreTemplates: () => void switchStartTab("create"),
      onOpenProject: (path) => void openProjectByPath(path),
      onRemoveProject: async (path) => {
        await window.zephus.removeRecentProject(path);
        setStatus("Removed recent project: " + projectBaseName(path));
        await renderRecent();
      },
    });
  });

  mountPanel("Themes Tab", "theme-list-container", (themeListContainer) => {
    mountThemesTab(themeListContainer);
    registerThemesTabHandlers({
      onLoadPreviews: () => void activateHomeSection("create"),
      onSelect: (themeId) => selectThemeCard(themeId),
      onPreview: (themeId) => {
        const theme = startView.getStartTheme(themeId);
        if (theme) openThemePreviewModal(theme);
      },
      onCreateFromTheme: (themeId) => {
        selectThemeCard(themeId);
        void createSiteFromTabFlow();
      },
    });
  });

  mountPanel(
    "Settings Tab",
    "settings-tab-container",
    (settingsTabContainer) => {
      mountSettingsTab(settingsTabContainer);
      registerSettingsTabHandlers({
        onReset: async (settings) => {
          if (
            !(await modalController.confirmDestructive(
              "Reset Settings",
              "Reset all Zephus settings to defaults?",
              "Reset",
            ))
          ) {
            return;
          }
          const defaults: GlobalSettings = {
            ...settings,
            theme: "system",
            autoCheckUpdates: true,
            updateChannel: "auto",
            restoreLastProject: false,
            confirmBlockDelete: true,
            autosave: false,
            codeFontSize: 13,
            customNodePath: null,
          };
          const reset = await window.zephus.writeGlobalSettings(defaults);
          if (!reset.ok) {
            setStatus(
              "Settings could not be reset: " +
                (reset.error ?? "unknown error"),
            );
            return;
          }
          document.documentElement.setAttribute("data-theme", "system");
          applyCodeFontSize(13);
          appSettings = defaults;
          setStatus("Settings reset to defaults.");
          await renderSettingsInTab();
        },
        onSave: async (settings) => {
          const saved = await window.zephus.writeGlobalSettings(settings);
          if (!saved.ok) {
            setStatus(
              "Settings could not be saved: " +
                (saved.error ?? "unknown error"),
            );
            return;
          }
          document.documentElement.setAttribute("data-theme", settings.theme);
          applyCodeFontSize(settings.codeFontSize);
          appSettings = settings;
          setStatus("Settings saved.");
          updateSettingsTabSettings(settings);
        },
        onPickNodePath: async (settings) => {
          try {
            const res = await window.zephus.pickNodePath();
            const nextSettings = { ...settings };
            if (
              (res.status === "ok" || res.status === "outdated") &&
              res.usedCustomPath &&
              res.binaryPath
            ) {
              nextSettings.customNodePath = res.binaryPath;
            }
            updateSettingsTabSettings(nextSettings);
            const label =
              res.status === "ok"
                ? `Node.js ${res.version} detected ✓`
                : res.status === "outdated"
                  ? `Node.js ${res.version ?? "?"} — version 22.12+ required`
                  : res.status === "missing"
                    ? "Node.js not found — set a custom location below"
                    : "Node.js status could not be determined";
            const source = nextSettings.customNodePath
              ? `Custom: ${nextSettings.customNodePath}`
              : "Auto-detect (system PATH)";
            updateSettingsTabNode(
              `${label} · ${source}`,
              !nextSettings.customNodePath,
            );
          } catch {
            updateSettingsTabNode(
              "Could not set Node.js location.",
              !settings.customNodePath,
            );
          }
        },
        onAutoNodePath: async (settings) => {
          try {
            const res = await window.zephus.setNodePath(null);
            const nextSettings = { ...settings, customNodePath: null };
            updateSettingsTabSettings(nextSettings);
            const label =
              res.status === "ok"
                ? `Node.js ${res.version} detected ✓`
                : res.status === "outdated"
                  ? `Node.js ${res.version ?? "?"} — version 22.12+ required`
                  : res.status === "missing"
                    ? "Node.js not found — set a custom location below"
                    : "Node.js status could not be determined";
            updateSettingsTabNode(`${label} · Auto-detect (system PATH)`, true);
          } catch {
            updateSettingsTabNode(
              "Could not reset Node.js location.",
              !settings.customNodePath,
            );
          }
        },
        onUpdaterAction: async (actionId) => {
          if (actionId === "check") {
            try {
              await window.zephus.checkForUpdates();
            } catch {
              /* status surfaced via updater listener */
            }
            return;
          }
          if (actionId === "download") {
            const result = (await window.zephus.downloadUpdate()) as {
              status?: string;
              error?: string;
            };
            if (result?.status === "error") {
              showModal("Update Download Failed", friendlyError(result.error), [
                { label: "OK", kind: "primary", onClick: closeModal },
              ]);
            }
            return;
          }
          if (actionId === "restart") {
            await restartToApplyUpdate();
            return;
          }
          if (actionId === "cancel") {
            await window.zephus.cancelUpdateDownload();
          }
        },
      });
    },
  );

  mountPanel(
    "Home Draft Recovery",
    "home-recovery-list",
    (homeDraftRecoveryContainer) => {
      mountHomeDraftRecovery(homeDraftRecoveryContainer);
      registerHomeDraftRecoveryHandlers({
        onResumeDraft: (projectPath, scope, target) => {
          // Match by scope+target too: a project with BOTH a page draft and a
          // site draft shows two cards; clicking either must resume THAT one,
          // not the newest summary.
          const draft = homeActions
            .getHomeDraftSummaries()
            .find(
              (entry) =>
                entry.projectPath === projectPath &&
                (scope === undefined || entry.scope === scope) &&
                (target === undefined || entry.target === target),
            );
          if (!draft) return;
          pendingHomeDraftResume = draft;
          void openProjectByPath(draft.projectPath);
        },
      });
    },
  );

  mountPanel(
    "About Licenses",
    "about-licenses-list",
    (aboutLicensesContainer) => {
      mountAboutLicenses(aboutLicensesContainer);
    },
  );

  mountPanel(
    "Sidebar Update Status",
    "sidebar-update-status",
    (sidebarUpdateStatusContainer) => {
      mountSidebarUpdateStatus(sidebarUpdateStatusContainer);
      registerSidebarUpdateStatusHandlers({
        onClick: () => {
          if (homeActions.getUpdaterSnapshot()?.status === "downloaded") {
            promptDownloadedUpdate(true);
            return;
          }
          if (
            homeActions.getUpdaterSnapshot()?.status === "available" ||
            homeActions.getUpdaterSnapshot()?.status === "error"
          ) {
            void switchStartTab("settings");
          }
        },
      });
    },
  );

  mountPanel(
    "Editor State Banner",
    "editor-state-banner",
    (editorStateBannerContainer) => {
      mountEditorStateBanner(editorStateBannerContainer);
    },
  );

  mountPanel("Layers", "layers-list", (layersContainer) => {
    mountLayers(layersContainer);
    registerLayersHandlers({
      onSelectSection: (id) => {
        state.selectedId = null;
        state.selectedSectionId = id;
        renderLayers();
        renderCanvas();
        renderProperties();
      },
      onSelectChild: (sectionId, childId) => {
        state.selectedId = childId;
        state.selectedSectionId = sectionId;
        renderLayers();
        renderCanvas();
        renderProperties();
      },
    });
  });

  bindCanvasHandlers(
    {
      getState: () => state,
      $maybe,
      setStatus,
      renderLayers,
      renderProperties,
      openBlockInsertModal,
      openSectionInsertModal,
      templateAllowed,
      addSectionAt,
      moveSection,
      duplicateSection,
      toggleSectionLock,
      deleteSection,
      liveCanvasBlock,
      liveCanvasSection,
      moveBlock,
      duplicateSelectedBlock,
      wrapBlockInSection,
      toggleBlockLock,
      deleteBlock,
      makeCanvasLinksInert,
      hydrateCanvasAssets,
      inlineEdit,
      resize,
      noteMountFailure,
    },
    canvasActions,
  );

  mountPanel(
    "Template Palette",
    "template-palette",
    (templatePaletteContainer) => {
      mountTemplatePalette(templatePaletteContainer);
      registerInsertTemplateCallback((tpl) => {
        if (!templateAllowed(tpl)) {
          setStatus("This section contains blocks not allowed by site rules.");
          return;
        }
        addSectionAt(state.sections.length, tpl);
      });
    },
  );

  mountPanel(
    "Project Overview",
    "project-overview",
    (projectOverviewContainer) => {
      mountProjectOverview(projectOverviewContainer);
    },
  );

  reportPanelMountFailures();
  void bootstrap();
}

async function bootstrap(): Promise<void> {
  try {
    appSettings = await window.zephus.readGlobalSettings();
    document.documentElement.setAttribute("data-theme", appSettings.theme);
    applyCodeFontSize(appSettings.codeFontSize);
  } catch {
    /* defaults apply */
  }
  await refreshHomeDraftSummaries();
  await renderRecent();
  window.zephus.onUpdaterStatus((data) => {
    homeActions.setUpdaterSnapshot(data);
    renderHomeStatusPanels();
    refreshUpdaterControls();
    if (data.status === "downloaded") {
      setStatus(
        `Update ${updateVersionLabel(data.version)} downloaded. Restart Zephus to apply it.`,
      );
      promptDownloadedUpdate();
    }
  });
  // The startup check can resolve before this listener attaches; claim the
  // cached status so the sidebar does not falsely say "Up to date".
  window.zephus
    .getLastUpdaterStatus()
    .then((cached) => {
      if (cached) {
        homeActions.setUpdaterSnapshot(cached);
        renderHomeStatusPanels();
        refreshUpdaterControls();
      }
    })
    .catch(() => {
      /* non-fatal */
    });
  refreshIcons();

  // Reopen last project if the user opted in and it still resolves. A failed
  // reopen (missing folder, removed .zephus, damaged project) must not skip
  // the first-run onboarding for brand-new users.
  if (appSettings?.restoreLastProject && appSettings.lastOpenedProject) {
    await openProjectByPath(appSettings.lastOpenedProject);
    if (state.project) return;
  }
  await showOnboardingIfNew();
}

async function showOnboardingIfNew(): Promise<void> {
  const settings = await window.zephus.readGlobalSettings();
  if (settings.recentProjects.length > 0) return;
  try {
    if (localStorage.getItem("zephus.onboarding.dismissed") === "1") return;
  } catch {
    // Continue showing onboarding if storage is unavailable.
  }
  showModal(
    "Welcome to Zephus",
    "Zephus builds real websites visually — no coding needed. " +
      "Pick a starter template and Zephus sets everything up for you, " +
      "including installing what the site needs to run. " +
      "Then drag blocks, edit text, and click Preview to see it live. " +
      "Note: Zephus needs Node.js installed on your computer to preview and build sites.",
    [
      {
        label: "Create My First Site",
        kind: "primary",
        onClick: () => {
          closeModal();
          const tabCreate = $("tab-create");
          if (tabCreate) tabCreate.click();
        },
      },
      {
        label: "I'll look around first",
        kind: "ghost",
        onClick: () => {
          try {
            localStorage.setItem("zephus.onboarding.dismissed", "1");
          } catch {
            // Non-fatal; modal still closes.
          }
          closeModal();
        },
      },
    ],
  );
}

document.addEventListener("DOMContentLoaded", init);

function noteMountFailure(label: string, error: unknown): void {
  console.error(`Failed to mount SolidJS ${label}:`, error);
  if (!panelMountFailures.includes(label)) panelMountFailures.push(label);
}

/**
 * Mounts a sidebar panel with a shared failure net: every panel uses the same
 * container-lookup + try/catch shape, and a mount error must never break the
 * rest of the UI. Panels that fail get one line in the failure report.
 */
function mountPanel(
  name: string,
  id: string,
  setup: (container: HTMLElement) => void,
): void {
  const container = $maybe(id);
  if (!container) return;
  try {
    setup(container);
  } catch (e) {
    noteMountFailure(name, e);
  }
}

function reportPanelMountFailures(): void {
  if (panelMountFailures.length === 0) return;
  setStatus(formatPanelMountFailureStatus(panelMountFailures));
  if (panelMountFailures.includes("Canvas")) {
    showModal(
      "Canvas Failed to Load",
      "The visual editor canvas did not start. Reload the window to try again.",
      [
        {
          label: "Reload Window",
          kind: "primary",
          onClick: () => {
            closeModal();
            window.location.reload();
          },
        },
        { label: "Continue", kind: "ghost", onClick: closeModal },
      ],
    );
  }
  renderEditorStateBanner();
}
