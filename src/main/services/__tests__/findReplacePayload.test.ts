import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { searchPages, replaceAllInPages } from "../findReplace";

let projectDir: string;

function makeProject(): void {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-fr-"));
  fs.mkdirSync(path.join(projectDir, "src", "pages"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "src", "layouts"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, ".zephus", "pages"), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({
      scripts: { dev: "astro dev", build: "astro build" },
      dependencies: { astro: "^6.0.0" },
    }),
  );
  fs.writeFileSync(
    path.join(projectDir, "astro.config.mjs"),
    "export default {};",
  );
  fs.writeFileSync(
    path.join(projectDir, "src", "layouts", "BaseLayout.astro"),
    `---
const { title = 'Site' } = Astro.props;
---
<html><body><slot /></body></html>`,
  );
  fs.writeFileSync(
    path.join(projectDir, "src", "pages", "index.astro"),
    "---\nimport BaseLayout from '../layouts/BaseLayout.astro';\n---\n<BaseLayout title=\"Home\"></BaseLayout>\n",
  );
  fs.writeFileSync(
    path.join(projectDir, ".zephus", "pages", "index.json"),
    JSON.stringify({
      schemaVersion: 1,
      page: "src/pages/index.astro",
      route: "/",
      slug: "index",
      title: "Home",
      navLabel: "Home",
      navVisible: true,
      isHome: true,
      sections: [
        {
          id: "s1",
          type: "section",
          label: "Main",
          props: { wrapper: "none", cls: "" },
          children: [
            { id: "b1", type: "text", props: { text: "Hello world", cls: "" } },
          ],
        },
      ],
    }),
    "utf8",
  );
}

describe("findReplace payload validation", () => {
  beforeEach(() => {
    makeProject();
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("rejects an empty search", () => {
    const result = searchPages(projectDir, "src/pages", "   ");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Enter text to find.");
  });

  it("rejects oversized search queries", () => {
    const result = searchPages(projectDir, "src/pages", "a".repeat(501));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("too long");
  });

  it("rejects oversized replacements", () => {
    const result = replaceAllInPages(
      projectDir,
      "src/pages",
      "Hello",
      "x".repeat(5001),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("too long");
  });

  it("searches normally within limits", () => {
    const result = searchPages(projectDir, "src/pages", "Hello");
    expect(result.ok).toBe(true);
    expect(result.totalMatches).toBe(1);
  });
});
