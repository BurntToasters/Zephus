import { describe, it, expect } from "vitest";
import {
  blocksFromSections,
  buildPageDocumentFromSections,
  cloneSections,
} from "../editorPageModel";

describe("editorPageModel", () => {
  it("clones sections deeply", () => {
    const sections = [
      {
        id: "s1",
        type: "section" as const,
        label: "Main",
        props: { wrapper: "none", cls: "" },
        children: [
          {
            id: "b1",
            type: "text" as const,
            props: { text: "Hi", cls: "" },
          },
        ],
      },
    ];
    const copy = cloneSections(sections);
    copy[0]!.children[0]!.props.text = "Changed";
    expect(sections[0]!.children[0]!.props.text).toBe("Hi");
  });

  it("flattens blocks from sections", () => {
    const blocks = blocksFromSections([
      {
        id: "s1",
        type: "section",
        label: "A",
        props: {},
        children: [
          { id: "b1", type: "text", props: { text: "one" } },
          { id: "b2", type: "heading", props: { text: "two", level: "2" } },
        ],
      },
    ]);
    expect(blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("builds a page document snapshot", () => {
    const base = {
      page: "old.astro",
      title: "T",
      sections: [],
    } as PageDocument;
    const doc = buildPageDocumentFromSections(base, "index.astro", [
      {
        id: "s1",
        type: "section",
        label: "Main",
        props: { wrapper: "none" },
        children: [],
      },
    ]);
    expect(doc.page).toBe("index.astro");
    expect(doc.sections).toHaveLength(1);
    expect(doc.title).toBe("T");
  });
});
