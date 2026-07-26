import { describe, it, expect } from "vitest";
import { blockToHtmlForEditor } from "../editorBlockRender";
import { renderBlockNode } from "../../main/services/schema";
import { BUILD_MAX_HEADING_LEVEL } from "../../shared/blockRenderFixtures";

describe("editorBlockRender", () => {
  it("uses build heading cap when not rendering for canvas", () => {
    const block = {
      id: "h1",
      type: "heading" as const,
      props: { text: "Deep", level: "6", cls: "" },
    };
    const serialize = blockToHtmlForEditor(block, {
      viewport: "desktop",
      forCanvas: false,
      canvasMaxHeadingLevel: 3,
    });
    const build = renderBlockNode(block);
    expect(serialize).toBe(build);
    expect(serialize).toContain("<h6");
  });

  it("uses canvas heading cap when rendering for canvas", () => {
    const block = {
      id: "h1",
      type: "heading" as const,
      props: { text: "Deep", level: "6", cls: "" },
    };
    const canvas = blockToHtmlForEditor(block, {
      viewport: "desktop",
      forCanvas: true,
      canvasMaxHeadingLevel: 3,
    });
    expect(canvas).toContain("<h3");
    expect(canvas).not.toContain("<h6");

    const build = blockToHtmlForEditor(block, {
      viewport: "desktop",
      forCanvas: false,
      canvasMaxHeadingLevel: 3,
      serializeMaxHeadingLevel: BUILD_MAX_HEADING_LEVEL,
    });
    expect(build).toContain("<h6");
  });
});
