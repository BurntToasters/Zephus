// Zephus renderer logic. Talks to the main process exclusively through
// window.zephus (the preload bridge). No Node APIs are used here.
import { createCodeEditor, CodeEditor } from "./codeEditor";

type Mode = "visual" | "code";
type BlockType = "heading" | "text" | "image" | "button" | "section" | "html";

interface Block {
  id: string;
  type: BlockType;
  props: Record<string, string>;
  /** Verbatim markup for passthrough (html) blocks, preserved on save. */
  raw?: string;
}

const PALETTE: { type: BlockType; label: string }[] = [
  { type: "heading", label: "Heading" },
  { type: "text", label: "Text" },
  { type: "image", label: "Image" },
  { type: "button", label: "Button" },
  { type: "section", label: "Section" },
];

const TEXT_EDITABLE: BlockType[] = ["heading", "text", "button", "section"];

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
    id: "cta",
    label: "Call to action",
    html: `<section class="cta">
      <h2>Ready to begin?</h2>
      <a class="button" href="#">Contact us</a>
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
  page: null as string | null,
  mode: "visual" as Mode,
  blocks: [] as Block[],
  selectedId: null as string | null,
  rawCode: "",
  // Page structure preserved around the editable region.
  frontmatter: "",
  prefix: "",
  suffix: "",
  dirty: false,
  previewUrl: null as string | null,
  unsubLog: null as null | (() => void),
  unsubExternal: null as null | (() => void),
  undo: [] as Block[][],
  redo: [] as Block[][],
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

// Cached app settings, loaded at startup and refreshed on save.
let appSettings: GlobalSettings | null = null;

function setStatus(message: string): void {
  $("status-bar").textContent = message;
}

function uid(): string {
  return "b" + Math.random().toString(36).slice(2, 9);
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
}

/* ---------- Modal helpers ---------- */

interface ModalAction {
  label: string;
  kind?: "primary" | "danger" | "ghost";
  onClick: () => void;
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

function showModal(title: string, body: string, actions: ModalAction[]): void {
  $("modal-title").textContent = title;
  $("modal-body").textContent = body;
  buildActions(actions);
  $("modal-overlay").classList.remove("hidden");
}

function showModalNode(
  title: string,
  content: HTMLElement,
  actions: ModalAction[],
): void {
  $("modal-title").textContent = title;
  const body = $("modal-body");
  body.innerHTML = "";
  body.appendChild(content);
  buildActions(actions);
  $("modal-overlay").classList.remove("hidden");
}

function closeModal(): void {
  $("modal-overlay").classList.add("hidden");
}

/* ---------- Start view ---------- */

async function renderRecent(): Promise<void> {
  const settings = await window.zephus.readGlobalSettings();
  const list = $("recent-list");
  list.innerHTML = "";
  if (settings.recentProjects.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No recent projects yet.";
    list.appendChild(li);
    return;
  }
  for (const p of settings.recentProjects) {
    const li = document.createElement("li");
    const name = document.createElement("span");
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
  row.className = "check-row";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = id;
  input.checked = checked;
  const lbl = document.createElement("label");
  lbl.htmlFor = id;
  lbl.textContent = label;
  lbl.style.margin = "0";
  row.append(input, lbl);
  return { row, input };
}

function selectField(
  labelText: string,
  options: { value: string; label: string }[],
  current: string,
): { wrap: HTMLElement; select: HTMLSelectElement } {
  const wrap = document.createElement("div");
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

  // --- Updates ---
  const updHeader = document.createElement("label");
  updHeader.textContent = "Updates";
  updHeader.style.fontWeight = "600";
  form.appendChild(updHeader);

  const autoUpd = checkboxRow(
    "set-auto-update",
    "Check for updates on startup",
    settings.autoCheckUpdates,
  );
  form.appendChild(autoUpd.row);

  const chan = selectField(
    "Update channel",
    [
      { value: "auto", label: "Auto (match install)" },
      { value: "stable", label: "Stable" },
      { value: "beta", label: "Beta" },
    ],
    settings.updateChannel,
  );
  form.appendChild(chan.wrap);

  const checkNowBtn = document.createElement("button");
  checkNowBtn.className = "btn";
  checkNowBtn.style.marginTop = "8px";
  checkNowBtn.textContent = "Check for Updates Now";
  checkNowBtn.onclick = async () => {
    checkNowBtn.textContent = "Checking…";
    checkNowBtn.disabled = true;
    try {
      await window.zephus.checkForUpdates();
    } catch {
      /* status surfaced via updater-status listener */
    }
    checkNowBtn.textContent = "Check for Updates Now";
    checkNowBtn.disabled = false;
  };
  form.appendChild(checkNowBtn);

  // --- Appearance ---
  const apHeader = document.createElement("label");
  apHeader.textContent = "Appearance";
  apHeader.style.fontWeight = "600";
  apHeader.style.marginTop = "16px";
  form.appendChild(apHeader);

  const theme = selectField(
    "Theme",
    [
      { value: "system", label: "System" },
      { value: "dark", label: "Dark" },
      { value: "light", label: "Light" },
    ],
    settings.theme,
  );
  form.appendChild(theme.wrap);

  const fontSize = selectField(
    "Code editor font size",
    [12, 13, 14, 15, 16, 18].map((n) => ({
      value: String(n),
      label: `${n}px`,
    })),
    String(settings.codeFontSize),
  );
  form.appendChild(fontSize.wrap);

  // --- Editor behavior ---
  const edHeader = document.createElement("label");
  edHeader.textContent = "Editor";
  edHeader.style.fontWeight = "600";
  edHeader.style.marginTop = "16px";
  form.appendChild(edHeader);

  const restore = checkboxRow(
    "set-restore",
    "Reopen last project on launch",
    settings.restoreLastProject,
  );
  form.appendChild(restore.row);

  const autosave = checkboxRow(
    "set-autosave",
    "Autosave when switching pages or modes",
    settings.autosave,
  );
  form.appendChild(autosave.row);

  const confirmDel = checkboxRow(
    "set-confirm-del",
    "Confirm before deleting a block",
    settings.confirmBlockDelete,
  );
  form.appendChild(confirmDel.row);

  // --- Footer actions ---
  const ver = document.createElement("p");
  ver.className = "version-info";
  ver.textContent = "Zephus";
  form.appendChild(ver);
  window.zephus
    .getAppVersion()
    .then((v) => {
      ver.textContent = `Zephus v${v}`;
    })
    .catch(() => {
      ver.textContent = "Zephus";
    });

  const configBtn = document.createElement("button");
  configBtn.className = "btn ghost";
  configBtn.style.marginTop = "4px";
  configBtn.textContent = "Open Config Folder";
  configBtn.onclick = () => void window.zephus.openConfigFolder();
  form.appendChild(configBtn);

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

/* ---------- Create new site (theme picker) ---------- */

async function createSiteFlow(): Promise<void> {
  const themes = await window.zephus.listThemes();
  let selectedTheme: string | null = null;

  const wrap = document.createElement("div");
  const intro = document.createElement("p");
  intro.className = "muted";
  intro.textContent = "Choose a theme for your new site:";
  const grid = document.createElement("div");
  grid.className = "theme-grid";

  for (const theme of themes) {
    const card = document.createElement("button");
    card.className = "theme-card";
    card.innerHTML = `<span class="t-name">${theme.name}</span><span class="t-desc">${theme.description}</span>`;
    card.onclick = () => {
      selectedTheme = theme.id;
      for (const c of Array.from(grid.children)) c.classList.remove("selected");
      card.classList.add("selected");
    };
    grid.appendChild(card);
  }
  wrap.append(intro, grid);

  showModalNode("Create New Site", wrap, [
    { label: "Cancel", kind: "ghost", onClick: closeModal },
    {
      label: "Choose Folder & Create",
      kind: "primary",
      onClick: async () => {
        if (!selectedTheme) {
          setStatus("Select a theme first.");
          return;
        }
        const theme = selectedTheme;
        closeModal();
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
      },
    },
  ]);
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
            enterEditor(result);
          },
        },
        {
          label: "Initialize Git",
          kind: "primary",
          onClick: async () => {
            closeModal();
            await window.zephus.initGitRepo(folder);
            enterEditor(result);
          },
        },
      ],
    );
    return;
  }

  enterEditor(result);
}

/* ---------- Editor ---------- */

function enterEditor(result: ProjectOpenResult): void {
  $("view-start").classList.add("hidden");
  $("view-editor").classList.remove("hidden");
  $("project-name").textContent = result.name;
  ensureCodeEditor();
  void refreshGit();
  void applyRepoRules();
  void applyMergedTheme();
  renderPalette();
  renderTemplates();
  renderPageList(result);
  renderNavEditor(result);
  setMode("visual");

  // Subscribe once to external file-change notifications.
  state.unsubExternal?.();
  state.unsubExternal = window.zephus.onExternalChange((rel) => {
    if (rel === state.page) void onExternalChange();
  });

  setStatus("Ready — " + result.path);
}

async function refreshGit(): Promise<void> {
  if (!state.project) return;
  const git = await window.zephus.getGitStatus(state.project.path);
  const branch = $("git-branch");
  if (!git.available) branch.textContent = "git: unavailable";
  else if (git.detachedHead) branch.textContent = "detached HEAD";
  else branch.textContent = git.branch ?? "";

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
    return;
  }
  if (total === 0) {
    panel.innerHTML = '<p class="muted">No changes.</p>';
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
}

function renderPalette(): void {
  const palette = $("block-palette");
  palette.innerHTML = "";
  const allowed = editorRules.allowedBlocks;
  for (const item of PALETTE) {
    if (allowed && !allowed.includes(item.type)) continue;
    const li = document.createElement("li");
    li.textContent = item.label;
    li.draggable = true;
    li.dataset["type"] = item.type;
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/zephus-new", item.type);
    });
    palette.appendChild(li);
  }
}

function renderTemplates(): void {
  const palette = $("template-palette");
  palette.innerHTML = "";
  // Templates are HTML blocks; hide them if HTML blocks are disallowed.
  const allowed = editorRules.allowedBlocks;
  if (allowed && !allowed.includes("html")) {
    palette.innerHTML = '<li class="muted">Disabled by project rules.</li>';
    return;
  }
  for (const tpl of TEMPLATES) {
    const li = document.createElement("li");
    li.textContent = tpl.label;
    li.draggable = true;
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/zephus-template", tpl.id);
    });
    palette.appendChild(li);
  }
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

function renderNavEditor(result: ProjectOpenResult): void {
  const list = $("nav-list");
  list.innerHTML = "";
  if (result.pages.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No pages.";
    list.appendChild(li);
    return;
  }
  for (const page of result.pages) {
    const route = pageToRoute(page);
    const li = document.createElement("li");
    li.textContent = route === "/" ? "Home (/)" : route;
    li.draggable = true;
    list.appendChild(li);
  }
}

async function regenerateNav(): Promise<void> {
  if (!state.project) return;
  // Rebuild nav links from current page list, write into BaseLayout's <nav>.
  const layoutRel = "src/layouts/BaseLayout.astro";
  const res = await window.zephus.readFile(state.project.path, layoutRel);
  if (!res.ok) {
    setStatus("Could not read BaseLayout: " + (res.error ?? ""));
    return;
  }
  const pages = state.project.pages;
  const links = pages
    .map((p) => {
      const route = pageToRoute(p);
      const label =
        route === "/"
          ? "Home"
          : route
              .slice(1)
              .replace(/[-_]/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase());
      return `        <a href="${route}">${label}</a>`;
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
  if (result.pages.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No pages found.";
    list.appendChild(li);
    return;
  }
  for (const page of result.pages) {
    const li = document.createElement("li");
    li.textContent = page;
    li.onclick = () => void loadPage(page);
    list.appendChild(li);
  }
}

async function reloadPages(): Promise<void> {
  if (!state.project) return;
  const pages = await window.zephus.listPages(
    state.project.path,
    state.project.astro.pagesDir,
  );
  state.project.pages = pages;
  renderPageList(state.project);
}

async function newPageFlow(): Promise<void> {
  if (!state.project) return;
  const input = document.createElement("input");
  input.className = "text";
  input.placeholder = "page-name";
  const wrap = document.createElement("div");
  const label = document.createElement("p");
  label.className = "muted";
  label.textContent = "New pages inherit the project theme layout.";
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
        setStatus("Created page " + name);
      },
    },
  ]);
}

async function loadPage(page: string): Promise<void> {
  if (!state.project) return;
  if (state.dirty) {
    if (appSettings?.autosave) {
      await save();
    } else if (!confirm("Discard unsaved changes to the current page?")) {
      return;
    }
  }
  const res = await window.zephus.readFile(state.project.path, page);
  if (!res.ok) {
    setStatus("Could not read " + page + ": " + res.error);
    return;
  }
  state.page = page;
  state.rawCode = res.content ?? "";
  parsePage(state.rawCode);
  state.undo = [];
  state.redo = [];
  state.selectedId = null;
  markDirty(false);

  for (const li of Array.from($("page-list").children)) {
    li.classList.toggle("active", li.textContent === page);
  }
  setCode(state.rawCode);
  renderCanvas();
  renderProperties();

  // Watch the open file for external changes.
  await window.zephus.watchFile(state.project.path, page);
  setStatus("Editing " + page);
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
          if (page) {
            markDirty(false);
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

    if (/^h[1-6]$/.test(tag)) {
      blocks.push({
        id: uid(),
        type: "heading",
        props: { text: el.textContent ?? "", level: tag[1] ?? "2", cls },
      });
    } else if (tag === "p") {
      blocks.push({
        id: uid(),
        type: "text",
        props: { text: el.textContent ?? "", cls },
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
      });
    } else {
      // Unknown / structural element: preserve verbatim so nothing is lost.
      blocks.push({ id: uid(), type: "html", props: {}, raw: el.outerHTML });
    }
  }
  return blocks;
}

function clsAttr(props: Record<string, string>): string {
  const cls = props["cls"];
  const parts: string[] = [];
  if (cls) parts.push(`class="${cls}"`);
  const styles: string[] = [];
  if (props["_color"]) styles.push(`color:${props["_color"]}`);
  if (props["_bg"]) styles.push(`background:${props["_bg"]}`);
  if (props["_padding"]) styles.push(`padding:${props["_padding"]}`);
  if (props["_margin"]) styles.push(`margin:${props["_margin"]}`);
  if (styles.length) parts.push(`style="${styles.join(";")}"`);
  return parts.length ? " " + parts.join(" ") : "";
}

function blockToHtml(b: Block): string {
  switch (b.type) {
    case "heading": {
      const level = b.props["level"] ?? "2";
      return `<h${level}${clsAttr(b.props)}>${b.props["text"] ?? ""}</h${level}>`;
    }
    case "text":
      return `<p${clsAttr(b.props)}>${b.props["text"] ?? ""}</p>`;
    case "image":
      return `<img${clsAttr(b.props)} src="${b.props["src"] ?? ""}" alt="${b.props["alt"] ?? ""}" />`;
    case "button":
      return `<a${clsAttr(b.props)} href="${b.props["href"] ?? "#"}">${b.props["text"] ?? ""}</a>`;
    case "section":
      return `<section${clsAttr(b.props)}>${b.props["text"] ?? ""}</section>`;
    case "html":
      return b.raw ?? "";
  }
}

