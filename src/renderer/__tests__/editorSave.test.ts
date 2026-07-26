import { describe, it, expect } from "vitest";
import { formatSaveStatusMessage } from "../editorSave";

describe("editorSave", () => {
  describe("formatSaveStatusMessage", () => {
    it("describes page and site saves", () => {
      expect(formatSaveStatusMessage(true, true, "index.astro")).toBe(
        "Saved index.astro and site settings.",
      );
    });

    it("describes page-only save", () => {
      expect(formatSaveStatusMessage(true, false, "about.astro")).toBe(
        "Saved about.astro",
      );
    });

    it("describes site-only save", () => {
      expect(formatSaveStatusMessage(false, true, null)).toBe(
        "Saved site settings.",
      );
    });

    it("reports nothing saved", () => {
      expect(formatSaveStatusMessage(false, false, "index.astro")).toBe(
        "Nothing to save.",
      );
    });
  });
});
