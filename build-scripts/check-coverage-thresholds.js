const fs = require('fs');
const path = require('path');

const summaryPath = path.join(process.cwd(), 'coverage', 'coverage-summary.json');

if (!fs.existsSync(summaryPath)) {
  console.error(`Coverage summary file not found: ${summaryPath}`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

const thresholds = {
  'src/main/updater.ts': { lines: 45, statements: 45 },
  'src/main/services/assets.ts': { lines: 80, statements: 80 },
  'src/main/services/files.ts': { lines: 90, statements: 90 },
  'src/main/services/schema.ts': { lines: 75, statements: 70 },
  'src/main/services/updateChannel.ts': { lines: 95, statements: 95 },
};

function findCoverageEntry(suffix) {
  const normalizedSuffix = suffix.replace(/\\/g, '/');
  return Object.entries(summary).find(([key]) =>
    key.replace(/\\/g, '/').endsWith(normalizedSuffix)
  );
}

const failures = [];

for (const [file, threshold] of Object.entries(thresholds)) {
  const match = findCoverageEntry(file);
  if (!match) {
    failures.push(`${file}: missing from coverage summary`);
    continue;
  }

  const [, metrics] = match;
  if (metrics.lines.pct < threshold.lines) {
    failures.push(`${file}: lines ${metrics.lines.pct}% < ${threshold.lines}%`);
  }
  if (metrics.statements.pct < threshold.statements) {
    failures.push(`${file}: statements ${metrics.statements.pct}% < ${threshold.statements}%`);
  }
}

if (failures.length > 0) {
  console.error('Coverage thresholds failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Coverage thresholds passed.');
