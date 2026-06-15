import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureThemePreviewServer,
  resolveThemePreviewFile,
  stopThemePreviewServer,
} from "../themePreviewServer";

const previewRoots: string[] = [];

function makePreviewRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-preview-"));
  previewRoots.push(root);
  fs.mkdirSync(path.join(root, "theme", "project", "about"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, "theme", "project", "index.html"),
    "<h1>home</h1>",
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "theme", "project", "about", "index.html"),
    "<h1>about</h1>",
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "theme", "project", "style.css"),
    "body { color: red; }",
    "utf8",
  );
  return root;
}

afterEach(() => {
  stopThemePreviewServer();
  while (previewRoots.length > 0) {
    const root = previewRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("themePreviewServer", () => {
  it("resolves nested index routes under preview root", () => {
    const root = makePreviewRoot();
    expect(resolveThemePreviewFile(root, "/theme/project/about/")).toBe(
      path.join(root, "theme", "project", "about", "index.html"),
    );
  });

  it("rejects path traversal", () => {
    const root = makePreviewRoot();
    expect(
      resolveThemePreviewFile(root, "/theme/%2e%2e/secret.txt"),
    ).toBeNull();
    expect(resolveThemePreviewFile(root, "/../secret.txt")).toBeNull();
  });

  it("serves preview files over localhost", async () => {
    const root = makePreviewRoot();
    const result = await ensureThemePreviewServer(root);
    expect(result.ok).toBe(true);
    expect(result.baseUrl).toBeTruthy();

    const response = await fetch(`${result.baseUrl}theme/project/about/`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("about");
  });
});
