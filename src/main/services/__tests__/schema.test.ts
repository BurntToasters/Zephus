import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createSchemaPage,
  detachPageDocument,
  ensureVisualSchema,
  pagePathFromSlug,
  readPageDocument,
  readSiteDocument,
  reattachPageDocument,
  writePageDocument,
} from "../schema";

let tmpDir: string;
const pagesDir = path.join("src", "pages");

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-schema-"));
  fs.mkdirSync(path.join(tmpDir, "src", "layouts"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "src", "pages"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "public", "styles"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, "package.json"),
    JSON.stringify({
      scripts: { dev: "astro dev", build: "astro build" },
      dependencies: { astro: "^5.0.0" },
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
title: "Home"
navLabel: "Home"
metaDescription: "Welcome"
navVisible: true
---

<BaseLayout title="Home">
  <h1>Welcome</h1>
  <p>Hello world.</p>
</BaseLayout>
`,
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

describe("schema service", () => {
  it("creates schema sidecars from an existing Zephus page", () => {
    const ensured = ensureVisualSchema(tmpDir, pagesDir);
    expect(ensured.ok).toBe(true);
    expect(ensured.status?.integrity).toBe("ready");

    const site = readSiteDocument(tmpDir);
    expect(site.ok).toBe(true);
    expect(site.site?.shell.navItems[0]?.href).toBe("/");

    const page = readPageDocument(tmpDir, path.join("src", "pages", "index.astro"), pagesDir);
    expect(page.ok).toBe(true);
    expect(page.pageDocument?.sections[0]?.children.length).toBeGreaterThan(0);
    expect(page.pageDocument?.managedFileStatus).toBe("managed");
  });

  it("creates, exports, detaches, and reattaches schema pages", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    const created = createSchemaPage(tmpDir, pagesDir, "about/team");
    expect(created.ok).toBe(true);

    const aboutPath = pagePathFromSlug(pagesDir, "about/team");
    expect(fs.existsSync(path.join(tmpDir, aboutPath))).toBe(true);

    const current = readPageDocument(tmpDir, aboutPath, pagesDir);
    expect(current.ok).toBe(true);
    expect(current.pageDocument?.title).toBe("Team");

    const updated = writePageDocument(tmpDir, pagesDir, {
      ...current.pageDocument!,
      sections: [
        {
          ...current.pageDocument!.sections[0],
          children: [
            {
              id: "hero",
              type: "heading",
              props: { text: "Team", level: "1", cls: "" },
            },
            {
              id: "copy",
              type: "text",
              props: { text: "Meet the people behind the project.", cls: "" },
            },
          ],
        },
      ],
    });
    expect(updated.ok).toBe(true);

    const detached = detachPageDocument(
      tmpDir,
      aboutPath,
      pagesDir,
      `---
import BaseLayout from '../../layouts/BaseLayout.astro';
---
<BaseLayout title="Detached">
  <section><h1>Detached</h1></section>
</BaseLayout>
`,
    );
    expect(detached.ok).toBe(true);
    expect(detached.pageDocument?.managedFileStatus).toBe("detached");

    const reattached = reattachPageDocument(tmpDir, aboutPath, pagesDir);
    expect(reattached.ok).toBe(true);
    expect(reattached.pageDocument?.detached).toBe(false);
    expect(reattached.pageDocument?.managedFileStatus).toBe("managed");
  });
});
