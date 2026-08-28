"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const checker = require("license-checker-rseidelsohn");

const ROOT = path.join(__dirname, "..");
const OUTPUT = path.join(ROOT, "licenses.json");
// Written by bundle-renderer.js: the esbuild metafile for the shipped renderer.
const RENDERER_META = path.join(os.tmpdir(), "zephus-renderer-meta.json");

function crawl(opts) {
  return new Promise((resolve, reject) => {
    checker.init(
      { start: ROOT, excludePrivatePackages: true, ...opts },
      (error, packages) => (error ? reject(error) : resolve(packages || {})),
    );
  });
}

/** Strips the trailing @version from a license-checker key (handles @scoped names). */
function packageNameOf(key) {
  const at = key.lastIndexOf("@");
  return at > 0 ? key.slice(0, at) : key;
}

/** Reads the esbuild metafile and returns the set of node_modules package names that were inlined into the shipped… */
function bundledRendererPackages() {
  if (!fs.existsSync(RENDERER_META)) {
    // A stale/missing metafile silently dropped every bundled-renderer
    // attribution (fresh CI container, cleared tmp). During a RELEASE run
    // that is a licensing failure, not a warning — but `npm run u` (update +
    // test) must not fail because a build artifact is missing.
    if (
      process.env.CRAWL_LICENSES_STRICT === "1" &&
      process.env.RELEASE_PIPELINE === "1"
    ) {
      console.error(
        "✗ FATAL: renderer esbuild metafile missing (" +
          RENDERER_META +
          "). " +
          "Run compile:renderer first.",
      );
      process.exit(1);
    }
    return new Set();
  }
  try {
    const meta = JSON.parse(fs.readFileSync(RENDERER_META, "utf8"));
    const names = new Set();
    for (const input of Object.keys(meta.inputs || {})) {
      const marker = input.lastIndexOf("node_modules/");
      if (marker < 0) continue;
      const rest = input.slice(marker + "node_modules/".length).split("/");
      const name = rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
      if (name) names.add(name);
    }
    return names;
  } catch (error) {
    console.warn("⚠ Could not read renderer metafile:", error.message || error);
    return new Set();
  }
}

function normalizeEntry(data, fallbackParents) {
  // licenseFile is an absolute dev-machine path (e.g.
  // /Users/dev/.../node_modules/x/LICENSE) — meaningless in the packaged app;
  // prefer a real URL and drop the raw path entirely.
  const url = data.licenseUrl || data.licenseFile || "";
  let licenseUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : "";
  // license-checker rarely emits licenseUrl; derive a real source link from
  // the repository field instead of leaving rows with no link at all.
  if (!licenseUrl && typeof data.repository === "string" && data.repository) {
    const repo = data.repository.trim();
    const https = repo.startsWith("git+") ? repo.slice(4) : repo;
    if (/^https?:\/\//i.test(https)) licenseUrl = https.replace(/\.git$/i, "");
  }
  return {
    licenses: data.licenses || "Unknown",
    repository: data.repository || "",
    licenseUrl,
    parents: Array.isArray(data.parents)
      ? data.parents.join(", ")
      : data.parents || fallbackParents,
  };
}

async function main() {
  // Runtime dependencies that ship in the packaged app's node_modules.
  const production = await crawl({ production: true });
  const normalized = {};
  for (const [packageId, data] of Object.entries(production)) {
    normalized[packageId] = normalizeEntry(data, "zephus");
  }

  // Add devDependencies that esbuild inlines into the shipped renderer bundle.
  const bundled = bundledRendererPackages();
  if (bundled.size > 0) {
    const all = await crawl({ production: false });
    for (const [packageId, data] of Object.entries(all)) {
      if (normalized[packageId]) continue;
      if (!bundled.has(packageNameOf(packageId))) continue;
      normalized[packageId] = normalizeEntry(
        data,
        "zephus (bundled in renderer)",
      );
    }
  } else {
    console.warn(
      "⚠ Renderer metafile not found; bundled renderer packages were not attributed. " +
        "Run after compile:renderer.",
    );
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(normalized, null, 2) + "\n");
  console.log(
    `✓ licenses.json generated (${Object.keys(normalized).length} packages, ` +
      `${bundled.size} bundled into the renderer)`,
  );
}

main().catch((error) => {
  console.error("✗ License crawl failed:", error.message || error);
  process.exit(1);
});
