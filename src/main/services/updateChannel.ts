import type { GlobalSettings } from "../types";

export type ReleaseFeedChannel = "latest" | "beta" | "db";

/**
 * Stability ranking used to decide allowed transitions between channels.
 * Higher = more stable. This intentionally diverges from raw semver, where
 * prerelease tags are compared alphabetically (so "beta" < "db"). For Zephus,
 * `db` (Developer Beta) is the least stable / bleeding edge, then `beta`, then
 * stable releases.
 */
const DEVELOPER_RANK = 0;
const BETA_RANK = 1;
const STABLE_RANK = 2;

export function isDeveloperVersion(version: string): boolean {
  return /-db(?:[.-]|$)/i.test(version);
}

export function isBetaVersion(version: string): boolean {
  return /-(beta|alpha|rc)(?:[.-]|$)/i.test(version);
}

export function detectInstalledUpdateFeed(version: string): ReleaseFeedChannel {
  if (isDeveloperVersion(version)) return "db";
  if (isBetaVersion(version)) return "beta";
  return "latest";
}

export function resolveUpdateFeedChannel(
  channel: GlobalSettings["updateChannel"],
  installedVersion: string,
): ReleaseFeedChannel {
  if (channel === "developer") return "db";
  if (channel === "beta") return "beta";
  if (channel === "stable") return "latest";
  return detectInstalledUpdateFeed(installedVersion);
}

/** Stability rank of an installed/candidate version string. */
export function versionStabilityRank(version: string): number {
  if (isDeveloperVersion(version)) return DEVELOPER_RANK;
  if (isBetaVersion(version)) return BETA_RANK;
  return STABLE_RANK;
}

/** Stability rank of a resolved release feed. */
export function feedStabilityRank(feed: ReleaseFeedChannel): number {
  if (feed === "db") return DEVELOPER_RANK;
  if (feed === "beta") return BETA_RANK;
  return STABLE_RANK;
}

interface ParsedVersion {
  base: [number, number, number];
  rank: number;
  pre: number;
}

function parseVersion(version: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  const base: [number, number, number] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];

  let pre = 0;
  const dash = version.indexOf("-");
  if (dash !== -1) {
    const identifiers = version.slice(dash + 1).split(/[.+]/);
    for (const id of identifiers) {
      if (/^\d+$/.test(id)) pre = Number(id);
    }
  }

  return { base, rank: versionStabilityRank(version), pre };
}

function compareBase(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const [aMajor, aMinor, aPatch] = a;
  const [bMajor, bMinor, bPatch] = b;
  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1;
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1;
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1;
  return 0;
}

/**
 * Decides whether `candidate` should be offered as an update to `current`,
 * using Zephus channel semantics rather than raw semver:
 *
 *  - A newer base version (major.minor.patch) is always an upgrade.
 *  - An older base version is never an upgrade (no downgrades).
 *  - At the same base version, moving to a more stable channel is an upgrade
 *    (db -> beta -> stable). Moving to a less stable channel is not.
 *  - Within the same base + same channel, a higher prerelease build wins.
 *
 * Examples (all return true):
 *   isChannelUpgrade("0.1.0-db.1", "0.1.0-beta.4")
 *   isChannelUpgrade("0.1.0-db.1", "0.1.0")
 *   isChannelUpgrade("0.1.0-db.1", "0.1.0-db.2")
 *
 * Examples (all return false):
 *   isChannelUpgrade("0.2.0-db.1", "0.1.0")        // older base
 *   isChannelUpgrade("0.1.0", "0.1.0-beta.5")      // same base, less stable
 *   isChannelUpgrade("0.1.0-beta.3", "0.1.0-db.9") // same base, less stable
 */
export function isChannelUpgrade(current: string, candidate: string): boolean {
  const c = parseVersion(current);
  const n = parseVersion(candidate);
  if (!c || !n) return false;

  const baseCmp = compareBase(n.base, c.base);
  if (baseCmp !== 0) return baseCmp > 0;
  if (n.rank !== c.rank) return n.rank > c.rank;
  return n.pre > c.pre;
}

/**
 * Whether electron-updater's `allowDowngrade` must be enabled for a given
 * feed + installed version. This is only needed when graduating to a more
 * stable channel at the same base version, where the target build is a lower
 * semver (e.g. db.1 -> beta.4). `isChannelUpgrade` remains the final gate, so
 * enabling this never allows an actual base-version downgrade.
 */
export function shouldAllowFeedDowngrade(
  feed: ReleaseFeedChannel,
  installedVersion: string,
): boolean {
  return feedStabilityRank(feed) > versionStabilityRank(installedVersion);
}
