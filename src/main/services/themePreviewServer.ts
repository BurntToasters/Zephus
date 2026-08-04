import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { AddressInfo } from "net";
import { ThemePreviewServerResult } from "../types";

const HOST = "127.0.0.1";
const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

interface RunningThemePreviewServer {
  baseUrl: string;
  rootDir: string;
  server: http.Server;
}

let current: RunningThemePreviewServer | null = null;
// Serializes concurrent ensure calls: two callers must not both listen(0) —
// the loser would leak an open port and its `current` assignment would be
// overwritten.
let pendingEnsure: Promise<ThemePreviewServerResult> | null = null;

export function getThemePreviewDistDir(): string {
  return path.join(__dirname, "..", "..", "..", "template-previews", "dist");
}

function safeRequestSegments(requestPath: string): string[] | null {
  const pathname = requestPath.split(/[?#]/, 1)[0] || "/";
  if (!pathname.startsWith("/")) return null;

  const segments = pathname.split("/").filter(Boolean);
  const safe: string[] = [];
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("\0") ||
      decoded.includes(path.sep)
    ) {
      return null;
    }
    safe.push(decoded);
  }
  return safe;
}

export function resolveThemePreviewFile(
  rootDir: string,
  requestPath: string,
): string | null {
  const root = path.resolve(rootDir);
  const segments = safeRequestSegments(requestPath);
  if (!segments) return null;

  const requested = path.resolve(root, ...segments);
  if (requested !== root && !requested.startsWith(root + path.sep)) {
    return null;
  }

  const ext = path.extname(requested);
  const candidates = ext
    ? [requested]
    : [path.join(requested, "index.html"), `${requested}.html`];

  for (const candidate of candidates) {
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      // Symlink-aware containment: an in-tree symlink must not let the server
      // serve files from outside the preview bundle.
      const realCandidate = fs.realpathSync.native(candidate);
      const realRoot = fs.realpathSync.native(root);
      if (
        realCandidate !== realRoot &&
        !realCandidate.startsWith(realRoot + path.sep)
      ) {
        return null;
      }
      return candidate;
    } catch {
      /* keep trying */
    }
  }

  return null;
}

export function createThemePreviewRequestHandler(
  rootDir: string,
): http.RequestListener {
  const root = path.resolve(rootDir);

  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }

    const filePath = resolveThemePreviewFile(root, req.url ?? "/");
    if (!filePath) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const type =
      MIME_TYPES[path.extname(filePath).toLowerCase()] ??
      "application/octet-stream";

    if (req.method === "HEAD") {
      res.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Type": type,
      });
      res.end();
      return;
    }

    // Open the file before writing a 200: if the file vanished or became
    // unreadable between resolution and read, the client gets a 500 instead
    // of a 200 with an empty body.
    const stream = fs.createReadStream(filePath);
    stream.once("error", () => {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Could not read preview asset");
    });
    stream.once("open", () => {
      res.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Type": type,
      });
      stream.pipe(res);
    });
  };
}

export function ensureThemePreviewServer(
  rootDir = getThemePreviewDistDir(),
): Promise<ThemePreviewServerResult> {
  const resolvedRoot = path.resolve(rootDir);
  if (current && current.rootDir === resolvedRoot) {
    return Promise.resolve({ ok: true, baseUrl: current.baseUrl });
  }

  if (!fs.existsSync(resolvedRoot)) {
    return Promise.resolve({
      ok: false,
      baseUrl: null,
      error: `Theme preview bundle missing at ${resolvedRoot}. Run npm run generate:theme-previews.`,
    });
  }

  if (current) stopThemePreviewServer();

  if (pendingEnsure) return pendingEnsure;

  pendingEnsure = new Promise<ThemePreviewServerResult>((resolve) => {
    const server = http.createServer(
      createThemePreviewRequestHandler(resolvedRoot),
    );

    server.once("error", (error) => {
      // Close the errored server so it cannot linger as a dead listener.
      try {
        server.close();
      } catch {
        /* already closed */
      }
      if (current?.server === server) current = null;
      resolve({
        ok: false,
        baseUrl: null,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    server.listen(0, HOST, () => {
      const address = server.address() as AddressInfo | null;
      if (!address) {
        server.close();
        resolve({
          ok: false,
          baseUrl: null,
          error: "Theme preview server did not expose an address.",
        });
        return;
      }

      const baseUrl = `http://${HOST}:${address.port}/`;
      current = { baseUrl, rootDir: resolvedRoot, server };
      resolve({ ok: true, baseUrl });
    });
  }).finally(() => {
    pendingEnsure = null;
  });

  return pendingEnsure;
}

export function stopThemePreviewServer(): void {
  if (!current) return;
  const { server } = current;
  current = null;
  server.close();
  server.closeAllConnections();
}
