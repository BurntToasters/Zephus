// Zephus renderer logic. Talks to the main process exclusively through
// window.zephus (the preload bridge). No Node APIs are used here.

// TODO: Split UI rendering from state management.

import { createCodeEditor, CodeEditor } from "./codeEditor";
import {
  clearPageChanges,
  clearSiteChanges,
  cloneSiteDocument,
  createEditorSession,
  effectiveSiteDocument,
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
} from "lucide";

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

function setStatus(message: string): void {
  $("status-bar").textContent = message;
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

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function cloneBlock(block: Block): Block {
  return {
    ...block,
    props: { ...block.props },
    style: block.style ? JSON.parse(JSON.stringify(block.style)) : undefined,
  };
}

function cloneSections(sections: SectionNode[]): SectionNode[] {
  return JSON.parse(JSON.stringify(sections)) as SectionNode[];
}

function trackChange(label: string): void {
  trackPageChange(state, label);
}

function clearChanges(): void {
  clearPageChanges(state);
}

function blocksFromSections(sections: SectionNode[]): Block[] {
  return sections.flatMap((section) =>
    section.children.map((child) => ({
      id: child.id,
      type: child.type,
      props: { ...child.props },
      style: child.style ? JSON.parse(JSON.stringify(child.style)) : undefined,
      locked: child.locked,
      raw: child.raw,
    })),
  );
}

function syncBlocksFromSections(): void {
  state.blocks = blocksFromSections(state.sections);
}

function sectionsFromPageDocument(doc: PageDocument): SectionNode[] {
  return cloneSections(doc.sections);
}

function pageDocumentFromState(): PageDocument | null {
  if (!state.pageDocument || !state.page) return null;
  return {
    ...state.pageDocument,
    page: state.page,
    sections: cloneSections(state.sections),
  };
}

function syncVisualModeState(): void {
  const visualBtn = $("mode-visual") as HTMLButtonElement;
  visualBtn.disabled = !state.visualEditable;
  visualBtn.classList.toggle("disabled", !state.visualEditable);
  visualBtn.title =
    state.managedStatus === "out-of-sync"
      ? "This page was edited outside Zephus. Reattach it to resume visual editing."
      : state.visualEditable
        ? "Visual"
        : "Detached pages are code-only until reattached.";
}

// CodeMirror code editor, mounted once on first editor entry.
let cm: CodeEditor | null = null;
let settingCode = false;

function ensureCodeEditor(): void {
  if (cm) return;
  cm = createCodeEditor($("code-editor"), () => {
    if (state.mode === "code" && !settingCode) markDirty(true);
  });
}

function setCode(value: string): void {
  settingCode = true;
  cm?.setValue(value);
  settingCode = false;
}

function getCode(): string {
  return cm ? cm.getValue() : state.rawCode;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  const container = $("theme-list-container");
  if (startThemes) return;
  container.innerHTML = "";
  const card = document.createElement("article");
  card.className = "theme-card";
  card.innerHTML = `
    <div class="theme-card-preview">
      <div class="theme-card-preview-empty">Theme previews load on demand</div>
    </div>
    <div class="theme-card-body">
      <span class="t-name">Bundled starter themes</span>
      <span class="t-desc">Open Get Started to lazy-load live previews for each bundled Zephus theme.</span>
    </div>
  `;
  const actions = document.createElement("div");
  actions.className = "theme-card-actions";
  const btn = document.createElement("button");
  btn.className = "btn primary";
  btn.textContent = "Load Theme Previews";
  btn.onclick = () => void activateHomeSection("create");
  actions.appendChild(btn);
  card.appendChild(actions);
  container.appendChild(card);
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

function buildHomeStatusCard(
  title: string,
  body: string,
  actions: Array<{ label: string; onClick: () => void }> = [],
): HTMLElement {
  const card = document.createElement("section");
  card.className = "home-status-card";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.textContent = body;
  card.append(heading, copy);
  if (actions.length > 0) {
    const row = document.createElement("div");
    row.className = "home-status-actions";
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.className = "mini-btn";
      btn.textContent = action.label;
      btn.onclick = action.onClick;
      row.appendChild(btn);
    }
    card.appendChild(row);
  }
  return card;
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
    recoveryHost.innerHTML = "";
    const drafts = homeDraftSummaries.slice(0, 4);
    if (drafts.length === 0) {
      recoveryHost.classList.add("hidden");
    } else {
      recoveryHost.classList.remove("hidden");

      const alertHeader = document.createElement("div");
      alertHeader.className = "pane-header-title";
      alertHeader.style.marginBottom = "12px";
      alertHeader.innerHTML = `
        <p class="pane-kicker" style="color: var(--warning);">Unsaved Work Recovery</p>
        <strong style="font-size: 14px;">Zephus detected unsaved page or site drafts.</strong>
      `;
      recoveryHost.appendChild(alertHeader);

      const alertList = document.createElement("div");
      alertList.className = "home-status-stack";

      for (const draft of drafts) {
        alertList.appendChild(
          buildHomeStatusCard(
            `${projectBaseName(draft.projectPath)} - ${formatRelativeTime(draft.savedAt)}`,
            homeDraftLabel(draft),
            [
              {
                label: "Resume Draft",
                onClick: () => {
                  pendingHomeDraftResume = draft;
                  void openProjectByPath(draft.projectPath);
                },
              },
            ],
          ),
        );
      }
      recoveryHost.appendChild(alertList);
    }
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
    | { ok?: boolean; error?: string }
    | undefined;
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

function refreshUpdaterControls(): void {
  document
    .querySelectorAll<HTMLElement>("[data-updater-status-text]")
    .forEach((el) => {
      el.textContent = updaterStatusMessage();
    });
  document
    .querySelectorAll<HTMLElement>("[data-updater-actions]")
    .forEach((el) => renderUpdaterActions(el));
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
  const sidebarUpdate = $("sidebar-update-status");
  if (!sidebarUpdate) return;
  sidebarUpdate.innerHTML = "";

  if (!updaterSnapshot) {
    sidebarUpdate.classList.remove("clickable");
    sidebarUpdate.onclick = null;
    sidebarUpdate.innerHTML = `
      <div class="update-status-dot"></div>
      <span>Up to date</span>
    `;
    return;
  }

  if (updaterSnapshot.status === "available") {
    sidebarUpdate.classList.add("clickable");
    sidebarUpdate.onclick = () => void switchStartTab("settings");
    sidebarUpdate.innerHTML = `
      <div class="update-status-dot active"></div>
      <span style="color: #ffffff; font-weight: bold;">Update Available</span>
    `;
  } else if (updaterSnapshot.status === "downloading") {
    sidebarUpdate.classList.remove("clickable");
    sidebarUpdate.onclick = null;
    sidebarUpdate.innerHTML = `
      <div class="update-status-dot active"></div>
      <span>Downloading (${Math.round(updaterSnapshot.percent ?? 0)}%)</span>
    `;
  } else if (updaterSnapshot.status === "downloaded") {
    sidebarUpdate.classList.add("clickable");
    sidebarUpdate.onclick = () => promptDownloadedUpdate(true);
    sidebarUpdate.innerHTML = `
      <div class="update-status-dot active"></div>
      <span>Restart to install</span>
    `;
  } else if (updaterSnapshot.status === "checking") {
    sidebarUpdate.classList.remove("clickable");
    sidebarUpdate.onclick = null;
    sidebarUpdate.innerHTML = `
      <div class="update-status-dot"></div>
      <span>Checking updates…</span>
    `;
  } else if (updaterSnapshot.status === "error") {
    sidebarUpdate.classList.add("clickable");
    sidebarUpdate.onclick = () => void switchStartTab("settings");
    sidebarUpdate.innerHTML = `
      <div class="update-status-dot error"></div>
      <span>Update Error</span>
    `;
  } else {
    sidebarUpdate.classList.remove("clickable");
    sidebarUpdate.onclick = null;
    const versionStr = updaterSnapshot.version
      ? `v${updaterSnapshot.version}`
      : "";
    sidebarUpdate.innerHTML = `
      <div class="update-status-dot"></div>
      <span>Up to date${versionStr ? " · " + versionStr : ""}</span>
    `;
  }
}

function renderProjectOverview(): void {
  const host = $("project-overview");
  host.innerHTML = "";
  if (!state.project) {
    host.innerHTML =
      '<p class="muted">Open a Zephus site to see page and project status.</p>';
    return;
  }

  const grid = document.createElement("div");
  grid.className = "overview-grid";

  const pageCard = document.createElement("section");
  pageCard.className = "overview-card";
  pageCard.innerHTML = `
    <div class="overview-title">
      <strong>${escapeHtml(state.currentMeta?.navLabel ?? state.currentMeta?.title ?? state.page ?? "No page selected")}</strong>
      <span class="overview-pill info">${escapeHtml(state.currentMeta?.route ?? "No route")}</span>
    </div>
  `;
  const pageMeta = document.createElement("div");
  pageMeta.className = "overview-meta";
  const navState = state.currentMeta
    ? state.currentMeta.navVisible
      ? "Visible in nav"
      : "Hidden from nav"
    : "No page metadata";
  const wrapperState = state.sections.length
    ? `${state.sections.length} section${state.sections.length === 1 ? "" : "s"}`
    : "Empty page";
  const pageRows: Array<[string, string]> = [
    ["Route", state.currentMeta?.route ?? "Not selected"],
    ["Navigation", navState],
    ["Canvas", wrapperState],
  ];
  for (const [label, value] of pageRows) {
    const row = document.createElement("div");
    row.className = "overview-row";
    row.innerHTML = `<span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span>`;
    pageMeta.appendChild(row);
  }
  pageCard.appendChild(pageMeta);
  grid.appendChild(pageCard);

  const stateCard = document.createElement("section");
  stateCard.className = "overview-card";
  const pillRow = document.createElement("div");
  pillRow.className = "overview-pills";
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
  for (const [label, tone] of pills) {
    const pill = document.createElement("span");
    pill.className = `overview-pill ${tone}`;
    pill.textContent = label;
    pillRow.appendChild(pill);
  }
  const hint = document.createElement("p");
  hint.className = "overview-hint";
  hint.textContent =
    state.sections.length === 0
      ? "This page is blank. Start with a hero, a blank section, or a reusable section."
      : visibleNavCount() === 0
        ? "No visible navigation items are live yet. Review page metadata or staged navigation."
        : state.pageDirty || state.siteDirty
          ? "Save your changes to keep preview and publish flows predictable."
          : state.previewUrl
            ? "Preview is running. Review the live page, then publish when ready."
            : "This project is ready for preview and publish checks.";
  stateCard.append(pillRow, hint);
  grid.appendChild(stateCard);

  const actionsCard = document.createElement("section");
  actionsCard.className = "overview-card";
  const actionsTitle = document.createElement("div");
  actionsTitle.className = "overview-title";
  actionsTitle.innerHTML = "<strong>Quick controls</strong>";
  const actions = document.createElement("div");
  actions.className = "overview-actions";
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
  for (const action of quickActions) {
    const btn = document.createElement("button");
    btn.className = "mini-btn";
    btn.textContent = action.label;
    btn.onclick = action.onClick;
    if (action.label === "Page Settings" && !state.page) {
      btn.disabled = true;
    }
    actions.appendChild(btn);
  }
  actionsCard.append(actionsTitle, actions);
  grid.appendChild(actionsCard);

  host.appendChild(grid);
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
  const host = $("next-actions");
  host.innerHTML = "";
  if (!state.project) {
    host.innerHTML =
      '<p class="muted">Guided actions will appear here while you edit.</p>';
    return;
  }

  const list = document.createElement("div");
  list.className = "next-actions-list";
  const addActionCard = (
    title: string,
    body: string,
    actions: Array<{ label: string; onClick: () => void }>,
  ) => {
    const card = document.createElement("section");
    card.className = "next-action-card";
    const heading = document.createElement("div");
    heading.className = "next-action-title";
    heading.innerHTML = `<strong>${escapeHtml(title)}</strong>`;
    const copy = document.createElement("p");
    copy.textContent = body;
    const row = document.createElement("div");
    row.className = "next-action-actions";
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.className = "mini-btn";
      btn.textContent = action.label;
      btn.onclick = action.onClick;
      row.appendChild(btn);
    }
    card.append(heading, copy, row);
    list.appendChild(card);
  };

  if (state.pageMeta.length === 0) {
    addActionCard(
      "Create your first page",
      "New projects feel much less empty once you have a visible route to edit and preview.",
      [{ label: "Create Page", onClick: () => void newPageFlow() }],
    );
  }

  if (state.page && state.sections.length === 0) {
    addActionCard(
      "Start the page structure",
      "Add a section now so the canvas has a real layout to work with.",
      [
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
    );
  }

  if (state.page && visibleNavCount() === 0) {
    addActionCard(
      "No visible navigation items",
      "Visitors will not see page links yet. Review the current page metadata or stage a nav set from the shell.",
      [
        {
          label: "Page Settings",
          onClick: () => {
            if (state.page) void openPageMetaModal(state.page);
          },
        },
        { label: "Review Navigation", onClick: () => void regenerateNav() },
      ],
    );
  }

  const imageBlock = state.blocks.find((block) => block.type === "image");
  if (state.page && !imageBlock) {
    addActionCard(
      "Add visual assets",
      "This page has no image blocks yet. Drop in an image and reuse bundled asset import flows.",
      [
        {
          label: "Import Image",
          onClick: () => void addImageBlockWithAssetFlow(),
        },
      ],
    );
  } else if (imageBlock && !(imageBlock.props["src"] ?? "").trim()) {
    addActionCard(
      "Finish the image block",
      "An image block exists but it is still missing a selected asset.",
      [
        {
          label: "Choose Asset",
          onClick: () => void chooseAssetForImage(imageBlock),
        },
      ],
    );
  }

  if (state.siteDirty || state.pageDirty) {
    const actions = [{ label: "Save All", onClick: () => void save() }];
    if (state.siteDirty) {
      actions.push({
        label: "Discard Site",
        onClick: () => void discardPendingSiteChanges(),
      });
    }
    addActionCard(
      "Unsaved work pending",
      "Keep page and site state in sync before you switch context or run a full preview.",
      actions,
    );
  }

  if (list.childElementCount === 0) {
    addActionCard(
      "Builder is in a good state",
      "Use preview to verify your page, then publish when the content and navigation look right.",
      [
        {
          label: state.previewUrl ? "Stop Preview" : "Start Preview",
          onClick: () => void togglePreview(),
        },
        { label: "Publish", onClick: () => void publishSite() },
      ],
    );
  }

  host.appendChild(list);
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

function siteDraftTarget(): string {
  return "site-shell";
}

function siteDraftContentForCurrentState(): string {
  return JSON.stringify(
    effectiveSiteDocument(state) ?? state.siteDocument,
    null,
    2,
  );
}

function scheduleDraftWrite(): void {
  if (!state.project) return;
  if (state.draftTimer !== null) {
    window.clearTimeout(state.draftTimer);
  }
  state.draftTimer = window.setTimeout(() => {
    if (!state.project || !isGlobalDirty(state)) return;
    if (state.pageDirty && state.page) {
      void window.zephus.writeDraft(
        state.project.path,
        "page",
        state.page,
        draftContentForCurrentState(),
      );
    }
    if (state.siteDirty && effectiveSiteDocument(state)) {
      void window.zephus.writeDraft(
        state.project.path,
        "site",
        siteDraftTarget(),
        siteDraftContentForCurrentState(),
      );
    }
  }, 800);
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
  const list = $("recent-list");
  if (!list) return;
  list.innerHTML = "";
  if (settings.recentProjects.length === 0) {
    const welcome = document.createElement("div");
    welcome.className = "welcome-card";
    welcome.innerHTML = `
      <div class="welcome-icon-pill">
        <i data-lucide="layout"></i>
      </div>
      <h3 class="welcome-title">Welcome to Zephus</h3>
      <p class="welcome-copy">
        Create a new Astro site from one of the starter templates, or open an existing Zephus project from your computer.
      </p>
      <div class="welcome-buttons">
        <button id="btn-welcome-open" class="btn primary">
          <i data-lucide="folder-open"></i> Open Folder
        </button>
        <button id="btn-welcome-create" class="btn">
          <i data-lucide="compass"></i> Explore Templates
        </button>
      </div>
    `;

    // Wire up buttons
    const openBtn = welcome.querySelector(
      "#btn-welcome-open",
    ) as HTMLButtonElement;
    if (openBtn) openBtn.onclick = () => void chooseFolder();

    const createBtn = welcome.querySelector(
      "#btn-welcome-create",
    ) as HTMLButtonElement;
    if (createBtn) createBtn.onclick = () => void switchStartTab("create");

    list.appendChild(welcome);
    refreshIcons();
    renderHomeStatusPanels();
    syncHomeActionState();
    return;
  }
  settings.recentProjects.forEach((p, index) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.className = "recent-project";
    button.type = "button";
    const head = document.createElement("div");
    head.className = "recent-project-head";
    const name = document.createElement("span");
    name.className = "proj-name";
    name.textContent = projectBaseName(p);
    const badge = document.createElement("span");
    badge.className = "recent-badge";
    badge.textContent =
      settings.lastOpenedProject === p
        ? "Last Opened"
        : index === 0
          ? "Most Recent"
          : "Recent";
    head.append(name, badge);
    const pathSpan = document.createElement("span");
    pathSpan.className = "path";
    pathSpan.textContent = p;
    const meta = document.createElement("div");
    meta.className = "recent-project-meta";
    const managed = document.createElement("span");
    managed.textContent = "Zephus-managed project";
    const resume = document.createElement("span");
    resume.textContent =
      settings.lastOpenedProject === p ? "Resume ready" : "Open directly";
    meta.append(managed, resume);
    button.append(head, pathSpan, meta);
    button.onclick = () => void openProjectByPath(p);
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "recent-remove";
    removeButton.title = "Remove from recent projects";
    removeButton.setAttribute(
      "aria-label",
      `Remove ${projectBaseName(p)} from recent projects`,
    );
    removeButton.innerHTML = `<i data-lucide="x"></i>`;
    removeButton.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await window.zephus.removeRecentProject(p);
      setStatus("Removed recent project: " + projectBaseName(p));
      await renderRecent();
    };
    li.appendChild(button);
    li.appendChild(removeButton);
    list.appendChild(li);
  });
  refreshIcons();
  renderHomeStatusPanels();
  syncHomeActionState();
}

async function chooseFolder(): Promise<void> {
  const folder = await window.zephus.openFolderDialog();
  if (!folder) return;
  await openProjectByPath(folder);
}

/* ---------- App Settings ---------- */

function checkboxRow(
  id: string,
  label: string,
  checked: boolean,
): { row: HTMLElement; input: HTMLInputElement } {
  const row = document.createElement("div");
  row.className = "settings-row";

  const lbl = document.createElement("label");
  lbl.htmlFor = id;
  lbl.textContent = label;

  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = id;
  input.checked = checked;

  row.append(lbl, input);
  return { row, input };
}

function selectField(
  labelText: string,
  options: { value: string; label: string }[],
  current: string,
): { wrap: HTMLElement; select: HTMLSelectElement } {
  const wrap = document.createElement("div");
  wrap.className = "settings-row";

  const label = document.createElement("label");
  label.textContent = labelText;

  const select = document.createElement("select");
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === current) o.selected = true;
    select.appendChild(o);
  }

  wrap.append(label, select);
  return { wrap, select };
}

