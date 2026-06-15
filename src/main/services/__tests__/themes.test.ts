import { describe, expect, it } from "vitest";
import { buildPreviewTheme, listThemes, themePreviewPath } from "../../themes";

describe("theme previews", () => {
  it("exposes preview metadata for every bundled theme", () => {
    const themes = listThemes();
    expect(themes.length).toBeGreaterThan(0);

    for (const theme of themes) {
      expect(theme.previewPath).toBe(themePreviewPath(theme.id));
    }

    expect(new Set(themes.map((theme) => theme.id)).size).toBe(themes.length);
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
