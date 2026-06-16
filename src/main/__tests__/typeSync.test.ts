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

/**
 * The shared data interfaces (BlockNode, SiteDocument, PageDocument, etc.) are
 * hand-duplicated across types.ts and zephus.d.ts. Only the EditorBlockType
 * union was previously guarded, so adding/renaming a field on one side drifted
 * silently. This compares the top-level field names of every interface that
 * appears in BOTH files and fails on any divergence.
 */
function interfaceNames(source: string): Set<string> {
  const names = new Set<string>();
  const re = /\binterface\s+([A-Za-z_]\w*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) names.add(m[1]!);
  return names;
}

function interfaceFields(source: string, name: string): string[] {
  const head = new RegExp(`\\binterface\\s+${name}\\b[^{]*\\{`).exec(source);
  if (!head) throw new Error(`Interface ${name} not found`);
  let i = head.index + head[0].length;
  let depth = 1;
  let body = "";
  while (i < source.length && depth > 0) {
    const c = source[i]!;
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
    body += c;
    i += 1;
  }
  // Collapse nested object types ({...}) so only top-level fields remain.
  let prev = "";
  while (prev !== body) {
    prev = body;
    body = body.replace(/\{[^{}]*\}/g, " ");
  }
  const fields = new Set<string>();
  const fre = /(?:^|[;\n])\s*(\w+)\s*\??\s*:/g;
  let fm: RegExpExecArray | null;
  while ((fm = fre.exec(body))) fields.add(fm[1]!);
  return [...fields].sort();
}

describe("shared interface sync", () => {
  const mainSrc = fs.readFileSync(
    path.join(__dirname, "..", "types.ts"),
    "utf8",
  );
  const rendererSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "renderer", "zephus.d.ts"),
    "utf8",
  );
  const shared = [...interfaceNames(mainSrc)].filter((n) =>
    interfaceNames(rendererSrc).has(n),
  );

  it("shares a meaningful set of interfaces", () => {
    expect(shared.length).toBeGreaterThan(20);
  });

  it.each(shared)("interface %s has matching fields in both files", (name) => {
    expect(interfaceFields(rendererSrc, name)).toEqual(
      interfaceFields(mainSrc, name),
    );
  });
});
