// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createIcons } from "../editorIcons";

const MOCK_ICON: [string, Record<string, unknown>][] = [
  ["path", { d: "M3 6h18" }],
];

beforeEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("editorIcons", () => {
  it("resolves kebab-case data-lucide names against PascalCase icon exports", () => {
    document.body.innerHTML = `
      <i data-lucide="trash-2" class="icon-sm"></i>
      <i data-lucide="sliders-horizontal"></i>
      <i data-lucide="layers-3"></i>
      <i data-lucide="edit-3"></i>
      <i data-lucide="grip-vertical"></i>
    `;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    createIcons({
      icons: {
        Trash2: MOCK_ICON,
        SlidersHorizontal: MOCK_ICON,
        Layers3: MOCK_ICON,
        Edit3: MOCK_ICON,
        GripVertical: MOCK_ICON,
      },
    });

    expect(warn).not.toHaveBeenCalled();
    expect(document.querySelectorAll("svg")).toHaveLength(5);
    expect(document.querySelector("svg.icon-sm")).not.toBeNull();
  });

  it("supports direct exact-key icon lookup alongside PascalCase lookup", () => {
    document.body.innerHTML = `<i data-lucide="Settings"></i>`;
    createIcons({
      icons: {
        Settings: MOCK_ICON,
      },
    });
    expect(document.querySelectorAll("svg")).toHaveLength(1);
  });
});
