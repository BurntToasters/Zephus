/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { appendCappedLog, MAX_EDITOR_LOG_CHARS } from "../editorLog";

describe("editorLog", () => {
  it("appends and scrolls", () => {
    const el = document.createElement("pre");
    Object.defineProperty(el, "scrollHeight", {
      value: 100,
      configurable: true,
    });
    appendCappedLog(el, "line1\n");
    appendCappedLog(el, "line2");
    expect(el.textContent).toBe("line1\nline2");
    expect(el.scrollTop).toBe(100);
  });

  it("trims from the front when over the cap", () => {
    const el = document.createElement("pre");
    const chunk = "a".repeat(MAX_EDITOR_LOG_CHARS);
    el.textContent = chunk;
    appendCappedLog(el, "bbb", 10);
    expect(el.textContent).toHaveLength(10);
    expect(el.textContent?.endsWith("bbb")).toBe(true);
  });
});
