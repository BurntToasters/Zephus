import { describe, expect, it } from "vitest";
import {
  detectInstalledUpdateFeed,
  isBetaVersion,
  isChannelUpgrade,
  isDeveloperVersion,
  resolveUpdateFeedChannel,
  shouldAllowFeedDowngrade,
} from "../updateChannel";

describe("updateChannel", () => {
  it("detects developer builds from db tags", () => {
    expect(isDeveloperVersion("0.1.0-db.1")).toBe(true);
    expect(isDeveloperVersion("0.1.0-beta.1")).toBe(false);
    expect(isDeveloperVersion("0.1.0")).toBe(false);
  });

  it("detects beta-style prerelease builds separately from developer builds", () => {
    expect(isBetaVersion("0.1.0-beta.1")).toBe(true);
    expect(isBetaVersion("0.1.0-alpha.2")).toBe(true);
    expect(isBetaVersion("0.1.0-rc.3")).toBe(true);
    expect(isBetaVersion("0.1.0-db.1")).toBe(false);
    expect(isBetaVersion("0.1.0")).toBe(false);
  });

  it("maps installed versions to the correct feed for auto channel", () => {
    expect(detectInstalledUpdateFeed("0.1.0")).toBe("latest");
    expect(detectInstalledUpdateFeed("0.1.0-beta.1")).toBe("beta");
    expect(detectInstalledUpdateFeed("0.1.0-db.1")).toBe("db");
  });

  it("resolves explicit update channel overrides", () => {
    expect(resolveUpdateFeedChannel("stable", "0.1.0-db.1")).toBe("latest");
    expect(resolveUpdateFeedChannel("beta", "0.1.0")).toBe("beta");
    expect(resolveUpdateFeedChannel("developer", "0.1.0")).toBe("db");
    expect(resolveUpdateFeedChannel("auto", "0.1.0-db.1")).toBe("db");
  });

  describe("isChannelUpgrade", () => {
    it("offers newer base versions regardless of channel", () => {
      expect(isChannelUpgrade("0.1.0-db.1", "0.2.0-db.1")).toBe(true);
      expect(isChannelUpgrade("0.1.0", "0.2.0-beta.1")).toBe(true);
      expect(isChannelUpgrade("0.1.0-beta.3", "0.2.0")).toBe(true);
    });

    it("never offers older base versions (no downgrades)", () => {
      expect(isChannelUpgrade("0.2.0-db.1", "0.1.0")).toBe(false);
      expect(isChannelUpgrade("0.2.0-db.1", "0.1.0-beta.9")).toBe(false);
      expect(isChannelUpgrade("0.2.0", "0.1.0")).toBe(false);
    });

    it("allows graduating to a more stable channel at the same base", () => {
      // The key case: db -> beta is a semver downgrade but a valid graduation.
      expect(isChannelUpgrade("0.1.0-db.1", "0.1.0-beta.1")).toBe(true);
      expect(isChannelUpgrade("0.1.0-db.1", "0.1.0")).toBe(true);
      expect(isChannelUpgrade("0.1.0-beta.5", "0.1.0")).toBe(true);
    });

    it("does not offer a less stable channel at the same base", () => {
      expect(isChannelUpgrade("0.1.0", "0.1.0-beta.5")).toBe(false);
      expect(isChannelUpgrade("0.1.0", "0.1.0-db.5")).toBe(false);
      expect(isChannelUpgrade("0.1.0-beta.3", "0.1.0-db.9")).toBe(false);
    });

    it("compares build numbers within the same base and channel", () => {
      expect(isChannelUpgrade("0.1.0-db.1", "0.1.0-db.2")).toBe(true);
      expect(isChannelUpgrade("0.1.0-db.2", "0.1.0-db.1")).toBe(false);
      expect(isChannelUpgrade("0.1.0-db.2", "0.1.0-db.2")).toBe(false);
      expect(isChannelUpgrade("0.1.0-beta.1", "0.1.0-beta.4")).toBe(true);
    });

    it("returns false for unparseable versions", () => {
      expect(isChannelUpgrade("not-a-version", "0.1.0")).toBe(false);
      expect(isChannelUpgrade("0.1.0", "garbage")).toBe(false);
    });
  });

  describe("shouldAllowFeedDowngrade", () => {
    it("enables downgrade only when graduating to a more stable feed", () => {
      expect(shouldAllowFeedDowngrade("beta", "0.1.0-db.1")).toBe(true);
      expect(shouldAllowFeedDowngrade("latest", "0.1.0-db.1")).toBe(true);
      expect(shouldAllowFeedDowngrade("latest", "0.1.0-beta.1")).toBe(true);
    });

    it("keeps downgrade disabled for same or less stable feeds", () => {
      expect(shouldAllowFeedDowngrade("db", "0.1.0-db.1")).toBe(false);
      expect(shouldAllowFeedDowngrade("beta", "0.1.0-beta.1")).toBe(false);
      expect(shouldAllowFeedDowngrade("db", "0.1.0")).toBe(false);
      expect(shouldAllowFeedDowngrade("beta", "0.1.0")).toBe(false);
    });
  });
});
