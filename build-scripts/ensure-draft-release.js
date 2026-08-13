// For some reason, I needed to make this script because GitHub started to split my releases into two drafts.
// make ONE machine the single creator (win), this script has two modes:
//   (default)  create-or-reuse the single draft. Run by the Windows machine only.
//   --wait     poll until that draft exists; NEVER create. Run by mac/linux so
//              they only ever reuse the draft Windows created (no duplicates).

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

require('dotenv').config();

const GH_TOKEN = process.env.GH_TOKEN;
const REPO_OWNER = 'BurntToasters';
const REPO_NAME = 'zephus';
const CHANGELOG_PATH = path.join(__dirname, '..', 'CHANGELOG.md');
// The draft targets the latest commit of this branch (the most recent merged
// PR), not the release VM's checked-out HEAD — the VMs may be on any commit.
const RELEASE_BRANCH = process.env.RELEASE_BRANCH || 'beta';
const GH_REQUEST_TIMEOUT_MS = Number.parseInt(process.env.GH_REQUEST_TIMEOUT_MS || '30000', 10);
const GH_REQUEST_RETRIES = Number.parseInt(process.env.GH_REQUEST_RETRIES || '3', 10);
const GH_REQUEST_RETRY_DELAY_MS = Number.parseInt(
  process.env.GH_REQUEST_RETRY_DELAY_MS || '1500',
  10
);

// --wait mode: how long mac/linux will wait for the Windows machine to create
// the draft before giving up (defaults to 30 minutes, polling every 15s).
const WAIT_MODE = process.argv.slice(2).includes('--wait');
const WAIT_TIMEOUT_MS = Number.parseInt(process.env.RELEASE_DRAFT_WAIT_TIMEOUT_MS || '1800000', 10);
const WAIT_POLL_INTERVAL_MS = Number.parseInt(
  process.env.RELEASE_DRAFT_WAIT_POLL_MS || '15000',
  10
);

const packageJson = require('../package.json');
const VERSION = packageJson.version;
const TAG_NAME = 'v' + VERSION;
const IS_PRERELEASE = VERSION.includes('beta') || VERSION.includes('alpha');

/** Release notes = the full CHANGELOG.md (mirrors the Zinnia release flow). */
function readChangelogReleaseBody() {
  let body;
  try {
    body = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  } catch (error) {
    throw new Error(
      'CHANGELOG.md is required for GitHub release notes: ' +
        (error && error.message ? error.message : String(error)),
      { cause: error }
    );
  }
  if (!body.trim()) {
    throw new Error('CHANGELOG.md is empty; refusing to set blank release notes.');
  }
  return body;
}

/**
 * The commit the draft must target: the latest commit on RELEASE_BRANCH
 * (e.g. beta), resolved from the remote so the Windows VM does not need to
 * be checked out at that commit. FORCE_TARGET_COMMIT overrides for manual
 * wiring.
 */
async function latestBranchCommit() {
  const forced = process.env.FORCE_TARGET_COMMIT;
  if (forced && forced.trim()) {
    const sha = forced.trim();
    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      throw new Error('FORCE_TARGET_COMMIT must be a full 40-character commit sha.');
    }
    return sha;
  }
  try {
    const branch = await githubRequestWithRetry(
      'GET',
      '/repos/' + REPO_OWNER + '/' + REPO_NAME + '/branches/' + encodeURIComponent(RELEASE_BRANCH)
    );
    const sha = branch && branch.commit && branch.commit.sha;
    if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) {
      throw new Error('API returned no commit sha for branch ' + RELEASE_BRANCH);
    }
    return sha;
  } catch (apiError) {
    // The API may be rate-limited or unreachable from the release VM; fall
    // back to the remote ref lookup (works with any clone state).
    console.log(
      '   GitHub API branch lookup failed (' +
        (apiError && apiError.message ? apiError.message : String(apiError)) +
        '); falling back to git ls-remote.'
    );
    const remote = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/' + RELEASE_BRANCH], {
      encoding: 'utf8',
    }).trim();
    const sha = remote.split(/\s+/)[0];
    if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) {
      throw new Error(
        'Could not resolve the latest ' +
          RELEASE_BRANCH +
          ' branch commit (API failed and git ls-remote returned nothing usable).',
        { cause: apiError }
      );
    }
    return sha;
  }
}

