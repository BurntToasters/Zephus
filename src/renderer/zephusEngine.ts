// Zephus renderer logic. Talks to the main process exclusively through
// window.zephus (the preload bridge). No Node APIs are used here.
import { createCodeEditor, CodeEditor } from "./codeEditor";
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
  html: "code-xml",
};

function refreshIcons(): void {
  createIcons({
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
    },
  });
}

const TEXT_EDITABLE: BlockType[] = [
  "heading",
  "text",
  "button",
  "section",
  "card",
  "quote",
];

interface SectionTemplate {
  id: string;
  label: string;
  html: string;
}

// Prebuilt section clusters inserted as a single preserved HTML block.
const TEMPLATES: SectionTemplate[] = [
  {
    id: "hero",
    label: "Hero",
    html: `<section class="hero">
      <h1>Your headline here</h1>
      <p>A short supporting sentence about your product or site.</p>
      <a class="button" href="#">Get started</a>
    </section>`,
  },
  {
    id: "features",
    label: "Features",
    html: `<section class="features">
      <div class="feature"><h3>Fast</h3><p>Describe a benefit.</p></div>
      <div class="feature"><h3>Simple</h3><p>Describe a benefit.</p></div>
      <div class="feature"><h3>Flexible</h3><p>Describe a benefit.</p></div>
    </section>`,
  },
  {
    id: "pricing",
    label: "Pricing",
    html: `<section class="pricing-grid">
      <article class="price-card"><h3>Starter</h3><p>$9/mo</p><ul><li>One site</li><li>Email support</li></ul></article>
      <article class="price-card"><h3>Pro</h3><p>$29/mo</p><ul><li>Unlimited pages</li><li>Priority support</li></ul></article>
      <article class="price-card"><h3>Studio</h3><p>$99/mo</p><ul><li>Team seats</li><li>Custom onboarding</li></ul></article>
    </section>`,
  },
  {
    id: "faq",
    label: "FAQ",
    html: `<section class="faq-list">
      <details open><summary>What is this for?</summary><p>Answer the most common buyer question.</p></details>
      <details><summary>How long does setup take?</summary><p>Share the expected time-to-value.</p></details>
      <details><summary>Can I customize it?</summary><p>Explain the limits and flexibility.</p></details>
    </section>`,
  },
  {
    id: "testimonials",
    label: "Testimonials",
    html: `<section class="testimonials">
      <blockquote><p>"A short customer quote."</p><cite>Customer Name</cite></blockquote>
      <blockquote><p>"Another proof point from a happy client."</p><cite>Founder, Studio</cite></blockquote>
    </section>`,
  },
  {
    id: "cta",
    label: "Call to action",
    html: `<section class="cta">
      <h2>Ready to begin?</h2>
      <a class="button" href="#">Contact us</a>
    </section>`,
  },
  {
    id: "logo-wall",
    label: "Logo Wall",
    html: `<section class="logo-wall">
      <span>Client One</span>
      <span>Client Two</span>
      <span>Client Three</span>
      <span>Client Four</span>
    </section>`,
  },
  {
    id: "contact",
    label: "Contact",
    html: `<section class="contact-card">
      <h2>Say hello</h2>
      <p>Drop in your email, address, or scheduling link.</p>
      <a class="button" href="mailto:hello@example.com">Email us</a>
    </section>`,
  },
  {
    id: "footer",
    label: "Footer",
    html: `<footer class="site-footer">
      <p>&copy; Your Site. Built with Zephus.</p>
    </footer>`,
  },
];

const editorRules = {
  allowedBlocks: null as string[] | null,
  maxHeadingLevel: 6,
};

const state = {
  project: null as ProjectOpenResult | null,
  siteDocument: null as SiteDocument | null,
  pageDocument: null as PageDocument | null,
  page: null as string | null,
  pageMeta: [] as PageMeta[],
  currentMeta: null as PageMeta | null,
  managedStatus: "missing" as ManagedFileStatus,
  visualEditable: true,
  generatedCode: "",
  mode: "visual" as Mode,
  blocks: [] as Block[],
  selectedId: null as string | null,
  rawCode: "",
  // Page structure preserved around the editable region.
  frontmatter: "",
  prefix: "",
  suffix: "",
  dirty: false,
  currentViewport: "desktop" as ViewportKey,
  changeSummary: [] as string[],
  previewUrl: null as string | null,
  unsubLog: null as null | (() => void),
  unsubExternal: null as null | (() => void),
  undo: [] as Block[][],
  redo: [] as Block[][],
  draftTimer: null as number | null,
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

// Cached app settings, loaded at startup and refreshed on save.
let appSettings: GlobalSettings | null = null;
let selectedTabTheme: string | null = null;
let themePreviewBaseUrl: string | null = null;
let startThemes: ThemeMeta[] | null = null;

function setStatus(message: string): void {
  $("status-bar").textContent = message;
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
    style: block.style
      ? JSON.parse(JSON.stringify(block.style))
      : undefined,
  };
}

function cloneBlocks(blocks: Block[]): Block[] {
  return blocks.map((block) => cloneBlock(block));
}

function trackChange(label: string): void {
  if (!state.changeSummary.includes(label)) {
    state.changeSummary.push(label);
  }
}

function clearChanges(): void {
  state.changeSummary = [];
}

function blocksFromPageDocument(doc: PageDocument): Block[] {
  return doc.sections.flatMap((section) =>
    section.children.map((child) => ({
      id: child.id,
      type: child.type,
      props: { ...child.props },
      style: child.style
        ? JSON.parse(JSON.stringify(child.style))
        : undefined,
      locked: child.locked,
      raw: child.raw,
    })),
  );
}

function pageDocumentFromState(): PageDocument | null {
  if (!state.pageDocument || !state.page) return null;
  return {
    ...state.pageDocument,
    page: state.page,
    sections: [
      {
        id: state.pageDocument.sections[0]?.id ?? "section-main",
        type: "section",
        label: state.pageDocument.sections[0]?.label ?? "Main Content",
        props: state.pageDocument.sections[0]?.props ?? { wrapper: "none" },
        style: state.pageDocument.sections[0]?.style,
        locked: state.pageDocument.sections[0]?.locked,
        hidden: state.pageDocument.sections[0]?.hidden,
        children: state.blocks.map((block) => ({
          id: block.id,
          type: block.type,
          props: { ...block.props },
          style: block.style
            ? JSON.parse(JSON.stringify(block.style))
            : undefined,
          locked: block.locked,
          raw: block.raw,
        })),
      },
    ],
  };
}

