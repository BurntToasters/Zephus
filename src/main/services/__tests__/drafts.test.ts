import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as crypto from "crypto";
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

  it("prunes expired drafts on the next write", async () => {
    const drafts = await import("../drafts");
    fs.mkdirSync(userDataDir, { recursive: true });
    const file = path.join(userDataDir, "drafts.json");
    // Seed one expired and one fresh draft directly in the store.
    const oldDate = new Date(
      Date.now() - 60 * 24 * 60 * 60 * 1000,
    ).toISOString();
    fs.writeFileSync(
      file,
      JSON.stringify({
        expired: {
          projectPath: "/tmp/old",
          scope: "page",
          target: "src/pages/old.astro",
          content: "<h1>old</h1>",
          savedAt: oldDate,
        },
        fresh: {
          projectPath: "/tmp/new",
          scope: "page",
          target: "src/pages/new.astro",
          content: "<h1>new</h1>",
          savedAt: new Date().toISOString(),
        },
      }),
      "utf8",
    );

    expect(drafts.writeDraft("/tmp/other", "site", "site-shell", "{}").ok).toBe(
      true,
    );

    const store = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(store["expired"]).toBeUndefined();
    expect(store["fresh"]).toBeDefined();
  });

  it("fails cleanly when the drafts store cannot be written", async () => {
    // draftsPath points at a directory: the atomic rename onto it throws.
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(path.join(userDataDir, "drafts.json"));
    const drafts = await import("../drafts");
    expect(drafts.writeDraft("/p", "page", "a.astro", "x").ok).toBe(false);
    expect(drafts.clearDraft("/p", "page", "a.astro").ok).toBe(false);
  });

  it("reads and lists legacy page-shaped drafts", async () => {
    // Older stores keyed entries by page path without scope/target fields.
    fs.mkdirSync(userDataDir, { recursive: true });
    const key = crypto
      .createHash("sha1")
      .update("/tmp/proj::src/pages/legacy.astro")
      .digest("hex");
    fs.writeFileSync(
      path.join(userDataDir, "drafts.json"),
      JSON.stringify({
        [key]: {
          projectPath: "/tmp/proj",
          page: "src/pages/legacy.astro",
          content: "<p>old shape</p>",
          savedAt: new Date().toISOString(),
        },
      }),
    );
    const drafts = await import("../drafts");
    const read = drafts.readDraft(
      "/tmp/proj",
      "page",
      "src/pages/legacy.astro",
    );
    expect(read.ok).toBe(true);
    expect(read.draft?.target).toBe("src/pages/legacy.astro");
    expect(read.draft?.content).toBe("<p>old shape</p>");

    // Legacy entries are readable by key; the recovery list needs a target,
    // which the legacy shape lacks, so they are not summarized.
    const listed = drafts.listDraftSummaries();
    expect(listed.ok).toBe(true);
    expect(listed.entries).toHaveLength(0);
  });

  it("skips entries with neither shape (malformed)", async () => {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(userDataDir, "drafts.json"),
      JSON.stringify({
        junk: { content: "no shape at all" },
      }),
    );
    const drafts = await import("../drafts");
    const listed = drafts.listDraftSummaries();
    expect(listed.ok).toBe(true);
    expect(listed.entries).toHaveLength(0);
  });
});
