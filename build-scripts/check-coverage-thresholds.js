const fs = require('fs');
const path = require('path');

const summaryPath = path.join(process.cwd(), 'coverage', 'coverage-summary.json');

if (!fs.existsSync(summaryPath)) {
  console.error(`Coverage summary file not found: ${summaryPath}`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

// Lines/statements thresholds per file. Values sit ~5 points below the
// measured baseline so the gate is regression-proof without being flaky.
const thresholds = {
  // UI glue extracted from the engine: covered by the runtime smoke suite
  // (full app boot) rather than unit tests.
  'src/renderer/editorStartView.ts': { lines: 45, statements: 45 },
  'src/main/updater.ts': { lines: 75, statements: 75 },
  'src/main/services/assets.ts': { lines: 92, statements: 92 },
  'src/main/services/files.ts': { lines: 95, statements: 95 },
  'src/main/services/schema.ts': { lines: 78, statements: 75 },
  'src/main/services/updateChannel.ts': { lines: 95, statements: 95 },
  'src/main/services/git.ts': { lines: 75, statements: 75 },
  'src/main/services/nodeCheck.ts': { lines: 78, statements: 75 },
  'src/main/services/devServer.ts': { lines: 72, statements: 70 },
  'src/main/services/findReplace.ts': { lines: 88, statements: 82 },
  'src/main/services/drafts.ts': { lines: 78, statements: 75 },
  'src/main/services/settings.ts': { lines: 80, statements: 78 },
  'src/main/services/licenses.ts': { lines: 80, statements: 72 },
  'src/main/services/themePreviewServer.ts': { lines: 82, statements: 78 },
  'src/main/services/pageManager.ts': { lines: 62, statements: 60 },
  'src/main/services/wizard.ts': { lines: 58, statements: 56 },
  'src/main/services/reusableSections.ts': { lines: 82, statements: 80 },
  'src/main/services/assetUsage.ts': { lines: 78, statements: 75 },
  'src/shared/blockRender.ts': { lines: 90, statements: 88 },
  'src/shared/renderHelpers.ts': { lines: 88, statements: 85 },
  'src/renderer/editorCommands.ts': { lines: 95, statements: 95 },
  'src/renderer/editorDraft.ts': { lines: 90, statements: 85 },
  'src/renderer/editorDraftRestore.ts': { lines: 82, statements: 78 },
  'src/renderer/editorGit.ts': { lines: 90, statements: 90 },
  'src/renderer/editorInlineEdit.ts': { lines: 68, statements: 66 },
  'src/renderer/editorParse.ts': { lines: 80, statements: 78 },
  'src/renderer/editorResize.ts': { lines: 95, statements: 88 },
  'src/renderer/editorSave.ts': { lines: 78, statements: 76 },
  'src/renderer/editorSerialize.ts': { lines: 90, statements: 90 },
  'src/renderer/editorSession.ts': { lines: 85, statements: 80 },
  'src/renderer/editorSiteSave.ts': { lines: 75, statements: 72 },
  'src/renderer/editorUndo.ts': { lines: 95, statements: 95 },
  'src/renderer/inlineRichText.ts': { lines: 90, statements: 90 },
  'src/renderer/editorBlockRender.ts': { lines: 72, statements: 70 },
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

// Overall guard: brand-new or renamed src files must not ship with 0% — the
// whitelist above only gates known files, so a new file would pass silently.
const totals = summary.total;
if (totals) {
  const statements = totals.statements?.pct;
  const lines = totals.lines?.pct;
  // The overall floor tracks the engine's decomposition: extracted UI modules
  // are exercised by the runtime smoke suite (full app boot), so their lines
  // are counted against per-file floors rather than the unit-only overall.
  if (typeof statements === 'number' && statements < 90) {
    console.error(
      `Coverage thresholds failed: overall statements ${statements}% < 90%`,
    );
    process.exit(1);
  }
  if (typeof lines === 'number' && lines < 91) {
    console.error(`Coverage thresholds failed: overall lines ${lines}% < 91%`);
    process.exit(1);
  }
} else {
  console.error('Coverage summary has no "total" entry; cannot verify overall coverage.');
  process.exit(1);
}

console.log('Coverage thresholds passed.');
