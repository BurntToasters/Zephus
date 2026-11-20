const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const isTauriHost = process.env.ZEPHUS_HOST === "tauri";
// A page save is JSON, not a file upload. 32 MiB is far above a real page
// and stops a loopback client from pinning the editor on one request.
const MAX_INVOKE_BODY_BYTES = 33554432;
const windows = [];
let nextWebContentsId = 1;
let primaryWebContentsId = null;
let backendServerStarted = false;
const ipcHandlers = new Map();
const sseClients = new Set();

function broadcastEvent(channel, payload) {
  const data = `data: ${JSON.stringify({ channel, payload })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch {
      sseClients.delete(res);
    }
  }
}

function ensureUserData() {
  const base =
    process.platform === "win32"
      ? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support")
        : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const userData = path.join(base, "Zephus");
  fs.mkdirSync(userData, { recursive: true });
  return userData;
}

let cachedVersion = null;
function readPackageVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const here = __dirname;
    const pkgPath = path.join(here, "..", "..", "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    cachedVersion = pkg.version || "1.0.0";
  } catch {
    cachedVersion = "1.0.0";
  }
  return cachedVersion;
}

class WebContents extends EventEmitter {
  constructor(win) {
    super();
    this.id = nextWebContentsId++;
    this.window = win;
    this._beforeInput = null;
  }

  isDestroyed() {
    return this.window.destroyed;
  }

  send(channel, payload) {
    broadcastEvent(channel, payload);
  }

  on(event, listener) {
    if (event === "before-input-event") {
      this._beforeInput = listener;
    }
    return super.on(event, listener);
  }

  openDevTools() {}

  executeJavaScript() {
    return Promise.resolve(null);
  }

  reload() {}
}

class BrowserWindow extends EventEmitter {
  static getAllWindows() {
    return windows.filter((w) => !w.destroyed);
  }

  constructor(options = {}) {
    super();
    this.destroyed = false;
    this.options = options;
    this.webContents = new WebContents(this);
    this.visible = options.show !== false;
    this.minimized = false;
    this.maximized = false;
    this._bounds = {
      width: options.width ?? 800,
      height: options.height ?? 600,
      x: options.x,
      y: options.y,
    };
    windows.push(this);
    queueMicrotask(() => this.emit("ready-to-show"));
  }

  loadFile(file) {
    if (String(file).includes("index.html")) {
      primaryWebContentsId = this.webContents.id;
    }
    return Promise.resolve();
  }

  loadURL() {
    return Promise.resolve();
  }

  isDestroyed() {
    return this.destroyed;
  }

  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("closed");
    const idx = windows.indexOf(this);
    if (idx >= 0) windows.splice(idx, 1);
  }

  show() {
    this.visible = true;
  }

  focus() {}

  minimize() {
    this.minimized = true;
  }

  restore() {
    this.minimized = false;
  }

  isMinimized() {
    return this.minimized;
  }

  isVisible() {
    return this.visible;
  }

  maximize() {
    this.maximized = true;
  }

  isMaximized() {
    return this.maximized;
  }

  getNormalBounds() {
    return { ...this._bounds };
  }
}

const appEmitter = new EventEmitter();
const app = {
  isPackaged: process.env.ZEPHUS_PACKAGED === "1",
  defaultApp: false,
  whenReady() {
    return Promise.resolve();
  },
  requestSingleInstanceLock() {
    return true;
  },
  getPath(name) {
    const userData = ensureUserData();
    if (name === "userData") return userData;
    if (name === "temp") return os.tmpdir();
    if (name === "appData") return path.dirname(userData);
    return userData;
  },
  getVersion() {
    return readPackageVersion();
  },
  getName() {
    return "Zephus";
  },
  quit() {
    if (!isTauriHost) process.exit(0);
  },
  exit(code) {
    process.exit(code ?? 0);
  },
  on(event, listener) {
    appEmitter.on(event, listener);
    return app;
  },
};

function makeSession() {
  return {
    setPermissionRequestHandler(handler) {
      this._permissionRequestHandler = handler;
    },
    setPermissionCheckHandler(handler) {
      this._permissionCheckHandler = handler;
    },
    webRequest: {
      onHeadersReceived(first, second) {
        const listener = typeof first === "function" ? first : second;
        if (typeof listener !== "function") return;
        listener(
          { url: "file://", responseHeaders: {} },
          (response) => response,
        );
      },
    },
  };
}

const session = {
  defaultSession: makeSession(),
};

const dialog = {
  async showOpenDialog(_win, maybeOptions) {
    return { canceled: true, filePaths: [] };
  },
  async showMessageBox() {
    return { response: 1, checkboxChecked: false };
  },
  showErrorBox(title, content) {
    console.error(`[dialog] ${title}: ${content}`);
  },
};

const shell = {
  async openPath(target) {
    console.error(`[shell] openPath ${target}`);
    return "";
  },
  async openExternal(url) {
    console.error(`[shell] openExternal ${url}`);
  },
};

const ipcMain = {
  handle(channel, handler) {
    ipcHandlers.set(channel, handler);
  },
  on(channel, listener) {
    appEmitter.on(`ipc:${channel}`, listener);
  },
};

function createIpcEvent() {
  const senderId = primaryWebContentsId ?? 1;
  const win = windows.find(
    (candidate) =>
      candidate.webContents && candidate.webContents.id === senderId,
  );
  const sender = win
    ? win.webContents
    : {
        id: senderId,
        isDestroyed: () => false,
        send(channel, payload) {
          broadcastEvent(channel, payload);
        },
      };
  return {
    sender,
  };
}

/**
 * Origins that may read backend responses. The packaged editor is
 * tauri.localhost (or tauri://localhost). The dev editor is Vite on port
 * 5173. A site preview is also loopback, but on another port, and must not
 * be able to read invoke results.
 */
function editorCorsOrigin(origin) {
  if (typeof origin !== "string" || origin.length > 200) return "";
  if (origin === "tauri://localhost") return origin;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return "";
  }
  if (url.username || url.password) return "";
  if (url.pathname !== "/" || url.search || url.hash) return "";
  if (url.origin !== origin) return "";
  const host = url.hostname;
  if (
    host === "tauri.localhost" &&
    (url.protocol === "http:" || url.protocol === "https:")
  ) {
    return origin;
  }
  if (
    (url.protocol === "http:" || url.protocol === "https:") &&
    (host === "localhost" || host === "127.0.0.1" || host === "::1") &&
    url.port === "5173"
  ) {
    return origin;
  }
  return "";
}

function contentLength(req) {
  const raw = req.headers["content-length"];
  if (raw === undefined) return null;
  if (Array.isArray(raw) || !/^\d+$/.test(raw)) return Number.NaN;
  const declared = Number(raw);
  return Number.isSafeInteger(declared) ? declared : Number.NaN;
}

function sendJson(res, status, payload, extraHeaders) {
  if (!res || res.writableEnded) return;
  let body;
  try {
    body = JSON.stringify(payload);
  } catch {
    body = JSON.stringify({
      ok: false,
      error: "Backend response could not be encoded.",
    });
  }
  try {
    // The editor can close, or the webview can drop the request, while a
    // save is still running. writeHead on that dead response throws and
    // Node treats the rejection as fatal for this process.
    if (res.destroyed || res.closed || res.socket?.destroyed) return;
    if (!res.headersSent) {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...extraHeaders,
      });
    }
    res.end(body);
  } catch {
    try {
      res.destroy();
    } catch {
      /* already closed */
    }
  }
}

function rejectInvoke(req, res, status, error) {
  sendJson(res, status, { ok: false, error }, { Connection: "close" });
  // Drop the rest of the upload without a reset, so the status body is delivered.
  req.resume();
}

function allowEditorCors(req, res) {
  const origin = editorCorsOrigin(req.headers.origin);
  if (!origin) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function startBackendServer() {
  if (backendServerStarted) return;
  backendServerStarted = true;
  // The preview webview is a loopback origin and can reach 127.0.0.1. The
  // secret path is known only to the editor, which receives the full URL
  // from the shell. Requests without it never reach an IPC handler.
  const backendToken = crypto.randomBytes(32).toString("hex");
  const tokenBuf = Buffer.from(backendToken);
  const routePath = (pathname) => {
    const slash = pathname.indexOf("/", 1);
    const presented =
      slash === -1 ? pathname.slice(1) : pathname.slice(1, slash);
    const presentedBuf = Buffer.from(presented);
    if (presentedBuf.length !== tokenBuf.length) return null;
    if (!crypto.timingSafeEqual(presentedBuf, tokenBuf)) return null;
    if (slash === -1) return "/";
    return pathname.slice(slash) || "/";
  };
  async function handleBackendRequest(req, res) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = routePath(url.pathname);
    if (!pathname) {
      res.writeHead(404);
      res.end();
      // A wrong secret must not keep a multi-megabyte body buffered.
      req.destroy();
      return;
    }
    allowEditorCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "GET" && pathname === "/smoke-project") {
      const projectPath = global.__zephusSmokeProjectPath || null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: projectPath }));
      return;
    }
    if (req.method === "GET" && pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("\n");
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }
    if (req.method === "POST" && pathname === "/invoke") {
      const declared = contentLength(req);
      if (Number.isNaN(declared)) {
        rejectInvoke(req, res, 400, "Invalid Content-Length.");
        return;
      }
      if (declared !== null && declared > MAX_INVOKE_BODY_BYTES) {
        rejectInvoke(req, res, 413, "Request body is too large.");
        return;
      }
      const chunks = [];
      let received = 0;
      try {
        for await (const chunk of req) {
          received += chunk.length;
          if (received > MAX_INVOKE_BODY_BYTES) {
            rejectInvoke(req, res, 413, "Request body is too large.");
            return;
          }
          chunks.push(chunk);
        }
      } catch {
        return;
      }
      const body = Buffer.concat(chunks).toString("utf8");
      let parsed;
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
        return;
      }
      const channel = parsed.channel;
      const args = Array.isArray(parsed.args) ? parsed.args : [];
      const handler = ipcHandlers.get(channel);
      if (!handler) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ ok: false, error: `Unknown channel: ${channel}` }),
        );
        return;
      }
      try {
        const event = createIpcEvent();
        const result = await handler(event, ...args);
        sendJson(res, 200, { ok: true, result });
      } catch (error) {
        sendJson(res, 200, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    res.writeHead(404);
    res.end();
  }

  const server = http.createServer((req, res) => {
    handleBackendRequest(req, res).catch(() => {
      sendJson(res, 500, { ok: false, error: "Backend request failed." });
    });
  });
  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    process.stdout.write(
      `ZEPHUS_BACKEND_URL=http://127.0.0.1:${port}/${backendToken}\n`,
    );
  });
}

if (isTauriHost) {
  Promise.resolve().then(() => {
    setImmediate(() => {
      setImmediate(() => {
        startBackendServer();
      });
    });
  });
}

module.exports = {
  app,
  BrowserWindow,
  dialog,
  shell,
  session,
  ipcMain,
};
