// Zephus renderer logic. Talks to the main process exclusively through
// window.zephus (the preload bridge). No Node APIs are used here.

// TODO: Split UI rendering from state management (see editorCommands, editorGit, editorSerialize, editorBlockRender, editorSave, editorParse, editorPageModel, editorUndo, editorDraft, editorInspector).

import { appendCappedLog } from "./editorLog";
import { collectUnsavedWorkSummaryLines } from "./editorUnsavedWork";
import { createEditorGitActions } from "./editorGit";
import { createEditorSaveActions } from "./editorSave";
import { createEditorSiteSaveActions } from "./editorSiteSave";
import { createEditorDraftRestoreActions } from "./editorDraftRestore";
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
  captureEditorSnapshot,
  editorSnapshotSectionsChanged,
  popEditorRedoEntry,
  popEditorUndoEntry,
  pushEditorRedoFromCurrent,
  pushEditorUndo,
  pushEditorUndoFromCurrent,
  restoreEditorSnapshot,
} from "./editorUndo";
import {
  blockToHtmlForEditor,
  sectionToHtmlForEditor,
} from "./editorBlockRender";
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
  escapeAttr,
  escapeHtml,
  plainTextToHtml,
  safeUrl,
  splitLines,
  splitPair,
} from "../shared/renderHelpers";
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
import {
  createIcons,
  Settings,
  Clock,
  Compass,
  FolderOpen,
  Plus,
  Eye,
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
  Image as ImageIcon,
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
  X,
  Info,
} from "lucide";
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

type Mode = "visual" | "code";
type BlockType = EditorBlockType;
type Block = EditorBlock;

const PALETTE: { type: BlockType; label: string }[] = [
  { type: "heading", label: "Heading" },
  { type: "text", label: "Text" },
  { type: "image", label: "Image" },
  { type: "button", label: "Button" },
  { type: "section", label: "Section" },
  { type: "divider", label: "Divider" },
  { type: "spacer", label: "Spacer" },
  { type: "columns", label: "Columns" },
  { type: "card", label: "Card" },
  { type: "gallery", label: "Gallery" },
  { type: "quote", label: "Quote" },
  { type: "list", label: "List" },
  { type: "embed", label: "Embed" },
  { type: "feature", label: "Feature" },
  { type: "testimonial", label: "Testimonial" },
  { type: "accordion", label: "FAQ / Accordion" },
  { type: "stats", label: "Stats" },
  { type: "pricing", label: "Pricing" },
  { type: "cta", label: "Call to Action" },
  { type: "html", label: "HTML" },
];

const PALETTE_ICONS: Record<BlockType, string> = {
  heading: "heading",
  text: "align-left",
  image: "image",
  button: "square",
  section: "layout",
  divider: "align-left",
  spacer: "layout",
  columns: "layout-template",
  card: "square",
  gallery: "image",
  quote: "align-left",
  list: "align-left",
  embed: "link",
  feature: "star",
  testimonial: "quote",
  accordion: "chevron-down",
  stats: "bar-chart",
  pricing: "tag",
  cta: "megaphone",
  html: "code-xml",
};

/** Runtime set of all valid block types, used to validate untrusted code-mode input. */
const KNOWN_BLOCK_TYPES: ReadonlySet<string> = new Set(
  Object.keys(PALETTE_ICONS),
);

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
      X,
      Info,
    },
  });
}

const TEXT_EDITABLE: BlockType[] = [
  "heading",
  "text",
  "button",
  "section",
  "columns",
  "card",
  "quote",
  "list",
  "feature",
  "testimonial",
  "accordion",
  "stats",
  "pricing",
  "cta",
];

interface SectionTemplate {
  id: string;
  label: string;
  /** Schema block factory — produces fresh editable blocks per insert. */
  blocks?: () => BlockNode[];
  /** Legacy/saved sections inserted as a single preserved HTML block. */
  html?: string;
  deletable?: boolean;
  onDelete?: () => void | Promise<void>;
}

/** Build a fresh editable block node with merged default props. */
function mk(
  type: BlockType,
  props: Record<string, string> = {},
  style?: BlockStyle,
): BlockNode {
  const node: BlockNode = {
    id: uid(),
    type,
    props: { ...defaultProps(type), ...props },
  };
  if (style) node.style = style;
  return node;
}

// Prebuilt section clusters inserted as fully editable schema blocks.
const TEMPLATES: SectionTemplate[] = [
  {
    id: "hero",
    label: "Hero",
    blocks: () => [
      mk(
        "heading",
        { text: "Your headline goes here", level: "1" },
        { align: "center" },
      ),
      mk(
        "text",
        {
          text: "A short supporting sentence about your product or site.",
          cls: "lead",
        },
        { align: "center" },
      ),
      mk("button", { text: "Get started", href: "#" }, { align: "center" }),
    ],
  },
  {
    id: "features",
    label: "Features",
    blocks: () => [
      mk("heading", { text: "Why choose us", level: "2" }, { align: "center" }),
      mk("feature", {
        icon: "⚡",
        title: "Fast",
        text: "Describe a key benefit in one short sentence.",
      }),
      mk("feature", {
        icon: "🎯",
        title: "Simple",
        text: "Describe a key benefit in one short sentence.",
      }),
      mk("feature", {
        icon: "🧩",
        title: "Flexible",
        text: "Describe a key benefit in one short sentence.",
      }),
    ],
  },
  {
    id: "stats",
    label: "Stats",
    blocks: () => [
      mk(
        "heading",
        { text: "By the numbers", level: "2" },
        { align: "center" },
      ),
      mk("stats", {
        items:
          "10k+ :: Happy customers\n99.9% :: Uptime\n4.9/5 :: Average rating",
      }),
    ],
  },
  {
    id: "pricing",
    label: "Pricing",
    blocks: () => [
      mk(
        "heading",
        { text: "Simple, honest pricing", level: "2" },
        { align: "center" },
      ),
      mk(
        "text",
        { text: "Choose the plan that fits your needs.", cls: "lead" },
        { align: "center" },
      ),
      mk("pricing", {
        plan: "Starter",
        price: "$9",
        period: "/mo",
        features: "One site\nEmail support",
        ctaText: "Choose Starter",
      }),
      mk("pricing", {
        plan: "Pro",
        price: "$29",
        period: "/mo",
        features: "Unlimited pages\nPriority support",
        ctaText: "Choose Pro",
      }),
      mk("pricing", {
        plan: "Studio",
        price: "$99",
        period: "/mo",
        features: "Team seats\nCustom onboarding",
        ctaText: "Choose Studio",
      }),
    ],
  },
  {
    id: "faq",
    label: "FAQ",
    blocks: () => [
      mk(
        "heading",
        { text: "Frequently asked questions", level: "2" },
        { align: "center" },
      ),
      mk("accordion", {
        items:
          "What is this for? :: Answer the most common buyer question.\nHow long does setup take? :: Share the expected time-to-value.\nCan I customize it? :: Explain the limits and flexibility.",
      }),
    ],
  },
  {
    id: "testimonials",
    label: "Testimonials",
    blocks: () => [
      mk(
        "heading",
        { text: "Loved by teams everywhere", level: "2" },
        { align: "center" },
      ),
      mk("testimonial", {
        quote: "A short customer quote that builds trust.",
        author: "Customer Name",
        role: "Founder, Studio",
      }),
      mk("testimonial", {
        quote: "Another proof point from a happy client.",
        author: "Happy Client",
        role: "CEO, Company",
      }),
    ],
  },
  {
    id: "cta",
    label: "Call to action",
    blocks: () => [
      mk("cta", {
        heading: "Ready to begin?",
        text: "Join thousands already building with us.",
        buttonText: "Contact us",
        buttonHref: "#",
      }),
    ],
  },
  {
    id: "logo-wall",
    label: "Logo Wall",
    blocks: () => [
      mk("heading", { text: "Trusted by", level: "3" }, { align: "center" }),
      mk(
        "text",
        {
          text: "Client One · Client Two · Client Three · Client Four",
          cls: "lead",
        },
        { align: "center" },
      ),
    ],
  },
  {
    id: "contact",
    label: "Contact",
    blocks: () => [
      mk("heading", { text: "Say hello", level: "2" }),
      mk("text", { text: "Drop in your email, address, or scheduling link." }),
      mk("button", { text: "Email us", href: "mailto:hello@example.com" }),
    ],
  },
  {
    id: "footer",
    label: "Footer",
    blocks: () => [
      mk("divider"),
      mk(
        "text",
        { text: "© Your Site. Built with Zephus." },
        { align: "center" },
      ),
    ],
  },
];

const editorRules = {
  allowedBlocks: null as string[] | null,
  maxHeadingLevel: 6,
};

let editorClipboard: EditorClipboardPayload | null = null;
let skipDeleteConfirm = false;
const panelMountFailures: string[] = [];

/** Cache of saved reusable sections, refreshed by renderTemplates(). */
let reusableSectionsCache: ReusableSection[] = [];

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
let selectedTabTheme: string | null = null;
let themePreviewBaseUrl: string | null = null;
let startThemes: ThemeMeta[] | null = null;
let homeDraftSummaries: DraftSummary[] = [];
let pendingHomeDraftResume: DraftSummary | null = null;
let updaterSnapshot: {
  status: string;
  version?: string;
  percent?: number;
  error?: string;
} | null = null;
let promptedDownloadedUpdateVersion: string | null = null;
const modalController = createModalController(refreshIcons);
const { closeModal, showModal, showModalNode } = modalController;

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

const TOOLBAR_TIPS: Record<string, string> = {
  Up: "Move up",
  Down: "Move down",
  Dup: "Duplicate",
  Wrap: "Wrap in a section",
  Lock: "Lock (prevent edits)",
  Unlock: "Unlock",
  Delete: "Delete",
  "Add Block": "Add a block inside",
};

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
  if (res.status === "missing") {
    return "Node.js was not found. Install Node.js 22.12 or newer, or set a custom Node.js location in Settings.";
  }
  if (res.status === "outdated") {
    return `Node.js ${res.version ?? "?"} was found, but Zephus needs Node.js 22.12 or newer.`;
  }
  return res.message || "Node.js status could not be determined.";
}

function uid(): string {
  return "b" + Math.random().toString(36).slice(2, 9);
}

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

