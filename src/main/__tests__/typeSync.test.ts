import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * The EditorBlockType union is declared in BOTH src/main/types.ts and
 * src/renderer/zephus.d.ts and must stay in sync (the documented invariant).
 * The two files live under separate tsconfig rootDirs, so a one-sided edit
 * compiles cleanly and silently breaks editor/build render parity at runtime.
 * This guard parses the union members from each source and fails if they
 * diverge.
 */
function extractBlockTypes(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  const match = /EditorBlockType\s*=\s*([\s\S]*?);/.exec(source);
  if (!match) {
    throw new Error(`Could not find EditorBlockType union in ${file}`);
  }
  const members = match[1]!.match(/"([^"]+)"/g);
  if (!members) {
    throw new Error(`No union members found in ${file}`);
  }
  return members.map((m) => m.replace(/"/g, "")).sort();
}

describe("EditorBlockType sync", () => {
  const mainTypes = path.join(__dirname, "..", "types.ts");
  const rendererTypes = path.join(
    __dirname,
    "..",
    "..",
    "renderer",
    "zephus.d.ts",
  );

  it("declares the same block types in types.ts and zephus.d.ts", () => {
    const main = extractBlockTypes(mainTypes);
    const renderer = extractBlockTypes(rendererTypes);
    expect(renderer).toEqual(main);
  });

  it("includes all 20 known block types", () => {
    const main = extractBlockTypes(mainTypes);
    expect(main).toHaveLength(20);
    expect(main).toEqual(
      [
        "accordion",
        "button",
        "card",
        "columns",
        "cta",
        "divider",
        "embed",
        "feature",
        "gallery",
        "heading",
        "html",
        "image",
        "list",
        "pricing",
        "quote",
        "section",
        "spacer",
        "stats",
        "testimonial",
        "text",
      ].sort(),
    );
  });
});
