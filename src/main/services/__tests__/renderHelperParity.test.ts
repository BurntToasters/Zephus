import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * The build renderer (schema.ts renderBlockNode) and the editor renderer
 * (zephusEngine.ts blockToHtml) must emit byte-identical markup. They share a
 * set of pure helper functions that are hand-mirrored in both files; the
 * documented invariant is that these stay byte-identical. Until the two
 * renderers are unified into one physical module, this guard fails the build if
 * any mirrored helper diverges between the two files.
 */
const SHARED_HELPERS = [
  "escapeHtml",
  "escapeAttr",
  "safeUrl",
  "encodeDataPayload",
  "plainTextToHtml",
  "splitLines",
  "splitPair",
  "renderListItems",
  "blockCssValue",
  "addCssValue",
];

/** Extracts a `function name(...) { ... }` body using brace matching. */
function extractFunction(source: string, name: string): string {
  const head = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  if (!head) throw new Error(`Function ${name} not found`);
  let i = source.indexOf("{", head.index);
  if (i < 0) throw new Error(`Function ${name} has no body`);
  let depth = 0;
  const start = i;
  for (; i < source.length; i += 1) {
    const c = source[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        return source
          .slice(start, i + 1)
          .replace(/\s+/g, " ")
          .trim();
      }
    }
  }
  throw new Error(`Unbalanced braces in ${name}`);
}

describe("render helper parity (schema.ts vs zephusEngine.ts)", () => {
  const schemaSrc = fs.readFileSync(
    path.join(__dirname, "..", "schema.ts"),
    "utf8",
  );
  const engineSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "renderer", "zephusEngine.ts"),
    "utf8",
  );

  it.each(SHARED_HELPERS)("%s is byte-identical in both renderers", (name) => {
    expect(extractFunction(engineSrc, name)).toEqual(
      extractFunction(schemaSrc, name),
    );
  });
});
