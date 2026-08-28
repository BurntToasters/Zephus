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
let projectDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-settings-"));
  userDataDir = path.join(tmpDir, "userdata");
  projectDir = path.join(tmpDir, "project");
  fs.mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("settings", () => {
  it("tolerates hand-edited junk in recentProjects and lastOpenedProject", async () => {
    const settings = await import("../settings");
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(userDataDir, "settings.json"),
      JSON.stringify({
        recentProjects: ["/tmp/ok", 123, null, ""],
        lastOpenedProject: 42,
      }),
    );
    const read = settings.readGlobalSettings();
    expect(read.recentProjects).toEqual(["/tmp/ok"]);
    expect(read.lastOpenedProject).toBeNull();
  });

  it("falls back to defaults for a corrupt settings file", async () => {
    const settings = await import("../settings");
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(path.join(userDataDir, "settings.json"), "{ not json");
    const read = settings.readGlobalSettings();
    expect(read.recentProjects).toEqual([]);
    expect(read.theme).toBe("system");
  });

  it("does not crash when the settings file cannot be written", async () => {
    const settings = await import("../settings");
    fs.mkdirSync(userDataDir, { recursive: true });
    // A directory where settings.json should live makes the atomic write fail.
    fs.mkdirSync(path.join(userDataDir, "settings.json"));
    expect(() => settings.recordRecentProject("/tmp/x")).not.toThrow();
    expect(() => settings.removeRecentProject("/tmp/x")).not.toThrow();
    const read = settings.readGlobalSettings();
    expect(read.recentProjects).toEqual([]);
  });

  it("clears lastOpenedProject when that recent project is removed", async () => {
    const settings = await import("../settings");

    settings.recordRecentProject("/tmp/alpha");
    settings.recordRecentProject("/tmp/beta");
    const next = settings.removeRecentProject("/tmp/beta");

    expect(next.recentProjects).toEqual(["/tmp/alpha"]);
    expect(next.lastOpenedProject).toBeNull();
    expect(settings.readGlobalSettings().lastOpenedProject).toBeNull();
  });

  it("falls back to the default theme for invalid stored themes", async () => {
    const settings = await import("../settings");
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(userDataDir, "settings.json"),
      JSON.stringify({ theme: "neon", autoCheckUpdates: false }),
      "utf8",
    );

    const read = settings.readGlobalSettings();
    expect(read.theme).toBe("system");
    expect(read.autoCheckUpdates).toBe(false);
  });

  it("dedupes recent projects canonically (resolved paths)", async () => {
    const settings = await import("../settings");
    const withSlash = path.join(projectDir, "sub");
    fs.mkdirSync(withSlash, { recursive: true });

    settings.recordRecentProject(withSlash + path.sep);
    settings.recordRecentProject(withSlash);

    const read = settings.readGlobalSettings();
    expect(read.recentProjects).toEqual([withSlash]);
  });

  it("merges repo settings with repo theme winning over global", async () => {
    const settings = await import("../settings");
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(userDataDir, "settings.json"),
      JSON.stringify({ theme: "light", autoCheckUpdates: false }),
      "utf8",
    );
    fs.mkdirSync(path.join(projectDir, ".zephus"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".zephus", "settings.json"),
      JSON.stringify({ theme: "dark" }),
      "utf8",
    );

    const merged = settings.getMergedSettings(projectDir);
    expect(merged.theme).toBe("dark");
    expect(merged.global.autoCheckUpdates).toBe(false);
    expect(merged.repo.schemaVersion).toBe(1);
  });

  it("falls back to the global theme when the repo theme is invalid", async () => {
    const settings = await import("../settings");
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(userDataDir, "settings.json"),
      JSON.stringify({ theme: "light" }),
      "utf8",
    );
    fs.mkdirSync(path.join(projectDir, ".zephus"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".zephus", "settings.json"),
      JSON.stringify({ theme: "neon" }),
      "utf8",
    );

    const merged = settings.getMergedSettings(projectDir);
    expect(merged.theme).toBe("light");
  });
});

describe("reusable sections", () => {
  it("stores sections inside the project (.zephus/templates)", async () => {
    const sections = await import("../reusableSections");

    const saved = sections.saveReusableSection(
      projectDir,
      "Hero",
      "<section>Hi</section>",
    );
    expect(saved.ok).toBe(true);

    const file = path.join(
      projectDir,
      ".zephus",
      "templates",
      "reusable-sections.json",
    );
    expect(fs.existsSync(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual([
      expect.objectContaining({ label: "Hero", html: "<section>Hi</section>" }),
    ]);
    // Nothing may leak into the global user-data store.
    expect(
      fs.existsSync(path.join(userDataDir, "reusable-sections.json")),
    ).toBe(false);

    const listed = sections.listReusableSections(projectDir);
    expect(listed.sections.map((s) => s.label)).toEqual(["Hero"]);
    // A different project does not see the section.
    const other = path.join(tmpDir, "other");
    fs.mkdirSync(other, { recursive: true });
    expect(sections.listReusableSections(other).sections).toEqual([]);
  });

  it("deletes a section by id", async () => {
    const sections = await import("../reusableSections");
    const saved = sections.saveReusableSection(projectDir, "A", "<p>A</p>");
    const id = saved.sections[0]!.id;

    const deleted = sections.deleteReusableSection(projectDir, id);
    expect(deleted.ok).toBe(true);
    expect(sections.listReusableSections(projectDir).sections).toEqual([]);
  });

  it("migrates the legacy global store into the project on first read", async () => {
    const sections = await import("../reusableSections");
    fs.mkdirSync(userDataDir, { recursive: true });
    const legacy = path.join(userDataDir, "reusable-sections.json");
    fs.writeFileSync(
      legacy,
      JSON.stringify([
        {
          id: "section-legacy",
          label: "Legacy Hero",
          html: "<section>Old</section>",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
      "utf8",
    );

    const listed = sections.listReusableSections(projectDir);
    expect(listed.sections.map((s) => s.label)).toEqual(["Legacy Hero"]);

    const projectFile = path.join(
      projectDir,
      ".zephus",
      "templates",
      "reusable-sections.json",
    );
    expect(fs.existsSync(projectFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(projectFile, "utf8"))[0].label).toBe(
      "Legacy Hero",
    );
  });

  it("backs up corrupt storage before writing a replacement file", async () => {
    const sections = await import("../reusableSections");
    const dir = path.join(projectDir, ".zephus", "templates");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "reusable-sections.json");
    fs.writeFileSync(file, "{", "utf8");

    expect(sections.listReusableSections(projectDir).sections).toEqual([]);
    expect(
      fs
        .readdirSync(dir)
        .some((name) => name.startsWith("reusable-sections.json.corrupt-")),
    ).toBe(true);

    const saved = sections.saveReusableSection(
      projectDir,
      "Hero",
      "<section>Hi</section>",
    );
    expect(saved.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual([
      expect.objectContaining({ label: "Hero", html: "<section>Hi</section>" }),
    ]);
  });
});