async function openSettingsModal(): Promise<void> {
  // Build and show the modal immediately; never block opening on async work.
  let settings: GlobalSettings;
  try {
    settings = await window.zephus.readGlobalSettings();
  } catch {
    setStatus("Could not load settings.");
    return;
  }

  const form = document.createElement("div");
  form.className = "settings-form";

  // --- Updates Section ---
  const updatesSec = document.createElement("div");
  updatesSec.className = "settings-section";

  const updHeader = document.createElement("h4");
  updHeader.className = "settings-section-title";
  updHeader.textContent = "Updates";
  updatesSec.appendChild(updHeader);

  const autoUpd = checkboxRow(
    "set-auto-update",
    "Startup check",
    settings.autoCheckUpdates,
  );
  updatesSec.appendChild(autoUpd.row);

  const chan = selectField(
    "Update channel",
    [
      { value: "auto", label: "Auto (match install)" },
      { value: "stable", label: "Stable" },
      { value: "beta", label: "Beta" },
      { value: "developer", label: "Developer (db)" },
    ],
    settings.updateChannel,
  );
  updatesSec.appendChild(chan.wrap);

  const checkRow = document.createElement("div");
  checkRow.className = "settings-row";
  const checkLeft = document.createElement("span");
  checkLeft.dataset.updaterStatusText = "true";
  checkLeft.textContent = updaterStatusMessage();
  const updateActions = document.createElement("div");
  updateActions.className = "settings-inline-actions";
  updateActions.dataset.updaterActions = "true";
  renderUpdaterActions(updateActions);

  checkRow.append(checkLeft, updateActions);
  updatesSec.appendChild(checkRow);
  form.appendChild(updatesSec);

  // --- Environment Section (Node.js) ---
  const envSec = document.createElement("div");
  envSec.className = "settings-section";

  const envHeader = document.createElement("h4");
  envHeader.className = "settings-section-title";
  envHeader.textContent = "Environment";
  envSec.appendChild(envHeader);

  const nodeRow = document.createElement("div");
  nodeRow.className = "settings-row";

  const nodeCopy = document.createElement("div");
  nodeCopy.className = "settings-inline-copy";
  const nodeStatusText = document.createElement("span");
  nodeStatusText.textContent = "Checking Node.js…";
  const nodeStrong = document.createElement("strong");
  nodeStrong.textContent = "Node.js (for build & preview)";
  nodeCopy.append(nodeStrong, nodeStatusText);

  const nodeBtns = document.createElement("div");
  nodeBtns.className = "settings-inline-actions";
  const nodeBrowseBtn = document.createElement("button");
  nodeBrowseBtn.className = "btn secondary mini-btn";
  nodeBrowseBtn.textContent = "Set Custom Location…";
  const nodeAutoBtn = document.createElement("button");
  nodeAutoBtn.className = "btn ghost mini-btn";
  nodeAutoBtn.textContent = "Use Auto-detect";
  nodeBtns.append(nodeBrowseBtn, nodeAutoBtn);

  nodeRow.append(nodeCopy, nodeBtns);
  envSec.appendChild(nodeRow);

  const applyNodeStatus = (res: NodeCheckResult): void => {
    const label =
      res.status === "ok"
        ? `Node.js ${res.version} detected ✓`
        : res.status === "outdated"
          ? `Node.js ${res.version ?? "?"} — version 22.12+ required`
          : res.status === "missing"
            ? "Node.js not found — set a custom location below"
            : "Node.js status could not be determined";
    const source = settings.customNodePath
      ? `Custom: ${settings.customNodePath}`
      : "Auto-detect (system PATH)";
    nodeStatusText.textContent = `${label} · ${source}`;
    nodeAutoBtn.disabled = !settings.customNodePath;
  };

  nodeBrowseBtn.onclick = async () => {
    nodeBrowseBtn.disabled = true;
    try {
      const res = await window.zephus.pickNodePath();
      if (
        (res.status === "ok" || res.status === "outdated") &&
        res.usedCustomPath &&
        res.binaryPath
      ) {
        settings.customNodePath = res.binaryPath;
      }
      applyNodeStatus(res);
    } catch {
      nodeStatusText.textContent = "Could not set Node.js location.";
    }
    nodeBrowseBtn.disabled = false;
  };

  nodeAutoBtn.onclick = async () => {
    nodeAutoBtn.disabled = true;
    try {
      const res = await window.zephus.setNodePath(null);
      settings.customNodePath = null;
      applyNodeStatus(res);
    } catch {
      nodeStatusText.textContent = "Could not reset Node.js location.";
    }
  };

  window.zephus
    .getNodeStatus()
    .then(applyNodeStatus)
    .catch(() => {
      nodeStatusText.textContent = "Could not check Node.js.";
    });

  form.appendChild(envSec);

  // --- Appearance Section ---
  const apSec = document.createElement("div");
  apSec.className = "settings-section";

  const apHeader = document.createElement("h4");
  apHeader.className = "settings-section-title";
  apHeader.textContent = "Appearance";
  apSec.appendChild(apHeader);

  const theme = selectField(
    "Theme",
    [
      { value: "system", label: "System" },
      { value: "dark", label: "Dark" },
      { value: "light", label: "Light" },
    ],
    settings.theme,
  );
  apSec.appendChild(theme.wrap);

  const fontSize = selectField(
    "Editor font size",
    [12, 13, 14, 15, 16, 18].map((n) => ({
      value: String(n),
      label: `${n}px`,
    })),
    String(settings.codeFontSize),
  );
  apSec.appendChild(fontSize.wrap);
  form.appendChild(apSec);

  // --- Editor Section ---
  const edSec = document.createElement("div");
  edSec.className = "settings-section";

  const edHeader = document.createElement("h4");
  edHeader.className = "settings-section-title";
  edHeader.textContent = "Editor";
  edSec.appendChild(edHeader);

  const restore = checkboxRow(
    "set-restore",
    "Reopen last project",
    settings.restoreLastProject,
  );
  edSec.appendChild(restore.row);

  const autosave = checkboxRow(
    "set-autosave",
    "Autosave changes",
    settings.autosave,
  );
  edSec.appendChild(autosave.row);

  const confirmDel = checkboxRow(
    "set-confirm-del",
    "Confirm delete block",
    settings.confirmBlockDelete,
  );
  edSec.appendChild(confirmDel.row);
  form.appendChild(edSec);

  // --- Legal Section ---
  const legalSec = document.createElement("div");
  legalSec.className = "settings-section";

  const legalHeader = document.createElement("h4");
  legalHeader.className = "settings-section-title";
  legalHeader.textContent = "Legal";
  legalSec.appendChild(legalHeader);

  const legalRow = document.createElement("div");
  legalRow.className = "settings-row";

  const legalLabel = document.createElement("div");
  legalLabel.className = "settings-inline-copy";
  legalLabel.innerHTML =
    "<strong>Third-party licenses</strong><span>Show production dependency licenses from bundled licenses.json.</span>";

  const licensesBtn = document.createElement("button");
  licensesBtn.className = "btn ghost mini-btn";
  licensesBtn.textContent = "View Production Licenses";
  licensesBtn.onclick = () => void openProductionLicensesModal();

  legalRow.append(legalLabel, licensesBtn);
  legalSec.appendChild(legalRow);
  form.appendChild(legalSec);

  // --- Footer Row ---
  const footerRow = document.createElement("div");
  footerRow.className = "settings-footer";

  const ver = document.createElement("span");
  ver.className = "version-info-text";
  ver.textContent = "Zephus";
  footerRow.appendChild(ver);

  window.zephus
    .getAppVersion()
    .then((v) => {
      ver.textContent = `Zephus v${v}`;
    })
    .catch(() => {
      ver.textContent = "Zephus";
    });

  const configBtn = document.createElement("button");
  configBtn.className = "btn ghost mini-btn";
  configBtn.innerHTML = `<i data-lucide="folder-open"></i> Open Config`;
  configBtn.onclick = () => void window.zephus.openConfigFolder();
  footerRow.appendChild(configBtn);
  form.appendChild(footerRow);

  showModalNode("Settings", form, [
    {
      label: "Reset to Defaults",
      kind: "danger",
      onClick: async () => {
        if (!confirm("Reset all Zephus settings to defaults?")) return;
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
        closeModal();
        setStatus("Settings reset to defaults.");
      },
    },
    { label: "Cancel", kind: "ghost", onClick: closeModal },
    {
      label: "Save",
      kind: "primary",
      onClick: async () => {
        settings.autoCheckUpdates = autoUpd.input.checked;
        settings.updateChannel = chan.select
          .value as GlobalSettings["updateChannel"];
        settings.theme = theme.select.value as GlobalSettings["theme"];
        settings.codeFontSize = Number(fontSize.select.value);
        settings.restoreLastProject = restore.input.checked;
        settings.autosave = autosave.input.checked;
        settings.confirmBlockDelete = confirmDel.input.checked;

        await window.zephus.writeGlobalSettings(settings);
        document.documentElement.setAttribute("data-theme", settings.theme);
        applyCodeFontSize(settings.codeFontSize);
        appSettings = settings;
        closeModal();
        setStatus("Settings saved.");
      },
    },
  ]);
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
  wrap.className = "licenses-modal";

  const summary = document.createElement("p");
  summary.className = "licenses-summary";
  summary.textContent =
    `Generated from npm-license-crawler --production. ` +
    `${result.entries.length} packages listed.`;
  wrap.appendChild(summary);

  const tableWrap = document.createElement("div");
  tableWrap.className = "licenses-table-wrap";

  const table = document.createElement("table");
  table.className = "licenses-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Package</th>
        <th>License</th>
        <th>Repository</th>
        <th>License URL</th>
      </tr>
    </thead>
    <tbody>
      ${result.entries
        .map(
          (entry) => `
            <tr>
              <td class="licenses-package-cell">
                <div class="licenses-package-name">${escapeHtml(entry.packageId)}</div>
                <div class="licenses-package-parents">${escapeHtml(
                  entry.parents.slice(0, 4).join(" > ") || "Direct dependency",
                )}</div>
              </td>
              <td>${escapeHtml(entry.licenses)}</td>
              <td class="licenses-link-cell">${renderLicenseValue(entry.repository)}</td>
              <td class="licenses-link-cell">${renderLicenseValue(entry.licenseUrl)}</td>
            </tr>`,
        )
        .join("")}
    </tbody>
  `;
  tableWrap.appendChild(table);
  wrap.appendChild(tableWrap);

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
  $("view-editor").classList.remove("hidden");
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
  void refreshGit();
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

async function refreshGit(): Promise<void> {
  if (!state.project) return;
  const git = await window.zephus.getGitStatus(state.project.path);
  const branch = $("git-branch");
  if (!git.available)
    branch.innerHTML = `<i data-lucide="git-branch"></i> <span>git: unavailable</span>`;
  else if (git.detachedHead)
    branch.innerHTML = `<i data-lucide="git-branch"></i> <span>detached HEAD</span>`;
  else
    branch.innerHTML = `<i data-lucide="git-branch"></i> <span>${escapeHtml(git.branch ?? "")}</span>`;

  const panel = $("git-panel");
  panel.innerHTML = "";
  const groups: [string, string[], string][] = [
    ["M", git.modified, "g-m"],
    ["A", git.added, "g-a"],
    ["D", git.deleted, "g-d"],
  ];
  const total = git.modified.length + git.added.length + git.deleted.length;
  if (!git.available) {
    panel.innerHTML = '<p class="muted">Git status unavailable.</p>';
    refreshIcons();
    return;
  }
  if (git.zephusIgnored) {
    const warn = document.createElement("div");
    warn.className = "g-warning";
    warn.innerHTML = `<i data-lucide="alert-triangle"></i> <span><strong>.zephus is git-ignored.</strong> Commit it — it stores this project's Zephus save state and is required to open the site on other machines.</span>`;
    panel.appendChild(warn);
  }
  if (total === 0) {
    const none = document.createElement("p");
    none.className = "muted";
    none.textContent = "No changes.";
    panel.appendChild(none);
    refreshIcons();
    return;
  }
  for (const [badge, files, cls] of groups) {
    for (const file of files) {
      const row = document.createElement("div");
      row.className = "g-file";
      row.innerHTML = `<span class="g-badge ${cls}">${badge}</span><span>${escapeHtml(file)}</span>`;
      panel.appendChild(row);
    }
  }
  refreshIcons();
}

function renderPalette(): void {
  const palette = $("block-palette");
  palette.innerHTML = "";
  const allowed = editorRules.allowedBlocks;
  for (const item of PALETTE) {
    if (allowed && !allowed.includes(item.type)) continue;
    const li = document.createElement("li");
    const iconName = PALETTE_ICONS[item.type] ?? "box";
    li.innerHTML = `<i data-lucide="${iconName}"></i> <span>${item.label}</span>`;
    li.draggable = true;
    li.dataset["type"] = item.type;
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute("aria-label", `Add ${item.label} block`);
    li.title = `Add ${item.label} (or drag onto the canvas)`;
    const insert = () => {
      const sectionId = activeSectionId();
      const section = findSection(sectionId) ?? state.sections[0];
      addBlockAt(item.type, section ? section.children.length : 0, sectionId);
    };
    li.onclick = insert;
    li.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        insert();
      }
    };
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/zephus-new", item.type);
    });
    palette.appendChild(li);
  }
  refreshIcons();
}

async function renderTemplates(): Promise<void> {
  const palette = $("template-palette");
  palette.innerHTML = "";
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
    })),
  ];
  for (const tpl of merged) {
    const li = document.createElement("li");
    li.innerHTML = `<i data-lucide="layout-template"></i> <span>${tpl.label}</span>`;
    li.draggable = true;
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/zephus-template", tpl.id);
    });
    if (saved?.ok && saved.sections.some((section) => section.id === tpl.id)) {
      const del = document.createElement("button");
      del.className = "mini-btn";
      del.textContent = "Delete";
      del.onclick = async (event) => {
        event.stopPropagation();
        await window.zephus.deleteReusableSection(tpl.id);
        await renderTemplates();
      };
      li.appendChild(del);
    }
    palette.appendChild(li);
  }
  refreshIcons();
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
  const list = $("nav-list");
  list.innerHTML = "";
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
  if (entries.length === 0) {
    const li = document.createElement("li");
    li.className = "nav-empty-state";
    li.innerHTML =
      "<strong>No visible nav items</strong><span>Mark a page as visible in Page Settings or stage a navigation set from the Site Shell.</span>";
    const actions = document.createElement("div");
    actions.className = "nav-empty-actions";
    if (state.page) {
      const pageBtn = document.createElement("button");
      pageBtn.className = "mini-btn";
      pageBtn.textContent = "Page Settings";
      pageBtn.onclick = () => void openPageMetaModal(state.page!);
      actions.appendChild(pageBtn);
    }
    const navBtn = document.createElement("button");
    navBtn.className = "mini-btn";
    navBtn.textContent = "Review Navigation";
    navBtn.onclick = () => void regenerateNav();
    actions.appendChild(navBtn);
    li.appendChild(actions);
    list.appendChild(li);
    refreshGuidancePanels();
    return;
  }
  for (const entry of entries) {
    const li = document.createElement("li");
    li.innerHTML = `<i data-lucide="link"></i> <span>${escapeHtml(entry.label)} <span class="nav-route">${escapeHtml(entry.href)}</span></span>`;
    list.appendChild(li);
  }
  refreshIcons();
  refreshGuidancePanels();
}

