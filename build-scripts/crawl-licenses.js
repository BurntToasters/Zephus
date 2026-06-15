'use strict';

const fs = require('fs');
const path = require('path');
const { dumpLicenses } = require('npm-license-crawler');

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'licenses.json');

// Directories we never want crawled (each may or may not exist locally).
const CANDIDATE_EXCLUDES = ['.site_examples', 'template-previews'];

function resolveExisting(relPaths) {
  const resolved = [];
  for (const rel of relPaths) {
    const abs = path.resolve(ROOT, rel);
    try {
      if (fs.statSync(abs).isDirectory()) {
        resolved.push(abs);
      } else {
        console.log(`   licenses: skipping exclude (not a directory): ${rel}`);
      }
    } catch {
      console.log(`   licenses: skipping exclude (absent): ${rel}`);
    }
  }
  return resolved;
}

function main() {
  const args = {
    start: [ROOT],
    exclude: resolveExisting(CANDIDATE_EXCLUDES),
    production: true,
    dependencies: true,
    json: OUTPUT,
  };

  dumpLicenses(args, (error) => {
    if (error) {
      console.error('✗ License crawl failed:', error.message || error);
      process.exit(1);
    }
    console.log('✓ licenses.json generated');
  });
}

main();