function serializeBlocks(): string {
  const body = state.blocks.map((b) => "    " + blockToHtml(b)).join("\n");
  return `${state.frontmatter}${state.prefix}\n${body}\n${state.suffix}`;
}

/* ---------- Canvas rendering + drag/drop ---------- */

let dropIndex = -1;
let indicator: HTMLElement | null = null;

function pushUndo(): void {
  state.undo.push(state.blocks.map((b) => ({ ...b, props: { ...b.props } })));
  if (state.undo.length > 50) state.undo.shift();
  state.redo = [];
}

function blockLabel(b: Block): string {
  if (b.type === "html") return "HTML / structural content (edit in Code view)";
  return "";
}

function renderCanvas(): void {
  const canvas = $("canvas");
  canvas.innerHTML = "";
  indicator = null;

  state.blocks.forEach((block, index) => {
    const el = document.createElement("div");
    el.className =
      "block" +
      (block.id === state.selectedId ? " selected" : "") +
      (block.type === "html" ? " html-block" : "");
    el.draggable = true;
    el.dataset["index"] = String(index);
    el.innerHTML = blockToHtml(block);
    el.title = blockLabel(block);

    el.onclick = (e) => {
      e.stopPropagation();
      state.selectedId = block.id;
      renderCanvas();
      renderProperties();
    };

    if (TEXT_EDITABLE.includes(block.type)) {
      el.ondblclick = (e) => {
        e.stopPropagation();
        startInlineEdit(el, block);
      };
    }

    el.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/zephus-move", String(index));
    });
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      dropIndex = after ? index + 1 : index;
      showIndicator(canvas, el, after);
    });
    el.addEventListener("drop", (e) => handleDrop(e));
    canvas.appendChild(el);
  });

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
  } else if (newType) {
    pushUndo();
    const block: Block = {
      id: uid(),
      type: newType as BlockType,
      props: defaultProps(newType as BlockType),
    };
    state.blocks.splice(target, 0, block);
    state.selectedId = block.id;
  } else if (moveFrom) {
    const from = Number(moveFrom);
    const moved = state.blocks[from];
    if (!moved) return;
    pushUndo();
    state.blocks.splice(from, 1);
    const adjusted = from < target ? target - 1 : target;
    state.blocks.splice(adjusted, 0, moved);
  } else {
    return;
  }
  dropIndex = -1;
  markDirty(true);
  renderCanvas();
  renderProperties();
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
      markDirty(true);
    }
    renderCanvas();
    renderProperties();
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
      return { text: "", cls: "" };
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
  const wrap = document.createElement("div");
  const label = document.createElement("label");
  label.textContent = key;
  const input = document.createElement("input");
  input.value = value;
  input.oninput = () => onChange(input.value);
  wrap.append(label, input);
  return wrap;
}