function syncVisualModeState(): void {
  const visualBtn = $("mode-visual") as HTMLButtonElement;
  visualBtn.disabled = !state.visualEditable;
  visualBtn.classList.toggle("disabled", !state.visualEditable);
  visualBtn.title = state.visualEditable
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
  return state.currentMeta?.navLabel || state.currentMeta?.title || state.page || "page";
}

function draftContentForCurrentState(): string {
  return state.mode === "code" ? getCode() : serializeBlocks();
}

function scheduleDraftWrite(): void {
  if (!state.project || !state.page) return;
  if (state.draftTimer !== null) {
    window.clearTimeout(state.draftTimer);
  }
  state.draftTimer = window.setTimeout(() => {
    if (!state.project || !state.page || !state.dirty) return;
    void window.zephus.writeDraft(
      state.project.path,
      state.page,
      draftContentForCurrentState(),
    );
  }, 800);
}

function markDirty(d: boolean): void {
  state.dirty = d;
  const name = $("project-name");
  const existing = name.querySelector(".dirty-dot");
  if (d && !existing && state.page) {
    const dot = document.createElement("span");
    dot.className = "dirty-dot";
    dot.textContent = "●";
    name.appendChild(dot);
  } else if (!d && existing) {
    existing.remove();
  }
  const saveBtn = $("btn-save");
  saveBtn.classList.toggle("dirty", d);
  saveBtn.setAttribute("title", d ? "Unsaved changes" : "Save");
  for (const li of Array.from($("page-list").children) as HTMLElement[]) {
    const isCurrent = li.dataset["page"] === state.page;
    li.classList.toggle("dirty", d && isCurrent);
  }
  if (d) scheduleDraftWrite();
}

/* ---------- Modal helpers ---------- */

interface ModalAction {
  label: string;
  kind?: "primary" | "danger" | "ghost";
  onClick: () => void;
}

interface ModalOptions {
  size?: "default" | "wide";
}

function applyModalOptions(options?: ModalOptions): void {
  $("modal-shell").classList.toggle("modal-wide", options?.size === "wide");
}

function buildActions(actions: ModalAction[]): void {
  const container = $("modal-actions");
  container.innerHTML = "";
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.className = "btn " + (action.kind ?? "");
    btn.textContent = action.label;
    btn.onclick = action.onClick;
    container.appendChild(btn);
  }
}

function showModal(
  title: string,
  body: string,
  actions: ModalAction[],
  options?: ModalOptions,
): void {
  $("modal-title").textContent = title;
  $("modal-body").textContent = body;
  applyModalOptions(options);
  buildActions(actions);
  $("modal-overlay").classList.remove("hidden");
  refreshIcons();
}

function showModalNode(
  title: string,
  content: HTMLElement,
  actions: ModalAction[],
  options?: ModalOptions,
): void {
  $("modal-title").textContent = title;
  const body = $("modal-body");
  body.innerHTML = "";
  body.appendChild(content);
  applyModalOptions(options);
  buildActions(actions);
  $("modal-overlay").classList.remove("hidden");
  refreshIcons();
}

function closeModal(): void {
  applyModalOptions();
  $("modal-overlay").classList.add("hidden");
}

/* ---------- Start view ---------- */

async function renderRecent(): Promise<void> {
  const settings = await window.zephus.readGlobalSettings();
  const list = $("recent-list");
  list.innerHTML = "";
  if (settings.recentProjects.length === 0) {
    const li = document.createElement("li");
    li.className = "recent-empty";
    li.textContent = "No recent projects yet.";
    list.appendChild(li);
    return;
  }
  for (const p of settings.recentProjects) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "proj-name";
    name.textContent = p.split(/[\\/]/).pop() ?? p;
    const pathSpan = document.createElement("span");
    pathSpan.className = "path";
    pathSpan.textContent = p;
    li.append(name, pathSpan);
    li.onclick = () => void openProjectByPath(p);
    list.appendChild(li);
  }
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
    ],
    settings.updateChannel,
  );
  updatesSec.appendChild(chan.wrap);

  const checkRow = document.createElement("div");
  checkRow.className = "settings-row";
  const checkLeft = document.createElement("span");
  const checkNowBtn = document.createElement("button");
  checkNowBtn.className = "btn secondary mini-btn";
  checkNowBtn.textContent = "Check for Updates Now";
  checkNowBtn.onclick = async () => {
    checkNowBtn.textContent = "Checking…";
    checkNowBtn.disabled = true;
    try {
      await window.zephus.checkForUpdates();
    } catch {
      // Ignored: status is surfaced via updater-status listener
    }
    checkNowBtn.textContent = "Check for Updates Now";
    checkNowBtn.disabled = false;
  };
  checkRow.append(checkLeft, checkNowBtn);
  updatesSec.appendChild(checkRow);
  form.appendChild(updatesSec);

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
  ensureCodeEditor();
  void refreshGit();
  void applyRepoRules();
  void applyMergedTheme();
  renderPalette();
  void renderTemplates();
  await reloadPages();
  renderPageList(result);
  renderNavEditor(result);
  setMode("visual");

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
  if (total === 0) {
    panel.innerHTML = '<p class="muted">No changes.</p>';
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
  // Templates are HTML blocks; hide them if HTML blocks are disallowed.
  const allowed = editorRules.allowedBlocks;
  if (allowed && !allowed.includes("html")) {
    palette.innerHTML = '<li class="muted">Disabled by project rules.</li>';
    return;
  }
  const saved = await window.zephus.listReusableSections().catch(() => null);
  const merged = [
    ...TEMPLATES,
    ...((saved?.ok ? saved.sections : []).map((section) => ({
      id: section.id,
      label: `${section.label} (Saved)`,
      html: section.html,
    })) as SectionTemplate[]),
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
  const entries = state.pageMeta.length
    ? state.pageMeta.filter((entry) => entry.navVisible)
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
    li.textContent = "No visible nav pages.";
    list.appendChild(li);
    return;
  }
  for (const entry of entries) {
    const li = document.createElement("li");
    li.innerHTML = `<i data-lucide="link"></i> <span>${escapeHtml(entry.navLabel)} <span class="nav-route">${escapeHtml(entry.route)}</span></span>`;
    list.appendChild(li);
  }
  refreshIcons();
}

