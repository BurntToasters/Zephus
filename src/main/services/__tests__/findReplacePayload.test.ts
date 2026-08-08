import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { searchPages, replaceAllInPages } from "../findReplace";
import { createSite } from "../wizard";
import {
  ensureVisualSchema,
  readPageDocument,
  writePageDocument,
} from "../schema";

let projectDir: string;

function makeProject(): void {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-fr-"));
  const created = createSite(projectDir, "minimal");
  expect(created.ok).toBe(true);
  ensureVisualSchema(projectDir, "src/pages");
  // Build the page through the REAL managed path so it is genuinely
  // "managed" (a hand-built sidecar would read as out-of-sync and the
  // search — correctly — skips it).
  const rel = path.join("src", "pages", "index.astro");
  const current = readPageDocument(projectDir, rel, "src/pages");
  expect(current.ok).toBe(true);
  const saved = writePageDocument(projectDir, "src/pages", {
    ...current.pageDocument!,
    sections: [
      {
        id: "s1",
        type: "section",
        label: "Main",
        props: { wrapper: "none", cls: "" },
        children: [
          {
            id: "b1",
            type: "text",
            props: { text: "Hello world", cls: "" },
          },
        ],
      },
    ],
  });
  expect(saved.ok).toBe(true);
}

describe("findReplace payload validation", () => {
  beforeEach(() => {
    makeProject();
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("rejects an empty search", () => {
    const result = searchPages(projectDir, "src/pages", "   ");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Enter text to find.");
  });

  it("rejects oversized search queries", () => {
    const result = searchPages(projectDir, "src/pages", "a".repeat(501));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("too long");
  });

  it("rejects oversized replacements", () => {
    const result = replaceAllInPages(
      projectDir,
      "src/pages",
      "Hello",
      "x".repeat(5001),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("too long");
  });

  it("searches normally within limits", () => {
    const result = searchPages(projectDir, "src/pages", "Hello");
    expect(result.ok).toBe(true);
    expect(result.totalMatches).toBe(1);
  });

  it("skips detached pages in search counts and reports them", () => {
    // A detached page's matches are never replaced (replaceAll skips it), so
    // the search must not count them — the confirmation dialog would promise
    // replacements that never happen. It still reports the skipped page.
    ensureVisualSchema(projectDir, "src/pages");
    const detachRel = path.join("src", "pages", "hand.astro");
    fs.writeFileSync(
      path.join(projectDir, detachRel),
      "---\nconst x = 1;\n---\n<p>Hello manual</p>\n",
      "utf8",
    );
    const ensured = ensureVisualSchema(projectDir, "src/pages");
    expect(ensured.ok).toBe(true);
    const detachResult = readPageDocument(projectDir, detachRel, "src/pages");
    expect(detachResult.pageDocument?.managedFileStatus).toBe("out-of-sync");

    const result = searchPages(projectDir, "src/pages", "Hello");
    expect(result.ok).toBe(true);
    // Only the managed page's "Hello world" counts; the detached page's
    // "Hello manual" is excluded but reported as skipped.
    expect(result.totalMatches).toBe(1);
    expect(result.skippedDetachedPages).toBe(1);
  });
});