function renderProperties(): void {
  const panel = $("properties");
  const block = state.blocks.find((b) => b.id === state.selectedId);
  if (!block) {
    panel.innerHTML =
      '<p class="muted">Select a block to edit its properties.</p>';
    return;
  }
  panel.innerHTML = "";

  const commit = (key: string, value: string) => {
    pushUndo();
    block.props[key] = value;
    markDirty(true);
    renderCanvas();
  };

  if (block.type === "html") {
    panel.innerHTML =
      '<p class="muted">Raw HTML / structural block. Edit it in Code view.</p>';
  } else if (block.type === "heading") {
    panel.appendChild(
      labeledInput("text", block.props["text"] ?? "", (v) => commit("text", v)),
    );
    const wrap = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = "level (1-6)";
    const select = document.createElement("select");
    const maxLevel = editorRules.maxHeadingLevel;
    for (let i = 1; i <= maxLevel; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = "H" + i;
      if (String(i) === (block.props["level"] ?? "2")) opt.selected = true;
      select.appendChild(opt);
    }
    select.onchange = () => commit("level", select.value);
    wrap.append(label, select);
    panel.appendChild(wrap);
  } else if (block.type === "text" || block.type === "section") {
    const wrap = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = "text";
    const ta = document.createElement("textarea");
    ta.rows = 4;
    ta.value = block.props["text"] ?? "";
    ta.oninput = () => commit("text", ta.value);
    wrap.append(label, ta);
    panel.appendChild(wrap);
  } else if (block.type === "button") {
    panel.appendChild(
      labeledInput("text", block.props["text"] ?? "", (v) => commit("text", v)),
    );
    const hrefWrap = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = "link (href)";
    const input = document.createElement("input");
    input.value = block.props["href"] ?? "";
    const err = document.createElement("p");
    err.className = "err-msg hidden";
    input.oninput = () => {
      const v = input.value.trim();
      const valid = v === "" || /^(https?:\/\/|\/|#|mailto:)/.test(v);
      input.classList.toggle("prop-error", !valid);
      err.classList.toggle("hidden", valid);
      err.textContent = valid
        ? ""
        : "Use http(s)://, /path, #anchor or mailto:";
      if (valid) commit("href", v);
    };
    hrefWrap.append(label, input, err);
    panel.appendChild(hrefWrap);
  } else if (block.type === "image") {
    const srcWrap = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = "image";
    const pick = document.createElement("button");
    pick.className = "btn";
    pick.textContent = block.props["src"] ? "Replace Image…" : "Choose Image…";
    pick.onclick = async () => {
      if (!state.project) return;
      const r = await window.zephus.importImage(
        state.project.path,
        state.project.astro.publicDir,
      );
      if (r.ok && r.webPath) {
        commit("src", r.webPath);
        renderProperties();
      } else if (!r.canceled) {
        setStatus("Image import failed: " + (r.error ?? "unknown"));
      }
    };
    const srcView = document.createElement("p");
    srcView.className = "muted";
    srcView.textContent = block.props["src"] || "No image selected.";
    srcWrap.append(label, pick, srcView);
    panel.appendChild(srcWrap);
    panel.appendChild(
      labeledInput("alt text", block.props["alt"] ?? "", (v) =>
        commit("alt", v),
      ),
    );
  }

  if (block.type !== "html") {
    panel.appendChild(
      labeledInput("css class", block.props["cls"] ?? "", (v) =>
        commit("cls", v),
      ),
    );
  }

  // --- Style controls (color + spacing) ---
  if (block.type !== "html") {
    const styleSection = document.createElement("div");
    styleSection.style.marginTop = "16px";
    styleSection.innerHTML =
      '<label style="margin-bottom:8px;display:block">Style</label>';

    const colorRow = document.createElement("div");
    colorRow.style.display = "flex";
    colorRow.style.gap = "8px";
    colorRow.style.marginBottom = "8px";

    const colorLabel = document.createElement("span");
    colorLabel.textContent = "Color";
    colorLabel.style.fontSize = "12px";
    colorLabel.style.color = "var(--muted)";
    colorLabel.style.alignSelf = "center";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = block.props["_color"] || "#cdd6f4";
    colorInput.style.width = "32px";
    colorInput.style.height = "28px";
    colorInput.style.border = "none";
    colorInput.style.cursor = "pointer";
    colorInput.oninput = () => commit("_color", colorInput.value);

    const bgLabel = document.createElement("span");
    bgLabel.textContent = "Bg";
    bgLabel.style.fontSize = "12px";
    bgLabel.style.color = "var(--muted)";
    bgLabel.style.alignSelf = "center";

    const bgInput = document.createElement("input");
    bgInput.type = "color";
    bgInput.value = block.props["_bg"] || "#1e1e2e";
    bgInput.style.width = "32px";
    bgInput.style.height = "28px";
    bgInput.style.border = "none";
    bgInput.style.cursor = "pointer";
    bgInput.oninput = () => commit("_bg", bgInput.value);

    colorRow.append(colorLabel, colorInput, bgLabel, bgInput);
    styleSection.appendChild(colorRow);

    const padRow = document.createElement("div");
    padRow.style.display = "flex";
    padRow.style.gap = "8px";
    padRow.style.alignItems = "center";

    const padLabel = document.createElement("span");
    padLabel.textContent = "Padding";
    padLabel.style.fontSize = "12px";
    padLabel.style.color = "var(--muted)";

    const padInput = document.createElement("input");
    padInput.type = "text";
    padInput.placeholder = "e.g. 1rem 2rem";
    padInput.value = block.props["_padding"] || "";
    padInput.style.flex = "1";
    padInput.oninput = () => commit("_padding", padInput.value);
    padRow.append(padLabel, padInput);
    styleSection.appendChild(padRow);

    const mrgRow = document.createElement("div");
    mrgRow.style.display = "flex";
    mrgRow.style.gap = "8px";
    mrgRow.style.alignItems = "center";
    mrgRow.style.marginTop = "6px";

    const mrgLabel = document.createElement("span");
    mrgLabel.textContent = "Margin";
    mrgLabel.style.fontSize = "12px";
    mrgLabel.style.color = "var(--muted)";

    const mrgInput = document.createElement("input");
    mrgInput.type = "text";
    mrgInput.placeholder = "e.g. 0 0 1rem 0";
    mrgInput.value = block.props["_margin"] || "";
    mrgInput.style.flex = "1";
    mrgInput.oninput = () => commit("_margin", mrgInput.value);
    mrgRow.append(mrgLabel, mrgInput);
    styleSection.appendChild(mrgRow);

    panel.appendChild(styleSection);
  }

  const dup = document.createElement("button");
  dup.className = "btn";
  dup.style.marginTop = "16px";
  dup.textContent = "Duplicate";
  dup.onclick = () => {
    pushUndo();
    const idx = state.blocks.findIndex((b) => b.id === block.id);
    const copy: Block = {
      ...block,
      id: uid(),
      props: { ...block.props },
    };
    state.blocks.splice(idx + 1, 0, copy);
    state.selectedId = copy.id;
    markDirty(true);
    renderCanvas();
    renderProperties();
  };
  panel.appendChild(dup);

  const del = document.createElement("button");
  del.className = "btn danger";
  del.style.marginTop = "8px";
  del.textContent = "Delete Block";
  del.onclick = () => {
    if (appSettings?.confirmBlockDelete && !confirm("Delete this block?")) {
      return;
    }
    pushUndo();
    state.blocks = state.blocks.filter((b) => b.id !== block.id);
    state.selectedId = null;
    markDirty(true);
    renderCanvas();
    renderProperties();
  };
  panel.appendChild(del);
}

/* ---------- Mode switching ---------- */

function setMode(mode: Mode): void {
  state.mode = mode;
  $("mode-visual").classList.toggle("active", mode === "visual");
  $("mode-code").classList.toggle("active", mode === "code");
  const codeEl = $("code-editor");

  if (mode === "code") {
    state.rawCode = serializeBlocks();
    setCode(state.rawCode);
    codeEl.classList.remove("hidden");
    $("canvas").classList.add("hidden");
    $("preview-frame").classList.add("hidden");
    cm?.focus();
  } else {
    const codeVal = getCode();
    if (codeVal !== state.rawCode) {
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

async function save(): Promise<void> {
  if (!state.project || !state.page) {
    setStatus("No page open to save.");
    return;
  }
  const content = state.mode === "code" ? getCode() : serializeBlocks();
  const r = await window.zephus.writeFile(
    state.project.path,
    state.page,
    content,
  );
  if (!r.ok) {
    setStatus("Save failed: " + r.error);
    return;
  }
  state.rawCode = content;
  if (state.mode === "code") parsePage(content);
  markDirty(false);
  setStatus("Saved " + state.page);
  void refreshGit();
}

/* ---------- Preview + responsive viewport ---------- */

function setViewport(vp: "desktop" | "tablet" | "mobile"): void {
  const wrap = document.querySelector(".canvas-wrap");
  if (!wrap) return;
  wrap.classList.remove("vp-tablet", "vp-mobile");
  if (vp === "tablet") wrap.classList.add("vp-tablet");
  if (vp === "mobile") wrap.classList.add("vp-mobile");
  $("vp-desktop").classList.toggle("active", vp === "desktop");
  $("vp-tablet").classList.toggle("active", vp === "tablet");
  $("vp-mobile").classList.toggle("active", vp === "mobile");
}

async function togglePreview(): Promise<void> {
  if (!state.project) return;
  const frame = $("preview-frame") as HTMLIFrameElement;

  if (state.previewUrl) {
    await window.zephus.stopPreview();
    state.previewUrl = null;
    state.unsubLog?.();
    frame.classList.add("hidden");
    $("btn-preview").textContent = "Start Preview";
    setMode(state.mode);
    setStatus("Preview stopped.");
    return;
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
  $("btn-preview").textContent = "Stop Preview";
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
  if (state.previewUrl) {
    await window.zephus.stopPreview();
    state.previewUrl = null;
    state.unsubLog?.();
  }
  await window.zephus.stopWatch();
  state.unsubExternal?.();
  state.unsubExternal = null;
  state.project = null;
  state.page = null;
  state.blocks = [];
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
    state.redo.push(state.blocks);
    state.blocks = prev;
    markDirty(true);
    renderCanvas();
    renderProperties();
  }
}

function doRedo(): void {
  const next = state.redo.pop();
  if (next) {
    state.undo.push(state.blocks);
    state.blocks = next;
    markDirty(true);
    renderCanvas();
    renderProperties();
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (state.mode !== "visual") return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === "z" && !e.shiftKey) {
    doUndo();
    e.preventDefault();
  } else if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
    doRedo();
    e.preventDefault();
  } else if (mod && e.key === "s") {
    void save();
    e.preventDefault();
  }
}

/* ---------- Wire up ---------- */

function init(): void {
  $("btn-create").onclick = () => void createSiteFlow();
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
          void createSiteFlow();
        },
      },
      { label: "I'll look around first", kind: "ghost", onClick: closeModal },
    ],
  );
}

document.addEventListener("DOMContentLoaded", init);