async function writeNavFromEntries(entries: PageMeta[]): Promise<void> {
  if (!state.project) return;
  const layoutRel = "src/layouts/BaseLayout.astro";
  const res = await window.zephus.readFile(state.project.path, layoutRel);
  if (!res.ok) {
    setStatus("Could not read BaseLayout: " + (res.error ?? ""));
    return;
  }
  const links = entries
    .filter((entry) => entry.navVisible)
    .map((entry) => {
      return `        <a href="${escapeAttr(entry.route)}">${escapeHtml(entry.navLabel)}</a>`;
    })
    .join("\n");

  const navBlock = `<nav>\n${links}\n      </nav>`;
  let content = res.content ?? "";
  if (/<nav>[\s\S]*?<\/nav>/.test(content)) {
    content = content.replace(/<nav>[\s\S]*?<\/nav>/, navBlock);
  } else {
    setStatus("No <nav> found in BaseLayout; add one manually first.");
    return;
  }
  const wr = await window.zephus.writeFile(
    state.project.path,
    layoutRel,
    content,
  );
  if (!wr.ok) {
    setStatus("Failed to write nav: " + (wr.error ?? ""));
    return;
  }
  setStatus("Navigation regenerated from pages.");
  void refreshGit();
}

async function regenerateNav(): Promise<void> {
  if (!state.project) return;
  const wrap = document.createElement("div");
  wrap.className = "meta-form";

  const help = document.createElement("p");
  help.className = "muted";
  help.textContent =
    "Preview and adjust navigation labels before Zephus writes BaseLayout.";
  wrap.appendChild(help);

  const rows: {
    entry: PageMeta;
    labelInput: HTMLInputElement;
    visibleInput: HTMLInputElement;
  }[] = [];

  for (const entry of state.pageMeta) {
    const row = document.createElement("div");
    row.className = "meta-grid";

    const visible = document.createElement("input");
    visible.type = "checkbox";
    visible.checked = entry.navVisible;

    const label = document.createElement("input");
    label.className = "text";
    label.value = entry.navLabel;

    const route = document.createElement("span");
    route.className = "muted";
    route.textContent = entry.route;

    row.append(visible, label, route);
    wrap.appendChild(row);
    rows.push({ entry, labelInput: label, visibleInput: visible });
  }

  showModalNode(
    "Navigation Preview",
    wrap,
    [
      { label: "Cancel", kind: "ghost", onClick: closeModal },
      {
        label: "Write Navigation",
        kind: "primary",
        onClick: async () => {
          if (!state.project) return;
          for (const row of rows) {
            await window.zephus.writePageMeta(
              state.project.path,
              row.entry.page,
              state.project.astro.pagesDir,
              {
                navLabel: row.labelInput.value.trim() || row.entry.title,
                navVisible: row.visibleInput.checked,
              },
            );
          }
          closeModal();
          await reloadPages();
          await writeNavFromEntries(state.pageMeta);
        },
      },
    ],
  );
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
  syncCurrentMeta();
  renderPageList(state.project);
  renderNavEditor(state.project);
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
        const created = state.pageMeta.find((entry) => entry.slug === name || entry.route === "/" + name);
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

  showModalNode(
    "Page Settings",
    wrap,
    [
      {
        label: "Delete",
        kind: "danger",
        onClick: async () => {
          if (entry.isHome) {
            setStatus("Home page cannot be deleted.");
            return;
          }
          if (
            !confirm(
              `Delete page "${entry.navLabel}" and remove its route ${entry.route}?`,
            )
          ) {
            return;
          }
          const deleted = await window.zephus.deletePage(
            state.project!.path,
            entry.page,
          );
          if (!deleted.ok) {
            setStatus("Delete failed: " + (deleted.error ?? "unknown"));
            return;
          }
          closeModal();
          if (state.page === entry.page) {
            state.page = null;
            state.blocks = [];
            state.selectedId = null;
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
            state.page === entry.page ? currentSource : (doc.source ?? currentSource),
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
              navLabel: navLabel.value.trim() || title.value.trim() || entry.navLabel,
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
            state.page = state.project.pages.find((candidate) =>
              candidate.endsWith(`${nextSlug}.astro`) ||
              candidate.endsWith(`${nextSlug}.md`) ||
              candidate === nextPage,
            ) ?? nextPage;
            syncCurrentMeta();
          }
          setStatus(`Saved page settings for ${entry.navLabel}.`);
        },
      },
    ],
  );
}

