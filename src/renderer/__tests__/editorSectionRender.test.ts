// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  blockToHtmlForEditor,
  sectionToHtmlForEditor,
} from "../editorBlockRender";

const options = {
  viewport: "desktop" as const,
  forCanvas: true,
  canvasMaxHeadingLevel: 3,
};

describe("editor block/section render", () => {
  it("renders a block for the editor with canvas sanitization", () => {
    const html = blockToHtmlForEditor(
      {
        id: "b1",
        type: "html",
        props: {},
        raw: "<div>safe</div><script>alert(1)</script>",
      },
      options,
    );
    expect(html).toContain("<div>safe</div>");
    expect(html).not.toContain("<script");
  });

  it("renders a section body wrapped in its shell", () => {
    const html = sectionToHtmlForEditor(
      {
        id: "s1",
        type: "section",
        label: "Main",
        props: { wrapper: "none", cls: "band" },
        children: [
          {
            id: "b1",
            type: "heading",
            props: { text: "Hi", level: "2", cls: "" },
          },
        ],
      },
      options,
    );
    expect(html).toContain('class="band"');
    expect(html).toContain("Hi");
  });

  it("serializes without canvas sanitization when not on canvas", () => {
    const html = blockToHtmlForEditor(
      { id: "b1", type: "html", props: {}, raw: "<b>raw</b>" },
      { ...options, forCanvas: false },
    );
    expect(html).toContain("<b>raw</b>");
  });

  it("caps heading levels to the canvas maximum on the canvas", () => {
    const html = blockToHtmlForEditor(
      {
        id: "b1",
        type: "heading",
        props: { text: "Deep", level: "5", cls: "" },
      },
      { viewport: "desktop", forCanvas: true, canvasMaxHeadingLevel: 3 },
    );
    expect(html).toContain("<h3 ");
  });
});
