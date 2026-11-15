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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-reusable-"));
  userDataDir = path.join(tmpDir, "userdata");
  projectDir = path.join(tmpDir, "project");
  fs.mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("reusableSections", () => {
  it("saves, lists (sorted), updates, and deletes sections", async () => {
    const sections = await import("../reusableSections");
    const first = sections.saveReusableSection(
      projectDir,
      "Hero",
      "<h1>H</h1>",
    );
    expect(first.ok).toBe(true);
    sections.saveReusableSection(projectDir, "About", "<p>A</p>");
    // Update overwrites by label.
    sections.saveReusableSection(projectDir, "Hero", "<h1>H2</h1>");

    const listed = sections.listReusableSections(projectDir);
    expect(listed.ok).toBe(true);
    expect(listed.sections.map((s) => s.label)).toEqual(["About", "Hero"]);
    const hero = listed.sections.find((s) => s.label === "Hero");
    expect(hero?.html).toBe("<h1>H2</h1>");
    expect(hero?.id).toMatch(/^section-/);

    const deleted = sections.deleteReusableSection(projectDir, hero!.id);
    expect(deleted.ok).toBe(true);
    const after = sections.listReusableSections(projectDir);
    expect(after.sections.map((s) => s.label)).toEqual(["About"]);
  });

  it("rejects empty labels or html", async () => {
    const sections = await import("../reusableSections");
    const result = sections.saveReusableSection(projectDir, "  ", "<p>x</p>");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Label and HTML");
    expect(sections.listReusableSections(projectDir).sections).toHaveLength(0);
  });

  it("migrates a legacy userData store on first use", async () => {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(userDataDir, "reusable-sections.json"),
      JSON.stringify([
        {
          id: "section-legacy",
          label: "Legacy",
          html: "<p>old</p>",
          updatedAt: "2026-01-01",
        },
      ]),
    );
    const sections = await import("../reusableSections");
    const listed = sections.listReusableSections(projectDir);
    expect(listed.sections).toHaveLength(1);
    expect(listed.sections[0]!.label).toBe("Legacy");
    // Migrated into the project store.
    expect(
      fs.existsSync(
        path.join(projectDir, ".zephus", "templates", "reusable-sections.json"),
      ),
    ).toBe(true);
  });

  it("ignores malformed store entries", async () => {
    fs.mkdirSync(path.join(projectDir, ".zephus", "templates"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(projectDir, ".zephus", "templates", "reusable-sections.json"),
      JSON.stringify([
        {
          id: "section-ok",
          label: "Ok",
          html: "<p>fine</p>",
          updatedAt: "2026-01-01",
        },
        { label: "" },
        "not-an-object",
      ]),
    );
    const sections = await import("../reusableSections");
    const listed = sections.listReusableSections(projectDir);
    expect(listed.sections).toHaveLength(1);
    expect(listed.sections[0]!.label).toBe("Ok");
  });

  it("returns an empty list when the store is not an array", async () => {
    fs.mkdirSync(path.join(projectDir, ".zephus", "templates"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(projectDir, ".zephus", "templates", "reusable-sections.json"),
      '{"not": "an array"}',
    );
    const sections = await import("../reusableSections");
    expect(sections.listReusableSections(projectDir).sections).toHaveLength(0);
  });

  it.skipIf(process.platform === "win32")(
    "blocks symlinked templates directory escaping project root",
    async () => {
      const outsideDir = path.join(tmpDir, "outside-templates");
      fs.mkdirSync(outsideDir, { recursive: true });
      const outsideFile = path.join(outsideDir, "reusable-sections.json");
      const sentinel = JSON.stringify([
        {
          id: "ext-1",
          label: "External",
          html: "<p>secret</p>",
          updatedAt: "2026-01-01",
        },
      ]);
      fs.writeFileSync(outsideFile, sentinel, "utf8");
      fs.mkdirSync(path.join(projectDir, ".zephus"), { recursive: true });
      fs.symlinkSync(outsideDir, path.join(projectDir, ".zephus", "templates"));

      const sections = await import("../reusableSections");
      const listed = sections.listReusableSections(projectDir);
      expect(listed.ok).toBe(false);
      expect(listed.sections).toHaveLength(0);

      const saved = sections.saveReusableSection(
        projectDir,
        "Injected",
        "<p>bad</p>",
      );
      expect(saved.ok).toBe(false);

      const deleted = sections.deleteReusableSection(projectDir, "ext-1");
      expect(deleted.ok).toBe(false);
      expect(fs.readFileSync(outsideFile, "utf8")).toBe(sentinel);
    },
  );

  it.skipIf(process.platform === "win32")(
    "blocks symlinked reusable-sections.json escaping project root",
    async () => {
      const outsideFile = path.join(tmpDir, "outside-store.json");
      const sentinel = JSON.stringify([
        {
          id: "ext-2",
          label: "Outside File",
          html: "<p>outside</p>",
          updatedAt: "2026-01-01",
        },
      ]);
      fs.writeFileSync(outsideFile, sentinel, "utf8");
      fs.mkdirSync(path.join(projectDir, ".zephus", "templates"), {
        recursive: true,
      });
      fs.symlinkSync(
        outsideFile,
        path.join(projectDir, ".zephus", "templates", "reusable-sections.json"),
      );

      const sections = await import("../reusableSections");
      expect(sections.listReusableSections(projectDir).ok).toBe(false);
      expect(
        sections.saveReusableSection(projectDir, "Hijack", "<p>pwn</p>").ok,
      ).toBe(false);
      expect(sections.deleteReusableSection(projectDir, "ext-2").ok).toBe(
        false,
      );
      expect(fs.readFileSync(outsideFile, "utf8")).toBe(sentinel);
    },
  );
});
