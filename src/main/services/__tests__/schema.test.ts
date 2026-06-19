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
  writeSiteDocument,
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

    const page = readPageDocument(
      tmpDir,
      path.join("src", "pages", "index.astro"),
      pagesDir,
    );
    expect(page.ok).toBe(true);
    expect(page.pageDocument?.sections[0]?.children.length).toBeGreaterThan(0);
    expect(page.pageDocument?.managedFileStatus).toBe("managed");
  });

  it("reads POSIX sidecars when callers pass Windows-style page paths", () => {
    const ensured = ensureVisualSchema(tmpDir, pagesDir);
    expect(ensured.ok).toBe(true);

    const page = readPageDocument(
      tmpDir,
      "src\\pages\\index.astro",
      "src\\pages",
    );

    expect(page.ok).toBe(true);
    expect(page.pageDocument?.page).toBe("src/pages/index.astro");
    expect(page.pageDocument?.slug).toBe("index");
  });

  it("strips dangerous URL schemes from emitted links (build side)", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    const created = createSchemaPage(tmpDir, pagesDir, "danger");
    expect(created.ok).toBe(true);
    const pagePath = pagePathFromSlug(pagesDir, "danger");
    const current = readPageDocument(tmpDir, pagePath, pagesDir);
    expect(current.ok).toBe(true);

    // Constructed at runtime so the eslint no-script-url rule doesn't flag the
    // test source itself.
    const jsScheme = "java" + "script:";
    const written = writePageDocument(tmpDir, pagesDir, {
      ...current.pageDocument!,
      sections: [
        {
          ...current.pageDocument!.sections[0],
          children: [
            {
              id: "b1",
              type: "button",
              props: { text: "Click", href: `${jsScheme}alert(1)`, cls: "" },
            },
            {
              id: "e1",
              type: "embed",
              props: { src: `${jsScheme}alert(2)`, title: "Embed", cls: "" },
            },
          ],
        },
      ],
    });
    expect(written.ok).toBe(true);

    const astro = fs.readFileSync(path.join(tmpDir, pagePath), "utf8");
    expect(astro).not.toContain(jsScheme);
    // Button falls back to a safe anchor target.
    expect(astro).toContain('href="#"');
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
          props: { wrapper: "box", cls: "team-shell" },
          style: {
            background: "#eef2ff",
            padding: "3rem",
            margin: "2rem 0",
            radius: "20px",
            maxWidth: "840px",
            width: "80%",
            height: "420px",
          },
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
    const savedAstro = fs.readFileSync(path.join(tmpDir, aboutPath), "utf8");
    expect(savedAstro).toContain('data-zephus-block="section"');
    expect(savedAstro).toContain('class="team-shell"');
    expect(savedAstro).toContain(
      'style="width:80%;height:420px;max-width:840px;background:#eef2ff;padding:3rem;margin:2rem 0;border-radius:20px"',
    );

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

  it("drops block style values that can break CSS declarations", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    const created = createSchemaPage(tmpDir, pagesDir, "style-hardening");
    expect(created.ok).toBe(true);
    const page = pagePathFromSlug(pagesDir, "style-hardening");
    const current = readPageDocument(tmpDir, page, pagesDir);
    expect(current.ok).toBe(true);

    const saved = writePageDocument(tmpDir, pagesDir, {
      ...current.pageDocument!,
      sections: [
        {
          id: "unsafe-section",
          type: "section",
          props: { wrapper: "box", cls: "" },
          style: {
            width: "100px;color:red",
            height: "80px",
            background: "red;position:fixed",
          },
          children: [],
        },
      ],
    });
    expect(saved.ok).toBe(true);

    const astro = fs.readFileSync(path.join(tmpDir, page), "utf8");
    expect(astro).toContain("height:80px");
    expect(astro).not.toContain("width:100px;color:red");
    expect(astro).not.toContain("position:fixed");
  });

  it("does not overwrite out-of-sync managed Astro pages", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    const created = createSchemaPage(tmpDir, pagesDir, "manual-edit");
    expect(created.ok).toBe(true);
    const page = pagePathFromSlug(pagesDir, "manual-edit");
    const pageFile = path.join(tmpDir, page);
    const manualSource = `---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="Manual">
  <h1>Manual edit stays</h1>
</BaseLayout>
`;
    fs.writeFileSync(pageFile, manualSource, "utf8");

    const ensured = ensureVisualSchema(tmpDir, pagesDir);
    expect(ensured.ok).toBe(true);
    expect(fs.readFileSync(pageFile, "utf8")).toBe(manualSource);

    const reread = readPageDocument(tmpDir, page, pagesDir);
    expect(reread.ok).toBe(true);
    expect(reread.pageDocument?.managedFileStatus).toBe("out-of-sync");
    expect(reread.source).toBe(manualSource);
  });

  it("does not mark managed pages out-of-sync for CRLF-only changes", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    const created = createSchemaPage(tmpDir, pagesDir, "line-endings");
    expect(created.ok).toBe(true);
    const page = pagePathFromSlug(pagesDir, "line-endings");
    const pageFile = path.join(tmpDir, page);
    const lfSource = fs.readFileSync(pageFile, "utf8");
    fs.writeFileSync(pageFile, lfSource.replace(/\n/g, "\r\n"), "utf8");

    const reread = readPageDocument(tmpDir, page, pagesDir);

    expect(reread.ok).toBe(true);
    expect(reread.pageDocument?.managedFileStatus).toBe("managed");
  });

  it("keeps a real section element for wrapperless styled sections", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    const created = createSchemaPage(tmpDir, pagesDir, "styled-none");
    expect(created.ok).toBe(true);
    const page = pagePathFromSlug(pagesDir, "styled-none");
    const current = readPageDocument(tmpDir, page, pagesDir);
    expect(current.ok).toBe(true);

    const saved = writePageDocument(tmpDir, pagesDir, {
      ...current.pageDocument!,
      sections: [
        {
          id: "styled-section",
          type: "section",
          label: "Styled None",
          props: { wrapper: "none", cls: "" },
          style: {
            width: "760px",
            responsive: { mobile: { width: "320px" } },
          },
          children: [
            {
              id: "copy",
              type: "text",
              props: { text: "Still targetable", cls: "" },
            },
          ],
        },
      ],
    });
    expect(saved.ok).toBe(true);

    const astro = fs.readFileSync(path.join(tmpDir, page), "utf8");
    expect(astro).toContain('data-zephus-id="styled-section"');
    expect(astro).toContain('style="width:760px"');
    expect(astro).toContain('[data-zephus-id="styled-section"]{width:320px}');
  });

  it("writes managed shell and design artifacts when site settings change", () => {
    ensureVisualSchema(tmpDir, pagesDir);
    fs.mkdirSync(path.join(tmpDir, "public", "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "public", "styles", "zephus-custom.css"),
      ".brand { color: hotpink; }",
    );
    fs.writeFileSync(
      path.join(tmpDir, "public", "scripts", "zephus-custom.js"),
      "console.log('zephus custom');",
    );
    const site = readSiteDocument(tmpDir);
    expect(site.ok).toBe(true);
    expect(site.site).toBeTruthy();

    const saved = writeSiteDocument(
      tmpDir,
      {
        ...site.site!,
        design: {
          ...site.site!.design,
          accent: "#ff3366",
          containerWidth: "1040px",
        },
        shell: {
          ...site.site!.shell,
          layoutMode: "managed",
          logoText: "Zephus Studio",
          announcementVisible: true,
          announcementText: "Fresh beta build",
          navCtaLabel: "Start Now",
          navCtaHref: "/contact",
        },
      },
      pagesDir,
    );
    expect(saved.ok).toBe(true);

    const layout = fs.readFileSync(
      path.join(tmpDir, "src", "layouts", "BaseLayout.astro"),
      "utf8",
    );
    expect(layout).toContain("zephus-shell-header");
    expect(layout).toContain("Zephus Studio");
    expect(layout).toContain("Fresh beta build");
    expect(layout).toContain(
      '<link rel="stylesheet" href="/styles/zephus-custom.css" />',
    );
    expect(layout).toContain(
      '<script type="module" src="/scripts/zephus-custom.js"></script>',
    );
    expect(
      fs.existsSync(
        path.join(
          tmpDir,
          "src",
          "layouts",
          "BaseLayout.zephus-legacy-backup.astro",
        ),
      ),
    ).toBe(true);

    const managedCss = fs.readFileSync(
      path.join(tmpDir, "public", "styles", "zephus-managed.css"),
      "utf8",
    );
    expect(managedCss).toContain("--zephus-accent: #ff3366");
    expect(managedCss).toContain("--zephus-container-width: 1040px");

    const backupBefore = fs.readFileSync(
      path.join(
        tmpDir,
        "src",
        "layouts",
        "BaseLayout.zephus-legacy-backup.astro",
      ),
      "utf8",
    );
    const savedAgain = writeSiteDocument(
      tmpDir,
      {
        ...site.site!,
        shell: {
          ...site.site!.shell,
          layoutMode: "managed",
          logoText: "Second Pass",
        },
      },
      pagesDir,
    );
    expect(savedAgain.ok).toBe(true);
    const backupAfter = fs.readFileSync(
      path.join(
        tmpDir,
        "src",
        "layouts",
        "BaseLayout.zephus-legacy-backup.astro",
      ),
      "utf8",
    );
    expect(backupAfter).toBe(backupBefore);
  });
});
