import { describe, it, expect } from "vitest";
import {
  createEditorSession,
  trackPageChange,
  trackSiteChange,
  clearPageChanges,
  clearSiteChanges,
  markPageDirty,
  markSiteDirty,
  effectiveSiteDocument,
  isGlobalDirty,
  cloneSiteDocument,
} from "../editorSession";
import { cloneSections } from "../editorPageModel";
import type { SiteDocument } from "../../main/types";

describe("editorSession", () => {
  it("tracks change summaries without duplicates", () => {
    const state = createEditorSession();
    trackPageChange(state, "Edited text");
    trackPageChange(state, "Edited text");
    trackPageChange(state, "Moved block");
    expect(state.pageChangeSummary).toEqual(["Edited text", "Moved block"]);
    trackSiteChange(state, "Changed design");
    expect(state.siteChangeSummary).toEqual(["Changed design"]);
  });

  it("clears change summaries", () => {
    const state = createEditorSession();
    trackPageChange(state, "x");
    trackSiteChange(state, "y");
    clearPageChanges(state);
    clearSiteChanges(state);
    expect(state.pageChangeSummary).toEqual([]);
    expect(state.siteChangeSummary).toEqual([]);
  });

  it("markPageDirty bumps the revision and clears summaries on clean", () => {
    const state = createEditorSession();
    state.pageChangeSummary = ["stale"];
    markPageDirty(state, true);
    expect(state.pageRevision).toBe(1);
    expect(state.pageDirty).toBe(true);
    markPageDirty(state, false);
    expect(state.pageRevision).toBe(1);
    expect(state.pageChangeSummary).toEqual([]);
    expect(state.recoveredPageDraft).toBeNull();
  });

  it("markSiteDirty clears pending edits on clean", () => {
    const state = createEditorSession();
    state.pendingSiteDocument = { design: {} } as SiteDocument;
    state.pendingSiteEditorKind = "design";
    state.siteChangeSummary = ["stale"];
    markSiteDirty(state, false);
    expect(state.siteDirty).toBe(false);
    expect(state.pendingSiteDocument).toBeNull();
    expect(state.pendingSiteEditorKind).toBeNull();
    expect(state.siteChangeSummary).toEqual([]);
  });

  it("effectiveSiteDocument prefers pending over saved", () => {
    const state = createEditorSession();
    const saved = { design: { accent: "#000" } } as SiteDocument;
    const pending = { design: { accent: "#f00" } } as SiteDocument;
    state.siteDocument = saved;
    expect(effectiveSiteDocument(state)).toBe(saved);
    state.pendingSiteDocument = pending;
    expect(effectiveSiteDocument(state)).toBe(pending);
  });

  it("isGlobalDirty combines page and site dirtiness", () => {
    const state = createEditorSession();
    expect(isGlobalDirty(state)).toBe(false);
    markPageDirty(state, true);
    expect(isGlobalDirty(state)).toBe(true);
    markPageDirty(state, false);
    markSiteDirty(state, true);
    expect(isGlobalDirty(state)).toBe(true);
  });

  it("cloneSiteDocument deep-copies or returns null", () => {
    const site = { design: { accent: "#000" } } as SiteDocument;
    const copy = cloneSiteDocument(site);
    expect(copy).toEqual(site);
    expect(copy).not.toBe(site);
    expect(cloneSiteDocument(null)).toBeNull();
  });

  it("cloneSections deep-copies the section tree", () => {
    const state = createEditorSession();
    state.sections = [
      {
        id: "s1",
        type: "section",
        label: "Main",
        props: { wrapper: "none" },
        children: [{ id: "b1", type: "text", props: { text: "Hi" } }],
      },
    ];
    const copy = cloneSections(state.sections);
    expect(copy).toEqual(state.sections);
    expect(copy[0]).not.toBe(state.sections[0]);
    expect(copy[0]!.children[0]).not.toBe(state.sections[0]!.children[0]);
  });
});