/** Keeps the draft's release notes + target commit fresh on every run. */
async function syncDraftRelease(release, body, targetCommit) {
  if (!release || typeof release.id !== 'number') {
    throw new Error('Cannot sync release notes without a GitHub release id.');
  }
  const updated = await githubRequestWithRetry(
    'PATCH',
    '/repos/' + REPO_OWNER + '/' + REPO_NAME + '/releases/' + release.id,
    { body, target_commitish: targetCommit }
  );
  console.log(
    '   Synced CHANGELOG.md into release notes (' +
      body.length +
      ' chars) and target commit ' +
      targetCommit +
      ' (' +
      RELEASE_BRANCH +
      ') for ' +
      (release.name || TAG_NAME) +
      '.'
  );
  return updated;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGithubError(error) {
  if (!error) return false;

  const retryableStatusCodes = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
  const retryableCodes = new Set([
    'ETIMEDOUT',
    'ECONNRESET',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'EPIPE',
  ]);

  if (typeof error.statusCode === 'number' && retryableStatusCodes.has(error.statusCode)) {
    return true;
  }
  if (typeof error.code === 'string' && retryableCodes.has(error.code)) {
    return true;
  }

  const msg = String(error.message || '').toLowerCase();
  return msg.includes('timeout') || msg.includes('socket hang up') || msg.includes('aborted');
}

function githubRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      method: method,
      headers: {
        Authorization: 'Bearer ' + GH_TOKEN,
        'User-Agent': 'Zephus-Release-Script',
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };

    if (body) {
      options.headers['Content-Type'] = 'application/json';
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('aborted', () => {
        const err = new Error('GitHub API response aborted for ' + method + ' ' + endpoint);
        err.code = 'ECONNRESET';
        reject(err);
      });
      res.on('end', () => {
        const statusCode = res.statusCode || 0;
        try {
          if (statusCode >= 200 && statusCode < 300) {
            resolve(data ? JSON.parse(data) : {});
          } else {
            const json = data ? JSON.parse(data) : {};
            const err = new Error(
              'GitHub API error ' +
                statusCode +
                ' for ' +
                method +
                ' ' +
                endpoint +
                ': ' +
                (json.message || data || 'unknown error')
            );
            err.statusCode = statusCode;
            reject(err);
          }
        } catch (e) {
          const err = new Error(
            'GitHub API invalid JSON for ' + method + ' ' + endpoint + ': ' + e.message
          );
          err.statusCode = statusCode;
          reject(err);
        }
      });
    });

    req.setTimeout(GH_REQUEST_TIMEOUT_MS, () => {
      const err = new Error(
        'GitHub API timeout after ' + GH_REQUEST_TIMEOUT_MS + 'ms for ' + method + ' ' + endpoint
      );
      err.code = 'ETIMEDOUT';
      req.destroy(err);
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function githubRequestWithRetry(method, endpoint, body) {
  const attempts = Math.max(1, GH_REQUEST_RETRIES);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await githubRequest(method, endpoint, body);
    } catch (error) {
      const canRetry = attempt < attempts && isRetryableGithubError(error);
      if (!canRetry) {
        throw error;
      }

      const backoffMs = GH_REQUEST_RETRY_DELAY_MS * attempt;
      console.log(
        '   Retry ' +
          attempt +
          '/' +
          (attempts - 1) +
          ' in ' +
          backoffMs +
          'ms (' +
          error.message +
          ')'
      );
      await sleep(backoffMs);
    }
  }
}

async function findExistingRelease() {
  // Draft releases are not returned by the "get release by tag" endpoint
  // (no git tag exists yet), so we list and match on tag_name.
  const releases = await githubRequestWithRetry(
    'GET',
    '/repos/' + REPO_OWNER + '/' + REPO_NAME + '/releases?per_page=100'
  );

  if (!Array.isArray(releases)) {
    throw new Error('Unexpected releases payload type');
  }

  const matching = releases.filter((r) => r.tag_name === TAG_NAME);
  if (matching.length === 0) {
    return null;
  }

  // Prefer a draft (electron-builder publishes into drafts); fall back to any.
  const draft = matching.find((r) => r.draft);
  return draft || matching[0];
}

