#!/usr/bin/env node
/** Zephus E2E failure suite (temp Astro sites, no Electron).
 *
 * Exercises real main-process services against temp projects, reads/writes
 * bytes on disk, and records pass/fail in artifacts/e2e/<repo-sha>.json.
 * Several checks are expected to fail while named product bugs remain.
 *
 * REPEAT: `node build-scripts/e2e-failure-suite.js [--themes=all|smoke]`
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SMOKE_THEMES = ["minimal", "blog", "store"];

function ensureDraftsUserDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-e2e-userdata-"));
  globalThis.__zephusE2eUserData = dir;
  const Module = require("module");
  const originalLoad = Module._load;
  Module._load = function zephusE2eElectronShim(request, parent, isMain) {
    if (request === "electron") {
      return {
        app: {
          getPath: (name) =>
            name === "userData" ? globalThis.__zephusE2eUserData : dir,
          getAppPath: () => ROOT,
          isPackaged: false,
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  return dir;
}
const BUILD_THEMES = ["minimal", "store"];

const checks = [];
let passed = 0;
let failed = 0;

function repoSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function record(name, ok, detail = "") {
  checks.push({ name, ok: !!ok, detail: detail || (ok ? "ok" : "failed") });
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✖ ${name}: ${detail || "failed"}`);
  }
}

function mkSite(svc, themeId) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `zephus-e2e-${themeId}-`));
  const project = path.join(tmp, "site");
  fs.mkdirSync(project, { recursive: true });
  const created = svc.wizard.createSite(project, themeId);
  if (!created.ok) throw new Error(`scaffold ${themeId}: ${created.error}`);
  const ensured = svc.schema.ensureVisualSchema(project, "src/pages");
  if (!ensured.ok) throw new Error(`ensure ${themeId}: ${ensured.error}`);
  return { tmp, project, pagesDir: path.join(project, "src", "pages") };
}

function copyE2eProof(project, label) {
  const sha = repoSha();
  const dest = path.join(ROOT, "artifacts", "e2e", sha, "proof");
  try {
    fs.mkdirSync(dest, { recursive: true });
    const index = path.join(project, "src", "pages", "index.astro");
    if (fs.existsSync(index)) {
      fs.copyFileSync(index, path.join(dest, `${label}-index.astro`));
    }
  } catch {
    /* proof copy is best-effort */
  }
}

function rm(tmp) {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function firstPage(pagesDir) {
  const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith(".astro"));
  if (files.length === 0) return null;
  files.sort();
  return files.includes("index.astro") ? "index.astro" : files[0];
}

