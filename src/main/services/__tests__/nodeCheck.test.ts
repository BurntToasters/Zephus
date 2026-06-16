import { describe, expect, it } from "vitest";
import {
  evaluateNodeVersionOutput,
  meetsMinimumNodeVersion,
  parseNodeVersion,
} from "../nodeCheck";

describe("nodeCheck", () => {
  describe("parseNodeVersion", () => {
    it("parses standard `node --version` output", () => {
      expect(parseNodeVersion("v22.12.0\n")).toEqual({
        major: 22,
        minor: 12,
        patch: 0,
      });
    });

    it("parses without a leading v", () => {
      expect(parseNodeVersion("24.15.0")).toEqual({
        major: 24,
        minor: 15,
        patch: 0,
      });
    });

    it("returns null for unparseable output", () => {
      expect(parseNodeVersion("not a version")).toBeNull();
      expect(parseNodeVersion("")).toBeNull();
    });
  });

  describe("meetsMinimumNodeVersion", () => {
    it("accepts the exact minimum and newer", () => {
      expect(meetsMinimumNodeVersion({ major: 22, minor: 12, patch: 0 })).toBe(
        true,
      );
      expect(meetsMinimumNodeVersion({ major: 22, minor: 12, patch: 5 })).toBe(
        true,
      );
      expect(meetsMinimumNodeVersion({ major: 22, minor: 20, patch: 0 })).toBe(
        true,
      );
      expect(meetsMinimumNodeVersion({ major: 24, minor: 0, patch: 0 })).toBe(
        true,
      );
    });

    it("rejects versions below the minimum", () => {
      expect(meetsMinimumNodeVersion({ major: 22, minor: 11, patch: 9 })).toBe(
        false,
      );
      expect(meetsMinimumNodeVersion({ major: 20, minor: 18, patch: 0 })).toBe(
        false,
      );
      expect(meetsMinimumNodeVersion({ major: 18, minor: 20, patch: 0 })).toBe(
        false,
      );
    });
  });

  describe("evaluateNodeVersionOutput", () => {
    it("returns ok for a supported version", () => {
      const result = evaluateNodeVersionOutput("v22.12.0");
      expect(result.status).toBe("ok");
      expect(result.version).toBe("22.12.0");
    });

    it("returns outdated for an unsupported version", () => {
      const result = evaluateNodeVersionOutput("v20.18.0");
      expect(result.status).toBe("outdated");
      expect(result.version).toBe("20.18.0");
      expect(result.message).toContain("22.12.0");
    });

    it("returns unknown for unparseable output", () => {
      const result = evaluateNodeVersionOutput("garbage");
      expect(result.status).toBe("unknown");
      expect(result.version).toBeNull();
    });
  });
});