async function regenerateNav(): Promise<void> {
  if (!state.project || !effectiveSiteDocument(state)) return;
  if (!(await resolveSiteEditorConflict("shell"))) return;
  const nextSite = cloneSiteDocument(
    effectiveSiteDocument(state),
  ) as SiteDocument;
  const wrap = document.createElement("div");
  wrap.className = "meta-form";

  const help = document.createElement("p");
  help.className = "muted";
  help.textContent =
    "Preview and adjust the Zephus-managed navigation before saving the site shell.";
  wrap.appendChild(help);

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
    labelInput: HTMLInputElement;
    visibleInput: HTMLInputElement;
  }[] = [];

  for (const entry of currentEntries) {
    const row = document.createElement("div");
    row.className = "meta-grid";

    const visible = document.createElement("input");
    visible.type = "checkbox";
    visible.checked = entry.visible;

    const label = document.createElement("input");
    label.className = "text";
    label.value = entry.label;

    const route = document.createElement("span");
    route.className = "muted";
    route.textContent = entry.href;

    row.append(visible, label, route);
    wrap.appendChild(row);
    rows.push({ entry, labelInput: label, visibleInput: visible });
  }

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
              navLabel: row.labelInput.value.trim() || row.entry.label,
              navVisible: row.visibleInput.checked,
            },
          );
        }
        nextSite.shell.layoutMode = "managed";
        nextSite.shell.navItems = rows.map((row) => ({
          ...row.entry,
          label: row.labelInput.value.trim() || row.entry.label,
          visible: row.visibleInput.checked,
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
  host.innerHTML = "";

  const addBanner = (
    tone: "warning" | "info",
    message: string,
    actions: Array<{ label: string; onClick: () => void }>,
  ) => {
    const item = document.createElement("div");
    item.className = `editor-banner-item ${tone}`;

    const copy = document.createElement("p");
    copy.className = "editor-banner-copy";
    copy.textContent = message;

    const actionRow = document.createElement("div");
    actionRow.className = "editor-banner-actions";
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.className = "mini-btn";
      btn.textContent = action.label;
      btn.onclick = action.onClick;
      actionRow.appendChild(btn);
    }

    item.append(copy, actionRow);
    host.appendChild(item);
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

  host.classList.toggle("hidden", host.childElementCount === 0);
}

function renderLayers(): void {
  const list = $("layers-list");
  list.innerHTML = "";

  if (state.sections.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No sections yet.";
    list.appendChild(li);
    return;
  }

  for (const section of state.sections) {
    const row = document.createElement("li");
    row.classList.toggle(
      "active",
      section.id === state.selectedSectionId && !state.selectedId,
    );

    const sectionBtn = document.createElement("button");
    sectionBtn.className = "layer-button";
    sectionBtn.textContent = section.label;
    sectionBtn.onclick = () => {
      state.selectedId = null;
      state.selectedSectionId = section.id;
      renderLayers();
      renderCanvas();
      renderProperties();
    };
    row.appendChild(sectionBtn);

    if (section.children.length > 0) {
      const children = document.createElement("div");
      children.className = "layer-children";
      for (const child of section.children) {
        const childBtn = document.createElement("button");
        childBtn.className = "layer-button";
        childBtn.textContent = blockLabel(child as Block);
        childBtn.onclick = () => {
          state.selectedId = child.id;
          state.selectedSectionId = section.id;
          renderLayers();
          renderCanvas();
          renderProperties();
        };
        childBtn.classList.toggle("muted", state.selectedId !== child.id);
        children.appendChild(childBtn);
      }
      row.appendChild(children);
    }

    list.appendChild(row);
  }
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
  const wrap = document.createElement("div");
  wrap.className = "meta-form";

  const help = document.createElement("p");
  help.className = "muted";
  help.textContent =
    "Saving here switches the project shell into Zephus-managed layout mode so the header, announcement bar, and footer stay GUI-editable.";
  wrap.appendChild(help);

  const siteTitle = document.createElement("input");
  siteTitle.className = "text";
  siteTitle.value = nextSite.shell.siteTitle;
  const logoText = document.createElement("input");
  logoText.className = "text";
  logoText.value = nextSite.shell.logoText;
  const announcementText = document.createElement("textarea");
  announcementText.rows = 3;
  announcementText.value = nextSite.shell.announcementText;
  const announcementVisible = document.createElement("input");
  announcementVisible.type = "checkbox";
  announcementVisible.checked = nextSite.shell.announcementVisible;
  const ctaLabel = document.createElement("input");
  ctaLabel.className = "text";
  ctaLabel.value = nextSite.shell.navCtaLabel;
  const ctaHref = document.createElement("input");
  ctaHref.className = "text";
  ctaHref.value = nextSite.shell.navCtaHref;
  const ctaHrefField = document.createElement("div");
  ctaHrefField.className = "link-field";
  const ctaHrefPick = document.createElement("button");
  ctaHrefPick.type = "button";
  ctaHrefPick.className = "btn ghost mini-btn";
  ctaHrefPick.textContent = "Choose…";
  ctaHrefPick.onclick = () =>
    openLinkPicker(ctaHref.value, (href) => {
      ctaHref.value = href;
    });
  ctaHrefField.append(ctaHref, ctaHrefPick);
  const footerHtml = document.createElement("textarea");
  footerHtml.rows = 4;
  footerHtml.value = nextSite.shell.footerHtml;
  const customHeadHtml = document.createElement("textarea");
  customHeadHtml.rows = 4;
  customHeadHtml.value = nextSite.shell.customHeadHtml;

  for (const [labelText, field] of [
    ["Site title", siteTitle],
    ["Logo text", logoText],
    ["Announcement text", announcementText],
    ["Show announcement", announcementVisible],
    ["CTA label", ctaLabel],
    ["CTA link", ctaHrefField],
    ["Footer HTML", footerHtml],
    ["Custom head HTML", customHeadHtml],
  ] as [string, HTMLElement][]) {
    const row = document.createElement("label");
    row.className = "meta-field";
    const span = document.createElement("span");
    span.textContent = labelText;
    row.append(span, field);
    wrap.appendChild(row);
  }

  showModalNode(
    "Site Shell",
    wrap,
    [
      { label: "Cancel", kind: "ghost", onClick: closeModal },
      {
        label: "Stage Shell",
        kind: "primary",
        onClick: async () => {
          const newFooter = footerHtml.value.trim();
          const newHead = customHeadHtml.value.trim();
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
            siteTitle.value.trim() || nextSite.siteName;
          nextSite.shell.logoText = logoText.value.trim() || nextSite.siteName;
          nextSite.shell.announcementText = announcementText.value.trim();
          nextSite.shell.announcementVisible = announcementVisible.checked;
          nextSite.shell.navCtaLabel = ctaLabel.value.trim();
          nextSite.shell.navCtaHref = ctaHref.value.trim() || "#";
          nextSite.shell.footerHtml = footerHtml.value.trim();
          nextSite.shell.customHeadHtml = customHeadHtml.value.trim();
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
  const wrap = document.createElement("div");
  wrap.className = "meta-form";

  const inputs = {
    radius: document.createElement("input"),
    containerWidth: document.createElement("input"),
  };

  for (const input of Object.values(inputs)) {
    input.className = "text";
  }

  const colorControls = {
    accent: createColorControl(nextSite.design.accent),
    background: createColorControl(nextSite.design.background),
    foreground: createColorControl(nextSite.design.foreground),
    surface: createColorControl(nextSite.design.surface),
  };

  const bodyFont = createFontControl(nextSite.design.fontFamily);
  const headingFont = createFontControl(nextSite.design.headingFontFamily);

  inputs.radius.value = nextSite.design.radius;
  inputs.containerWidth.value = nextSite.design.containerWidth;

  const shadow = document.createElement("select");
  for (const value of ["none", "sm", "md", "lg"] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = nextSite.design.shadow === value;
    shadow.appendChild(option);
  }

  for (const [labelText, field] of [
    ["Accent color", colorControls.accent.element],
    ["Background", colorControls.background.element],
    ["Foreground", colorControls.foreground.element],
    ["Surface", colorControls.surface.element],
    ["Body font", bodyFont.element],
    ["Heading font", headingFont.element],
    ["Radius", inputs.radius],
    ["Container width", inputs.containerWidth],
    ["Shadow depth", shadow],
  ] as [string, HTMLElement][]) {
    const row = document.createElement("label");
    row.className = "meta-field";
    const span = document.createElement("span");
    span.textContent = labelText;
    row.append(span, field);
    wrap.appendChild(row);
  }

  showModalNode("Design System", wrap, [
    { label: "Cancel", kind: "ghost", onClick: closeModal },
    {
      label: "Stage Design",
      kind: "primary",
      onClick: async () => {
        nextSite.shell.layoutMode = "managed";
        nextSite.design.accent = colorControls.accent.getValue().trim();
        nextSite.design.background = colorControls.background.getValue().trim();
        nextSite.design.foreground = colorControls.foreground.getValue().trim();
        nextSite.design.surface = colorControls.surface.getValue().trim();
        nextSite.design.fontFamily = bodyFont.getStack();
        nextSite.design.headingFontFamily = headingFont.getStack();
        nextSite.design.fontImportUrl = buildFontImportUrl([
          bodyFont.getGoogle(),
          headingFont.getGoogle(),
        ]);
        nextSite.design.radius = inputs.radius.value.trim();
        nextSite.design.containerWidth = inputs.containerWidth.value.trim();
        nextSite.design.shadow = shadow.value as DesignTokenSet["shadow"];
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
  const list = $("page-list");
  list.innerHTML = "";
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
  if (entries.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No pages found.";
    list.appendChild(li);
    return;
  }
  for (const entry of entries) {
    const li = document.createElement("li");
    li.className = "page-item";
    li.classList.toggle("hidden-page", !entry.navVisible);
    li.dataset["page"] = entry.page;
    if (entry.page === state.page) {
      li.classList.add("active");
    }
    const main = document.createElement("button");
    main.className = "page-main";
    main.innerHTML = `<i data-lucide="file-code"></i><span><strong>${escapeHtml(entry.navLabel)}</strong><small>${escapeHtml(entry.route)}</small></span>`;
    main.onclick = () => void loadPage(entry.page);

    const manage = document.createElement("button");
    manage.className = "mini-btn";
    manage.textContent = "Manage";
    manage.onclick = (event) => {
      event.stopPropagation();
      void openPageMetaModal(entry.page);
    };
    li.append(main, manage);
    list.appendChild(li);
  }
  refreshIcons();
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
  const input = document.createElement("input");
  input.className = "text";
  input.placeholder = "docs/getting-started";
  const wrap = document.createElement("div");
  wrap.className = "meta-form";
  const label = document.createElement("p");
  label.className = "muted";
  label.textContent =
    "New pages inherit the project theme layout. Nested routes like docs/getting-started are supported.";
  wrap.append(label, input);

  showModalNode("New Page", wrap, [
    { label: "Cancel", kind: "ghost", onClick: closeModal },
    {
      label: "Create Page",
      kind: "primary",
      onClick: async () => {
        const name = input.value.trim();
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

  const wrap = document.createElement("div");
  wrap.className = "meta-form";

  const title = document.createElement("input");
  title.className = "text";
  title.value = entry.title;

  const slug = document.createElement("input");
  slug.className = "text";
  slug.value = entry.slug;
  if (entry.isHome) slug.disabled = true;

  const navLabel = document.createElement("input");
  navLabel.className = "text";
  navLabel.value = entry.navLabel;

  const description = document.createElement("textarea");
  description.rows = 3;
  description.value = entry.metaDescription;

  const visible = document.createElement("input");
  visible.type = "checkbox";
  visible.checked = entry.navVisible;

  const fields: [string, HTMLElement][] = [
    ["Page title", title],
    ["Slug", slug],
    ["Nav label", navLabel],
    ["Meta description", description],
    ["Show in nav", visible],
  ];

  for (const [labelText, field] of fields) {
    const row = document.createElement("label");
    row.className = "meta-field";
    const span = document.createElement("span");
    span.textContent = labelText;
    row.append(span, field);
    wrap.appendChild(row);
  }

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
        const nextSlug = slug.value.trim() || entry.slug;
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
            title: title.value.trim() || entry.title,
            navLabel:
              navLabel.value.trim() || title.value.trim() || entry.navLabel,
            metaDescription: description.value.trim(),
            navVisible: visible.checked,
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
  wrap.className = "save-summary";

  const intro = document.createElement("p");
  intro.textContent = "You have unsaved changes in Zephus.";
  wrap.appendChild(intro);

  const list = document.createElement("ul");
  list.className = "change-list";

  const pageItems = state.pageChangeSummary.length
    ? state.pageChangeSummary
    : state.pageDirty
      ? [`Unsaved page edits for ${currentPageLabel()}`]
      : [];
  const siteItems = state.siteChangeSummary.length
    ? state.siteChangeSummary
    : state.siteDirty
      ? ["Unsaved site shell or design edits"]
      : [];

  for (const item of [...pageItems, ...siteItems]) {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  }
  wrap.appendChild(list);
  return wrap;
}

async function discardPendingSiteChanges(): Promise<void> {
  if (!state.project) return;
  await window.zephus.clearDraft(state.project.path, "site", siteDraftTarget());
  clearSiteChanges(state);
  markSiteDirty(state, false);
  renderDirtyIndicators();
  if (state.project) {
    renderNavEditor(state.project);
  }
}

async function persistPendingSiteDocument(): Promise<boolean> {
  if (!state.project || !state.pendingSiteDocument) return true;
  const result = await window.zephus.writeSiteDocument(
    state.project.path,
    state.pendingSiteDocument,
    state.project.astro.pagesDir,
  );
  if (!result.ok) {
    setStatus("Could not save site settings: " + (result.error ?? "unknown"));
    return false;
  }
  const refreshed = await window.zephus.readSiteDocument(state.project.path);
  if (refreshed.ok && refreshed.site) {
    state.siteDocument = refreshed.site;
  }
  await window.zephus.clearDraft(state.project.path, "site", siteDraftTarget());
  clearSiteChanges(state);
  markSiteDirty(state, false);
  renderDirtyIndicators();
  if (state.project) {
    renderNavEditor(state.project);
  }
  return true;
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

async function maybeRestoreSiteDraft(): Promise<void> {
  if (!state.project || !state.siteDocument) return;
  const draft = await window.zephus.readDraft(
    state.project.path,
    "site",
    siteDraftTarget(),
  );
  if (!draft.ok || !draft.draft?.content) return;
  if (draft.draft.content === JSON.stringify(state.siteDocument, null, 2)) {
    return;
  }
  const choice = await modalController.confirmRestoreDraft(
    "Restore Site Draft",
    `Zephus found unsaved site-level changes from ${new Date(
      draft.draft.savedAt,
    ).toLocaleString()}. Restore them?`,
  );
  if (choice === "discard") {
    await window.zephus.clearDraft(
      state.project.path,
      "site",
      siteDraftTarget(),
    );
    return;
  }
  if (choice !== "restore") return;
  try {
    const restored = JSON.parse(draft.draft.content) as SiteDocument;
    state.pendingSiteDocument = restored;
    state.pendingSiteEditorKind = "shell";
    state.recoveredSiteDraft = draft.draft;
    trackSiteChange(state, "Recovered unsaved site settings");
    markSiteDirty(state, true);
    renderDirtyIndicators();
    scheduleDraftWrite();
    renderNavEditor(state.project);
    setStatus(
      `Recovered site settings draft from ${new Date(draft.draft.savedAt).toLocaleString()}.`,
    );
  } catch {
    await window.zephus.clearDraft(
      state.project.path,
      "site",
      siteDraftTarget(),
    );
  }
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
    const draft = await window.zephus.readDraft(
      state.project.path,
      "page",
      page,
    );
    if (
      draft.ok &&
      draft.draft?.content &&
      draft.draft.content !== state.rawCode
    ) {
      const choice = await modalController.confirmRestoreDraft(
        "Restore Page Draft",
        `Zephus found an unsaved draft for ${
          findPageMeta(page)?.navLabel ?? page
        } from ${new Date(draft.draft.savedAt).toLocaleString()}. Restore it?`,
      );
      if (choice === "discard") {
        await window.zephus.clearDraft(state.project.path, "page", page);
      } else if (choice === "restore") {
        state.rawCode = draft.draft.content;
        state.recoveredPageDraft = draft.draft;
        if (state.visualEditable) {
          parsePage(state.rawCode);
        }
        setStatus(
          `Recovered draft from ${new Date(draft.draft.savedAt).toLocaleString()}.`,
        );
      }
    }
  }
  state.undo = [];
  state.redo = [];
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
      "Detached page loaded in code mode. Reattach it from Page Settings to restore visual editing.",
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
  state.frontmatter = "";
  state.prefix = "";
  state.suffix = "";

  let rest = raw;
  const fm = raw.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n?)/);
  if (fm && fm[1]) {
    state.frontmatter = fm[1];
    rest = raw.slice(fm[1].length);
  }

  // Prefer a <body> region; otherwise the inner of the single root element.
  const bodyMatch = rest.match(
    /([\s\S]*<body[^>]*>)([\s\S]*?)(<\/body>[\s\S]*)/i,
  );
  let inner: string;
  if (bodyMatch) {
    state.prefix = bodyMatch[1] ?? "";
    inner = bodyMatch[2] ?? "";
    state.suffix = bodyMatch[3] ?? "";
  } else {
    const rootMatch = rest.match(
      /^(\s*<([A-Za-z][\w.-]*)\b[^>]*>)([\s\S]*)(<\/\2>\s*)$/,
    );
    if (rootMatch) {
      state.prefix = rootMatch[1] ?? "";
      inner = rootMatch[3] ?? "";
      state.suffix = rootMatch[4] ?? "";
    } else {
      inner = rest;
    }
  }

  return inner;
}

function parsePage(raw: string): void {
  const inner = capturePageFrame(raw);
  state.sections = [ensureFallbackSection()];
  state.sections[0]!.children = parseInner(inner);
  syncBlocksFromSections();
  state.selectedSectionId = state.sections[0]?.id ?? null;
}

function parseInner(inner: string): Block[] {
  const doc = new DOMParser().parseFromString(
    `<div id="z-root">${inner}</div>`,
    "text/html",
  );
  const root = doc.getElementById("z-root");
  const blocks: Block[] = [];
  if (!root) return blocks;

  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text.trim().length > 0) {
        blocks.push({ id: uid(), type: "html", props: {}, raw: text });
      }
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      // Comments and others preserved verbatim.
      const raw = (node as ChildNode).textContent ?? "";
      if (raw.trim()) blocks.push({ id: uid(), type: "html", props: {}, raw });
      continue;
    }
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const cls = el.getAttribute("class") ?? "";
    const storedType = el.dataset["zephusBlock"] as BlockType | undefined;
    const storedProps = parseJsonAttr<Record<string, string>>(
      el.dataset["zephusProps"] ?? null,
    );
    const storedStyle = parseJsonAttr<BlockStyle>(
      el.dataset["zephusStyle"] ?? null,
    );
    if (storedType && storedProps) {
      blocks.push({
        id: uid(),
        type: storedType,
        props: storedProps,
        style: storedStyle,
        locked: el.dataset["zephusLocked"] === "true",
        raw: storedType === "html" ? el.outerHTML : undefined,
      });
      continue;
    }

    if (/^h[1-6]$/.test(tag)) {
      blocks.push({
        id: uid(),
        type: "heading",
        props: { text: el.textContent ?? "", level: tag[1] ?? "2", cls },
        style: styleFromLegacyProps(el),
      });
    } else if (tag === "p") {
      blocks.push({
        id: uid(),
        type: "text",
        props: { text: el.textContent ?? "", cls },
        style: styleFromLegacyProps(el),
      });
    } else if (tag === "a") {
      blocks.push({
        id: uid(),
        type: "button",
        props: {
          text: el.textContent ?? "",
          href: el.getAttribute("href") ?? "#",
          cls,
        },
        style: styleFromLegacyProps(el),
      });
    } else if (tag === "img") {
      blocks.push({
        id: uid(),
        type: "image",
        props: {
          src: el.getAttribute("src") ?? "",
          alt: el.getAttribute("alt") ?? "",
          cls,
        },
        style: styleFromLegacyProps(el),
      });
    } else if (tag === "hr") {
      blocks.push({
        id: uid(),
        type: "divider",
        props: { cls },
        style: styleFromLegacyProps(el),
      });
    } else if (tag === "blockquote") {
      blocks.push({
        id: uid(),
        type: "quote",
        props: {
          text:
            el.querySelector("p")?.textContent?.trim() ??
            el.textContent?.trim() ??
            "",
          cite: el.querySelector("cite")?.textContent?.trim() ?? "",
          cls,
        },
        style: styleFromLegacyProps(el),
      });
    } else if (tag === "ul" || tag === "ol") {
      blocks.push({
        id: uid(),
        type: "list",
        props: {
          items: Array.from(el.querySelectorAll("li"))
            .map((item) => item.textContent?.trim() ?? "")
            .filter(Boolean)
            .join("\n"),
          ordered: tag === "ol" ? "true" : "false",
          cls,
        },
        style: styleFromLegacyProps(el),
      });
    } else if (tag === "iframe") {
      blocks.push({
        id: uid(),
        type: "embed",
        props: {
          src: el.getAttribute("src") ?? "",
          title: el.getAttribute("title") ?? "Embed",
          cls,
        },
        style: styleFromLegacyProps(el),
      });
    } else {
      // Unknown / structural element: preserve verbatim so nothing is lost.
      blocks.push({ id: uid(), type: "html", props: {}, raw: el.outerHTML });
    }
  }
  return blocks;
}

function parseJsonAttr<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(decodeURIComponent(value)) as T;
  } catch {
    return undefined;
  }
}

function styleFromLegacyProps(el: HTMLElement): BlockStyle | undefined {
  const style = {
    color: el.style.color || undefined,
    background: el.style.background || undefined,
    padding: el.style.padding || undefined,
    margin: el.style.margin || undefined,
    width: el.style.width || undefined,
    height: el.style.height || undefined,
    maxWidth: el.style.maxWidth || undefined,
    radius: el.style.borderRadius || undefined,
    gap: el.style.gap || undefined,
  } satisfies BlockStyle;
  return Object.values(style).some(Boolean) ? style : undefined;
}

function metadataAttrs(block: Block): string {
  const attrs = [
    `data-zephus-block="${escapeAttr(block.type)}"`,
    `data-zephus-props="${escapeAttr(
      encodeURIComponent(JSON.stringify(block.props)),
    )}"`,
  ];
  if (block.style) {
    attrs.push(
      `data-zephus-style="${escapeAttr(
        encodeURIComponent(JSON.stringify(block.style)),
      )}"`,
    );
  }
  if (block.locked) attrs.push(`data-zephus-locked="true"`);
  return " " + attrs.join(" ");
}

function effectiveStyle(
  block: Block,
  viewport = state.currentViewport,
): BlockStyle {
  const base = block.style ? JSON.parse(JSON.stringify(block.style)) : {};
  const responsive =
    viewport === "desktop" ? undefined : block.style?.responsive?.[viewport];
  if (responsive) Object.assign(base, responsive);
  return base;
}

function blockCssValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /[;{}<>\r\n]/.test(trimmed)) return null;
  return trimmed.slice(0, 240);
}

function addCssValue(css: string[], property: string, value: unknown): void {
  const safe = blockCssValue(value);
  if (safe) css.push(`${property}:${safe}`);
}

function styleAttr(
  block: Block,
  viewport = state.currentViewport,
  forCanvas = false,
): string {
  const style = effectiveStyle(block, viewport);
  const css: string[] = [];
  if (["left", "center", "right"].includes(String(style.align))) {
    css.push(`text-align:${style.align}`);
  }
  addCssValue(css, "width", style.width);
  addCssValue(css, "height", style.height);
  addCssValue(css, "max-width", style.maxWidth);
  addCssValue(css, "background", style.background);
  addCssValue(css, "color", style.color);
  addCssValue(css, "padding", style.padding);
  addCssValue(css, "margin", style.margin);
  addCssValue(css, "border-radius", style.radius);
  addCssValue(css, "gap", style.gap);
  if (style.columns && (block.type === "columns" || block.type === "gallery")) {
    css.push(
      `grid-template-columns:repeat(${Math.max(1, Number(style.columns) || 1)}, minmax(0, 1fr))`,
    );
  }
  if (style.shadow === "sm") css.push(`box-shadow:var(--shadow-sm)`);
  if (style.shadow === "md") css.push(`box-shadow:var(--shadow-md)`);
  if (style.shadow === "lg") css.push(`box-shadow:var(--shadow-lg)`);
  if (
    style.stackOnMobile &&
    viewport === "mobile" &&
    block.type === "columns"
  ) {
    css.push(`grid-template-columns:1fr`);
  }
  if (style.hideOn?.includes(viewport) && forCanvas) {
    css.push(`display:none`);
  }
  if (block.type === "spacer" && !style.height) {
    addCssValue(css, "height", block.props["height"] || "48px");
  }
  return css.length ? ` style="${escapeAttr(css.join(";"))}"` : "";
}

function classAttr(block: Block): string {
  const cls = block.props["cls"];
  return cls ? ` class="${escapeAttr(cls)}"` : "";
}

function structuralCommon(
  block: Block,
  fixedClass: string,
  viewport = state.currentViewport,
  forCanvas = false,
): string {
  const userCls = block.props["cls"]
    ? " " + escapeAttr(block.props["cls"])
    : "";
  return `${metadataAttrs(block)} class="${fixedClass}${userCls}"${styleAttr(block, viewport, forCanvas)}`;
}

function splitLines(raw: string): string[] {
  return (raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitPair(line: string, sep = "::"): [string, string] {
  const i = line.indexOf(sep);
  if (i < 0) return [line.trim(), ""];
  return [line.slice(0, i).trim(), line.slice(i + sep.length).trim()];
}

function plainTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br />");
}

function renderListItems(items: string): string {
  return items
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `<li>${plainTextToHtml(item)}</li>`)
    .join("");
}

function blockToHtml(
  block: Block,
  viewport = state.currentViewport,
  forCanvas = false,
): string {
  const common = `${metadataAttrs(block)}${classAttr(block)}${styleAttr(
    block,
    viewport,
    forCanvas,
  )}`;
  switch (block.type) {
    case "heading": {
      const level = Math.max(
        1,
        Math.min(
          editorRules.maxHeadingLevel,
          Number(block.props["level"] ?? 2),
        ),
      );
      return `<h${level}${common}>${plainTextToHtml(
        block.props["text"] ?? "",
      )}</h${level}>`;
    }
    case "text":
      return `<p${common}>${plainTextToHtml(block.props["text"] ?? "")}</p>`;
    case "image": {
      const src = block.props["src"] ?? "";
      if (!src && forCanvas) {
        return `<figure${common}><div class="canvas-empty">Missing image. Choose one in Properties.</div></figure>`;
      }
      const isProjectAsset = forCanvas && src.startsWith("/");
      const srcAttr = isProjectAsset
        ? ` src="" data-asset-src="${escapeAttr(src)}"`
        : ` src="${escapeAttr(src)}"`;
      return `<img${common}${srcAttr} alt="${escapeAttr(block.props["alt"] ?? "")}" />`;
    }
    case "button":
      return `<a${common} href="${escapeAttr(block.props["href"] ?? "#")}">${plainTextToHtml(block.props["text"] ?? "")}</a>`;
    case "section":
      return `<section${common}>${plainTextToHtml(block.props["text"] ?? "")}</section>`;
    case "divider":
      return `<hr${common} />`;
    case "spacer":
      return `<div${common}></div>`;
    case "columns": {
      const cols = Number(block.style?.columns ?? block.props["count"] ?? 2);
      const parts = Array.from(
        { length: Math.max(2, Math.min(cols || 2, 4)) },
        (_, index) => {
          const key = `col${index + 1}`;
          return `<div class="zephus-column">${plainTextToHtml(
            block.props[key] ?? `Column ${index + 1}`,
          )}</div>`;
        },
      ).join("");
      return `<section${common}>${parts}</section>`;
    }
    case "card":
      return `<article${common}><h3>${plainTextToHtml(
        block.props["title"] ?? "Card title",
      )}</h3><p>${plainTextToHtml(block.props["text"] ?? "Card body")}</p></article>`;
    case "gallery": {
      const images = (block.props["images"] ?? "")
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (images.length === 0 && forCanvas) {
        return `<section${common}><div class="canvas-empty">No gallery images yet.</div></section>`;
      }
      return `<section${common}>${images
        .map((src, index) => {
          const isProjectAsset = forCanvas && src.startsWith("/");
          const srcAttr = isProjectAsset
            ? ` src="" data-asset-src="${escapeAttr(src)}"`
            : ` src="${escapeAttr(src)}"`;
          return `<img${srcAttr} alt="${escapeAttr(
            block.props[`alt${index + 1}`] ?? `Gallery image ${index + 1}`,
          )}" />`;
        })
        .join("")}</section>`;
    }
    case "quote":
      return `<blockquote${common}><p>${plainTextToHtml(
        block.props["text"] ?? "",
      )}</p>${
        block.props["cite"]
          ? `<cite>${plainTextToHtml(block.props["cite"])}</cite>`
          : ""
      }</blockquote>`;
    case "list": {
      const tag = block.props["ordered"] === "true" ? "ol" : "ul";
      return `<${tag}${common}>${renderListItems(
        block.props["items"] ?? "",
      )}</${tag}>`;
    }
    case "embed":
      if (!block.props["src"] && forCanvas) {
        return `<section${common}><div class="canvas-empty">Missing embed URL.</div></section>`;
      }
      return `<iframe${common} src="${escapeAttr(block.props["src"] ?? "")}" title="${escapeAttr(block.props["title"] ?? "Embed")}" loading="lazy"></iframe>`;
    case "html":
      return block.raw ?? "";
    case "feature":
      return `<div${structuralCommon(block, "zephus-feature", viewport, forCanvas)}><div class="zephus-feature-icon">${plainTextToHtml(
        block.props["icon"] ?? "★",
      )}</div><h3>${plainTextToHtml(
        block.props["title"] ?? "Feature",
      )}</h3><p>${plainTextToHtml(block.props["text"] ?? "")}</p></div>`;
    case "testimonial":
      return `<figure${structuralCommon(block, "zephus-testimonial", viewport, forCanvas)}><blockquote>${plainTextToHtml(
        block.props["quote"] ?? "",
      )}</blockquote><figcaption><strong>${plainTextToHtml(
        block.props["author"] ?? "",
      )}</strong>${
        block.props["role"]
          ? ` <span>${plainTextToHtml(block.props["role"])}</span>`
          : ""
      }</figcaption></figure>`;
    case "accordion": {
      const items = splitLines(block.props["items"] ?? "")
        .map((line) => splitPair(line))
        .map(
          ([q, a]) =>
            `<details><summary>${plainTextToHtml(q)}</summary><p>${plainTextToHtml(a)}</p></details>`,
        )
        .join("");
      return `<div${structuralCommon(block, "zephus-accordion", viewport, forCanvas)}>${items}</div>`;
    }
    case "stats": {
      const items = splitLines(block.props["items"] ?? "")
        .map((line) => splitPair(line))
        .map(
          ([n, l]) =>
            `<div class="zephus-stat"><span class="zephus-stat-num">${plainTextToHtml(
              n,
            )}</span><span class="zephus-stat-label">${plainTextToHtml(l)}</span></div>`,
        )
        .join("");
      return `<div${structuralCommon(block, "zephus-stats", viewport, forCanvas)}>${items}</div>`;
    }
    case "pricing": {
      const features = splitLines(block.props["features"] ?? "")
        .map((f) => `<li>${plainTextToHtml(f)}</li>`)
        .join("");
      const cta = block.props["ctaText"]
        ? `<a class="button" href="${escapeAttr(block.props["ctaHref"] ?? "#")}">${plainTextToHtml(
            block.props["ctaText"],
          )}</a>`
        : "";
      return `<div${structuralCommon(block, "zephus-pricing", viewport, forCanvas)}><h3>${plainTextToHtml(
        block.props["plan"] ?? "Plan",
      )}</h3><div class="zephus-price"><span class="zephus-price-amount">${plainTextToHtml(
        block.props["price"] ?? "",
      )}</span>${
        block.props["period"]
          ? `<span class="zephus-price-period">${plainTextToHtml(block.props["period"])}</span>`
          : ""
      }</div><ul>${features}</ul>${cta}</div>`;
    }
    case "cta": {
      const cta = block.props["buttonText"]
        ? `<a class="button" href="${escapeAttr(block.props["buttonHref"] ?? "#")}">${plainTextToHtml(
            block.props["buttonText"],
          )}</a>`
        : "";
      return `<div${structuralCommon(block, "zephus-cta", viewport, forCanvas)}><h2>${plainTextToHtml(
        block.props["heading"] ?? "",
      )}</h2>${
        block.props["text"]
          ? `<p>${plainTextToHtml(block.props["text"])}</p>`
          : ""
      }${cta}</div>`;
    }
    default:
      // Unknown block type — render a placeholder so it's visible in the canvas
      // and not silently dropped.
      return `<div${common} class="canvas-unknown-block">Unknown block: ${escapeHtml((block as { type: string }).type)}</div>`;
  }
}

function sectionToHtml(
  section: SectionNode,
  viewport = state.currentViewport,
  forCanvas = false,
): string {
  const body = section.children
    .map((block) => blockToHtml(block as Block, viewport, forCanvas))
    .join("\n");
  const cls = section.props["cls"]
    ? ` class="${escapeAttr(section.props["cls"])}"`
    : "";
  const wrapper = section.props["wrapper"] ?? "none";
  if (wrapper === "none") return body;
  const styleBlock = {
    id: section.id,
    type: "section",
    props: { cls: section.props["cls"] ?? "", text: "" },
    style: section.style,
  } as Block;
  return `<section${cls}${styleAttr(styleBlock, viewport, forCanvas)}>\n${body}\n</section>`;
}

function serializeBlocks(): string {
  const body = state.sections
    .map((section) => sectionToHtml(section, "desktop"))
    .filter(Boolean)
    .map((entry) => "    " + entry)
    .join("\n");
  return `${state.frontmatter}${state.prefix}\n${body}\n${state.suffix}`;
}

function currentManagedSource(): string {
  return serializeBlocks();
}

/* ---------- Canvas rendering + drag/drop ---------- */

let dropIndex = -1;
let indicator: HTMLElement | null = null;
let dropSectionId: string | null = null;

function pushUndo(): void {
  state.undo.push(cloneSections(state.sections));
  if (state.undo.length > 50) state.undo.shift();
  state.redo = [];
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

let inspectorUndoActive = false;

function beginInspectorEdit(): void {
  if (inspectorUndoActive) return;
  pushUndo();
  inspectorUndoActive = true;
}

function endInspectorEdit(): void {
  inspectorUndoActive = false;
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
  renderLayers();
  renderCanvas();
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
  pushUndo();
  if (state.sections.length === 0) {
    state.sections.push(ensureFallbackSection());
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
  const targetSection =
    findSection(sectionId ?? activeSectionId()) ?? state.sections[0]!;
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
  if (block.locked) return;
  pushUndo();
  const siblings = location.section.children;
  const next = location.blockIndex + direction;
  let moved: Block | undefined;
  if (next >= 0 && next < siblings.length) {
    [moved] = siblings.splice(location.blockIndex, 1) as Block[];
    if (!moved) return;
    siblings.splice(next, 0, moved);
  } else {
    const nextSection = state.sections[location.sectionIndex + direction];
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
  if (appSettings?.confirmBlockDelete) {
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
  pushUndo();
  const [section] = state.sections.splice(index, 1);
  if (!section) return;
  state.sections.splice(next, 0, section);
  state.selectedSectionId = section.id;
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
  if (appSettings?.confirmBlockDelete) {
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

function buildInsertButton(index: number, sectionId: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "canvas-insert";
  const btn = document.createElement("button");
  btn.className = "mini-btn";
  btn.textContent = "+ Add Block";
  btn.onclick = (event) => {
    event.stopPropagation();
    openBlockInsertModal(index, sectionId);
  };
  row.appendChild(btn);
  return row;
}

function buildSectionInsertButton(index: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "canvas-insert section-insert";
  const btn = document.createElement("button");
  btn.className = "mini-btn";
  btn.textContent = "+ Add Section";
  btn.onclick = (event) => {
    event.stopPropagation();
    openSectionInsertModal(index);
  };
  row.appendChild(btn);
  return row;
}

function openBlockInsertModal(index: number, sectionId: string): void {
  const wrap = document.createElement("div");
  wrap.className = "insert-grid";
  for (const item of PALETTE) {
    const allowed = editorRules.allowedBlocks;
    if (allowed && !allowed.includes(item.type)) continue;
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = item.label;
    btn.onclick = () => {
      closeModal();
      addBlockAt(item.type, index, sectionId);
    };
    wrap.appendChild(btn);
  }
  showModalNode("Add Block", wrap, [
    { label: "Close", kind: "ghost", onClick: closeModal },
  ]);
}

function openSectionInsertModal(index: number): void {
  const wrap = document.createElement("div");
  wrap.className = "insert-grid";

  const blank = document.createElement("button");
  blank.className = "btn primary";
  blank.textContent = "Blank Section";
  blank.onclick = () => {
    closeModal();
    addSectionAt(index);
  };
  wrap.appendChild(blank);

  for (const template of TEMPLATES) {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = template.label;
    btn.onclick = () => {
      closeModal();
      addSectionAt(index, template);
    };
    wrap.appendChild(btn);
  }

  for (const saved of reusableSectionsCache) {
    const tpl = resolveSavedSectionTemplate(saved.id);
    if (!tpl) continue;
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = `${saved.label} (Saved)`;
    btn.onclick = () => {
      closeModal();
      addSectionAt(index, tpl);
    };
    wrap.appendChild(btn);
  }

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

type ResizeCorner = "nw" | "ne" | "sw" | "se";
type ResizeTarget =
  | { kind: "block"; node: Block }
  | { kind: "section"; node: SectionNode };

const MIN_RESIZE_WIDTH = 40;
const MIN_RESIZE_HEIGHT = 24;

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

function applyCanvasBoxStyle(
  element: HTMLElement,
  node: { style?: BlockStyle },
): void {
  const style = effectiveNodeStyle(node);
  if (style.width) element.style.width = style.width;
  if (style.height) element.style.height = style.height;
  if (style.maxWidth) element.style.maxWidth = style.maxWidth;
  if (style.background) element.style.background = style.background;
  if (style.color) element.style.color = style.color;
  if (style.padding) element.style.padding = style.padding;
  if (style.margin) element.style.margin = style.margin;
  if (style.radius) element.style.borderRadius = style.radius;
  if (style.shadow === "sm") element.style.boxShadow = "var(--shadow-sm)";
  if (style.shadow === "md") element.style.boxShadow = "var(--shadow-md)";
  if (style.shadow === "lg") element.style.boxShadow = "var(--shadow-lg)";
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
  style.width = `${Math.max(MIN_RESIZE_WIDTH, Math.round(width))}px`;
  style.height = `${Math.max(MIN_RESIZE_HEIGHT, Math.round(height))}px`;
  subject.style.width = style.width;
  subject.style.height = style.height;
  pushUndo();
  commitInspectorChange(
    `Resized ${target.kind === "block" ? target.node.type : target.node.label}`,
    true,
  );
}

function beginCanvasResize(
  event: PointerEvent,
  corner: ResizeCorner,
  target: ResizeTarget,
  subject: HTMLElement,
  handle: HTMLElement,
): void {
  pushUndo();
  inspectorUndoActive = true;
  const startX = event.clientX;
  const startY = event.clientY;
  const rect = subject.getBoundingClientRect();
  const startWidth = rect.width;
  const startHeight = rect.height;
  const fromLeft = corner === "nw" || corner === "sw";
  const fromTop = corner === "nw" || corner === "ne";
  try {
    handle.setPointerCapture(event.pointerId);
  } catch {
    /* pointer capture is best effort */
  }

  const onMove = (moveEvent: PointerEvent): void => {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    const width = Math.max(
      MIN_RESIZE_WIDTH,
      Math.round(startWidth + (fromLeft ? -dx : dx)),
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
  canvas.innerHTML = "";
  indicator = null;
  canvas.setAttribute("data-viewport", state.currentViewport);

  if (state.sections.length === 0) {
    const empty = document.createElement("div");
    empty.className = "canvas-empty-state";
    empty.innerHTML = `<h3>This page is empty</h3><p>Add your first section or drop in a reusable section.</p>`;
    const actions = document.createElement("div");
    actions.className = "canvas-empty-actions";
    for (const label of ["Blank Section", "Hero Section", "Features Section"]) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = label;
      btn.onclick = () => {
        if (label === "Blank Section") addSectionAt(state.sections.length);
        if (label === "Hero Section")
          addSectionAt(state.sections.length, TEMPLATES[0]);
        if (label === "Features Section")
          addSectionAt(state.sections.length, TEMPLATES[1]);
      };
      actions.appendChild(btn);
    }
    empty.appendChild(actions);
    canvas.appendChild(empty);
    return;
  }

  state.sections.forEach((section, sectionIndex) => {
    canvas.appendChild(buildSectionInsertButton(sectionIndex));

    const sectionShell = document.createElement("div");
    sectionShell.className =
      "canvas-section" +
      (section.id === state.selectedSectionId && !state.selectedId
        ? " selected"
        : "") +
      (section.locked ? " locked" : "");
    applyCanvasBoxStyle(sectionShell, section);
    if (
      section.id === state.selectedSectionId &&
      !state.selectedId &&
      !section.locked
    ) {
      addResizeHandles(
        sectionShell,
        { kind: "section", node: section },
        () => sectionShell,
      );
    }

    const sectionChrome = document.createElement("div");
    sectionChrome.className = "section-chrome";

    const chip = document.createElement("span");
    chip.className = "block-chip";
    chip.textContent = `${sectionIndex + 1}. ${section.label}`;

    const crumbs = document.createElement("span");
    crumbs.className = "block-breadcrumb";
    crumbs.textContent = `${currentPageLabel()} / section`;

    const actions = document.createElement("div");
    actions.className = "block-actions";
    const sectionActions: [string, () => void][] = [
      [
        "Add Block",
        () => openBlockInsertModal(section.children.length, section.id),
      ],
      ["Up", () => moveSection(section.id, -1)],
      ["Down", () => moveSection(section.id, 1)],
      ["Dup", () => duplicateSection(section.id)],
      [section.locked ? "Unlock" : "Lock", () => toggleSectionLock(section.id)],
      ["Delete", () => deleteSection(section.id)],
    ];
    for (const [label, handler] of sectionActions) {
      const btn = document.createElement("button");
      btn.className = "mini-btn";
      btn.textContent = label;
      btn.title = TOOLBAR_TIPS[label] ?? label;
      btn.onclick = (event) => {
        event.stopPropagation();
        handler();
      };
      actions.appendChild(btn);
    }
    sectionChrome.append(chip, crumbs, actions);
    sectionShell.appendChild(sectionChrome);

    const sectionBody = document.createElement("div");
    sectionBody.className = "section-body";
    sectionBody.onclick = (event) => {
      event.stopPropagation();
      state.selectedId = null;
      state.selectedSectionId = section.id;
      renderLayers();
      renderCanvas();
      renderProperties();
    };
    sectionBody.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropSectionId = section.id;
      if (section.children.length === 0) dropIndex = 0;
    });
    sectionBody.addEventListener("drop", (event) => handleDrop(event));

    if (section.children.length === 0) {
      const emptySection = document.createElement("div");
      emptySection.className = "canvas-empty";
      emptySection.innerHTML = `<strong>${section.label}</strong><span>Add blocks here or drop in a reusable section.</span>`;
      sectionBody.appendChild(emptySection);
    }

    section.children.forEach((blockNode, blockIndex) => {
      const block = blockNode as Block;
      sectionBody.appendChild(buildInsertButton(blockIndex, section.id));

      const shell = document.createElement("div");
      shell.className =
        "block" +
        (block.id === state.selectedId ? " selected" : "") +
        (block.type === "html" ? " html-block" : "") +
        (block.locked ? " locked" : "");
      shell.draggable = !block.locked;
      shell.title = blockLabel(block);
      shell.tabIndex = 0;
      shell.setAttribute("role", "button");
      shell.setAttribute(
        "aria-label",
        `${blockLabel(block)} block${block.id === state.selectedId ? ", selected" : ""}`,
      );
      shell.onkeydown = (event) => {
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
      };

      const chrome = document.createElement("div");
      chrome.className = "block-chrome";

      const blockChip = document.createElement("span");
      blockChip.className = "block-chip";
      blockChip.textContent = `${blockIndex + 1}. ${blockLabel(block)}`;

      const blockCrumbs = document.createElement("span");
      blockCrumbs.className = "block-breadcrumb";
      blockCrumbs.textContent = `${currentPageLabel()} / ${section.label} / ${block.type}`;

      const blockActions = document.createElement("div");
      blockActions.className = "block-actions";
      const toolbarActions: [string, () => void][] = [
        ["Up", () => moveBlock(block, -1)],
        ["Down", () => moveBlock(block, 1)],
        ["Dup", () => duplicateSelectedBlock(block)],
        ["Wrap", () => wrapBlockInSection(block)],
        [block.locked ? "Unlock" : "Lock", () => toggleBlockLock(block)],
        ["Delete", () => deleteBlock(block)],
      ];
      for (const [label, handler] of toolbarActions) {
        const btn = document.createElement("button");
        btn.className = "mini-btn";
        btn.textContent = label;
        btn.title = TOOLBAR_TIPS[label] ?? label;
        btn.onclick = (event) => {
          event.stopPropagation();
          handler();
        };
        blockActions.appendChild(btn);
      }
      chrome.append(blockChip, blockCrumbs, blockActions);

      const preview = document.createElement("div");
      preview.className = "block-preview";
      preview.innerHTML = blockToHtml(block, state.currentViewport, true);
      makeCanvasLinksInert(preview);

      shell.onclick = (event) => {
        event.stopPropagation();
        state.selectedId = block.id;
        state.selectedSectionId = section.id;
        renderLayers();
        renderCanvas();
        renderProperties();
      };

      if (TEXT_EDITABLE.includes(block.type) && !block.locked) {
        preview.classList.add("editable-text");
        attachInlineEditors(preview, block);
      }

      shell.addEventListener("dragstart", (event) => {
        if (block.locked) {
          event.preventDefault();
          return;
        }
        event.dataTransfer?.setData("text/zephus-move-block", block.id);
      });
      shell.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropSectionId = section.id;
        const rect = shell.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        dropIndex = after ? blockIndex + 1 : blockIndex;
        showIndicator(sectionBody, shell, after);
      });
      shell.addEventListener("drop", (event) => handleDrop(event));
      shell.append(chrome, preview);
      if (block.id === state.selectedId && !block.locked) {
        addResizeHandles(shell, { kind: "block", node: block }, () => {
          return (preview.firstElementChild as HTMLElement | null) ?? preview;
        });
      }
      sectionBody.appendChild(shell);
    });

    sectionBody.appendChild(
      buildInsertButton(section.children.length, section.id),
    );
    sectionShell.appendChild(sectionBody);
    canvas.appendChild(sectionShell);
  });

  canvas.appendChild(buildSectionInsertButton(state.sections.length));

  hydrateCanvasAssets(canvas);
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
  const targetSection =
    findSection(dropSectionId ?? activeSectionId()) ??
    state.sections[0] ??
    null;
  const target =
    dropIndex < 0 ? (targetSection?.children.length ?? 0) : dropIndex;

  if (templateId) {
    const tpl =
      TEMPLATES.find((t) => t.id === templateId) ??
      resolveSavedSectionTemplate(templateId);
    if (!tpl) return;
    addSectionAt(state.sections.length, tpl);
  } else if (newType) {
    addBlockAt(newType as BlockType, target, targetSection?.id);
  } else if (moveBlockId) {
    const location = findBlockLocation(moveBlockId);
    if (!location || !targetSection || location.block.locked) return;
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
    el.removeAttribute("contenteditable");
    el.removeAttribute("role");
    el.removeAttribute("aria-label");
    el.classList.remove("inline-editing");
    el.removeEventListener("blur", finish);
    el.removeEventListener("keydown", onKeydown);
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
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "Enter" && (!target.multiline || !event.shiftKey)) {
      event.preventDefault();
      finish();
    }
  };
  el.addEventListener("blur", finish);
  el.addEventListener("keydown", onKeydown);
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

function labeledInput(
  key: string,
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "meta-field";
  const label = document.createElement("span");
  label.textContent = key;
  const input = document.createElement("input");
  input.className = "text";
  input.value = value;
  wireInspectorControl(input);
  input.oninput = () => onChange(input.value);
  wrap.append(label, input);
  return wrap;
}

function labeledTextarea(
  key: string,
  value: string,
  onChange: (v: string) => void,
  rows = 4,
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "meta-field";
  const label = document.createElement("span");
  label.textContent = key;
  const input = document.createElement("textarea");
  input.rows = rows;
  input.value = value;
  wireInspectorControl(input);
  input.oninput = () => onChange(input.value);
  wrap.append(label, input);
  return wrap;
}

const LENGTH_UNITS = ["px", "rem", "em", "%", "vh", "vw", "auto", "custom"];

interface ParsedLength {
  num: string;
  unit: string;
  raw?: string;
}

function parseLength(value: string): ParsedLength {
  const t = (value ?? "").trim();
  if (!t) return { num: "", unit: "px" };
  if (t === "auto") return { num: "", unit: "auto" };
  const m = /^(-?\d*\.?\d+)(px|rem|em|%|vh|vw)?$/.exec(t);
  if (m) return { num: m[1] ?? "", unit: m[2] ?? "px" };
  return { num: "", unit: "custom", raw: t };
}

/**
 * Length input: number + unit dropdown (px/rem/%/…), so novices never type raw
 * CSS. Falls back to a free-text "custom" field for compound values like
 * "2rem 0" or calc().
 */
function labeledLength(
  key: string,
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "meta-field";
  const label = document.createElement("span");
  label.textContent = key;

  const control = document.createElement("div");
  control.className = "length-control";

  const num = document.createElement("input");
  num.type = "number";
  num.className = "text length-num";
  num.setAttribute("aria-label", `${key} value`);
  wireInspectorControl(num);

  const unit = document.createElement("select");
  unit.className = "length-unit";
  unit.setAttribute("aria-label", `${key} unit`);
  wireInspectorControl(unit);
  for (const u of LENGTH_UNITS) {
    const o = document.createElement("option");
    o.value = u;
    o.textContent = u;
    unit.appendChild(o);
  }

  const raw = document.createElement("input");
  raw.type = "text";
  raw.className = "text length-raw";
  raw.placeholder = "e.g. 2rem 0";
  raw.setAttribute("aria-label", `${key} custom value`);
  wireInspectorControl(raw);

  const parsed = parseLength(value);
  num.value = parsed.num;
  unit.value = parsed.unit;
  if (parsed.unit === "custom") raw.value = parsed.raw ?? value;

  const emit = (): void => {
    if (unit.value === "auto") onChange("auto");
    else if (unit.value === "custom") onChange(raw.value.trim());
    else onChange(num.value ? `${num.value}${unit.value}` : "");
  };

  const sync = (): void => {
    num.style.display =
      unit.value === "auto" || unit.value === "custom" ? "none" : "";
    raw.style.display = unit.value === "custom" ? "" : "none";
  };

  num.oninput = emit;
  raw.oninput = emit;
  unit.onchange = () => {
    sync();
    emit();
  };
  sync();

  control.append(num, unit, raw);
  wrap.append(label, control);
  return wrap;
}

function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

/** Expands shorthand #abc to #aabbcc so <input type=color> accepts it. */
function expandHex(value: string): string {
  const v = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return (
      "#" +
      v
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")
    );
  }
  return v;
}

/**
 * A color control combining a native swatch picker with a free-text field so
 * users can also enter rgb()/rgba(), CSS variables, named colors, or clear it.
 */
function createColorControl(
  value: string,
  onChange: (v: string) => void = () => {},
): { element: HTMLElement; getValue: () => string } {
  const control = document.createElement("div");
  control.className = "color-control";

  const swatch = document.createElement("input");
  swatch.type = "color";
  swatch.className = "color-swatch";
  swatch.value = isHexColor(value) ? expandHex(value) : "#000000";
  wireInspectorControl(swatch);

  const text = document.createElement("input");
  text.type = "text";
  text.className = "text color-text";
  text.value = value;
  text.placeholder = "#3b82f6, rgb(), var(--accent)…";
  wireInspectorControl(text);

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "color-clear";
  clear.title = "Clear color";
  clear.setAttribute("aria-label", "Clear color");
  clear.textContent = "✕";

  swatch.oninput = () => {
    text.value = swatch.value;
    onChange(swatch.value);
  };
  text.oninput = () => {
    if (isHexColor(text.value)) swatch.value = expandHex(text.value);
    onChange(text.value);
  };
  clear.onclick = () => {
    text.value = "";
    onChange("");
  };

  control.append(swatch, text, clear);
  return { element: control, getValue: () => text.value };
}

function labeledColor(
  key: string,
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "meta-field";
  const label = document.createElement("span");
  label.textContent = key;
  const { element } = createColorControl(value, onChange);
  element.querySelector(".color-text")?.setAttribute("aria-label", key);
  element
    .querySelector(".color-swatch")
    ?.setAttribute("aria-label", `${key} color picker`);
  wrap.append(label, element);
  return wrap;
}

type LinkKind = "page" | "url" | "email" | "phone" | "anchor";

function detectLinkKind(value: string): LinkKind {
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
  wrap.className = "meta-form";

  const typeField = document.createElement("label");
  typeField.className = "meta-field";
  const typeSpan = document.createElement("span");
  typeSpan.textContent = "Link type";
  const typeSelect = document.createElement("select");
  const kinds: [LinkKind, string][] = [
    ["page", "Page in this site"],
    ["url", "External URL"],
    ["email", "Email address"],
    ["phone", "Phone number"],
    ["anchor", "Anchor on this page"],
  ];
  for (const [value, lbl] of kinds) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = lbl;
    typeSelect.appendChild(option);
  }
  typeField.append(typeSpan, typeSelect);

  const pageSelect = document.createElement("select");
  pageSelect.className = "text";
  for (const meta of state.pageMeta) {
    const option = document.createElement("option");
    option.value = meta.route;
    option.textContent = `${meta.title} (${meta.route})`;
    pageSelect.appendChild(option);
  }

  const valueInput = document.createElement("input");
  valueInput.className = "text";

  const valueField = document.createElement("div");

  let kind = detectLinkKind(current);
  typeSelect.value = kind;

  const prefillFor = (k: LinkKind, v: string): string => {
    const t = v.trim();
    if (k === "email") return t.startsWith("mailto:") ? t.slice(7) : "";
    if (k === "phone") return t.startsWith("tel:") ? t.slice(4) : "";
    if (k === "anchor") return t.startsWith("#") ? t.slice(1) : "";
    if (k === "url") return /^(https?:)?\/\//i.test(t) ? t : "";
    return "";
  };

  const renderValue = (): void => {
    valueField.innerHTML = "";
    const row = document.createElement("label");
    row.className = "meta-field";
    const span = document.createElement("span");
    if (kind === "page") {
      span.textContent = "Target page";
      if (state.pageMeta.some((p) => p.route === current)) {
        pageSelect.value = current;
      }
      row.append(span, pageSelect);
    } else {
      span.textContent =
        kind === "url"
          ? "URL"
          : kind === "email"
            ? "Email address"
            : kind === "phone"
              ? "Phone number"
              : "Anchor id";
      valueInput.placeholder =
        kind === "url"
          ? "https://example.com"
          : kind === "email"
            ? "name@example.com"
            : kind === "phone"
              ? "+1 555 123 4567"
              : "section-id";
      valueInput.value = prefillFor(kind, current);
      row.append(span, valueInput);
    }
    valueField.appendChild(row);
  };

  typeSelect.onchange = () => {
    kind = typeSelect.value as LinkKind;
    renderValue();
  };
  renderValue();

  wrap.append(typeField, valueField);

  showModalNode("Choose Link", wrap, [
    { label: "Cancel", kind: "ghost", onClick: closeModal },
    {
      label: "Use Link",
      kind: "primary",
      onClick: () => {
        let href: string;
        const raw = valueInput.value.trim();
        if (kind === "page") href = pageSelect.value || "/";
        else if (kind === "email") href = raw ? `mailto:${raw}` : "";
        else if (kind === "phone") href = raw ? `tel:${raw}` : "";
        else if (kind === "anchor")
          href = raw ? `#${raw.replace(/^#/, "")}` : "";
        else href = raw;
        closeModal();
        onPick(href);
      },
    },
  ]);
}

