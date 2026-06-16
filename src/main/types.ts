// Shared type definitions for the Zephus main process and the preload bridge.

export interface AstroInfo {
  isAstro: boolean;
  version: string | null;
  srcDir: string;
  pagesDir: string;
  publicDir: string;
  outDir: string;
  configFile: string | null;
  configReadError: boolean;
}

export interface PackageValidation {
  exists: boolean;
  parseable: boolean;
  hasAstroDependency: boolean;
  hasDevScript: boolean;
  hasBuildScript: boolean;
  /** True when the project is ready to edit/preview in Zephus. */
  ready: boolean;
}

export interface ProjectOpenResult {
  ok: boolean;
  path: string;
  name: string;
  isGitRepo: boolean;
  isZephusProject: boolean;
  pkg: PackageValidation;
  astro: AstroInfo;
  schema: VisualSchemaStatus;
  /** Editable page paths relative to the project root. */
  pages: string[];
  error?: string;
}

export interface GitStatus {
  available: boolean;
  branch: string | null;
  detachedHead: boolean;
  modified: string[];
  added: string[];
  deleted: string[];
  /** True if .zephus/ is git-ignored (a misconfiguration). */
  zephusIgnored?: boolean;
  error?: string;
}

export interface GlobalSettings {
  recentProjects: string[];
  theme: "light" | "dark" | "system";
  lastOpenedProject: string | null;
  autoCheckUpdates: boolean;
  updateChannel: "stable" | "beta" | "developer" | "auto";
  restoreLastProject: boolean;
  confirmBlockDelete: boolean;
  autosave: boolean;
  codeFontSize: number;
  /** Optional explicit path to a Node.js binary for builds/previews. */
  customNodePath: string | null;
}

export interface RepoSettings {
  schemaVersion: number;
  editorRules: Record<string, unknown>;
}

export interface DevServerStartResult {
  ok: boolean;
  url: string | null;
  alreadyRunning: boolean;
  error?: string;
}

export interface ThemePreviewServerResult {
  ok: boolean;
  baseUrl: string | null;
  error?: string;
}

export interface ProductionLicenseEntry {
  packageId: string;
  name: string;
  version: string | null;
  licenses: string;
  repository: string | null;
  licenseUrl: string | null;
  parents: string[];
}

export interface ProductionLicensesResult {
  ok: boolean;
  entries: ProductionLicenseEntry[];
  filePath: string | null;
  error?: string;
}

export type ViewportKey = "desktop" | "tablet" | "mobile";

export interface BlockStyle {
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

export type EditorBlockType =
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
  | "feature"
  | "testimonial"
  | "accordion"
  | "stats"
  | "pricing"
  | "cta";

export interface EditorBlock {
  id: string;
  type: EditorBlockType;
  props: Record<string, string>;
  style?: BlockStyle;
  locked?: boolean;
  raw?: string;
}

export type ManagedFileStatus =
  | "managed"
  | "detached"
  | "out-of-sync"
  | "missing";

export interface AssetRef {
  id: string;
  src: string;
  alt: string;
}

export interface LinkRef {
  kind: "page" | "custom" | "mailto" | "anchor";
  href: string;
  page?: string;
}

export interface FormFieldDefinition {
  id: string;
  label: string;
  type: "text" | "email" | "textarea" | "tel";
  placeholder: string;
  required: boolean;
}

export interface FormDefinition {
  id: string;
  name: string;
  submitLabel: string;
  successMessage: string;
  action: string;
  method: "POST" | "GET";
  fields: FormFieldDefinition[];
}

export interface BlockNode extends EditorBlock {
  children?: BlockNode[];
  hidden?: boolean;
  asset?: AssetRef;
  link?: LinkRef;
  form?: FormDefinition;
}

export interface SectionNode {
  id: string;
  type: "section";
  label: string;
  props: Record<string, string>;
  style?: BlockStyle;
  locked?: boolean;
  hidden?: boolean;
  children: BlockNode[];
}

export interface DesignTokenSet {
  accent: string;
  background: string;
  foreground: string;
  surface: string;
  fontFamily: string;
  headingFontFamily: string;
  radius: string;
  shadow: "none" | "sm" | "md" | "lg";
  containerWidth: string;
  /** Optional Google Fonts stylesheet URL injected into the managed layout. */
  fontImportUrl?: string;
}

export interface NavItem {
  id: string;
  label: string;
  href: string;
  page?: string;
  visible: boolean;
  children: NavItem[];
}

export interface ShellConfig {
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

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  sections: SectionNode[];
}

export interface PageMeta {
  page: string;
  route: string;
  slug: string;
  title: string;
  navLabel: string;
  metaDescription: string;
  navVisible: boolean;
  isHome: boolean;
}

export interface PageDocument extends PageMeta {
  schemaVersion: number;
  templateId: string | null;
  sections: SectionNode[];
  detached: boolean;
  detachedAt: string | null;
  generatedHash: string | null;
  managedFileStatus: ManagedFileStatus;
}

export interface SiteDocument {
  schemaVersion: number;
  themeId: string;
  siteName: string;
  generatedAt: string;
  design: DesignTokenSet;
  shell: ShellConfig;
  templates: TemplateDefinition[];
}

export interface VisualSchemaStatus {
  exists: boolean;
  integrity: "ready" | "legacy" | "invalid";
  detachedPages: string[];
  pageDocumentCount: number;
}

export interface PageListResult {
  ok: boolean;
  entries: PageMeta[];
  error?: string;
}

export interface AssetEntry {
  webPath: string;
  fileName: string;
  size: number;
  category: AssetCategory;
}

export type AssetCategory = "images" | "media" | "documents" | "other";

export interface AssetListResult {
  ok: boolean;
  assets: AssetEntry[];
  error?: string;
}

export interface ReusableSection {
  id: string;
  label: string;
  html: string;
  updatedAt: string;
}

export interface ReusableSectionsResult {
  ok: boolean;
  sections: ReusableSection[];
  error?: string;
}

export type DraftScope = "page" | "site";

export interface DraftData {
  projectPath: string;
  scope: DraftScope;
  target: string;
  content: string;
  savedAt: string;
}

export interface DraftSummary {
  projectPath: string;
  scope: DraftScope;
  target: string;
  savedAt: string;
}

export interface DraftResult {
  ok: boolean;
  draft: DraftData | null;
  error?: string;
}

export interface DraftSummaryResult {
  ok: boolean;
  entries: DraftSummary[];
  error?: string;
}

export interface SiteDocumentResult {
  ok: boolean;
  site: SiteDocument | null;
  error?: string;
}

export interface PageDocumentResult {
  ok: boolean;
  site: SiteDocument | null;
  pageDocument: PageDocument | null;
  source: string | null;
  generatedSource: string | null;
  error?: string;
}

export interface SchemaEnsureResult {
  ok: boolean;
  status: VisualSchemaStatus | null;
  error?: string;
}

export interface OperationResult {
  ok: boolean;
  error?: string;
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  recentProjects: [],
  theme: "system",
  lastOpenedProject: null,
  autoCheckUpdates: true,
  updateChannel: "auto",
  restoreLastProject: false,
  confirmBlockDelete: true,
  autosave: false,
  codeFontSize: 13,
  customNodePath: null,
};

export const DEFAULT_REPO_SETTINGS: RepoSettings = {
  schemaVersion: 1,
  editorRules: {},
};

export const MAX_RECENT_PROJECTS = 10;