async function loadPage(page: string): Promise<void> {
  if (!state.project) return;
  if (state.dirty) {
    if (appSettings?.autosave) {
      await performSave();
    } else if (!confirm("Discard unsaved changes to the current page?")) {
      return;
    }
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
  state.visualEditable = state.managedStatus !== "detached";
  state.generatedCode = res.source ?? "";
  syncCurrentMeta();
  state.rawCode = res.source ?? "";
  const draft = await window.zephus.readDraft(state.project.path, page);
  if (
    draft.ok &&
    draft.draft &&
    draft.draft.content &&
    draft.draft.content !== state.rawCode &&
    confirm(
      `Restore an unsaved draft for ${findPageMeta(page)?.navLabel ?? page}?`,
    )
  ) {
    state.rawCode = draft.draft.content;
    setStatus(`Recovered draft from ${new Date(draft.draft.savedAt).toLocaleString()}.`);
  }
  state.blocks = blocksFromPageDocument(res.pageDocument);
  state.undo = [];
  state.redo = [];
  state.selectedId = null;
  clearChanges();
  markDirty(false);

  for (const li of Array.from($("page-list").children) as HTMLElement[]) {
    li.classList.toggle("active", li.dataset["page"] === page);
  }
  syncVisualModeState();
  setCode(state.rawCode);
  setMode(state.visualEditable ? "visual" : "code");

  // Watch the open file for external changes.
  await window.zephus.watchFile(state.project.path, page);
  if (state.managedStatus === "out-of-sync") {
    setStatus("Managed page drift detected. Save visually to overwrite or edit in code and detach.");
  } else if (state.managedStatus === "detached") {
    setStatus("Detached page loaded in code mode. Reattach it from Page Settings to restore visual editing.");
  } else {
    setStatus("Editing " + page);
  }
}

async function onExternalChange(): Promise<void> {
  if (!state.project || !state.page) return;
  showModal(
    "File Changed on Disk",
    "The current page was modified outside Zephus. Reload it from disk " +
      "(discards unsaved changes) or keep your in-app version?",
    [
      { label: "Keep Mine", kind: "ghost", onClick: closeModal },
      {
        label: "Reload",
        kind: "primary",
        onClick: async () => {
          closeModal();
          const page = state.page;
          const projectPath = state.project?.path;
          if (page && projectPath) {
            markDirty(false);
            await window.zephus.clearDraft(projectPath, page);
            await loadPage(page);
          }
        },
      },
    ],
  );
}

/* ---------- Page structure parse / serialize ---------- */
// Preserves frontmatter and the markup surrounding the editable region so that
// untouched content round-trips. Unknown nodes become verbatim "html" blocks.

function parsePage(raw: string): void {
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

  state.blocks = parseInner(inner);
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
  const responsive = block.style?.responsive?.[viewport];
  if (responsive) Object.assign(base, responsive);
  return base;
}

function styleAttr(
  block: Block,
  viewport = state.currentViewport,
  forCanvas = false,
): string {
  const style = effectiveStyle(block, viewport);
  const css: string[] = [];
  if (style.align) css.push(`text-align:${style.align}`);
  if (style.maxWidth) css.push(`max-width:${style.maxWidth}`);
  if (style.background) css.push(`background:${style.background}`);
  if (style.color) css.push(`color:${style.color}`);
  if (style.padding) css.push(`padding:${style.padding}`);
  if (style.margin) css.push(`margin:${style.margin}`);
  if (style.radius) css.push(`border-radius:${style.radius}`);
  if (style.gap) css.push(`gap:${style.gap}`);
  if (style.columns && (block.type === "columns" || block.type === "gallery")) {
    css.push(`grid-template-columns:repeat(${Math.max(1, Number(style.columns) || 1)}, minmax(0, 1fr))`);
  }
  if (style.shadow === "sm") css.push(`box-shadow:var(--shadow-sm)`);
  if (style.shadow === "md") css.push(`box-shadow:var(--shadow-md)`);
  if (style.shadow === "lg") css.push(`box-shadow:var(--shadow-lg)`);
  if (style.stackOnMobile && viewport === "mobile" && block.type === "columns") {
    css.push(`grid-template-columns:1fr`);
  }
  if (style.hideOn?.includes(viewport) && forCanvas) {
    css.push(`display:none`);
  }
  if (block.type === "spacer") {
    css.push(`height:${block.props["height"] || "48px"}`);
  }
  return css.length ? ` style="${escapeAttr(css.join(";"))}"` : "";
}

function classAttr(block: Block): string {
  const cls = block.props["cls"];
  return cls ? ` class="${escapeAttr(cls)}"` : "";
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

function blockToHtml(block: Block, viewport = state.currentViewport, forCanvas = false): string {
  const common = `${metadataAttrs(block)}${classAttr(block)}${styleAttr(
    block,
    viewport,
    forCanvas,
  )}`;
  switch (block.type) {
    case "heading": {
      const level = Math.max(
        1,
        Math.min(editorRules.maxHeadingLevel, Number(block.props["level"] ?? 2)),
      );
      return `<h${level}${common}>${plainTextToHtml(
        block.props["text"] ?? "",
      )}</h${level}>`;
    }
    case "text":
      return `<p${common}>${plainTextToHtml(block.props["text"] ?? "")}</p>`;
    case "image":
      if (!block.props["src"] && forCanvas) {
        return `<figure${common}><div class="canvas-empty">Missing image. Choose one in Properties.</div></figure>`;
      }
      return `<img${common} src="${escapeAttr(block.props["src"] ?? "")}" alt="${escapeAttr(block.props["alt"] ?? "")}" />`;
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
      const parts = Array.from({ length: Math.max(2, Math.min(cols || 2, 4)) }, (_, index) => {
        const key = `col${index + 1}`;
        return `<div class="zephus-column">${plainTextToHtml(
          block.props[key] ?? `Column ${index + 1}`,
        )}</div>`;
      }).join("");
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
        .map(
          (src, index) =>
            `<img src="${escapeAttr(src)}" alt="${escapeAttr(
              block.props[`alt${index + 1}`] ?? `Gallery image ${index + 1}`,
            )}" />`,
        )
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
  }
}

function serializeBlocks(): string {
  const body = state.blocks.map((b) => "    " + blockToHtml(b, "desktop")).join("\n");
  return `${state.frontmatter}${state.prefix}\n${body}\n${state.suffix}`;
}

/* ---------- Canvas rendering + drag/drop ---------- */

let dropIndex = -1;
let indicator: HTMLElement | null = null;

function pushUndo(): void {
  state.undo.push(cloneBlocks(state.blocks));
  if (state.undo.length > 50) state.undo.shift();
  state.redo = [];
}

function blockLabel(block: Block): string {
  if (block.type === "html") return "HTML / structural content";
  return block.type.charAt(0).toUpperCase() + block.type.slice(1);
}

function commitBlockChange(summary: string): void {
  trackChange(summary);
  markDirty(true);
  renderCanvas();
  renderProperties();
}

function addBlockAt(type: BlockType, index: number): void {
  pushUndo();
  const block: Block =
    type === "html"
      ? { id: uid(), type, props: {}, raw: "<section>\n  <p>Custom HTML</p>\n</section>" }
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
  state.blocks.splice(index, 0, block);
  state.selectedId = block.id;
  commitBlockChange(`Added ${type} block`);
}

function duplicateSelectedBlock(block: Block): void {
  pushUndo();
  const idx = state.blocks.findIndex((item) => item.id === block.id);
  const copy = cloneBlock(block);
  copy.id = uid();
  state.blocks.splice(idx + 1, 0, copy);
  state.selectedId = copy.id;
  commitBlockChange(`Duplicated ${block.type} block`);
}

function moveBlock(block: Block, direction: -1 | 1): void {
  if (block.locked) return;
  const idx = state.blocks.findIndex((item) => item.id === block.id);
  const next = idx + direction;
  if (idx < 0 || next < 0 || next >= state.blocks.length) return;
  pushUndo();
  const [moved] = state.blocks.splice(idx, 1);
  if (!moved) return;
  state.blocks.splice(next, 0, moved);
  state.selectedId = moved.id;
  commitBlockChange(
    `Moved ${block.type} block ${direction < 0 ? "up" : "down"}`,
  );
}

function toggleBlockLock(block: Block): void {
  pushUndo();
  block.locked = !block.locked;
  commitBlockChange(
    `${block.locked ? "Locked" : "Unlocked"} ${block.type} block`,
  );
}

function deleteBlock(block: Block): void {
  if (
    appSettings?.confirmBlockDelete &&
    !confirm(`Delete this ${block.type} block from ${currentPageLabel()}?`)
  ) {
    return;
  }
  pushUndo();
  state.blocks = state.blocks.filter((item) => item.id !== block.id);
  state.selectedId = null;
  commitBlockChange(`Deleted ${block.type} block`);
}

function wrapBlockInSection(block: Block): void {
  pushUndo();
  const idx = state.blocks.findIndex((item) => item.id === block.id);
  const wrapped: Block = {
    id: uid(),
    type: "html",
    props: {},
    raw: `<section class="zephus-wrap">\n  ${blockToHtml(block, "desktop")}\n</section>`,
  };
  state.blocks.splice(idx, 1, wrapped);
  state.selectedId = wrapped.id;
  commitBlockChange(`Wrapped ${block.type} block in section`);
}

function buildInsertButton(index: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "canvas-insert";
  const btn = document.createElement("button");
  btn.className = "mini-btn";
  btn.textContent = "+ Add Block";
  btn.onclick = (event) => {
    event.stopPropagation();
    openBlockInsertModal(index);
  };
  row.appendChild(btn);
  return row;
}

function openBlockInsertModal(index: number): void {
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
      addBlockAt(item.type, index);
    };
    wrap.appendChild(btn);
  }
  showModalNode(
    "Add Block",
    wrap,
    [{ label: "Close", kind: "ghost", onClick: closeModal }],
  );
}

