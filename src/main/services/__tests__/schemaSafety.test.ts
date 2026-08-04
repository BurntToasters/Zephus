import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createSchemaPage,
  ensureVisualSchema,
  pagePathFromSlug,
  readPageDocument,
  renamePageSchema,
  writePageDocument,
} from "../schema";
import { repointAssetReferences } from "../assetUsage";
import { searchPages, replaceAllInPages } from "../findReplace";
import type { SectionNode } from "../../types";

let tmpDir: string;
const pagesDir = path.join("src", "pages");

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-verify-"));
  fs.mkdirSync(path.join(tmpDir, "src", "layouts"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "src", "pages"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "public", "styles"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, "package.json"),
    JSON.stringify({
      scripts: { dev: "astro dev", build: "astro build" },
      dependencies: { astro: "^6.0.0" },
    }),
  );
  fs.writeFileSync(path.join(tmpDir, "astro.config.mjs"), "export default {};");
  fs.writeFileSync(
    path.join(tmpDir, "src", "layouts", "BaseLayout.astro"),
    `---
const { title = 'Site' } = Astro.props;
---
<html><body><nav><a href="/">Home</a></nav><main><slot /></main></body></html>`,
  );
  fs.writeFileSync(
    path.join(tmpDir, "public", "styles", "global.css"),
    "body { font-family: system-ui; }",
  );
  fs.writeFileSync(
    path.join(tmpDir, "src", "pages", "index.astro"),
    `---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="Home"><h1>Welcome</h1></BaseLayout>`,
  );
  fs.mkdirSync(path.join(tmpDir, ".zephus"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, ".zephus", "settings.json"),
    JSON.stringify({ schemaVersion: 1, editorRules: {}, theme: "project" }),
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function sectionsWithText(text: string): SectionNode[] {
  return [
    {
      id: "s1",
      type: "section",
      label: "Main",
      props: { wrapper: "box", cls: "" },
      children: [{ id: "b1", type: "text", props: { text, cls: "" } }],
    },
  ];
}

describe("schema data-safety regression coverage", () => {
  it("preserves text with a literal < through migration reparse", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    createSchemaPage(tmpDir, pagesDir, "story");
    const rel = pagePathFromSlug(pagesDir, "story");
    const current = readPageDocument(tmpDir, rel, pagesDir);
    writePageDocument(tmpDir, pagesDir, {
      ...current.pageDocument!,
      sections: sectionsWithText("Price 2 < 3 and 5 > 4 & more"),
    });
    fs.rmSync(path.join(tmpDir, ".zephus", "pages"), {
      recursive: true,
      force: true,
    });
    fs.rmSync(path.join(tmpDir, rel), { force: true });

    // Recreate a legacy page with the tricky text inline.
    fs.writeFileSync(
      path.join(tmpDir, rel),
      `---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="Story">
  <p>Price 2 < 3 and 5 > 4 &amp; more</p>
</BaseLayout>`,
      "utf8",
    );

    ensureVisualSchema(tmpDir, pagesDir);
    const reparsed = readPageDocument(tmpDir, rel, pagesDir);
    expect(reparsed.ok).toBe(true);
    const text = reparsed
      .pageDocument!.sections.flatMap((s) => s.children)
      .find((b) => b.type === "text");
    expect(text?.props["text"]).toBe("Price 2 < 3 and 5 > 4 & more");
  });

  it("preserves style values containing colons (url(...))", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    createSchemaPage(tmpDir, pagesDir, "story");
    const rel = pagePathFromSlug(pagesDir, "story");
    fs.writeFileSync(
      path.join(tmpDir, rel),
      `---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="Story">
  <h1 style="background:url(http://example.com/bg.png) no-repeat center;color:#123">Head</h1>
</BaseLayout>`,
      "utf8",
    );
    fs.rmSync(path.join(tmpDir, ".zephus", "pages"), {
      recursive: true,
      force: true,
    });
    const reparsed = readPageDocument(tmpDir, rel, pagesDir);
    expect(reparsed.ok).toBe(true);
    const heading = reparsed
      .pageDocument!.sections.flatMap((s) => s.children)
      .find((b) => b.type === "heading");
    expect(heading?.style?.background).toBe(
      "url(http://example.com/bg.png) no-repeat center",
    );
  });

  it("opens pages whose file names are not normalized slugs (About.astro)", () => {
    fs.writeFileSync(
      path.join(tmpDir, "src", "pages", "About.astro"),
      `---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="About"><h1>About Us</h1></BaseLayout>`,
      "utf8",
    );
    const result = ensureVisualSchema(tmpDir, pagesDir);
    expect(result.ok).toBe(true);
    const sidecar = path.join(tmpDir, ".zephus", "pages", "about.json");
    expect(fs.existsSync(sidecar)).toBe(true);
  });

  it("does not rewrite a hand-edited page when the sidecar lacks a hash", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    createSchemaPage(tmpDir, pagesDir, "story");
    const rel = pagePathFromSlug(pagesDir, "story");
    // Drop the generatedHash, simulating a legacy sidecar.
    const sidecar = path.join(tmpDir, ".zephus", "pages", "story.json");
    const doc = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    delete doc.generatedHash;
    fs.writeFileSync(sidecar, JSON.stringify(doc));
    // Hand-edit the .astro file.
    const handEdit =
      "---\nimport BaseLayout from '../layouts/BaseLayout.astro';\n---\n<BaseLayout title=\"Story\"><p>Hand written content that must survive</p></BaseLayout>\n";
    fs.writeFileSync(path.join(tmpDir, rel), handEdit, "utf8");

    ensureVisualSchema(tmpDir, pagesDir);
    const onDisk = fs.readFileSync(path.join(tmpDir, rel), "utf8");
    expect(onDisk).toBe(handEdit);
    const status = readPageDocument(tmpDir, rel, pagesDir);
    expect(status.pageDocument?.managedFileStatus).toBe("out-of-sync");
  });

  it("migrated legacy pages are still regenerated on first open", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    createSchemaPage(tmpDir, pagesDir, "story");
    const rel = pagePathFromSlug(pagesDir, "story");
    fs.writeFileSync(
      path.join(tmpDir, rel),
      `---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="Story"><h1>Hello Legacy</h1></BaseLayout>`,
      "utf8",
    );
    fs.rmSync(path.join(tmpDir, ".zephus", "pages"), {
      recursive: true,
      force: true,
    });
    ensureVisualSchema(tmpDir, pagesDir);
    const onDisk = fs.readFileSync(path.join(tmpDir, rel), "utf8");
    expect(onDisk).toContain("data-zephus-block");
  });

  it("renaming an asset ignores longer paths that end in it", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    createSchemaPage(tmpDir, pagesDir, "story");
    const rel = pagePathFromSlug(pagesDir, "story");
    const current = readPageDocument(tmpDir, rel, pagesDir);
    writePageDocument(tmpDir, pagesDir, {
      ...current.pageDocument!,
      sections: sectionsWithText(
        "See /my/assets/images/hero.png and /assets/images/hero.png",
      ),
    });
    const result = repointAssetReferences(
      tmpDir,
      pagesDir,
      "/assets/images/hero.png",
      "/assets/images/renamed.png",
    );
    expect(result.ok).toBe(true);
    const reread = readPageDocument(tmpDir, rel, pagesDir);
    const text = reread
      .pageDocument!.sections.flatMap((s) => s.children)
      .find((b) => b.type === "text")!.props["text"];
    expect(text).toBe(
      "See /my/assets/images/hero.png and /assets/images/renamed.png",
    );
  });

  it("whole-word search matches needles with non-word chars like C++", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    createSchemaPage(tmpDir, pagesDir, "story");
    const rel = pagePathFromSlug(pagesDir, "story");
    const current = readPageDocument(tmpDir, rel, pagesDir);
    writePageDocument(tmpDir, pagesDir, {
      ...current.pageDocument!,
      sections: sectionsWithText("We use C++ here and C++ rocks. Also C++STD."),
    });
    const result = searchPages(tmpDir, pagesDir, "C++", { wholeWord: true });
    expect(result.ok).toBe(true);
    expect(result.totalMatches).toBe(2);

    const replaced = replaceAllInPages(tmpDir, pagesDir, "C++", "Rust", {
      wholeWord: true,
    });
    expect(replaced.ok).toBe(true);
    expect(replaced.replaced).toBe(2);
    const reread = readPageDocument(tmpDir, rel, pagesDir);
    const text = reread
      .pageDocument!.sections.flatMap((s) => s.children)
      .find((b) => b.type === "text")!.props["text"];
    expect(text).toBe("We use Rust here and Rust rocks. Also C++STD.");
  });

  it("renaming a page schema writes the new sidecar before removing the old", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    createSchemaPage(tmpDir, pagesDir, "story");
    const renamed = renamePageSchema(
      tmpDir,
      pagesDir,
      pagePathFromSlug(pagesDir, "story"),
      "tale",
    );
    expect(renamed.ok).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, ".zephus", "pages", "tale.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, ".zephus", "pages", "story.json")),
    ).toBe(false);
  });
});
