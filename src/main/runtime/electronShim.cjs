const { EventEmitter } = require("node:events");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const isTauriHost = process.env.ZEPHUS_HOST === "tauri";
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

function allowLoopbackCors(req, res) {
  const origin = req.headers.origin;
  if (
    typeof origin === "string" &&
    /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
}

function startBackendServer() {
  if (backendServerStarted) return;
  backendServerStarted = true;
  const server = http.createServer(async (req, res) => {
    allowLoopbackCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/smoke-project") {
      const projectPath = global.__zephusSmokeProjectPath || null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: projectPath }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/events") {
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
    if (req.method === "POST" && url.pathname === "/invoke") {
      let body = "";
      for await (const chunk of req) body += chunk;
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
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, result }));
      } catch (error) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    process.stdout.write(`ZEPHUS_BACKEND_URL=http://127.0.0.1:${port}\n`);
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