function renderCanvas(): void {
  const canvas = $("canvas");
  canvas.innerHTML = "";
  indicator = null;
  canvas.setAttribute("data-viewport", state.currentViewport);

  if (state.blocks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "canvas-empty-state";
    empty.innerHTML =
      `<h3>This page is empty</h3><p>Add your first block or drop in a reusable section.</p>`;
    const actions = document.createElement("div");
    actions.className = "canvas-empty-actions";
    for (const type of ["heading", "text", "section"] as BlockType[]) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = `Add ${type}`;
      btn.onclick = () => addBlockAt(type, state.blocks.length);
      actions.appendChild(btn);
    }
    empty.appendChild(actions);
    canvas.appendChild(empty);
    return;
  }

  state.blocks.forEach((block, index) => {
    canvas.appendChild(buildInsertButton(index));

    const shell = document.createElement("div");
    shell.className =
      "block" +
      (block.id === state.selectedId ? " selected" : "") +
      (block.type === "html" ? " html-block" : "") +
      (block.locked ? " locked" : "");
    shell.draggable = !block.locked;
    shell.dataset["index"] = String(index);
    shell.title = blockLabel(block);

    const chrome = document.createElement("div");
    chrome.className = "block-chrome";

    const chip = document.createElement("span");
    chip.className = "block-chip";
    chip.textContent = `${index + 1}. ${blockLabel(block)}`;

    const crumbs = document.createElement("span");
    crumbs.className = "block-breadcrumb";
    crumbs.textContent = `${currentPageLabel()} / ${block.type}`;

    const actions = document.createElement("div");
    actions.className = "block-actions";
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
      btn.onclick = (event) => {
        event.stopPropagation();
        handler();
      };
      actions.appendChild(btn);
    }
    chrome.append(chip, crumbs, actions);

    const preview = document.createElement("div");
    preview.className = "block-preview";
    preview.innerHTML = blockToHtml(block, state.currentViewport, true);

    shell.onclick = (e) => {
      e.stopPropagation();
      state.selectedId = block.id;
      renderCanvas();
      renderProperties();
    };

    if (TEXT_EDITABLE.includes(block.type) && !block.locked) {
      preview.ondblclick = (e) => {
        e.stopPropagation();
        startInlineEdit(preview, block);
      };
    }

    shell.addEventListener("dragstart", (e) => {
      if (block.locked) {
        e.preventDefault();
        return;
      }
      e.dataTransfer?.setData("text/zephus-move", String(index));
    });
    shell.addEventListener("dragover", (e) => {
      e.preventDefault();
      const rect = shell.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      dropIndex = after ? index + 1 : index;
      showIndicator(canvas, shell, after);
    });
    shell.addEventListener("drop", (e) => handleDrop(e));
    shell.append(chrome, preview);
    canvas.appendChild(shell);
  });

  canvas.appendChild(buildInsertButton(state.blocks.length));

  canvas.ondragover = (e) => {
    e.preventDefault();
    if (state.blocks.length === 0) dropIndex = 0;
  };
  canvas.ondrop = (e) => handleDrop(e);
  canvas.onclick = () => {
    state.selectedId = null;
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
  const moveFrom = e.dataTransfer?.getData("text/zephus-move");
  const templateId = e.dataTransfer?.getData("text/zephus-template");
  const target = dropIndex < 0 ? state.blocks.length : dropIndex;

  if (templateId) {
    const tpl = TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    pushUndo();
    const block: Block = { id: uid(), type: "html", props: {}, raw: tpl.html };
    state.blocks.splice(target, 0, block);
    state.selectedId = block.id;
    commitBlockChange(`Added ${tpl.label} section`);
  } else if (newType) {
    addBlockAt(newType as BlockType, target);
  } else if (moveFrom) {
    const from = Number(moveFrom);
    const moved = state.blocks[from];
    if (!moved || moved.locked) return;
    pushUndo();
    state.blocks.splice(from, 1);
    const adjusted = from < target ? target - 1 : target;
    state.blocks.splice(adjusted, 0, moved);
    state.selectedId = moved.id;
    commitBlockChange(`Reordered ${moved.type} block`);
  }
  dropIndex = -1;
}

function startInlineEdit(el: HTMLElement, block: Block): void {
  el.setAttribute("contenteditable", "true");
  el.focus();
  const finish = () => {
    el.removeAttribute("contenteditable");
    const newText = el.innerText.trim();
    if (newText !== (block.props["text"] ?? "")) {
      pushUndo();
      block.props["text"] = newText;
      commitBlockChange(`Edited ${block.type} content`);
    } else {
      renderCanvas();
      renderProperties();
    }
    el.removeEventListener("blur", finish);
  };
  el.addEventListener("blur", finish);
}

