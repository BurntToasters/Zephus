import { describe, expect, it } from "vitest";
import { buildTheme, listThemes, themePreviewPath } from "../../themes";

describe("theme previews", () => {
  it("exposes preview metadata for every bundled theme", () => {
    const themes = listThemes();
    expect(themes.length).toBeGreaterThan(0);

    for (const theme of themes) {
      expect(theme.previewPath).toBe(themePreviewPath(theme.id));
    }

    expect(new Set(themes.map((theme) => theme.id)).size).toBe(themes.length);
  });

  it("scaffolds a .gitignore that keeps .zephus committed", () => {
    for (const meta of listThemes()) {
      const theme = buildTheme(meta.id, "demo-site");
      expect(theme).not.toBeNull();
      const gitignore = theme!.files[".gitignore"];
      expect(gitignore).toBeTruthy();
      // Standard Astro ignores present.
      expect(gitignore).toContain("node_modules/");
      expect(gitignore).toContain("dist/");
      // .zephus must NOT be ignored (it is the project save state).
      expect(/^\.zephus\/?$/m.test(gitignore!)).toBe(false);
      expect(gitignore).toContain(".zephus");
    }
  });

  it("ships valid Zephus schema sidecars for every theme", () => {
    for (const meta of listThemes()) {
      const theme = buildTheme(meta.id, "demo-site");
      expect(theme).not.toBeNull();
      const files = theme!.files;

      // Site document sidecar.
      const siteRaw = files[".zephus/site.json"];
      expect(siteRaw).toBeTruthy();
      const site = JSON.parse(siteRaw!);
      expect(site.schemaVersion).toBe(1);
      expect(site.shell.layoutMode).toBe("managed");
      expect(site.shell.navItems.length).toBeGreaterThan(0);
      expect(typeof site.design.accent).toBe("string");

      // At least one page sidecar + a matching stub .astro.
      const indexDoc = JSON.parse(files[".zephus/pages/index.json"]!);
      expect(indexDoc.schemaVersion).toBe(1);
      expect(indexDoc.isHome).toBe(true);
      expect(indexDoc.sections.length).toBeGreaterThan(0);
      expect(indexDoc.sections[0].children.length).toBeGreaterThan(0);
      expect(files["src/pages/index.astro"]).toBeTruthy();
      expect(files["public/styles/global.css"]).toContain("--accent");
    }
  });
});
