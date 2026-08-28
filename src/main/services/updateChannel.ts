import type { GlobalSettings } from "../types";

export type ReleaseFeedChannel = "latest" | "beta" | "db";

/** Stability ranking used to decide allowed transitions between channels. */
const DEVELOPER_RANK = 0;
const BETA_RANK = 1;
const STABLE_RANK = 2;

export function isDeveloperVersion(version: string): boolean {
  // A digit directly after the tag ("-db10", non-standard semver) still means
  // a prerelease build, not a stable release.
  return /-db(?:[.-]|$|[0-9])/i.test(version);
}

export function isBetaVersion(version: string): boolean {
  return /-(beta|alpha|rc)(?:[.-]|$|[0-9])/i.test(version);
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
  /** Stability of the prerelease tag itself: alpha < beta < rc. */
  preType: number;
  pre: number;
}

/** alpha < beta < rc; 0 for builds without a type tag (e.g. -db.3). */
function prereleaseTypeRank(version: string): number {
  if (/-rc(?:[.-]|$|[0-9])/i.test(version)) return 3;
  if (/-beta(?:[.-]|$|[0-9])/i.test(version)) return 2;
  if (/-alpha(?:[.-]|$|[0-9])/i.test(version)) return 1;
  return 0;
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

  return {
    base,
    rank: versionStabilityRank(version),
    preType: prereleaseTypeRank(version),
    pre,
  };
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

/** Decides whether `candidate` should be offered as an update to `current`, using Zephus channel semantics rather than… */
export function isChannelUpgrade(current: string, candidate: string): boolean {
  const c = parseVersion(current);
  const n = parseVersion(candidate);
  if (!c || !n) return false;

  const baseCmp = compareBase(n.base, c.base);
  if (baseCmp !== 0) return baseCmp > 0;
  if (n.rank !== c.rank) return n.rank > c.rank;
  if (n.preType !== c.preType) return n.preType > c.preType;
  return n.pre > c.pre;
}

/** Stable-channel safety: a candidate with a prerelease tag must never be offered on the stable feed. */
export function isStableChannelCandidate(
  feed: ReleaseFeedChannel,
  candidate: string,
): boolean {
  if (feed !== "latest") return true;
  return versionStabilityRank(candidate) === STABLE_RANK;
}

/** Whether electron-updater's `allowDowngrade` must be enabled for a given feed + installed version. */
export function shouldAllowFeedDowngrade(
  feed: ReleaseFeedChannel,
  installedVersion: string,
): boolean {
  return feedStabilityRank(feed) > versionStabilityRank(installedVersion);
}