function defaultProps(type: BlockType): Record<string, string> {
  switch (type) {
    case "heading":
      return { text: "New heading", level: "2", cls: "" };
    case "text":
      return { text: "New paragraph of text.", cls: "" };
    case "image":
      return { src: "", alt: "", cls: "" };
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
        images: "/images/example-1.png\n/images/example-2.png\n/images/example-3.png",
        cls: "",
      };
    case "quote":
      return { text: "A quote or testimonial.", cite: "Customer Name", cls: "" };
    case "list":
      return { items: "First item\nSecond item\nThird item", ordered: "false", cls: "" };
    case "embed":
      return { src: "", title: "Embed", cls: "" };
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
  input.oninput = () => onChange(input.value);
  wrap.append(label, input);
  return wrap;
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
  if (!state.project) return;
  const result = await window.zephus.listAssets(
    state.project.path,
    state.project.astro.publicDir,
  );
  const wrap = document.createElement("div");
  wrap.className = "asset-browser";
  if (result.ok && result.assets.length > 0) {
    for (const asset of result.assets) {
      const row = document.createElement("button");
      row.className = "asset-row";
      row.textContent = asset.fileName;
      row.onclick = () => {
        closeModal();
        pushUndo();
        block.props["src"] = asset.webPath;
        commitBlockChange(`Updated image asset for ${block.type}`);
      };
      wrap.appendChild(row);
    }
  } else {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No imported images yet.";
    wrap.appendChild(empty);
  }
  showModalNode(
    "Asset Browser",
    wrap,
    [
      {
        label: "Import New Image",
        kind: "primary",
        onClick: async () => {
          if (!state.project) return;
          const imported = await window.zephus.importImage(
            state.project.path,
            state.project.astro.publicDir,
          );
          if (imported.ok && imported.webPath) {
            closeModal();
            pushUndo();
            block.props["src"] = imported.webPath;
            commitBlockChange("Imported image asset");
          } else if (!imported.canceled) {
            setStatus("Image import failed: " + (imported.error ?? "unknown"));
          }
        },
      },
      { label: "Close", kind: "ghost", onClick: closeModal },
    ],
  );
}

