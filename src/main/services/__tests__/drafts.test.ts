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
  it("writes, reads, and clears page drafts", async () => {
    const drafts = await import("../drafts");
    const projectPath = "/tmp/project";
    const page = "src/pages/index.astro";

    expect(drafts.writeDraft(projectPath, page, "<h1>draft</h1>").ok).toBe(
      true,
    );

    const read = drafts.readDraft(projectPath, page);
    expect(read.ok).toBe(true);
    expect(read.draft?.content).toBe("<h1>draft</h1>");

    expect(drafts.clearDraft(projectPath, page).ok).toBe(true);
    expect(drafts.readDraft(projectPath, page).draft).toBeNull();
  });
});