function labeledLink(
  key: string,
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "meta-field";
  const label = document.createElement("span");
  label.textContent = key;
  const row = document.createElement("div");
  row.className = "link-field";
  const input = document.createElement("input");
  input.className = "text";
  input.value = value;
  input.setAttribute("aria-label", key);
  wireInspectorControl(input);
  input.oninput = () => onChange(input.value);
  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "btn ghost mini-btn";
  pick.textContent = "Choose…";
  pick.onclick = () =>
    openLinkPicker(input.value, (href) => {
      input.value = href;
      onChange(href);
    });
  row.append(input, pick);
  wrap.append(label, row);
  return wrap;
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

function propertyGroup(title: string): HTMLElement {
  const wrap = document.createElement("section");
  wrap.className = "prop-group";
  const heading = document.createElement("h4");
  heading.textContent = title;
  wrap.appendChild(heading);
  return wrap;
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const CATEGORY_ICONS: Record<AssetEntry["category"], string> = {
  images: "image",
  media: "play",
  documents: "file-code",
  other: "file-code",
};

function openAssetBrowser(options: AssetBrowserOptions): void {
  if (!state.project) return;
  const project = state.project;
  const filter = options.filter ?? "all";

  const wrap = document.createElement("div");
  wrap.className = "asset-browser";

  const dropzone = document.createElement("div");
  dropzone.className = "asset-dropzone";
  dropzone.setAttribute("tabindex", "0");
  dropzone.setAttribute("role", "region");
  dropzone.setAttribute("aria-label", "Drop files here to import");
  dropzone.innerHTML =
    "<span>Drag & drop files here, or use Import below</span>";

  const grid = document.createElement("div");
  grid.className = "asset-grid";

  wrap.append(dropzone, grid);

  const renderThumb = async (
    tile: HTMLElement,
    asset: AssetEntry,
  ): Promise<void> => {
    if (asset.category !== "images") return;
    try {
      const res = await window.zephus.readAssetDataUrl(
        project.path,
        project.astro.publicDir,
        asset.webPath,
      );
      if (res.ok && res.dataUrl) {
        const img = document.createElement("img");
        img.src = res.dataUrl;
        img.alt = asset.fileName;
        tile.querySelector(".asset-thumb")?.replaceChildren(img);
      }
    } catch {
      /* leave icon fallback */
    }
  };

  const refresh = async (): Promise<void> => {
    grid.innerHTML = "";
    const result = await window.zephus.listAssets(
      project.path,
      project.astro.publicDir,
    );
    const assets = (result.ok ? result.assets : []).filter(
      (a) => filter === "all" || a.category === filter,
    );
    if (assets.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No assets yet. Import or drop files to get started.";
      grid.appendChild(empty);
      return;
    }
    for (const asset of assets) {
      const tile = document.createElement("button");
      tile.className = "asset-tile";
      tile.title = `${asset.fileName} · ${formatBytes(asset.size)}`;
      const thumb = document.createElement("div");
      thumb.className = "asset-thumb";
      const icon = document.createElement("i");
      icon.setAttribute("data-lucide", CATEGORY_ICONS[asset.category]);
      thumb.appendChild(icon);
      const name = document.createElement("span");
      name.className = "asset-name";
      name.textContent = asset.fileName.split("/").pop() ?? asset.fileName;
      tile.append(thumb, name);
      tile.onclick = () => {
        closeModal();
        options.onSelect(asset.webPath);
      };
      grid.appendChild(tile);
      void renderThumb(tile, asset);
    }
    refreshIcons();
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

  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragover");
  });
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragover");
    const files = Array.from(event.dataTransfer?.files ?? []);
    const paths = files
      .map((file) => {
        try {
          return window.zephus.getDroppedFilePath(file);
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    void handleDropPaths(paths);
  });

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
    const empty = document.createElement("div");
    empty.className = "prop-empty";
    empty.innerHTML = `<p class="muted">Select a section or block to edit its properties.</p>`;
    if (state.page) {
      const pageBtn = document.createElement("button");
      pageBtn.className = "btn";
      pageBtn.textContent = "Page Settings";
      pageBtn.onclick = () => void openPageMetaModal(state.page!);
      empty.appendChild(pageBtn);
    }
    panel.appendChild(empty);
    return;
  }

  if (!block && section) {
    const header = document.createElement("div");
    header.className = "prop-header";
    header.innerHTML = `<strong>${escapeHtml(section.label)}</strong><span class="muted">${currentPageLabel()} / section</span>`;
    panel.appendChild(header);

    const commitSection = (key: string, value: string) => {
      section.props[key] = value;
      if (key === "label") section.label = value || section.label;
      commitInspectorChange(`Updated ${section.label}`);
    };

    const commitSectionStyle = (
      key: keyof BlockStyle,
      value: string | boolean | string[],
    ) => {
      section.style = section.style ?? {};
      (section.style as Record<string, unknown>)[key] = value;
      commitInspectorChange(`Updated ${section.label} style`);
    };

    const contentGroup = propertyGroup("Content");
    contentGroup.appendChild(
      labeledInput("Section label", section.label, (value) => {
        section.label = value.trim() || "Section";
        commitInspectorChange("Renamed section");
      }),
    );
    const wrapper = document.createElement("label");
    wrapper.className = "meta-field";
    const wrapperLabel = document.createElement("span");
    wrapperLabel.textContent = "Wrapper";
    const wrapperSelect = document.createElement("select");
    wireInspectorControl(wrapperSelect);
    for (const value of ["none", "box"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.selected = (section.props["wrapper"] ?? "none") === value;
      wrapperSelect.appendChild(option);
    }
    wrapperSelect.onchange = () =>
      commitSection("wrapper", wrapperSelect.value);
    wrapper.append(wrapperLabel, wrapperSelect);
    contentGroup.appendChild(wrapper);
    contentGroup.appendChild(
      labeledInput("CSS class", section.props["cls"] ?? "", (value) =>
        commitSection("cls", value),
      ),
    );
    panel.appendChild(contentGroup);

    const layoutGroup = propertyGroup("Layout");
    layoutGroup.appendChild(
      labeledLength("Width", section.style?.width ?? "", (value) =>
        commitSectionStyle("width", value),
      ),
    );
    layoutGroup.appendChild(
      labeledLength("Height", section.style?.height ?? "", (value) =>
        commitSectionStyle("height", value),
      ),
    );
    layoutGroup.appendChild(
      labeledLength("Padding", section.style?.padding ?? "", (value) =>
        commitSectionStyle("padding", value),
      ),
    );
    layoutGroup.appendChild(
      labeledLength("Margin", section.style?.margin ?? "", (value) =>
        commitSectionStyle("margin", value),
      ),
    );
    layoutGroup.appendChild(
      labeledLength("Max width", section.style?.maxWidth ?? "", (value) =>
        commitSectionStyle("maxWidth", value),
      ),
    );
    layoutGroup.appendChild(
      labeledLength("Gap", section.style?.gap ?? "", (value) =>
        commitSectionStyle("gap", value),
      ),
    );
    panel.appendChild(layoutGroup);

    const styleGroup = propertyGroup("Style");
    styleGroup.appendChild(
      labeledColor("Background", section.style?.background ?? "", (value) =>
        commitSectionStyle("background", value),
      ),
    );
    styleGroup.appendChild(
      labeledColor("Text color", section.style?.color ?? "", (value) =>
        commitSectionStyle("color", value),
      ),
    );
    styleGroup.appendChild(
      labeledLength("Radius", section.style?.radius ?? "", (value) =>
        commitSectionStyle("radius", value),
      ),
    );
    panel.appendChild(styleGroup);

    const actions = document.createElement("div");
    actions.className = "prop-actions";
    for (const [label, handler, kind] of [
      [
        "Add Block",
        () => openBlockInsertModal(section.children.length, section.id),
        "",
      ],
      ["Duplicate", () => duplicateSection(section.id), ""],
      ["Move Up", () => moveSection(section.id, -1), ""],
      ["Move Down", () => moveSection(section.id, 1), ""],
      [
        section.locked ? "Unlock" : "Lock",
        () => toggleSectionLock(section.id),
        "",
      ],
      ["Delete", () => deleteSection(section.id), "danger"],
    ] as [string, () => void, string][]) {
      const btn = document.createElement("button");
      btn.className = `btn ${kind}`.trim();
      btn.textContent = label;
      btn.onclick = handler;
      actions.appendChild(btn);
    }
    panel.appendChild(actions);
    return;
  }

  if (!block) return;

  const header = document.createElement("div");
  header.className = "prop-header";
  header.innerHTML = `<strong>${blockLabel(block)}</strong><span class="muted">${currentPageLabel()} / ${section?.label ?? "section"} / ${block.type}</span>`;
  panel.appendChild(header);

  const commit = (key: string, value: string) => {
    block.props[key] = value;
    commitInspectorChange(`Updated ${block.type} ${key}`);
  };

  const commitStyle = (
    key: keyof BlockStyle,
    value: string | boolean | string[],
  ) => {
    block.style = block.style ?? {};
    (block.style as Record<string, unknown>)[key] = value;
    commitInspectorChange(`Updated ${block.type} style`);
  };

  const contentGroup = propertyGroup("Content");
  if (block.type === "html") {
    const copy = document.createElement("p");
    copy.className = "muted";
    copy.textContent =
      "Raw HTML / structural block. Edit the markup in Code mode.";
    contentGroup.appendChild(copy);
  } else if (block.type === "heading") {
    contentGroup.appendChild(
      labeledInput("Text", block.props["text"] ?? "", (v) => commit("text", v)),
    );
    const wrap = document.createElement("label");
    wrap.className = "meta-field";
    const label = document.createElement("span");
    label.textContent = "Heading level";
    const select = document.createElement("select");
    wireInspectorControl(select);
    for (let i = 1; i <= editorRules.maxHeadingLevel; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = "H" + i;
      if (String(i) === (block.props["level"] ?? "2")) opt.selected = true;
      select.appendChild(opt);
    }
    select.onchange = () => commit("level", select.value);
    wrap.append(label, select);
    contentGroup.appendChild(wrap);
  } else if (
    block.type === "text" ||
    block.type === "section" ||
    block.type === "quote"
  ) {
    contentGroup.appendChild(
      labeledTextarea("Text", block.props["text"] ?? "", (v) =>
        commit("text", v),
      ),
    );
    if (block.type === "quote") {
      contentGroup.appendChild(
        labeledInput("Citation", block.props["cite"] ?? "", (v) =>
          commit("cite", v),
        ),
      );
    }
  } else if (block.type === "button") {
    contentGroup.appendChild(
      labeledInput("Label", block.props["text"] ?? "", (v) =>
        commit("text", v),
      ),
    );
    contentGroup.appendChild(
      labeledLink("Link", block.props["href"] ?? "", (v) => commit("href", v)),
    );
    const variant = document.createElement("label");
    variant.className = "meta-field";
    const variantLabel = document.createElement("span");
    variantLabel.textContent = "Button style";
    const variantSelect = document.createElement("select");
    wireInspectorControl(variantSelect);
    const currentVariant = /\bsecondary\b/.test(block.props["cls"] ?? "")
      ? "secondary"
      : "primary";
    for (const [value, text] of [
      ["primary", "Primary (filled)"],
      ["secondary", "Secondary (outline)"],
    ] as const) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      if (value === currentVariant) opt.selected = true;
      variantSelect.appendChild(opt);
    }
    variantSelect.onchange = () => {
      const rest = (block.props["cls"] ?? "")
        .split(/\s+/)
        .filter((c) => c && c !== "secondary")
        .join(" ");
      const next =
        variantSelect.value === "secondary" ? `${rest} secondary`.trim() : rest;
      commit("cls", next);
    };
    variant.append(variantLabel, variantSelect);
    contentGroup.appendChild(variant);
  } else if (block.type === "image") {
    const imageRow = document.createElement("div");
    imageRow.className = "prop-actions";
    const browse = document.createElement("button");
    browse.className = "btn";
    browse.textContent = block.props["src"] ? "Replace Image" : "Choose Image";
    browse.onclick = () => void chooseAssetForImage(block);
    const remove = document.createElement("button");
    remove.className = "btn ghost";
    remove.textContent = "Remove";
    remove.onclick = () => commit("src", "");
    imageRow.append(browse, remove);
    contentGroup.appendChild(imageRow);
    contentGroup.appendChild(
      labeledInput("Image path", block.props["src"] ?? "", (v) =>
        commit("src", v),
      ),
    );
    contentGroup.appendChild(
      labeledInput("Alt text", block.props["alt"] ?? "", (v) =>
        commit("alt", v),
      ),
    );
  } else if (block.type === "columns") {
    const count = document.createElement("label");
    count.className = "meta-field";
    const countLabel = document.createElement("span");
    countLabel.textContent = "Columns";
    const select = document.createElement("select");
    wireInspectorControl(select);
    for (const value of ["2", "3", "4"]) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = value;
      if (value === (block.style?.columns ?? block.props["count"] ?? "2")) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }
    select.onchange = () => {
      block.props["count"] = select.value;
      block.style = block.style ?? {};
      block.style.columns = select.value;
      commitInspectorChange(`Updated ${block.type} columns`, true);
    };
    count.append(countLabel, select);
    contentGroup.appendChild(count);
    const total = Number(block.style?.columns ?? block.props["count"] ?? 2);
    for (let i = 1; i <= total; i++) {
      contentGroup.appendChild(
        labeledTextarea(
          `Column ${i}`,
          block.props[`col${i}`] ?? "",
          (v) => commit(`col${i}`, v),
          3,
        ),
      );
    }
  } else if (block.type === "card") {
    contentGroup.appendChild(
      labeledInput("Title", block.props["title"] ?? "", (v) =>
        commit("title", v),
      ),
    );
    contentGroup.appendChild(
      labeledTextarea("Body", block.props["text"] ?? "", (v) =>
        commit("text", v),
      ),
    );
  } else if (block.type === "gallery") {
    const galleryRow = document.createElement("div");
    galleryRow.className = "prop-actions";
    const addImg = document.createElement("button");
    addImg.className = "btn";
    addImg.textContent = "Add Image from Assets";
    addImg.onclick = () =>
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
      });
    galleryRow.appendChild(addImg);
    contentGroup.appendChild(galleryRow);
    contentGroup.appendChild(
      labeledTextarea("Image paths", block.props["images"] ?? "", (v) =>
        commit("images", v),
      ),
    );
  } else if (block.type === "list") {
    contentGroup.appendChild(
      labeledTextarea("Items", block.props["items"] ?? "", (v) =>
        commit("items", v),
      ),
    );
    const ordered = document.createElement("label");
    ordered.className = "meta-field";
    const orderedSpan = document.createElement("span");
    orderedSpan.textContent = "Ordered list";
    const orderedInput = document.createElement("input");
    orderedInput.type = "checkbox";
    wireInspectorControl(orderedInput);
    orderedInput.checked = block.props["ordered"] === "true";
    orderedInput.onchange = () =>
      commit("ordered", orderedInput.checked ? "true" : "false");
    ordered.append(orderedSpan, orderedInput);
    contentGroup.appendChild(ordered);
  } else if (block.type === "embed") {
    contentGroup.appendChild(
      labeledInput("Embed URL", block.props["src"] ?? "", (v) =>
        commit("src", v),
      ),
    );
    contentGroup.appendChild(
      labeledInput("Title", block.props["title"] ?? "", (v) =>
        commit("title", v),
      ),
    );
  } else if (block.type === "spacer") {
    contentGroup.appendChild(
      labeledInput("Height", block.props["height"] ?? "48px", (v) =>
        commit("height", v),
      ),
    );
  } else if (block.type === "feature") {
    contentGroup.appendChild(
      labeledInput("Icon (emoji or text)", block.props["icon"] ?? "", (v) =>
        commit("icon", v),
      ),
    );
    contentGroup.appendChild(
      labeledInput("Title", block.props["title"] ?? "", (v) =>
        commit("title", v),
      ),
    );
    contentGroup.appendChild(
      labeledTextarea("Description", block.props["text"] ?? "", (v) =>
        commit("text", v),
      ),
    );
  } else if (block.type === "testimonial") {
    contentGroup.appendChild(
      labeledTextarea("Quote", block.props["quote"] ?? "", (v) =>
        commit("quote", v),
      ),
    );
    contentGroup.appendChild(
      labeledInput("Author", block.props["author"] ?? "", (v) =>
        commit("author", v),
      ),
    );
    contentGroup.appendChild(
      labeledInput("Role / company", block.props["role"] ?? "", (v) =>
        commit("role", v),
      ),
    );
  } else if (block.type === "accordion") {
    contentGroup.appendChild(
      labeledTextarea(
        "Items (one per line: Question :: Answer)",
        block.props["items"] ?? "",
        (v) => commit("items", v),
        6,
      ),
    );
  } else if (block.type === "stats") {
    contentGroup.appendChild(
      labeledTextarea(
        "Stats (one per line: Number :: Label)",
        block.props["items"] ?? "",
        (v) => commit("items", v),
        5,
      ),
    );
  } else if (block.type === "pricing") {
    contentGroup.appendChild(
      labeledInput("Plan name", block.props["plan"] ?? "", (v) =>
        commit("plan", v),
      ),
    );
    contentGroup.appendChild(
      labeledInput("Price", block.props["price"] ?? "", (v) =>
        commit("price", v),
      ),
    );
    contentGroup.appendChild(
      labeledInput("Period (e.g. /mo)", block.props["period"] ?? "", (v) =>
        commit("period", v),
      ),
    );
    contentGroup.appendChild(
      labeledTextarea(
        "Features (one per line)",
        block.props["features"] ?? "",
        (v) => commit("features", v),
      ),
    );
    contentGroup.appendChild(
      labeledInput("Button label", block.props["ctaText"] ?? "", (v) =>
        commit("ctaText", v),
      ),
    );
    contentGroup.appendChild(
      labeledLink("Button link", block.props["ctaHref"] ?? "", (v) =>
        commit("ctaHref", v),
      ),
    );
  } else if (block.type === "cta") {
    contentGroup.appendChild(
      labeledInput("Heading", block.props["heading"] ?? "", (v) =>
        commit("heading", v),
      ),
    );
    contentGroup.appendChild(
      labeledTextarea("Text", block.props["text"] ?? "", (v) =>
        commit("text", v),
      ),
    );
    contentGroup.appendChild(
      labeledInput("Button label", block.props["buttonText"] ?? "", (v) =>
        commit("buttonText", v),
      ),
    );
    contentGroup.appendChild(
      labeledLink("Button link", block.props["buttonHref"] ?? "", (v) =>
        commit("buttonHref", v),
      ),
    );
  }
  panel.appendChild(contentGroup);

  const layoutGroup = propertyGroup("Layout");
  const align = document.createElement("label");
  align.className = "meta-field";
  const alignLabel = document.createElement("span");
  alignLabel.textContent = "Alignment";
  const alignSelect = document.createElement("select");
  wireInspectorControl(alignSelect);
  for (const value of ["left", "center", "right"] as const) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    if (value === (block.style?.align ?? "left")) opt.selected = true;
    alignSelect.appendChild(opt);
  }
  alignSelect.onchange = () => commitStyle("align", alignSelect.value);
  align.append(alignLabel, alignSelect);
  layoutGroup.appendChild(align);
  layoutGroup.appendChild(
    labeledLength("Width", block.style?.width ?? "", (v) =>
      commitStyle("width", v),
    ),
  );
  layoutGroup.appendChild(
    labeledLength("Height", block.style?.height ?? "", (v) =>
      commitStyle("height", v),
    ),
  );
  layoutGroup.appendChild(
    labeledLength("Max width", block.style?.maxWidth ?? "", (v) =>
      commitStyle("maxWidth", v),
    ),
  );
  layoutGroup.appendChild(
    labeledLength("Gap", block.style?.gap ?? "", (v) => commitStyle("gap", v)),
  );
  if (block.type === "columns" || block.type === "gallery") {
    layoutGroup.appendChild(
      labeledInput("Columns", block.style?.columns ?? "", (v) =>
        commitStyle("columns", v),
      ),
    );
  }
  const stack = document.createElement("label");
  stack.className = "meta-field";
  const stackLabel = document.createElement("span");
  stackLabel.textContent = "Stack on mobile";
  const stackInput = document.createElement("input");
  stackInput.type = "checkbox";
  wireInspectorControl(stackInput);
  stackInput.checked = block.style?.stackOnMobile ?? false;
  stackInput.onchange = () => commitStyle("stackOnMobile", stackInput.checked);
  stack.append(stackLabel, stackInput);
  layoutGroup.appendChild(stack);
  panel.appendChild(layoutGroup);

  const styleGroup = propertyGroup("Style");
  styleGroup.appendChild(
    labeledColor("Background", block.style?.background ?? "", (v) =>
      commitStyle("background", v),
    ),
  );
  styleGroup.appendChild(
    labeledColor("Text color", block.style?.color ?? "", (v) =>
      commitStyle("color", v),
    ),
  );
  styleGroup.appendChild(
    labeledLength("Padding", block.style?.padding ?? "", (v) =>
      commitStyle("padding", v),
    ),
  );
  styleGroup.appendChild(
    labeledLength("Margin", block.style?.margin ?? "", (v) =>
      commitStyle("margin", v),
    ),
  );
  styleGroup.appendChild(
    labeledLength("Radius", block.style?.radius ?? "", (v) =>
      commitStyle("radius", v),
    ),
  );
  const shadow = document.createElement("label");
  shadow.className = "meta-field";
  const shadowLabel = document.createElement("span");
  shadowLabel.textContent = "Shadow";
  const shadowSelect = document.createElement("select");
  wireInspectorControl(shadowSelect);
  for (const value of ["none", "sm", "md", "lg"] as const) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    if (value === (block.style?.shadow ?? "none")) opt.selected = true;
    shadowSelect.appendChild(opt);
  }
  shadowSelect.onchange = () => commitStyle("shadow", shadowSelect.value);
  shadow.append(shadowLabel, shadowSelect);
  styleGroup.appendChild(shadow);
  panel.appendChild(styleGroup);

  const advancedGroup = propertyGroup("Advanced");
  advancedGroup.appendChild(
    labeledInput("CSS class", block.props["cls"] ?? "", (v) =>
      commit("cls", v),
    ),
  );
  if (state.currentViewport !== "desktop") {
    const responsive = document.createElement("div");
    responsive.className = "responsive-note";
    responsive.innerHTML = `<strong>${state.currentViewport}</strong> override`;
    advancedGroup.appendChild(responsive);
    const currentResponsive =
      block.style?.responsive?.[state.currentViewport] ?? {};
    const commitResponsiveStyle = (
      key: "width" | "height" | "padding" | "margin",
      value: string,
    ): void => {
      block.style = block.style ?? {};
      block.style.responsive = block.style.responsive ?? {};
      block.style.responsive[state.currentViewport] = {
        ...block.style.responsive[state.currentViewport],
        [key]: value,
      };
      commitInspectorChange(`Updated ${state.currentViewport} override`);
    };
    advancedGroup.appendChild(
      labeledLength("Viewport width", currentResponsive.width ?? "", (v) =>
        commitResponsiveStyle("width", v),
      ),
    );
    advancedGroup.appendChild(
      labeledLength("Viewport height", currentResponsive.height ?? "", (v) =>
        commitResponsiveStyle("height", v),
      ),
    );
    advancedGroup.appendChild(
      labeledLength("Viewport padding", currentResponsive.padding ?? "", (v) =>
        commitResponsiveStyle("padding", v),
      ),
    );
    advancedGroup.appendChild(
      labeledLength("Viewport margin", currentResponsive.margin ?? "", (v) =>
        commitResponsiveStyle("margin", v),
      ),
    );
  }
  if (
    block.type === "section" ||
    block.type === "card" ||
    block.type === "html"
  ) {
    const saveSection = document.createElement("button");
    saveSection.className = "btn";
    saveSection.textContent = "Save as Reusable Section";
    saveSection.onclick = async () => {
      const label = prompt("Reusable section name");
      if (!label) return;
      const result = await window.zephus.saveReusableSection(
        label,
        blockToHtml(block, "desktop"),
      );
      if (!result.ok) {
        setStatus(
          "Could not save reusable section: " + (result.error ?? "unknown"),
        );
        return;
      }
      setStatus(`Saved reusable section "${label}".`);
      renderTemplates();
    };
    advancedGroup.appendChild(saveSection);
  }
  panel.appendChild(advancedGroup);

  const actionRow = document.createElement("div");
  actionRow.className = "prop-actions";
  const actionButtons: [string, () => void, string?][] = [
    ["Duplicate", () => duplicateSelectedBlock(block)],
    ["Move Up", () => moveBlock(block, -1)],
    ["Move Down", () => moveBlock(block, 1)],
    ["Wrap", () => wrapBlockInSection(block)],
    [block.locked ? "Unlock" : "Lock", () => toggleBlockLock(block)],
    ["Delete", () => deleteBlock(block), "danger"],
  ];
  for (const [label, handler, extraClass] of actionButtons) {
    const btn = document.createElement("button");
    btn.className = `btn ${extraClass ?? ""}`.trim();
    btn.textContent = label;
    btn.onclick = handler;
    actionRow.appendChild(btn);
  }
  panel.appendChild(actionRow);
}