/** Runs the managed layout's emitted `absolute()` (from BaseLayout frontmatter) in vm. */
function callExtractedLayoutAbsolute(layoutSource, pathValue) {
  const fmMatch = layoutSource.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = fmMatch ? fmMatch[1] : layoutSource;
  const siteUrlLine = fm.match(/const siteUrl = (.+);/);
  const absMatch = fm.match(
    /const absolute = \(value(?:: string)?\)(?:: string)? => \{([\s\S]*?)\};\s*\r?\nconst canonical/,
  );
  if (!siteUrlLine || !absMatch) {
    return { ok: false, error: "layout absolute helper missing" };
  }
  const body = absMatch[1].replace(/let resolved: URL;/g, "let resolved;");
  const script = [
    `const siteUrl = ${siteUrlLine[1]};`,
    `const absolute = (value) => {${body}};`,
    "absolute;",
  ].join("\n");
  try {
    const absoluteFn = vm.runInNewContext(script, { URL }, { timeout: 2000 });
    if (typeof absoluteFn !== "function") {
      return { ok: false, error: "absolute is not a function" };
    }
    return { ok: true, href: absoluteFn(pathValue) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function sitemapLocForRoute(sitemapXml, route) {
  const re = new RegExp(
    `<loc>([^<]*${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^<]*)</loc>`,
  );
  const m = sitemapXml.match(re);
  return m ? m[1].trim() : "";
}

function writeArtifactAndExit() {
  const sha = repoSha();
  const outDir = path.join(ROOT, "artifacts", "e2e");
  fs.mkdirSync(outDir, { recursive: true });
  const payload = { sha, passed, failed, checks };
  fs.writeFileSync(
    path.join(outDir, `${sha}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  console.log(`\nE2E: ${passed} passed, ${failed} failed.`);
  console.log(`Artifact: artifacts/e2e/${sha}.json`);
  process.exit(failed > 0 ? 1 : 0);
}

async function runProductChecks(svc, blockRender) {
  let ctx;
  try {
    ctx = mkSite(svc, "minimal");
  } catch (e) {
    record("product checks scaffold", false, e.message);
    return;
  }
  const { tmp, project, pagesDir } = ctx;
  const pagesRel = "src/pages";
  try {
    // 1. Rich text find/replace preserves href and tag names.
    {
      const page = firstPage(pagesDir);
      if (!page) {
        record("rich text replace preserves markup", false, "no page");
      } else {
        const doc = svc.schema.readPageDocument(project, page, pagesRel);
        if (!doc.ok || !doc.pageDocument) {
          record(
            "rich text replace preserves markup",
            false,
            doc.error ?? "no doc",
          );
        } else {
          const linkText = 'See <a href="/about">about</a>';
          const strongText = "<strong>about</strong>";
          const section = doc.pageDocument.sections[0];
          if (section) {
            section.children.push(
              {
                id: "e2e-rich-link",
                type: "text",
                props: { text: linkText },
                style: {},
              },
              {
                id: "e2e-rich-strong",
                type: "text",
                props: { text: strongText },
                style: {},
              },
            );
          }
          svc.schema.writePageDocument(project, pagesRel, doc.pageDocument);
          const rep = svc.findReplace.replaceAllInPages(
            project,
            pagesRel,
            "about",
            "visit",
          );
          const after = svc.schema.readPageDocument(project, page, pagesRel);
          let linkVal = "";
          let strongVal = "";
          if (after.ok && after.pageDocument) {
            const walk = (nodes) => {
              for (const n of nodes) {
                if (n.id === "e2e-rich-link") linkVal = n.props.text ?? "";
                if (n.id === "e2e-rich-strong") strongVal = n.props.text ?? "";
                if (n.children) walk(n.children);
              }
            };
            walk(after.pageDocument.sections);
          }
          const refused = !rep.ok || rep.replaced === 0;
          const linkTextOnly = linkVal.replace(/<[^>]*>/g, "");
          const visibleChanged =
            /visit/i.test(linkTextOnly) && !/\babout\b/i.test(linkTextOnly);
          const hrefOk = linkVal.includes('href="/about"');
          const strongOk = /<strong\b/i.test(strongVal);
          const pass = (visibleChanged || refused) && hrefOk && strongOk;
          record(
            "rich text replace preserves markup",
            pass,
            `refused=${refused} link=${JSON.stringify(linkVal).slice(0, 120)} strong=${JSON.stringify(strongVal)}`,
          );
        }
      }
    }

    // 2. Partial git commit (only requested paths should land).
    {
      if (!fs.existsSync(path.join(project, ".git"))) {
        execFileSync("git", ["init"], { cwd: project, stdio: "ignore" });
      }
      execFileSync("git", ["config", "user.name", "E2E"], {
        cwd: project,
        stdio: "ignore",
      });
      execFileSync("git", ["config", "user.email", "e2e@zephus.local"], {
        cwd: project,
        stdio: "ignore",
      });
      fs.writeFileSync(path.join(project, "file-a.txt"), "A\n", "utf8");
      fs.writeFileSync(path.join(project, "file-b.txt"), "B\n", "utf8");
      execFileSync("git", ["add", "file-a.txt"], { cwd: project });
      const gitMod = await import(
        pathToFileURL(path.join(ROOT, "dist", "main", "services", "git.js"))
          .href
      );
      const commit = await gitMod.commitProjectPaths(project, "partial", [
        "file-b.txt",
      ]);
      let names = "";
      if (commit.ok) {
        names = execFileSync(
          "git",
          ["show", "--name-only", "--pretty=format:"],
          { cwd: project, encoding: "utf8" },
        ).trim();
      }
      const pass =
        commit.ok &&
        /\bfile-b\.txt\b/.test(names) &&
        !/\bfile-a\.txt\b/.test(names);
      record(
        "partial git commit respects path list",
        pass,
        commit.ok ? `names=${names}` : (commit.error ?? "commit failed"),
      );
    }

    // 3. Frontmatter draft survives visual save regen.
    {
      const indexPath = path.join(pagesDir, "index.astro");
      const raw = fs.readFileSync(indexPath, "utf8");
      const withDraft = raw.includes("draft:")
        ? raw
        : raw.replace(/^---\n/m, "---\ndraft: true\n");
      fs.writeFileSync(indexPath, withDraft, "utf8");
      const indexRel = path.join(pagesRel, "index.astro").replace(/\\/g, "/");
      const indexDoc = svc.schema.readPageDocument(project, indexRel, pagesRel);
      if (indexDoc.ok && indexDoc.pageDocument) {
        svc.schema.writePageDocument(project, pagesRel, indexDoc.pageDocument);
      }
      const after = fs.readFileSync(indexPath, "utf8");
      record(
        "frontmatter draft survives regen",
        after.includes("draft: true"),
        after.includes("draft: true") ? "ok" : "draft line missing after save",
      );
    }

    // 5. Design accent slash preserved in managed CSS.
    {
      const siteRead = svc.schema.readSiteDocument(project);
      if (!siteRead.ok || !siteRead.site) {
        record("design slash in managed css", false, "no site doc");
      } else {
        const accent = "rgb(10 20 30 / 0.5)";
        siteRead.site.design.accent = accent;
        svc.schema.writeSiteDocument(project, siteRead.site, pagesRel);
        const cssPath = path.join(
          project,
          "public",
          "styles",
          "zephus-managed.css",
        );
        const css = fs.existsSync(cssPath)
          ? fs.readFileSync(cssPath, "utf8")
          : "";
        record(
          "design slash in managed css",
          css.includes(accent),
          css.includes(accent) ? "ok" : "accent stripped from css",
        );
      }
    }

    // 6. Columns block paints display:grid in built output (not editor-only).
    {
      const page = firstPage(pagesDir);
      const doc = page
        ? svc.schema.readPageDocument(project, page, pagesRel)
        : null;
      if (!doc?.ok || !doc.pageDocument) {
        record("columns block display grid", false, "no page doc");
      } else {
        const section = doc.pageDocument.sections[0];
        if (section) {
          section.children.push({
            id: "e2e-columns",
            type: "columns",
            props: { col1: "One", col2: "Two", count: "2" },
            style: { columns: 2 },
          });
        }
        svc.schema.writePageDocument(project, pagesRel, doc.pageDocument);
        svc.schema.ensureVisualSchema(project, pagesRel);
        const cssPath = path.join(
          project,
          "public",
          "styles",
          "zephus-managed.css",
        );
        const css = fs.existsSync(cssPath)
          ? fs.readFileSync(cssPath, "utf8")
          : "";
        const pageBytes = fs.readFileSync(path.join(pagesDir, page), "utf8");
        const gridRe =
          /display\s*:\s*grid[\s\S]*?(columns|data-zephus-block="columns")|[\s\S]*?(columns|data-zephus-block="columns")[\s\S]*display\s*:\s*grid/i;
        record(
          "columns block display grid",
          gridRe.test(css) || gridRe.test(pageBytes),
          "no display:grid rule for columns in managed css or page",
        );
      }
    }

    // 7. hideOn tablet uses min-width media query.
    {
      const sections = [
        {
          id: "sec-hide",
          type: "section",
          label: "Hide",
          props: { wrapper: "none", cls: "" },
          children: [
            {
              id: "block-tablet-hide",
              type: "text",
              props: { text: "Hide me on tablet" },
              style: { hideOn: ["tablet"] },
            },
          ],
        },
      ];
      const css = blockRender.collectResponsiveCss(sections);
      const tabletHidden = /display\s*:\s*none/i.test(css);
      const minWidthQuery =
        /@media[^{]*min-width[\s\S]*display\s*:\s*none/i.test(css);
      record(
        "hideOn tablet min-width query",
        tabletHidden && minWidthQuery,
        css.slice(0, 200),
      );
    }

    // 8. HTML block keeps section raw without extra section node.
    {
      const page = firstPage(pagesDir);
      const doc = page
        ? svc.schema.readPageDocument(project, page, pagesRel)
        : null;
      if (!doc?.ok || !doc.pageDocument) {
        record("html block section identity", false, "no doc");
      } else {
        for (const sec of doc.pageDocument.sections) {
          sec.props.wrapper = "none";
        }
        const rawHtml = "<section>\n  <p>ZEPHUSHTML</p>\n</section>";
        const countSectionNodes = (sections) => {
          let total = 0;
          const walk = (nodes) => {
            for (const n of nodes) {
              if (n.type === "section") total += 1;
              if (n.children) walk(n.children);
            }
          };
          walk(sections);
          return total;
        };
        const sectionsBefore = countSectionNodes(doc.pageDocument.sections);
        doc.pageDocument.sections[0]?.children.push({
          id: "e2e-html-block",
          type: "html",
          props: {},
          raw: rawHtml,
        });
        svc.schema.writePageDocument(project, pagesRel, doc.pageDocument);
        const pageRel = path.join(pagesRel, page).replace(/\\/g, "/");
        const astroPath = path.join(project, pageRel);
        const slug = page.replace(/\.astro$/, "");
        const sidecar = path.join(project, ".zephus", "pages", `${slug}.json`);
        if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
        const parsedSections = svc.schema.parseSectionsFromSource(
          fs.readFileSync(astroPath, "utf8"),
        );
        let htmlBlocks = 0;
        let goodRaw = false;
        const sectionsAfter = countSectionNodes(parsedSections);
        const walk = (nodes) => {
          for (const n of nodes) {
            if (n.type === "html") {
              htmlBlocks += 1;
              if (
                (n.raw ?? "").includes("<section>") &&
                (n.raw ?? "").includes("ZEPHUSHTML")
              ) {
                goodRaw = true;
              }
            }
            if (n.children) walk(n.children);
          }
        };
        walk(parsedSections);
        record(
          "html block section identity",
          htmlBlocks === 1 && goodRaw && sectionsAfter === sectionsBefore,
          `htmlBlocks=${htmlBlocks} goodRaw=${goodRaw} sectionsBefore=${sectionsBefore} sectionsAfter=${sectionsAfter}`,
        );
      }
    }

    // 9. Publish fails when build succeeds without index.html.
    {
      const pkgPath = path.join(project, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      pkg.scripts = {
        ...pkg.scripts,
        build: 'node -e "process.exit(0)"',
      };
      fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
      const publishMod = await import(
        pathToFileURL(path.join(ROOT, "dist", "main", "services", "publish.js"))
          .href
      );
      const result = await publishMod.buildAndReveal(
        project,
        "dist",
        undefined,
        {
          reveal: false,
        },
      );
      record(
        "publish proof requires html output",
        !result.ok,
        result.ok
          ? "build returned ok without html check"
          : (result.error ?? "ok"),
      );
    }

    // 10. Custom node path + symlink rejection.
    {
      const nodeCheck = await import(
        pathToFileURL(
          path.join(ROOT, "dist", "main", "services", "nodeCheck.js"),
        ).href
      );
      const missing = path.join(
        os.tmpdir(),
        `zephus-no-node-${Date.now()}`,
        "node",
      );
      const check = await nodeCheck.checkNodeVersion(missing);
      const pathFallthrough =
        (check.status === "ok" || check.status === "outdated") &&
        check.usedCustomPath === false;
      const passCustom = !pathFallthrough;
      record(
        "custom node missing path not ok",
        passCustom,
        JSON.stringify({
          status: check.status,
          binaryPath: check.binaryPath,
          usedCustomPath: check.usedCustomPath,
        }),
      );
      const linkDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "zephus-node-link-"),
      );
      const linkPath = path.join(linkDir, "node");
      try {
        fs.symlinkSync(process.execPath, linkPath);
        const val = nodeCheck.validateNodePath(linkPath);
        record(
          "validateNodePath rejects node symlink",
          !val.ok,
          val.ok ? "symlink accepted" : (val.error ?? "rejected"),
        );
      } finally {
        rm(linkDir);
      }
    }

    // 11. Widened pagesDir cannot delete non-pages.
    {
      const layoutDir = path.join(project, "src", "layouts");
      fs.mkdirSync(layoutDir, { recursive: true });
      const layoutPage = path.join(layoutDir, "ProbeLayout.astro");
      fs.writeFileSync(layoutPage, "---\n---\n<p>not a page</p>\n", "utf8");
      const indexPath = path.join(pagesDir, "index.astro");
      const wideDel = svc.pageManager.deletePage(
        project,
        "src/layouts/ProbeLayout.astro",
        "src",
      );
      record(
        "widened pagesDir delete blocked",
        (!wideDel || wideDel.ok === false) &&
          fs.existsSync(layoutPage) &&
          fs.existsSync(indexPath),
        wideDel && wideDel.ok ? "deleted non-page via widened dir" : "ok",
      );
    }

    // 12. Homepage delete refused (real page path; run last — may delete index).
    {
      const indexRel = path.join(pagesRel, "index.astro").replace(/\\/g, "/");
      const indexPath = path.join(project, indexRel);
      const del = svc.pageManager.deletePage(project, indexRel, pagesRel);
      const err = (del && del.error) || "";
      const homeError = /home\s*page|homepage/i.test(err);
      const pathOnlyRejection = /not a page inside the site/i.test(err);
      const pass =
        del &&
        del.ok === false &&
        fs.existsSync(indexPath) &&
        homeError &&
        !pathOnlyRejection;
      record(
        "homepage delete refused",
        pass,
        del && del.ok
          ? "index deleted"
          : pathOnlyRejection
            ? `wrong rejection: ${err}`
            : homeError
              ? "ok"
              : `error=${err || "none"}`,
      );
    }
  } finally {
    copyE2eProof(project, "product");
    rm(tmp);
  }
}

async function runFreshQualityPassChecks(svc, blockRender) {
  const pagesRel = "src/pages";
  const siteUrlDocs = "https://example.com/docs/";

  // 1. Canonical vs sitemap for root-relative routes under a site URL path base.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record(
        "canonical matches sitemap for root-relative routes",
        false,
        e.message,
      );
      ctx = null;
    }
    if (ctx) {
      const { tmp, project, pagesDir } = ctx;
      try {
        const about = svc.schema.createSchemaPage(project, pagesRel, "about");
        if (!about.ok) {
          record(
            "canonical matches sitemap for root-relative routes",
            false,
            about.error ?? "about page",
          );
        } else {
          const siteRead = svc.schema.readSiteDocument(project);
          if (!siteRead.ok || !siteRead.site) {
            record(
              "canonical matches sitemap for root-relative routes",
              false,
              "no site",
            );
          } else {
            siteRead.site.siteUrl = siteUrlDocs;
            svc.schema.writeSiteDocument(project, siteRead.site, pagesRel);
            const sitemapPath = path.join(project, "public", "sitemap.xml");
            const sitemap = fs.existsSync(sitemapPath)
              ? fs.readFileSync(sitemapPath, "utf8")
              : "";
            const loc = sitemapLocForRoute(sitemap, "/about");
            const expected = svc.schema.resolveAbsoluteHttpUrl(
              siteUrlDocs,
              "/about",
            );
            const layoutPath = path.join(
              project,
              siteRead.site.shell.layoutPath.replace(/\\/g, "/"),
            );
            const layoutSrc = fs.readFileSync(layoutPath, "utf8");
            const layoutAbs = callExtractedLayoutAbsolute(layoutSrc, "/about");
            const layoutHref = layoutAbs.ok ? layoutAbs.href : "";
            const pass =
              loc === expected &&
              layoutHref === expected &&
              loc === layoutHref &&
              loc.length > 0;
            record(
              "canonical matches sitemap for root-relative routes",
              pass,
              layoutAbs.ok
                ? `loc=${loc} layout=${layoutHref} expected=${expected}`
                : (layoutAbs.error ?? "layout eval failed"),
            );
          }
        }
      } finally {
        rm(tmp);
      }
    }
  }

  // 2. Sidecar write when .zephus is a symlink outside the project.
  {
    let ctx;
    const external = fs.mkdtempSync(
      path.join(os.tmpdir(), "zephus-e2e-zephus-out-"),
    );
    try {
      ctx = mkSite(svc, "minimal");
      const { tmp, project, pagesDir } = ctx;
      const page = firstPage(pagesDir);
      let pageDoc = null;
      if (page) {
        const doc = svc.schema.readPageDocument(project, page, pagesRel);
        if (doc.ok && doc.pageDocument) pageDoc = doc.pageDocument;
      }
      const zephusLink = path.join(project, ".zephus");
      fs.rmSync(zephusLink, { recursive: true, force: true });
      fs.symlinkSync(external, zephusLink, "dir");
      let threw = false;
      if (pageDoc) {
        try {
          svc.schema.writePageDocumentFile(project, pageDoc);
        } catch {
          threw = true;
        }
      }
      const outsideJson = fs
        .readdirSync(external, { recursive: true, withFileTypes: true })
        .some((e) => e.isFile() && e.name.endsWith(".json"));
      const pass = threw && !outsideJson;
      record(
        "sidecar write rejects external zephus symlink",
        pass,
        `threw=${threw} outsideJson=${outsideJson}`,
      );
      rm(tmp);
    } catch (e) {
      record("sidecar write rejects external zephus symlink", false, e.message);
    } finally {
      rm(external);
    }
  }

  // 2b. listPages must not follow src/pages symlink outside the project.
  {
    let ctx;
    const external = fs.mkdtempSync(
      path.join(os.tmpdir(), "zephus-e2e-pages-out-"),
    );
    try {
      fs.writeFileSync(
        path.join(external, "leak-outside.astro"),
        "---\n---\n<p>outside</p>\n",
        "utf8",
      );
      ctx = mkSite(svc, "minimal");
      const { tmp, project } = ctx;
      const pagesLink = path.join(project, "src", "pages");
      fs.rmSync(pagesLink, { recursive: true, force: true });
      fs.symlinkSync(external, pagesLink, "dir");
      const projectMod = await import(
        pathToFileURL(path.join(ROOT, "dist", "main", "services", "project.js"))
          .href
      );
      const listed = projectMod.listPages(project, "src/pages");
      const leaked = listed.some((p) =>
        p.replace(/\\/g, "/").endsWith("leak-outside.astro"),
      );
      record(
        "listPages rejects external pages symlink",
        !leaked,
        `listed=${listed.join(", ") || "(empty)"}`,
      );
      rm(tmp);
    } catch (e) {
      record("listPages rejects external pages symlink", false, e.message);
    } finally {
      rm(external);
    }
  }

  // 2c. Non-array `sections` sidecar must not empty the sidecar or rewrite .astro.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
      const { tmp, project, pagesDir } = ctx;
      const pagesRel = "src/pages";
      const page = firstPage(pagesDir);
      if (!page) {
        record("malformed sections sidecar preserved", false, "no page");
      } else {
        const astroPath = path.join(pagesDir, page);
        const astroBefore = fs.readFileSync(astroPath, "utf8");
        const slug =
          page === "index.astro" ? "index" : page.replace(/\.astro$/, "");
        const sidecarPath = path.join(
          project,
          ".zephus",
          "pages",
          `${slug}.json`,
        );
        const prior = fs.existsSync(sidecarPath)
          ? JSON.parse(fs.readFileSync(sidecarPath, "utf8"))
          : null;
        const badSidecar = {
          ...(prior ?? {}),
          slug,
          page: `${pagesRel}/${page}`.replace(/\\/g, "/"),
          sections: "not-an-array",
        };
        fs.writeFileSync(
          sidecarPath,
          JSON.stringify(badSidecar, null, 2),
          "utf8",
        );
        svc.schema.ensureVisualSchema(project, pagesRel);
        const sidecarAfter = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
        const astroAfter = fs.readFileSync(astroPath, "utf8");
        const preserved =
          sidecarAfter.sections === "not-an-array" &&
          astroAfter === astroBefore;
        record(
          "malformed sections sidecar preserved",
          preserved,
          `sectionsType=${typeof sidecarAfter.sections} astroChanged=${astroAfter !== astroBefore}`,
        );
      }
      rm(tmp);
    } catch (e) {
      record("malformed sections sidecar preserved", false, e.message);
    }
  }

  // 3. Nested index save keeps file path, route, and refuses dual blog files.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record("nested index save keeps file and route", false, e.message);
      ctx = null;
    }
    if (ctx) {
      const { tmp, project, pagesDir } = ctx;
      try {
        const created = svc.schema.createSchemaPage(
          project,
          pagesRel,
          "blog/index",
        );
        const indexPath = path.join(pagesDir, "blog", "index.astro");
        const flatPath = path.join(pagesDir, "blog.astro");
        let routeOk = false;
        if (created.ok && created.pageDocument) {
          routeOk = created.pageDocument.route === "/blog";
        }
        const pathOk = fs.existsSync(indexPath) && !fs.existsSync(flatPath);
        record(
          "nested index save keeps file and route",
          created.ok && pathOk && routeOk,
          `created=${created.ok} index=${fs.existsSync(indexPath)} flat=${fs.existsSync(flatPath)} route=${created.pageDocument?.route}`,
        );

        fs.mkdirSync(path.dirname(indexPath), { recursive: true });
        fs.writeFileSync(
          flatPath,
          "---\nimport BaseLayout from '../../layouts/BaseLayout.astro';\n---\n<p>flat</p>\n",
          "utf8",
        );
        fs.writeFileSync(
          indexPath,
          "---\nimport BaseLayout from '../../layouts/BaseLayout.astro';\n---\n<p>index</p>\n",
          "utf8",
        );
        const flatBefore = fs.readFileSync(flatPath, "utf8");
        const indexBefore = fs.readFileSync(indexPath, "utf8");
        let dualThrew = false;
        let dualOk = false;
        const indexRel = path
          .join(pagesRel, "blog", "index.astro")
          .replace(/\\/g, "/");
        const indexDoc = svc.schema.readPageDocument(
          project,
          indexRel,
          pagesRel,
        );
        if (indexDoc.ok && indexDoc.pageDocument) {
          try {
            const res = svc.schema.writePageDocument(
              project,
              pagesRel,
              indexDoc.pageDocument,
            );
            dualOk = !!res.ok;
          } catch {
            dualThrew = true;
          }
        }
        const unchanged =
          fs.readFileSync(flatPath, "utf8") === flatBefore &&
          fs.readFileSync(indexPath, "utf8") === indexBefore;
        record(
          "nested index dual file save refused",
          (dualThrew || !dualOk) && unchanged,
          `dualOk=${dualOk} threw=${dualThrew} unchanged=${unchanged}`,
        );
      } finally {
        rm(tmp);
      }
    }
  }

  // 4. Hide on desktop uses min-width media query, not inline display:none.
  {
    const sections = [
      {
        id: "sec-hide-desktop",
        type: "section",
        label: "Hide desktop",
        props: { wrapper: "none", cls: "" },
        children: [
          {
            id: "block-desktop-hide",
            type: "text",
            props: { text: "Hide me on desktop" },
            style: { hideOn: ["desktop"] },
          },
        ],
      },
    ];
    const css = blockRender.collectResponsiveCss(sections);
    const markup = blockRender.renderSectionsMarkup(sections, (block) =>
      blockRender.renderBlockHtml(block),
    );
    const desktopMedia =
      /@media[^{]*min-width:\s*1025px[\s\S]*display\s*:\s*none/i.test(css);
    const inlineHide = /style="[^"]*display\s*:\s*none/i.test(markup);
    record(
      "hideOn desktop min-width query",
      desktopMedia && !inlineHide,
      `desktopMedia=${desktopMedia} inlineHide=${inlineHide}`,
    );
  }

  // 5. safeUrl rejects leading C0 control before javascript: scheme.
  {
    const rh = await import(
      pathToFileURL(path.join(ROOT, "dist", "shared", "renderHelpers.js")).href
    );
    const payload = `\u0001javascript:alert(1)`;
    record(
      "safeUrl rejects C0 javascript scheme",
      rh.safeUrl(payload) === "",
      `got=${JSON.stringify(rh.safeUrl(payload))}`,
    );
  }

  // 6. Custom frontmatter survives post-list refresh when another page saves.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record("custom frontmatter survives post list refresh", false, e.message);
      ctx = null;
    }
    if (ctx) {
      const { tmp, project, pagesDir } = ctx;
      try {
        const indexRel = path.join(pagesRel, "index.astro").replace(/\\/g, "/");
        const indexDoc = svc.schema.readPageDocument(
          project,
          indexRel,
          pagesRel,
        );
        const marker = "customE2eProbe: keep-me";
        if (indexDoc.ok && indexDoc.pageDocument) {
          const sec = indexDoc.pageDocument.sections[0];
          if (sec) {
            sec.children.push({
              id: "e2e-postlist",
              type: "postlist",
              props: { limit: "5", cls: "" },
              style: {},
            });
          }
          svc.schema.writePageDocument(
            project,
            pagesRel,
            indexDoc.pageDocument,
          );
        }
        const indexPath = path.join(pagesDir, "index.astro");
        let raw = fs.readFileSync(indexPath, "utf8");
        if (!raw.includes(marker)) {
          raw = raw.replace(/^---\n/m, `---\n${marker}\n`);
          fs.writeFileSync(indexPath, raw, "utf8");
        }
        const resync = svc.schema.readPageDocument(project, indexRel, pagesRel);
        if (resync.ok && resync.pageDocument) {
          svc.schema.writePageDocument(project, pagesRel, resync.pageDocument);
        }
        const other = svc.schema.createSchemaPage(
          project,
          pagesRel,
          "e2e-other",
        );
        if (!other.ok) {
          record(
            "custom frontmatter survives post list refresh",
            false,
            other.error ?? "other page",
          );
        } else {
          const after = fs.readFileSync(indexPath, "utf8");
          record(
            "custom frontmatter survives post list refresh",
            after.includes(marker),
            after.includes(marker) ? "ok" : "marker missing after other save",
          );
        }
      } finally {
        rm(tmp);
      }
    }
  }

  // 7. Secret .env paths must not return file bytes from read or reattach.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record("secret env page read returns null source", false, e.message);
      record("secret env reattach returns null source", false, e.message);
      ctx = null;
    }
    if (ctx) {
      const { tmp, project } = ctx;
      const secretBody = "SECRET_E2E_ZEPHUS=1";
      const envPath = path.join(project, ".env");
      try {
        fs.writeFileSync(envPath, `${secretBody}\n`, "utf8");
        const readRes = svc.schema.readPageDocument(project, ".env", pagesRel);
        const readPass =
          readRes.source === null &&
          !JSON.stringify(readRes).includes(secretBody);
        record(
          "secret env page read returns null source",
          readPass,
          readRes.source ? "source returned" : `ok=${readRes.ok}`,
        );
        const reattachRes = svc.schema.reattachPageDocument(
          project,
          ".env",
          pagesRel,
        );
        const reattachPass =
          reattachRes.source === null &&
          !JSON.stringify(reattachRes).includes(secretBody);
        record(
          "secret env reattach returns null source",
          reattachPass,
          reattachRes.source ? "source returned" : `ok=${reattachRes.ok}`,
        );
      } finally {
        fs.rmSync(envPath, { force: true });
        rm(tmp);
      }
    }
  }

  // 8. Managed layoutPath must not overwrite package.json.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record(
        "managed layoutPath cannot clobber package.json",
        false,
        e.message,
      );
      ctx = null;
    }
    if (ctx) {
      const { tmp, project } = ctx;
      const pkgPath = path.join(project, "package.json");
      try {
        const before = fs.readFileSync(pkgPath, "utf8");
        const siteRead = svc.schema.readSiteDocument(project);
        if (!siteRead.ok || !siteRead.site) {
          record(
            "managed layoutPath cannot clobber package.json",
            false,
            "no site",
          );
        } else {
          siteRead.site.shell.layoutPath = "package.json";
          siteRead.site.shell.layoutMode = "managed";
          svc.schema.writeSiteDocument(project, siteRead.site, pagesRel);
          const after = fs.readFileSync(pkgPath, "utf8");
          record(
            "managed layoutPath cannot clobber package.json",
            after === before,
            after === before ? "ok" : "package.json changed",
          );
        }
      } finally {
        rm(tmp);
      }
    }
  }

  // 9. Git must refuse directory adds with nested secrets and broad pathspecs.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record("git commit all refuses directory npmrc", false, e.message);
      record("commitProjectPaths refuses broad pathspecs", false, e.message);
      ctx = null;
    }
    if (ctx) {
      const { tmp, project } = ctx;
      try {
        if (!fs.existsSync(path.join(project, ".git"))) {
          execFileSync("git", ["init"], { cwd: project, stdio: "ignore" });
        }
        execFileSync("git", ["config", "user.name", "E2E"], {
          cwd: project,
          stdio: "ignore",
        });
        execFileSync("git", ["config", "user.email", "e2e@zephus.local"], {
          cwd: project,
          stdio: "ignore",
        });
        const secretDir = path.join(project, "nested-secret-dir");
        fs.mkdirSync(secretDir, { recursive: true });
        fs.writeFileSync(path.join(secretDir, ".npmrc"), "token=1\n", "utf8");
        const gitMod = await import(
          pathToFileURL(path.join(ROOT, "dist", "main", "services", "git.js"))
            .href
        );
        const commitAll = await gitMod.commitAllChanges(
          project,
          "e2e secret dir",
        );
        record(
          "git commit all refuses directory npmrc",
          !commitAll.ok,
          commitAll.ok ? "commit succeeded" : (commitAll.error ?? "refused"),
        );
        fs.writeFileSync(path.join(project, "track-me.txt"), "x\n", "utf8");
        const dotCommit = await gitMod.commitProjectPaths(project, "e2e dot", [
          ".",
        ]);
        const starCommit = await gitMod.commitProjectPaths(
          project,
          "e2e star",
          ["*"],
        );
        record(
          "commitProjectPaths refuses broad pathspecs",
          !dotCommit.ok && !starCommit.ok,
          `dot=${dotCommit.ok ? "ok" : dotCommit.error} star=${starCommit.ok ? "ok" : starCommit.error}`,
        );
      } finally {
        rm(tmp);
      }
    }
  }

  // 10. Custom Node path must not prepend its directory to PATH.
  {
    const nodeCheck = await import(
      pathToFileURL(path.join(ROOT, "dist", "main", "services", "nodeCheck.js"))
        .href
    );
    const env = await nodeCheck.buildSpawnEnv(process.execPath, {
      PATH: "/usr/bin:/bin",
    });
    const key =
      process.platform === "win32"
        ? (Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH")
        : "PATH";
    const parts = String(env[key] ?? "")
      .split(process.platform === "win32" ? ";" : ":")
      .filter(Boolean);
    const nodeDir = path.dirname(process.execPath);
    const pass = parts.length === 0 || parts[0] !== nodeDir;
    record(
      "buildSpawnEnv omits custom node dir from PATH front",
      pass,
      `first=${parts[0] ?? ""} nodeDir=${nodeDir}`,
    );
  }

  // 11. Asset usage scan must fail when a page file has no sidecar.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record("findAssetUsage fails without page sidecar", false, e.message);
      ctx = null;
    }
    if (ctx) {
      const { tmp, project, pagesDir } = ctx;
      try {
        const orphan = path.join(pagesDir, "orphan-no-sidecar.astro");
        fs.writeFileSync(
          orphan,
          "---\nimport BaseLayout from '../../layouts/BaseLayout.astro';\n---\n<p>orphan</p>\n",
          "utf8",
        );
        const assetUsage = await import(
          pathToFileURL(
            path.join(ROOT, "dist", "main", "services", "assetUsage.js"),
          ).href
        );
        const usage = assetUsage.findAssetUsage(
          project,
          pagesRel,
          "/images/none.png",
        );
        record(
          "findAssetUsage fails without page sidecar",
          usage.ok === false,
          usage.ok ? "ok=true with orphan page" : (usage.error ?? "ok=false"),
        );
      } finally {
        rm(tmp);
      }
    }
  }

  // 12. Stale publish hint must not beat Astro config outDir.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record("publish outDir ignores stale dist hint", false, e.message);
      ctx = null;
    }
    if (ctx) {
      const { tmp, project } = ctx;
      try {
        const cfgPath = path.join(project, "astro.config.mjs");
        let cfg = fs.readFileSync(cfgPath, "utf8");
        if (!/outDir\s*:/.test(cfg)) {
          cfg = cfg.replace(
            /defineConfig\s*\(\s*\{/,
            "defineConfig({\n  outDir: 'build',",
          );
        } else {
          cfg = cfg.replace(/outDir\s*:\s*['"][^'"]+['"]/, "outDir: 'build'");
        }
        fs.writeFileSync(cfgPath, cfg, "utf8");
        fs.mkdirSync(path.join(project, "dist"), { recursive: true });
        fs.writeFileSync(
          path.join(project, "dist", "index.html"),
          "<html></html>",
          "utf8",
        );
        const projectPaths = await import(
          pathToFileURL(
            path.join(ROOT, "dist", "main", "services", "projectPaths.js"),
          ).href
        );
        const resolved = projectPaths.resolveValidatedBuildOutputDir(
          project,
          "dist",
        );
        const pass =
          resolved.ok &&
          resolved.relative === "build" &&
          resolved.absolute.endsWith(`${path.sep}build`);
        record(
          "publish outDir ignores stale dist hint",
          pass,
          resolved.ok
            ? `relative=${resolved.relative}`
            : (resolved.error ?? "failed"),
        );
      } finally {
        rm(tmp);
      }
    }
  }

  // 13. Prerelease upload set must not include latest.yml for 1.0.0-beta.1.
  {
    const policy = require("./release-upload-policy.js");
    const version = "1.0.0-beta.1";
    const releaseDir = path.join(os.tmpdir(), "zephus-e2e-release-upload");
    fs.mkdirSync(releaseDir, { recursive: true });
    const entries = ["latest.yml", "Zephus-1.0.0-beta.1.dmg"];
    const uploads = policy.getReleaseUploadFiles(entries, releaseDir, version);
    const isPrerelease = policy.isGithubPrereleaseVersion(version);
    const hasLatest = uploads.some((p) =>
      /^latest\.ya?ml$/i.test(path.basename(p)),
    );
    record(
      "prerelease upload omits latest yml",
      isPrerelease && !hasLatest,
      `isPrerelease=${isPrerelease} hasLatest=${hasLatest}`,
    );
  }
}

async function runWebEngineAndUiAuditChecks(svc, blockRender) {
  const esbuild = require("esbuild");
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const compileRendererHelper = (entryRel) => {
    const out = esbuild.buildSync({
      entryPoints: [path.join(ROOT, entryRel)],
      bundle: true,
      write: false,
      format: "cjs",
      platform: "node",
    });
    const mod = { exports: {} };
    const sandbox = {
      module: mod,
      exports: mod.exports,
      require,
      console,
      URL,
      decodeURIComponent,
      encodeURIComponent,
      window: dom.window,
      document: dom.window.document,
      DOMParser: dom.window.DOMParser,
      NodeFilter: dom.window.NodeFilter,
      HTMLElement: dom.window.HTMLElement,
      HTMLTemplateElement: dom.window.HTMLTemplateElement,
      Element: dom.window.Element,
      Node: dom.window.Node,
    };
    vm.runInNewContext(out.outputFiles[0].text, sandbox, { timeout: 5000 });
    return mod.exports;
  };

  let editorBlockRender;
  let editorParse;
  let editorBlocks;
  let editorSerialize;
  try {
    editorBlockRender = compileRendererHelper(
      "src/renderer/editorBlockRender.ts",
    );
    editorParse = compileRendererHelper("src/renderer/editorParse.ts");
    editorBlocks = compileRendererHelper("src/renderer/editorBlocks.ts");
    editorSerialize = compileRendererHelper("src/renderer/editorSerialize.ts");
  } catch (e) {
    record("web engine helpers bundle for e2e", false, e.message);
    return;
  }

  // 1. Post List self-exclusion parity between build renderer and editor renderer.
  {
    const postListBlock = {
      id: "pl-e2e",
      type: "postlist",
      props: { title: "Posts", folder: "/blog", limit: "5", cls: "" },
    };
    const posts = [
      { route: "/blog", title: "Blog Index", date: "2026-01-01" },
      { route: "/blog/hello", title: "Hello World", date: "2026-01-02" },
    ];
    const buildHtml = blockRender.renderBlockHtml(postListBlock, {
      viewport: "desktop",
      forCanvas: false,
      maxHeadingLevel: 6,
      posts,
      excludePostListPageRoute: "/blog",
    });
    const editorSerializeHtml = editorBlockRender.blockToHtmlForEditor(
      postListBlock,
      {
        viewport: "desktop",
        forCanvas: false,
        canvasMaxHeadingLevel: 6,
        posts,
        excludePostListPageRoute: "/blog",
      },
    );
    const editorCanvasHtml = editorBlockRender.blockToHtmlForEditor(
      postListBlock,
      {
        viewport: "desktop",
        forCanvas: true,
        canvasMaxHeadingLevel: 6,
        posts,
        excludePostListPageRoute: "/blog",
      },
    );
    const engineSrc = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "zephusEngine.ts"),
      "utf8",
    );
    const engineForwardsRoute =
      engineSrc.includes("excludePostListPageRoute") &&
      editorSerializeHtml === buildHtml &&
      !editorSerializeHtml.includes('href="/blog"') &&
      !editorCanvasHtml.includes('href="/blog"') &&
      editorCanvasHtml.includes('href="/blog/hello"');
    record(
      "postlist self-exclusion editor parity",
      engineForwardsRoute,
      `serializeMatch=${editorSerializeHtml === buildHtml} canvasHasSelf=${editorCanvasHtml.includes('href="/blog"')}`,
    );
  }

  // 2. Legacy inline text-align parity between main regex parser and renderer DOM parser.
  {
    let uid = 0;
    const parser = editorParse.createEditorPageParser({
      uid: () => `e2e-${++uid}`,
      createFallbackSection: () => ({
        id: `e2e-${++uid}`,
        type: "section",
        label: "Main",
        props: { wrapper: "none", cls: "" },
        children: [],
      }),
      knownBlockTypes: editorBlocks.KNOWN_BLOCK_TYPES,
    });
    const src =
      '---\nimport BaseLayout from "../layouts/BaseLayout.astro";\n---\n<BaseLayout>\n<p style="color:red; text-align: center">Centered copy</p>\n</BaseLayout>\n';
    const mainSections = svc.schema.parseSectionsFromSource(src);
    const { inner } = editorSerialize.splitManagedPageSource(src);
    const editorSections = parser.parseSections(inner);
    const mainAlign = mainSections[0]?.children?.[0]?.style?.align;
    const editorAlign = editorSections[0]?.children?.[0]?.style?.align;
    record(
      "legacy inline style text-align parser parity",
      mainAlign === "center" && editorAlign === "center",
      `mainAlign=${String(mainAlign)} editorAlign=${String(editorAlign)}`,
    );
  }

  // 3. Reusable sections storage containment blocks symlink escapes.
  {
    if (process.platform === "win32") {
      record(
        "reusable sections symlink escape blocked",
        true,
        "skipped on win32",
      );
    } else {
      const reusable = await import(
        pathToFileURL(
          path.join(ROOT, "dist", "main", "services", "reusableSections.js"),
        ).href
      );
      const tmp = fs.mkdtempSync(
        path.join(os.tmpdir(), "zephus-e2e-reusable-"),
      );
      try {
        const outsideDir = path.join(tmp, "outside");
        const project = path.join(tmp, "project");
        fs.mkdirSync(outsideDir, { recursive: true });
        fs.mkdirSync(path.join(project, ".zephus"), { recursive: true });
        const outsideFile = path.join(outsideDir, "reusable-sections.json");
        const initialOutside = JSON.stringify([
          {
            id: "ext-1",
            label: "Outside Secret",
            html: "<p>outside</p>",
            updatedAt: "2026-01-01",
          },
        ]);
        fs.writeFileSync(outsideFile, initialOutside, "utf8");
        fs.symlinkSync(outsideDir, path.join(project, ".zephus", "templates"));

        const listed = reusable.listReusableSections(project);
        const saved = reusable.saveReusableSection(
          project,
          "Inject",
          "<p>x</p>",
        );
        const deleted = reusable.deleteReusableSection(project, "ext-1");
        const afterOutside = fs.readFileSync(outsideFile, "utf8");

        const pass =
          listed.ok === false &&
          listed.sections.length === 0 &&
          saved.ok === false &&
          deleted.ok === false &&
          afterOutside === initialOutside;
        record(
          "reusable sections symlink escape blocked",
          pass,
          `listOk=${listed.ok} saveOk=${saved.ok} delOk=${deleted.ok} intact=${afterOutside === initialOutside}`,
        );
      } catch (e) {
        record("reusable sections symlink escape blocked", false, e.message);
      } finally {
        rm(tmp);
      }
    }
  }

  // 4. Asset repoint preserves structural metadata and updates reusable sections.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record(
        "asset repoint structural safety & reusable sections",
        false,
        e.message,
      );
      ctx = null;
    }
    if (ctx) {
      const { tmp, project } = ctx;
      try {
        const assetUsage = await import(
          pathToFileURL(
            path.join(ROOT, "dist", "main", "services", "assetUsage.js"),
          ).href
        );
        const reusable = await import(
          pathToFileURL(
            path.join(ROOT, "dist", "main", "services", "reusableSections.js"),
          ).href
        );
        const rel = "index.astro";
        const readDoc = svc.schema.readPageDocument(project, rel, "src/pages");
        const oldAsset = "/assets/images/logo.png";
        const newAsset = "/assets/images/brand.svg";
        svc.schema.writePageDocument(project, "src/pages", {
          ...readDoc.pageDocument,
          sections: [
            {
              id: "sec-assets-band",
              type: "section",
              label: `${oldAsset} Band`,
              props: { wrapper: "none", cls: oldAsset },
              children: [
                {
                  id: "h-e2e",
                  type: "heading",
                  props: { text: `See ${oldAsset}`, level: "2", cls: oldAsset },
                },
                {
                  id: "img-e2e",
                  type: "image",
                  props: { src: oldAsset, alt: "Brand", cls: oldAsset },
                },
              ],
            },
          ],
        });
        reusable.saveReusableSection(
          project,
          "Footer Brand",
          `<img src="${oldAsset}" alt="Brand" />`,
        );

        const usage = assetUsage.findAssetUsage(project, "src/pages", oldAsset);
        const repoint = assetUsage.repointAssetReferences(
          project,
          "src/pages",
          oldAsset,
          newAsset,
        );
        const afterDoc = svc.schema.readPageDocument(project, rel, "src/pages");
        const afterSec = afterDoc.pageDocument?.sections?.[0];
        const afterH = afterSec?.children?.[0];
        const afterImg = afterSec?.children?.[1];
        const afterReusable = reusable.listReusableSections(project);

        const hasReusableRef =
          Array.isArray(usage.siteReferences) &&
          usage.siteReferences.some((s) => s.includes("Footer Brand"));
        const structuralIntact =
          afterSec?.label === `${oldAsset} Band` &&
          afterSec?.props?.cls === oldAsset &&
          afterH?.props?.cls === oldAsset &&
          afterImg?.props?.cls === oldAsset;
        const contentUpdated =
          afterImg?.props?.src === newAsset &&
          afterH?.props?.text === `See ${newAsset}` &&
          afterReusable.sections?.[0]?.html?.includes(newAsset);

        record(
          "asset repoint structural safety & reusable sections",
          !!repoint.ok &&
            hasReusableRef &&
            structuralIntact &&
            !!contentUpdated,
          `hasReusableRef=${hasReusableRef} structuralIntact=${structuralIntact} contentUpdated=${contentUpdated}`,
        );
      } catch (e) {
        record(
          "asset repoint structural safety & reusable sections",
          false,
          e.message,
        );
      } finally {
        rm(tmp);
      }
    }
  }

  // 5. Un-annotated <video> elements migrate cleanly to video blocks across both parsers.
  {
    let uid = 0;
    const parser = editorParse.createEditorPageParser({
      uid: () => `e2e-v-${++uid}`,
      createFallbackSection: () => ({
        id: `e2e-v-${++uid}`,
        type: "section",
        label: "Main",
        props: { wrapper: "none", cls: "" },
        children: [],
      }),
      knownBlockTypes: editorBlocks.KNOWN_BLOCK_TYPES,
    });
    const xssUrl = "java" + "script:alert(1)";
    const src =
      '---\nimport BaseLayout from "../layouts/BaseLayout.astro";\n---\n<BaseLayout>\n' +
      '<video controls src="/assets/clip.mp4" title="Demo"></video>\n' +
      '<video controls style="width: 100%; border-radius: 8px" title="SourceDemo"><source src="/assets/alt.webm" type="video/webm" /></video>\n' +
      `<video src="${xssUrl}"></video>\n` +
      "</BaseLayout>\n";
    const mainBlocks =
      svc.schema.parseSectionsFromSource(src)[0]?.children ?? [];
    const { inner } = editorSerialize.splitManagedPageSource(src);
    const editorBlocksParsed = parser.parseSections(inner)[0]?.children ?? [];

    const checkList = (blocks) =>
      blocks.length === 3 &&
      blocks[0].type === "video" &&
      blocks[0].props?.src === "/assets/clip.mp4" &&
      blocks[0].props?.title === "Demo" &&
      blocks[1].type === "video" &&
      blocks[1].props?.src === "/assets/alt.webm" &&
      blocks[1].props?.title === "SourceDemo" &&
      blocks[1].style?.radius === "8px" &&
      blocks[2].type === "html";

    const okMain = checkList(mainBlocks);
    const okEditor = checkList(editorBlocksParsed);
    record(
      "unannotated video migration parity",
      okMain && okEditor,
      `main=${okMain} editor=${okEditor}`,
    );
  }

  // 6. Managed stylesheet includes complete runtime styles for all supported blocks & shadows.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record("managed stylesheet covers all block classes", false, e.message);
      ctx = null;
    }
    if (ctx) {
      const { tmp, project } = ctx;
      try {
        const cssPath = path.join(
          project,
          "public",
          "styles",
          "zephus-managed.css",
        );
        const css = fs.existsSync(cssPath)
          ? fs.readFileSync(cssPath, "utf8")
          : "";
        const requiredSelectors = [
          "--shadow-sm",
          "--shadow-md",
          ".section-box",
          ".button",
          ".lead",
          ".zephus-column",
          ".zephus-feature",
          ".zephus-testimonial",
          ".zephus-accordion",
          ".zephus-stats",
          ".zephus-pricing",
          ".zephus-cta",
          ".zephus-postlist",
          ".zephus-gallery",
          'iframe[data-zephus-block="embed"]',
        ];
        const missing = requiredSelectors.filter((sel) => !css.includes(sel));
        record(
          "managed stylesheet covers all block classes",
          missing.length === 0,
          missing.length === 0 ? "ok" : `missing: ${missing.join(", ")}`,
        );
      } finally {
        rm(tmp);
      }
    }
  }

  // 7. Dangling symlink escape blocked in assertRealpathInside & duplicatePage.
  {
    if (process.platform === "win32") {
      record(
        "dangling symlink escape blocked in assertRealpathInside",
        true,
        "skipped on win32",
      );
    } else {
      let ctx;
      try {
        ctx = mkSite(svc, "minimal");
      } catch (e) {
        record(
          "dangling symlink escape blocked in assertRealpathInside",
          false,
          e.message,
        );
        ctx = null;
      }
      if (ctx) {
        const { tmp, project } = ctx;
        try {
          const fsSafe = await import(
            pathToFileURL(
              path.join(ROOT, "dist", "main", "services", "fsSafe.js"),
            ).href
          );
          const outsideTarget = path.join(tmp, "outside-target.astro");
          const linkPath = path.join(project, "src", "pages", "escape.astro");
          fs.symlinkSync(outsideTarget, linkPath);
          let threw = false;
          try {
            fsSafe.assertRealpathInside(project, linkPath);
          } catch {
            threw = true;
          }
          const dup = svc.pageManager.duplicatePage(
            project,
            "src/pages/index.astro",
            "src/pages",
            "escape",
          );
          const createdOutside = fs.existsSync(outsideTarget);
          record(
            "dangling symlink escape blocked in assertRealpathInside",
            threw && dup.ok === false && !createdOutside,
            `threw=${threw} dupOk=${dup.ok} createdOutside=${createdOutside}`,
          );
        } catch (e) {
          record(
            "dangling symlink escape blocked in assertRealpathInside",
            false,
            e.message,
          );
        } finally {
          rm(tmp);
        }
      }
    }
  }

  // 8. Repo settings symlink containment blocks external reads and .corrupt backups.
  {
    if (process.platform === "win32") {
      record("repo settings symlink containment", true, "skipped on win32");
    } else {
      let ctx;
      try {
        ctx = mkSite(svc, "minimal");
      } catch (e) {
        record("repo settings symlink containment", false, e.message);
        ctx = null;
      }
      if (ctx) {
        const { tmp, project } = ctx;
        try {
          const settingsSvc = await import(
            pathToFileURL(
              path.join(ROOT, "dist", "main", "services", "settings.js"),
            ).href
          );
          const secretFile = path.join(tmp, "outside-secret.txt");
          fs.writeFileSync(secretFile, "PRIVATE=1\n", "utf8");
          const settingsPath = path.join(project, ".zephus", "settings.json");
          fs.rmSync(settingsPath, { force: true });
          fs.symlinkSync(secretFile, settingsPath);
          const loaded = settingsSvc.readRepoSettings(project);
          const hasCorruptBackup = fs
            .readdirSync(path.join(project, ".zephus"))
            .some((name) => name.includes(".corrupt-"));
          record(
            "repo settings symlink containment",
            loaded.schemaVersion === 1 && !hasCorruptBackup,
            `schemaVersion=${loaded.schemaVersion} hasCorrupt=${hasCorruptBackup}`,
          );
        } catch (e) {
          record("repo settings symlink containment", false, e.message);
        } finally {
          rm(tmp);
        }
      }
    }
  }

  // 9. detachPageDocument pins pagesDir and blocks layout overwrite.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record(
        "detachPageDocument pins pagesDir and blocks layout overwrite",
        false,
        e.message,
      );
      ctx = null;
    }
    if (ctx) {
      const { tmp, project } = ctx;
      try {
        const layoutPath = path.join(
          project,
          "src",
          "layouts",
          "BaseLayout.astro",
        );
        const before = fs.readFileSync(layoutPath, "utf8");
        const res = svc.schema.detachPageDocument(
          project,
          "src/layouts/BaseLayout.astro",
          "src/layouts",
          "<p>pwned</p>",
        );
        const after = fs.readFileSync(layoutPath, "utf8");
        record(
          "detachPageDocument pins pagesDir and blocks layout overwrite",
          res.ok === false && after === before,
          `ok=${res.ok} unchanged=${after === before}`,
        );
      } finally {
        rm(tmp);
      }
    }
  }

  // 10. writeProjectFile blocks vite, postcss, and tailwind config execution.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record(
        "writeProjectFile blocks vite/postcss/tailwind configs",
        false,
        e.message,
      );
      ctx = null;
    }
    if (ctx) {
      const { tmp, project } = ctx;
      try {
        const filesSvc = await import(
          pathToFileURL(path.join(ROOT, "dist", "main", "services", "files.js"))
            .href
        );
        const targets = [
          "vite.config.mjs",
          "postcss.config.js",
          "tailwind.config.ts",
        ];
        const results = targets.map((cfg) => ({
          cfg,
          res: filesSvc.writeProjectFile(project, cfg, "export default {};"),
        }));
        const allBlocked = results.every((r) => r.res.ok === false);
        record(
          "writeProjectFile blocks vite/postcss/tailwind configs",
          allBlocked,
          results.map((r) => `${r.cfg}:${r.res.ok}`).join(", "),
        );
      } finally {
        rm(tmp);
      }
    }
  }

  // 11. reattachPageDocument recovers out-of-sync page.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record(
        "reattachPageDocument recovers out-of-sync page",
        false,
        e.message,
      );
      ctx = null;
    }
    if (ctx) {
      const { tmp, project } = ctx;
      try {
        const pageRel = "src/pages/index.astro";
        const pageFile = path.join(project, pageRel);
        const updated = fs
          .readFileSync(pageFile, "utf8")
          .replace("</BaseLayout>", "  <p>Hand edit</p>\n</BaseLayout>");
        fs.writeFileSync(pageFile, updated, "utf8");
        const before = svc.schema.readPageDocument(
          project,
          pageRel,
          "src/pages",
        );
        const reattached = svc.schema.reattachPageDocument(
          project,
          pageRel,
          "src/pages",
        );
        const pass =
          before.pageDocument?.managedFileStatus === "out-of-sync" &&
          reattached.ok === true &&
          reattached.pageDocument?.managedFileStatus === "managed";
        record(
          "reattachPageDocument recovers out-of-sync page",
          pass,
          `before=${before.pageDocument?.managedFileStatus} after=${reattached.pageDocument?.managedFileStatus}`,
        );
      } finally {
        rm(tmp);
      }
    }
  }

  // 12. renamePage blocks home page and syncs detached page nav.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record(
        "renamePage blocks home page and syncs detached page nav",
        false,
        e.message,
      );
      ctx = null;
    }
    if (ctx) {
      const { tmp, project } = ctx;
      try {
        const homeRes = svc.pageManager.renamePage(
          project,
          "src/pages/index.astro",
          "src/pages",
          "home-renamed",
        );
        svc.schema.createSchemaPage(project, "src/pages", "team");
        svc.schema.detachPageDocument(
          project,
          "src/pages/team.astro",
          "src/pages",
          "---\nimport BaseLayout from '../layouts/BaseLayout.astro';\n---\n<BaseLayout><p>Team</p></BaseLayout>\n",
        );
        const teamRes = svc.pageManager.renamePage(
          project,
          "src/pages/team.astro",
          "src/pages",
          "our-team",
        );
        const siteDoc = svc.schema.readSiteDocument(project, "src/pages");
        const hasUpdatedNav = !!siteDoc.site?.shell?.navItems?.some(
          (item) => item.href === "/our-team",
        );
        record(
          "renamePage blocks home page and syncs detached page nav",
          homeRes.ok === false && teamRes.ok === true && hasUpdatedNav,
          `homeOk=${homeRes.ok} teamOk=${teamRes.ok} nav=${hasUpdatedNav}`,
        );
      } finally {
        rm(tmp);
      }
    }
  }

  // 13. Bare domain siteUrl generates discovery files.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record("bare domain siteUrl generates discovery files", false, e.message);
      ctx = null;
    }
    if (ctx) {
      const { tmp, project } = ctx;
      try {
        const siteRes = svc.schema.readSiteDocument(project, "src/pages");
        const written = svc.schema.writeSiteDocument(
          project,
          { ...siteRes.site, siteUrl: "example.com" },
          "src/pages",
        );
        const sitemapPath = path.join(project, "public", "sitemap.xml");
        const robotsPath = path.join(project, "public", "robots.txt");
        const sitemap = fs.existsSync(sitemapPath)
          ? fs.readFileSync(sitemapPath, "utf8")
          : "";
        const robots = fs.existsSync(robotsPath)
          ? fs.readFileSync(robotsPath, "utf8")
          : "";
        record(
          "bare domain siteUrl generates discovery files",
          written.ok &&
            sitemap.includes("https://example.com/") &&
            robots.includes("https://example.com/sitemap.xml"),
          `sitemap=${sitemap.includes("https://example.com/")} robots=${robots.includes("https://example.com/sitemap.xml")}`,
        );
      } finally {
        rm(tmp);
      }
    }
  }

  // 14. Postlist canvas image hydration and noindex exclusion.
  {
    const html = blockRender.renderBlockHtml(
      {
        id: "pl-img",
        type: "postlist",
        props: { title: "News", folder: "/blog", showImage: "true" },
      },
      {
        viewport: "desktop",
        forCanvas: true,
        maxHeadingLevel: 6,
        posts: [
          {
            route: "/blog/p1",
            title: "Post 1",
            description: "",
            date: "2026-01-01",
            author: "Alice",
            image: "/assets/images/hero.jpg",
          },
        ],
      },
    );
    const built = svc.schema.buildPostIndex([
      {
        page: "src/pages/blog/p1.astro",
        route: "/blog/p1",
        slug: "blog/p1",
        title: "P1",
        navLabel: "P1",
        metaDescription: "",
        navVisible: true,
        isHome: false,
        detached: false,
        socialImage: "/assets/images/hero.jpg",
        canonicalUrl: "",
        noindex: false,
        publishDate: "2026-01-01",
        author: "Alice",
      },
      {
        page: "src/pages/blog/hidden.astro",
        route: "/blog/hidden",
        slug: "blog/hidden",
        title: "Hidden",
        navLabel: "Hidden",
        metaDescription: "",
        navVisible: false,
        isHome: false,
        detached: false,
        socialImage: "",
        canonicalUrl: "",
        noindex: true,
        publishDate: "2026-01-02",
        author: "Alice",
      },
    ]);
    const hasPlaceholder =
      html.includes(`src="${blockRender.CANVAS_ASSET_PLACEHOLDER_SRC}"`) &&
      html.includes('data-asset-src="/assets/images/hero.jpg"');
    const excludesNoindex = built.length === 1 && built[0].route === "/blog/p1";
    record(
      "postlist canvas image hydration and noindex exclusion",
      hasPlaceholder && excludesNoindex,
      `placeholder=${hasPlaceholder} builtLen=${built.length}`,
    );
  }

  // 15. Blockquote without <p> and legacy section style parity.
  {
    let uid = 0;
    const parser = editorParse.createEditorPageParser({
      uid: () => `e2e-p-${++uid}`,
      createFallbackSection: () => ({
        id: `e2e-p-${++uid}`,
        type: "section",
        label: "Main",
        props: { wrapper: "none", cls: "" },
        children: [],
      }),
      knownBlockTypes: editorBlocks.KNOWN_BLOCK_TYPES,
    });
    const src =
      '---\nimport BaseLayout from "../layouts/BaseLayout.astro";\n---\n<BaseLayout>\n' +
      '<section style="padding: 40px 20px; background: #ff0000">\n' +
      "<blockquote>Direct quote<cite>Author</cite></blockquote>\n" +
      "</section>\n</BaseLayout>\n";
    const mainSec = svc.schema.parseSectionsFromSource(src)[0];
    const { inner } = editorSerialize.splitManagedPageSource(src);
    const editorSec = parser.parseSections(inner)[0];
    const mainOk =
      mainSec?.style?.padding === "40px 20px" &&
      mainSec?.style?.background === "#ff0000" &&
      mainSec?.children?.[0]?.props?.text === "Direct quote" &&
      mainSec?.children?.[0]?.props?.cite === "Author";
    const editorOk =
      editorSec?.style?.padding === "40px 20px" &&
      editorSec?.style?.background === "#ff0000" &&
      editorSec?.children?.[0]?.props?.text === "Direct quote" &&
      editorSec?.children?.[0]?.props?.cite === "Author";
    record(
      "blockquote without p and legacy section style parity",
      Boolean(mainOk && editorOk),
      `mainOk=${Boolean(mainOk)} editorOk=${Boolean(editorOk)}`,
    );
  }

  // 16. renameAsset preserves dotted version stems.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record("renameAsset preserves dotted version stems", false, e.message);
      ctx = null;
    }
    if (ctx) {
      const { tmp, project } = ctx;
      try {
        const assetsSvc = await import(
          pathToFileURL(
            path.join(ROOT, "dist", "main", "services", "assets.js"),
          ).href
        );
        const png1x1 = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        );
        const srcImg = path.join(tmp, "hero.png");
        fs.writeFileSync(srcImg, png1x1);
        const imported = assetsSvc.importAssetsFromPaths(project, "public", [
          srcImg,
        ]);
        const webPath = imported.imported?.[0]?.webPath;
        const renamed = assetsSvc.renameAsset(
          project,
          "public",
          webPath,
          "release-v1.2",
        );
        record(
          "renameAsset preserves dotted version stems",
          renamed.ok === true &&
            renamed.webPath === "/assets/images/release-v1.2.png",
          renamed.ok ? renamed.webPath : (renamed.error ?? "failed"),
        );
      } finally {
        rm(tmp);
      }
    }
  }

  // 16b. Asset filenames with URL delimiters keep their on-disk names while
  // web paths are segment-encoded; encoded traversal stays rejected.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record("asset URLs encode #, %, and spaces", false, e.message);
      ctx = null;
    }
    if (ctx) {
      const { tmp, project } = ctx;
      try {
        const assetsSvc = await import(
          pathToFileURL(
            path.join(ROOT, "dist", "main", "services", "assets.js"),
          ).href
        );
        const assetUsage = await import(
          pathToFileURL(
            path.join(ROOT, "dist", "main", "services", "assetUsage.js"),
          ).href
        );
        const reusable = await import(
          pathToFileURL(
            path.join(ROOT, "dist", "main", "services", "reusableSections.js"),
          ).href
        );
        const png1x1 = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        );
        const diskName = "hero #100%.png";
        const encoded = "/assets/images/hero%20%23100%25.png";
        const srcImg = path.join(tmp, diskName);
        fs.writeFileSync(srcImg, png1x1);
        const imported = assetsSvc.importAssetsFromPaths(project, "public", [
          srcImg,
        ]);
        const webPath = imported.imported?.[0]?.webPath;
        const legacySpelling = "/assets/images/hero #100%.png";
        const readLegacyDoc = svc.schema.readPageDocument(
          project,
          "index.astro",
          "src/pages",
        );
        const seededDoc = readLegacyDoc.pageDocument
          ? svc.schema.writePageDocument(project, "src/pages", {
              ...readLegacyDoc.pageDocument,
              socialImage: legacySpelling,
              sections: [
                {
                  id: "sec-legacy-alias",
                  type: "section",
                  label: `${encoded} Band`,
                  props: { wrapper: "none", cls: encoded },
                  style: { background: `url(${legacySpelling})` },
                  children: [
                    {
                      id: "h-legacy-alias",
                      type: "heading",
                      props: {
                        text: `See ${legacySpelling} and ${encoded}`,
                        level: "2",
                        cls: legacySpelling,
                      },
                    },
                    {
                      id: "img-legacy-alias",
                      type: "image",
                      props: {
                        src: legacySpelling,
                        alt: "Legacy",
                        cls: legacySpelling,
                      },
                      style: { background: `url(${legacySpelling})` },
                    },
                    {
                      id: "raw-legacy-alias",
                      type: "html",
                      props: {},
                      raw: `<img src="${legacySpelling}" alt="A" /><img src="${legacySpelling}" alt="B" />`,
                    },
                  ],
                },
              ],
            })
          : { ok: false };
        const seededReusable = reusable.saveReusableSection(
          project,
          "Legacy Alias Banner",
          `<img src="${legacySpelling}" alt="A" /><img src="${legacySpelling}" alt="B" />`,
        );
        const legacySite = svc.schema.readSiteDocument(project);
        const seededSite = legacySite.site
          ? svc.schema.writeSiteDocument(
              project,
              {
                ...legacySite.site,
                faviconPath: legacySpelling,
                shell: {
                  ...legacySite.site.shell,
                  footerHtml: `<img src="${legacySpelling}" alt="Footer" />`,
                  customHeadHtml: `<link rel="preload" href="${legacySpelling}" />`,
                },
              },
              "src/pages",
            )
          : { ok: false };
        const legacyUsage = assetUsage.findAssetUsage(
          project,
          "src/pages",
          encoded,
        );
        const legacyUsageCount = Number(legacyUsage.pages?.[0]?.count ?? 0);
        const legacyUsageOk =
          seededDoc.ok === true &&
          seededReusable.ok === true &&
          seededSite.ok === true &&
          legacyUsage.ok === true &&
          legacyUsage.pages?.length === 1 &&
          legacyUsageCount === 8 &&
          ["Site favicon", "Footer HTML", "Custom head HTML"].every((place) =>
            legacyUsage.siteReferences?.includes(place),
          ) &&
          legacyUsage.siteReferences?.some((place) =>
            place.includes("Legacy Alias Banner"),
          );
        const rawFile = path.join(
          project,
          "public",
          "assets",
          "images",
          diskName,
        );
        const hashedUrl = webPath
          ? new URL(webPath, "https://zephus.test/")
          : null;
        const listed = assetsSvc.listProjectAssets(project, "public");
        const listedEntry = listed.assets?.find(
          (a) => a.fileName === `images/${diskName}`,
        );
        const rawExists = fs.existsSync(rawFile);
        const read = webPath
          ? assetsSvc.readAssetDataUrl(project, "public", webPath)
          : { ok: false };
        const renamed = webPath
          ? assetsSvc.renameAsset(project, "public", webPath, "hero #2%")
          : { ok: false };
        const legacyRepoint = renamed.ok
          ? assetUsage.repointAssetReferences(
              project,
              "src/pages",
              webPath,
              renamed.webPath,
            )
          : { ok: false, updated: 0 };
        const renamedFile = path.join(
          project,
          "public",
          "assets",
          "images",
          "hero #2%.png",
        );
        const renamedUrl = renamed.webPath
          ? new URL(renamed.webPath, "https://zephus.test/")
          : null;
        const legacyRenamedRead = assetsSvc.readAssetDataUrl(
          project,
          "public",
          "/assets/images/hero #2%.png",
        );
        const literalPercentName = "legacy%20percent.png";
        const literalPercentSrc = path.join(tmp, literalPercentName);
        fs.writeFileSync(literalPercentSrc, png1x1);
        const literalImported = assetsSvc.importAssetsFromPaths(
          project,
          "public",
          [literalPercentSrc],
        );
        const literalEncoded = literalImported.imported?.[0]?.webPath;
        const literalDecodedName = path.join(
          project,
          "public",
          "assets",
          "images",
          "legacy percent.png",
        );
        const legacyLiteralRead = assetsSvc.readAssetDataUrl(
          project,
          "public",
          "/assets/images/legacy%20percent.png",
        );
        const encodedLiteralRead = assetsSvc.readAssetDataUrl(
          project,
          "public",
          literalEncoded,
        );
        const afterLegacyDoc = svc.schema.readPageDocument(
          project,
          "index.astro",
          "src/pages",
        ).pageDocument;
        const afterLegacySec = afterLegacyDoc?.sections?.[0];
        const [afterLegacyH, afterLegacyImg, afterLegacyRaw] =
          afterLegacySec?.children ?? [];
        const afterLegacySite = svc.schema.readSiteDocument(project).site;
        const afterLegacyReusable = reusable.listReusableSections(project);
        const newEncoded = renamed.webPath;
        const structuralLegacyIntact =
          afterLegacySec?.props?.cls === encoded &&
          afterLegacyH?.props?.cls === legacySpelling;
        const legacyContent = JSON.stringify({
          sectionProps: Object.fromEntries(
            Object.entries(afterLegacySec?.props ?? {}).filter(
              ([key]) => key !== "cls",
            ),
          ),
          sectionStyle: afterLegacySec?.style,
          blocks: (afterLegacySec?.children ?? []).map((block) => ({
            props: Object.fromEntries(
              Object.entries(block.props ?? {}).filter(
                ([key]) => key !== "cls",
              ),
            ),
            style: block.style,
            raw: block.raw,
          })),
          socialImage: afterLegacyDoc?.socialImage,
          favicon: afterLegacySite?.faviconPath,
          footer: afterLegacySite?.shell?.footerHtml,
          head: afterLegacySite?.shell?.customHeadHtml,
          reusable: afterLegacyReusable.sections?.map((s) => s.html),
        });
        const legacyContentClean =
          !legacyContent.includes(legacySpelling) &&
          !legacyContent.includes(encoded);
        const legacyAliasOk =
          legacyUsageOk &&
          legacyRepoint.ok === true &&
          legacyRepoint.updated === 13 &&
          structuralLegacyIntact &&
          afterLegacyH?.props?.text === `See ${newEncoded} and ${newEncoded}` &&
          afterLegacyImg?.props?.src === newEncoded &&
          afterLegacyImg?.style?.background === `url(${newEncoded})` &&
          afterLegacySec?.style?.background === `url(${newEncoded})` &&
          String(afterLegacyRaw?.raw ?? "").split(newEncoded).length - 1 ===
            2 &&
          afterLegacyDoc?.socialImage === newEncoded &&
          afterLegacySite?.faviconPath === newEncoded &&
          String(afterLegacySite?.shell?.footerHtml ?? "").includes(
            newEncoded,
          ) &&
          String(afterLegacySite?.shell?.customHeadHtml ?? "").includes(
            newEncoded,
          ) &&
          String(afterLegacyReusable.sections?.[0]?.html ?? "").includes(
            newEncoded,
          ) &&
          legacyContentClean;
        record(
          "asset legacy raw aliases find & repoint",
          legacyAliasOk,
          `usage=${legacyUsageCount} sites=${legacyUsage.siteReferences?.length} repointed=${legacyRepoint.updated} structural=${structuralLegacyIntact} clean=${legacyContentClean}`,
        );
        const roundTripOk =
          imported.ok === true &&
          webPath === encoded &&
          hashedUrl !== null &&
          hashedUrl.hash === "" &&
          hashedUrl.search === "" &&
          rawExists &&
          listedEntry?.webPath === encoded &&
          read.ok === true &&
          String(read.dataUrl).startsWith("data:image/png;base64,") &&
          renamed.ok === true &&
          renamed.webPath === "/assets/images/hero%20%232%25.png" &&
          fs.existsSync(renamedFile) &&
          renamedUrl !== null &&
          renamedUrl.hash === "" &&
          legacyRenamedRead.ok === true &&
          literalImported.ok === true &&
          literalEncoded === "/assets/images/legacy%2520percent.png" &&
          !fs.existsSync(literalDecodedName) &&
          legacyLiteralRead.ok === true &&
          encodedLiteralRead.ok === true;
        record(
          "asset URLs encode #, %, and spaces",
          roundTripOk,
          `webPath=${webPath} listed=${listedEntry?.webPath} renamed=${renamed.webPath} legacy=${legacyRenamedRead.ok} literal=${legacyLiteralRead.ok}/${literalEncoded}`,
        );

        const keep = path.join(project, "keep.png");
        fs.writeFileSync(keep, "outside public");
        const traversalWebPath = "/assets/images/%2e%2e/%2e%2e/%2e%2e/keep.png";
        const deleted = assetsSvc.deleteAsset(
          project,
          "public",
          traversalWebPath,
        );
        const readTraversal = assetsSvc.readAssetDataUrl(
          project,
          "public",
          traversalWebPath,
        );
        const encodedSlash = assetsSvc.renameAsset(
          project,
          "public",
          "/assets%2Fimages%2F%2e%2e%2F%2e%2e%2F%2e%2e%2Fkeep.png",
          "escaped",
        );
        const helperThrows = (value) => {
          try {
            assetsSvc.assetReferenceSpellings(value);
            return false;
          } catch {
            return true;
          }
        };
        const aliasTraversalThrew = helperThrows(traversalWebPath);
        const aliasSlashThrew = helperThrows(
          "/assets%2Fimages%2F%2e%2e%2F%2e%2e%2Fkeep.png",
        );
        record(
          "asset encoded traversal rejected",
          deleted.ok === false &&
            readTraversal.ok === false &&
            encodedSlash.ok === false &&
            aliasTraversalThrew &&
            aliasSlashThrew &&
            fs.existsSync(keep),
          `delete=${deleted.error ?? "allowed"} read=${readTraversal.error ?? "allowed"} rename=${encodedSlash.error ?? "allowed"} aliases=${aliasTraversalThrew}/${aliasSlashThrew}`,
        );
      } finally {
        rm(tmp);
      }
    }
  }

  // 17. editorIcons resolves kebab-case data-lucide names and engine registers all used icons.
  {
    const iconsSrc = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "editorIcons.ts"),
      "utf8",
    );
    const engineSrc = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "zephusEngine.ts"),
      "utf8",
    );
    const requiredKeys = [
      "ArrowDown",
      "ArrowUp",
      "Blocks",
      "BookOpen",
      "Copy",
      "CreditCard",
      "Edit3",
      "Ellipsis",
      "Files",
      "GripVertical",
      "Images",
      "Layers3",
      "LoaderCircle",
      "LockKeyhole",
      "Minus",
      "MoveVertical",
      "PanelTopOpen",
      "Pencil",
      "RemoveFormatting",
      "Rocket",
      "Search",
      "SlidersHorizontal",
      "Terminal",
      "Trash2",
      "Unlink",
      "Video",
    ];
    const hasPascalHelper =
      iconsSrc.includes("toPascalCase") && engineSrc.includes("Edit3");
    const missing = requiredKeys.filter((k) => !engineSrc.includes(k));
    record(
      "editorIcons resolves kebab-case data-lucide icons",
      hasPascalHelper && missing.length === 0,
      missing.length === 0
        ? `hasPascal=${hasPascalHelper}`
        : `missing: ${missing.join(", ")}`,
    );
  }

  // 18. splash.html & styles.css promote root chrome tokens and Studio dark palette.
  {
    const splashHtml = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "splash.html"),
      "utf8",
    );
    const stylesCss = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "styles.css"),
      "utf8",
    );
    const rootBlockMatch = stylesCss.match(/:root\s*\{[\s\S]*?\}/);
    const lightBlockMatch = stylesCss.match(
      /\[data-theme="light"\]\s*\{[\s\S]*?\}/,
    );
    const hasRootChrome =
      !!rootBlockMatch?.[0].includes("--chrome-0") &&
      !!rootBlockMatch?.[0].includes("--chrome-border") &&
      !!lightBlockMatch?.[0].includes("--chrome-0");
    const hasSplashStudio =
      splashHtml.includes("#090a0f") &&
      splashHtml.includes("zephus-mark") &&
      splashHtml.includes("#6366f1");
    record(
      "splash.html and styles.css root chrome tokens",
      hasRootChrome && hasSplashStudio,
      `rootChrome=${hasRootChrome} splashStudio=${hasSplashStudio}`,
    );
  }

  // 19. Text-safe palette tokens meet WCAG 2.1 AA (4.5:1) on every surface.
  {
    const stylesCss = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "styles.css"),
      "utf8",
    );
    const blockTokens = (blockRe) => {
      const block = stylesCss.match(blockRe)?.[0] ?? "";
      const tokens = {};
      const declRe = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;
      let decl;
      while ((decl = declRe.exec(block))) tokens[decl[1]] = decl[2].trim();
      return tokens;
    };
    const hexToRgb = (value) => {
      const m = /^#([0-9a-f]{6})$/i.exec(value ?? "");
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const luminance = (rgb) => {
      const channel = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return (
        0.2126 * channel(rgb[0]) +
        0.7152 * channel(rgb[1]) +
        0.0722 * channel(rgb[2])
      );
    };
    const contrast = (fg, bg) => {
      const a = luminance(fg);
      const b = luminance(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const themes = [
      ["dark", /:root\s*\{[\s\S]*?\}/],
      ["light", /\[data-theme="light"\]\s*\{[\s\S]*?\}/],
      [
        "system-light",
        /@media \(prefers-color-scheme: light\)\s*\{\s*\[data-theme="system"\]\s*\{[\s\S]*?\}/,
      ],
    ];
    const textTokens = [
      "accent-text",
      "accent-2-text",
      "danger-text",
      "warning-text",
    ];
    const surfaces = [
      "bg",
      "bg-app",
      "bg-alt",
      "panel",
      "panel-card",
      "chrome-0",
      "chrome-2",
      "chrome-3",
    ];
    const failures = [];
    let lowest = { ratio: Infinity, detail: "" };
    for (const [themeName, blockRe] of themes) {
      const tokens = blockTokens(blockRe);
      for (const token of textTokens) {
        const fg = hexToRgb(tokens[token]);
        if (!fg) {
          failures.push(`${themeName} --${token} missing`);
          continue;
        }
        for (const surface of surfaces) {
          const bg = hexToRgb(tokens[surface]);
          if (!bg) {
            failures.push(`${themeName} --${surface} missing`);
            continue;
          }
          const ratio = contrast(fg, bg);
          if (ratio < lowest.ratio) {
            lowest = {
              ratio,
              detail: `${themeName} --${token} on --${surface}`,
            };
          }
          if (ratio < 4.5) {
            failures.push(
              `${themeName} --${token} on --${surface} ${ratio.toFixed(2)}:1`,
            );
          }
        }
      }
    }
    record(
      "wcag text token contrast",
      failures.length === 0,
      failures.length === 0
        ? `min ${lowest.ratio.toFixed(2)}:1 (${lowest.detail})`
        : failures.slice(0, 4).join("; "),
    );
  }
}

/**
 * Every bundled starter theme must ship an accessible accent plus a managed
 * layout/CSS with keyboard-navigation safeguards. Uses the real theme/wizard/
 * schema services against temp sites, so this cannot pass by asserting on
 * product source strings alone.
 */
async function runStarterThemeA11yChecks(svc) {
  const hexToRgb = (value) => {
    const match = /^#([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
    if (!match) return null;
    const n = parseInt(match[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (rgb) =>
    0.2126 * channel(rgb[0]) +
    0.7152 * channel(rgb[1]) +
    0.0722 * channel(rgb[2]);
  const contrast = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const white = [255, 255, 255];
  const themeIds = svc.themes.listThemes().map((t) => t.id);
  const accentFailures = [];
  const outputFailures = [];
  let checked = 0;
  let lowest = { ratio: Infinity, detail: "" };

  for (const themeId of themeIds) {
    let tmp = null;
    try {
      const ctx = mkSite(svc, themeId);
      tmp = ctx.tmp;
      const { project } = ctx;

      // Stored design tokens come back through the schema service.
      const siteRead = svc.schema.readSiteDocument(project);
      if (!siteRead.ok || !siteRead.site) {
        accentFailures.push(
          `${themeId}: site.json unreadable (${siteRead.error ?? "no site"})`,
        );
      } else {
        checked += 1;
        const accent = siteRead.site.design.accent;
        const background = siteRead.site.design.background;
        const accentRgb = hexToRgb(accent);
        const backgroundRgb = hexToRgb(background);
        if (!accentRgb || !backgroundRgb) {
          accentFailures.push(
            `${themeId}: unparseable accent=${JSON.stringify(accent)} background=${JSON.stringify(background)}`,
          );
        } else {
          // White is always checked; the stored background is only a second
          // surface when it actually differs from white.
          const surfaces = [["#ffffff", white]];
          if (backgroundRgb.some((v, i) => v !== white[i])) {
            surfaces.push([background, backgroundRgb]);
          }
          for (const [label, bg] of surfaces) {
            const ratio = contrast(accentRgb, bg);
            if (ratio < lowest.ratio) {
              lowest = { ratio, detail: `${themeId} ${accent} on ${label}` };
            }
            if (ratio < 4.5) {
              accentFailures.push(
                `${themeId} ${accent} on ${label} ${ratio.toFixed(2)}:1`,
              );
            }
          }
        }
      }

      const layoutPath = path.join(
        project,
        "src",
        "layouts",
        "BaseLayout.astro",
      );
      const layout = fs.existsSync(layoutPath)
        ? fs.readFileSync(layoutPath, "utf8")
        : "";
      const skipTag =
        layout.match(
          /<a\b[^>]*\bclass="[^"]*\bzephus-skip-link\b[^"]*"[^>]*>/i,
        )?.[0] ?? "";
      const skipHref = skipTag.match(/\bhref="#([^"]+)"/i)?.[1] ?? "";
      const mainId = layout.match(/<main\b[^>]*\bid="([^"]+)"/i)?.[1] ?? "";
      const navTag =
        layout.match(
          /<nav\b[^>]*\bclass="[^"]*\bzephus-shell-nav\b[^"]*"[^>]*>/i,
        )?.[0] ?? "";
      const navName = navTag.match(/\baria-label="([^"]+)"/i)?.[1] ?? "";

      if (!skipTag) outputFailures.push(`${themeId}: no .zephus-skip-link`);
      if (!skipHref)
        outputFailures.push(`${themeId}: skip link has no #target`);
      if (!mainId) outputFailures.push(`${themeId}: <main> has no id target`);
      if (skipHref && mainId && skipHref !== mainId) {
        outputFailures.push(
          `${themeId}: skip #${skipHref} does not match main #${mainId}`,
        );
      }
      if (!navName.trim()) {
        outputFailures.push(`${themeId}: primary nav has no aria-label`);
      }

      const cssFiles = [
        ["global.css", path.join(project, "public", "styles", "global.css")],
        [
          "zephus-managed.css",
          path.join(project, "public", "styles", "zephus-managed.css"),
        ],
      ];
      for (const [name, file] of cssFiles) {
        const css = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
        if (!/\.zephus-skip-link\b/.test(css)) {
          outputFailures.push(`${themeId}: ${name} lacks skip-link styles`);
        }
        if (!/:focus-visible\b/.test(css)) {
          outputFailures.push(`${themeId}: ${name} lacks :focus-visible`);
        }
        if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)/i.test(css)) {
          outputFailures.push(`${themeId}: ${name} lacks reduced-motion media`);
        }
        const reduced =
          css.match(
            /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\}/i,
          )?.[0] ?? "";
        if (!/scroll-behavior\s*:\s*auto/i.test(reduced)) {
          outputFailures.push(
            `${themeId}: ${name} reduced-motion does not disable smooth scrolling`,
          );
        }
        const hover = css.match(/\.button:hover\s*\{[^}]*\}/i)?.[0] ?? "";
        if (!hover) {
          outputFailures.push(`${themeId}: ${name} lacks .button:hover`);
        } else {
          if (/\bopacity\s*:/.test(hover)) {
            outputFailures.push(
              `${themeId}: ${name} .button:hover uses opacity`,
            );
          }
          if (!/\bbackground\s*:/.test(hover)) {
            outputFailures.push(
              `${themeId}: ${name} .button:hover lacks darker background`,
            );
          }
        }
        if (
          !/\.button\.secondary:hover\s*\{[^}]*background\s*:\s*transparent/i.test(
            css,
          )
        ) {
          outputFailures.push(
            `${themeId}: ${name} secondary hover is not contrast-preserving`,
          );
        }
      }
    } catch (e) {
      const message = e && e.message ? e.message : String(e);
      accentFailures.push(`${themeId}: ${message}`);
      outputFailures.push(`${themeId}: ${message}`);
    } finally {
      if (tmp) rm(tmp);
    }
  }

  const summarize = (failures) =>
    `${failures.length} issue(s): ${failures.slice(0, 8).join("; ")}${
      failures.length > 8 ? " …" : ""
    }`;
  record(
    "starter theme accents >= 4.5:1 on white and stored background",
    accentFailures.length === 0 && checked === themeIds.length,
    accentFailures.length === 0 && checked === themeIds.length
      ? `${themeIds.length} themes, min ${lowest.ratio.toFixed(2)}:1 (${lowest.detail})`
      : summarize(accentFailures),
  );
  record(
    "managed starter output keyboard/reduced-motion safeguards",
    outputFailures.length === 0,
    outputFailures.length === 0
      ? `${themeIds.length} themes checked`
      : summarize(outputFailures),
  );
}

