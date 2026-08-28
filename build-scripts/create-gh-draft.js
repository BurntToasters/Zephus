/** create-gh-draft.js Pre-creates a single GitHub draft release for the current package version before any build VMs… */

'use strict';

require('dotenv').config();
const { assertGitHubCliAuthenticated, githubApi } = require('./github-cli');
const { selectMatchingDraft } = require('./release-upload-policy');

const packageJson = require('../package.json');

const VERSION = packageJson.version;
const TAG_NAME = 'v' + VERSION;
const REPO_OWNER = 'BurntToasters';
const REPO_NAME = 'zephus';
const GH_REQUEST_RETRIES = Number.parseInt(process.env.GH_REQUEST_RETRIES || '3', 10);
const GH_REQUEST_RETRY_DELAY_MS = Number.parseInt(
  process.env.GH_REQUEST_RETRY_DELAY_MS || '1500',
  10
);

function isGithubPrereleaseVersion(version) {
  return /-(beta|alpha|rc|db)(?:[.-]|$)/i.test(version);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGithubError(error) {
  if (!error) return false;
  const retryableStatusCodes = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
  const retryableCodes = new Set([
    'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE',
  ]);
  if (typeof error.statusCode === 'number' && retryableStatusCodes.has(error.statusCode)) return true;
  if (typeof error.code === 'string' && retryableCodes.has(error.code)) return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('timeout') || msg.includes('socket hang up') || msg.includes('aborted');
}

function githubRequest(method, endpoint, body) {
  return Promise.resolve(githubApi(method, endpoint, body));
}

async function githubRequestWithRetry(method, endpoint, body) {
  const attempts = Math.max(1, GH_REQUEST_RETRIES);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await githubRequest(method, endpoint, body);
    } catch (error) {
      const canRetry = attempt < attempts && isRetryableGithubError(error);
      if (!canRetry) throw error;
      const backoffMs = GH_REQUEST_RETRY_DELAY_MS * attempt;
      console.log(`   Retry ${attempt}/${attempts - 1} in ${backoffMs}ms (${error.message})`);
      await sleep(backoffMs);
    }
  }
}

async function findExistingRelease() {
  // A published tag is immutable. Reusing its version would replace assets
  // without giving existing clients a newer version to discover.
  try {
    await githubRequestWithRetry(
      'GET',
      `/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${TAG_NAME}`
    );
    throw new Error(
      `Release ${TAG_NAME} is already published. Bump package.json to a new version.`
    );
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }

  // Fall back to listing all releases (needed for drafts, which have no tag yet).
  const releases = await githubRequestWithRetry(
    'GET',
    `/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=100`
  );

  if (!Array.isArray(releases)) return null;

  const { draft, published } = selectMatchingDraft(releases, TAG_NAME);
  if (published) {
    throw new Error(
      `Release ${TAG_NAME} is already published. Bump package.json to a new version.`
    );
  }
  return draft;
}

async function main() {
  console.log('═'.repeat(60));
  console.log(`Pre-creating GitHub draft release: ${TAG_NAME}`);
  console.log('═'.repeat(60));

  assertGitHubCliAuthenticated();

  // Check whether a release already exists.
  let existing = null;
  try {
    existing = await findExistingRelease();
  } catch (err) {
    console.error('✗ Failed to query existing releases:', err.message);
    process.exit(1);
  }

  if (existing) {
    console.log(
      `✓ Release already exists (id=${existing.id}, draft=${existing.draft}, assets=${existing.assets.length})`
    );
    console.log(`  Upload URL: ${existing.upload_url}`);
    return;
  }

  // Create the draft.
  console.log('  No existing release found. Creating draft...');
  try {
    const release = await githubRequestWithRetry(
      'POST',
      `/repos/${REPO_OWNER}/${REPO_NAME}/releases`,
      {
        tag_name: TAG_NAME,
        name: `Zephus ${VERSION}`,
        draft: true,
        prerelease: isGithubPrereleaseVersion(VERSION),
      }
    );
    console.log(`✓ Created draft release: ${release.name} (id=${release.id})`);
    console.log(`  Upload URL: ${release.upload_url}`);
  } catch (err) {
    if (err.statusCode === 422) {
      // Lost a race with another process — fetch and report what exists.
      console.log('  422: release appeared concurrently. Fetching winner...');
      await sleep(2000);
      try {
        const winner = await findExistingRelease();
        if (winner) {
          console.log(`✓ Using existing release (id=${winner.id})`);
          return;
        }
      } catch (retryErr) {
        console.error('  Re-fetch failed:', retryErr.message);
      }
    }
    console.error('✗ Failed to create release:', err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
