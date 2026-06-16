export type SiteEditorKind = "shell" | "design" | null;

/** A unified undo entry: page sections + the site design/shell at capture time. */
export interface EditorSnapshot {
  sections: SectionNode[];
  site: SiteDocument | null;
}

export interface EditorSessionState {
  project: ProjectOpenResult | null;
  siteDocument: SiteDocument | null;
  pendingSiteDocument: SiteDocument | null;
  pendingSiteEditorKind: SiteEditorKind;
  pageDocument: PageDocument | null;
  page: string | null;
  pageMeta: PageMeta[];
  currentMeta: PageMeta | null;
  managedStatus: ManagedFileStatus;
  visualEditable: boolean;
  generatedCode: string;
  mode: "visual" | "code";
  sections: SectionNode[];
  blocks: EditorBlock[];
  selectedId: string | null;
  selectedSectionId: string | null;
  rawCode: string;
  frontmatter: string;
  prefix: string;
  suffix: string;
  pageDirty: boolean;
  siteDirty: boolean;
  currentViewport: ViewportKey;
  pageChangeSummary: string[];
  siteChangeSummary: string[];
  previewUrl: string | null;
  unsubLog: null | (() => void);
  unsubExternal: null | (() => void);
  undo: EditorSnapshot[];
  redo: EditorSnapshot[];
  draftTimer: number | null;
  recoveredPageDraft: DraftData | null;
  recoveredSiteDraft: DraftData | null;
}

export function createEditorSession(): EditorSessionState {
  return {
    project: null,
    siteDocument: null,
    pendingSiteDocument: null,
    pendingSiteEditorKind: null,
    pageDocument: null,
    page: null,
    pageMeta: [],
    currentMeta: null,
    managedStatus: "missing",
    visualEditable: true,
    generatedCode: "",
    mode: "visual",
    sections: [],
    blocks: [],
    selectedId: null,
    selectedSectionId: null,
    rawCode: "",
    frontmatter: "",
    prefix: "",
    suffix: "",
    pageDirty: false,
    siteDirty: false,
    currentViewport: "desktop",
    pageChangeSummary: [],
    siteChangeSummary: [],
    previewUrl: null,
    unsubLog: null,
    unsubExternal: null,
    undo: [],
    redo: [],
    draftTimer: null,
    recoveredPageDraft: null,
    recoveredSiteDraft: null,
  };
}

export function cloneSiteDocument(
  site: SiteDocument | null,
): SiteDocument | null {
  return site ? (JSON.parse(JSON.stringify(site)) as SiteDocument) : null;
}

export function effectiveSiteDocument(
  state: EditorSessionState,
): SiteDocument | null {
  return state.pendingSiteDocument ?? state.siteDocument;
}

export function isGlobalDirty(state: EditorSessionState): boolean {
  return state.pageDirty || state.siteDirty;
}

export function markPageDirty(state: EditorSessionState, dirty: boolean): void {
  state.pageDirty = dirty;
  if (!dirty) {
    state.pageChangeSummary = [];
    state.recoveredPageDraft = null;
  }
}

export function markSiteDirty(state: EditorSessionState, dirty: boolean): void {
  state.siteDirty = dirty;
  if (!dirty) {
    state.siteChangeSummary = [];
    state.recoveredSiteDraft = null;
    state.pendingSiteDocument = null;
    state.pendingSiteEditorKind = null;
  }
}

export function trackPageChange(
  state: EditorSessionState,
  label: string,
): void {
  if (!state.pageChangeSummary.includes(label)) {
    state.pageChangeSummary.push(label);
  }
}

export function trackSiteChange(
  state: EditorSessionState,
  label: string,
): void {
  if (!state.siteChangeSummary.includes(label)) {
    state.siteChangeSummary.push(label);
  }
}

export function clearPageChanges(state: EditorSessionState): void {
  state.pageChangeSummary = [];
}

export function clearSiteChanges(state: EditorSessionState): void {
  state.siteChangeSummary = [];
}