async function ensureDraftRelease() {
  console.log('Ensuring draft release exists for ' + TAG_NAME + '...');
  const body = readChangelogReleaseBody();
  const targetCommit = await latestBranchCommit();

  const existing = await findExistingRelease();
  if (existing) {
    console.log(
      '   Draft already exists: ' +
        (existing.name || TAG_NAME) +
        ' (id ' +
        existing.id +
        ', ' +
        (existing.assets ? existing.assets.length : 0) +
        ' assets) - refreshing release notes + target commit.'
    );
    return syncDraftRelease(existing, body, targetCommit);
  }

  console.log('   No release found. Creating draft...');
  try {
    const release = await githubRequestWithRetry(
      'POST',
      '/repos/' + REPO_OWNER + '/' + REPO_NAME + '/releases',
      {
        // Match electron-builder's createRelease() so it reuses this draft:
        // tag = "v" + version, name defaults to the version, draft:true.
        tag_name: TAG_NAME,
        target_commitish: targetCommit,
        name: VERSION,
        body,
        draft: true,
        prerelease: IS_PRERELEASE,
      }
    );
    console.log(
      '   Created draft release: ' +
        (release.name || TAG_NAME) +
        ' (id ' +
        release.id +
        ') with CHANGELOG.md release notes targeting ' +
        targetCommit +
        ' (' +
        RELEASE_BRANCH +
        ').'
    );
    return release;
  } catch (error) {
    // Another concurrent run may have created it (422 already_exists) - re-fetch.
    if (error.statusCode === 422) {
      console.log('   Create returned 422; re-checking for existing draft...');
      await sleep(2000);
      const afterRetry = await findExistingRelease();
      if (afterRetry) {
        console.log('   Found existing draft after retry: id ' + afterRetry.id);
        return syncDraftRelease(afterRetry, body, targetCommit);
      }
    }
    throw error;
  }
}

async function waitForDraftRelease() {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  console.log(
    'Waiting for draft release ' +
      TAG_NAME +
      ' (created by the Windows machine); will NOT create it here...'
  );

  let attempt = 0;
  for (;;) {
    attempt += 1;
    const existing = await findExistingRelease();
    if (existing) {
      console.log(
        '   Found draft: ' +
          (existing.name || TAG_NAME) +
          ' (id ' +
          existing.id +
          ', ' +
          (existing.assets ? existing.assets.length : 0) +
          ' assets). Proceeding.'
      );
      return existing;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        'Timed out after ' +
          Math.round(WAIT_TIMEOUT_MS / 1000) +
          's waiting for draft ' +
          TAG_NAME +
          '. Run "npm run release:draft" on the Windows machine first (or run it here once), then retry.'
      );
    }

    console.log(
      '   Draft not found yet (attempt ' +
        attempt +
        '); re-checking in ' +
        Math.round(WAIT_POLL_INTERVAL_MS / 1000) +
        's...'
    );
    await sleep(WAIT_POLL_INTERVAL_MS);
  }
}

async function main() {
  if (!GH_TOKEN) {
    // Skipping quietly (exit 0) let concurrent per-platform release jobs race
    // to create drafts — the exact duplicate-draft problem this script
    // exists to prevent. Fail loudly instead.
    console.error('✖ GH_TOKEN is not set. Cannot ensure the draft release.');
    console.error('   Export GH_TOKEN (or set it in the environment) and re-run.');
    if (WAIT_MODE) {
      console.error('   In wait mode this would otherwise skip the wait and race the other jobs.');
    }
    process.exit(1);
  }

  if (WAIT_MODE) {
    await waitForDraftRelease();
  } else {
    await ensureDraftRelease();
  }
}

main().catch((error) => {
  const message = error && error.message ? error.message : String(error);
  console.error('✗ ERROR: Failed to ensure draft release: ' + message);
  process.exit(1);
});