async function main() {
  ensureDraftsUserDataDir();
  const dist = (p) =>
    import(pathToFileURL(path.join(ROOT, "dist", "main", p)).href);
  const svc = {
    wizard: await dist("services/wizard.js"),
    schema: await dist("services/schema.js"),
    pageManager: await dist("services/pageManager.js"),
    drafts: await dist("services/drafts.js"),
    findReplace: await dist("services/findReplace.js"),
    themes: await dist("themes.js"),
  };
  const blockRender = await import(
    pathToFileURL(path.join(ROOT, "dist", "shared", "blockRender.js")).href
  );
  const allThemes = svc.themes.listThemes().map((t) => t.id);
  const themes = process.argv[2] === "--themes=all" ? allThemes : SMOKE_THEMES;
  console.log(`E2E failure suite: ${themes.join(", ")}`);

  for (const themeId of themes) {
    console.log(`\n[theme ${themeId}]`);
    let ctx;
    try {
      ctx = mkSite(svc, themeId);
    } catch (e) {
      record(`scaffold ${themeId}`, false, e.message);
      continue;
    }
    const { tmp, project, pagesDir } = ctx;
    const pagesRel = "src/pages";
    try {
      const page = firstPage(pagesDir);

      // Corrupt sidecar must not throw.
      if (page) {
        const slug = page.replace(/\.astro$/, "");
        const sidecar = path.join(project, ".zephus", "pages", `${slug}.json`);
        if (fs.existsSync(sidecar)) {
          const orig = fs.readFileSync(sidecar, "utf8");
          fs.writeFileSync(sidecar, JSON.stringify({ slug: "x" }), "utf8");
          let threw = false;
          try {
            svc.schema.readPageDocument(project, page, pagesRel);
          } catch (e) {
            threw = true;
            record("corrupt sidecar handled", false, `threw: ${e.message}`);
          }
          if (!threw) record("corrupt sidecar handled", true);
          fs.writeFileSync(sidecar, orig, "utf8");
        } else {
          record("corrupt sidecar handled", true, "no sidecar");
        }
      }

      // Coerce non-string site fields.
      const siteFile = path.join(project, ".zephus", "site.json");
      if (fs.existsSync(siteFile)) {
        const orig = fs.readFileSync(siteFile, "utf8");
        try {
          const site = JSON.parse(orig);
          site.siteName = 42;
          if (site.shell) site.shell.navItems = "oops";
          fs.writeFileSync(siteFile, JSON.stringify(site), "utf8");
          const reread = svc.schema.readSiteDocument(project);
          record(
            "non-string site fields coerced",
            !!reread && reread.ok !== false,
            JSON.stringify(reread && reread.error),
          );
        } catch (e) {
          record("non-string site fields coerced", false, e.message);
        }
        fs.writeFileSync(siteFile, orig, "utf8");
      }

      // Traversal rejected.
      let travRejected = false;
      try {
        const ren = svc.pageManager.renamePage(
          project,
          "../../package.json",
          pagesRel,
          "evil",
        );
        travRejected = !ren || ren.ok === false;
      } catch {
        travRejected = true;
      }
      record("traversal rejected", travRejected);

      // Non-page files refused.
      const secret = path.join(project, ".env");
      fs.writeFileSync(secret, "SECRET=1", "utf8");
      const delSecret = svc.pageManager.deletePage(project, ".env", pagesRel);
      record(
        "delete refuses .env",
        (!delSecret || delSecret.ok === false) && fs.existsSync(secret),
        delSecret && delSecret.ok ? "delete allowed" : "ok",
      );
      fs.rmSync(secret, { force: true });

      const renameMissing = svc.pageManager.renamePage(
        project,
        "no-such-page-xyz.astro",
        pagesRel,
        "renamed-xyz.astro",
      );
      record(
        "rename missing page fails clean",
        !renameMissing || renameMissing.ok === false,
      );
      record(
        "no stray file after failed rename",
        !fs.existsSync(path.join(pagesDir, "renamed-xyz.astro")),
      );

      // Zero-edit save is byte-identical.
      if (page) {
        const pageFile = path.join(pagesDir, page);
        const doc = svc.schema.readPageDocument(project, page, pagesRel);
        if (doc && doc.ok !== false && doc.pageDocument) {
          const beforeBytes = fs.readFileSync(pageFile);
          const payload = doc.pageDocument;
          svc.schema.writePageDocument(project, pagesRel, payload);
          svc.schema.writePageDocument(project, pagesRel, payload);
          const afterBytes = fs.readFileSync(pageFile);
          record(
            "zero-edit save byte-identical",
            Buffer.compare(beforeBytes, afterBytes) === 0,
            Buffer.compare(beforeBytes, afterBytes) === 0
              ? "ok"
              : `before=${beforeBytes.length} after=${afterBytes.length}`,
          );
        } else {
          record("zero-edit save byte-identical", false, "unmanaged page");
        }
      }

      // Find/replace must run while the page is still managed (before detach).
      try {
        const probe = "ZEPHUS_FIND_PROBE_XYZ";
        const replaceWith = "ZEPHUS_FIND_REPLACED_ABC";
        if (page) {
          const doc = svc.schema.readPageDocument(project, page, pagesRel);
          if (doc.ok && doc.pageDocument) {
            const sec = doc.pageDocument.sections[0];
            const blk = sec?.children[0];
            if (blk) {
              const key =
                blk.type === "heading"
                  ? "text"
                  : typeof blk.props.text === "string"
                    ? "text"
                    : "title";
              blk.props[key] = `Prefix ${probe} suffix`;
            }
            svc.schema.writePageDocument(project, pagesRel, doc.pageDocument);
          }
        }
        const hits = svc.findReplace.searchPages(project, pagesRel, probe);
        const rep = svc.findReplace.replaceAllInPages(
          project,
          pagesRel,
          probe,
          replaceWith,
        );
        const afterDoc = page
          ? svc.schema.readPageDocument(project, page, pagesRel)
          : null;
        let found = false;
        if (afterDoc?.ok && afterDoc.pageDocument) {
          const walk = (nodes) => {
            for (const n of nodes) {
              const val = Object.values(n.props ?? {}).find(
                (v) => typeof v === "string" && v.includes(replaceWith),
              );
              if (val) found = true;
              if (n.children) walk(n.children);
            }
          };
          walk(afterDoc.pageDocument.sections);
        }
        record(
          "find/replace mutates searchable text",
          !!hits && hits.ok && !!rep && rep.ok && rep.replaced > 0 && found,
          `replaced=${rep && rep.replaced}`,
        );
      } catch (e) {
        record("find/replace mutates searchable text", false, e.message);
      }

      // Hand-authored bytes survive metadata write (detached page).
      if (page) {
        const marker = "ZEPHUS_HAND_AUTHORED_BYTES";
        const handSource = `---\nimport BaseLayout from "../../layouts/BaseLayout.astro";\n---\n<p>${marker}</p>\n`;
        const detached = svc.schema.detachPageDocument(
          project,
          page,
          pagesRel,
          handSource,
        );
        if (!detached.ok) {
          record(
            "hand-authored bytes preserved on metadata write",
            false,
            detached.error ?? "detach failed",
          );
        } else {
          const before = fs.readFileSync(path.join(pagesDir, page), "utf8");
          svc.pageManager.writePageMetadata(project, page, pagesRel, {
            title: "E2E Title Probe",
          });
          const after = fs.readFileSync(path.join(pagesDir, page), "utf8");
          record(
            "hand-authored bytes preserved on metadata write",
            before === after && before.includes(marker),
            before === after ? "ok" : "bytes changed",
          );
        }
      }

      // Draft round-trip with exact content.
      const dw = svc.drafts.writeDraft(project, "page", "e2e-page", "hello");
      const rd = svc.drafts.readDraft(project, "page", "e2e-page");
      const cl = svc.drafts.clearDraft(project, "page", "e2e-page");
      const rd2 = svc.drafts.readDraft(project, "page", "e2e-page");
      record("draft write", dw.ok === true, dw.error ?? "");
      record(
        "draft read returns hello",
        rd.ok && rd.draft && rd.draft.content === "hello",
        rd.draft ? rd.draft.content : (rd.error ?? "no draft"),
      );
      record("draft clear", cl.ok === true, cl.error ?? "");
      record(
        "draft cleared content",
        !rd2.ok || !rd2.draft || rd2.draft.content !== "hello",
        rd2.draft ? rd2.draft.content : "empty",
      );

      try {
        const ensured2 = svc.schema.ensureVisualSchema(project, pagesRel);
        record("re-ensure after mutation", !!ensured2 && ensured2.ok !== false);
      } catch (e) {
        record("re-ensure after mutation", false, e.message);
      }
    } finally {
      copyE2eProof(project, themeId);
      rm(tmp);
    }
  }

  console.log("\n[product regression checks]");
  await runProductChecks(svc, blockRender);

  console.log("\n[fresh quality pass checks]");
  await runFreshQualityPassChecks(svc, blockRender);

  console.log("\n[starter theme accessibility checks]");
  await runStarterThemeA11yChecks(svc);

  console.log("\n[web engine & parity audit checks]");
  await runWebEngineAndUiAuditChecks(svc, blockRender);

  console.log("\n[astro rebuild on mutated sites]");
  const ASTRO_ENTRY = path.join(
    ROOT,
    "node_modules",
    "astro",
    "bin",
    "astro.mjs",
  );
  const wizard = svc.wizard;
  const schema = svc.schema;
  for (const themeId of BUILD_THEMES) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `zephus-e2e-build-`));
    const project = path.join(tmp, "site");
    fs.mkdirSync(project, { recursive: true });
    try {
      const created = wizard.createSite(project, themeId);
      if (!created.ok) throw new Error(created.error);
      try {
        fs.symlinkSync(
          path.join(ROOT, "node_modules"),
          path.join(project, "node_modules"),
          "dir",
        );
      } catch {
        /* already linked */
      }
      const ensured = schema.ensureVisualSchema(project, "src/pages");
      if (!ensured.ok) throw new Error(ensured.error ?? "ensure failed");
      const made = schema.createSchemaPage(project, "src/pages", "e2e-probe");
      if (!made || made.ok === false)
        throw new Error("create probe page failed");
      execFileSync(process.execPath, [ASTRO_ENTRY, "build", "--silent"], {
        cwd: project,
        encoding: "utf8",
        timeout: 300000,
        env: { ...process.env, NO_COLOR: "1" },
        stdio: "pipe",
      });
      const html = [];
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name);
          if (e.isDirectory()) walk(f);
          else if (e.name.endsWith(".html")) html.push(f);
        }
      };
      walk(path.join(project, "dist"));
      record(`${themeId} mutated build emits HTML`, html.length > 0);
    } catch (e) {
      record(`${themeId} mutated build`, false, e.message.slice(0, 300));
    } finally {
      rm(tmp);
    }
  }

  writeArtifactAndExit();
}

main().catch((e) => {
  console.error(`E2E harness crashed: ${e && e.stack ? e.stack : e}`);
  try {
    const sha = repoSha();
    fs.mkdirSync(path.join(ROOT, "artifacts", "e2e"), { recursive: true });
    fs.writeFileSync(
      path.join(ROOT, "artifacts", "e2e", `${sha}.json`),
      `${JSON.stringify(
        {
          sha,
          passed,
          failed: failed + 1,
          checks: [
            ...checks,
            { name: "harness crash", ok: false, detail: String(e) },
          ],
        },
        null,
        2,
      )}\n`,
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});