/* ---------- Mode switching ---------- */

function setMode(mode: Mode): void {
  if (mode === "visual" && !state.visualEditable) {
    showModal(
      "Visual Mode Unavailable",
      state.managedStatus === "out-of-sync"
        ? "This page was edited outside Zephus. Review it in Code mode, then reattach it from Page Settings to resume GUI editing."
        : "This page was detached from visual mode after a structural code edit. Reattach it from Page Settings to resume GUI editing.",
      [{ label: "OK", kind: "primary", onClick: closeModal }],
    );
    return;
  }
  state.mode = mode;
  $("mode-visual").classList.toggle("active", mode === "visual");
  $("mode-code").classList.toggle("active", mode === "code");
  const codeEl = $("code-editor");

  if (mode === "code") {
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
  } else {
    const codeVal = getCode();
    if (codeVal !== state.rawCode) {
      if (state.managedStatus !== "detached") {
        showModal(
          "Save Code Changes First",
          "Managed pages cannot safely round-trip structural Astro edits back into visual mode. Save to detach this page, or discard your code changes first.",
          [{ label: "OK", kind: "primary", onClick: closeModal }],
        );
        return;
      }
      state.rawCode = codeVal;
      parsePage(state.rawCode);
      markDirty(true);
    }
    $("canvas").classList.remove("hidden");
    codeEl.classList.add("hidden");
    $("preview-frame").classList.add("hidden");
    renderCanvas();
    renderProperties();
  }
}

