// Renderer-side typing for the preload bridge exposed on window.zephus.
// Kept independent of the main-process source (separate tsconfig rootDir).

interface PackageValidation {
  exists: boolean;
  parseable: boolean;
  hasAstroDependency: boolean;
  hasDevScript: boolean;
  hasBuildScript: boolean;
  ready: boolean;
}

interface AstroInfo {
  isAstro: boolean;
  version: string | null;
  srcDir: string;
  pagesDir: string;
  publicDir: string;
  outDir: string;
  configFile: string | null;
  configReadError: boolean;
}

interface ProjectOpenResult {
  ok: boolean;
  path: string;
  name: string;
  isGitRepo: boolean;
  isZephusProject: boolean;
  pkg: PackageValidation;
  astro: AstroInfo;
  schema: VisualSchemaStatus;
  pages: string[];
  error?: string;
}

interface GitStatus {
  available: boolean;
  branch: string | null;
  detachedHead: boolean;
  modified: string[];
  added: string[];
  deleted: string[];
  zephusIgnored?: boolean;
  notARepository?: boolean;
  hasRemote?: boolean;
  error?: string;
  ahead?: number;
  behind?: number;
}

interface GlobalSettings {
  recentProjects: string[];
  theme: "light" | "dark" | "system";
  lastOpenedProject: string | null;
  autoCheckUpdates: boolean;
  updateChannel: "stable" | "beta" | "developer" | "auto";
  restoreLastProject: boolean;
  confirmBlockDelete: boolean;
  autosave: boolean;
  codeFontSize: number;
  customNodePath: string | null;
}

interface NodeCheckResult {
  status: "ok" | "outdated" | "missing" | "unknown";
  version: string | null;
  binaryPath: string | null;
  usedCustomPath: boolean;
  message: string;
}

interface OperationResult {
  ok: boolean;
  error?: string;
}

interface ThemeMeta {
  id: string;
  name: string;
  description: string;
  previewPath: string;
}

interface DevServerStartResult {
  ok: boolean;
  url: string | null;
  alreadyRunning: boolean;
  error?: string;
}

interface ThemePreviewServerResult {
  ok: boolean;
  baseUrl: string | null;
  error?: string;
}

type ViewportKey = "desktop" | "tablet" | "mobile";

interface BlockStyle {
  align?: "left" | "center" | "right";
  width?: string;
  height?: string;
  maxWidth?: string;
  background?: string;
  color?: string;
  padding?: string;
  margin?: string;
  radius?: string;
  shadow?: "none" | "sm" | "md" | "lg";
  columns?: string;
  gap?: string;
  /** Image framing (non-destructive crop). */
  aspectRatio?: string;
  objectFit?: "cover" | "contain" | "fill";
  objectPosition?: string;
  stackOnMobile?: boolean;
  hideOn?: ViewportKey[];
  responsive?: Partial<
    Record<
      ViewportKey,
      {
        align?: "left" | "center" | "right";
        width?: string;
        height?: string;
        maxWidth?: string;
        padding?: string;
        margin?: string;
        columns?: string;
        gap?: string;
      }
    >
  >;
}

type EditorBlockType =
  | "heading"
  | "text"
  | "image"
  | "button"
  | "section"
  | "html"
  | "divider"
  | "spacer"
  | "columns"
  | "card"
  | "gallery"
  | "quote"
  | "list"
  | "embed"
  | "video"
  | "feature"
  | "testimonial"
  | "accordion"
  | "stats"
  | "pricing"
  | "cta"
  | "postlist";

interface EditorBlock {
  id: string;
  type: EditorBlockType;
  props: Record<string, string>;
  style?: BlockStyle;
  locked?: boolean;
  raw?: string;
}

type ManagedFileStatus = "managed" | "detached" | "out-of-sync" | "missing";

interface AssetRef {
  id: string;
  src: string;
  alt: string;
}

interface LinkRef {
  kind: "page" | "custom" | "mailto" | "anchor";
  href: string;
  page?: string;
}

interface FormFieldDefinition {
  id: string;
  label: string;
  type: "text" | "email" | "textarea" | "tel";
  placeholder: string;
  required: boolean;
}

interface FormDefinition {
  id: string;
  name: string;
  submitLabel: string;
  successMessage: string;
  action: string;
  method: "POST" | "GET";
  fields: FormFieldDefinition[];
}

interface BlockNode extends EditorBlock {
  children?: BlockNode[];
  asset?: AssetRef;
  link?: LinkRef;
  form?: FormDefinition;
}

interface SectionNode {
  id: string;
  type: "section";
  label: string;
  props: Record<string, string>;
  style?: BlockStyle;
  locked?: boolean;
  children: BlockNode[];
}

