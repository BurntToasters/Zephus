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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-settings-"));
  userDataDir = path.join(tmpDir, "userdata");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("settings", () => {
  it("clears lastOpenedProject when that recent project is removed", async () => {
    const settings = await import("../settings");

    settings.recordRecentProject("/tmp/alpha");
    settings.recordRecentProject("/tmp/beta");
    const next = settings.removeRecentProject("/tmp/beta");

    expect(next.recentProjects).toEqual(["/tmp/alpha"]);
    expect(next.lastOpenedProject).toBeNull();
    expect(settings.readGlobalSettings().lastOpenedProject).toBeNull();
  });
});

describe("reusable sections", () => {
  it("backs up corrupt storage before writing a replacement file", async () => {
    fs.mkdirSync(userDataDir, { recursive: true });
    const file = path.join(userDataDir, "reusable-sections.json");
    fs.writeFileSync(file, "{", "utf8");

    const sections = await import("../reusableSections");
    expect(sections.listReusableSections().sections).toEqual([]);
    expect(
      fs
        .readdirSync(userDataDir)
        .some((name) => name.startsWith("reusable-sections.json.corrupt-")),
    ).toBe(true);

    const saved = sections.saveReusableSection("Hero", "<section>Hi</section>");
    expect(saved.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual([
      expect.objectContaining({ label: "Hero", html: "<section>Hi</section>" }),
    ]);
  });
});
