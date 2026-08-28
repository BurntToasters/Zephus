import { describe, it, expect } from "vitest";
import * as path from "path";
import {
  normalizeProjectRelativeDir,
  toProjectRelativePath,
  resolveProjectRelativeDir,
} from "../projectPaths";

describe("normalizeProjectRelativeDir", () => {
  it("normalizes and cleans relative dirs", () => {
    expect(normalizeProjectRelativeDir("./src/pages", "src")).toBe("src/pages");
    expect(normalizeProjectRelativeDir("src/pages/", "src")).toBe("src/pages");
    expect(normalizeProjectRelativeDir("src\\pages", "src")).toBe("src/pages");
    expect(normalizeProjectRelativeDir("src/./pages", "src")).toBe("src/pages");
  });

  it("falls back for absolute, empty, and traversing values", () => {
    expect(normalizeProjectRelativeDir("/etc", "fallback")).toBe("fallback");
    expect(normalizeProjectRelativeDir("C:\\etc", "fallback")).toBe("fallback");
    expect(normalizeProjectRelativeDir("../outside", "fallback")).toBe(
      "fallback",
    );
    expect(normalizeProjectRelativeDir("..", "fallback")).toBe("fallback");
    expect(normalizeProjectRelativeDir(".", "fallback")).toBe("fallback");
    expect(normalizeProjectRelativeDir("", "fallback")).toBe("fallback");
    expect(normalizeProjectRelativeDir("   ", "fallback")).toBe("fallback");
    expect(normalizeProjectRelativeDir(undefined as never, "fallback")).toBe(
      "fallback",
    );
  });
});

describe("toProjectRelativePath", () => {
  it("converts windows separators", () => {
    expect(toProjectRelativePath("src\\pages\\a.astro")).toBe(
      "src/pages/a.astro",
    );
  });
});

describe("resolveProjectRelativeDir", () => {
  it("resolves relative to the project root", () => {
    const projectRoot = path.resolve(path.parse(process.cwd()).root, "proj");
    const result = resolveProjectRelativeDir(projectRoot, "public", "dist");
    expect(result.relative).toBe("public");
    expect(result.absolute).toBe(path.join(projectRoot, "public"));
  });

  it("falls back safely when the fallback would escape", () => {
    const projectRoot = path.resolve(path.parse(process.cwd()).root, "proj");
    const result = resolveProjectRelativeDir(projectRoot, "/etc", "dist");
    expect(result.relative).toBe("dist");
    expect(result.absolute).toBe(path.join(projectRoot, "dist"));
  });
});