/* ---------- Save ---------- */

async function performSave(): Promise<boolean> {
  if (!state.project) {
    setStatus("No project open to save.");
    return false;
  }
  if (state.draftTimer !== null) {
    window.clearTimeout(state.draftTimer);
    state.draftTimer = null;
  }
  let savedPage = false;
  let savedSite = false;

  if (state.pageDirty) {
    if (!state.page) {
      setStatus("No page open to save.");
      return false;
    }
    const content = state.mode === "code" ? getCode() : serializeBlocks();
    if (state.mode === "code") {
      if (state.managedStatus === "detached") {
        const detached = await window.zephus.detachPageDocument(
          state.project.path,
          state.page,
          state.project.astro.pagesDir,
          content,
        );
        if (!detached.ok || !detached.pageDocument) {
          setStatus("Save failed: " + (detached.error ?? "unknown"));
          return false;
        }
        state.pageDocument = detached.pageDocument;
        state.siteDocument = detached.site;
        state.managedStatus = detached.pageDocument.managedFileStatus;
        state.visualEditable = false;
        state.generatedCode =
          detached.generatedSource ?? detached.source ?? content;
        state.rawCode = content;
      } else if (state.managedStatus === "out-of-sync") {
        const detached = await window.zephus.detachPageDocument(
          state.project.path,
          state.page,
          state.project.astro.pagesDir,
          content,
        );
        if (!detached.ok || !detached.pageDocument) {
          setStatus("Save failed: " + (detached.error ?? "unknown"));
          return false;
        }
        state.pageDocument = detached.pageDocument;
        state.siteDocument = detached.site;
        state.managedStatus = detached.pageDocument.managedFileStatus;
        state.visualEditable = false;
        state.generatedCode =
          detached.generatedSource ?? detached.source ?? content;
        state.rawCode = content;
        setStatus(
          "Page saved as hand-authored Astro. Reattach when you want visual editing again.",
        );
      } else {
        const visualDoc = pageDocumentFromState();
        if (!visualDoc) {
          setStatus("Save failed: missing page document.");
          return false;
        }
        const generated = await window.zephus.writePageDocument(
          state.project.path,
          state.project.astro.pagesDir,
          visualDoc,
        );
        if (!generated.ok || !generated.pageDocument) {
          setStatus("Save failed: " + (generated.error ?? "unknown"));
          return false;
        }
        const normalizedGenerated = generated.source ?? "";
        if (content !== normalizedGenerated) {
          const detached = await window.zephus.detachPageDocument(
            state.project.path,
            state.page,
            state.project.astro.pagesDir,
            content,
          );
          if (!detached.ok || !detached.pageDocument) {
            setStatus("Detach failed: " + (detached.error ?? "unknown"));
            return false;
          }
          state.pageDocument = detached.pageDocument;
          state.siteDocument = detached.site;
          state.managedStatus = detached.pageDocument.managedFileStatus;
          state.visualEditable = false;
          state.generatedCode = normalizedGenerated;
          state.rawCode = content;
          setStatus(
            "Page detached from visual mode and saved as hand-authored Astro.",
          );
        } else {
          state.pageDocument = generated.pageDocument;
          state.siteDocument = generated.site;
          state.managedStatus = generated.pageDocument.managedFileStatus;
          state.visualEditable = true;
          state.generatedCode = normalizedGenerated;
          state.rawCode = normalizedGenerated;
        }
      }
    } else {
      const doc = pageDocumentFromState();
      if (!doc) {
        setStatus("Save failed: missing page document.");
        return false;
      }
      const saved = await window.zephus.writePageDocument(
        state.project.path,
        state.project.astro.pagesDir,
        doc,
      );
      if (!saved.ok || !saved.pageDocument) {
        setStatus("Save failed: " + (saved.error ?? "unknown"));
        return false;
      }
      state.pageDocument = saved.pageDocument;
      state.siteDocument = saved.site;
      state.managedStatus = saved.pageDocument.managedFileStatus;
      state.visualEditable = true;
      state.generatedCode = saved.generatedSource ?? saved.source ?? content;
      state.rawCode = state.generatedCode;
    }
    syncVisualModeState();
    if (state.mode === "code" && state.visualEditable) {
      const currentDoc = pageDocumentFromState();
      if (currentDoc) {
        state.sections = sectionsFromPageDocument(currentDoc);
        syncBlocksFromSections();
      }
    }
    await window.zephus.clearDraft(state.project.path, "page", state.page);
    clearChanges();
    markDirty(false);
    savedPage = true;
  }

  if (state.siteDirty) {
    const saved = await persistPendingSiteDocument();
    if (!saved) return false;
    savedSite = true;
  }

  renderDirtyIndicators();
  if (savedPage && savedSite) {
    setStatus(`Saved ${state.page ?? "page"} and site settings.`);
  } else if (savedPage) {
    setStatus("Saved " + state.page);
  } else if (savedSite) {
    setStatus("Saved site settings.");
  } else {
    setStatus("Nothing to save.");
  }
  void refreshGit();
  await reloadPages();
  return true;
}

