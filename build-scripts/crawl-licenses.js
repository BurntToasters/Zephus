'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const checker = require('license-checker-rseidelsohn');

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'licenses.json');
// Written by bundle-renderer.js: the esbuild metafile for the shipped renderer.
const RENDERER_META = path.join(os.tmpdir(), 'zephus-renderer-meta.json');

function crawl(opts) {
  return new Promise((resolve, reject) => {
    checker.init({ start: ROOT, excludePrivatePackages: true, ...opts }, (error, packages) =>
      error ? reject(error) : resolve(packages || {})
    );
  });
}

/** Strips the trailing @version from a license-checker key (handles @scoped names). */
function packageNameOf(key) {
  const at = key.lastIndexOf('@');
  return at > 0 ? key.slice(0, at) : key;
}

/**
 * Reads the esbuild metafile and returns the set of node_modules package names
 * that were inlined into the shipped renderer bundle. These ship inside
 * zephusEngine.js (CodeMirror, lezer, etc.) and must be attributed even though
 * they are devDependencies.
 */
function bundledRendererPackages() {
  if (!fs.existsSync(RENDERER_META)) return new Set();
  try {
    const meta = JSON.parse(fs.readFileSync(RENDERER_META, 'utf8'));
    const names = new Set();
    for (const input of Object.keys(meta.inputs || {})) {
      const marker = input.lastIndexOf('node_modules/');
      if (marker < 0) continue;
      const rest = input.slice(marker + 'node_modules/'.length).split('/');
      const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
      if (name) names.add(name);
    }
    return names;
  } catch (error) {
    console.warn('⚠ Could not read renderer metafile:', error.message || error);
    return new Set();
  }
}

function normalizeEntry(data, fallbackParents) {
  return {
    licenses: data.licenses || 'Unknown',
    repository: data.repository || '',
    licenseUrl: data.licenseUrl || data.licenseFile || '',
    parents: Array.isArray(data.parents)
      ? data.parents.join(', ')
      : data.parents || fallbackParents,
  };
}

async function main() {
  // Runtime dependencies that ship in the packaged app's node_modules.
  const production = await crawl({ production: true });
  const normalized = {};
  for (const [packageId, data] of Object.entries(production)) {
    normalized[packageId] = normalizeEntry(data, 'zephus');
  }

  // Add devDependencies that esbuild inlines into the shipped renderer bundle.
  const bundled = bundledRendererPackages();
  if (bundled.size > 0) {
    const all = await crawl({ production: false });
    for (const [packageId, data] of Object.entries(all)) {
      if (normalized[packageId]) continue;
      if (!bundled.has(packageNameOf(packageId))) continue;
      normalized[packageId] = normalizeEntry(data, 'zephus (bundled in renderer)');
    }
  } else {
    console.warn(
      '⚠ Renderer metafile not found; bundled renderer packages were not attributed. ' +
        'Run after compile:renderer.'
    );
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(normalized, null, 2) + '\n');
  console.log(
    `✓ licenses.json generated (${Object.keys(normalized).length} packages, ` +
      `${bundled.size} bundled into the renderer)`
  );
}

main().catch((error) => {
  console.error('✗ License crawl failed:', error.message || error);
  process.exit(1);
});
