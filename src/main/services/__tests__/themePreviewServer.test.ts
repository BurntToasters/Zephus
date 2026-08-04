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

  it("refuses to serve files behind an in-tree symlink", async () => {
    const root = makePreviewRoot();
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "zephus-preview-out-"),
    );
    try {
      fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
      fs.symlinkSync(
        outside,
        path.join(root, "theme", "project", "leak"),
        "dir",
      );
      expect(
        resolveThemePreviewFile(root, "/theme/project/leak/secret.txt"),
      ).toBeNull();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("serves files behind a symlink inside the root", async () => {
    const root = makePreviewRoot();
    fs.symlinkSync(
      path.join(root, "theme", "project"),
      path.join(root, "theme", "alias"),
      "dir",
    );
    // Allowed (realpath stays inside the root); the requested path is
    // returned and the file read follows the symlink.
    expect(resolveThemePreviewFile(root, "/theme/alias/index.html")).toBe(
      path.join(root, "theme", "alias", "index.html"),
    );
  });

  it("answers 405 for non-GET/HEAD methods", async () => {
    const root = makePreviewRoot();
    const result = await ensureThemePreviewServer(root);
    const response = await fetch(`${result.baseUrl}theme/project/`, {
      method: "POST",
    });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  it("answers 404 for missing files", async () => {
    const root = makePreviewRoot();
    const result = await ensureThemePreviewServer(root);
    const response = await fetch(`${result.baseUrl}theme/project/nope.html`);
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not found");
  });

  it("serves HEAD requests without a body", async () => {
    const root = makePreviewRoot();
    const result = await ensureThemePreviewServer(root);
    const response = await fetch(`${result.baseUrl}theme/project/`, {
      method: "HEAD",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    await expect(response.text()).resolves.toBe("");
  });

  it("sets the mime type from the extension", async () => {
    const root = makePreviewRoot();
    const result = await ensureThemePreviewServer(root);
    const response = await fetch(`${result.baseUrl}theme/project/style.css`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
  });

  it("answers 500 when the resolved file cannot be read", async () => {
    const root = makePreviewRoot();
    const result = await ensureThemePreviewServer(root);
    const file = path.join(root, "theme", "project", "index.html");
    const mode = fs.statSync(file).mode;
    try {
      fs.chmodSync(file, 0o000);
      const response = await fetch(`${result.baseUrl}theme/project/`);
      expect(response.status).toBe(500);
      await expect(response.text()).resolves.toBe(
        "Could not read preview asset",
      );
    } finally {
      fs.chmodSync(file, mode);
    }
  });

  it("reuses the running server for the same root", async () => {
    const root = makePreviewRoot();
    const first = await ensureThemePreviewServer(root);
    const second = await ensureThemePreviewServer(root);
    expect(second.baseUrl).toBe(first.baseUrl);
  });

  it("reports a missing preview bundle", async () => {
    const result = await ensureThemePreviewServer(
      path.join(os.tmpdir(), "zephus-no-such-preview-", String(Date.now())),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("preview bundle missing at");
  });
});
