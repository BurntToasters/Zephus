// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  updateLineValue,
  targetCurrentValue,
  applyInlineValue,
} from "../editorInlineEdit";
import type { EditorBlock } from "../../main/types";

describe("line-encoded prop helpers", () => {
  it("updateLineValue replaces a whole line", () => {
    expect(updateLineValue("a\nb\nc", 1, "B")).toBe("a\nB\nc");
  });

  it("updateLineValue pads missing lines", () => {
    expect(updateLineValue("a", 3, "d")).toBe("a\n\n\nd");
  });

  it("updateLineValue writes one side of a pair", () => {
    expect(updateLineValue("one :: two\nx :: y", 0, "ONE", "left")).toBe(
      "ONE :: two\nx :: y",
    );
    expect(updateLineValue("one :: two\nx :: y", 1, "YY", "right")).toBe(
      "one :: two\nx :: YY",
    );
  });

  it("updateLineValue treats a missing pair as an empty side", () => {
    expect(updateLineValue("bare", 0, "left", "left")).toBe("left :: ");
    // No separator: the whole line is the left side.
    expect(updateLineValue("bare", 0, "right", "right")).toBe("bare :: right");
  });

  it("targetCurrentValue reads the right side of a pair", () => {
    const block = {
      id: "b",
      type: "stats",
      props: { items: "10k :: users\n99% :: uptime" },
    } as unknown as EditorBlock;
    expect(
      targetCurrentValue(block, {
        prop: "items",
        lineIndex: 0,
        pairSide: "left",
      }),
    ).toBe("10k");
    expect(
      targetCurrentValue(block, {
        prop: "items",
        lineIndex: 1,
        pairSide: "right",
      }),
    ).toBe("uptime");
  });

  it("targetCurrentValue returns the whole prop for non-line targets", () => {
    const block = {
      id: "b",
      type: "text",
      props: { text: "plain" },
    } as unknown as EditorBlock;
    expect(targetCurrentValue(block, { prop: "text" })).toBe("plain");
  });

  it("applyInlineValue writes back into the encoded prop", () => {
    const block = {
      id: "b",
      type: "accordion",
      props: { items: "Q :: A" },
    } as unknown as EditorBlock;
    applyInlineValue(
      block,
      { prop: "items", lineIndex: 0, pairSide: "right" },
      "New A",
    );
    expect(block.props["items"]).toBe("Q :: New A");

    const list = {
      id: "l",
      type: "list",
      props: { items: "One\nTwo" },
    } as unknown as EditorBlock;
    applyInlineValue(list, { prop: "items", lineIndex: 1 }, "Edited");
    expect(list.props["items"]).toBe("One\nEdited");
  });
});
