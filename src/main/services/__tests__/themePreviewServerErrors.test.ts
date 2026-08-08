import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";

const listenFailsWith: { error: Error | null; address: unknown } = {
  error: null,
  address: null,
};

vi.mock("http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("http")>();
  return {
    ...actual,
    createServer: (handler: never) => {
      const server = actual.createServer(handler);
      const originalListen = server.listen.bind(server);
      (server as unknown as { listen: typeof server.listen }).listen = (
        ...args: unknown[]
      ) => {
        if (listenFailsWith.error) {
          process.nextTick(() =>
            server.emit("error", listenFailsWith.error as Error),
          );
          return server;
        }
        if (listenFailsWith.address === null) {
          // Simulate listen succeeding but exposing no address.
          const cb = args.find((a) => typeof a === "function");
          process.nextTick(() => (cb as () => void)());
          return server;
        }
        // Expose no address to the listen callback.
        const cb = args.find((a) => typeof a === "function");
        (server as unknown as { address: () => unknown }).address = () => null;
        process.nextTick(() => (cb as () => void)());
        return server;
      };
      return server;
    },
  };
});

const previewRoots: string[] = [];

function makePreviewRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-preview2-"));
  previewRoots.push(root);
  fs.mkdirSync(path.join(root, "theme", "project"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "theme", "project", "index.html"),
    "<h1>home</h1>",
    "utf8",
  );
  return root;
}

afterEach(() => {
  listenFailsWith.error = null;
  listenFailsWith.address = null;
  vi.resetModules();
  while (previewRoots.length > 0) {
    const root = previewRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("themePreviewServer error paths", () => {
  it("resolves with an error when the server fails to bind", async () => {
    const { ensureThemePreviewServer, stopThemePreviewServer } =
      await import("../themePreviewServer");
    listenFailsWith.error = new Error("EADDRINUSE");
    const result = await ensureThemePreviewServer(makePreviewRoot());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("EADDRINUSE");
    stopThemePreviewServer();
  });

  it("resolves with an error when the listen exposes no address", async () => {
    const { ensureThemePreviewServer, stopThemePreviewServer } =
      await import("../themePreviewServer");
    listenFailsWith.address = "no-address";
    const result = await ensureThemePreviewServer(makePreviewRoot());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("did not expose an address");
    stopThemePreviewServer();
  });
});
