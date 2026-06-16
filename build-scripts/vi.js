#!/usr/bin/env node
const { spawnSync, execSync } = require('child_process');

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    console.error(`Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(res.status || 1);
  }
}

const force = process.argv.includes('--force') || process.argv.includes('--yes');

try {
  run('git', ['fetch', 'origin']);

  // `git reset --hard` + `git clean -fd` are irreversible. Refuse to run them
  // against a dirty working tree unless the caller explicitly opts in.
  if (!force) {
    const dirty = execSync('git status --porcelain', {
      encoding: 'utf8',
    }).trim();
    if (dirty) {
      console.error(
        '\nWorking tree has uncommitted or untracked changes:\n' + dirty,
      );
      console.error(
        '\nRefusing to run a destructive reset/clean. Commit or stash your work,',
      );
      console.error('or re-run with --force to discard everything.');
      process.exit(1);
    }
  }

  run('git', ['reset', '--hard', '@{u}']);
  run('git', ['clean', '-fd']);
  run('git', ['pull']);
  run('npm', ['ci']);

  const branch = execSync('git rev-parse --abbrev-ref HEAD', {
    encoding: 'utf8',
  }).trim();
  const green = '\x1b[32m';
  const reset = '\x1b[0m';
  console.log(`\n${green}VM Setup Complete. You are on Branch ${branch}.${reset}\n`);
} catch (err) {
  console.error('vi script failed:', err);
  process.exit(1);
}