function pageDocumentFromState(): PageDocument | null {
  if (!state.pageDocument || !state.page) return null;
  return buildPageDocumentFromSections(
    state.pageDocument,
    state.page,
    state.sections,
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
      if (state.mode === "code" && !settingCode) markDirty(true);
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
  if (startThemes) return;
  updateThemesTab({ mode: "placeholder", themes: [] });
}

async function refreshHomeDraftSummaries(): Promise<void> {
  const result = await window.zephus.listDrafts().catch(() => null);
  homeDraftSummaries = result?.ok ? result.entries : [];
}

function homeDraftLabel(entry: DraftSummary): string {
  if (entry.scope === "site") {
    return "Unsaved site shell and design settings";
  }
  const page = entry.target.replace(/^src\/pages\/?/, "");
  return page === "index.astro" || page === "index.md" || page === "index.mdx"
    ? "Unsaved draft for Home"
    : `Unsaved draft for ${page.replace(/\.(astro|md|mdx|html)$/i, "")}`;
}

function syncHomeActionState(): void {
  const resumeBtn = $("btn-resume-last") as HTMLButtonElement;
  const hasLastProject = Boolean(appSettings?.lastOpenedProject);
  resumeBtn.disabled = !hasLastProject;
  resumeBtn.classList.toggle("disabled", !hasLastProject);
}

function renderHomeStatusPanels(): void {
  const recoveryHost = $maybe("home-recovery-list");
  if (recoveryHost) {
    const drafts = homeDraftSummaries.slice(0, 4);
    if (drafts.length === 0) {
      recoveryHost.classList.add("hidden");
    } else {
      recoveryHost.classList.remove("hidden");
    }
    updateHomeDraftRecovery(
      drafts.map((draft) => ({
        projectPath: draft.projectPath,
        title: `${projectBaseName(draft.projectPath)} - ${formatRelativeTime(draft.savedAt)}`,
        body: homeDraftLabel(draft),
      })),
    );
  }

  // Render sidebar status badge
  renderSidebarUpdateStatus();
}

function updateVersionLabel(version?: string): string {
  return version ? `v${version}` : "the latest update";
}

function updaterStatusMessage(): string {
  if (updaterSnapshot?.status === "available") {
    return `${updateVersionLabel(updaterSnapshot.version)} is available.`;
  }
  if (updaterSnapshot?.status === "downloaded") {
    return `${updateVersionLabel(updaterSnapshot.version)} is downloaded and ready to install.`;
  }
  if (updaterSnapshot?.status === "downloading") {
    return `Downloading update (${Math.round(updaterSnapshot.percent ?? 0)}%).`;
  }
  if (updaterSnapshot?.status === "error") {
    return friendlyError(updaterSnapshot.error ?? "Update check failed.");
  }
  return "Check the selected update channel.";
}

async function restartToApplyUpdate(): Promise<void> {
  setStatus("Restarting to apply update...");
  const result = (await window.zephus.installUpdate()) as
    { ok?: boolean; error?: string } | undefined;
  if (result && result.ok === false) {
    setStatus("Update install could not start.");
    showModal(
      "Could Not Restart",
      friendlyError(result.error ?? "The downloaded update was not ready."),
      [{ label: "OK", kind: "primary", onClick: closeModal }],
    );
  }
}

function renderUpdaterActions(container: HTMLElement): void {
  container.innerHTML = "";

  const checkNowBtn = document.createElement("button");
  checkNowBtn.className = "btn secondary mini-btn";
  checkNowBtn.textContent = "Check for Updates Now";
  checkNowBtn.onclick = async () => {
    checkNowBtn.textContent = "Checking...";
    checkNowBtn.disabled = true;
    try {
      await window.zephus.checkForUpdates();
    } catch {
      // Ignored: status is surfaced via updater-status listener
    }
    checkNowBtn.textContent = "Check for Updates Now";
    checkNowBtn.disabled = false;
  };
  container.appendChild(checkNowBtn);

  if (updaterSnapshot?.status === "available") {
    const downloadBtn = document.createElement("button");
    downloadBtn.className = "btn primary mini-btn";
    downloadBtn.textContent = "Download Update";
    downloadBtn.onclick = async () => {
      downloadBtn.textContent = "Downloading...";
      downloadBtn.disabled = true;
      const result = (await window.zephus.downloadUpdate()) as {
        status?: string;
        error?: string;
      };
      if (result?.status === "error") {
        showModal("Update Download Failed", friendlyError(result.error), [
          { label: "OK", kind: "primary", onClick: closeModal },
        ]);
      }
    };
    container.appendChild(downloadBtn);
  } else if (updaterSnapshot?.status === "downloaded") {
    const restartBtn = document.createElement("button");
    restartBtn.className = "btn primary mini-btn";
    restartBtn.textContent = "Restart Now";
    restartBtn.onclick = () => void restartToApplyUpdate();
    container.appendChild(restartBtn);
  } else if (updaterSnapshot?.status === "downloading") {
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn ghost mini-btn";
    cancelBtn.textContent = "Cancel Download";
    cancelBtn.onclick = () => void window.zephus.cancelUpdateDownload();
    container.appendChild(cancelBtn);
  }
  refreshIcons();
}

function currentUpdaterActions(): Array<{
  id: "check" | "download" | "restart" | "cancel";
  label: string;
  tone: "secondary" | "primary" | "ghost";
}> {
  const actions: Array<{
    id: "check" | "download" | "restart" | "cancel";
    label: string;
    tone: "secondary" | "primary" | "ghost";
  }> = [{ id: "check", label: "Check for Updates Now", tone: "secondary" }];

  if (updaterSnapshot?.status === "available") {
    actions.push({ id: "download", label: "Download Update", tone: "primary" });
  } else if (updaterSnapshot?.status === "downloaded") {
    actions.push({ id: "restart", label: "Restart Now", tone: "primary" });
  } else if (updaterSnapshot?.status === "downloading") {
    actions.push({ id: "cancel", label: "Cancel Download", tone: "ghost" });
  }

  return actions;
}

function refreshUpdaterControls(): void {
  updateSettingsTabUpdater(updaterStatusMessage(), currentUpdaterActions());
}

function promptDownloadedUpdate(force = false): void {
  if (updaterSnapshot?.status !== "downloaded") return;
  const version = updaterSnapshot.version ?? "downloaded";
  if (!force) {
    if (promptedDownloadedUpdateVersion === version) return;
    if (modalController.isOpen()) return;
  }
  promptedDownloadedUpdateVersion = version;
  showModal(
    "Update Ready",
    `Zephus ${updateVersionLabel(updaterSnapshot.version)} has been downloaded. Restart now to apply it; Zephus will relaunch after the update finishes.`,
    [
      { label: "Later", kind: "ghost", onClick: closeModal },
      {
        label: "Restart Now",
        kind: "primary",
        onClick: () => void restartToApplyUpdate(),
      },
    ],
  );
}

function renderSidebarUpdateStatus(): void {
  if (!updaterSnapshot) {
    updateSidebarUpdateStatus({
      clickable: false,
      dotTone: "default",
      label: "Up to date",
    });
    return;
  }

  if (updaterSnapshot.status === "available") {
    updateSidebarUpdateStatus({
      clickable: true,
      dotTone: "active",
      label: "Update Available",
      emphasized: true,
    });
  } else if (updaterSnapshot.status === "downloading") {
    updateSidebarUpdateStatus({
      clickable: false,
      dotTone: "active",
      label: `Downloading (${Math.round(updaterSnapshot.percent ?? 0)}%)`,
    });
  } else if (updaterSnapshot.status === "downloaded") {
    updateSidebarUpdateStatus({
      clickable: true,
      dotTone: "active",
      label: "Restart to install",
    });
  } else if (updaterSnapshot.status === "checking") {
    updateSidebarUpdateStatus({
      clickable: false,
      dotTone: "default",
      label: "Checking updates…",
    });
  } else if (updaterSnapshot.status === "error") {
    updateSidebarUpdateStatus({
      clickable: true,
      dotTone: "error",
      label: "Update Error",
    });
  } else {
    const versionStr = updaterSnapshot.version
      ? `v${updaterSnapshot.version}`
      : "";
    updateSidebarUpdateStatus({
      clickable: false,
      dotTone: "default",
      label: `Up to date${versionStr ? " · " + versionStr : ""}`,
    });
  }
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
  const sectionId = activeSectionId();
  const section = findSection(sectionId);
  addBlockAt("image", section?.children.length ?? 0, sectionId);
  const block = findSelectedBlock();
  if (block) {
    await chooseAssetForImage(block);
  }
}

function renderNextActions(): void {
  if (!state.project) {
    updateNextActions(false, []);
    return;
  }

  const cards: Array<{
    title: string;
    body: string;
    actions: Array<{ label: string; onClick: () => void }>;
  }> = [];

  if (state.pageMeta.length === 0) {
    cards.push({
      title: "Create your first page",
      body: "New projects feel much less empty once you have a visible route to edit and preview.",
      actions: [{ label: "Create Page", onClick: () => void newPageFlow() }],
    });
  }

  if (state.page && state.sections.length === 0) {
    cards.push({
      title: "Start the page structure",
      body: "Add a section now so the canvas has a real layout to work with.",
      actions: [
        {
          label: "Add Hero",
          onClick: () => addSectionAt(state.sections.length, TEMPLATES[0]),
        },
        {
          label: "Add Blank Section",
          onClick: () => addSectionAt(state.sections.length),
        },
        { label: "Open Site Shell", onClick: () => void openSiteShellModal() },
      ],
    });
  }

  if (state.page && visibleNavCount() === 0) {
    cards.push({
      title: "No visible navigation items",
      body: "Visitors will not see page links yet. Review the current page metadata or stage a nav set from the shell.",
      actions: [
        {
          label: "Page Settings",
          onClick: () => {
            if (state.page) void openPageMetaModal(state.page);
          },
        },
        { label: "Review Navigation", onClick: () => void regenerateNav() },
      ],
    });
  }

  const imageBlock = state.blocks.find((block) => block.type === "image");
  if (state.page && !imageBlock) {
    cards.push({
      title: "Add visual assets",
      body: "This page has no image blocks yet. Drop in an image and reuse bundled asset import flows.",
      actions: [
        {
          label: "Import Image",
          onClick: () => void addImageBlockWithAssetFlow(),
        },
      ],
    });
  } else if (imageBlock && !(imageBlock.props["src"] ?? "").trim()) {
    cards.push({
      title: "Finish the image block",
      body: "An image block exists but it is still missing a selected asset.",
      actions: [
        {
          label: "Choose Asset",
          onClick: () => void chooseAssetForImage(imageBlock),
        },
      ],
    });
  }

  // Warn when image blocks have a src but are missing alt text.
  const imagesWithNoAlt = state.blocks.filter(
    (block) =>
      block.type === "image" &&
      (block.props["src"] ?? "").trim() !== "" &&
      (block.props["alt"] ?? "").trim() === "",
  );
  if (imagesWithNoAlt.length > 0) {
    const first = imagesWithNoAlt[0]!;
    const count = imagesWithNoAlt.length;
    cards.push({
      title: "Add image alt text",
      body: `${count === 1 ? "One image is" : `${count} images are`} missing alt text. Screen readers need a description to convey the image to users who cannot see it.`,
      actions: [
        {
          label: "Edit Image",
          onClick: () => {
            state.selectedId = first.id;
            const loc = findBlockLocation(first.id);
            if (loc) state.selectedSectionId = loc.section.id;
            renderLayers();
            renderCanvas();
            renderProperties();
          },
        },
      ],
    });
  }

  // SEO 1: Missing Meta Description Warning
  if (
    state.page &&
    state.currentMeta &&
    !(state.currentMeta.metaDescription ?? "").trim()
  ) {
    cards.push({
      title: "Add page meta description",
      body: "This page is missing a meta description. Adding one helps search engines summarize your page and improves click-through rates.",
      actions: [
        {
          label: "Page Settings",
          onClick: () => {
            if (state.page) void openPageMetaModal(state.page);
          },
        },
      ],
    });
  }

  // SEO 2: Multiple H1 Headings Warning
  const h1Blocks = state.blocks.filter(
    (block) => block.type === "heading" && block.props["level"] === "1",
  );
  if (h1Blocks.length > 1) {
    const secondH1 = h1Blocks[1]!;
    cards.push({
      title: "Multiple H1 headings detected",
      body: "SEO best practices recommend using exactly one H1 heading per page to establish a clear hierarchy. Consider changing extra H1s to H2.",
      actions: [
        {
          label: "Fix Heading",
          onClick: () => {
            state.selectedId = secondH1.id;
            const loc = findBlockLocation(secondH1.id);
            if (loc) state.selectedSectionId = loc.section.id;
            renderLayers();
            renderCanvas();
            renderProperties();
          },
        },
      ],
    });
  }

  if (state.siteDirty || state.pageDirty) {
    const actionsList = [
      { label: "Save All", onClick: () => void performSave() },
    ];
    if (state.siteDirty) {
      actionsList.push({
        label: "Discard Site",
        onClick: () => void discardPendingSiteChanges(),
      });
    }
    cards.push({
      title: "Unsaved work pending",
      body: "Keep page and site state in sync before you switch context or run a full preview.",
      actions: actionsList,
    });
  }

  updateNextActions(true, cards);
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

function activeSectionId(): string | null {
  return (
    state.selectedSectionId ??
    findBlockLocation(state.selectedId)?.section.id ??
    state.sections[0]?.id ??
    null
  );
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
  return JSON.stringify(
    effectiveSiteDocument(state) ?? state.siteDocument,
    null,
    2,
  );
}

function scheduleDraftWrite(): void {
  scheduleEditorDraftWrite(state, {
    writeDraft: window.zephus.writeDraft.bind(window.zephus),
    pageDraftContent: draftContentForCurrentState,
    siteDraftContent: siteDraftContentForCurrentState,
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

  renderEditorStateBanner();
  refreshGuidancePanels();
}

function markDirty(d: boolean): void {
  markPageDirty(state, d);
  renderDirtyIndicators();
  if (d) scheduleDraftWrite();
}

/* ---------- Start view ---------- */

async function renderRecent(): Promise<void> {
  const settings = await window.zephus.readGlobalSettings();
  appSettings = settings;
  updateRecentProjects({
    entries: settings.recentProjects.map((p, index) => ({
      path: p,
      name: projectBaseName(p),
      badge:
        settings.lastOpenedProject === p
          ? "Last Opened"
          : index === 0
            ? "Most Recent"
            : "Recent",
      resumeLabel:
        settings.lastOpenedProject === p ? "Resume ready" : "Open directly",
    })),
  });
  renderHomeStatusPanels();
  syncHomeActionState();
}

async function chooseFolder(): Promise<void> {
  const folder = await window.zephus.openFolderDialog();
  if (!folder) return;
  await openProjectByPath(folder);
}

/* ---------- App Settings ---------- */

async function openSettingsModal(): Promise<void> {
  let settings: GlobalSettings;
  try {
    settings = await window.zephus.readGlobalSettings();
  } catch {
    setStatus("Could not load settings.");
    return;
  }

  const wrap = document.createElement("div");
  const modalState = {
    settings: { ...settings },
    updaterStatusText: updaterStatusMessage(),
    updaterActions: currentUpdaterActions(),
    nodeStatusText: "Checking Node.js…",
    nodeAutoDisabled: !settings.customNodePath,
    nodeBrowseBusy: false,
    nodeAutoBusy: false,
    versionText: "Zephus",
  };

  const renderModal = () =>
    renderSettingsModalBody(wrap, {
      ...modalState,
      onSettingChange: (key, value) => {
        modalState.settings = { ...modalState.settings, [key]: value };
        renderModal();
      },
      onUpdaterAction: async (actionId) => {
        if (actionId === "check") {
          try {
            await window.zephus.checkForUpdates();
          } catch {
            /* status surfaced via updater listener */
          }
          modalState.updaterStatusText = updaterStatusMessage();
          modalState.updaterActions = currentUpdaterActions();
          renderModal();
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
          modalState.updaterStatusText = updaterStatusMessage();
          modalState.updaterActions = currentUpdaterActions();
          renderModal();
          return;
        }
        if (actionId === "restart") {
          await restartToApplyUpdate();
          return;
        }
        if (actionId === "cancel") {
          await window.zephus.cancelUpdateDownload();
          modalState.updaterStatusText = updaterStatusMessage();
          modalState.updaterActions = currentUpdaterActions();
          renderModal();
        }
      },
      onPickNodePath: async () => {
        modalState.nodeBrowseBusy = true;
        renderModal();
        try {
          const res = await window.zephus.pickNodePath();
          if (
            (res.status === "ok" || res.status === "outdated") &&
            res.usedCustomPath &&
            res.binaryPath
          ) {
            modalState.settings = {
              ...modalState.settings,
              customNodePath: res.binaryPath,
            };
          }
          modalState.nodeStatusText = `${nodeStatusMessage(res)} · ${
            modalState.settings.customNodePath
              ? `Custom: ${modalState.settings.customNodePath}`
              : "Auto-detect (system PATH)"
          }`;
          modalState.nodeAutoDisabled = !modalState.settings.customNodePath;
        } catch {
          modalState.nodeStatusText = "Could not set Node.js location.";
        } finally {
          modalState.nodeBrowseBusy = false;
          renderModal();
        }
      },
      onAutoNodePath: async () => {
        modalState.nodeAutoBusy = true;
        renderModal();
        try {
          const res = await window.zephus.setNodePath(null);
          modalState.settings = {
            ...modalState.settings,
            customNodePath: null,
          };
          modalState.nodeStatusText = `${nodeStatusMessage(res)} · Auto-detect (system PATH)`;
          modalState.nodeAutoDisabled = true;
        } catch {
          modalState.nodeStatusText = "Could not reset Node.js location.";
        } finally {
          modalState.nodeAutoBusy = false;
          renderModal();
        }
      },
      onOpenProductionLicenses: () => void openProductionLicensesModal(),
      onOpenConfigFolder: () => void window.zephus.openConfigFolder(),
    });

  renderModal();
  showModalNode("Settings", wrap, [
    {
      label: "Reset to Defaults",
      kind: "danger",
      onClick: async () => {
        if (
          !(await modalController.confirmDestructive(
            "Reset Settings",
            "Reset all Zephus settings to defaults?",
            "Reset",
          ))
        )
          return;
        const defaults: GlobalSettings = {
          ...modalState.settings,
          theme: "system",
          autoCheckUpdates: true,
          updateChannel: "auto",
          restoreLastProject: false,
          confirmBlockDelete: true,
          autosave: false,
          codeFontSize: 13,
          customNodePath: null,
        };
        await window.zephus.writeGlobalSettings(defaults);
        document.documentElement.setAttribute("data-theme", "system");
        applyCodeFontSize(13);
        closeModal();
        setStatus("Settings reset to defaults.");
        appSettings = defaults;
        updateSettingsTabSettings(defaults);
        updateSettingsTabNode("Checking Node.js…", true);
      },
    },
    { label: "Cancel", kind: "ghost", onClick: closeModal },
    {
      label: "Save",
      kind: "primary",
      onClick: async () => {
        await window.zephus.writeGlobalSettings(modalState.settings);
        document.documentElement.setAttribute(
          "data-theme",
          modalState.settings.theme,
        );
        applyCodeFontSize(modalState.settings.codeFontSize);
        appSettings = modalState.settings;
        updateSettingsTabSettings(modalState.settings);
        closeModal();
        setStatus("Settings saved.");
      },
    },
  ]);

  void window.zephus
    .getNodeStatus()
    .then((res) => {
      modalState.nodeStatusText = `${nodeStatusMessage(res)} · ${
        modalState.settings.customNodePath
          ? `Custom: ${modalState.settings.customNodePath}`
          : "Auto-detect (system PATH)"
      }`;
      modalState.nodeAutoDisabled = !modalState.settings.customNodePath;
      renderModal();
    })
    .catch(() => {
      modalState.nodeStatusText = "Could not check Node.js.";
      renderModal();
    });

  void window.zephus
    .getAppVersion()
    .then((v) => {
      modalState.versionText = `Zephus v${v}`;
      renderModal();
    })
    .catch(() => {
      modalState.versionText = "Zephus";
      renderModal();
    });
}

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
  const props: Array<[string, string | undefined]> = [
    ["--zephus-accent", design?.accent],
    ["--zephus-foreground", design?.foreground],
    ["--zephus-background", design?.background],
    ["--zephus-surface", design?.surface],
    ["--zephus-font-family", design?.fontFamily],
    ["--zephus-heading-font", design?.headingFontFamily],
    ["--zephus-radius", design?.radius],
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

function renderLicenseValue(value: string | null): string {
  return value ? escapeHtml(value) : "—";
}

function showProductionLicensesModal(result: ProductionLicensesResult): void {
  if (!result.ok) {
    showModal(
      "Production Licenses Unavailable",
      result.error ?? "Could not load production license data.",
      [
        {
          label: "Back to Settings",
          kind: "ghost",
          onClick: () => void openSettingsModal(),
        },
        {
          label: "Open Raw JSON",
          kind: "primary",
          onClick: async () => {
            const opened = await window.zephus.openProductionLicensesFile();
            if (!opened.ok) {
              setStatus(opened.error ?? "Could not open licenses.json.");
            }
          },
        },
      ],
    );
    return;
  }

  const wrap = document.createElement("div");
  renderProductionLicensesModalBody(
    wrap,
    result.entries.length,
    result.entries.map((entry) => ({
      packageId: entry.packageId,
      licenses: entry.licenses,
      repository: entry.repository,
      licenseUrl: entry.licenseUrl,
      parentsLabel:
        entry.parents.slice(0, 4).join(" > ") || "Direct dependency",
    })),
  );

  showModalNode(
    "Production Licenses",
    wrap,
    [
      {
        label: "Back to Settings",
        kind: "ghost",
        onClick: () => void openSettingsModal(),
      },
      {
        label: "Open Raw JSON",
        kind: "ghost",
        onClick: async () => {
          const opened = await window.zephus.openProductionLicensesFile();
          if (!opened.ok) {
            setStatus(opened.error ?? "Could not open licenses.json.");
          }
        },
      },
      { label: "Close", kind: "primary", onClick: closeModal },
    ],
    { size: "wide" },
  );
}

async function openProductionLicensesModal(): Promise<void> {
  showModal("Production Licenses", "Loading bundled production license data…", [
    { label: "Close", kind: "ghost", onClick: closeModal },
  ]);
  const result = await window.zephus.readProductionLicenses();
  showProductionLicensesModal(result);
}

/* ---------- Open + strict gating ---------- */

async function openProjectByPath(folder: string): Promise<void> {
  setStatus("Opening " + folder + "…");
  const result = await window.zephus.openProject(folder);
  if (!result.ok) {
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

  state.project = result;
  clearAssetCache();
  await renderRecent();

  if (!result.pkg.ready) {
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
            await window.zephus.initGitRepo(folder);
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
  $("view-start").classList.add("hidden");
  const editorView = $("view-editor");
  editorView.classList.remove("hidden");
  // Move focus into the editor so keyboard/SR users aren't dropped on <body>.
  editorView.setAttribute("tabindex", "-1");
  editorView.focus();
  $("project-name").textContent = result.name;
  const ensured = await window.zephus.ensureVisualSchema(
    result.path,
    result.astro.pagesDir,
  );
  if (!ensured.ok) {
    showModal(
      "Visual Schema Error",
      ensured.error ?? "Could not initialize Zephus schema sidecars.",
      [{ label: "OK", kind: "primary", onClick: closeModal }],
    );
    return;
  }
  const siteResult = await window.zephus.readSiteDocument(result.path);
  state.siteDocument = siteResult.ok ? siteResult.site : null;
  state.pendingSiteDocument = null;
  state.pendingSiteEditorKind = null;
  markSiteDirty(state, false);
  ensureCodeEditor();
  await maybeRestoreSiteDraft();
  void editorGit.refreshGit();
  void applyRepoRules();
  void applyMergedTheme();
  renderPalette();
  void renderTemplates();
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
    integrity === "legacy"
      ? "Migrated project into schema-backed visual mode."
      : "Ready — " + result.path,
  );
  const pendingDraft =
    pendingHomeDraftResume?.projectPath === result.path
      ? pendingHomeDraftResume
      : null;
  pendingHomeDraftResume = null;
  if (
    pendingDraft?.scope === "page" &&
    state.project?.pages.includes(pendingDraft.target)
  ) {
    await loadPage(pendingDraft.target);
    return;
  }
  if (!state.page && state.project?.pages[0]) {
    await loadPage(state.project.pages[0]);
  }
}

const editorGit = createEditorGitActions({
  getProjectPath: () => state.project?.path ?? null,
  setStatus,
  setGitStatus: updateGitStatus,
  zephus: window.zephus,
});

function renderPalette(): void {
  updateAllowedBlocks(editorRules.allowedBlocks);
}

async function renderTemplates(): Promise<void> {
  const allowed = editorRules.allowedBlocks;
  const htmlAllowed = !allowed || allowed.includes("html");
  const saved = await window.zephus.listReusableSections().catch(() => null);
  // Built-in templates insert editable schema blocks; saved sections are
  // preserved HTML and only shown when HTML blocks are permitted.
  const savedSections = htmlAllowed && saved?.ok ? saved.sections : [];
  reusableSectionsCache = savedSections;
  const merged: SectionTemplate[] = [
    ...TEMPLATES,
    ...savedSections.map((section) => ({
      id: section.id,
      label: `${section.label} (Saved)`,
      html: section.html,
      deletable: true,
      onDelete: async () => {
        await window.zephus.deleteReusableSection(section.id);
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
          await window.zephus.writePageMeta(
            state.project.path,
            row.entry.page,
            state.project.astro.pagesDir,
            {
              navLabel: row.label.trim() || row.entry.label,
              navVisible: row.visible,
            },
          );
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
            if (!page || !state.project) return;
            void window.zephus
              .clearDraft(state.project.path, "page", page)
              .then(() =>
                loadPage(page, {
                  skipUnsavedGuard: true,
                  skipDraftRestore: true,
                }),
              );
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
            void (async () => {
              await window.zephus.clearDraft(projectPath, "page", page);
              await loadPage(page, {
                skipUnsavedGuard: true,
                skipDraftRestore: true,
              });
            })();
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
    logoText: nextSite.shell.logoText,
    announcementText: nextSite.shell.announcementText,
    announcementVisible: nextSite.shell.announcementVisible,
    ctaLabel: nextSite.shell.navCtaLabel,
    ctaHref: nextSite.shell.navCtaHref,
    footerHtml: nextSite.shell.footerHtml,
    customHeadHtml: nextSite.shell.customHeadHtml,
  };

  const wrap = document.createElement("div");
  const mountShellModal = () =>
    renderSiteShellModalBody(wrap, {
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
    });
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
        nextSite.shell.layoutMode = "managed";
        nextSite.design.accent = designState.accent.trim();
        nextSite.design.background = designState.background.trim();
        nextSite.design.foreground = designState.foreground.trim();
        nextSite.design.surface = designState.surface.trim();
        nextSite.design.fontFamily = designState.bodyFont;
        nextSite.design.headingFontFamily = designState.headingFont;
        nextSite.design.fontImportUrl = buildFontImportUrl([
          designState.bodyFontGoogle,
          designState.headingFontGoogle,
        ]);
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
  editorRules.allowedBlocks = null;
  editorRules.maxHeadingLevel = 6;
  if (!state.project) return;
  try {
    const settings = (await window.zephus.readRepoSettings(
      state.project.path,
    )) as { editorRules?: Record<string, unknown> } | null;
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
      }));
  updatePageList(
    entries.map((entry) => ({
      page: entry.page,
      route: entry.route,
      navLabel: entry.navLabel,
      navVisible: entry.navVisible,
      active: entry.page === state.page,
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
  if (!state.project) return;
  const pages = await window.zephus.listPages(
    state.project.path,
    state.project.astro.pagesDir,
  );
  const meta = await window.zephus.listPageMeta(
    state.project.path,
    state.project.astro.pagesDir,
  );
  state.project.pages = pages;
  state.pageMeta = meta.ok ? meta.entries : [];
  const site = await window.zephus.readSiteDocument(state.project.path);
  if (site.ok && site.site) {
    state.siteDocument = site.site;
  }
  syncCurrentMeta();
  renderPageList(state.project);
  renderNavEditor(state.project);
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
        const created = state.pageMeta.find(
          (entry) => entry.slug === name || entry.route === "/" + name,
        );
        if (created) await loadPage(created.page);
        setStatus("Created page " + name);
      },
    },
  ]);
}

async function openPageMetaModal(page: string): Promise<void> {
  if (!state.project) return;
  const entry = await window.zephus.readPageMeta(
    state.project.path,
    page,
    state.project.astro.pagesDir,
  );
  const doc = await window.zephus.readPageDocument(
    state.project.path,
    page,
    state.project.astro.pagesDir,
  );

  const formState = {
    title: entry.title,
    slug: entry.slug,
    navLabel: entry.navLabel,
    description: entry.metaDescription,
    visible: entry.navVisible,
  };

  const wrap = document.createElement("div");
  renderPageSettingsModal(wrap, {
    title: formState.title,
    slug: formState.slug,
    slugDisabled: entry.isHome,
    navLabel: formState.navLabel,
    metaDescription: formState.description,
    navVisible: formState.visible,
    onTitleChange: (value) => {
      formState.title = value;
    },
    onSlugChange: (value) => {
      formState.slug = value;
    },
    onNavLabelChange: (value) => {
      formState.navLabel = value;
    },
    onMetaDescriptionChange: (value) => {
      formState.description = value;
    },
    onNavVisibleChange: (value) => {
      formState.visible = value;
    },
  });

  showModalNode("Page Settings", wrap, [
    {
      label: "Delete",
      kind: "danger",
      onClick: async () => {
        if (entry.isHome) {
          setStatus("Home page cannot be deleted.");
          return;
        }
        const confirmed = await modalController.confirmDestructive(
          "Delete Page",
          `Delete page "${entry.navLabel}" and remove route ${entry.route}?`,
          "Delete Page",
        );
        if (!confirmed) {
          return;
        }
        const deleted = await window.zephus.deletePage(
          state.project!.path,
          entry.page,
          state.project!.astro.pagesDir,
        );
        if (!deleted.ok) {
          setStatus("Delete failed: " + (deleted.error ?? "unknown"));
          return;
        }
        closeModal();
        if (state.page === entry.page) {
          state.page = null;
          state.sections = [];
          state.blocks = [];
          state.selectedId = null;
          state.selectedSectionId = null;
        }
        await reloadPages();
        if (!state.page && state.project?.pages[0]) {
          await loadPage(state.project.pages[0]);
        }
        setStatus(`Deleted page ${entry.navLabel}.`);
      },
    },
    {
      label: "Duplicate",
      kind: "ghost",
      onClick: async () => {
        const duplicated = await window.zephus.duplicatePage(
          state.project!.path,
          entry.page,
          state.project!.astro.pagesDir,
        );
        if (!duplicated.ok) {
          setStatus("Duplicate failed: " + (duplicated.error ?? "unknown"));
          return;
        }
        closeModal();
        await reloadPages();
        setStatus(`Duplicated page ${entry.navLabel}.`);
      },
    },
    {
      label:
        doc.ok && doc.pageDocument?.detached
          ? "Reattach Visual"
          : "Detach Visual",
      kind: "ghost",
      onClick: async () => {
        if (!state.project) return;
        if (doc.ok && doc.pageDocument?.detached) {
          const reattached = await window.zephus.reattachPageDocument(
            state.project.path,
            entry.page,
            state.project.astro.pagesDir,
          );
          if (!reattached.ok) {
            setStatus("Reattach failed: " + (reattached.error ?? "unknown"));
            return;
          }
          closeModal();
          await loadPage(entry.page);
          setStatus(`Reattached ${entry.navLabel} to visual mode.`);
          return;
        }
        const currentSource = getCode() || state.rawCode;
        const detached = await window.zephus.detachPageDocument(
          state.project.path,
          entry.page,
          state.project.astro.pagesDir,
          state.page === entry.page
            ? currentSource
            : (doc.source ?? currentSource),
        );
        if (!detached.ok) {
          setStatus("Detach failed: " + (detached.error ?? "unknown"));
          return;
        }
        closeModal();
        if (state.page === entry.page) {
          await loadPage(entry.page);
        }
        setStatus(`Detached ${entry.navLabel} from visual mode.`);
      },
    },
    { label: "Cancel", kind: "ghost", onClick: closeModal },
    {
      label: "Save",
      kind: "primary",
      onClick: async () => {
        if (!state.project) return;
        const nextSlug = formState.slug.trim() || entry.slug;
        let nextPage = entry.page;
        if (!entry.isHome && nextSlug !== entry.slug) {
          const renamed = await window.zephus.renamePage(
            state.project.path,
            entry.page,
            state.project.astro.pagesDir,
            nextSlug,
          );
          if (!renamed.ok) {
            setStatus("Rename failed: " + (renamed.error ?? "unknown"));
            return;
          }
          nextPage = entry.page.replace(entry.slug, nextSlug);
        }
        const saved = await window.zephus.writePageMeta(
          state.project.path,
          nextPage,
          state.project.astro.pagesDir,
          {
            title: formState.title.trim() || entry.title,
            navLabel:
              formState.navLabel.trim() ||
              formState.title.trim() ||
              entry.navLabel,
            metaDescription: formState.description.trim(),
            navVisible: formState.visible,
          },
        );
        if (!saved.ok) {
          setStatus("Metadata save failed: " + (saved.error ?? "unknown"));
          return;
        }
        closeModal();
        await reloadPages();
        if (state.page === entry.page) {
          state.page =
            state.project.pages.find(
              (candidate) =>
                candidate.endsWith(`${nextSlug}.astro`) ||
                candidate.endsWith(`${nextSlug}.md`) ||
                candidate === nextPage,
            ) ?? nextPage;
          syncCurrentMeta();
        }
        setStatus(`Saved page settings for ${entry.navLabel}.`);
      },
    },
  ]);
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

let editorSiteSave!: ReturnType<typeof createEditorSiteSaveActions>;

async function discardPendingSiteChanges(): Promise<void> {
  return editorSiteSave.discardPendingSiteChanges();
}

async function persistPendingSiteDocument(): Promise<boolean> {
  return editorSiteSave.persistPendingSiteDocument();
}

let editorDraftRestore!: ReturnType<typeof createEditorDraftRestoreActions>;

async function maybeRestoreSiteDraft(): Promise<void> {
  return editorDraftRestore.maybeRestoreSiteDraft();
}

async function maybeResolveUnsavedWork(options?: {
  reloadCurrentPageOnDiscard?: boolean;
}): Promise<boolean> {
  if (!isGlobalDirty(state)) return true;
  if (appSettings?.autosave) {
    return performSave();
  }
  const choice = await modalController.confirmUnsavedWork(
    "Unsaved Changes",
    buildUnsavedWorkSummary(),
  );
  if (choice === "cancel") return false;
  if (choice === "save") return performSave();
  if (state.project && state.pageDirty && state.page) {
    await window.zephus.clearDraft(state.project.path, "page", state.page);
  }
  if (state.project && state.siteDirty) {
    await discardPendingSiteChanges();
  }
  clearChanges();
  markDirty(false);
  if (options?.reloadCurrentPageOnDiscard && state.project && state.page) {
    await loadPage(state.page, {
      skipUnsavedGuard: true,
      skipDraftRestore: true,
    });
  }
  return true;
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
    return persistPendingSiteDocument();
  }
  const choice = await modalController.confirmUnsavedWork(
    "Unsaved Site Settings",
    buildUnsavedWorkSummary(),
  );
  if (choice === "cancel") return false;
  if (choice === "save") return persistPendingSiteDocument();
  await discardPendingSiteChanges();
  return true;
}

async function loadPage(
  page: string,
  options?: { skipUnsavedGuard?: boolean; skipDraftRestore?: boolean },
): Promise<void> {
  if (!state.project) return;
  if (!options?.skipUnsavedGuard && !(await maybeResolveUnsavedWork())) {
    return;
  }
  const res = await window.zephus.readPageDocument(
    state.project.path,
    page,
    state.project.astro.pagesDir,
  );
  if (!res.ok || !res.pageDocument) {
    setStatus("Could not load " + page + ": " + (res.error ?? "unknown"));
    return;
  }
  state.page = page;
  state.siteDocument = res.site;
  state.pageDocument = res.pageDocument;
  state.managedStatus = res.pageDocument.managedFileStatus;
  state.visualEditable =
    state.managedStatus !== "detached" && state.managedStatus !== "out-of-sync";
  const initialSource = res.source ?? "";
  capturePageFrame(initialSource);
  syncCurrentMeta();
  state.sections = sectionsFromPageDocument(res.pageDocument);
  syncBlocksFromSections();
  state.generatedCode = res.generatedSource ?? currentManagedSource();
  state.rawCode = state.visualEditable ? state.generatedCode : initialSource;
  state.recoveredPageDraft = null;
  if (!options?.skipDraftRestore) {
    await editorDraftRestore.maybeRestorePageDraft(
      page,
      findPageMeta(page)?.navLabel ?? page,
      state.rawCode,
      {
        visualEditable: state.visualEditable,
        applyRestoredSource: (content) => parsePage(content),
      },
    );
  }
  state.undo = [];
  state.redo = [];
  updateUndoRedoButtons();
  state.selectedId = null;
  state.selectedSectionId = state.sections[0]?.id ?? null;
  clearChanges();
  markDirty(Boolean(state.recoveredPageDraft));
  renderLayers();

  for (const li of Array.from($("page-list").children) as HTMLElement[]) {
    li.classList.toggle("active", li.dataset["page"] === page);
  }
  syncVisualModeState();
  setCode(state.rawCode);
  setMode(state.visualEditable ? "visual" : "code");
  renderDirtyIndicators();

  // Watch the open file for external changes.
  await window.zephus.watchFile(state.project.path, page);
  if (state.managedStatus === "out-of-sync") {
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
}

async function onExternalChange(): Promise<void> {
  if (!state.project || !state.page) return;

  // Ignore change events caused by Zephus's own writes: if the on-disk content
  // matches what we last generated/loaded, there is nothing external to merge.
  try {
    const onDisk = await window.zephus.readFile(state.project.path, state.page);
    if (
      onDisk.ok &&
      typeof onDisk.content === "string" &&
      (onDisk.content === state.rawCode ||
        onDisk.content === state.generatedCode)
    ) {
      return;
    }
  } catch {
    // If we cannot read the file, fall through to the prompt.
  }

  const choice = await modalController.choose<"keep" | "reload">(
    "File Changed on Disk",
    "The current page was modified outside Zephus. Reload it from disk or keep your in-app version?",
    [
      { label: "Keep Mine", value: "keep", kind: "ghost" },
      { label: "Reload", value: "reload", kind: "primary" },
    ],
  );
  if (choice !== "reload") return;
  const page = state.page;
  const projectPath = state.project?.path;
  if (page && projectPath) {
    markDirty(false);
    await window.zephus.clearDraft(projectPath, "page", page);
    await loadPage(page, { skipUnsavedGuard: true, skipDraftRestore: true });
  }
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
  state.selectedSectionId = state.sections[0]?.id ?? null;
}

function editorRenderOptions(
  viewport = state.currentViewport,
  forCanvas = false,
): {
  viewport: typeof state.currentViewport;
  forCanvas: boolean;
  canvasMaxHeadingLevel: number;
} {
  return {
    viewport,
    forCanvas,
    canvasMaxHeadingLevel: editorRules.maxHeadingLevel,
  };
}

function blockToHtml(
  block: Block,
  viewport = state.currentViewport,
  forCanvas = false,
): string {
  return blockToHtmlForEditor(block, editorRenderOptions(viewport, forCanvas));
}

function sectionToHtml(
  section: SectionNode,
  viewport = state.currentViewport,
  forCanvas = false,
): string {
  return sectionToHtmlForEditor(
    section,
    editorRenderOptions(viewport, forCanvas),
  );
}

/* ---------- Page structure parse / serialize ---------- */

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

/* ---------- Canvas rendering + drag/drop ---------- */

let dropIndex = -1;
let indicator: HTMLElement | null = null;
let dropSectionId: string | null = null;
let draggingSectionId: string | null = null;
let sectionDropIndex = -1;

// Manual double-click tracking. The canvas rebuilds on every selection change,
// so a block's DOM node is replaced between the two clicks of a native
// double-click and the browser never fires `dblclick`. We detect a rapid
// second click on the same block id ourselves so double-click-to-edit works on
// the first try, not only after the block is already selected.
let lastClickBlockId: string | null = null;
let lastClickTime = 0;
const DOUBLE_CLICK_MS = 400;
// True while an inline contenteditable session is active. Used to stop the
// block click/select logic from hijacking clicks during editing (which would
// re-enter edit mode and collapse the user's text selection — e.g. when
// double-clicking a word to highlight it).
let isInlineEditing = false;

const undoSnapshotEffects = {
  syncBlocksFromSections,
  syncSelectionState,
  applyDesignPreview,
  renderDirtyIndicators,
};

function captureSnapshot(): EditorSnapshot {
  return captureEditorSnapshot(state);
}

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
const inspectorEditLatch = createInspectorUndoLatch(pushUndo);

function scheduleCanvasRepaint(debounce: boolean): void {
  inspectorCanvasRepaint.schedule(debounce);
}

function beginInspectorEdit(): void {
  inspectorEditLatch.begin();
}

function endInspectorEdit(): void {
  inspectorEditLatch.end(() => inspectorCanvasRepaint.flush());
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
    !rerenderProperties && isInspectorTextInputFocused(document.activeElement);
  scheduleCanvasRepaint(typing);
  if (rerenderProperties) {
    endInspectorEdit();
    renderProperties();
  }
}

function wireInspectorControl<T extends HTMLElement>(control: T): T {
  control.addEventListener("focus", beginInspectorEdit);
  control.addEventListener("blur", endInspectorEdit);
  return control;
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
  if (state.sections.length === 0) {
    state.sections.push(ensureFallbackSection());
  }
  const targetSection =
    findSection(sectionId ?? activeSectionId()) ?? state.sections[0];
  if (!targetSection) return;
  if (isNodeLocked(targetSection)) {
    setStatus(lockedMutationMessage("target-section"));
    return;
  }
  pushUndo();
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
  targetSection.children.splice(index, 0, block);
  state.selectedId = block.id;
  state.selectedSectionId = targetSection.id;
  commitBlockChange(`Added ${type} block`);
}

function duplicateSelectedBlock(block: Block): void {
  const location = findBlockLocation(block.id);
  if (!location) return;
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
  const index = state.sections.findIndex((section) => section.id === sectionId);
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
  const index = state.sections.findIndex((section) => section.id === sectionId);
  const section = state.sections[index];
  if (!section) return;
  pushUndo();
  const copy = cloneSections([section])[0]!;
  copy.id = uid();
  copy.label = `${section.label} Copy`;
  copy.children = copy.children.map((child) => ({ ...child, id: uid() }));
  state.sections.splice(index + 1, 0, copy);
  state.selectedSectionId = copy.id;
  state.selectedId = null;
  commitBlockChange(`Duplicated ${section.label}`);
}

function copySelectionToClipboard(): void {
  const block = findSelectedBlock();
  if (block) {
    editorClipboard = { kind: "block", block: cloneBlock(block) };
    void navigator.clipboard
      ?.writeText(blockToHtml(block, "desktop"))
      .catch(() => undefined);
    setStatus("Copied block.");
    return;
  }
  if (state.selectedSectionId && !state.selectedId) {
    const section = findSection(state.selectedSectionId);
    if (section) {
      editorClipboard = {
        kind: "section",
        section: cloneSections([section])[0]!,
      };
      setStatus("Copied section.");
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
      location?.section ?? findSection(activeSectionId()) ?? state.sections[0];
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
  const index = state.selectedSectionId
    ? state.sections.findIndex(
        (section) => section.id === state.selectedSectionId,
      )
    : state.sections.length - 1;
  pushUndo();
  const copy = cloneSections([sourceSection])[0]!;
  copy.id = uid();
  copy.children = copy.children.map((child) => ({ ...child, id: uid() }));
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
    ...TEMPLATES.map((template) => ({
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

/** Build an insertable template from a cached saved (HTML) reusable section. */
function resolveSavedSectionTemplate(id: string): SectionTemplate | null {
  const saved = reusableSectionsCache.find((s) => s.id === id);
  if (!saved) return null;
  return { id: saved.id, label: saved.label, html: saved.html };
}

/** Cache of webPath → data URL for canvas image hydration. */
const assetDataUrlCache = new Map<string, Promise<string | null>>();

function clearAssetCache(): void {
  assetDataUrlCache.clear();
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

type ResizeCorner = "nw" | "ne" | "sw" | "se";
type ResizeTarget =
  { kind: "block"; node: Block } | { kind: "section"; node: SectionNode };

const MIN_RESIZE_WIDTH = 40;
const MIN_RESIZE_HEIGHT = 24;

/**
 * Largest width a resized element may take without spilling outside the page:
 * the content width of its containing element (section body for blocks, the
 * canvas for sections). Returns Infinity when no sensible bound exists.
 */
function maxResizeWidthFor(subject: HTMLElement): number {
  const parent = subject.parentElement;
  if (!parent) return Number.POSITIVE_INFINITY;
  const cs = getComputedStyle(parent);
  const pad =
    (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const inner = parent.clientWidth - pad;
  return inner > MIN_RESIZE_WIDTH ? inner : Number.POSITIVE_INFINITY;
}

function resizeStyleTarget(target: ResizeTarget): BlockStyle {
  target.node.style = target.node.style ?? {};
  if (state.currentViewport === "desktop") return target.node.style;
  target.node.style.responsive = target.node.style.responsive ?? {};
  target.node.style.responsive[state.currentViewport] =
    target.node.style.responsive[state.currentViewport] ?? {};
  return target.node.style.responsive[state.currentViewport]!;
}

function effectiveNodeStyle(node: { style?: BlockStyle }): BlockStyle {
  const base = node.style ? JSON.parse(JSON.stringify(node.style)) : {};
  const responsive =
    state.currentViewport === "desktop"
      ? undefined
      : node.style?.responsive?.[state.currentViewport];
  if (responsive) Object.assign(base, responsive);
  return base;
}

function makeCanvasLinksInert(root: HTMLElement): void {
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

function addResizeHandles(
  shell: HTMLElement,
  target: ResizeTarget,
  getSubject: () => HTMLElement,
): void {
  const handleWrap = document.createElement("div");
  handleWrap.className = "resize-handles";
  for (const corner of ["nw", "ne", "sw", "se"] as ResizeCorner[]) {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = `resize-handle ${corner}`;
    handle.setAttribute("aria-label", `Resize ${corner}`);
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      beginCanvasResize(event, corner, target, getSubject(), handle);
    });
    handle.addEventListener("keydown", (event) => {
      if (
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      resizeCanvasTargetByKeyboard(event.key, corner, target, getSubject());
    });
    handleWrap.appendChild(handle);
  }
  shell.appendChild(handleWrap);
}

function syncResizeHandles(
  shell: HTMLElement,
  target: ResizeTarget,
  getSubject: () => HTMLElement,
  enabled: boolean,
): void {
  shell.querySelector(".resize-handles")?.remove();
  if (enabled) addResizeHandles(shell, target, getSubject);
}

function resizeCanvasTargetByKeyboard(
  key: string,
  corner: ResizeCorner,
  target: ResizeTarget,
  subject: HTMLElement,
): void {
  const rect = subject.getBoundingClientRect();
  const fromLeft = corner === "nw" || corner === "sw";
  const fromTop = corner === "nw" || corner === "ne";
  let width = rect.width;
  let height = rect.height;
  const step = 10;

  if (key === "ArrowRight") width += fromLeft ? -step : step;
  if (key === "ArrowLeft") width += fromLeft ? step : -step;
  if (key === "ArrowDown") height += fromTop ? -step : step;
  if (key === "ArrowUp") height += fromTop ? step : -step;

  const style = resizeStyleTarget(target);
  style.width = `${Math.min(maxResizeWidthFor(subject), Math.max(MIN_RESIZE_WIDTH, Math.round(width)))}px`;
  style.height = `${Math.max(MIN_RESIZE_HEIGHT, Math.round(height))}px`;
  subject.style.width = style.width;
  subject.style.height = style.height;
  pushUndo();
  inspectorEditLatch.markActive();
  commitInspectorChange(
    `Resized ${target.kind === "block" ? target.node.type : target.node.label}`,
    true,
  );
  endInspectorEdit();
}

function beginCanvasResize(
  event: PointerEvent,
  corner: ResizeCorner,
  target: ResizeTarget,
  subject: HTMLElement,
  handle: HTMLElement,
): void {
  pushUndo();
  inspectorEditLatch.markActive();
  const startX = event.clientX;
  const startY = event.clientY;
  const rect = subject.getBoundingClientRect();
  const startWidth = rect.width;
  const startHeight = rect.height;
  const fromLeft = corner === "nw" || corner === "sw";
  const fromTop = corner === "nw" || corner === "ne";
  const maxWidth = maxResizeWidthFor(subject);
  try {
    handle.setPointerCapture(event.pointerId);
  } catch {
    /* pointer capture is best effort */
  }

  const onMove = (moveEvent: PointerEvent): void => {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    const width = Math.min(
      maxWidth,
      Math.max(
        MIN_RESIZE_WIDTH,
        Math.round(startWidth + (fromLeft ? -dx : dx)),
      ),
    );
    const height = Math.max(
      MIN_RESIZE_HEIGHT,
      Math.round(startHeight + (fromTop ? -dy : dy)),
    );
    const style = resizeStyleTarget(target);
    style.width = `${width}px`;
    style.height = `${height}px`;
    subject.style.width = style.width;
    subject.style.height = style.height;
  };

  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("blur", onCancel);
    try {
      handle.releasePointerCapture(event.pointerId);
    } catch {
      /* pointer capture is best effort */
    }
    commitInspectorChange(
      `Resized ${target.kind === "block" ? target.node.type : target.node.label}`,
      true,
    );
    endInspectorEdit();
  };
  const onUp = (): void => finish();
  const onCancel = (): void => finish();

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp, { once: true });
  document.addEventListener("pointercancel", onCancel, { once: true });
  window.addEventListener("blur", onCancel, { once: true });
}

function renderCanvas(): void {
  const canvas = $("canvas");
  canvas.setAttribute("data-viewport", state.currentViewport);
  indicator?.remove();
  indicator = null;
  updateCanvas({
    sections: state.sections.map((section) => ({
      section,
      selected: section.id === state.selectedSectionId && !state.selectedId,
      breadcrumb: `${currentPageLabel()} / section`,
      effectiveStyle: effectiveNodeStyle(section),
      children: section.children.map((blockNode) => {
        const block = blockNode as Block;
        return {
          block,
          label: blockLabel(block),
          breadcrumb: `${currentPageLabel()} / ${section.label} / ${block.type}`,
          html: blockToHtml(block, state.currentViewport, true),
          selected: block.id === state.selectedId,
          editableText: TEXT_EDITABLE.includes(block.type) && !block.locked,
          shellAriaLabel: `${blockLabel(block)} block${block.id === state.selectedId ? ", selected" : ""}`,
          htmlBlock: block.type === "html",
          effectiveStyle: effectiveNodeStyle(block),
        };
      }),
    })),
  });
  applyDesignPreview();

  canvas.ondragover = (e) => {
    e.preventDefault();
    if (state.sections.length === 0) {
      dropIndex = 0;
      dropSectionId = null;
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
    const from = state.sections.findIndex((s) => s.id === moveSectionId);
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
        const [sec] = state.sections.splice(from, 1);
        if (sec) {
          state.sections.splice(to, 0, sec);
          state.selectedSectionId = sec.id;
          state.selectedId = null;
          commitBlockChange("Moved section");
        }
      }
    }
  } else if (templateId) {
    const tpl =
      TEMPLATES.find((t) => t.id === templateId) ??
      resolveSavedSectionTemplate(templateId);
    if (!tpl) return;
    // Honor the drop position: insert after the section dropped onto, or
    // append when dropped on empty canvas space.
    const overSection = dropSectionId ? findSection(dropSectionId) : null;
    const insertAt = overSection
      ? state.sections.indexOf(overSection) + 1
      : state.sections.length;
    addSectionAt(insertAt, tpl);
  } else if (newType) {
    addBlockAt(newType as BlockType, target, targetSection?.id);
  } else if (moveBlockId) {
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
    pushUndo();
    const [moved] = location.section.children.splice(location.blockIndex, 1);
    if (!moved) return;
    const adjusted =
      location.section.id === targetSection.id && location.blockIndex < target
        ? target - 1
        : target;
    targetSection.children.splice(adjusted, 0, moved);
    state.selectedId = moved.id;
    state.selectedSectionId = targetSection.id;
    commitBlockChange(`Reordered ${moved.type} block`);
  }
  dropIndex = -1;
  dropSectionId = null;
  draggingSectionId = null;
  sectionDropIndex = -1;
  indicator?.remove();
}

interface InlineEditTarget {
  prop: string;
  multiline?: boolean;
  lineIndex?: number;
  pairSide?: "left" | "right";
}

function updateLineValue(
  raw: string,
  index: number,
  value: string,
  pairSide?: "left" | "right",
): string {
  const lines = splitLines(raw);
  while (lines.length <= index) lines.push("");
  if (!pairSide) {
    lines[index] = value;
  } else {
    const [left, right] = splitPair(lines[index] ?? "");
    lines[index] =
      pairSide === "left" ? `${value} :: ${right}` : `${left} :: ${value}`;
  }
  return lines.join("\n");
}

function targetCurrentValue(block: Block, target: InlineEditTarget): string {
  const raw = block.props[target.prop] ?? "";
  if (target.lineIndex === undefined) return raw;
  const line = splitLines(raw)[target.lineIndex] ?? "";
  if (!target.pairSide) return line;
  const [left, right] = splitPair(line);
  return target.pairSide === "left" ? left : right;
}

function applyInlineValue(
  block: Block,
  target: InlineEditTarget,
  value: string,
): void {
  if (target.lineIndex === undefined) {
    block.props[target.prop] = value;
    return;
  }
  block.props[target.prop] = updateLineValue(
    block.props[target.prop] ?? "",
    target.lineIndex,
    value,
    target.pairSide,
  );
}

function attachInlineTarget(
  root: HTMLElement,
  selector: string,
  block: Block,
  target: InlineEditTarget,
): HTMLElement | null {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) return null;
  el.classList.add("editable-text-target");
  el.title = "Double-click to edit text";
  el.ondblclick = (event) => {
    // Already editing: let the browser's native word-selection happen instead
    // of restarting the edit session (which would collapse the selection).
    if (isInlineEditing) return;
    event.preventDefault();
    event.stopPropagation();
    startInlineEdit(el, block, target);
  };
  return el;
}

function attachInlineEditors(root: HTMLElement, block: Block): HTMLElement[] {
  const targets: HTMLElement[] = [];
  const add = (selector: string, target: InlineEditTarget) => {
    const el = attachInlineTarget(root, selector, block, target);
    if (el) targets.push(el);
  };
  switch (block.type) {
    case "heading":
    case "text":
    case "button":
    case "section":
      add(":scope > *", { prop: "text", multiline: block.type !== "button" });
      break;
    case "columns":
      root.querySelectorAll<HTMLElement>(".zephus-column").forEach((_, i) =>
        add(`.zephus-column:nth-of-type(${i + 1})`, {
          prop: `col${i + 1}`,
          multiline: true,
        }),
      );
      break;
    case "card":
      add("h3", { prop: "title" });
      add("p", { prop: "text", multiline: true });
      break;
    case "quote":
      add("p", { prop: "text", multiline: true });
      add("cite", { prop: "cite" });
      break;
    case "list":
      root.querySelectorAll<HTMLElement>("li").forEach((_, i) =>
        add(`li:nth-of-type(${i + 1})`, {
          prop: "items",
          lineIndex: i,
        }),
      );
      break;
    case "feature":
      add(".zephus-feature-icon", { prop: "icon" });
      add("h3", { prop: "title" });
      add("p", { prop: "text", multiline: true });
      break;
    case "testimonial":
      add("blockquote", { prop: "quote", multiline: true });
      add("figcaption strong", { prop: "author" });
      add("figcaption span", { prop: "role" });
      break;
    case "accordion":
      root.querySelectorAll<HTMLElement>("details").forEach((_, i) => {
        add(`details:nth-of-type(${i + 1}) summary`, {
          prop: "items",
          lineIndex: i,
          pairSide: "left",
        });
        add(`details:nth-of-type(${i + 1}) p`, {
          prop: "items",
          lineIndex: i,
          pairSide: "right",
          multiline: true,
        });
      });
      break;
    case "stats":
      root.querySelectorAll<HTMLElement>(".zephus-stat").forEach((_, i) => {
        add(`.zephus-stat:nth-of-type(${i + 1}) .zephus-stat-num`, {
          prop: "items",
          lineIndex: i,
          pairSide: "left",
        });
        add(`.zephus-stat:nth-of-type(${i + 1}) .zephus-stat-label`, {
          prop: "items",
          lineIndex: i,
          pairSide: "right",
        });
      });
      break;
    case "pricing":
      add("h3", { prop: "plan" });
      add(".zephus-price-amount", { prop: "price" });
      add(".zephus-price-period", { prop: "period" });
      root.querySelectorAll<HTMLElement>("li").forEach((_, i) =>
        add(`li:nth-of-type(${i + 1})`, {
          prop: "features",
          lineIndex: i,
        }),
      );
      add("a.button", { prop: "ctaText" });
      break;
    case "cta":
      add("h2", { prop: "heading" });
      add("p", { prop: "text", multiline: true });
      add("a.button", { prop: "buttonText" });
      break;
  }
  return targets;
}

function startFirstInlineEdit(root: HTMLElement, block: Block): void {
  const first = attachInlineEditors(root, block)[0];
  if (!first) return;
  first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
}

function startInlineEdit(
  el: HTMLElement,
  block: Block,
  target: InlineEditTarget = { prop: "text" },
): void {
  const original = targetCurrentValue(block, target);
  let finished = false;
  el.setAttribute("contenteditable", "true");
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-label", "Edit text");
  el.classList.add("inline-editing");
  isInlineEditing = true;
  el.focus();
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  const cleanup = (): void => {
    isInlineEditing = false;
    el.removeAttribute("contenteditable");
    el.removeAttribute("role");
    el.removeAttribute("aria-label");
    el.classList.remove("inline-editing");
    el.removeEventListener("blur", finish);
    el.removeEventListener("keydown", onKeydown);
    el.removeEventListener("paste", onPaste);
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    const newText = el.innerText.trim();
    cleanup();
    if (newText !== original) {
      pushUndo();
      applyInlineValue(block, target, newText);
      commitBlockChange(`Edited ${block.type} content`);
    } else {
      renderCanvas();
      renderProperties();
    }
  };
  const cancel = (): void => {
    if (finished) return;
    finished = true;
    el.innerText = original;
    cleanup();
    renderCanvas();
    renderProperties();
  };
  const onPaste = (event: ClipboardEvent): void => {
    handlePlainTextPaste(event);
  };
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "Enter") {
      // Allow a literal line break only for free-form multiline props. Targets
      // backed by a line-encoded shared prop (lineIndex set, e.g. an accordion
      // answer) must NOT contain newlines — that would corrupt the encoding —
      // so those still commit on Enter.
      const allowNewline = target.multiline && target.lineIndex === undefined;
      if (!allowNewline || event.metaKey || event.ctrlKey) {
        event.preventDefault();
        finish();
      }
    }
  };
  el.addEventListener("blur", finish);
  el.addEventListener("keydown", onKeydown);
  el.addEventListener("paste", onPaste);
}

function defaultProps(type: BlockType): Record<string, string> {
  switch (type) {
    case "heading":
      return { text: "New heading", level: "2", cls: "" };
    case "text":
      return { text: "New paragraph of text.", cls: "" };
    case "image":
      return {
        src: "/assets/images/placeholder-landscape.svg",
        alt: "",
        cls: "",
      };
    case "button":
      return { text: "Click me", href: "#", cls: "" };
    case "section":
      return { text: "A new content section", cls: "" };
    case "divider":
      return { cls: "" };
    case "spacer":
      return { height: "48px", cls: "" };
    case "columns":
      return {
        col1: "Column one content",
        col2: "Column two content",
        count: "2",
        cls: "",
      };
    case "card":
      return { title: "Card title", text: "Card body copy.", cls: "" };
    case "gallery":
      return {
        images:
          "/assets/images/placeholder-square.svg\n/assets/images/placeholder-square.svg\n/assets/images/placeholder-square.svg",
        cls: "",
      };
    case "quote":
      return {
        text: "A quote or testimonial.",
        cite: "Customer Name",
        cls: "",
      };
    case "list":
      return {
        items: "First item\nSecond item\nThird item",
        ordered: "false",
        cls: "",
      };
    case "embed":
      return { src: "", title: "Embed", cls: "" };
    case "feature":
      return {
        icon: "★",
        title: "Feature title",
        text: "A short sentence describing this feature or benefit.",
        cls: "",
      };
    case "testimonial":
      return {
        quote: "This product changed how our whole team works.",
        author: "Customer Name",
        role: "Title, Company",
        cls: "",
      };
    case "accordion":
      return {
        items:
          "What is your refund policy? :: We offer a 30-day money-back guarantee.\nDo you offer support? :: Yes, by email within one business day.",
        cls: "",
      };
    case "stats":
      return {
        items: "10k+ :: Happy customers\n99.9% :: Uptime\n24/7 :: Support",
        cls: "",
      };
    case "pricing":
      return {
        plan: "Pro",
        price: "$12",
        period: "/mo",
        features: "Everything in Free\nUnlimited projects\nPriority support",
        ctaText: "Choose Pro",
        ctaHref: "#",
        cls: "",
      };
    case "cta":
      return {
        heading: "Ready to get started?",
        text: "Join thousands of happy customers today.",
        buttonText: "Get started",
        buttonHref: "#",
        cls: "",
      };
    case "html":
      return {};
  }
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
    pageValue:
      state.pageMeta.find((meta) => meta.route === current)?.route ??
      pageOptions[0]?.value ??
      "/",
    rawValue: "",
  };
  modalState.rawValue = prefillFor(modalState.kind, current);

  const renderModal = () =>
    renderLinkPickerModal(wrap, {
      kind: modalState.kind,
      pageOptions,
      pageValue: modalState.pageValue,
      rawValue: modalState.rawValue,
      onKindChange: (value) => {
        modalState.kind = value;
        if (value === "page" && !modalState.pageValue) {
          modalState.pageValue = pageOptions[0]?.value ?? "/";
        }
        renderModal();
      },
      onPageValueChange: (value) => {
        modalState.pageValue = value;
        renderModal();
      },
      onRawValueChange: (value) => {
        modalState.rawValue = value;
        renderModal();
      },
    });

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

interface FontOption {
  label: string;
  stack: string;
  /** Google Fonts family spec (e.g. "Inter:wght@400;600"), if applicable. */
  google?: string;
}

const FONT_OPTIONS: FontOption[] = [
  { label: "System UI", stack: "system-ui, sans-serif" },
  {
    label: "Inter",
    stack: "'Inter', sans-serif",
    google: "Inter:wght@400;500;600;700",
  },
  {
    label: "Roboto",
    stack: "'Roboto', sans-serif",
    google: "Roboto:wght@400;500;700",
  },
  {
    label: "Open Sans",
    stack: "'Open Sans', sans-serif",
    google: "Open+Sans:wght@400;600;700",
  },
  { label: "Lato", stack: "'Lato', sans-serif", google: "Lato:wght@400;700" },
  {
    label: "Montserrat",
    stack: "'Montserrat', sans-serif",
    google: "Montserrat:wght@400;600;700",
  },
  {
    label: "Poppins",
    stack: "'Poppins', sans-serif",
    google: "Poppins:wght@400;500;600;700",
  },
  {
    label: "Playfair Display",
    stack: "'Playfair Display', serif",
    google: "Playfair+Display:wght@400;600;700",
  },
  {
    label: "Merriweather",
    stack: "'Merriweather', serif",
    google: "Merriweather:wght@400;700",
  },
  { label: "Georgia (serif)", stack: "Georgia, 'Times New Roman', serif" },
  { label: "Monospace", stack: "ui-monospace, 'SF Mono', Menlo, monospace" },
];

interface FontControl {
  element: HTMLElement;
  getStack: () => string;
  getGoogle: () => string | null;
}

/**
 * A font selector: a curated dropdown (system + popular Google Fonts) plus a
 * custom CSS font-family option, with a preview line. Google selections also
 * return a family spec so the layout can load the webfont.
 */
function createFontControl(value: string): FontControl {
  const wrap = document.createElement("div");
  wrap.className = "font-control";

  const select = document.createElement("select");
  select.className = "text";
  FONT_OPTIONS.forEach((opt, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = opt.label;
    select.appendChild(option);
  });
  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "Custom…";
  select.appendChild(customOption);

  const customInput = document.createElement("input");
  customInput.className = "text font-custom";
  customInput.placeholder = "'Brand Sans', system-ui, sans-serif";

  const preview = document.createElement("div");
  preview.className = "font-preview";
  preview.textContent = "The quick brown fox jumps over the lazy dog";

  const matchIndex = FONT_OPTIONS.findIndex((o) => o.stack === value.trim());
  if (matchIndex >= 0) {
    select.value = String(matchIndex);
  } else if (value.trim()) {
    select.value = "custom";
    customInput.value = value;
  } else {
    select.value = "0";
  }

  const currentStack = (): string =>
    select.value === "custom"
      ? customInput.value.trim()
      : (FONT_OPTIONS[Number(select.value)]?.stack ?? "");

  const sync = (): void => {
    customInput.style.display = select.value === "custom" ? "" : "none";
    preview.style.fontFamily = currentStack() || "inherit";
  };
  select.onchange = sync;
  customInput.oninput = () => {
    preview.style.fontFamily = currentStack() || "inherit";
  };
  sync();

  wrap.append(select, customInput, preview);
  return {
    element: wrap,
    getStack: currentStack,
    getGoogle: () =>
      select.value === "custom"
        ? null
        : (FONT_OPTIONS[Number(select.value)]?.google ?? null),
  };
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

interface AssetBrowserOptions {
  filter?: AssetEntry["category"] | "all";
  title?: string;
  onSelect: (webPath: string) => void;
}

function openAssetBrowser(options: AssetBrowserOptions): void {
  if (!state.project) return;
  const project = state.project;
  const filter = options.filter ?? "all";
  const wrap = document.createElement("div");
  const modalState = {
    assets: [] as AssetBrowserModalEntry[],
    dragActive: false,
  };

  const renderModal = () =>
    renderAssetBrowserModalBody(wrap, {
      assets: modalState.assets,
      dragActive: modalState.dragActive,
      emptyMessage: "No assets yet. Import or drop files to get started.",
      onDragActiveChange: (active) => {
        modalState.dragActive = active;
        renderModal();
      },
      onDropFiles: (files) => {
        void handleDroppedFiles(files);
      },
      onSelect: (webPath) => {
        closeModal();
        options.onSelect(webPath);
      },
      onRendered: refreshIcons,
    });

  const resolvePreviewSrc = async (
    asset: AssetEntry,
  ): Promise<string | undefined> => {
    if (asset.category !== "images") return undefined;
    try {
      const res = await window.zephus.readAssetDataUrl(
        project.path,
        project.astro.publicDir,
        asset.webPath,
      );
      return res.ok ? (res.dataUrl ?? undefined) : undefined;
    } catch {
      return undefined;
    }
  };

  const refresh = async (): Promise<void> => {
    const result = await window.zephus.listAssets(
      project.path,
      project.astro.publicDir,
    );
    const assets = (result.ok ? result.assets : []).filter(
      (a) => filter === "all" || a.category === filter,
    );
    modalState.assets = await Promise.all(
      assets.map(async (asset) => ({
        category: asset.category,
        fileName: asset.fileName,
        previewSrc: await resolvePreviewSrc(asset),
        size: asset.size,
        webPath: asset.webPath,
      })),
    );
    renderModal();
  };

  const handleDropPaths = async (paths: string[]): Promise<void> => {
    if (paths.length === 0) return;
    const res = await window.zephus.importAssetPaths(
      project.path,
      project.astro.publicDir,
      paths,
    );
    if (res.errors.length > 0) {
      setStatus(`Some files failed to import: ${res.errors.join("; ")}`);
    } else {
      setStatus(`Imported ${res.imported.length} file(s).`);
    }
    await refresh();
  };

  const handleDroppedFiles = async (files: File[]): Promise<void> => {
    modalState.dragActive = false;
    renderModal();
    const paths = files
      .map((file) => {
        try {
          return window.zephus.getDroppedFilePath(file);
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    await handleDropPaths(paths);
  };

  renderModal();
  void refresh();

  showModalNode(options.title ?? "Asset Browser", wrap, [
    {
      label: "Import Files",
      kind: "primary",
      onClick: async () => {
        if (!state.project) return;
        const res = await window.zephus.importAssets(
          project.path,
          project.astro.publicDir,
        );
        if (res.errors.length > 0) {
          setStatus(`Some files failed: ${res.errors.join("; ")}`);
        } else if (res.imported.length > 0) {
          setStatus(`Imported ${res.imported.length} file(s).`);
        }
        await refresh();
      },
    },
    { label: "Close", kind: "ghost", onClick: closeModal },
  ]);
}

function renderProperties(): void {
  const panel = $("properties");
  const block = findSelectedBlock();
  const section =
    (block ? findBlockLocation(block.id)?.section : null) ??
    findSection(state.selectedSectionId);
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
      locked: !!section.locked,
      onFocus: beginInspectorEdit,
      onBlur: endInspectorEdit,
      onSectionLabelChange: (value) => {
        if (isNodeLocked(section)) {
          setStatus(lockedMutationMessage("section"));
          return;
        }
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

  const supportedBlockTypes: EditorBlockType[] = [
    "html",
    "heading",
    "text",
    "section",
    "quote",
    "button",
    "image",
    "columns",
    "card",
    "gallery",
    "list",
    "embed",
    "divider",
    "spacer",
    "feature",
    "testimonial",
    "accordion",
    "stats",
    "pricing",
    "cta",
  ];

  if (supportedBlockTypes.includes(block.type)) {
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
              block.raw = value;
              commitInspectorChange("Updated HTML markup");
            }
          : undefined,
      onStyleChange: (key, value, rerenderProperties) => {
        if (isNodeLocked(block)) {
          setStatus(lockedMutationMessage("block"));
          return;
        }
        block.style = block.style ?? {};
        (block.style as Record<string, unknown>)[key] = value;
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
              const result = await window.zephus.saveReusableSection(
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

/* ---------- Mode switching ---------- */

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

  if (mode === "code") {
    state.mode = mode;
    $("mode-visual").classList.toggle("active", false);
    $("mode-code").classList.toggle("active", true);
    state.rawCode =
      state.managedStatus === "detached" ||
      state.managedStatus === "out-of-sync"
        ? getCode() || state.rawCode
        : currentManagedSource();
    setCode(state.rawCode);
    codeEl.classList.remove("hidden");
    $("canvas").classList.add("hidden");
    $("preview-frame").classList.add("hidden");
    cm?.focus();
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
    markDirty(true);
  }

  state.mode = mode;
  $("mode-visual").classList.toggle("active", true);
  $("mode-code").classList.toggle("active", false);
  $("canvas").classList.remove("hidden");
  codeEl.classList.add("hidden");
  $("preview-frame").classList.add("hidden");
  renderCanvas();
  renderProperties();
  updateUndoRedoButtons();
}

/* ---------- Save ---------- */

let performSave: () => Promise<boolean>;

editorSiteSave = createEditorSiteSaveActions({
  getState: () => state,
  setStatus,
  onSiteStateChanged: () => {
    renderDirtyIndicators();
    if (state.project) renderNavEditor(state.project);
  },
  zephus: window.zephus,
});

editorDraftRestore = createEditorDraftRestoreActions({
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
  serializeBlocks,
  pageDocumentFromState,
  syncVisualModeState,
  sectionsFromPageDocument,
  syncBlocksFromSections,
  clearChanges,
  markDirty,
  renderDirtyIndicators,
  reloadPages,
  persistPendingSiteDocument,
  afterSave: () => void editorGit.refreshGit(),
  zephus: window.zephus,
});
performSave = () => editorSave.performSave();

/* ---------- Preview + responsive viewport ---------- */

function setViewport(vp: "desktop" | "tablet" | "mobile"): void {
  state.currentViewport = vp;
  const wrap = document.querySelector(".canvas-wrap");
  if (!wrap) return;
  wrap.classList.remove("vp-tablet", "vp-mobile");
  if (vp === "tablet") wrap.classList.add("vp-tablet");
  if (vp === "mobile") wrap.classList.add("vp-mobile");
  $("vp-desktop").classList.toggle("active", vp === "desktop");
  $("vp-tablet").classList.toggle("active", vp === "tablet");
  $("vp-mobile").classList.toggle("active", vp === "mobile");
  if (state.mode === "visual" && !state.previewUrl) {
    renderCanvas();
    renderProperties();
  }
}

/**
 * Runs `npm install` for a project with a live-log modal. Resolves true on
 * success. Used after scaffolding and before preview/publish when node_modules
 * is missing — so a novice never has to touch a terminal.
 */
async function runInstallFlow(projectPath: string): Promise<boolean> {
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

  return new Promise<boolean>((resolve) => {
    let done = false;
    const stopHeartbeat = () => window.clearInterval(heartbeat);
    showModalNode("Setting Up Your Site", wrap, [
      {
        label: "Run in Background",
        kind: "ghost",
        onClick: () => {
          if (!done) {
            stopHeartbeat();
            closeModal();
            resolve(false);
          }
        },
      },
    ]);

    void window.zephus
      .installDependencies(projectPath)
      .then((result) => {
        done = true;
        stopHeartbeat();
        unsub();
        if (result.ok) {
          status.textContent = "Dependencies installed. You're ready to go.";
          setStatus("Dependencies installed.");
          closeModal();
          resolve(true);
        } else {
          status.textContent = "Install failed: " + friendlyError(result.error);
          setStatus("Dependency install failed.");
          resolve(false);
        }
      })
      .catch(() => {
        done = true;
        stopHeartbeat();
        unsub();
        resolve(false);
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
  return runInstallFlow(state.project.path);
}

function updatePreviewButton(running: boolean): void {
  const btn = $maybe("btn-preview");
  if (!btn) return;
  btn.innerHTML = running
    ? `<i data-lucide="square"></i> Stop Preview`
    : `<i data-lucide="play"></i> Start Preview`;
  refreshIcons();
}

function resetPreviewState(message?: string): void {
  state.previewUrl = null;
  state.unsubLog?.();
  state.unsubLog = null;
  updatePreviewButton(false);
  refreshGuidancePanels();
  if (message) setStatus(message);
}

async function togglePreview(): Promise<void> {
  if (!state.project) return;

  // Preview runs in a dedicated external window loading the dev server, so the
  // editor stays fully in edit mode. Stopping closes that window + the server.
  if (state.previewUrl) {
    await window.zephus.closePreviewWindow();
    resetPreviewState("Preview stopped.");
    return;
  }

  if (isGlobalDirty(state)) {
    const resolved = await maybeResolveUnsavedWork({
      reloadCurrentPageOnDiscard: true,
    });
    if (!resolved) return;
  }
  if (!(await ensureDependencies())) return;
  setStatus("Starting dev server (npm run dev)…");
  state.unsubLog = window.zephus.onPreviewLog((chunk) => {
    const logEl = $("dev-log");
    appendCappedLog(logEl, chunk);
  });
  const result = await window.zephus.startPreview(state.project.path);
  if (!result.ok || !result.url) {
    setStatus("Preview failed: " + friendlyError(result.error));
    state.unsubLog?.();
    state.unsubLog = null;
    return;
  }
  const opened = await window.zephus.openPreviewWindow(result.url);
  if (!opened.ok) {
    setStatus("Preview failed: " + friendlyError(opened.error));
    await window.zephus.stopPreview();
    state.unsubLog?.();
    state.unsubLog = null;
    return;
  }
  state.previewUrl = result.url;
  updatePreviewButton(true);
  refreshGuidancePanels();
  setStatus("Preview open in a separate window: " + result.url);
}

/* ---------- Publish ---------- */

async function publishSite(): Promise<void> {
  if (!state.project) return;
  if (!(await ensureDependencies())) return;
  setStatus("Building site for production (npm run build)…");
  const r = await window.zephus.publish(
    state.project.path,
    state.project.astro.outDir,
  );
  if (!r.ok) {
    showModal("Build Failed", friendlyError(r.error), [
      { label: "OK", kind: "primary", onClick: closeModal },
    ]);
    setStatus("Build failed.");
    return;
  }
  setStatus(
    "Build complete. Output: " + (r.outputDir ?? state.project.astro.outDir),
  );
  const pubWrap = document.createElement("div");
  renderPublishSuccessModalBody(pubWrap, {
    outputDir: r.outputDir ?? state.project.astro.outDir,
  });
  showModalNode("Site Built — Ready to Go Online", pubWrap, [
    {
      label: "Open Output Folder",
      kind: "ghost",
      onClick: () => {
        if (state.project)
          void window.zephus.publish(
            state.project.path,
            state.project.astro.outDir,
          );
      },
    },
    { label: "Done", kind: "primary", onClick: closeModal },
  ]);
}

/* ---------- Close ---------- */

async function closeProject(): Promise<void> {
  if (!(await maybeResolveUnsavedWork())) {
    return;
  }
  if (state.previewUrl) {
    await window.zephus.closePreviewWindow();
    resetPreviewState();
  }
  await window.zephus.stopWatch();
  state.unsubExternal?.();
  state.unsubExternal = null;
  state.project = null;
  clearAssetCache();
  state.siteDocument = null;
  state.pendingSiteDocument = null;
  state.pendingSiteEditorKind = null;
  state.pageDocument = null;
  state.page = null;
  state.pageMeta = [];
  state.currentMeta = null;
  state.managedStatus = "missing";
  state.visualEditable = true;
  state.generatedCode = "";
  state.sections = [];
  state.blocks = [];
  state.selectedSectionId = null;
  state.recoveredPageDraft = null;
  state.recoveredSiteDraft = null;
  cancelScheduledEditorDraftWrite(state);
  clearChanges();
  clearSiteChanges(state);
  markSiteDirty(state, false);
  markDirty(false);
  $("view-editor").classList.add("hidden");
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
}

/* ---------- Undo / redo ---------- */

function updateUndoRedoButtons(): void {
  syncUndoRedoToolbar({
    mode: state.mode,
    visualUndoDepth: state.undo.length,
    visualRedoDepth: state.redo.length,
    codeCanUndo: cm?.canUndo() ?? false,
    codeCanRedo: cm?.canRedo() ?? false,
    undoButton: $("btn-undo") as HTMLButtonElement,
    redoButton: $("btn-redo") as HTMLButtonElement,
  });
}

function doUndo(): void {
  const prev = popEditorUndoEntry(state);
  if (!prev) return;
  const sectionsChanged = editorSnapshotSectionsChanged(prev, state.sections);
  pushEditorRedoFromCurrent(state);
  restoreSnapshot(prev);
  if (sectionsChanged) {
    trackChange("Undid a change");
    markDirty(true);
  }
  renderLayers();
  renderCanvas();
  renderProperties();
  updateUndoRedoButtons();
}

function doRedo(): void {
  const next = popEditorRedoEntry(state);
  if (!next) return;
  const sectionsChanged = editorSnapshotSectionsChanged(next, state.sections);
  pushEditorUndoFromCurrent(state);
  restoreSnapshot(next);
  if (sectionsChanged) {
    trackChange("Redid a change");
    markDirty(true);
  }
  renderLayers();
  renderCanvas();
  renderProperties();
  updateUndoRedoButtons();
}

function onKeydown(e: KeyboardEvent): void {
  const active = document.activeElement as HTMLElement | null;
  const editing =
    !!active &&
    (active.isContentEditable ||
      active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.tagName === "SELECT");

  if ((e.key === "?" || e.key === "h" || e.key === "H") && !editing) {
    openHelpModal();
    e.preventDefault();
    return;
  }

  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === "s") {
    void performSave();
    e.preventDefault();
    return;
  }
  if (state.mode === "code" && mod) {
    if (e.key === "z" && !e.shiftKey) {
      cm?.undo();
      updateUndoRedoButtons();
      e.preventDefault();
      return;
    }
    if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
      cm?.redo();
      updateUndoRedoButtons();
      e.preventDefault();
      return;
    }
  }
  if (state.mode !== "visual") return;
  if (editing) return;
  // Don't let a destructive block shortcut fire while a chrome control (e.g. a
  // toolbar button) holds focus — only when a block itself is the focus/target.
  const onChromeControl =
    !!active &&
    (active.tagName === "BUTTON" || active.getAttribute("role") === "button") &&
    !active.classList.contains("block");
  if (
    onChromeControl &&
    (e.key === "Delete" ||
      e.key === "Backspace" ||
      e.key === "d" ||
      e.key === "D")
  ) {
    return;
  }
  if (mod && e.key === "z" && !e.shiftKey) {
    doUndo();
    e.preventDefault();
  } else if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
    doRedo();
    e.preventDefault();
  } else if (mod && (e.key === "d" || e.key === "D")) {
    const block = findSelectedBlock();
    if (block) {
      duplicateSelectedBlock(block);
      e.preventDefault();
    } else if (state.selectedSectionId && !state.selectedId) {
      duplicateSection(state.selectedSectionId);
      e.preventDefault();
    }
  } else if (mod && e.key === "c") {
    copySelectionToClipboard();
    e.preventDefault();
  } else if (mod && e.key === "x") {
    void cutSelectionToClipboard();
    e.preventDefault();
  } else if (mod && e.key === "v") {
    pasteFromClipboard();
    e.preventDefault();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    const block = findSelectedBlock();
    if (block && !block.locked) {
      void deleteBlock(block);
      e.preventDefault();
    } else if (!block && state.selectedSectionId && !state.selectedId) {
      const section = findSection(state.selectedSectionId);
      if (section && !section.locked) {
        void deleteSection(state.selectedSectionId);
        e.preventDefault();
      }
    }
  }
}

/* ---------- Start view tabs and theme picker ---------- */

function initStartTabs(): void {
  const tabs = ["recent", "create", "settings", "about"] as const;
  const tabBtns = tabs.map((t) => $("tab-" + t));

  // Wire click handlers.
  for (const [i, t] of tabs.entries()) {
    const btn = tabBtns[i];
    if (btn) btn.onclick = () => void switchStartTab(t);
  }

  // Arrow-key roving tabindex (ARIA Authoring Practices Guide — Tabs pattern).
  // Only one tab is in the natural tab order at a time; Left/Right/Home/End
  // move focus within the tablist without requiring an extra Tab keypress.
  const tablist = document.querySelector<HTMLElement>(
    ".start-nav[role='tablist']",
  );
  if (!tablist) return;
  tablist.addEventListener("keydown", (e) => {
    const currentIndex = tabBtns.findIndex(
      (btn) => btn === document.activeElement,
    );
    if (currentIndex < 0) return;
    let next = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      next = (currentIndex + 1) % tabs.length;
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      next = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = tabs.length - 1;
    }
    if (next < 0) return;
    e.preventDefault();
    const target = tabs[next]!;
    void switchStartTab(target);
    tabBtns[next]?.focus();
  });
}

async function switchStartTab(
  target: "recent" | "create" | "settings" | "about",
): Promise<void> {
  const tabs = ["recent", "create", "settings", "about"] as const;
  for (const t of tabs) {
    const tabBtn = $("tab-" + t);
    const pane = $("pane-" + t);
    if (tabBtn) {
      tabBtn.classList.toggle("active", t === target);
      tabBtn.setAttribute("aria-selected", t === target ? "true" : "false");
      tabBtn.setAttribute("tabindex", t === target ? "0" : "-1");
    }
    if (pane) {
      pane.classList.toggle("active", t === target);
      pane.classList.toggle("hidden", t !== target);
    }
  }
  if (target === "create") {
    await renderThemesInTab();
  } else if (target === "settings") {
    await renderSettingsInTab();
  } else if (target === "about") {
    await renderAboutAndLicensesInTab();
  }
}

async function activateHomeSection(
  section: "recent" | "create" | "settings" | "about",
): Promise<void> {
  await switchStartTab(section);
}

function syncCreateButtonState(): void {
  const btnCreate = $("btn-create") as HTMLButtonElement;
  if (!btnCreate) return;
  const enabled = selectedTabTheme !== null;
  btnCreate.disabled = !enabled;
  btnCreate.classList.toggle("disabled", !enabled);
}

function previewUrlForTheme(theme: ThemeMeta): string | null {
  if (!themePreviewBaseUrl) return null;
  return new URL(theme.previewPath, themePreviewBaseUrl).toString();
}

function selectThemeCard(themeId: string): void {
  selectedTabTheme = themeId;
  if (startThemes) {
    updateThemesTab({
      mode: "ready",
      themes: startThemes.map((theme) => ({
        id: theme.id,
        name: theme.name,
        description: theme.description,
        previewUrl: previewUrlForTheme(theme),
        selected: theme.id === selectedTabTheme,
        header: getThemeHeaderDetails(theme.id),
      })),
    });
  }
  syncCreateButtonState();
}

function openThemePreviewModal(theme: ThemeMeta): void {
  const previewUrl = previewUrlForTheme(theme);
  if (!previewUrl) {
    showModal(
      "Theme Preview Unavailable",
      "The bundled theme previews are not ready yet.",
      [{ label: "OK", kind: "primary", onClick: closeModal }],
    );
    return;
  }

  const wrap = document.createElement("div");
  renderThemePreviewModalBody(wrap, {
    description: theme.description,
    previewUrl,
    themeName: theme.name,
  });

  showModalNode(
    `${theme.name} Preview`,
    wrap,
    [
      { label: "Close", kind: "ghost", onClick: closeModal },
      {
        label: "Choose Folder & Create Site",
        kind: "primary",
        onClick: () => {
          selectThemeCard(theme.id);
          closeModal();
          void createSiteFromTabFlow();
        },
      },
    ],
    { size: "wide" },
  );
}

function getThemeHeaderDetails(themeId: string): {
  gradient: string;
  icon: string;
} {
  const id = themeId.toLowerCase();
  if (id.includes("doc")) {
    return {
      gradient: "linear-gradient(135deg, #312e81, #1e3a8a)",
      icon: "book-open",
    };
  } else if (id.includes("blog")) {
    return {
      gradient: "linear-gradient(135deg, #7c2d12, #451a03)",
      icon: "edit-3",
    };
  } else if (id.includes("port")) {
    return {
      gradient: "linear-gradient(135deg, #164e63, #155e75)",
      icon: "image",
    };
  } else if (id.includes("min") || id.includes("blank")) {
    return {
      gradient: "linear-gradient(135deg, #374151, #111827)",
      icon: "terminal",
    };
  } else {
    return {
      gradient: "linear-gradient(135deg, #064e3b, #022c22)",
      icon: "rocket",
    };
  }
}

async function renderThemesInTab(): Promise<void> {
  updateThemesTab({ mode: "loading", themes: [] });

  try {
    if (!startThemes) {
      startThemes = await window.zephus.listThemes();
    }
    if (!themePreviewBaseUrl) {
      const previewServer = await window.zephus.ensureThemePreviewServer();
      if (!previewServer.ok || !previewServer.baseUrl) {
        throw new Error(
          previewServer.error ?? "Could not start theme preview server.",
        );
      }
      themePreviewBaseUrl = previewServer.baseUrl;
    }

    updateThemesTab({
      mode: "ready",
      themes: startThemes.map((theme) => ({
        id: theme.id,
        name: theme.name,
        description: theme.description,
        previewUrl: previewUrlForTheme(theme),
        selected: theme.id === selectedTabTheme,
        header: getThemeHeaderDetails(theme.id),
      })),
    });
    syncCreateButtonState();
  } catch (err) {
    updateThemesTab({
      mode: "error",
      error: String(err),
      themes: [],
    });
  }
}

async function renderSettingsInTab(): Promise<void> {
  let settings: GlobalSettings;
  try {
    settings = await window.zephus.readGlobalSettings();
  } catch {
    setStatus("Could not load settings.");
    return;
  }
  initializeSettingsTab(settings);
  updateSettingsTabUpdater(updaterStatusMessage(), currentUpdaterActions());
  updateSettingsTabNode("Checking Node.js…", !settings.customNodePath);

  const applyNodeStatus = (
    res: NodeCheckResult,
    currentSettings: GlobalSettings,
  ): void => {
    const label =
      res.status === "ok"
        ? `Node.js ${res.version} detected ✓`
        : res.status === "outdated"
          ? `Node.js ${res.version ?? "?"} — version 22.12+ required`
          : res.status === "missing"
            ? "Node.js not found — set a custom location below"
            : "Node.js status could not be determined";
    const source = currentSettings.customNodePath
      ? `Custom: ${currentSettings.customNodePath}`
      : "Auto-detect (system PATH)";
    updateSettingsTabNode(
      `${label} · ${source}`,
      !currentSettings.customNodePath,
    );
  };

  window.zephus
    .getNodeStatus()
    .then((res) => applyNodeStatus(res, settings))
    .catch(() => {
      updateSettingsTabNode(
        "Could not check Node.js.",
        !settings.customNodePath,
      );
    });
}

async function renderAboutAndLicensesInTab(): Promise<void> {
  const versionText = $("about-app-version");
  if (versionText) {
    try {
      const v = await window.zephus.getAppVersion();
      versionText.textContent = `v${v}`;
    } catch {
      versionText.textContent = "v0.1.0-db.1";
    }
  }

  const configBtn = $maybe("btn-about-config");
  if (configBtn) {
    configBtn.onclick = () => void window.zephus.openConfigFolder();
  }

  const loadLicensesBtn = $("btn-load-licenses") as HTMLButtonElement;
  const openRawLicensesBtn = $("btn-open-raw-licenses");
  const licensesListContainer = $("about-licenses-list");

  if (openRawLicensesBtn) {
    openRawLicensesBtn.onclick = async () => {
      const opened = await window.zephus.openProductionLicensesFile();
      if (!opened.ok) {
        setStatus(opened.error ?? "Could not open licenses.json.");
      }
    };
  }

  if (loadLicensesBtn && licensesListContainer) {
    loadLicensesBtn.onclick = async () => {
      loadLicensesBtn.disabled = true;
      loadLicensesBtn.textContent = "Loading Licenses…";
      licensesListContainer.classList.remove("hidden");
      updateAboutLicenses({
        visible: true,
        loading: true,
        error: null,
        entries: [],
      });

      const result = await window.zephus.readProductionLicenses();
      loadLicensesBtn.disabled = false;
      loadLicensesBtn.textContent = "Reload Dependency Licenses";

      if (!result.ok) {
        updateAboutLicenses({
          visible: true,
          loading: false,
          error: result.error ?? "Could not load production license data.",
          entries: [],
        });
        return;
      }

      updateAboutLicenses({
        visible: true,
        loading: false,
        error: null,
        entries: result.entries.map((entry) => ({
          packageId: entry.packageId,
          licenses: entry.licenses,
          repository: entry.repository,
          licenseUrl: entry.licenseUrl,
          parentsLabel:
            entry.parents.slice(0, 4).join(" > ") || "Direct dependency",
        })),
      });
    };
  }
}

async function createSiteFromTabFlow(): Promise<void> {
  if (!selectedTabTheme) return;
  const theme = selectedTabTheme;
  const folder = await window.zephus.chooseNewSiteFolder();
  if (!folder) return;
  const node = await window.zephus.getNodeStatus();
  if (node.status !== "ok") {
    showModal("Node.js Required", nodeStatusMessage(node), [
      { label: "Open Settings", kind: "primary", onClick: openSettingsModal },
      { label: "Cancel", kind: "ghost", onClick: closeModal },
    ]);
    return;
  }
  setStatus("Creating site from theme…");
  const r = await window.zephus.createSite(folder, theme);
  if (!r.ok) {
    showModal("Could Not Create Site", friendlyError(r.error), [
      { label: "OK", kind: "primary", onClick: closeModal },
    ]);
    return;
  }
  await openProjectByPath(folder);
  // First-run convenience: install deps now so preview/publish just work.
  await runInstallFlow(folder);
}

function installEditorSmokeHook(): void {
  window.__zephusRunEditorSmoke = () => {
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

    return failures;
  };
}

/* ---------- Wire up ---------- */

function init(): void {
  if (window.location.search.includes("smoke=1")) installEditorSmokeHook();
  window.refreshIcons = refreshIcons;
  initStartTabs();

  // Prevent stray file drops from navigating the window away from the app.
  // Specific dropzones call preventDefault + stopPropagation to handle drops.
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => event.preventDefault());

  // Warn before closing/reloading with unsaved work. Drafts also auto-save,
  // but this is an explicit last-chance rail.
  window.addEventListener("beforeunload", (event) => {
    if (state.project && isGlobalDirty(state)) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

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
  const btnHomeSettings = $maybe("btn-home-settings");
  if (btnHomeSettings) btnHomeSettings.onclick = () => void openSettingsModal();
  const btnHomeLicenses = $maybe("btn-home-licenses");
  if (btnHomeLicenses)
    btnHomeLicenses.onclick = () => void openProductionLicensesModal();
  const btnHomeCreate = $maybe("btn-home-create");
  if (btnHomeCreate)
    btnHomeCreate.onclick = () => void activateHomeSection("create");

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
  $("vp-desktop").onclick = () => setViewport("desktop");
  $("vp-tablet").onclick = () => setViewport("tablet");
  $("vp-mobile").onclick = () => setViewport("mobile");
  document.addEventListener("keydown", onKeydown);
  renderLayers();
  renderThemePlaceholder();
  refreshGuidancePanels();

  // Mount the SolidJS Next Actions app in the sidebar panel
  const nextActionsContainer = $("next-actions");
  if (nextActionsContainer) {
    try {
      mountNextActions(nextActionsContainer);
    } catch (e) {
      noteMountFailure("Next Actions", e);
    }
  }

  // Mount the SolidJS Git Branch and Git Panel in the sidebar panel
  const gitBranchContainer = $("git-branch");
  if (gitBranchContainer) {
    try {
      mountGitBranch(gitBranchContainer);
    } catch (e) {
      noteMountFailure("Git Branch", e);
    }
  }
  const gitPanelContainer = $("git-panel");
  if (gitPanelContainer) {
    try {
      mountGitPanel(gitPanelContainer);
      registerGitPanelHandlers({
        onRefresh: () => void editorGit.refreshGit({ fetchRemote: true }),
        onCommit: (message, paths) =>
          editorGit.commitGitChanges(message, paths),
        onPush: () => editorGit.pushGitChanges(),
        onPull: () => editorGit.pullGitChanges(),
        onInitRepo: () => editorGit.initGitFromPanel(),
      });
    } catch (e) {
      noteMountFailure("Git Panel", e);
    }
  }

  // Mount the SolidJS Block Palette in the left panel
  const blockPaletteContainer = $("block-palette");
  if (blockPaletteContainer) {
    try {
      mountBlockPalette(blockPaletteContainer);
      registerInsertBlockCallback((type) => {
        const sectionId = activeSectionId();
        const section = findSection(sectionId) ?? state.sections[0];
        addBlockAt(type, section ? section.children.length : 0, sectionId);
      });
    } catch (e) {
      noteMountFailure("Block Palette", e);
    }
  }

  const pageListContainer = $("page-list");
  if (pageListContainer) {
    try {
      mountPageList(pageListContainer);
      registerPageListHandlers({
        onOpen: (page) => void loadPage(page),
        onManage: (page) => void openPageMetaModal(page),
      });
    } catch (e) {
      noteMountFailure("Page List", e);
    }
  }

  const navListContainer = $("nav-list");
  if (navListContainer) {
    try {
      mountNavList(navListContainer);
      registerNavListHandlers({
        onPageSettings: () => {
          if (state.page) void openPageMetaModal(state.page);
        },
        onReviewNavigation: () => void regenerateNav(),
      });
    } catch (e) {
      noteMountFailure("Nav List", e);
    }
  }

  const recentListContainer = $("recent-list");
  if (recentListContainer) {
    try {
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
    } catch (e) {
      noteMountFailure("Recent Projects", e);
    }
  }

  const themeListContainer = $("theme-list-container");
  if (themeListContainer) {
    try {
      mountThemesTab(themeListContainer);
      registerThemesTabHandlers({
        onLoadPreviews: () => void activateHomeSection("create"),
        onSelect: (themeId) => selectThemeCard(themeId),
        onPreview: (themeId) => {
          const theme = startThemes?.find((entry) => entry.id === themeId);
          if (theme) openThemePreviewModal(theme);
        },
        onCreateFromTheme: (themeId) => {
          selectThemeCard(themeId);
          void createSiteFromTabFlow();
        },
      });
    } catch (e) {
      noteMountFailure("Themes Tab", e);
    }
  }

  const settingsTabContainer = $("settings-tab-container");
  if (settingsTabContainer) {
    try {
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
          await window.zephus.writeGlobalSettings(defaults);
          document.documentElement.setAttribute("data-theme", "system");
          applyCodeFontSize(13);
          setStatus("Settings reset to defaults.");
          await renderSettingsInTab();
        },
        onSave: async (settings) => {
          await window.zephus.writeGlobalSettings(settings);
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
    } catch (e) {
      noteMountFailure("Settings Tab", e);
    }
  }

  const homeDraftRecoveryContainer = $maybe("home-recovery-list");
  if (homeDraftRecoveryContainer) {
    try {
      mountHomeDraftRecovery(homeDraftRecoveryContainer);
      registerHomeDraftRecoveryHandlers({
        onResumeDraft: (projectPath) => {
          const draft = homeDraftSummaries.find(
            (entry) => entry.projectPath === projectPath,
          );
          if (!draft) return;
          pendingHomeDraftResume = draft;
          void openProjectByPath(draft.projectPath);
        },
      });
    } catch (e) {
      noteMountFailure("Home Draft Recovery", e);
    }
  }

  const aboutLicensesContainer = $("about-licenses-list");
  if (aboutLicensesContainer) {
    try {
      mountAboutLicenses(aboutLicensesContainer);
    } catch (e) {
      noteMountFailure("About Licenses", e);
    }
  }

  const sidebarUpdateStatusContainer = $("sidebar-update-status");
  if (sidebarUpdateStatusContainer) {
    try {
      mountSidebarUpdateStatus(sidebarUpdateStatusContainer);
      registerSidebarUpdateStatusHandlers({
        onClick: () => {
          if (updaterSnapshot?.status === "downloaded") {
            promptDownloadedUpdate(true);
            return;
          }
          if (
            updaterSnapshot?.status === "available" ||
            updaterSnapshot?.status === "error"
          ) {
            void switchStartTab("settings");
          }
        },
      });
    } catch (e) {
      noteMountFailure("Sidebar Update Status", e);
    }
  }

  const editorStateBannerContainer = $("editor-state-banner");
  if (editorStateBannerContainer) {
    try {
      mountEditorStateBanner(editorStateBannerContainer);
    } catch (e) {
      noteMountFailure("Editor State Banner", e);
    }
  }

  const layersContainer = $("layers-list");
  if (layersContainer) {
    try {
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
    } catch (e) {
      noteMountFailure("Layers", e);
    }
  }

  const canvasContainer = $("canvas");
  if (canvasContainer) {
    try {
      mountCanvas(canvasContainer);
      registerCanvasHandlers({
        onInsertBlock: (index, sectionId) =>
          openBlockInsertModal(index, sectionId),
        onOpenSectionInsert: (index) => openSectionInsertModal(index),
        onQuickInsertSection: (index, template) => {
          if (template === "hero") {
            addSectionAt(index, TEMPLATES[0]);
            return;
          }
          if (template === "features") {
            addSectionAt(index, TEMPLATES[1]);
            return;
          }
          addSectionAt(index);
        },
        onSectionAction: (section, action) => {
          if (action === "add-block") {
            openBlockInsertModal(section.children.length, section.id);
            return;
          }
          if (action === "up") {
            moveSection(section.id, -1);
            return;
          }
          if (action === "down") {
            moveSection(section.id, 1);
            return;
          }
          if (action === "duplicate") {
            duplicateSection(section.id);
            return;
          }
          if (action === "toggle-lock") {
            toggleSectionLock(section.id);
            return;
          }
          void deleteSection(section.id);
        },
        onBlockAction: (block, action) => {
          if (action === "up") {
            moveBlock(block, -1);
            return;
          }
          if (action === "down") {
            moveBlock(block, 1);
            return;
          }
          if (action === "duplicate") {
            duplicateSelectedBlock(block);
            return;
          }
          if (action === "wrap") {
            wrapBlockInSection(block);
            return;
          }
          if (action === "toggle-lock") {
            toggleBlockLock(block);
            return;
          }
          void deleteBlock(block);
        },
        onSelectSection: (section) => {
          state.selectedId = null;
          state.selectedSectionId = section.id;
          renderLayers();
          renderCanvas();
          renderProperties();
        },
        onBlockKeyDown: (event, section, block, preview) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (
              block.id === state.selectedId &&
              TEXT_EDITABLE.includes(block.type) &&
              !block.locked
            ) {
              startFirstInlineEdit(preview, block);
              return;
            }
            state.selectedId = block.id;
            state.selectedSectionId = section.id;
            renderLayers();
            renderCanvas();
            renderProperties();
          }
        },
        onBlockClick: (event, section, block, preview) => {
          event.stopPropagation();
          if (isInlineEditing) return;
          const now = Date.now();
          const isSecondClick =
            lastClickBlockId === block.id &&
            now - lastClickTime < DOUBLE_CLICK_MS;
          lastClickBlockId = block.id;
          lastClickTime = now;
          if (
            isSecondClick &&
            TEXT_EDITABLE.includes(block.type) &&
            !block.locked
          ) {
            startFirstInlineEdit(preview, block);
            return;
          }
          if (state.selectedId === block.id) return;
          state.selectedId = block.id;
          state.selectedSectionId = section.id;
          renderLayers();
          renderCanvas();
          renderProperties();
        },
        onSectionDragStart: (event, section) => {
          if (section.locked) {
            event.preventDefault();
            return;
          }
          draggingSectionId = section.id;
          event.dataTransfer?.setData("text/zephus-move-section", section.id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        },
        onSectionDragEnd: () => {
          draggingSectionId = null;
          sectionDropIndex = -1;
          indicator?.remove();
        },
        onSectionDragOver: (event, sectionIndex, shell) => {
          if (!draggingSectionId) return;
          event.preventDefault();
          const rect = shell.getBoundingClientRect();
          const after = event.clientY > rect.top + rect.height / 2;
          sectionDropIndex = after ? sectionIndex + 1 : sectionIndex;
          showIndicator($("canvas"), shell, after);
        },
        onSectionDrop: (event) => handleDrop(event),
        onSectionBodyDragOver: (event, sectionId, childCount) => {
          event.preventDefault();
          dropSectionId = sectionId;
          if (childCount === 0) dropIndex = 0;
        },
        onBlockDragStart: (event, block) => {
          if (block.locked) {
            event.preventDefault();
            return;
          }
          event.dataTransfer?.setData("text/zephus-move-block", block.id);
        },
        onBlockDragOver: (event, sectionId, blockIndex, shell, sectionBody) => {
          if (draggingSectionId) return;
          event.preventDefault();
          dropSectionId = sectionId;
          const rect = shell.getBoundingClientRect();
          const after = event.clientY > rect.top + rect.height / 2;
          dropIndex = after ? blockIndex + 1 : blockIndex;
          showIndicator(sectionBody, shell, after);
        },
        onBlockDrop: (event) => handleDrop(event),
        onPreviewRendered: (preview, block) => {
          makeCanvasLinksInert(preview);
          hydrateCanvasAssets(preview);
          if (TEXT_EDITABLE.includes(block.type) && !block.locked) {
            attachInlineEditors(preview, block);
          }
        },
        onSyncSectionShell: (shell, section) => {
          syncResizeHandles(
            shell,
            { kind: "section", node: section },
            () => shell,
            section.id === state.selectedSectionId &&
              !state.selectedId &&
              !section.locked,
          );
        },
        onSyncBlockShell: (shell, block, preview) => {
          syncResizeHandles(
            shell,
            { kind: "block", node: block },
            () => (preview.firstElementChild as HTMLElement | null) ?? preview,
            block.id === state.selectedId && !block.locked,
          );
        },
      });
    } catch (e) {
      noteMountFailure("Canvas", e);
    }
  }

  const templatePaletteContainer = $("template-palette");
  if (templatePaletteContainer) {
    try {
      mountTemplatePalette(templatePaletteContainer);
      registerInsertTemplateCallback((tpl) => {
        addSectionAt(state.sections.length, tpl);
      });
    } catch (e) {
      noteMountFailure("Template Palette", e);
    }
  }

  const projectOverviewContainer = $("project-overview");
  if (projectOverviewContainer) {
    try {
      mountProjectOverview(projectOverviewContainer);
    } catch (e) {
      noteMountFailure("Project Overview", e);
    }
  }

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
    updaterSnapshot = data;
    renderHomeStatusPanels();
    refreshUpdaterControls();
    if (data.status === "downloaded") {
      setStatus(
        `Update ${updateVersionLabel(data.version)} downloaded. Restart Zephus to apply it.`,
      );
      promptDownloadedUpdate();
    }
  });
  refreshIcons();

  // Reopen last project if the user opted in and it still resolves.
  if (appSettings?.restoreLastProject && appSettings.lastOpenedProject) {
    await openProjectByPath(appSettings.lastOpenedProject);
    return;
  }
  await showOnboardingIfNew();
}

async function showOnboardingIfNew(): Promise<void> {
  const settings = await window.zephus.readGlobalSettings();
  if (settings.recentProjects.length > 0) return;
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
      { label: "I'll look around first", kind: "ghost", onClick: closeModal },
    ],
  );
}

document.addEventListener("DOMContentLoaded", init);

function noteMountFailure(label: string, error: unknown): void {
  console.error(`Failed to mount SolidJS ${label}:`, error);
  if (!panelMountFailures.includes(label)) panelMountFailures.push(label);
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
