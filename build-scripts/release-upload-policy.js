"use strict";

const path = require("node:path");

function isLatestMetadataUploadName(name) {
  return /^latest(?:-[A-Za-z0-9_-]+)?\.ya?ml$/i.test(name);
}

function isGithubPrereleaseVersion(version) {
  return /-(beta|alpha|rc|db)(?:[.-]|$|[0-9])/i.test(String(version));
}

function resolveUploadPolicyVersion(version) {
  if (version !== undefined && version !== null && String(version).trim()) {
    return String(version).trim();
  }
  try {
    return require("../package.json").version;
  } catch {
    return null;
  }
}

function isReleaseUploadName(name, version) {
  const matches =
    /\.(?:dmg|zip|exe|msi|appimage|deb|rpm|appx|msix|flatpak|blockmap|asc)$/i.test(
      name,
    ) ||
    /^SHA256SUMS-[A-Za-z0-9_-]+\.txt$/.test(name) ||
    /^(?:latest|beta|alpha|db)(?:-[A-Za-z0-9_-]+)?\.ya?ml$/i.test(name);
  if (!matches) {
    return false;
  }
  const resolvedVersion = resolveUploadPolicyVersion(version);
  if (
    resolvedVersion &&
    isGithubPrereleaseVersion(resolvedVersion) &&
    isLatestMetadataUploadName(name)
  ) {
    return false;
  }
  return true;
}

function getReleaseUploadFiles(releaseEntries, releaseDir, version) {
  const resolvedVersion = resolveUploadPolicyVersion(version);
  return releaseEntries
    .filter((name) => isReleaseUploadName(name, resolvedVersion))
    .sort()
    .map((name) => path.join(releaseDir, name));
}

function selectMatchingDraft(releases, tagName) {
  if (!Array.isArray(releases)) {
    return { draft: null, published: null };
  }
  const matching = releases.filter((release) => release.tag_name === tagName);
  const drafts = matching
    .filter((release) => release.draft === true)
    .sort((a, b) => (b.assets?.length || 0) - (a.assets?.length || 0));
  return {
    draft: drafts[0] || null,
    published: matching.find((release) => release.draft !== true) || null,
  };
}

function releaseSourceFailures({
  head,
  targetCommit,
  worktreeStatus,
  existingTagCommit,
}) {
  const failures = [];
  if (!/^[0-9a-f]{40}$/i.test(head || "")) {
    failures.push("Could not resolve the release checkout HEAD.");
  }
  if (!/^[0-9a-f]{40}$/i.test(targetCommit || "")) {
    failures.push("Could not resolve the release target commit.");
  } else if ((head || "").toLowerCase() !== targetCommit.toLowerCase()) {
    failures.push(
      `Release checkout HEAD ${head || "unknown"} does not match target ${targetCommit}.`,
    );
  }
  if (String(worktreeStatus || "").trim()) {
    failures.push("Release checkout has uncommitted or untracked files.");
  }
  if (String(existingTagCommit || "").trim()) {
    failures.push("Release version already has a remote Git tag.");
  }
  return failures;
}

module.exports = {
  getReleaseUploadFiles,
  isGithubPrereleaseVersion,
  isLatestMetadataUploadName,
  isReleaseUploadName,
  releaseSourceFailures,
  resolveUploadPolicyVersion,
  selectMatchingDraft,
};