interface DesignTokenSet {
  accent: string;
  background: string;
  foreground: string;
  surface: string;
  fontFamily: string;
  headingFontFamily: string;
  radius: string;
  shadow: "none" | "sm" | "md" | "lg";
  containerWidth: string;
  fontImportUrl?: string;
}

interface NavItem {
  id: string;
  label: string;
  href: string;
  page?: string;
  visible: boolean;
  children: NavItem[];
}

interface ShellConfig {
  layoutMode: "legacy" | "managed";
  layoutPath: string;
  siteTitle: string;
  logoText: string;
  announcementText: string;
  announcementVisible: boolean;
  navItems: NavItem[];
  navCtaLabel: string;
  navCtaHref: string;
  footerHtml: string;
  customHeadHtml: string;
  customScriptsPath: string;
  customCssPath: string;
}

interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  sections: SectionNode[];
}

interface PageMeta {
  page: string;
  route: string;
  slug: string;
  title: string;
  navLabel: string;
  metaDescription: string;
  navVisible: boolean;
  isHome: boolean;
  /** True when the page is detached from visual editing (code only). */
  detached: boolean;
  /** Social share image (web path like `/assets/images/x.png`, or absolute URL). */
  socialImage: string;
  /** Overrides the canonical URL derived from the site URL + route. */
  canonicalUrl: string;
  /** Emits `robots: noindex` and excludes the page from sitemap.xml. */
  noindex: boolean;
    /** Publish date as `YYYY-MM-DD`. */
  publishDate: string;
  /** Display name of the author, shown by Post List blocks. */
  author: string;
}

interface PageDocument extends PageMeta {
  schemaVersion: number;
  sections: SectionNode[];
  detached: boolean;
  detachedAt: string | null;
  generatedHash: string | null;
  managedFileStatus: ManagedFileStatus;
}

interface SiteDocument {
  schemaVersion: number;
  themeId: string;
  siteName: string;
  generatedAt: string;
  design: DesignTokenSet;
  shell: ShellConfig;
    /** Public base URL (e.g. */
  siteUrl: string;
  /** BCP 47 language tag emitted as `<html lang>`. */
  language: string;
  /** Web-root-relative favicon path (e.g. `/assets/images/favicon.png`). */
  faviconPath: string;
}

interface VisualSchemaStatus {
  exists: boolean;
  integrity: "ready" | "legacy" | "invalid";
  detachedPages: string[];
  pageDocumentCount: number;
}

interface PageListResult {
  ok: boolean;
  entries: PageMeta[];
  error?: string;
}

interface AssetEntry {
  webPath: string;
  fileName: string;
  size: number;
  category: "images" | "media" | "documents" | "other";
}

interface AssetListResult {
  ok: boolean;
  assets: AssetEntry[];
  error?: string;
}

interface AssetUsagePage {
  page: string;
  label: string;
  count: number;
}

interface AssetUsageResult {
  ok: boolean;
  pages: AssetUsagePage[];
  /** Human-readable site-level places referencing the asset. */
  siteReferences: string[];
  error?: string;
}

interface AssetMutationResult {
  ok: boolean;
  /** Web path after the operation (rename only). */
  webPath?: string;
  /** References repointed to the new path (rename only). */
  updatedReferences?: number;
  error?: string;
}

interface SearchMatch {
  page: string;
  label: string;
  count: number;
  /** Short context snippets around the first matches. */
  excerpts: string[];
}

interface FindReplaceResult {
  ok: boolean;
  matches: SearchMatch[];
  totalMatches: number;
  /** Pages with matches that replaceAll will skip (detached/out-of-sync). */
  skippedDetachedPages?: number;
  error?: string;
}

interface ReplaceAllResult {
  ok: boolean;
  replaced: number;
  pagesChanged: number;
  error?: string;
}

interface ReusableSection {
  id: string;
  label: string;
  html: string;
  updatedAt: string;
}

interface ReusableSectionsResult {
  ok: boolean;
  sections: ReusableSection[];
  error?: string;
}

type DraftScope = "page" | "site";

interface DraftData {
  projectPath: string;
  scope: DraftScope;
  target: string;
  content: string;
  savedAt: string;
}

interface DraftSummary {
  projectPath: string;
  scope: DraftScope;
  target: string;
  savedAt: string;
}

interface DraftResult {
  ok: boolean;
  draft: DraftData | null;
  error?: string;
}

interface DraftSummaryResult {
  ok: boolean;
  entries: DraftSummary[];
  error?: string;
}

