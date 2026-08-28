import { describe, it, expect } from "vitest";
import { collectUnsavedWorkSummaryLines } from "../editorUnsavedWork";

describe("editorUnsavedWork", () => {
  it("merges tracked page and site change labels", () => {
    expect(
      collectUnsavedWorkSummaryLines({
        pageDirty: true,
        pageChangeSummary: ["Edited heading"],
        pageFallbackLabel: "Page",
        siteDirty: true,
        siteChangeSummary: ["Changed accent"],
      }),
    ).toEqual(["Edited heading", "Changed accent"]);
  });

  it("uses fallbacks when dirty without tracked labels", () => {
    expect(
      collectUnsavedWorkSummaryLines({
        pageDirty: true,
        pageChangeSummary: [],
        pageFallbackLabel: "Unsaved page edits for Home",
        siteDirty: true,
        siteChangeSummary: [],
      }),
    ).toEqual([
      "Unsaved page edits for Home",
      "Unsaved site shell or design edits",
    ]);
  });

  it("returns empty when nothing is dirty", () => {
    expect(
      collectUnsavedWorkSummaryLines({
        pageDirty: false,
        pageChangeSummary: [],
        pageFallbackLabel: "x",
        siteDirty: false,
        siteChangeSummary: [],
      }),
    ).toEqual([]);
  });
});
