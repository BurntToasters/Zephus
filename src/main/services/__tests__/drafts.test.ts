import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

let userDataDir = "";

vi.mock("electron", () => ({
  app: {
    getPath: () => userDataDir,
  },
}));

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-drafts-"));
  userDataDir = path.join(tmpDir, "userdata");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("drafts", () => {
  it("writes, reads, and clears scoped drafts", async () => {
    const drafts = await import("../drafts");
    const projectPath = "/tmp/project";
    const page = "src/pages/index.astro";

    expect(
      drafts.writeDraft(projectPath, "page", page, "<h1>draft</h1>").ok,
    ).toBe(true);

    const read = drafts.readDraft(projectPath, "page", page);
    expect(read.ok).toBe(true);
    expect(read.draft?.scope).toBe("page");
    expect(read.draft?.target).toBe(page);
    expect(read.draft?.content).toBe("<h1>draft</h1>");

    expect(
      drafts.writeDraft(
        projectPath,
        "site",
        "site-shell",
        '{"siteName":"Zephus"}',
      ).ok,
    ).toBe(true);
    const siteRead = drafts.readDraft(projectPath, "site", "site-shell");
    expect(siteRead.ok).toBe(true);
    expect(siteRead.draft?.scope).toBe("site");
    expect(siteRead.draft?.target).toBe("site-shell");

    expect(drafts.clearDraft(projectPath, "page", page).ok).toBe(true);
    expect(drafts.readDraft(projectPath, "page", page).draft).toBeNull();
    expect(drafts.clearDraft(projectPath, "site", "site-shell").ok).toBe(true);
    expect(
      drafts.readDraft(projectPath, "site", "site-shell").draft,
    ).toBeNull();
  });

  it("lists draft summaries with project context", async () => {
    const drafts = await import("../drafts");
    expect(
      drafts.writeDraft(
        "/tmp/project-a",
        "page",
        "src/pages/about.astro",
        "<h1>a</h1>",
      ).ok,
    ).toBe(true);
    expect(
      drafts.writeDraft(
        "/tmp/project-b",
        "site",
        "site-shell",
        '{"siteName":"b"}',
      ).ok,
    ).toBe(true);

    const listed = drafts.listDraftSummaries();
    expect(listed.ok).toBe(true);
    expect(listed.entries.length).toBeGreaterThanOrEqual(2);
    expect(
      listed.entries.some((entry) => entry.projectPath === "/tmp/project-a"),
    ).toBe(true);
    expect(listed.entries.some((entry) => entry.scope === "site")).toBe(true);
  });
});
