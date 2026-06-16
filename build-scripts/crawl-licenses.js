'use strict';

const fs = require('fs');
const path = require('path');
const checker = require('license-checker-rseidelsohn');

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'licenses.json');

function main() {
  const args = {
    start: ROOT,
    production: true,
    excludePrivatePackages: true,
  };

  checker.init(args, (error, packages) => {
    if (error) {
      console.error('✗ License crawl failed:', error.message || error);
      process.exit(1);
    }
    const normalized = {};
    for (const [packageId, data] of Object.entries(packages || {})) {
      normalized[packageId] = {
        licenses: data.licenses || 'Unknown',
        repository: data.repository || '',
        licenseUrl: data.licenseUrl || data.licenseFile || '',
        parents: Array.isArray(data.parents) ? data.parents.join(', ') : data.parents || 'zephus',
      };
    }
    fs.writeFileSync(OUTPUT, JSON.stringify(normalized, null, 2) + '\n');
    console.log('✓ licenses.json generated');
  });
}

main();