function renderProperties(): void {
  const panel = $("properties");
  const block = state.blocks.find((b) => b.id === state.selectedId);
  panel.innerHTML = "";

  if (!block) {
    const empty = document.createElement("div");
    empty.className = "prop-empty";
    empty.innerHTML = `<p class="muted">Select a block to edit its properties.</p>`;
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

  const header = document.createElement("div");
  header.className = "prop-header";
  header.innerHTML = `<strong>${blockLabel(block)}</strong><span class="muted">${currentPageLabel()} / ${block.type}</span>`;
  panel.appendChild(header);

  const commit = (key: string, value: string) => {
    pushUndo();
    block.props[key] = value;
    commitBlockChange(`Updated ${block.type} ${key}`);
  };

  const commitStyle = (key: keyof BlockStyle, value: string | boolean | string[]) => {
    pushUndo();
    block.style = block.style ?? {};
    (block.style as Record<string, unknown>)[key] = value;
    commitBlockChange(`Updated ${block.type} style`);
  };

  const contentGroup = propertyGroup("Content");
  if (block.type === "html") {
    const copy = document.createElement("p");
    copy.className = "muted";
    copy.textContent = "Raw HTML / structural block. Edit the markup in Code mode.";
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
      labeledTextarea("Text", block.props["text"] ?? "", (v) => commit("text", v)),
    );
    if (block.type === "quote") {
      contentGroup.appendChild(
        labeledInput("Citation", block.props["cite"] ?? "", (v) => commit("cite", v)),
      );
    }
  } else if (block.type === "button") {
    contentGroup.appendChild(
      labeledInput("Label", block.props["text"] ?? "", (v) => commit("text", v)),
    );
    contentGroup.appendChild(
      labeledInput("Link", block.props["href"] ?? "", (v) => commit("href", v)),
    );
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
      labeledInput("Image path", block.props["src"] ?? "", (v) => commit("src", v)),
    );
    contentGroup.appendChild(
      labeledInput("Alt text", block.props["alt"] ?? "", (v) => commit("alt", v)),
    );
  } else if (block.type === "columns") {
    const count = document.createElement("label");
    count.className = "meta-field";
    const countLabel = document.createElement("span");
    countLabel.textContent = "Columns";
    const select = document.createElement("select");
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
      commit("count", select.value);
      commitStyle("columns", select.value);
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
      labeledInput("Title", block.props["title"] ?? "", (v) => commit("title", v)),
    );
    contentGroup.appendChild(
      labeledTextarea("Body", block.props["text"] ?? "", (v) => commit("text", v)),
    );
  } else if (block.type === "gallery") {
    contentGroup.appendChild(
      labeledTextarea(
        "Image paths",
        block.props["images"] ?? "",
        (v) => commit("images", v),
      ),
    );
  } else if (block.type === "list") {
    contentGroup.appendChild(
      labeledTextarea("Items", block.props["items"] ?? "", (v) => commit("items", v)),
    );
    const ordered = document.createElement("label");
    ordered.className = "meta-field";
    const orderedSpan = document.createElement("span");
    orderedSpan.textContent = "Ordered list";
    const orderedInput = document.createElement("input");
    orderedInput.type = "checkbox";
    orderedInput.checked = block.props["ordered"] === "true";
    orderedInput.onchange = () =>
      commit("ordered", orderedInput.checked ? "true" : "false");
    ordered.append(orderedSpan, orderedInput);
    contentGroup.appendChild(ordered);
  } else if (block.type === "embed") {
    contentGroup.appendChild(
      labeledInput("Embed URL", block.props["src"] ?? "", (v) => commit("src", v)),
    );
    contentGroup.appendChild(
      labeledInput("Title", block.props["title"] ?? "", (v) => commit("title", v)),
    );
  } else if (block.type === "spacer") {
    contentGroup.appendChild(
      labeledInput("Height", block.props["height"] ?? "48px", (v) =>
        commit("height", v),
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
    labeledInput("Max width", block.style?.maxWidth ?? "", (v) =>
      commitStyle("maxWidth", v),
    ),
  );
  layoutGroup.appendChild(
    labeledInput("Gap", block.style?.gap ?? "", (v) => commitStyle("gap", v)),
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
  stackInput.checked = block.style?.stackOnMobile ?? false;
  stackInput.onchange = () => commitStyle("stackOnMobile", stackInput.checked);
  stack.append(stackLabel, stackInput);
  layoutGroup.appendChild(stack);
  panel.appendChild(layoutGroup);

  const styleGroup = propertyGroup("Style");
  styleGroup.appendChild(
    labeledInput("Background", block.style?.background ?? "", (v) =>
      commitStyle("background", v),
    ),
  );
  styleGroup.appendChild(
    labeledInput("Text color", block.style?.color ?? "", (v) =>
      commitStyle("color", v),
    ),
  );
  styleGroup.appendChild(
    labeledInput("Padding", block.style?.padding ?? "", (v) =>
      commitStyle("padding", v),
    ),
  );
  styleGroup.appendChild(
    labeledInput("Margin", block.style?.margin ?? "", (v) =>
      commitStyle("margin", v),
    ),
  );
  styleGroup.appendChild(
    labeledInput("Radius", block.style?.radius ?? "", (v) =>
      commitStyle("radius", v),
    ),
  );
  const shadow = document.createElement("label");
  shadow.className = "meta-field";
  const shadowLabel = document.createElement("span");
  shadowLabel.textContent = "Shadow";
  const shadowSelect = document.createElement("select");
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
  const responsive = document.createElement("div");
  responsive.className = "responsive-note";
  responsive.innerHTML = `<strong>${state.currentViewport}</strong> override`;
  advancedGroup.appendChild(responsive);
  const currentResponsive =
    block.style?.responsive?.[state.currentViewport] ?? {};
  advancedGroup.appendChild(
    labeledInput("Viewport padding", currentResponsive.padding ?? "", (v) => {
      pushUndo();
      block.style = block.style ?? {};
      block.style.responsive = block.style.responsive ?? {};
      block.style.responsive[state.currentViewport] = {
        ...block.style.responsive[state.currentViewport],
        padding: v,
      };
      commitBlockChange(`Updated ${state.currentViewport} override`);
    }),
  );
  advancedGroup.appendChild(
    labeledInput("Viewport margin", currentResponsive.margin ?? "", (v) => {
      pushUndo();
      block.style = block.style ?? {};
      block.style.responsive = block.style.responsive ?? {};
      block.style.responsive[state.currentViewport] = {
        ...block.style.responsive[state.currentViewport],
        margin: v,
      };
      commitBlockChange(`Updated ${state.currentViewport} override`);
    }),
  );
  if (block.type === "section" || block.type === "card" || block.type === "html") {
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
        setStatus("Could not save reusable section: " + (result.error ?? "unknown"));
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
      "This page was detached from visual mode after a structural code edit. Reattach it from Page Settings to resume GUI editing.",
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
      state.managedStatus === "detached" ? getCode() || state.rawCode : serializeBlocks();
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

async function performSave(): Promise<void> {
  if (!state.project || !state.page) {
    setStatus("No page open to save.");
    return;
  }
  if (state.draftTimer !== null) {
    window.clearTimeout(state.draftTimer);
    state.draftTimer = null;
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
        return;
      }
      state.pageDocument = detached.pageDocument;
      state.siteDocument = detached.site;
      state.managedStatus = detached.pageDocument.managedFileStatus;
      state.visualEditable = false;
      state.generatedCode = detached.source ?? content;
    } else {
      const visualDoc = pageDocumentFromState();
      if (!visualDoc) {
        setStatus("Save failed: missing page document.");
        return;
      }
      const generated = await window.zephus.writePageDocument(
        state.project.path,
        state.project.astro.pagesDir,
        visualDoc,
      );
      if (!generated.ok || !generated.pageDocument) {
        setStatus("Save failed: " + (generated.error ?? "unknown"));
        return;
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
          return;
        }
        state.pageDocument = detached.pageDocument;
        state.siteDocument = detached.site;
        state.managedStatus = detached.pageDocument.managedFileStatus;
        state.visualEditable = false;
        state.generatedCode = normalizedGenerated;
        setStatus("Page detached from visual mode and saved as hand-authored Astro.");
      } else {
        state.pageDocument = generated.pageDocument;
        state.siteDocument = generated.site;
        state.managedStatus = generated.pageDocument.managedFileStatus;
        state.visualEditable = true;
        state.generatedCode = normalizedGenerated;
      }
    }
  } else {
    const doc = pageDocumentFromState();
    if (!doc) {
      setStatus("Save failed: missing page document.");
      return;
    }
    const saved = await window.zephus.writePageDocument(
      state.project.path,
      state.project.astro.pagesDir,
      doc,
    );
    if (!saved.ok || !saved.pageDocument) {
      setStatus("Save failed: " + (saved.error ?? "unknown"));
      return;
    }
    state.pageDocument = saved.pageDocument;
    state.siteDocument = saved.site;
    state.managedStatus = saved.pageDocument.managedFileStatus;
    state.visualEditable = true;
    state.generatedCode = saved.source ?? content;
  }
  state.rawCode = content;
  syncVisualModeState();
  if (state.mode === "code" && state.visualEditable) {
    const currentDoc = pageDocumentFromState();
    if (currentDoc) {
      state.blocks = blocksFromPageDocument(currentDoc);
    }
  }
  await window.zephus.clearDraft(state.project.path, state.page);
  clearChanges();
  markDirty(false);
  setStatus("Saved " + state.page);
  void refreshGit();
  await reloadPages();
}

async function save(): Promise<void> {
  if (!state.dirty) {
    await performSave();
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "save-summary";
  const intro = document.createElement("p");
  intro.textContent = `Save changes to ${currentPageLabel()}?`;
  wrap.appendChild(intro);
  const list = document.createElement("ul");
  list.className = "change-list";
  for (const item of state.changeSummary.length ? state.changeSummary : ["Visual changes"]) {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  }
  wrap.appendChild(list);
  showModalNode(
    "Save Changes",
    wrap,
    [
      { label: "Cancel", kind: "ghost", onClick: closeModal },
      {
        label: "Save",
        kind: "primary",
        onClick: async () => {
          closeModal();
          await performSave();
        },
      },
    ],
  );
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

async function togglePreview(): Promise<void> {
  if (!state.project) return;
  const frame = $("preview-frame") as HTMLIFrameElement;

  if (state.previewUrl) {
    await window.zephus.stopPreview();
    state.previewUrl = null;
    state.unsubLog?.();
    frame.classList.add("hidden");
    $("btn-preview").innerHTML = `<i data-lucide="play"></i> Start Preview`;
    refreshIcons();
    setMode(state.mode);
    setStatus("Preview stopped.");
    return;
  }

  if (state.dirty) {
    await performSave();
  }
  setStatus("Starting dev server (npm run dev)…");
  state.unsubLog = window.zephus.onPreviewLog((chunk) => {
    const logEl = $("dev-log");
    logEl.textContent += chunk;
    logEl.scrollTop = logEl.scrollHeight;
  });
  const result = await window.zephus.startPreview(state.project.path);
  if (!result.ok || !result.url) {
    setStatus("Preview failed: " + (result.error ?? "unknown error"));
    state.unsubLog?.();
    state.unsubLog = null;
    return;
  }
  state.previewUrl = result.url;
  frame.src = result.url;
  frame.classList.remove("hidden");
  $("canvas").classList.add("hidden");
  $("code-editor").classList.add("hidden");
  $("btn-preview").innerHTML = `<i data-lucide="square"></i> Stop Preview`;
  refreshIcons();
  setStatus("Preview running at " + result.url);
}

/* ---------- Publish ---------- */

async function publishSite(): Promise<void> {
  if (!state.project) return;
  setStatus("Building site for production (npm run build)…");
  const r = await window.zephus.publish(
    state.project.path,
    state.project.astro.outDir,
  );
  if (!r.ok) {
    showModal("Build Failed", r.error ?? "Unknown error during build.", [
      { label: "OK", kind: "primary", onClick: closeModal },
    ]);
    setStatus("Build failed.");
    return;
  }
  setStatus(
    "Build complete. Output: " + (r.outputDir ?? state.project.astro.outDir),
  );
  showModal(
    "Site Published",
    "Your production build is ready. The output folder has been opened in " +
      "your file manager. Deploy its contents to any static hosting provider.",
    [{ label: "OK", kind: "primary", onClick: closeModal }],
  );
}

/* ---------- Close ---------- */

async function closeProject(): Promise<void> {
  if (state.dirty) {
    if (appSettings?.autosave) {
      await performSave();
    } else if (!confirm(`Discard unsaved changes to ${currentPageLabel()}?`)) {
      return;
    }
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
  state.siteDocument = null;
  state.pageDocument = null;
  state.page = null;
  state.pageMeta = [];
  state.currentMeta = null;
  state.managedStatus = "missing";
  state.visualEditable = true;
  state.generatedCode = "";
  state.blocks = [];
  if (state.draftTimer !== null) {
    window.clearTimeout(state.draftTimer);
    state.draftTimer = null;
  }
  clearChanges();
  markDirty(false);
  $("view-editor").classList.add("hidden");
  $("view-start").classList.remove("hidden");
  void renderRecent();
  setStatus("");
}

/* ---------- Undo / redo ---------- */

function doUndo(): void {
  const prev = state.undo.pop();
  if (prev) {
    state.redo.push(cloneBlocks(state.blocks));
    state.blocks = cloneBlocks(prev);
    trackChange("Undid a visual change");
    markDirty(true);
    renderCanvas();
    renderProperties();
  }
}

function doRedo(): void {
  const next = state.redo.pop();
  if (next) {
    state.undo.push(cloneBlocks(state.blocks));
    state.blocks = cloneBlocks(next);
    trackChange("Redid a visual change");
    markDirty(true);
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
  }
}

/* ---------- Start view tabs and theme picker ---------- */

function initStartTabs(): void {
  const tabRecent = $("tab-recent");
  const tabCreate = $("tab-create");
  const paneRecent = $("pane-recent");
  const paneCreate = $("pane-create");

  tabRecent.onclick = () => {
    tabRecent.classList.add("active");
    tabCreate.classList.remove("active");
    paneRecent.classList.remove("hidden");
    paneCreate.classList.add("hidden");
  };

  tabCreate.onclick = async () => {
    tabCreate.classList.add("active");
    tabRecent.classList.remove("active");
    paneCreate.classList.remove("hidden");
    paneRecent.classList.add("hidden");
    await renderThemesInTab();
  };
}

function syncCreateButtonState(): void {
  const btnCreate = $("btn-create") as HTMLButtonElement;
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
  for (const card of Array.from(
    $("theme-list-container").querySelectorAll<HTMLElement>(".theme-card"),
  )) {
    const selected = card.dataset.themeId === themeId;
    card.classList.toggle("selected", selected);
    const label = card.querySelector<HTMLElement>(".theme-select-btn");
    if (label) {
      label.textContent = selected ? "Selected" : "Select";
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
  meta.innerHTML = `<p class="theme-preview-kicker">Read-only preview</p><p class="theme-preview-description">${theme.description}</p>`;

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

function buildThemeCard(theme: ThemeMeta): HTMLElement {
  const card = document.createElement("article");
  card.className = "theme-card";
  card.dataset.themeId = theme.id;
  card.tabIndex = 0;
  if (selectedTabTheme === theme.id) {
    card.classList.add("selected");
  }

  const previewUrl = previewUrlForTheme(theme);
  const preview = document.createElement("div");
  preview.className = "theme-card-preview";
  if (previewUrl) {
    const frame = document.createElement("iframe");
    frame.className = "theme-card-preview-frame";
    frame.src = previewUrl;
    frame.sandbox.add("allow-same-origin");
    frame.sandbox.add("allow-scripts");
    frame.title = `${theme.name} thumbnail preview`;
    preview.appendChild(frame);
  } else {
    preview.innerHTML = `<div class="theme-card-preview-empty">Preview unavailable</div>`;
  }

  const body = document.createElement("div");
  body.className = "theme-card-body";
  body.innerHTML = `<span class="t-name">${theme.name}</span><span class="t-desc">${theme.description}</span>`;

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
  card.append(preview, body, actions);

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
      container.appendChild(buildThemeCard(theme));
    }
    syncCreateButtonState();
  } catch (err) {
    container.innerHTML = `<p class="muted">Could not load themes: ${err}</p>`;
  }
}

async function createSiteFromTabFlow(): Promise<void> {
  if (!selectedTabTheme) return;
  const theme = selectedTabTheme;
  const folder = await window.zephus.chooseNewSiteFolder();
  if (!folder) return;
  setStatus("Creating site from theme…");
  const r = await window.zephus.createSite(folder, theme);
  if (!r.ok) {
    showModal("Could Not Create Site", r.error ?? "Unknown error.", [
      { label: "OK", kind: "primary", onClick: closeModal },
    ]);
    return;
  }
  await openProjectByPath(folder);
}

/* ---------- Wire up ---------- */

function init(): void {
  initStartTabs();
  $("btn-create").onclick = () => void createSiteFromTabFlow();
  $("btn-settings").onclick = () => void openSettingsModal();
  $("btn-open").onclick = () => void chooseFolder();
  $("btn-new-page").onclick = () => void newPageFlow();
  $("btn-regen-nav").onclick = () => void regenerateNav();
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
  await renderRecent();
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
    "Zephus is a local WYSIWYG website editor for Astro sites. " +
      "Create a new site from one of the bundled themes, or open an existing Zephus project. " +
      "Your sites live on your machine and are backed by Git — no account needed.",
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
