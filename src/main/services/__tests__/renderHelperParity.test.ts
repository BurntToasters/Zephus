import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SHARED_HELPERS_MODULE = "../../shared/renderHelpers";

describe("render helper sourcing", () => {
  const schemaSrc = fs.readFileSync(
    path.join(__dirname, "..", "schema.ts"),
    "utf8",
  );
  const engineSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "renderer", "zephusEngine.ts"),
    "utf8",
  );

  it("schema.ts imports shared render helpers", () => {
    expect(schemaSrc).toContain(SHARED_HELPERS_MODULE);
    expect(schemaSrc).not.toMatch(/function escapeHtml\(/);
  });

  it("zephusEngine.ts routes rendering through the shared modules", () => {
    // The engine must never reimplement sanitization: escaping/URL/rich-text
    // helpers live in the shared modules and the extracted editor modules.
    expect(engineSrc).toContain("./editorBlockRender");
    expect(engineSrc).toContain("./editorInlineEdit");
    expect(engineSrc).toContain("./editorResize");
    expect(engineSrc).not.toMatch(/function escapeHtml\(/);
    expect(engineSrc).not.toMatch(/function safeUrl\(/);
    expect(engineSrc).not.toMatch(/function richTextToHtml\(/);
    expect(engineSrc).not.toMatch(/function plainTextToHtml\(/);
  });

  it("schema.ts imports shared block renderer", () => {
    expect(schemaSrc).toContain("shared/blockRender");
    expect(schemaSrc).not.toMatch(/case "heading":/);
  });
});
