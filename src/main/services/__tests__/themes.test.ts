import { describe, expect, it } from "vitest";
import {
  buildPreviewTheme,
  buildTheme,
  listThemes,
  themePreviewPath,
} from "../../themes";

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

  it("rewrites root-absolute links for preview builds", () => {
    const theme = buildPreviewTheme("project", "preview-project");
    expect(theme).not.toBeNull();
    const files = theme!.files;

    expect(files["astro.config.mjs"]).toContain("base: '/theme/project'");
    expect(files["src/layouts/BaseLayout.astro"]).toContain(
      'href="/theme/project/"',
    );
    expect(files["src/layouts/BaseLayout.astro"]).toContain(
      'href="/theme/project/about"',
    );
    expect(files["src/pages/index.astro"]).toContain(
      'href="/theme/project/contact"',
    );
    expect(files["public/styles/global.css"]).toContain("--accent");
  });
});
