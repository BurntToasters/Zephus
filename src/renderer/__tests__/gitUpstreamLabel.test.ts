import { describe, it, expect } from "vitest";
import {
  formatGitUpstreamLabel,
  formatGitUpstreamPanelNote,
} from "../gitUpstreamLabel";

describe("gitUpstreamLabel", () => {
  it("formats compact branch hints", () => {
    expect(formatGitUpstreamLabel(2, 0)).toBe(" ↑2");
    expect(formatGitUpstreamLabel(0, 3)).toBe(" ↓3");
    expect(formatGitUpstreamLabel(2, 1)).toBe(" ↑2 ↓1");
    expect(formatGitUpstreamLabel(0, 0)).toBe("");
    expect(formatGitUpstreamLabel(undefined, 1)).toBe("");
  });

  it("formats panel guidance", () => {
    expect(formatGitUpstreamPanelNote(0, 0)).toBeNull();
    expect(formatGitUpstreamPanelNote(3, 0)).toContain("3 local");
    expect(formatGitUpstreamPanelNote(0, 2)).toContain("fast-forward");
    expect(formatGitUpstreamPanelNote(1, 2)).toContain("Pull");
  });
});
