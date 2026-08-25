const fs = require('fs');
const path = require('path');

require('dotenv').config();

const RELEASE_DIR = path.join(__dirname, '..', 'release');

const BUILD_ONLY_DIRECTORIES = [
  'mac-universal',
  'win-unpacked',
  'win-arm64-unpacked',
  'linux-unpacked',
  'linux-arm64-unpacked',
];

const BUILD_ONLY_FILES = ['builder-debug.yml', 'builder-effective-config.yaml'];

function removePath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}

function cleanReleaseArtifacts(releaseDir = RELEASE_DIR) {
  for (const dir of BUILD_ONLY_DIRECTORIES) {
    removePath(path.join(releaseDir, dir));
  }

  for (const file of BUILD_ONLY_FILES) {
    removePath(path.join(releaseDir, file));
  }
}

function getAfterPackLocation(env = process.env) {
  const value = env.AFTER_PACK_LOC;
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function isBetaReleaseVersion(version) {
  const numeric = '(?:0|[1-9]\\d*)';
  return new RegExp(`^${numeric}\\.${numeric}\\.${numeric}-beta\\.${numeric}$`).test(
    String(version ?? '')
  );
}

function readPackageVersion(repositoryRoot = path.join(__dirname, '..')) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  return typeof packageJson.version === 'string' ? packageJson.version : '';
}

function shouldSkipBetaMirror(env = process.env, version) {
  if (!isBetaReleaseVersion(version)) return false;
  return String(env.OVERRIDE_BETA_MIRROR_SKIP ?? '').trim() !== '1';
}

function copyReleaseAssets(releaseDir = RELEASE_DIR, destination) {
  if (!destination) {
    return;
  }

  if (!fs.existsSync(releaseDir)) {
    return;
  }

  const resolvedReleaseDir = path.resolve(releaseDir);
  const resolvedDestination = path.resolve(destination);

  if (resolvedDestination === resolvedReleaseDir) {
    return;
  }

  if (resolvedDestination.startsWith(`${resolvedReleaseDir}${path.sep}`)) {
    throw new Error('AFTER_PACK_LOC cannot be inside the release directory');
  }

  fs.mkdirSync(resolvedDestination, { recursive: true });
  const entries = fs.readdirSync(releaseDir);

  for (const entry of entries) {
    const sourcePath = path.join(releaseDir, entry);
    const destinationPath = path.join(resolvedDestination, entry);
    fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true, errorOnExist: false });
  }
}

function run({ releaseDir = RELEASE_DIR, env = process.env, version = readPackageVersion() } = {}) {
  cleanReleaseArtifacts(releaseDir);
  if (shouldSkipBetaMirror(env, version)) {
    console.warn(
      `beta version ${version}; skipping AFTER_PACK_LOC mirror (set OVERRIDE_BETA_MIRROR_SKIP=1 to force).`
    );
    return { mirrored: false, destination: null, skippedBetaMirror: true };
  }

  const destination = getAfterPackLocation(env);
  if (!destination) {
    return { mirrored: false, destination: null, skippedBetaMirror: false };
  }

  copyReleaseAssets(releaseDir, destination);
  return {
    mirrored: true,
    destination: path.resolve(destination),
    skippedBetaMirror: false,
  };
}

function finalizeReleaseAssets({
  releaseDir = RELEASE_DIR,
  env = process.env,
  version = readPackageVersion(),
} = {}) {
  const result = run({ releaseDir, env, version });
  if (result.mirrored) {
    console.log(`Mirrored cleaned release assets to: ${result.destination}`);
  } else if (result.skippedBetaMirror) {
    console.warn(
      `WARNING: Cleaned release assets without mirroring (beta version ${version}; set OVERRIDE_BETA_MIRROR_SKIP=1 to force).`
    );
  } else {
    console.log('Cleaned release assets; AFTER_PACK_LOC not set, mirror skipped.');
  }
  return result;
}

if (require.main === module) {
  try {
    finalizeReleaseAssets();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error(`Failed to finalize release assets: ${message}`);
    process.exit(1);
  }
}

module.exports = {
  RELEASE_DIR,
  BUILD_ONLY_DIRECTORIES,
  BUILD_ONLY_FILES,
  cleanReleaseArtifacts,
  getAfterPackLocation,
  isBetaReleaseVersion,
  readPackageVersion,
  shouldSkipBetaMirror,
  copyReleaseAssets,
  run,
  finalizeReleaseAssets,
};
