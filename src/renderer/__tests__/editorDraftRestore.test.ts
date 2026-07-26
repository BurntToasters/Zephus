import { describe, it, expect } from "vitest";
import {
  formatPageDraftRestoreMessage,
  formatSiteDraftRestoreMessage,
  siteDraftContentMatchesSaved,
} from "../editorDraftRestore";

describe("editorDraftRestore", () => {
  it("formats page restore copy", () => {
    const msg = formatPageDraftRestoreMessage(
      "Home",
      "2026-01-15T12:00:00.000Z",
    );
    expect(msg).toContain("Home");
    expect(msg).toContain("Restore it?");
  });

  it("formats site restore copy", () => {
    const msg = formatSiteDraftRestoreMessage("2026-01-15T12:00:00.000Z");
    expect(msg).toContain("site-level");
    expect(msg).toContain("Restore them?");
  });

  it("detects site draft identical to saved document", () => {
    const site = { design: { accent: "#111" } } as SiteDocument;
    const content = JSON.stringify(site, null, 2);
    expect(siteDraftContentMatchesSaved(content, site)).toBe(true);
    expect(
      siteDraftContentMatchesSaved('{"design":{"accent":"#222"}}', site),
    ).toBe(false);
  });
});
