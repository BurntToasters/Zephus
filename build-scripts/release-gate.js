#!/usr/bin/env node
/** Release gate: fails the pipeline fast when credentials required for a VERIFIABLE release are missing. */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { assertGitHubCliAuthenticated, githubApi } = require("./github-cli");
const { releaseSourceFailures } = require("./release-upload-policy");

const failures = [];
const passedChecks = [];

// The draft release notes are the CHANGELOG.md — fail fast when the current
// version's section is missing, so a release never ships without notes.
const packageJson = require("../package.json");
const VERSION = packageJson.version;
const RELEASE_CHANNEL = (process.env.RELEASE_CHANNEL || "")
  .trim()
  .toLowerCase();
const RELEASE_BRANCH = process.env.RELEASE_BRANCH || "main";
if (RELEASE_CHANNEL === "db" && !/-db(?:[.-]|$|[0-9])/i.test(VERSION)) {
  failures.push(
    `RELEASE_CHANNEL=db requires a -db version, but package.json is ${VERSION}.`,
  );
}
const CHANGELOG_PATH = path.join(__dirname, "..", "CHANGELOG.md");

function versionSectionHeaderPattern(version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{1,3}\\s+.*${escapedVersion}(?![0-9.-]).*$`, "m");
}

function changelogSectionBody(changelog, headerPattern) {
  const match = headerPattern.exec(changelog);
  if (!match) {
    return "";
  }
  const start = match.index + match[0].length;
  const rest = changelog.slice(start);
  const nextSection = rest.search(/^#{1,3}\s+/m);
  return nextSection === -1 ? rest : rest.slice(0, nextSection);
}

function changelogVersionSectionOk(changelog, version) {
  const directHeader = versionSectionHeaderPattern(version);
  if (directHeader.test(changelog)) {
    return { ok: true, label: `CHANGELOG section for ${version}` };
  }
  const betaBridge = /^(\d+\.\d+\.\d+)-beta(?:[.-]|$)/i.exec(version);
  if (betaBridge) {
    const stableVersion = betaBridge[1];
    const stableHeader = versionSectionHeaderPattern(stableVersion);
    if (stableHeader.test(changelog)) {
      const body = changelogSectionBody(changelog, stableHeader);
      const notShipped = `stable ${stableVersion} has not shipped`;
      if (body.includes(notShipped)) {
        return {
          ok: true,
          label: `CHANGELOG section for ${stableVersion} (pre-release ${version})`,
        };
      }
      failures.push(
        `CHANGELOG.md section for ${stableVersion} must note that stable ${stableVersion} has not shipped while package.json is ${version}.`,
      );
      return { ok: false };
    }
  }
  failures.push(
    `CHANGELOG.md has no section for the current version (${version}) — the draft release notes would miss it.`,
  );
  return { ok: false };
}

try {
  const changelog = fs.readFileSync(CHANGELOG_PATH, "utf8");
  if (!changelog.trim()) {
    failures.push(
      "CHANGELOG.md is empty — the draft release notes would be blank.",
    );
  } else {
    const sectionOk = changelogVersionSectionOk(changelog, VERSION);
    if (sectionOk.ok) {
      passedChecks.push(sectionOk.label);
    }
  }
} catch (error) {
  failures.push(
    "CHANGELOG.md is required for the draft release notes: " +
      (error && error.message ? error.message : String(error)),
  );
}

try {
  assertGitHubCliAuthenticated();
  passedChecks.push("GitHub CLI authentication");
} catch (error) {
  failures.push(
    "GitHub CLI authentication is required to upload release assets: " +
      (error && error.message ? error.message : String(error)),
  );
}

try {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const worktreeStatus = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { encoding: "utf8" },
  );
  const forcedTarget = (process.env.FORCE_TARGET_COMMIT || "").trim();
  const targetCommit = forcedTarget
    ? forcedTarget
    : githubApi(
        "GET",
        `/repos/BurntToasters/zephus/branches/${encodeURIComponent(RELEASE_BRANCH)}`,
      )?.commit?.sha || "";
  const existingTagCommit = execFileSync(
    "git",
    ["ls-remote", "--tags", "origin", `refs/tags/v${VERSION}`],
    { encoding: "utf8" },
  ).trim();
  const sourceFailures = releaseSourceFailures({
    head,
    targetCommit,
    worktreeStatus,
    existingTagCommit,
  });
  failures.push(...sourceFailures);
  if (sourceFailures.length === 0) {
    passedChecks.push(
      `release source (${RELEASE_BRANCH} HEAD, clean tree, no duplicate tag)`,
    );
  }
} catch (error) {
  failures.push(
    "Release source verification failed: " +
      (error && error.message ? error.message : String(error)),
  );
}

if (!process.env.GPG_KEY_ID) {
  failures.push(
    "GPG_KEY_ID is required — .asc signatures must come from the documented key, not a random default key.",
  );
} else {
  passedChecks.push("GPG_KEY_ID");
  // gpg accepts emails, short ids, full fingerprints and 0x-prefixed hex as
  // key selectors — any of those is fine as long as it is set. A hex
  // fingerprint that does NOT match the documented key gets a hard warning
  // (the signatures would be unverifiable by users), but an email selector
  // is a legitimate way to name the key and must not fail the gate.
  const value = process.env.GPG_KEY_ID.trim();
  // A value that is (almost) entirely hex digits after stripping separators
  // is a fingerprint; warn (never fail) when it misses the documented key.
  // Emails ("code@rosie.run"), short ids and 0x-prefixed ids are legitimate
  // selectors and must not trip the fingerprint check.
  const stripped = value.replace(/[^0-9A-Fa-f]/g, "");
  const remainder = value.replace(/[0-9A-Fa-f]/g, "");
  const isFingerprintLike =
    stripped.length >= 8 && /^[@./\s:_-]*$/.test(remainder);
  if (isFingerprintLike && !/F2FBC20F/i.test(stripped)) {
    console.warn(
      `⚠ GPG_KEY_ID ${value} does not contain the documented signing key fingerprint (0xF2FBC20F) — ` +
        "verify this is intentional, or users will not be able to verify the .asc signatures.",
    );
  }
}

// Windows code-signing is OPTIONAL for now: the Azure Artifact Signing
// machinery is wired (build-scripts/electron-builder.windows.cjs signs when
// the AZURE_* variables are complete, otherwise warns + produces unsigned
// artifacts). A release can ship unsigned; no variable is required here.

if (failures.length > 0) {
  console.error("✗ Release gate failed:");
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✓ Release gate passed (${passedChecks.join(", ")}).`);