async function save(): Promise<void> {
  if (!isGlobalDirty(state)) {
    await performSave();
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "save-summary";
  wrap.appendChild(buildUnsavedWorkSummary());
  showModalNode("Save Changes", wrap, [
    { label: "Cancel", kind: "ghost", onClick: closeModal },
    {
      label: "Save",
      kind: "primary",
      onClick: async () => {
        closeModal();
        await performSave();
      },
    },
  ]);
}

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
    logEl.textContent += chunk;
    logEl.scrollTop = logEl.scrollHeight;
  });

  return new Promise<boolean>((resolve) => {
    let done = false;
    showModalNode("Setting Up Your Site", wrap, [
      {
        label: "Run in Background",
        kind: "ghost",
        onClick: () => {
          if (!done) {
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

async function togglePreview(): Promise<void> {
  if (!state.project) return;
  const frame = $("preview-frame") as HTMLIFrameElement;

  if (state.previewUrl) {
    await window.zephus.stopPreview();
    state.previewUrl = null;
    state.unsubLog?.();
    frame.removeAttribute("sandbox");
    frame.removeAttribute("src");
    frame.classList.add("hidden");
    $("btn-preview").innerHTML = `<i data-lucide="play"></i> Start Preview`;
    refreshIcons();
    setMode(state.mode);
    refreshGuidancePanels();
    setStatus("Preview stopped.");
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
    logEl.textContent += chunk;
    logEl.scrollTop = logEl.scrollHeight;
  });
  const result = await window.zephus.startPreview(state.project.path);
  if (!result.ok || !result.url) {
    setStatus("Preview failed: " + friendlyError(result.error));
    state.unsubLog?.();
    state.unsubLog = null;
    return;
  }
  state.previewUrl = result.url;
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  frame.src = result.url;
  frame.classList.remove("hidden");
  $("canvas").classList.add("hidden");
  $("code-editor").classList.add("hidden");
  $("btn-preview").innerHTML = `<i data-lucide="square"></i> Stop Preview`;
  refreshIcons();
  refreshGuidancePanels();
  setStatus("Preview running at " + result.url);
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
  pubWrap.className = "publish-done";
  pubWrap.innerHTML = `
    <p>Your site was built into the <strong>${escapeHtml(r.outputDir ?? state.project.astro.outDir)}</strong> folder (now open in your file manager).</p>
    <p>To put it online, upload that folder to a free static host:</p>
    <ul class="publish-hosts">
      <li><a href="https://app.netlify.com/drop">Netlify Drop</a> — drag the folder onto the page, done.</li>
      <li><a href="https://pages.cloudflare.com">Cloudflare Pages</a> — connect or upload.</li>
      <li><a href="https://pages.github.com">GitHub Pages</a> — if your project is on GitHub.</li>
    </ul>
    <p class="muted">Tip: Netlify Drop is the easiest — no account needed to start.</p>
  `;
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
    await window.zephus.stopPreview();
    state.previewUrl = null;
    state.unsubLog?.();
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
  if (state.draftTimer !== null) {
    window.clearTimeout(state.draftTimer);
    state.draftTimer = null;
  }
  clearChanges();
  clearSiteChanges(state);
  markSiteDirty(state, false);
  markDirty(false);
  $("view-editor").classList.add("hidden");
  $("view-start").classList.remove("hidden");
  renderLayers();
  renderProjectOverview();
  renderNextActions();
  await refreshHomeDraftSummaries();
  renderThemePlaceholder();
  await renderRecent();
  setStatus("");
}

/* ---------- Undo / redo ---------- */

function doUndo(): void {
  const prev = state.undo.pop();
  if (prev) {
    state.redo.push(cloneSections(state.sections));
    state.sections = cloneSections(prev);
    syncBlocksFromSections();
    syncSelectionState();
    trackChange("Undid a visual change");
    markDirty(true);
    renderLayers();
    renderCanvas();
    renderProperties();
  }
}

function doRedo(): void {
  const next = state.redo.pop();
  if (next) {
    state.undo.push(cloneSections(state.sections));
    state.sections = cloneSections(next);
    syncBlocksFromSections();
    syncSelectionState();
    trackChange("Redid a visual change");
    markDirty(true);
    renderLayers();
    renderCanvas();
    renderProperties();
  }
}

function onKeydown(e: KeyboardEvent): void {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === "s") {
    void save();
    e.preventDefault();
    return;
  }
  if (state.mode !== "visual") return;
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
    }
  } else if (e.key === "Delete" || e.key === "Backspace") {
    // Only when not editing text in an input/textarea/contenteditable.
    const active = document.activeElement as HTMLElement | null;
    const editing =
      active &&
      (active.isContentEditable ||
        active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT");
    if (editing) return;
    const block = findSelectedBlock();
    if (block && !block.locked) {
      void deleteBlock(block);
      e.preventDefault();
    }
  }
}

/* ---------- Start view tabs and theme picker ---------- */

/* ---------- Start view tabs and theme picker ---------- */

function initStartTabs(): void {
  const tabRecent = $("tab-recent");
  const tabCreate = $("tab-create");
  const tabSettings = $("tab-settings");
  const tabAbout = $("tab-about");

  if (tabRecent) tabRecent.onclick = () => void switchStartTab("recent");
  if (tabCreate) tabCreate.onclick = () => void switchStartTab("create");
  if (tabSettings) tabSettings.onclick = () => void switchStartTab("settings");
  if (tabAbout) tabAbout.onclick = () => void switchStartTab("about");
}

async function switchStartTab(
  target: "recent" | "create" | "settings" | "about",
): Promise<void> {
  const tabs = ["recent", "create", "settings", "about"] as const;
  for (const t of tabs) {
    const tabBtn = $("tab-" + t);
    const pane = $("pane-" + t);
    if (tabBtn) tabBtn.classList.toggle("active", t === target);
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
  const container = $("theme-list-container");
  if (container) {
    for (const card of Array.from(
      container.querySelectorAll<HTMLElement>(".theme-card"),
    )) {
      const selected = card.dataset.themeId === themeId;
      card.classList.toggle("selected", selected);
      const label = card.querySelector<HTMLElement>(".theme-select-btn");
      if (label) {
        label.textContent = selected ? "Selected" : "Select";
      }
    }
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
  wrap.className = "theme-preview-modal";

  const meta = document.createElement("div");
  meta.className = "theme-preview-meta";
  const kicker = document.createElement("p");
  kicker.className = "theme-preview-kicker";
  kicker.textContent = "Read-only preview";
  const description = document.createElement("p");
  description.className = "theme-preview-description";
  description.textContent = theme.description;
  meta.append(kicker, description);

  const frameWrap = document.createElement("div");
  frameWrap.className = "theme-preview-modal-frame";

  const frame = document.createElement("iframe");
  frame.className = "theme-preview-modal-iframe";
  frame.src = previewUrl;
  frame.sandbox.add("allow-same-origin");
  frame.sandbox.add("allow-scripts");
  frame.title = `${theme.name} preview`;
  frameWrap.appendChild(frame);

  wrap.append(meta, frameWrap);

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

function buildThemeCard(
  theme: ThemeMeta,
  previewBase: string | null,
): HTMLElement {
  const card = document.createElement("article");
  card.className = "theme-card";
  card.dataset.themeId = theme.id;
  card.tabIndex = 0;
  if (selectedTabTheme === theme.id) {
    card.classList.add("selected");
  }

  const details = getThemeHeaderDetails(theme.id);
  const header = document.createElement("div");
  header.className = "theme-card-icon-header";

  if (previewBase) {
    const previewUrl = new URL(theme.previewPath, previewBase).toString();
    header.classList.add("has-preview");
    const frame = document.createElement("iframe");
    frame.className = "theme-card-preview-frame";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.setAttribute("title", `${theme.name} preview`);
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.src = previewUrl;
    header.appendChild(frame);
  } else {
    header.style.background = details.gradient;
    header.innerHTML = `
      <div class="theme-card-icon-pill">
        <i data-lucide="${details.icon}"></i>
      </div>
    `;
  }

  const body = document.createElement("div");
  body.className = "theme-card-body";
  const name = document.createElement("span");
  name.className = "t-name";
  name.textContent = theme.name;
  const desc = document.createElement("span");
  desc.className = "t-desc";
  desc.textContent = theme.description;
  body.append(name, desc);

  const actions = document.createElement("div");
  actions.className = "theme-card-actions";

  const previewBtn = document.createElement("button");
  previewBtn.className = "mini-btn";
  previewBtn.textContent = "Preview";
  previewBtn.onclick = (event) => {
    event.stopPropagation();
    openThemePreviewModal(theme);
  };

  const selectBtn = document.createElement("button");
  selectBtn.className = "mini-btn theme-select-btn";
  selectBtn.textContent = selectedTabTheme === theme.id ? "Selected" : "Select";
  selectBtn.onclick = (event) => {
    event.stopPropagation();
    selectThemeCard(theme.id);
  };

  actions.append(previewBtn, selectBtn);
  card.append(header, body, actions);

  card.onclick = () => selectThemeCard(theme.id);
  card.ondblclick = () => {
    selectThemeCard(theme.id);
    void createSiteFromTabFlow();
  };
  card.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectThemeCard(theme.id);
    }
  };

  return card;
}

async function renderThemesInTab(): Promise<void> {
  const container = $("theme-list-container");
  if (!container) return;
  container.innerHTML = `<p class="muted">Loading theme previews…</p>`;

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

    container.innerHTML = "";
    for (const theme of startThemes) {
      const card = buildThemeCard(theme, themePreviewBaseUrl);
      container.appendChild(card);
      // Scale the live preview iframe to fit the card header.
      const frame = card.querySelector<HTMLIFrameElement>(
        ".theme-card-preview-frame",
      );
      const headerEl = card.querySelector<HTMLElement>(
        ".theme-card-icon-header",
      );
      if (frame && headerEl) {
        const scale = headerEl.offsetWidth / 1280;
        frame.style.transform = `scale(${scale})`;
      }
    }
    syncCreateButtonState();
    refreshIcons();
  } catch (err) {
    container.innerHTML = `<p class="muted">Could not load themes: ${escapeHtml(String(err))}</p>`;
  }
}

async function renderSettingsInTab(): Promise<void> {
  const container = $("settings-tab-container");
  if (!container) return;
  container.innerHTML = "";

  let settings: GlobalSettings;
  try {
    settings = await window.zephus.readGlobalSettings();
  } catch {
    setStatus("Could not load settings.");
    return;
  }

  const form = document.createElement("div");
  form.className = "settings-form";

  // --- Updates Section ---
  const updatesSec = document.createElement("div");
  updatesSec.className = "settings-section";

  const updHeader = document.createElement("h4");
  updHeader.className = "settings-section-title";
  updHeader.textContent = "Updates";
  updatesSec.appendChild(updHeader);

  const autoUpd = checkboxRow(
    "set-auto-update",
    "Startup check",
    settings.autoCheckUpdates,
  );
  updatesSec.appendChild(autoUpd.row);

  const chan = selectField(
    "Update channel",
    [
      { value: "auto", label: "Auto (match install)" },
      { value: "stable", label: "Stable" },
      { value: "beta", label: "Beta" },
      { value: "developer", label: "Developer (db)" },
    ],
    settings.updateChannel,
  );
  updatesSec.appendChild(chan.wrap);

  const checkRow = document.createElement("div");
  checkRow.className = "settings-row";
  const checkLeft = document.createElement("span");
  checkLeft.dataset.updaterStatusText = "true";
  checkLeft.textContent = updaterStatusMessage();
  const updateActions = document.createElement("div");
  updateActions.className = "settings-inline-actions";
  updateActions.dataset.updaterActions = "true";
  renderUpdaterActions(updateActions);

  checkRow.append(checkLeft, updateActions);
  updatesSec.appendChild(checkRow);
  form.appendChild(updatesSec);

  // --- Environment Section (Node.js) ---
  const envSec = document.createElement("div");
  envSec.className = "settings-section";

  const envHeader = document.createElement("h4");
  envHeader.className = "settings-section-title";
  envHeader.textContent = "Environment";
  envSec.appendChild(envHeader);

  const nodeRow = document.createElement("div");
  nodeRow.className = "settings-row";

  const nodeCopy = document.createElement("div");
  nodeCopy.className = "settings-inline-copy";
  const nodeStatusText = document.createElement("span");
  nodeStatusText.textContent = "Checking Node.js…";
  const nodeStrong = document.createElement("strong");
  nodeStrong.textContent = "Node.js (for build & preview)";
  nodeCopy.append(nodeStrong, nodeStatusText);

  const nodeBtns = document.createElement("div");
  nodeBtns.className = "settings-inline-actions";
  const nodeBrowseBtn = document.createElement("button");
  nodeBrowseBtn.className = "btn secondary mini-btn";
  nodeBrowseBtn.textContent = "Set Custom Location…";
  const nodeAutoBtn = document.createElement("button");
  nodeAutoBtn.className = "btn ghost mini-btn";
  nodeAutoBtn.textContent = "Use Auto-detect";
  nodeBtns.append(nodeBrowseBtn, nodeAutoBtn);

  nodeRow.append(nodeCopy, nodeBtns);
  envSec.appendChild(nodeRow);

  const applyNodeStatus = (res: NodeCheckResult): void => {
    const label =
      res.status === "ok"
        ? `Node.js ${res.version} detected ✓`
        : res.status === "outdated"
          ? `Node.js ${res.version ?? "?"} — version 22.12+ required`
          : res.status === "missing"
            ? "Node.js not found — set a custom location below"
            : "Node.js status could not be determined";
    const source = settings.customNodePath
      ? `Custom: ${settings.customNodePath}`
      : "Auto-detect (system PATH)";
    nodeStatusText.textContent = `${label} · ${source}`;
    nodeAutoBtn.disabled = !settings.customNodePath;
  };

  nodeBrowseBtn.onclick = async () => {
    nodeBrowseBtn.disabled = true;
    try {
      const res = await window.zephus.pickNodePath();
      if (
        (res.status === "ok" || res.status === "outdated") &&
        res.usedCustomPath &&
        res.binaryPath
      ) {
        settings.customNodePath = res.binaryPath;
      }
      applyNodeStatus(res);
    } catch {
      nodeStatusText.textContent = "Could not set Node.js location.";
    }
    nodeBrowseBtn.disabled = false;
  };

  nodeAutoBtn.onclick = async () => {
    nodeAutoBtn.disabled = true;
    try {
      const res = await window.zephus.setNodePath(null);
      settings.customNodePath = null;
      applyNodeStatus(res);
    } catch {
      nodeStatusText.textContent = "Could not reset Node.js location.";
    }
  };

  window.zephus
    .getNodeStatus()
    .then(applyNodeStatus)
    .catch(() => {
      nodeStatusText.textContent = "Could not check Node.js.";
    });

  form.appendChild(envSec);

  // --- Appearance Section ---
  const apSec = document.createElement("div");
  apSec.className = "settings-section";

  const apHeader = document.createElement("h4");
  apHeader.className = "settings-section-title";
  apHeader.textContent = "Appearance";
  apSec.appendChild(apHeader);

  const theme = selectField(
    "Theme",
    [
      { value: "system", label: "System" },
      { value: "dark", label: "Dark" },
      { value: "light", label: "Light" },
    ],
    settings.theme,
  );
  apSec.appendChild(theme.wrap);

  const fontSize = selectField(
    "Editor font size",
    [12, 13, 14, 15, 16, 18].map((n) => ({
      value: String(n),
      label: `${n}px`,
    })),
    String(settings.codeFontSize),
  );
  apSec.appendChild(fontSize.wrap);
  form.appendChild(apSec);

  // --- Editor Section ---
  const edSec = document.createElement("div");
  edSec.className = "settings-section";

  const edHeader = document.createElement("h4");
  edHeader.className = "settings-section-title";
  edHeader.textContent = "Editor";
  edSec.appendChild(edHeader);

  const restore = checkboxRow(
    "set-restore",
    "Reopen last project",
    settings.restoreLastProject,
  );
  edSec.appendChild(restore.row);

  const autosave = checkboxRow(
    "set-autosave",
    "Autosave changes",
    settings.autosave,
  );
  edSec.appendChild(autosave.row);

  const confirmDel = checkboxRow(
    "set-confirm-del",
    "Confirm delete block",
    settings.confirmBlockDelete,
  );
  edSec.appendChild(confirmDel.row);
  form.appendChild(edSec);

  // --- Actions/Buttons Row ---
  const actionsRow = document.createElement("div");
  actionsRow.className = "settings-panel-buttons";

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn danger";
  resetBtn.textContent = "Reset to Defaults";
  resetBtn.onclick = async () => {
    if (!confirm("Reset all Zephus settings to defaults?")) return;
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
  };

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn primary";
  saveBtn.textContent = "Save Settings";
  saveBtn.onclick = async () => {
    settings.autoCheckUpdates = autoUpd.input.checked;
    settings.updateChannel = chan.select
      .value as GlobalSettings["updateChannel"];
    settings.theme = theme.select.value as GlobalSettings["theme"];
    settings.codeFontSize = Number(fontSize.select.value);
    settings.restoreLastProject = restore.input.checked;
    settings.autosave = autosave.input.checked;
    settings.confirmBlockDelete = confirmDel.input.checked;

    await window.zephus.writeGlobalSettings(settings);
    document.documentElement.setAttribute("data-theme", settings.theme);
    applyCodeFontSize(settings.codeFontSize);
    appSettings = settings;
    setStatus("Settings saved.");
  };

  actionsRow.append(resetBtn, saveBtn);
  form.appendChild(actionsRow);
  container.appendChild(form);
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
      licensesListContainer.innerHTML = `<p class="muted" style="padding: 16px;">Loading bundled production license data…</p>`;

      const result = await window.zephus.readProductionLicenses();
      loadLicensesBtn.disabled = false;
      loadLicensesBtn.textContent = "Reload Dependency Licenses";

      if (!result.ok) {
        licensesListContainer.innerHTML = "";
        const error = document.createElement("p");
        error.className = "muted";
        error.style.padding = "16px";
        error.style.color = "var(--danger)";
        error.textContent =
          result.error ?? "Could not load production license data.";
        licensesListContainer.appendChild(error);
        return;
      }

      licensesListContainer.innerHTML = "";
      const tableWrap = document.createElement("div");
      tableWrap.className = "licenses-table-wrap";

      const table = document.createElement("table");
      table.className = "licenses-table";
      table.innerHTML = `
        <thead>
          <tr>
            <th>Package</th>
            <th>License</th>
            <th>Repository</th>
            <th>License URL</th>
          </tr>
        </thead>
        <tbody>
          ${result.entries
            .map(
              (entry) => `
                <tr>
                  <td class="licenses-package-cell">
                    <div class="licenses-package-name">${escapeHtml(entry.packageId)}</div>
                    <div class="licenses-package-parents">${escapeHtml(
                      entry.parents.slice(0, 4).join(" > ") ||
                        "Direct dependency",
                    )}</div>
                  </td>
                  <td>${escapeHtml(entry.licenses)}</td>
                  <td class="licenses-link-cell">${renderLicenseValue(entry.repository)}</td>
                  <td class="licenses-link-cell">${renderLicenseValue(entry.licenseUrl)}</td>
                </tr>`,
            )
            .join("")}
        </tbody>
      `;
      tableWrap.appendChild(table);
      licensesListContainer.appendChild(tableWrap);
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
  $("btn-undo").onclick = () => doUndo();
  $("btn-redo").onclick = () => doRedo();
  $("btn-save").onclick = () => void save();
  $("btn-publish").onclick = () => void publishSite();
  $("btn-preview").onclick = () => void togglePreview();
  $("btn-close").onclick = () => void closeProject();
  $("vp-desktop").onclick = () => setViewport("desktop");
  $("vp-tablet").onclick = () => setViewport("tablet");
  $("vp-mobile").onclick = () => setViewport("mobile");
  document.addEventListener("keydown", onKeydown);
  renderLayers();
  renderThemePlaceholder();
  refreshGuidancePanels();
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