interface SiteDocumentResult {
  ok: boolean;
  site: SiteDocument | null;
  error?: string;
}

interface PageDocumentResult {
  ok: boolean;
  site: SiteDocument | null;
  pageDocument: PageDocument | null;
  source: string | null;
  generatedSource: string | null;
  error?: string;
}

interface SchemaEnsureResult {
  ok: boolean;
  status: VisualSchemaStatus | null;
  error?: string;
}

interface ProductionLicenseEntry {
  packageId: string;
  name: string;
  version: string | null;
  licenses: string;
  repository: string | null;
  licenseUrl: string | null;
  parents: string[];
}

interface ProductionLicensesResult {
  ok: boolean;
  entries: ProductionLicenseEntry[];
  filePath: string | null;
  error?: string;
}

interface RepoSettings {
  schemaVersion: number;
  editorRules: Record<string, unknown>;
}

interface UpdaterStatusPayload {
  status: string;
  version?: string;
  percent?: number;
  error?: string;
}

interface ZephusApi {
  openFolderDialog(): Promise<string | null>;
  chooseNewSiteFolder(): Promise<string | null>;
  openProject(projectPath: string): Promise<ProjectOpenResult>;
  listThemes(): Promise<ThemeMeta[]>;
  createSite(targetPath: string, themeId: string): Promise<OperationResult>;
  createPage(
    projectPath: string,
    pageName: string,
    pagesDir: string,
  ): Promise<OperationResult>;
  renamePage(
    projectPath: string,
    page: string,
    pagesDir: string,
    nextSlug: string,
  ): Promise<OperationResult>;
  duplicatePage(
    projectPath: string,
    page: string,
    pagesDir: string,
    slugInput?: string,
  ): Promise<OperationResult>;
  deletePage(
    projectPath: string,
    page: string,
    pagesDir: string,
  ): Promise<OperationResult>;
  listPageMeta(projectPath: string, pagesDir: string): Promise<PageListResult>;
  readPageMeta(
    projectPath: string,
    page: string,
    pagesDir: string,
  ): Promise<PageMeta>;
  writePageMeta(
    projectPath: string,
    page: string,
    pagesDir: string,
    partial: Partial<PageMeta>,
  ): Promise<OperationResult>;
  ensureVisualSchema(
    projectPath: string,
    pagesDir: string,
  ): Promise<SchemaEnsureResult>;
  readSiteDocument(projectPath: string): Promise<SiteDocumentResult>;
  writeSiteDocument(
    projectPath: string,
    site: SiteDocument,
    pagesDir: string,
  ): Promise<OperationResult>;
  readPageDocument(
    projectPath: string,
    page: string,
    pagesDir: string,
  ): Promise<PageDocumentResult>;
  writePageDocument(
    projectPath: string,
    pagesDir: string,
    doc: PageDocument,
  ): Promise<PageDocumentResult>;
  detachPageDocument(
    projectPath: string,
    page: string,
    pagesDir: string,
    source: string,
  ): Promise<PageDocumentResult>;
  reattachPageDocument(
    projectPath: string,
    page: string,
    pagesDir: string,
  ): Promise<PageDocumentResult>;
  getGitStatus(
    projectPath: string,
    options?: { fetchRemote?: boolean },
  ): Promise<GitStatus>;
  initGitRepo(projectPath: string): Promise<OperationResult>;
  commitGitChanges(
    projectPath: string,
    message: string,
    paths?: string[],
  ): Promise<OperationResult>;
  pushGitChanges(projectPath: string): Promise<OperationResult>;
  pullGitChanges(projectPath: string): Promise<OperationResult>;
  readGlobalSettings(): Promise<GlobalSettings>;
  writeGlobalSettings(settings: GlobalSettings): Promise<OperationResult>;
  removeRecentProject(projectPath: string): Promise<GlobalSettings>;
  readRepoSettings(projectPath: string): Promise<RepoSettings>;
  getMergedSettings(projectPath: string): Promise<{
    global: GlobalSettings;
    repo: { schemaVersion: number; editorRules: Record<string, unknown> };
    theme: "light" | "dark" | "system";
  }>;
  readProductionLicenses(): Promise<ProductionLicensesResult>;
  openProductionLicensesFile(): Promise<OperationResult>;
  readFile(
    projectPath: string,
    rel: string,
  ): Promise<{ ok: boolean; content?: string; error?: string }>;
  importAssets(
    projectPath: string,
    publicDir: string,
  ): Promise<{
    ok: boolean;
    imported: { webPath: string; category: string }[];
    errors: string[];
  }>;
  importAssetPaths(
    projectPath: string,
    publicDir: string,
    paths: string[],
  ): Promise<{
    ok: boolean;
    imported: { webPath: string; category: string }[];
    errors: string[];
  }>;
  getDroppedFilePath(file: File): string;
  listAssets(projectPath: string, publicDir: string): Promise<AssetListResult>;
  searchPages(
    projectPath: string,
    pagesDir: string,
    query: string,
    options: { caseSensitive?: boolean; wholeWord?: boolean },
  ): Promise<FindReplaceResult>;
  replaceAllInPages(
    projectPath: string,
    pagesDir: string,
    query: string,
    replacement: string,
    options: { caseSensitive?: boolean; wholeWord?: boolean },
    onlyPages?: string[],
  ): Promise<ReplaceAllResult>;
  deleteAsset(
    projectPath: string,
    publicDir: string,
    webPath: string,
  ): Promise<AssetMutationResult>;
  renameAsset(
    projectPath: string,
    publicDir: string,
    pagesDir: string,
    webPath: string,
    nextName: string,
  ): Promise<AssetMutationResult>;
  findAssetUsage(
    projectPath: string,
    pagesDir: string,
    webPath: string,
  ): Promise<AssetUsageResult>;
  readAssetDataUrl(
    projectPath: string,
    publicDir: string,
    webPath: string,
  ): Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  listReusableSections(projectPath: string): Promise<ReusableSectionsResult>;
  saveReusableSection(
    projectPath: string,
    label: string,
    html: string,
  ): Promise<ReusableSectionsResult>;
  deleteReusableSection(
    projectPath: string,
    id: string,
  ): Promise<OperationResult>;
  readDraft(
    projectPath: string,
    scope: DraftScope,
    target: string,
  ): Promise<DraftResult>;
  listDrafts(): Promise<DraftSummaryResult>;
  writeDraft(
    projectPath: string,
    scope: DraftScope,
    target: string,
    content: string,
  ): Promise<OperationResult>;
  clearDraft(
    projectPath: string,
    scope: DraftScope,
    target: string,
  ): Promise<OperationResult>;
  watchFile(projectPath: string, rel: string): Promise<OperationResult>;
  stopWatch(): Promise<OperationResult>;
  onExternalChange(callback: (rel: string) => void): () => void;
  listPages(projectPath: string, pagesDir: string): Promise<string[]>;
  startPreview(projectPath: string): Promise<DevServerStartResult>;
  stopPreview(): Promise<OperationResult>;
  openPreviewWindow(url: string): Promise<OperationResult>;
  closePreviewWindow(): Promise<OperationResult>;
  onPreviewClosed(callback: () => void): () => void;
  onPreviewExited(callback: () => void): () => void;
  onReloadRequested(callback: () => void): () => void;
  ensureThemePreviewServer(): Promise<ThemePreviewServerResult>;
  publish(
    projectPath: string,
    outDir: string,
  ): Promise<{
    ok: boolean;
    outputDir?: string;
    revealed?: boolean;
    error?: string;
  }>;
  onPublishLog(listener: (chunk: string) => void): () => void;
  revealOutputFolder(
    projectPath: string,
    outDir: string,
  ): Promise<OperationResult>;
  dependenciesInstalled(projectPath: string): Promise<boolean>;
  installDependencies(
    projectPath: string,
  ): Promise<{ ok: boolean; error?: string }>;
  cancelInstall(): Promise<OperationResult>;
  onInstallLog(callback: (chunk: string) => void): () => void;
  onPreviewLog(callback: (chunk: string) => void): () => void;
  checkForUpdates(): Promise<UpdaterStatusPayload>;
  downloadUpdate(): Promise<UpdaterStatusPayload>;
  cancelUpdateDownload(): Promise<OperationResult>;
  installUpdate(): Promise<OperationResult>;
  /** Cached updater status from main — closes the startup-check race. */
  getLastUpdaterStatus(): Promise<{
    status: string;
    version?: string;
    percent?: number;
    error?: string;
  } | null>;
  getAppVersion(): Promise<string>;
  openConfigFolder(): Promise<OperationResult>;
  getNodeStatus(): Promise<NodeCheckResult>;
  pickNodePath(): Promise<NodeCheckResult>;
  setNodePath(customPath: string | null): Promise<NodeCheckResult>;
  onUpdaterStatus(callback: (data: UpdaterStatusPayload) => void): () => void;
}

interface Window {
  zephus: ZephusApi;
  __zephusRunEditorSmoke?: () => string[] | Promise<string[]>;
  refreshIcons?: () => void;
    /** Set by the engine so programmatic quits (update install) bypass the unsaved-work close guard. */
  zephusMarkForceCloseAllowed?: () => void;
}
