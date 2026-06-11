process.env.WS_NO_BUFFER_UTIL = "1";
process.env.WS_NO_UTF_8_VALIDATE = "1";
"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const path = require("node:path");
const require$$1 = require("electron");
const net$1 = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const node_child_process = require("node:child_process");
const node_crypto = require("node:crypto");
const http$2 = require("node:http");
const require$$0$4 = require("events");
const require$$1$1 = require("https");
const require$$2$3 = require("http");
const require$$3 = require("net");
const require$$4 = require("tls");
const require$$0$3 = require("crypto");
const require$$0$2 = require("stream");
const require$$2$2 = require("url");
const require$$0 = require("zlib");
const require$$0$1 = require("buffer");
const require$$2$1 = require("util");
const promises = require("node:fs/promises");
const HEALTH_TIMEOUT_MS = 25e3;
const HEALTH_POLL_MS = 300;
function commonBinDirs(homeDir) {
  return [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    path.join(homeDir, ".bun", "bin"),
    path.join(homeDir, ".local", "bin")
  ];
}
function prependDirs(base, dirs) {
  const existing = base.split(":").filter(Boolean);
  const have = new Set(existing);
  return [...dirs.filter((d) => !have.has(d)), ...existing].join(":");
}
const PATH_SENTINEL = "__MC_LOGIN_PATH__";
function resolveLoginPath(opts) {
  const currentPath = opts?.currentPath ?? process.env.PATH ?? "";
  const platform = process.platform;
  const homeDir = os.homedir();
  if (platform === "win32") return currentPath;
  const dirs = commonBinDirs(homeDir);
  const shell = process.env.SHELL ?? "/bin/zsh";
  const exec = (cmd, args, options) => node_child_process.execFileSync(cmd, args, { ...options, stdio: ["ignore", "pipe", "ignore"] }).toString();
  try {
    const script = `printf '%s' '${PATH_SENTINEL}'; printf '%s' "$PATH"; printf '%s' '${PATH_SENTINEL}'`;
    const out = exec(shell, ["-ilc", script], { timeout: 5e3, encoding: "utf8" });
    const start = out.indexOf(PATH_SENTINEL);
    const end = out.indexOf(PATH_SENTINEL, start + PATH_SENTINEL.length);
    if (start !== -1 && end !== -1) {
      const resolved = out.slice(start + PATH_SENTINEL.length, end).trim();
      if (resolved.includes("/")) return prependDirs(resolved, dirs);
    }
  } catch {
  }
  return prependDirs(currentPath, dirs);
}
let cachedLoginPath = null;
function augmentedPath() {
  if (cachedLoginPath == null) cachedLoginPath = resolveLoginPath();
  return cachedLoginPath;
}
const INJECTED_SECRET_KEYS = ["XAI_API_KEY"];
const INJECTED_FLAG_KEYS = [
  "MERMAID_WORKER_ISOLATION",
  // Pool sizing (the parallelism dial) — injected the same durable way as the
  // isolation flag so a Dock-/login-launched sidecar honors config.json pool
  // overrides instead of silently reverting to the per-type defaults (backend=1)
  // on every app restart. pickEnvFromConfig only injects keys actually present in
  // config.json, so listing all of them here is safe when some are unset.
  "MERMAID_POOL_FRONTEND",
  "MERMAID_POOL_BACKEND",
  "MERMAID_POOL_API",
  "MERMAID_POOL_UI",
  "MERMAID_POOL_LIBRARY",
  "MERMAID_POOL_GENERAL"
];
function pickEnvFromConfig(keys, opts) {
  const currentEnv = process.env;
  const configFile = process.env.MERMAID_CONFIG_PATH ?? path.join(os.homedir(), ".mermaid-collab", "config.json");
  const exists = fs.existsSync;
  const read = (p) => fs.readFileSync(p, "utf8");
  let fileConfig = {};
  try {
    if (exists(configFile)) fileConfig = JSON.parse(read(configFile));
  } catch {
    fileConfig = {};
  }
  const out = {};
  for (const key of keys) {
    const envVal = currentEnv[key];
    if (envVal !== void 0 && envVal !== "") continue;
    const fileVal = fileConfig[key];
    if (typeof fileVal === "string" && fileVal !== "") out[key] = fileVal;
    else if (typeof fileVal === "number" || typeof fileVal === "boolean") out[key] = String(fileVal);
  }
  return out;
}
function resolveSecretsEnv(opts) {
  return pickEnvFromConfig(INJECTED_SECRET_KEYS);
}
function resolveFlagsEnv(opts) {
  return pickEnvFromConfig(INJECTED_FLAG_KEYS);
}
function getFreePort$1() {
  return new Promise((resolve, reject) => {
    const srv = net$1.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}
class ServerSupervisor {
  opts;
  spawnImpl;
  fetchImpl;
  child = null;
  port = null;
  attached = false;
  /** Ring buffer of the most recent stderr lines, surfaced in the health-timeout error. */
  stderrTail = [];
  logStream = null;
  constructor(opts) {
    this.opts = opts;
    this.spawnImpl = opts.spawnImpl ?? node_child_process.spawn;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }
  async start() {
    const port = this.opts.port ?? Number(process.env.MERMAID_PORT ?? 9002);
    try {
      const r = await this.fetchImpl(`http://${this.opts.host}:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) {
        this.port = port;
        this.attached = true;
        return { port, attached: true };
      }
    } catch {
    }
    const env = {
      ...process.env,
      // Inject GUI-held secrets (XAI_API_KEY, …) from ~/.mermaid-collab/config.json
      // for the keys this (often Dock-/login-launched, clean-env) process lacks, so
      // the sidecar and its children resolve them without a launchctl stopgap. The
      // helper skips keys already in process.env, so the explicit-env override wins.
      ...resolveSecretsEnv(),
      // Inject durable feature flags (MERMAID_WORKER_ISOLATION, …) from the same
      // config file, so worker write-isolation survives an app restart without a
      // launchctl setenv / standalone-sidecar stopgap (env still wins if set).
      ...resolveFlagsEnv(),
      // Repair the minimal PATH a GUI/login-item launch inherits, so the sidecar
      // and its children (tmux, the PTY shells, git, claude) can find
      // user-installed tools. Without this, tmux is missing after a restart and
      // session terminals open dead.
      PATH: augmentedPath(),
      PORT: String(port),
      HOST: this.opts.host,
      MERMAID_PROJECT: this.opts.project,
      MERMAID_SESSION: this.opts.session,
      MERMAID_BIND_HOST: this.opts.host
    };
    if (this.opts.cdpPort != null) {
      env.CDP_PORT = String(this.opts.cdpPort);
      env.MC_BROWSER_TARGET = "electron-view";
    }
    if (this.opts.controlUrl) env.MC_DESKTOP_CONTROL_URL = this.opts.controlUrl;
    if (this.opts.controlToken) env.MC_DESKTOP_CONTROL_TOKEN = this.opts.controlToken;
    if (this.opts.token) {
      env.MERMAID_AUTH_TOKEN = this.opts.token;
    }
    let cmd;
    let args;
    if (this.opts.serverBinaryPath) {
      cmd = this.opts.serverBinaryPath;
      args = [];
      if (this.opts.resourcesPath) env.MERMAID_RESOURCES_PATH = this.opts.resourcesPath;
    } else {
      cmd = "bun";
      args = ["run", "src/server.ts"];
    }
    this.child = this.spawnImpl(cmd, args, {
      cwd: this.opts.repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (this.opts.logFilePath) {
      try {
        this.logStream = fs.createWriteStream(this.opts.logFilePath, { flags: "a" });
        this.logStream.write(`
--- sidecar start ${(/* @__PURE__ */ new Date()).toISOString()} (${cmd}) ---
`);
      } catch {
        this.logStream = null;
      }
    }
    this.child.stdout?.on("data", (d) => {
      this.logStream?.write(d);
    });
    this.child.stderr?.on("data", (d) => {
      this.logStream?.write(d);
      for (const line of d.toString().split("\n")) {
        if (!line.trim()) continue;
        this.stderrTail.push(line);
        if (this.stderrTail.length > 40) this.stderrTail.shift();
      }
    });
    this.child.on("exit", (code, signal) => {
      this.stderrTail.push(`[sidecar exited code=${code} signal=${signal}]`);
      if (this.stderrTail.length > 40) this.stderrTail.shift();
    });
    await this.waitForHealth(port);
    this.port = port;
    this.attached = false;
    return { port, attached: false };
  }
  async waitForHealth(port) {
    const url = `http://${this.opts.host}:${port}/api/health`;
    const timeoutMs = this.opts.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
    const pollMs = this.opts.healthPollMs ?? HEALTH_POLL_MS;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const r = await this.fetchImpl(url, { signal: AbortSignal.timeout(1500) });
        if (r.ok) return;
      } catch {
      }
      await new Promise((res) => setTimeout(res, pollMs));
    }
    try {
      this.child?.kill("SIGTERM");
    } catch {
    }
    const tail = this.stderrTail.join("\n").trim();
    const where = this.opts.logFilePath ? ` See ${this.opts.logFilePath}.` : "";
    const err = new Error(
      `The collaboration server did not respond within ${Math.round(timeoutMs / 1e3)}s.${where}`
    );
    if (tail) err.detail = tail;
    if (this.opts.logFilePath) err.logPath = this.opts.logFilePath;
    throw err;
  }
  async stop() {
    if (this.attached) return;
    if (!this.child) return;
    const pid = this.child.pid;
    try {
      this.child.kill("SIGTERM");
    } catch {
    }
    if (process.platform === "win32" && pid != null) {
      try {
        this.spawnImpl("taskkill", ["/pid", String(pid), "/T", "/F"], {});
      } catch {
      }
    }
    this.child = null;
    try {
      this.logStream?.end();
    } catch {
    }
    this.logStream = null;
  }
  async isHealthy() {
    if (this.port == null) return false;
    try {
      const r = await this.fetchImpl(`http://${this.opts.host}:${this.port}/api/health`);
      return r.ok;
    } catch {
      return false;
    }
  }
}
function markerPage(marker) {
  return "data:text/html," + encodeURIComponent(`<title>${marker}</title><body style="font:14px system-ui;padding:1rem">browser pane ready</body>`);
}
class BrowserPaneManager {
  constructor(win, activeBounds) {
    this.win = win;
    this.activeBounds = activeBounds;
  }
  tabs = /* @__PURE__ */ new Map();
  sessionIndex = /* @__PURE__ */ new Map();
  // sessionKey -> tabId
  inFlight = /* @__PURE__ */ new Map();
  activeId = null;
  zeroRect = { x: 0, y: 0, width: 0, height: 0 };
  async ensureSessionTab(session) {
    const existing = this.sessionIndex.get(session);
    if (existing) return { id: existing };
    const flying = this.inFlight.get(session);
    if (flying) return flying;
    const promise = (async () => {
      try {
        const id = node_crypto.randomUUID();
        const marker = `mc-browser-pane:${session}`;
        const view = new require$$1.WebContentsView();
        this.win.contentView.addChildView(view);
        view.setBounds(this.zeroRect);
        await view.webContents.loadURL(markerPage(marker));
        this.tabs.set(id, { id, kind: "session", sessionKey: session, view, marker });
        this.sessionIndex.set(session, id);
        return { id };
      } finally {
        this.inFlight.delete(session);
      }
    })();
    this.inFlight.set(session, promise);
    return promise;
  }
  openUserTab(opts) {
    const id = node_crypto.randomUUID();
    const marker = `mc-browser-pane:user:${id}`;
    const view = new require$$1.WebContentsView();
    this.win.contentView.addChildView(view);
    view.setBounds(this.zeroRect);
    void view.webContents.loadURL(opts.url ?? "about:blank");
    this.tabs.set(id, { id, kind: "user", view, marker });
    return { id };
  }
  closeTab(id) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (!this.win.isDestroyed()) {
      this.win.contentView.removeChildView(tab.view);
    }
    this.tabs.delete(id);
    if (tab.sessionKey) this.sessionIndex.delete(tab.sessionKey);
    if (this.activeId === id) this.activeId = null;
  }
  activateTab(id) {
    if (!this.tabs.has(id)) return;
    this.activeId = id;
    this.win.contentView.addChildView(this.tabs.get(id).view);
    for (const tab of this.tabs.values()) {
      tab.view.setBounds(tab.id === id ? this.activeBounds : this.zeroRect);
    }
  }
  setBounds(rect) {
    this.activeBounds = rect;
    if (this.activeId && this.tabs.has(this.activeId)) {
      this.tabs.get(this.activeId).view.setBounds(rect);
    }
  }
  async navigate(id, url) {
    const tab = this.tabs.get(id);
    if (tab) await tab.view.webContents.loadURL(url);
  }
  goBack(id) {
    const wc = this.tabs.get(id)?.view.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }
  goForward(id) {
    const wc = this.tabs.get(id)?.view.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }
  reload(id) {
    this.tabs.get(id)?.view.webContents.reload();
  }
  // Open/close Chrome DevTools for a tab's web contents. A WebContentsView can't
  // dock DevTools inside the app window, so this opens the standard detached
  // DevTools window for the page the user is inspecting.
  toggleDevTools(id) {
    const wc = this.tabs.get(id)?.view.webContents;
    if (!wc) return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: "detach" });
  }
  listTabs() {
    return Array.from(this.tabs.values()).map((tab) => ({
      id: tab.id,
      kind: tab.kind,
      session: tab.sessionKey,
      marker: tab.marker,
      url: tab.view.webContents.getURL()
    }));
  }
}
class DesktopControl {
  constructor(paneManager2) {
    this.paneManager = paneManager2;
  }
  token = node_crypto.randomUUID();
  server = null;
  port = null;
  async start() {
    this.port = await getFreePort$1();
    this.server = http$2.createServer((req, res) => this.handle(req, res));
    await new Promise((resolve, reject) => {
      this.server.listen(this.port, "127.0.0.1", () => resolve());
      this.server.once("error", reject);
    });
    return { url: `http://127.0.0.1:${this.port}`, token: this.token };
  }
  async handle(req, res) {
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method !== "POST" || req.url !== "/panes/ensure") {
      send(404, { error: "not found" });
      return;
    }
    if (req.headers.authorization !== `Bearer ${this.token}`) {
      send(401, { error: "unauthorized" });
      return;
    }
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      send(400, { error: "bad request" });
      return;
    }
    const session = body?.session;
    if (typeof session !== "string") {
      send(400, { error: "bad request" });
      return;
    }
    try {
      await this.paneManager.ensureSessionTab(session);
      send(200, { ok: true });
    } catch (e) {
      send(500, { error: String(e) });
    }
  }
  async stop() {
    if (this.server) {
      await new Promise((resolve, reject) => {
        this.server.close((err) => err ? reject(err) : resolve());
      });
      this.server = null;
    }
  }
}
var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
function getAugmentedNamespace(n) {
  if (n.__esModule) return n;
  var f = n.default;
  if (typeof f == "function") {
    var a = function a2() {
      if (this instanceof a2) {
        return Reflect.construct(f, arguments, this.constructor);
      }
      return f.apply(this, arguments);
    };
    a.prototype = f.prototype;
  } else a = {};
  Object.defineProperty(a, "__esModule", { value: true });
  Object.keys(n).forEach(function(k) {
    var d = Object.getOwnPropertyDescriptor(n, k);
    Object.defineProperty(a, k, d.get ? d : {
      enumerable: true,
      get: function() {
        return n[k];
      }
    });
  });
  return a;
}
var bufferUtil$1 = { exports: {} };
const BINARY_TYPES$2 = ["nodebuffer", "arraybuffer", "fragments"];
const hasBlob$1 = typeof Blob !== "undefined";
if (hasBlob$1) BINARY_TYPES$2.push("blob");
var constants = {
  BINARY_TYPES: BINARY_TYPES$2,
  CLOSE_TIMEOUT: 3e4,
  EMPTY_BUFFER: Buffer.alloc(0),
  GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
  hasBlob: hasBlob$1,
  kForOnEventAttribute: Symbol("kIsForOnEventAttribute"),
  kListener: Symbol("kListener"),
  kStatusCode: Symbol("status-code"),
  kWebSocket: Symbol("websocket"),
  NOOP: () => {
  }
};
const wsNativeStub = {};
const wsNativeStub$1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: wsNativeStub
}, Symbol.toStringTag, { value: "Module" }));
const require$$2 = /* @__PURE__ */ getAugmentedNamespace(wsNativeStub$1);
var unmask$1;
var mask;
const { EMPTY_BUFFER: EMPTY_BUFFER$3 } = constants;
const FastBuffer$2 = Buffer[Symbol.species];
function concat$1(list, totalLength) {
  if (list.length === 0) return EMPTY_BUFFER$3;
  if (list.length === 1) return list[0];
  const target = Buffer.allocUnsafe(totalLength);
  let offset = 0;
  for (let i = 0; i < list.length; i++) {
    const buf = list[i];
    target.set(buf, offset);
    offset += buf.length;
  }
  if (offset < totalLength) {
    return new FastBuffer$2(target.buffer, target.byteOffset, offset);
  }
  return target;
}
function _mask(source, mask2, output, offset, length) {
  for (let i = 0; i < length; i++) {
    output[offset + i] = source[i] ^ mask2[i & 3];
  }
}
function _unmask(buffer, mask2) {
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] ^= mask2[i & 3];
  }
}
function toArrayBuffer$1(buf) {
  if (buf.length === buf.buffer.byteLength) {
    return buf.buffer;
  }
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}
function toBuffer$2(data) {
  toBuffer$2.readOnly = true;
  if (Buffer.isBuffer(data)) return data;
  let buf;
  if (data instanceof ArrayBuffer) {
    buf = new FastBuffer$2(data);
  } else if (ArrayBuffer.isView(data)) {
    buf = new FastBuffer$2(data.buffer, data.byteOffset, data.byteLength);
  } else {
    buf = Buffer.from(data);
    toBuffer$2.readOnly = false;
  }
  return buf;
}
bufferUtil$1.exports = {
  concat: concat$1,
  mask: _mask,
  toArrayBuffer: toArrayBuffer$1,
  toBuffer: toBuffer$2,
  unmask: _unmask
};
if (!process.env.WS_NO_BUFFER_UTIL) {
  try {
    const bufferUtil2 = require$$2;
    mask = bufferUtil$1.exports.mask = function(source, mask2, output, offset, length) {
      if (length < 48) _mask(source, mask2, output, offset, length);
      else bufferUtil2.mask(source, mask2, output, offset, length);
    };
    unmask$1 = bufferUtil$1.exports.unmask = function(buffer, mask2) {
      if (buffer.length < 32) _unmask(buffer, mask2);
      else bufferUtil2.unmask(buffer, mask2);
    };
  } catch (e) {
  }
}
var bufferUtilExports = bufferUtil$1.exports;
const kDone = Symbol("kDone");
const kRun = Symbol("kRun");
let Limiter$1 = class Limiter {
  /**
   * Creates a new `Limiter`.
   *
   * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
   *     to run concurrently
   */
  constructor(concurrency) {
    this[kDone] = () => {
      this.pending--;
      this[kRun]();
    };
    this.concurrency = concurrency || Infinity;
    this.jobs = [];
    this.pending = 0;
  }
  /**
   * Adds a job to the queue.
   *
   * @param {Function} job The job to run
   * @public
   */
  add(job) {
    this.jobs.push(job);
    this[kRun]();
  }
  /**
   * Removes a job from the queue and runs it if possible.
   *
   * @private
   */
  [kRun]() {
    if (this.pending === this.concurrency) return;
    if (this.jobs.length) {
      const job = this.jobs.shift();
      this.pending++;
      job(this[kDone]);
    }
  }
};
var limiter = Limiter$1;
const zlib = require$$0;
const bufferUtil = bufferUtilExports;
const Limiter2 = limiter;
const { kStatusCode: kStatusCode$2 } = constants;
const FastBuffer$1 = Buffer[Symbol.species];
const TRAILER = Buffer.from([0, 0, 255, 255]);
const kPerMessageDeflate = Symbol("permessage-deflate");
const kTotalLength = Symbol("total-length");
const kCallback = Symbol("callback");
const kBuffers = Symbol("buffers");
const kError$1 = Symbol("error");
let zlibLimiter;
let PerMessageDeflate$4 = class PerMessageDeflate {
  /**
   * Creates a PerMessageDeflate instance.
   *
   * @param {Object} [options] Configuration options
   * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
   *     for, or request, a custom client window size
   * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
   *     acknowledge disabling of client context takeover
   * @param {Number} [options.concurrencyLimit=10] The number of concurrent
   *     calls to zlib
   * @param {Boolean} [options.isServer=false] Create the instance in either
   *     server or client mode
   * @param {Number} [options.maxPayload=0] The maximum allowed message length
   * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
   *     use of a custom server window size
   * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
   *     disabling of server context takeover
   * @param {Number} [options.threshold=1024] Size (in bytes) below which
   *     messages should not be compressed if context takeover is disabled
   * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
   *     deflate
   * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
   *     inflate
   */
  constructor(options) {
    this._options = options || {};
    this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
    this._maxPayload = this._options.maxPayload | 0;
    this._isServer = !!this._options.isServer;
    this._deflate = null;
    this._inflate = null;
    this.params = null;
    if (!zlibLimiter) {
      const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
      zlibLimiter = new Limiter2(concurrency);
    }
  }
  /**
   * @type {String}
   */
  static get extensionName() {
    return "permessage-deflate";
  }
  /**
   * Create an extension negotiation offer.
   *
   * @return {Object} Extension parameters
   * @public
   */
  offer() {
    const params = {};
    if (this._options.serverNoContextTakeover) {
      params.server_no_context_takeover = true;
    }
    if (this._options.clientNoContextTakeover) {
      params.client_no_context_takeover = true;
    }
    if (this._options.serverMaxWindowBits) {
      params.server_max_window_bits = this._options.serverMaxWindowBits;
    }
    if (this._options.clientMaxWindowBits) {
      params.client_max_window_bits = this._options.clientMaxWindowBits;
    } else if (this._options.clientMaxWindowBits == null) {
      params.client_max_window_bits = true;
    }
    return params;
  }
  /**
   * Accept an extension negotiation offer/response.
   *
   * @param {Array} configurations The extension negotiation offers/reponse
   * @return {Object} Accepted configuration
   * @public
   */
  accept(configurations) {
    configurations = this.normalizeParams(configurations);
    this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
    return this.params;
  }
  /**
   * Releases all resources used by the extension.
   *
   * @public
   */
  cleanup() {
    if (this._inflate) {
      this._inflate.close();
      this._inflate = null;
    }
    if (this._deflate) {
      const callback = this._deflate[kCallback];
      this._deflate.close();
      this._deflate = null;
      if (callback) {
        callback(
          new Error(
            "The deflate stream was closed while data was being processed"
          )
        );
      }
    }
  }
  /**
   *  Accept an extension negotiation offer.
   *
   * @param {Array} offers The extension negotiation offers
   * @return {Object} Accepted configuration
   * @private
   */
  acceptAsServer(offers) {
    const opts = this._options;
    const accepted = offers.find((params) => {
      if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && !params.client_max_window_bits) {
        return false;
      }
      return true;
    });
    if (!accepted) {
      throw new Error("None of the extension offers can be accepted");
    }
    if (opts.serverNoContextTakeover) {
      accepted.server_no_context_takeover = true;
    }
    if (opts.clientNoContextTakeover) {
      accepted.client_no_context_takeover = true;
    }
    if (typeof opts.serverMaxWindowBits === "number") {
      accepted.server_max_window_bits = opts.serverMaxWindowBits;
    }
    if (typeof opts.clientMaxWindowBits === "number") {
      accepted.client_max_window_bits = opts.clientMaxWindowBits;
    } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
      delete accepted.client_max_window_bits;
    }
    return accepted;
  }
  /**
   * Accept the extension negotiation response.
   *
   * @param {Array} response The extension negotiation response
   * @return {Object} Accepted configuration
   * @private
   */
  acceptAsClient(response) {
    const params = response[0];
    if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
      throw new Error('Unexpected parameter "client_no_context_takeover"');
    }
    if (!params.client_max_window_bits) {
      if (typeof this._options.clientMaxWindowBits === "number") {
        params.client_max_window_bits = this._options.clientMaxWindowBits;
      }
    } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
      throw new Error(
        'Unexpected or invalid parameter "client_max_window_bits"'
      );
    }
    return params;
  }
  /**
   * Normalize parameters.
   *
   * @param {Array} configurations The extension negotiation offers/reponse
   * @return {Array} The offers/response with normalized parameters
   * @private
   */
  normalizeParams(configurations) {
    configurations.forEach((params) => {
      Object.keys(params).forEach((key) => {
        let value = params[key];
        if (value.length > 1) {
          throw new Error(`Parameter "${key}" must have only a single value`);
        }
        value = value[0];
        if (key === "client_max_window_bits") {
          if (value !== true) {
            const num = +value;
            if (!Number.isInteger(num) || num < 8 || num > 15) {
              throw new TypeError(
                `Invalid value for parameter "${key}": ${value}`
              );
            }
            value = num;
          } else if (!this._isServer) {
            throw new TypeError(
              `Invalid value for parameter "${key}": ${value}`
            );
          }
        } else if (key === "server_max_window_bits") {
          const num = +value;
          if (!Number.isInteger(num) || num < 8 || num > 15) {
            throw new TypeError(
              `Invalid value for parameter "${key}": ${value}`
            );
          }
          value = num;
        } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
          if (value !== true) {
            throw new TypeError(
              `Invalid value for parameter "${key}": ${value}`
            );
          }
        } else {
          throw new Error(`Unknown parameter "${key}"`);
        }
        params[key] = value;
      });
    });
    return configurations;
  }
  /**
   * Decompress data. Concurrency limited.
   *
   * @param {Buffer} data Compressed data
   * @param {Boolean} fin Specifies whether or not this is the last fragment
   * @param {Function} callback Callback
   * @public
   */
  decompress(data, fin, callback) {
    zlibLimiter.add((done) => {
      this._decompress(data, fin, (err, result) => {
        done();
        callback(err, result);
      });
    });
  }
  /**
   * Compress data. Concurrency limited.
   *
   * @param {(Buffer|String)} data Data to compress
   * @param {Boolean} fin Specifies whether or not this is the last fragment
   * @param {Function} callback Callback
   * @public
   */
  compress(data, fin, callback) {
    zlibLimiter.add((done) => {
      this._compress(data, fin, (err, result) => {
        done();
        callback(err, result);
      });
    });
  }
  /**
   * Decompress data.
   *
   * @param {Buffer} data Compressed data
   * @param {Boolean} fin Specifies whether or not this is the last fragment
   * @param {Function} callback Callback
   * @private
   */
  _decompress(data, fin, callback) {
    const endpoint = this._isServer ? "client" : "server";
    if (!this._inflate) {
      const key = `${endpoint}_max_window_bits`;
      const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
      this._inflate = zlib.createInflateRaw({
        ...this._options.zlibInflateOptions,
        windowBits
      });
      this._inflate[kPerMessageDeflate] = this;
      this._inflate[kTotalLength] = 0;
      this._inflate[kBuffers] = [];
      this._inflate.on("error", inflateOnError);
      this._inflate.on("data", inflateOnData);
    }
    this._inflate[kCallback] = callback;
    this._inflate.write(data);
    if (fin) this._inflate.write(TRAILER);
    this._inflate.flush(() => {
      const err = this._inflate[kError$1];
      if (err) {
        this._inflate.close();
        this._inflate = null;
        callback(err);
        return;
      }
      const data2 = bufferUtil.concat(
        this._inflate[kBuffers],
        this._inflate[kTotalLength]
      );
      if (this._inflate._readableState.endEmitted) {
        this._inflate.close();
        this._inflate = null;
      } else {
        this._inflate[kTotalLength] = 0;
        this._inflate[kBuffers] = [];
        if (fin && this.params[`${endpoint}_no_context_takeover`]) {
          this._inflate.reset();
        }
      }
      callback(null, data2);
    });
  }
  /**
   * Compress data.
   *
   * @param {(Buffer|String)} data Data to compress
   * @param {Boolean} fin Specifies whether or not this is the last fragment
   * @param {Function} callback Callback
   * @private
   */
  _compress(data, fin, callback) {
    const endpoint = this._isServer ? "server" : "client";
    if (!this._deflate) {
      const key = `${endpoint}_max_window_bits`;
      const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
      this._deflate = zlib.createDeflateRaw({
        ...this._options.zlibDeflateOptions,
        windowBits
      });
      this._deflate[kTotalLength] = 0;
      this._deflate[kBuffers] = [];
      this._deflate.on("data", deflateOnData);
    }
    this._deflate[kCallback] = callback;
    this._deflate.write(data);
    this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
      if (!this._deflate) {
        return;
      }
      let data2 = bufferUtil.concat(
        this._deflate[kBuffers],
        this._deflate[kTotalLength]
      );
      if (fin) {
        data2 = new FastBuffer$1(data2.buffer, data2.byteOffset, data2.length - 4);
      }
      this._deflate[kCallback] = null;
      this._deflate[kTotalLength] = 0;
      this._deflate[kBuffers] = [];
      if (fin && this.params[`${endpoint}_no_context_takeover`]) {
        this._deflate.reset();
      }
      callback(null, data2);
    });
  }
};
var permessageDeflate = PerMessageDeflate$4;
function deflateOnData(chunk) {
  this[kBuffers].push(chunk);
  this[kTotalLength] += chunk.length;
}
function inflateOnData(chunk) {
  this[kTotalLength] += chunk.length;
  if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
    this[kBuffers].push(chunk);
    return;
  }
  this[kError$1] = new RangeError("Max payload size exceeded");
  this[kError$1].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
  this[kError$1][kStatusCode$2] = 1009;
  this.removeListener("data", inflateOnData);
  this.reset();
}
function inflateOnError(err) {
  this[kPerMessageDeflate]._inflate = null;
  if (this[kError$1]) {
    this[kCallback](this[kError$1]);
    return;
  }
  err[kStatusCode$2] = 1007;
  this[kCallback](err);
}
var validation = { exports: {} };
var isValidUTF8_1;
const { isUtf8 } = require$$0$1;
const { hasBlob } = constants;
const tokenChars$2 = [
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  // 0 - 15
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  // 16 - 31
  0,
  1,
  0,
  1,
  1,
  1,
  1,
  1,
  0,
  0,
  1,
  1,
  0,
  1,
  1,
  0,
  // 32 - 47
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  0,
  0,
  0,
  0,
  0,
  0,
  // 48 - 63
  0,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  // 64 - 79
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  0,
  0,
  0,
  1,
  1,
  // 80 - 95
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  // 96 - 111
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  0,
  1,
  0,
  1,
  0
  // 112 - 127
];
function isValidStatusCode$2(code) {
  return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
}
function _isValidUTF8(buf) {
  const len = buf.length;
  let i = 0;
  while (i < len) {
    if ((buf[i] & 128) === 0) {
      i++;
    } else if ((buf[i] & 224) === 192) {
      if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
        return false;
      }
      i += 2;
    } else if ((buf[i] & 240) === 224) {
      if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
      buf[i] === 237 && (buf[i + 1] & 224) === 160) {
        return false;
      }
      i += 3;
    } else if ((buf[i] & 248) === 240) {
      if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
      buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
        return false;
      }
      i += 4;
    } else {
      return false;
    }
  }
  return true;
}
function isBlob$2(value) {
  return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
}
validation.exports = {
  isBlob: isBlob$2,
  isValidStatusCode: isValidStatusCode$2,
  isValidUTF8: _isValidUTF8,
  tokenChars: tokenChars$2
};
if (isUtf8) {
  isValidUTF8_1 = validation.exports.isValidUTF8 = function(buf) {
    return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
  };
} else if (!process.env.WS_NO_UTF_8_VALIDATE) {
  try {
    const isValidUTF82 = require$$2;
    isValidUTF8_1 = validation.exports.isValidUTF8 = function(buf) {
      return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF82(buf);
    };
  } catch (e) {
  }
}
var validationExports = validation.exports;
const { Writable } = require$$0$2;
const PerMessageDeflate$3 = permessageDeflate;
const {
  BINARY_TYPES: BINARY_TYPES$1,
  EMPTY_BUFFER: EMPTY_BUFFER$2,
  kStatusCode: kStatusCode$1,
  kWebSocket: kWebSocket$3
} = constants;
const { concat, toArrayBuffer, unmask } = bufferUtilExports;
const { isValidStatusCode: isValidStatusCode$1, isValidUTF8 } = validationExports;
const FastBuffer = Buffer[Symbol.species];
const GET_INFO = 0;
const GET_PAYLOAD_LENGTH_16 = 1;
const GET_PAYLOAD_LENGTH_64 = 2;
const GET_MASK = 3;
const GET_DATA = 4;
const INFLATING = 5;
const DEFER_EVENT = 6;
let Receiver$1 = class Receiver extends Writable {
  /**
   * Creates a Receiver instance.
   *
   * @param {Object} [options] Options object
   * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
   *     multiple times in the same tick
   * @param {String} [options.binaryType=nodebuffer] The type for binary data
   * @param {Object} [options.extensions] An object containing the negotiated
   *     extensions
   * @param {Boolean} [options.isServer=false] Specifies whether to operate in
   *     client or server mode
   * @param {Number} [options.maxBufferedChunks=0] The maximum number of
   *     buffered data chunks
   * @param {Number} [options.maxFragments=0] The maximum number of message
   *     fragments
   * @param {Number} [options.maxPayload=0] The maximum allowed message length
   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
   *     not to skip UTF-8 validation for text and close messages
   */
  constructor(options = {}) {
    super();
    this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
    this._binaryType = options.binaryType || BINARY_TYPES$1[0];
    this._extensions = options.extensions || {};
    this._isServer = !!options.isServer;
    this._maxBufferedChunks = options.maxBufferedChunks | 0;
    this._maxFragments = options.maxFragments | 0;
    this._maxPayload = options.maxPayload | 0;
    this._skipUTF8Validation = !!options.skipUTF8Validation;
    this[kWebSocket$3] = void 0;
    this._bufferedBytes = 0;
    this._buffers = [];
    this._compressed = false;
    this._payloadLength = 0;
    this._mask = void 0;
    this._fragmented = 0;
    this._masked = false;
    this._fin = false;
    this._opcode = 0;
    this._totalPayloadLength = 0;
    this._messageLength = 0;
    this._fragments = [];
    this._errored = false;
    this._loop = false;
    this._state = GET_INFO;
  }
  /**
   * Implements `Writable.prototype._write()`.
   *
   * @param {Buffer} chunk The chunk of data to write
   * @param {String} encoding The character encoding of `chunk`
   * @param {Function} cb Callback
   * @private
   */
  _write(chunk, encoding, cb) {
    if (this._opcode === 8 && this._state == GET_INFO) return cb();
    if (this._maxBufferedChunks > 0 && this._buffers.length >= this._maxBufferedChunks) {
      cb(
        this.createError(
          RangeError,
          "Too many buffered chunks",
          false,
          1008,
          "WS_ERR_TOO_MANY_BUFFERED_PARTS"
        )
      );
      return;
    }
    this._bufferedBytes += chunk.length;
    this._buffers.push(chunk);
    this.startLoop(cb);
  }
  /**
   * Consumes `n` bytes from the buffered data.
   *
   * @param {Number} n The number of bytes to consume
   * @return {Buffer} The consumed bytes
   * @private
   */
  consume(n) {
    this._bufferedBytes -= n;
    if (n === this._buffers[0].length) return this._buffers.shift();
    if (n < this._buffers[0].length) {
      const buf = this._buffers[0];
      this._buffers[0] = new FastBuffer(
        buf.buffer,
        buf.byteOffset + n,
        buf.length - n
      );
      return new FastBuffer(buf.buffer, buf.byteOffset, n);
    }
    const dst = Buffer.allocUnsafe(n);
    do {
      const buf = this._buffers[0];
      const offset = dst.length - n;
      if (n >= buf.length) {
        dst.set(this._buffers.shift(), offset);
      } else {
        dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
        this._buffers[0] = new FastBuffer(
          buf.buffer,
          buf.byteOffset + n,
          buf.length - n
        );
      }
      n -= buf.length;
    } while (n > 0);
    return dst;
  }
  /**
   * Starts the parsing loop.
   *
   * @param {Function} cb Callback
   * @private
   */
  startLoop(cb) {
    this._loop = true;
    do {
      switch (this._state) {
        case GET_INFO:
          this.getInfo(cb);
          break;
        case GET_PAYLOAD_LENGTH_16:
          this.getPayloadLength16(cb);
          break;
        case GET_PAYLOAD_LENGTH_64:
          this.getPayloadLength64(cb);
          break;
        case GET_MASK:
          this.getMask();
          break;
        case GET_DATA:
          this.getData(cb);
          break;
        case INFLATING:
        case DEFER_EVENT:
          this._loop = false;
          return;
      }
    } while (this._loop);
    if (!this._errored) cb();
  }
  /**
   * Reads the first two bytes of a frame.
   *
   * @param {Function} cb Callback
   * @private
   */
  getInfo(cb) {
    if (this._bufferedBytes < 2) {
      this._loop = false;
      return;
    }
    const buf = this.consume(2);
    if ((buf[0] & 48) !== 0) {
      const error = this.createError(
        RangeError,
        "RSV2 and RSV3 must be clear",
        true,
        1002,
        "WS_ERR_UNEXPECTED_RSV_2_3"
      );
      cb(error);
      return;
    }
    const compressed = (buf[0] & 64) === 64;
    if (compressed && !this._extensions[PerMessageDeflate$3.extensionName]) {
      const error = this.createError(
        RangeError,
        "RSV1 must be clear",
        true,
        1002,
        "WS_ERR_UNEXPECTED_RSV_1"
      );
      cb(error);
      return;
    }
    this._fin = (buf[0] & 128) === 128;
    this._opcode = buf[0] & 15;
    this._payloadLength = buf[1] & 127;
    if (this._opcode === 0) {
      if (compressed) {
        const error = this.createError(
          RangeError,
          "RSV1 must be clear",
          true,
          1002,
          "WS_ERR_UNEXPECTED_RSV_1"
        );
        cb(error);
        return;
      }
      if (!this._fragmented) {
        const error = this.createError(
          RangeError,
          "invalid opcode 0",
          true,
          1002,
          "WS_ERR_INVALID_OPCODE"
        );
        cb(error);
        return;
      }
      this._opcode = this._fragmented;
    } else if (this._opcode === 1 || this._opcode === 2) {
      if (this._fragmented) {
        const error = this.createError(
          RangeError,
          `invalid opcode ${this._opcode}`,
          true,
          1002,
          "WS_ERR_INVALID_OPCODE"
        );
        cb(error);
        return;
      }
      this._compressed = compressed;
    } else if (this._opcode > 7 && this._opcode < 11) {
      if (!this._fin) {
        const error = this.createError(
          RangeError,
          "FIN must be set",
          true,
          1002,
          "WS_ERR_EXPECTED_FIN"
        );
        cb(error);
        return;
      }
      if (compressed) {
        const error = this.createError(
          RangeError,
          "RSV1 must be clear",
          true,
          1002,
          "WS_ERR_UNEXPECTED_RSV_1"
        );
        cb(error);
        return;
      }
      if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
        const error = this.createError(
          RangeError,
          `invalid payload length ${this._payloadLength}`,
          true,
          1002,
          "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
        );
        cb(error);
        return;
      }
    } else {
      const error = this.createError(
        RangeError,
        `invalid opcode ${this._opcode}`,
        true,
        1002,
        "WS_ERR_INVALID_OPCODE"
      );
      cb(error);
      return;
    }
    if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
    this._masked = (buf[1] & 128) === 128;
    if (this._isServer) {
      if (!this._masked) {
        const error = this.createError(
          RangeError,
          "MASK must be set",
          true,
          1002,
          "WS_ERR_EXPECTED_MASK"
        );
        cb(error);
        return;
      }
    } else if (this._masked) {
      const error = this.createError(
        RangeError,
        "MASK must be clear",
        true,
        1002,
        "WS_ERR_UNEXPECTED_MASK"
      );
      cb(error);
      return;
    }
    if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
    else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
    else this.haveLength(cb);
  }
  /**
   * Gets extended payload length (7+16).
   *
   * @param {Function} cb Callback
   * @private
   */
  getPayloadLength16(cb) {
    if (this._bufferedBytes < 2) {
      this._loop = false;
      return;
    }
    this._payloadLength = this.consume(2).readUInt16BE(0);
    this.haveLength(cb);
  }
  /**
   * Gets extended payload length (7+64).
   *
   * @param {Function} cb Callback
   * @private
   */
  getPayloadLength64(cb) {
    if (this._bufferedBytes < 8) {
      this._loop = false;
      return;
    }
    const buf = this.consume(8);
    const num = buf.readUInt32BE(0);
    if (num > Math.pow(2, 53 - 32) - 1) {
      const error = this.createError(
        RangeError,
        "Unsupported WebSocket frame: payload length > 2^53 - 1",
        false,
        1009,
        "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
      );
      cb(error);
      return;
    }
    this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
    this.haveLength(cb);
  }
  /**
   * Payload length has been read.
   *
   * @param {Function} cb Callback
   * @private
   */
  haveLength(cb) {
    if (this._payloadLength && this._opcode < 8) {
      this._totalPayloadLength += this._payloadLength;
      if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
        const error = this.createError(
          RangeError,
          "Max payload size exceeded",
          false,
          1009,
          "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
        );
        cb(error);
        return;
      }
    }
    if (this._masked) this._state = GET_MASK;
    else this._state = GET_DATA;
  }
  /**
   * Reads mask bytes.
   *
   * @private
   */
  getMask() {
    if (this._bufferedBytes < 4) {
      this._loop = false;
      return;
    }
    this._mask = this.consume(4);
    this._state = GET_DATA;
  }
  /**
   * Reads data bytes.
   *
   * @param {Function} cb Callback
   * @private
   */
  getData(cb) {
    let data = EMPTY_BUFFER$2;
    if (this._payloadLength) {
      if (this._bufferedBytes < this._payloadLength) {
        this._loop = false;
        return;
      }
      data = this.consume(this._payloadLength);
      if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
        unmask(data, this._mask);
      }
    }
    if (this._opcode > 7) {
      this.controlMessage(data, cb);
      return;
    }
    if (this._compressed) {
      this._state = INFLATING;
      this.decompress(data, cb);
      return;
    }
    if (data.length) {
      if (this._maxFragments > 0 && this._fragments.length >= this._maxFragments) {
        const error = this.createError(
          RangeError,
          "Too many message fragments",
          false,
          1008,
          "WS_ERR_TOO_MANY_BUFFERED_PARTS"
        );
        cb(error);
        return;
      }
      this._messageLength = this._totalPayloadLength;
      this._fragments.push(data);
    }
    this.dataMessage(cb);
  }
  /**
   * Decompresses data.
   *
   * @param {Buffer} data Compressed data
   * @param {Function} cb Callback
   * @private
   */
  decompress(data, cb) {
    const perMessageDeflate = this._extensions[PerMessageDeflate$3.extensionName];
    perMessageDeflate.decompress(data, this._fin, (err, buf) => {
      if (err) return cb(err);
      if (buf.length) {
        this._messageLength += buf.length;
        if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
          const error = this.createError(
            RangeError,
            "Max payload size exceeded",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
          );
          cb(error);
          return;
        }
        if (this._maxFragments > 0 && this._fragments.length >= this._maxFragments) {
          const error = this.createError(
            RangeError,
            "Too many message fragments",
            false,
            1008,
            "WS_ERR_TOO_MANY_BUFFERED_PARTS"
          );
          cb(error);
          return;
        }
        this._fragments.push(buf);
      }
      this.dataMessage(cb);
      if (this._state === GET_INFO) this.startLoop(cb);
    });
  }
  /**
   * Handles a data message.
   *
   * @param {Function} cb Callback
   * @private
   */
  dataMessage(cb) {
    if (!this._fin) {
      this._state = GET_INFO;
      return;
    }
    const messageLength = this._messageLength;
    const fragments = this._fragments;
    this._totalPayloadLength = 0;
    this._messageLength = 0;
    this._fragmented = 0;
    this._fragments = [];
    if (this._opcode === 2) {
      let data;
      if (this._binaryType === "nodebuffer") {
        data = concat(fragments, messageLength);
      } else if (this._binaryType === "arraybuffer") {
        data = toArrayBuffer(concat(fragments, messageLength));
      } else if (this._binaryType === "blob") {
        data = new Blob(fragments);
      } else {
        data = fragments;
      }
      if (this._allowSynchronousEvents) {
        this.emit("message", data, true);
        this._state = GET_INFO;
      } else {
        this._state = DEFER_EVENT;
        setImmediate(() => {
          this.emit("message", data, true);
          this._state = GET_INFO;
          this.startLoop(cb);
        });
      }
    } else {
      const buf = concat(fragments, messageLength);
      if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
        const error = this.createError(
          Error,
          "invalid UTF-8 sequence",
          true,
          1007,
          "WS_ERR_INVALID_UTF8"
        );
        cb(error);
        return;
      }
      if (this._state === INFLATING || this._allowSynchronousEvents) {
        this.emit("message", buf, false);
        this._state = GET_INFO;
      } else {
        this._state = DEFER_EVENT;
        setImmediate(() => {
          this.emit("message", buf, false);
          this._state = GET_INFO;
          this.startLoop(cb);
        });
      }
    }
  }
  /**
   * Handles a control message.
   *
   * @param {Buffer} data Data to handle
   * @return {(Error|RangeError|undefined)} A possible error
   * @private
   */
  controlMessage(data, cb) {
    if (this._opcode === 8) {
      if (data.length === 0) {
        this._loop = false;
        this.emit("conclude", 1005, EMPTY_BUFFER$2);
        this.end();
      } else {
        const code = data.readUInt16BE(0);
        if (!isValidStatusCode$1(code)) {
          const error = this.createError(
            RangeError,
            `invalid status code ${code}`,
            true,
            1002,
            "WS_ERR_INVALID_CLOSE_CODE"
          );
          cb(error);
          return;
        }
        const buf = new FastBuffer(
          data.buffer,
          data.byteOffset + 2,
          data.length - 2
        );
        if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
          const error = this.createError(
            Error,
            "invalid UTF-8 sequence",
            true,
            1007,
            "WS_ERR_INVALID_UTF8"
          );
          cb(error);
          return;
        }
        this._loop = false;
        this.emit("conclude", code, buf);
        this.end();
      }
      this._state = GET_INFO;
      return;
    }
    if (this._allowSynchronousEvents) {
      this.emit(this._opcode === 9 ? "ping" : "pong", data);
      this._state = GET_INFO;
    } else {
      this._state = DEFER_EVENT;
      setImmediate(() => {
        this.emit(this._opcode === 9 ? "ping" : "pong", data);
        this._state = GET_INFO;
        this.startLoop(cb);
      });
    }
  }
  /**
   * Builds an error object.
   *
   * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
   * @param {String} message The error message
   * @param {Boolean} prefix Specifies whether or not to add a default prefix to
   *     `message`
   * @param {Number} statusCode The status code
   * @param {String} errorCode The exposed error code
   * @return {(Error|RangeError)} The error
   * @private
   */
  createError(ErrorCtor, message, prefix, statusCode, errorCode) {
    this._loop = false;
    this._errored = true;
    const err = new ErrorCtor(
      prefix ? `Invalid WebSocket frame: ${message}` : message
    );
    Error.captureStackTrace(err, this.createError);
    err.code = errorCode;
    err[kStatusCode$1] = statusCode;
    return err;
  }
};
var receiver = Receiver$1;
const { Duplex: Duplex$3 } = require$$0$2;
const { randomFillSync } = require$$0$3;
const {
  types: { isUint8Array }
} = require$$2$1;
const PerMessageDeflate$2 = permessageDeflate;
const { EMPTY_BUFFER: EMPTY_BUFFER$1, kWebSocket: kWebSocket$2, NOOP: NOOP$1 } = constants;
const { isBlob: isBlob$1, isValidStatusCode } = validationExports;
const { mask: applyMask, toBuffer: toBuffer$1 } = bufferUtilExports;
const kByteLength = Symbol("kByteLength");
const maskBuffer = Buffer.alloc(4);
const RANDOM_POOL_SIZE = 8 * 1024;
let randomPool;
let randomPoolPointer = RANDOM_POOL_SIZE;
const DEFAULT = 0;
const DEFLATING = 1;
const GET_BLOB_DATA = 2;
let Sender$1 = class Sender {
  /**
   * Creates a Sender instance.
   *
   * @param {Duplex} socket The connection socket
   * @param {Object} [extensions] An object containing the negotiated extensions
   * @param {Function} [generateMask] The function used to generate the masking
   *     key
   */
  constructor(socket, extensions, generateMask) {
    this._extensions = extensions || {};
    if (generateMask) {
      this._generateMask = generateMask;
      this._maskBuffer = Buffer.alloc(4);
    }
    this._socket = socket;
    this._firstFragment = true;
    this._compress = false;
    this._bufferedBytes = 0;
    this._queue = [];
    this._state = DEFAULT;
    this.onerror = NOOP$1;
    this[kWebSocket$2] = void 0;
  }
  /**
   * Frames a piece of data according to the HyBi WebSocket protocol.
   *
   * @param {(Buffer|String)} data The data to frame
   * @param {Object} options Options object
   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
   *     FIN bit
   * @param {Function} [options.generateMask] The function used to generate the
   *     masking key
   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
   *     `data`
   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
   *     key
   * @param {Number} options.opcode The opcode
   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
   *     modified
   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
   *     RSV1 bit
   * @return {(Buffer|String)[]} The framed data
   * @public
   */
  static frame(data, options) {
    let mask2;
    let merge = false;
    let offset = 2;
    let skipMasking = false;
    if (options.mask) {
      mask2 = options.maskBuffer || maskBuffer;
      if (options.generateMask) {
        options.generateMask(mask2);
      } else {
        if (randomPoolPointer === RANDOM_POOL_SIZE) {
          if (randomPool === void 0) {
            randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
          }
          randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
          randomPoolPointer = 0;
        }
        mask2[0] = randomPool[randomPoolPointer++];
        mask2[1] = randomPool[randomPoolPointer++];
        mask2[2] = randomPool[randomPoolPointer++];
        mask2[3] = randomPool[randomPoolPointer++];
      }
      skipMasking = (mask2[0] | mask2[1] | mask2[2] | mask2[3]) === 0;
      offset = 6;
    }
    let dataLength;
    if (typeof data === "string") {
      if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
        dataLength = options[kByteLength];
      } else {
        data = Buffer.from(data);
        dataLength = data.length;
      }
    } else {
      dataLength = data.length;
      merge = options.mask && options.readOnly && !skipMasking;
    }
    let payloadLength = dataLength;
    if (dataLength >= 65536) {
      offset += 8;
      payloadLength = 127;
    } else if (dataLength > 125) {
      offset += 2;
      payloadLength = 126;
    }
    const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
    target[0] = options.fin ? options.opcode | 128 : options.opcode;
    if (options.rsv1) target[0] |= 64;
    target[1] = payloadLength;
    if (payloadLength === 126) {
      target.writeUInt16BE(dataLength, 2);
    } else if (payloadLength === 127) {
      target[2] = target[3] = 0;
      target.writeUIntBE(dataLength, 4, 6);
    }
    if (!options.mask) return [target, data];
    target[1] |= 128;
    target[offset - 4] = mask2[0];
    target[offset - 3] = mask2[1];
    target[offset - 2] = mask2[2];
    target[offset - 1] = mask2[3];
    if (skipMasking) return [target, data];
    if (merge) {
      applyMask(data, mask2, target, offset, dataLength);
      return [target];
    }
    applyMask(data, mask2, data, 0, dataLength);
    return [target, data];
  }
  /**
   * Sends a close message to the other peer.
   *
   * @param {Number} [code] The status code component of the body
   * @param {(String|Buffer)} [data] The message component of the body
   * @param {Boolean} [mask=false] Specifies whether or not to mask the message
   * @param {Function} [cb] Callback
   * @public
   */
  close(code, data, mask2, cb) {
    let buf;
    if (code === void 0) {
      buf = EMPTY_BUFFER$1;
    } else if (typeof code !== "number" || !isValidStatusCode(code)) {
      throw new TypeError("First argument must be a valid error code number");
    } else if (data === void 0 || !data.length) {
      buf = Buffer.allocUnsafe(2);
      buf.writeUInt16BE(code, 0);
    } else {
      const length = Buffer.byteLength(data);
      if (length > 123) {
        throw new RangeError("The message must not be greater than 123 bytes");
      }
      buf = Buffer.allocUnsafe(2 + length);
      buf.writeUInt16BE(code, 0);
      if (typeof data === "string") {
        buf.write(data, 2);
      } else if (isUint8Array(data)) {
        buf.set(data, 2);
      } else {
        throw new TypeError("Second argument must be a string or a Uint8Array");
      }
    }
    const options = {
      [kByteLength]: buf.length,
      fin: true,
      generateMask: this._generateMask,
      mask: mask2,
      maskBuffer: this._maskBuffer,
      opcode: 8,
      readOnly: false,
      rsv1: false
    };
    if (this._state !== DEFAULT) {
      this.enqueue([this.dispatch, buf, false, options, cb]);
    } else {
      this.sendFrame(Sender.frame(buf, options), cb);
    }
  }
  /**
   * Sends a ping message to the other peer.
   *
   * @param {*} data The message to send
   * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
   * @param {Function} [cb] Callback
   * @public
   */
  ping(data, mask2, cb) {
    let byteLength;
    let readOnly;
    if (typeof data === "string") {
      byteLength = Buffer.byteLength(data);
      readOnly = false;
    } else if (isBlob$1(data)) {
      byteLength = data.size;
      readOnly = false;
    } else {
      data = toBuffer$1(data);
      byteLength = data.length;
      readOnly = toBuffer$1.readOnly;
    }
    if (byteLength > 125) {
      throw new RangeError("The data size must not be greater than 125 bytes");
    }
    const options = {
      [kByteLength]: byteLength,
      fin: true,
      generateMask: this._generateMask,
      mask: mask2,
      maskBuffer: this._maskBuffer,
      opcode: 9,
      readOnly,
      rsv1: false
    };
    if (isBlob$1(data)) {
      if (this._state !== DEFAULT) {
        this.enqueue([this.getBlobData, data, false, options, cb]);
      } else {
        this.getBlobData(data, false, options, cb);
      }
    } else if (this._state !== DEFAULT) {
      this.enqueue([this.dispatch, data, false, options, cb]);
    } else {
      this.sendFrame(Sender.frame(data, options), cb);
    }
  }
  /**
   * Sends a pong message to the other peer.
   *
   * @param {*} data The message to send
   * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
   * @param {Function} [cb] Callback
   * @public
   */
  pong(data, mask2, cb) {
    let byteLength;
    let readOnly;
    if (typeof data === "string") {
      byteLength = Buffer.byteLength(data);
      readOnly = false;
    } else if (isBlob$1(data)) {
      byteLength = data.size;
      readOnly = false;
    } else {
      data = toBuffer$1(data);
      byteLength = data.length;
      readOnly = toBuffer$1.readOnly;
    }
    if (byteLength > 125) {
      throw new RangeError("The data size must not be greater than 125 bytes");
    }
    const options = {
      [kByteLength]: byteLength,
      fin: true,
      generateMask: this._generateMask,
      mask: mask2,
      maskBuffer: this._maskBuffer,
      opcode: 10,
      readOnly,
      rsv1: false
    };
    if (isBlob$1(data)) {
      if (this._state !== DEFAULT) {
        this.enqueue([this.getBlobData, data, false, options, cb]);
      } else {
        this.getBlobData(data, false, options, cb);
      }
    } else if (this._state !== DEFAULT) {
      this.enqueue([this.dispatch, data, false, options, cb]);
    } else {
      this.sendFrame(Sender.frame(data, options), cb);
    }
  }
  /**
   * Sends a data message to the other peer.
   *
   * @param {*} data The message to send
   * @param {Object} options Options object
   * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
   *     or text
   * @param {Boolean} [options.compress=false] Specifies whether or not to
   *     compress `data`
   * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
   *     last one
   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
   *     `data`
   * @param {Function} [cb] Callback
   * @public
   */
  send(data, options, cb) {
    const perMessageDeflate = this._extensions[PerMessageDeflate$2.extensionName];
    let opcode = options.binary ? 2 : 1;
    let rsv1 = options.compress;
    let byteLength;
    let readOnly;
    if (typeof data === "string") {
      byteLength = Buffer.byteLength(data);
      readOnly = false;
    } else if (isBlob$1(data)) {
      byteLength = data.size;
      readOnly = false;
    } else {
      data = toBuffer$1(data);
      byteLength = data.length;
      readOnly = toBuffer$1.readOnly;
    }
    if (this._firstFragment) {
      this._firstFragment = false;
      if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
        rsv1 = byteLength >= perMessageDeflate._threshold;
      }
      this._compress = rsv1;
    } else {
      rsv1 = false;
      opcode = 0;
    }
    if (options.fin) this._firstFragment = true;
    const opts = {
      [kByteLength]: byteLength,
      fin: options.fin,
      generateMask: this._generateMask,
      mask: options.mask,
      maskBuffer: this._maskBuffer,
      opcode,
      readOnly,
      rsv1
    };
    if (isBlob$1(data)) {
      if (this._state !== DEFAULT) {
        this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
      } else {
        this.getBlobData(data, this._compress, opts, cb);
      }
    } else if (this._state !== DEFAULT) {
      this.enqueue([this.dispatch, data, this._compress, opts, cb]);
    } else {
      this.dispatch(data, this._compress, opts, cb);
    }
  }
  /**
   * Gets the contents of a blob as binary data.
   *
   * @param {Blob} blob The blob
   * @param {Boolean} [compress=false] Specifies whether or not to compress
   *     the data
   * @param {Object} options Options object
   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
   *     FIN bit
   * @param {Function} [options.generateMask] The function used to generate the
   *     masking key
   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
   *     `data`
   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
   *     key
   * @param {Number} options.opcode The opcode
   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
   *     modified
   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
   *     RSV1 bit
   * @param {Function} [cb] Callback
   * @private
   */
  getBlobData(blob, compress, options, cb) {
    this._bufferedBytes += options[kByteLength];
    this._state = GET_BLOB_DATA;
    blob.arrayBuffer().then((arrayBuffer) => {
      if (this._socket.destroyed) {
        const err = new Error(
          "The socket was closed while the blob was being read"
        );
        process.nextTick(callCallbacks, this, err, cb);
        return;
      }
      this._bufferedBytes -= options[kByteLength];
      const data = toBuffer$1(arrayBuffer);
      if (!compress) {
        this._state = DEFAULT;
        this.sendFrame(Sender.frame(data, options), cb);
        this.dequeue();
      } else {
        this.dispatch(data, compress, options, cb);
      }
    }).catch((err) => {
      process.nextTick(onError, this, err, cb);
    });
  }
  /**
   * Dispatches a message.
   *
   * @param {(Buffer|String)} data The message to send
   * @param {Boolean} [compress=false] Specifies whether or not to compress
   *     `data`
   * @param {Object} options Options object
   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
   *     FIN bit
   * @param {Function} [options.generateMask] The function used to generate the
   *     masking key
   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
   *     `data`
   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
   *     key
   * @param {Number} options.opcode The opcode
   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
   *     modified
   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
   *     RSV1 bit
   * @param {Function} [cb] Callback
   * @private
   */
  dispatch(data, compress, options, cb) {
    if (!compress) {
      this.sendFrame(Sender.frame(data, options), cb);
      return;
    }
    const perMessageDeflate = this._extensions[PerMessageDeflate$2.extensionName];
    this._bufferedBytes += options[kByteLength];
    this._state = DEFLATING;
    perMessageDeflate.compress(data, options.fin, (_, buf) => {
      if (this._socket.destroyed) {
        const err = new Error(
          "The socket was closed while data was being compressed"
        );
        callCallbacks(this, err, cb);
        return;
      }
      this._bufferedBytes -= options[kByteLength];
      this._state = DEFAULT;
      options.readOnly = false;
      this.sendFrame(Sender.frame(buf, options), cb);
      this.dequeue();
    });
  }
  /**
   * Executes queued send operations.
   *
   * @private
   */
  dequeue() {
    while (this._state === DEFAULT && this._queue.length) {
      const params = this._queue.shift();
      this._bufferedBytes -= params[3][kByteLength];
      Reflect.apply(params[0], this, params.slice(1));
    }
  }
  /**
   * Enqueues a send operation.
   *
   * @param {Array} params Send operation parameters.
   * @private
   */
  enqueue(params) {
    this._bufferedBytes += params[3][kByteLength];
    this._queue.push(params);
  }
  /**
   * Sends a frame.
   *
   * @param {(Buffer | String)[]} list The frame to send
   * @param {Function} [cb] Callback
   * @private
   */
  sendFrame(list, cb) {
    if (list.length === 2) {
      this._socket.cork();
      this._socket.write(list[0]);
      this._socket.write(list[1], cb);
      this._socket.uncork();
    } else {
      this._socket.write(list[0], cb);
    }
  }
};
var sender = Sender$1;
function callCallbacks(sender2, err, cb) {
  if (typeof cb === "function") cb(err);
  for (let i = 0; i < sender2._queue.length; i++) {
    const params = sender2._queue[i];
    const callback = params[params.length - 1];
    if (typeof callback === "function") callback(err);
  }
}
function onError(sender2, err, cb) {
  callCallbacks(sender2, err, cb);
  sender2.onerror(err);
}
const { kForOnEventAttribute: kForOnEventAttribute$1, kListener: kListener$1 } = constants;
const kCode = Symbol("kCode");
const kData = Symbol("kData");
const kError = Symbol("kError");
const kMessage = Symbol("kMessage");
const kReason = Symbol("kReason");
const kTarget = Symbol("kTarget");
const kType = Symbol("kType");
const kWasClean = Symbol("kWasClean");
class Event {
  /**
   * Create a new `Event`.
   *
   * @param {String} type The name of the event
   * @throws {TypeError} If the `type` argument is not specified
   */
  constructor(type) {
    this[kTarget] = null;
    this[kType] = type;
  }
  /**
   * @type {*}
   */
  get target() {
    return this[kTarget];
  }
  /**
   * @type {String}
   */
  get type() {
    return this[kType];
  }
}
Object.defineProperty(Event.prototype, "target", { enumerable: true });
Object.defineProperty(Event.prototype, "type", { enumerable: true });
class CloseEvent extends Event {
  /**
   * Create a new `CloseEvent`.
   *
   * @param {String} type The name of the event
   * @param {Object} [options] A dictionary object that allows for setting
   *     attributes via object members of the same name
   * @param {Number} [options.code=0] The status code explaining why the
   *     connection was closed
   * @param {String} [options.reason=''] A human-readable string explaining why
   *     the connection was closed
   * @param {Boolean} [options.wasClean=false] Indicates whether or not the
   *     connection was cleanly closed
   */
  constructor(type, options = {}) {
    super(type);
    this[kCode] = options.code === void 0 ? 0 : options.code;
    this[kReason] = options.reason === void 0 ? "" : options.reason;
    this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
  }
  /**
   * @type {Number}
   */
  get code() {
    return this[kCode];
  }
  /**
   * @type {String}
   */
  get reason() {
    return this[kReason];
  }
  /**
   * @type {Boolean}
   */
  get wasClean() {
    return this[kWasClean];
  }
}
Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
class ErrorEvent extends Event {
  /**
   * Create a new `ErrorEvent`.
   *
   * @param {String} type The name of the event
   * @param {Object} [options] A dictionary object that allows for setting
   *     attributes via object members of the same name
   * @param {*} [options.error=null] The error that generated this event
   * @param {String} [options.message=''] The error message
   */
  constructor(type, options = {}) {
    super(type);
    this[kError] = options.error === void 0 ? null : options.error;
    this[kMessage] = options.message === void 0 ? "" : options.message;
  }
  /**
   * @type {*}
   */
  get error() {
    return this[kError];
  }
  /**
   * @type {String}
   */
  get message() {
    return this[kMessage];
  }
}
Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
class MessageEvent extends Event {
  /**
   * Create a new `MessageEvent`.
   *
   * @param {String} type The name of the event
   * @param {Object} [options] A dictionary object that allows for setting
   *     attributes via object members of the same name
   * @param {*} [options.data=null] The message content
   */
  constructor(type, options = {}) {
    super(type);
    this[kData] = options.data === void 0 ? null : options.data;
  }
  /**
   * @type {*}
   */
  get data() {
    return this[kData];
  }
}
Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
const EventTarget = {
  /**
   * Register an event listener.
   *
   * @param {String} type A string representing the event type to listen for
   * @param {(Function|Object)} handler The listener to add
   * @param {Object} [options] An options object specifies characteristics about
   *     the event listener
   * @param {Boolean} [options.once=false] A `Boolean` indicating that the
   *     listener should be invoked at most once after being added. If `true`,
   *     the listener would be automatically removed when invoked.
   * @public
   */
  addEventListener(type, handler, options = {}) {
    for (const listener of this.listeners(type)) {
      if (!options[kForOnEventAttribute$1] && listener[kListener$1] === handler && !listener[kForOnEventAttribute$1]) {
        return;
      }
    }
    let wrapper;
    if (type === "message") {
      wrapper = function onMessage(data, isBinary) {
        const event = new MessageEvent("message", {
          data: isBinary ? data : data.toString()
        });
        event[kTarget] = this;
        callListener(handler, this, event);
      };
    } else if (type === "close") {
      wrapper = function onClose(code, message) {
        const event = new CloseEvent("close", {
          code,
          reason: message.toString(),
          wasClean: this._closeFrameReceived && this._closeFrameSent
        });
        event[kTarget] = this;
        callListener(handler, this, event);
      };
    } else if (type === "error") {
      wrapper = function onError2(error) {
        const event = new ErrorEvent("error", {
          error,
          message: error.message
        });
        event[kTarget] = this;
        callListener(handler, this, event);
      };
    } else if (type === "open") {
      wrapper = function onOpen() {
        const event = new Event("open");
        event[kTarget] = this;
        callListener(handler, this, event);
      };
    } else {
      return;
    }
    wrapper[kForOnEventAttribute$1] = !!options[kForOnEventAttribute$1];
    wrapper[kListener$1] = handler;
    if (options.once) {
      this.once(type, wrapper);
    } else {
      this.on(type, wrapper);
    }
  },
  /**
   * Remove an event listener.
   *
   * @param {String} type A string representing the event type to remove
   * @param {(Function|Object)} handler The listener to remove
   * @public
   */
  removeEventListener(type, handler) {
    for (const listener of this.listeners(type)) {
      if (listener[kListener$1] === handler && !listener[kForOnEventAttribute$1]) {
        this.removeListener(type, listener);
        break;
      }
    }
  }
};
var eventTarget = {
  EventTarget
};
function callListener(listener, thisArg, event) {
  if (typeof listener === "object" && listener.handleEvent) {
    listener.handleEvent.call(listener, event);
  } else {
    listener.call(thisArg, event);
  }
}
const { tokenChars: tokenChars$1 } = validationExports;
function push(dest, name, elem) {
  if (dest[name] === void 0) dest[name] = [elem];
  else dest[name].push(elem);
}
function parse$2(header) {
  const offers = /* @__PURE__ */ Object.create(null);
  let params = /* @__PURE__ */ Object.create(null);
  let mustUnescape = false;
  let isEscaping = false;
  let inQuotes = false;
  let extensionName;
  let paramName;
  let start = -1;
  let code = -1;
  let end = -1;
  let i = 0;
  for (; i < header.length; i++) {
    code = header.charCodeAt(i);
    if (extensionName === void 0) {
      if (end === -1 && tokenChars$1[code] === 1) {
        if (start === -1) start = i;
      } else if (i !== 0 && (code === 32 || code === 9)) {
        if (end === -1 && start !== -1) end = i;
      } else if (code === 59 || code === 44) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
        if (end === -1) end = i;
        const name = header.slice(start, end);
        if (code === 44) {
          push(offers, name, params);
          params = /* @__PURE__ */ Object.create(null);
        } else {
          extensionName = name;
        }
        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    } else if (paramName === void 0) {
      if (end === -1 && tokenChars$1[code] === 1) {
        if (start === -1) start = i;
      } else if (code === 32 || code === 9) {
        if (end === -1 && start !== -1) end = i;
      } else if (code === 59 || code === 44) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
        if (end === -1) end = i;
        push(params, header.slice(start, end), true);
        if (code === 44) {
          push(offers, extensionName, params);
          params = /* @__PURE__ */ Object.create(null);
          extensionName = void 0;
        }
        start = end = -1;
      } else if (code === 61 && start !== -1 && end === -1) {
        paramName = header.slice(start, i);
        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    } else {
      if (isEscaping) {
        if (tokenChars$1[code] !== 1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
        if (start === -1) start = i;
        else if (!mustUnescape) mustUnescape = true;
        isEscaping = false;
      } else if (inQuotes) {
        if (tokenChars$1[code] === 1) {
          if (start === -1) start = i;
        } else if (code === 34 && start !== -1) {
          inQuotes = false;
          end = i;
        } else if (code === 92) {
          isEscaping = true;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
        inQuotes = true;
      } else if (end === -1 && tokenChars$1[code] === 1) {
        if (start === -1) start = i;
      } else if (start !== -1 && (code === 32 || code === 9)) {
        if (end === -1) end = i;
      } else if (code === 59 || code === 44) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
        if (end === -1) end = i;
        let value = header.slice(start, end);
        if (mustUnescape) {
          value = value.replace(/\\/g, "");
          mustUnescape = false;
        }
        push(params, paramName, value);
        if (code === 44) {
          push(offers, extensionName, params);
          params = /* @__PURE__ */ Object.create(null);
          extensionName = void 0;
        }
        paramName = void 0;
        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    }
  }
  if (start === -1 || inQuotes || code === 32 || code === 9) {
    throw new SyntaxError("Unexpected end of input");
  }
  if (end === -1) end = i;
  const token = header.slice(start, end);
  if (extensionName === void 0) {
    push(offers, token, params);
  } else {
    if (paramName === void 0) {
      push(params, token, true);
    } else if (mustUnescape) {
      push(params, paramName, token.replace(/\\/g, ""));
    } else {
      push(params, paramName, token);
    }
    push(offers, extensionName, params);
  }
  return offers;
}
function format$1(extensions) {
  return Object.keys(extensions).map((extension2) => {
    let configurations = extensions[extension2];
    if (!Array.isArray(configurations)) configurations = [configurations];
    return configurations.map((params) => {
      return [extension2].concat(
        Object.keys(params).map((k) => {
          let values = params[k];
          if (!Array.isArray(values)) values = [values];
          return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
        })
      ).join("; ");
    }).join(", ");
  }).join(", ");
}
var extension$1 = { format: format$1, parse: parse$2 };
const EventEmitter$1 = require$$0$4;
const https = require$$1$1;
const http$1 = require$$2$3;
const net = require$$3;
const tls = require$$4;
const { randomBytes, createHash: createHash$1 } = require$$0$3;
const { Duplex: Duplex$2, Readable } = require$$0$2;
const { URL: URL$1 } = require$$2$2;
const PerMessageDeflate$1 = permessageDeflate;
const Receiver2 = receiver;
const Sender2 = sender;
const { isBlob } = validationExports;
const {
  BINARY_TYPES,
  CLOSE_TIMEOUT: CLOSE_TIMEOUT$1,
  EMPTY_BUFFER,
  GUID: GUID$1,
  kForOnEventAttribute,
  kListener,
  kStatusCode,
  kWebSocket: kWebSocket$1,
  NOOP
} = constants;
const {
  EventTarget: { addEventListener, removeEventListener }
} = eventTarget;
const { format, parse: parse$1 } = extension$1;
const { toBuffer } = bufferUtilExports;
const kAborted = Symbol("kAborted");
const protocolVersions = [8, 13];
const readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
const subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
let WebSocket$1 = class WebSocket extends EventEmitter$1 {
  /**
   * Create a new `WebSocket`.
   *
   * @param {(String|URL)} address The URL to which to connect
   * @param {(String|String[])} [protocols] The subprotocols
   * @param {Object} [options] Connection options
   */
  constructor(address, protocols, options) {
    super();
    this._binaryType = BINARY_TYPES[0];
    this._closeCode = 1006;
    this._closeFrameReceived = false;
    this._closeFrameSent = false;
    this._closeMessage = EMPTY_BUFFER;
    this._closeTimer = null;
    this._errorEmitted = false;
    this._extensions = {};
    this._paused = false;
    this._protocol = "";
    this._readyState = WebSocket.CONNECTING;
    this._receiver = null;
    this._sender = null;
    this._socket = null;
    if (address !== null) {
      this._bufferedAmount = 0;
      this._isServer = false;
      this._redirects = 0;
      if (protocols === void 0) {
        protocols = [];
      } else if (!Array.isArray(protocols)) {
        if (typeof protocols === "object" && protocols !== null) {
          options = protocols;
          protocols = [];
        } else {
          protocols = [protocols];
        }
      }
      initAsClient(this, address, protocols, options);
    } else {
      this._autoPong = options.autoPong;
      this._closeTimeout = options.closeTimeout;
      this._isServer = true;
    }
  }
  /**
   * For historical reasons, the custom "nodebuffer" type is used by the default
   * instead of "blob".
   *
   * @type {String}
   */
  get binaryType() {
    return this._binaryType;
  }
  set binaryType(type) {
    if (!BINARY_TYPES.includes(type)) return;
    this._binaryType = type;
    if (this._receiver) this._receiver._binaryType = type;
  }
  /**
   * @type {Number}
   */
  get bufferedAmount() {
    if (!this._socket) return this._bufferedAmount;
    return this._socket._writableState.length + this._sender._bufferedBytes;
  }
  /**
   * @type {String}
   */
  get extensions() {
    return Object.keys(this._extensions).join();
  }
  /**
   * @type {Boolean}
   */
  get isPaused() {
    return this._paused;
  }
  /**
   * @type {Function}
   */
  /* istanbul ignore next */
  get onclose() {
    return null;
  }
  /**
   * @type {Function}
   */
  /* istanbul ignore next */
  get onerror() {
    return null;
  }
  /**
   * @type {Function}
   */
  /* istanbul ignore next */
  get onopen() {
    return null;
  }
  /**
   * @type {Function}
   */
  /* istanbul ignore next */
  get onmessage() {
    return null;
  }
  /**
   * @type {String}
   */
  get protocol() {
    return this._protocol;
  }
  /**
   * @type {Number}
   */
  get readyState() {
    return this._readyState;
  }
  /**
   * @type {String}
   */
  get url() {
    return this._url;
  }
  /**
   * Set up the socket and the internal resources.
   *
   * @param {Duplex} socket The network socket between the server and client
   * @param {Buffer} head The first packet of the upgraded stream
   * @param {Object} options Options object
   * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
   *     multiple times in the same tick
   * @param {Function} [options.generateMask] The function used to generate the
   *     masking key
   * @param {Number} [options.maxBufferedChunks=0] The maximum number of
   *     buffered data chunks
   * @param {Number} [options.maxFragments=0] The maximum number of message
   *     fragments
   * @param {Number} [options.maxPayload=0] The maximum allowed message size
   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
   *     not to skip UTF-8 validation for text and close messages
   * @private
   */
  setSocket(socket, head, options) {
    const receiver2 = new Receiver2({
      allowSynchronousEvents: options.allowSynchronousEvents,
      binaryType: this.binaryType,
      extensions: this._extensions,
      isServer: this._isServer,
      maxBufferedChunks: options.maxBufferedChunks,
      maxFragments: options.maxFragments,
      maxPayload: options.maxPayload,
      skipUTF8Validation: options.skipUTF8Validation
    });
    const sender2 = new Sender2(socket, this._extensions, options.generateMask);
    this._receiver = receiver2;
    this._sender = sender2;
    this._socket = socket;
    receiver2[kWebSocket$1] = this;
    sender2[kWebSocket$1] = this;
    socket[kWebSocket$1] = this;
    receiver2.on("conclude", receiverOnConclude);
    receiver2.on("drain", receiverOnDrain);
    receiver2.on("error", receiverOnError);
    receiver2.on("message", receiverOnMessage);
    receiver2.on("ping", receiverOnPing);
    receiver2.on("pong", receiverOnPong);
    sender2.onerror = senderOnError;
    if (socket.setTimeout) socket.setTimeout(0);
    if (socket.setNoDelay) socket.setNoDelay();
    if (head.length > 0) socket.unshift(head);
    socket.on("close", socketOnClose);
    socket.on("data", socketOnData);
    socket.on("end", socketOnEnd);
    socket.on("error", socketOnError$1);
    this._readyState = WebSocket.OPEN;
    this.emit("open");
  }
  /**
   * Emit the `'close'` event.
   *
   * @private
   */
  emitClose() {
    if (!this._socket) {
      this._readyState = WebSocket.CLOSED;
      this.emit("close", this._closeCode, this._closeMessage);
      return;
    }
    if (this._extensions[PerMessageDeflate$1.extensionName]) {
      this._extensions[PerMessageDeflate$1.extensionName].cleanup();
    }
    this._receiver.removeAllListeners();
    this._readyState = WebSocket.CLOSED;
    this.emit("close", this._closeCode, this._closeMessage);
  }
  /**
   * Start a closing handshake.
   *
   *          +----------+   +-----------+   +----------+
   *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
   *    |     +----------+   +-----------+   +----------+     |
   *          +----------+   +-----------+         |
   * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
   *          +----------+   +-----------+   |
   *    |           |                        |   +---+        |
   *                +------------------------+-->|fin| - - - -
   *    |         +---+                      |   +---+
   *     - - - - -|fin|<---------------------+
   *              +---+
   *
   * @param {Number} [code] Status code explaining why the connection is closing
   * @param {(String|Buffer)} [data] The reason why the connection is
   *     closing
   * @public
   */
  close(code, data) {
    if (this.readyState === WebSocket.CLOSED) return;
    if (this.readyState === WebSocket.CONNECTING) {
      const msg = "WebSocket was closed before the connection was established";
      abortHandshake$1(this, this._req, msg);
      return;
    }
    if (this.readyState === WebSocket.CLOSING) {
      if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
        this._socket.end();
      }
      return;
    }
    this._readyState = WebSocket.CLOSING;
    this._sender.close(code, data, !this._isServer, (err) => {
      if (err) return;
      this._closeFrameSent = true;
      if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
        this._socket.end();
      }
    });
    setCloseTimer(this);
  }
  /**
   * Pause the socket.
   *
   * @public
   */
  pause() {
    if (this.readyState === WebSocket.CONNECTING || this.readyState === WebSocket.CLOSED) {
      return;
    }
    this._paused = true;
    this._socket.pause();
  }
  /**
   * Send a ping.
   *
   * @param {*} [data] The data to send
   * @param {Boolean} [mask] Indicates whether or not to mask `data`
   * @param {Function} [cb] Callback which is executed when the ping is sent
   * @public
   */
  ping(data, mask2, cb) {
    if (this.readyState === WebSocket.CONNECTING) {
      throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
    }
    if (typeof data === "function") {
      cb = data;
      data = mask2 = void 0;
    } else if (typeof mask2 === "function") {
      cb = mask2;
      mask2 = void 0;
    }
    if (typeof data === "number") data = data.toString();
    if (this.readyState !== WebSocket.OPEN) {
      sendAfterClose(this, data, cb);
      return;
    }
    if (mask2 === void 0) mask2 = !this._isServer;
    this._sender.ping(data || EMPTY_BUFFER, mask2, cb);
  }
  /**
   * Send a pong.
   *
   * @param {*} [data] The data to send
   * @param {Boolean} [mask] Indicates whether or not to mask `data`
   * @param {Function} [cb] Callback which is executed when the pong is sent
   * @public
   */
  pong(data, mask2, cb) {
    if (this.readyState === WebSocket.CONNECTING) {
      throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
    }
    if (typeof data === "function") {
      cb = data;
      data = mask2 = void 0;
    } else if (typeof mask2 === "function") {
      cb = mask2;
      mask2 = void 0;
    }
    if (typeof data === "number") data = data.toString();
    if (this.readyState !== WebSocket.OPEN) {
      sendAfterClose(this, data, cb);
      return;
    }
    if (mask2 === void 0) mask2 = !this._isServer;
    this._sender.pong(data || EMPTY_BUFFER, mask2, cb);
  }
  /**
   * Resume the socket.
   *
   * @public
   */
  resume() {
    if (this.readyState === WebSocket.CONNECTING || this.readyState === WebSocket.CLOSED) {
      return;
    }
    this._paused = false;
    if (!this._receiver._writableState.needDrain) this._socket.resume();
  }
  /**
   * Send a data message.
   *
   * @param {*} data The message to send
   * @param {Object} [options] Options object
   * @param {Boolean} [options.binary] Specifies whether `data` is binary or
   *     text
   * @param {Boolean} [options.compress] Specifies whether or not to compress
   *     `data`
   * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
   *     last one
   * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
   * @param {Function} [cb] Callback which is executed when data is written out
   * @public
   */
  send(data, options, cb) {
    if (this.readyState === WebSocket.CONNECTING) {
      throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
    }
    if (typeof options === "function") {
      cb = options;
      options = {};
    }
    if (typeof data === "number") data = data.toString();
    if (this.readyState !== WebSocket.OPEN) {
      sendAfterClose(this, data, cb);
      return;
    }
    const opts = {
      binary: typeof data !== "string",
      mask: !this._isServer,
      compress: true,
      fin: true,
      ...options
    };
    if (!this._extensions[PerMessageDeflate$1.extensionName]) {
      opts.compress = false;
    }
    this._sender.send(data || EMPTY_BUFFER, opts, cb);
  }
  /**
   * Forcibly close the connection.
   *
   * @public
   */
  terminate() {
    if (this.readyState === WebSocket.CLOSED) return;
    if (this.readyState === WebSocket.CONNECTING) {
      const msg = "WebSocket was closed before the connection was established";
      abortHandshake$1(this, this._req, msg);
      return;
    }
    if (this._socket) {
      this._readyState = WebSocket.CLOSING;
      this._socket.destroy();
    }
  }
};
Object.defineProperty(WebSocket$1, "CONNECTING", {
  enumerable: true,
  value: readyStates.indexOf("CONNECTING")
});
Object.defineProperty(WebSocket$1.prototype, "CONNECTING", {
  enumerable: true,
  value: readyStates.indexOf("CONNECTING")
});
Object.defineProperty(WebSocket$1, "OPEN", {
  enumerable: true,
  value: readyStates.indexOf("OPEN")
});
Object.defineProperty(WebSocket$1.prototype, "OPEN", {
  enumerable: true,
  value: readyStates.indexOf("OPEN")
});
Object.defineProperty(WebSocket$1, "CLOSING", {
  enumerable: true,
  value: readyStates.indexOf("CLOSING")
});
Object.defineProperty(WebSocket$1.prototype, "CLOSING", {
  enumerable: true,
  value: readyStates.indexOf("CLOSING")
});
Object.defineProperty(WebSocket$1, "CLOSED", {
  enumerable: true,
  value: readyStates.indexOf("CLOSED")
});
Object.defineProperty(WebSocket$1.prototype, "CLOSED", {
  enumerable: true,
  value: readyStates.indexOf("CLOSED")
});
[
  "binaryType",
  "bufferedAmount",
  "extensions",
  "isPaused",
  "protocol",
  "readyState",
  "url"
].forEach((property) => {
  Object.defineProperty(WebSocket$1.prototype, property, { enumerable: true });
});
["open", "error", "close", "message"].forEach((method) => {
  Object.defineProperty(WebSocket$1.prototype, `on${method}`, {
    enumerable: true,
    get() {
      for (const listener of this.listeners(method)) {
        if (listener[kForOnEventAttribute]) return listener[kListener];
      }
      return null;
    },
    set(handler) {
      for (const listener of this.listeners(method)) {
        if (listener[kForOnEventAttribute]) {
          this.removeListener(method, listener);
          break;
        }
      }
      if (typeof handler !== "function") return;
      this.addEventListener(method, handler, {
        [kForOnEventAttribute]: true
      });
    }
  });
});
WebSocket$1.prototype.addEventListener = addEventListener;
WebSocket$1.prototype.removeEventListener = removeEventListener;
var websocket = WebSocket$1;
function initAsClient(websocket2, address, protocols, options) {
  const opts = {
    allowSynchronousEvents: true,
    autoPong: true,
    closeTimeout: CLOSE_TIMEOUT$1,
    protocolVersion: protocolVersions[1],
    maxBufferedChunks: 1024 * 1024,
    maxFragments: 128 * 1024,
    maxPayload: 100 * 1024 * 1024,
    skipUTF8Validation: false,
    perMessageDeflate: true,
    followRedirects: false,
    maxRedirects: 10,
    ...options,
    socketPath: void 0,
    hostname: void 0,
    protocol: void 0,
    timeout: void 0,
    method: "GET",
    host: void 0,
    path: void 0,
    port: void 0
  };
  websocket2._autoPong = opts.autoPong;
  websocket2._closeTimeout = opts.closeTimeout;
  if (!protocolVersions.includes(opts.protocolVersion)) {
    throw new RangeError(
      `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
    );
  }
  let parsedUrl;
  if (address instanceof URL$1) {
    parsedUrl = address;
  } else {
    try {
      parsedUrl = new URL$1(address);
    } catch {
      throw new SyntaxError(`Invalid URL: ${address}`);
    }
  }
  if (parsedUrl.protocol === "http:") {
    parsedUrl.protocol = "ws:";
  } else if (parsedUrl.protocol === "https:") {
    parsedUrl.protocol = "wss:";
  }
  websocket2._url = parsedUrl.href;
  const isSecure = parsedUrl.protocol === "wss:";
  const isIpcUrl = parsedUrl.protocol === "ws+unix:";
  let invalidUrlMessage;
  if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
    invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
  } else if (isIpcUrl && !parsedUrl.pathname) {
    invalidUrlMessage = "The URL's pathname is empty";
  } else if (parsedUrl.hash) {
    invalidUrlMessage = "The URL contains a fragment identifier";
  }
  if (invalidUrlMessage) {
    const err = new SyntaxError(invalidUrlMessage);
    if (websocket2._redirects === 0) {
      throw err;
    } else {
      emitErrorAndClose(websocket2, err);
      return;
    }
  }
  const defaultPort = isSecure ? 443 : 80;
  const key = randomBytes(16).toString("base64");
  const request = isSecure ? https.request : http$1.request;
  const protocolSet = /* @__PURE__ */ new Set();
  let perMessageDeflate;
  opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
  opts.defaultPort = opts.defaultPort || defaultPort;
  opts.port = parsedUrl.port || defaultPort;
  opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
  opts.headers = {
    ...opts.headers,
    "Sec-WebSocket-Version": opts.protocolVersion,
    "Sec-WebSocket-Key": key,
    Connection: "Upgrade",
    Upgrade: "websocket"
  };
  opts.path = parsedUrl.pathname + parsedUrl.search;
  opts.timeout = opts.handshakeTimeout;
  if (opts.perMessageDeflate) {
    perMessageDeflate = new PerMessageDeflate$1({
      ...opts.perMessageDeflate,
      isServer: false,
      maxPayload: opts.maxPayload
    });
    opts.headers["Sec-WebSocket-Extensions"] = format({
      [PerMessageDeflate$1.extensionName]: perMessageDeflate.offer()
    });
  }
  if (protocols.length) {
    for (const protocol of protocols) {
      if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
        throw new SyntaxError(
          "An invalid or duplicated subprotocol was specified"
        );
      }
      protocolSet.add(protocol);
    }
    opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
  }
  if (opts.origin) {
    if (opts.protocolVersion < 13) {
      opts.headers["Sec-WebSocket-Origin"] = opts.origin;
    } else {
      opts.headers.Origin = opts.origin;
    }
  }
  if (parsedUrl.username || parsedUrl.password) {
    opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
  }
  if (isIpcUrl) {
    const parts = opts.path.split(":");
    opts.socketPath = parts[0];
    opts.path = parts[1];
  }
  let req;
  if (opts.followRedirects) {
    if (websocket2._redirects === 0) {
      websocket2._originalIpc = isIpcUrl;
      websocket2._originalSecure = isSecure;
      websocket2._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
      const headers = options && options.headers;
      options = { ...options, headers: {} };
      if (headers) {
        for (const [key2, value] of Object.entries(headers)) {
          options.headers[key2.toLowerCase()] = value;
        }
      }
    } else if (websocket2.listenerCount("redirect") === 0) {
      const isSameHost = isIpcUrl ? websocket2._originalIpc ? opts.socketPath === websocket2._originalHostOrSocketPath : false : websocket2._originalIpc ? false : parsedUrl.host === websocket2._originalHostOrSocketPath;
      if (!isSameHost || websocket2._originalSecure && !isSecure) {
        delete opts.headers.authorization;
        delete opts.headers.cookie;
        if (!isSameHost) delete opts.headers.host;
        opts.auth = void 0;
      }
    }
    if (opts.auth && !options.headers.authorization) {
      options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
    }
    req = websocket2._req = request(opts);
    if (websocket2._redirects) {
      websocket2.emit("redirect", websocket2.url, req);
    }
  } else {
    req = websocket2._req = request(opts);
  }
  if (opts.timeout) {
    req.on("timeout", () => {
      abortHandshake$1(websocket2, req, "Opening handshake has timed out");
    });
  }
  req.on("error", (err) => {
    if (req === null || req[kAborted]) return;
    req = websocket2._req = null;
    emitErrorAndClose(websocket2, err);
  });
  req.on("response", (res) => {
    const location = res.headers.location;
    const statusCode = res.statusCode;
    if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
      if (++websocket2._redirects > opts.maxRedirects) {
        abortHandshake$1(websocket2, req, "Maximum redirects exceeded");
        return;
      }
      req.abort();
      let addr;
      try {
        addr = new URL$1(location, address);
      } catch (e) {
        const err = new SyntaxError(`Invalid URL: ${location}`);
        emitErrorAndClose(websocket2, err);
        return;
      }
      initAsClient(websocket2, addr, protocols, options);
    } else if (!websocket2.emit("unexpected-response", req, res)) {
      abortHandshake$1(
        websocket2,
        req,
        `Unexpected server response: ${res.statusCode}`
      );
    }
  });
  req.on("upgrade", (res, socket, head) => {
    websocket2.emit("upgrade", res);
    if (websocket2.readyState !== WebSocket$1.CONNECTING) return;
    req = websocket2._req = null;
    const upgrade = res.headers.upgrade;
    if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
      abortHandshake$1(websocket2, socket, "Invalid Upgrade header");
      return;
    }
    const digest = createHash$1("sha1").update(key + GUID$1).digest("base64");
    if (res.headers["sec-websocket-accept"] !== digest) {
      abortHandshake$1(websocket2, socket, "Invalid Sec-WebSocket-Accept header");
      return;
    }
    const serverProt = res.headers["sec-websocket-protocol"];
    let protError;
    if (serverProt !== void 0) {
      if (!protocolSet.size) {
        protError = "Server sent a subprotocol but none was requested";
      } else if (!protocolSet.has(serverProt)) {
        protError = "Server sent an invalid subprotocol";
      }
    } else if (protocolSet.size) {
      protError = "Server sent no subprotocol";
    }
    if (protError) {
      abortHandshake$1(websocket2, socket, protError);
      return;
    }
    if (serverProt) websocket2._protocol = serverProt;
    const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
    if (secWebSocketExtensions !== void 0) {
      if (!perMessageDeflate) {
        const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
        abortHandshake$1(websocket2, socket, message);
        return;
      }
      let extensions;
      try {
        extensions = parse$1(secWebSocketExtensions);
      } catch (err) {
        const message = "Invalid Sec-WebSocket-Extensions header";
        abortHandshake$1(websocket2, socket, message);
        return;
      }
      const extensionNames = Object.keys(extensions);
      if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate$1.extensionName) {
        const message = "Server indicated an extension that was not requested";
        abortHandshake$1(websocket2, socket, message);
        return;
      }
      try {
        perMessageDeflate.accept(extensions[PerMessageDeflate$1.extensionName]);
      } catch (err) {
        const message = "Invalid Sec-WebSocket-Extensions header";
        abortHandshake$1(websocket2, socket, message);
        return;
      }
      websocket2._extensions[PerMessageDeflate$1.extensionName] = perMessageDeflate;
    }
    websocket2.setSocket(socket, head, {
      allowSynchronousEvents: opts.allowSynchronousEvents,
      generateMask: opts.generateMask,
      maxBufferedChunks: opts.maxBufferedChunks,
      maxFragments: opts.maxFragments,
      maxPayload: opts.maxPayload,
      skipUTF8Validation: opts.skipUTF8Validation
    });
  });
  if (opts.finishRequest) {
    opts.finishRequest(req, websocket2);
  } else {
    req.end();
  }
}
function emitErrorAndClose(websocket2, err) {
  websocket2._readyState = WebSocket$1.CLOSING;
  websocket2._errorEmitted = true;
  websocket2.emit("error", err);
  websocket2.emitClose();
}
function netConnect(options) {
  options.path = options.socketPath;
  return net.connect(options);
}
function tlsConnect(options) {
  options.path = void 0;
  if (!options.servername && options.servername !== "") {
    options.servername = net.isIP(options.host) ? "" : options.host;
  }
  return tls.connect(options);
}
function abortHandshake$1(websocket2, stream, message) {
  websocket2._readyState = WebSocket$1.CLOSING;
  const err = new Error(message);
  Error.captureStackTrace(err, abortHandshake$1);
  if (stream.setHeader) {
    stream[kAborted] = true;
    stream.abort();
    if (stream.socket && !stream.socket.destroyed) {
      stream.socket.destroy();
    }
    process.nextTick(emitErrorAndClose, websocket2, err);
  } else {
    stream.destroy(err);
    stream.once("error", websocket2.emit.bind(websocket2, "error"));
    stream.once("close", websocket2.emitClose.bind(websocket2));
  }
}
function sendAfterClose(websocket2, data, cb) {
  if (data) {
    const length = isBlob(data) ? data.size : toBuffer(data).length;
    if (websocket2._socket) websocket2._sender._bufferedBytes += length;
    else websocket2._bufferedAmount += length;
  }
  if (cb) {
    const err = new Error(
      `WebSocket is not open: readyState ${websocket2.readyState} (${readyStates[websocket2.readyState]})`
    );
    process.nextTick(cb, err);
  }
}
function receiverOnConclude(code, reason) {
  const websocket2 = this[kWebSocket$1];
  websocket2._closeFrameReceived = true;
  websocket2._closeMessage = reason;
  websocket2._closeCode = code;
  if (websocket2._socket[kWebSocket$1] === void 0) return;
  websocket2._socket.removeListener("data", socketOnData);
  process.nextTick(resume, websocket2._socket);
  if (code === 1005) websocket2.close();
  else websocket2.close(code, reason);
}
function receiverOnDrain() {
  const websocket2 = this[kWebSocket$1];
  if (!websocket2.isPaused) websocket2._socket.resume();
}
function receiverOnError(err) {
  const websocket2 = this[kWebSocket$1];
  if (websocket2._socket[kWebSocket$1] !== void 0) {
    websocket2._socket.removeListener("data", socketOnData);
    process.nextTick(resume, websocket2._socket);
    websocket2.close(err[kStatusCode]);
  }
  if (!websocket2._errorEmitted) {
    websocket2._errorEmitted = true;
    websocket2.emit("error", err);
  }
}
function receiverOnFinish() {
  this[kWebSocket$1].emitClose();
}
function receiverOnMessage(data, isBinary) {
  this[kWebSocket$1].emit("message", data, isBinary);
}
function receiverOnPing(data) {
  const websocket2 = this[kWebSocket$1];
  if (websocket2._autoPong) websocket2.pong(data, !this._isServer, NOOP);
  websocket2.emit("ping", data);
}
function receiverOnPong(data) {
  this[kWebSocket$1].emit("pong", data);
}
function resume(stream) {
  stream.resume();
}
function senderOnError(err) {
  const websocket2 = this[kWebSocket$1];
  if (websocket2.readyState === WebSocket$1.CLOSED) return;
  if (websocket2.readyState === WebSocket$1.OPEN) {
    websocket2._readyState = WebSocket$1.CLOSING;
    setCloseTimer(websocket2);
  }
  this._socket.end();
  if (!websocket2._errorEmitted) {
    websocket2._errorEmitted = true;
    websocket2.emit("error", err);
  }
}
function setCloseTimer(websocket2) {
  websocket2._closeTimer = setTimeout(
    websocket2._socket.destroy.bind(websocket2._socket),
    websocket2._closeTimeout
  );
}
function socketOnClose() {
  const websocket2 = this[kWebSocket$1];
  this.removeListener("close", socketOnClose);
  this.removeListener("data", socketOnData);
  this.removeListener("end", socketOnEnd);
  websocket2._readyState = WebSocket$1.CLOSING;
  if (!this._readableState.endEmitted && !websocket2._closeFrameReceived && !websocket2._receiver._writableState.errorEmitted && this._readableState.length !== 0) {
    const chunk = this.read(this._readableState.length);
    websocket2._receiver.write(chunk);
  }
  websocket2._receiver.end();
  this[kWebSocket$1] = void 0;
  clearTimeout(websocket2._closeTimer);
  if (websocket2._receiver._writableState.finished || websocket2._receiver._writableState.errorEmitted) {
    websocket2.emitClose();
  } else {
    websocket2._receiver.on("error", receiverOnFinish);
    websocket2._receiver.on("finish", receiverOnFinish);
  }
}
function socketOnData(chunk) {
  if (!this[kWebSocket$1]._receiver.write(chunk)) {
    this.pause();
  }
}
function socketOnEnd() {
  const websocket2 = this[kWebSocket$1];
  websocket2._readyState = WebSocket$1.CLOSING;
  websocket2._receiver.end();
  this.end();
}
function socketOnError$1() {
  const websocket2 = this[kWebSocket$1];
  this.removeListener("error", socketOnError$1);
  this.on("error", NOOP);
  if (websocket2) {
    websocket2._readyState = WebSocket$1.CLOSING;
    this.destroy();
  }
}
const WebSocket$2 = /* @__PURE__ */ getDefaultExportFromCjs(websocket);
const { Duplex: Duplex$1 } = require$$0$2;
const { tokenChars } = validationExports;
function parse(header) {
  const protocols = /* @__PURE__ */ new Set();
  let start = -1;
  let end = -1;
  let i = 0;
  for (i; i < header.length; i++) {
    const code = header.charCodeAt(i);
    if (end === -1 && tokenChars[code] === 1) {
      if (start === -1) start = i;
    } else if (i !== 0 && (code === 32 || code === 9)) {
      if (end === -1 && start !== -1) end = i;
    } else if (code === 44) {
      if (start === -1) {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
      if (end === -1) end = i;
      const protocol2 = header.slice(start, end);
      if (protocols.has(protocol2)) {
        throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
      }
      protocols.add(protocol2);
      start = end = -1;
    } else {
      throw new SyntaxError(`Unexpected character at index ${i}`);
    }
  }
  if (start === -1 || end !== -1) {
    throw new SyntaxError("Unexpected end of input");
  }
  const protocol = header.slice(start, i);
  if (protocols.has(protocol)) {
    throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
  }
  protocols.add(protocol);
  return protocols;
}
var subprotocol$1 = { parse };
const EventEmitter = require$$0$4;
const http = require$$2$3;
const { Duplex } = require$$0$2;
const { createHash } = require$$0$3;
const extension = extension$1;
const PerMessageDeflate2 = permessageDeflate;
const subprotocol = subprotocol$1;
const WebSocket2 = websocket;
const { CLOSE_TIMEOUT, GUID, kWebSocket } = constants;
const keyRegex = /^[+/0-9A-Za-z]{22}==$/;
const RUNNING = 0;
const CLOSING = 1;
const CLOSED = 2;
class WebSocketServer extends EventEmitter {
  /**
   * Create a `WebSocketServer` instance.
   *
   * @param {Object} options Configuration options
   * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
   *     multiple times in the same tick
   * @param {Boolean} [options.autoPong=true] Specifies whether or not to
   *     automatically send a pong in response to a ping
   * @param {Number} [options.backlog=511] The maximum length of the queue of
   *     pending connections
   * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
   *     track clients
   * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
   *     wait for the closing handshake to finish after `websocket.close()` is
   *     called
   * @param {Function} [options.handleProtocols] A hook to handle protocols
   * @param {String} [options.host] The hostname where to bind the server
   * @param {Number} [options.maxBufferedChunks=1048576] The maximum number of
   *     buffered data chunks
   * @param {Number} [options.maxFragments=131072] The maximum number of message
   *     fragments
   * @param {Number} [options.maxPayload=104857600] The maximum allowed message
   *     size
   * @param {Boolean} [options.noServer=false] Enable no server mode
   * @param {String} [options.path] Accept only connections matching this path
   * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
   *     permessage-deflate
   * @param {Number} [options.port] The port where to bind the server
   * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
   *     server to use
   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
   *     not to skip UTF-8 validation for text and close messages
   * @param {Function} [options.verifyClient] A hook to reject connections
   * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
   *     class to use. It must be the `WebSocket` class or class that extends it
   * @param {Function} [callback] A listener for the `listening` event
   */
  constructor(options, callback) {
    super();
    options = {
      allowSynchronousEvents: true,
      autoPong: true,
      maxBufferedChunks: 1024 * 1024,
      maxFragments: 128 * 1024,
      maxPayload: 100 * 1024 * 1024,
      skipUTF8Validation: false,
      perMessageDeflate: false,
      handleProtocols: null,
      clientTracking: true,
      closeTimeout: CLOSE_TIMEOUT,
      verifyClient: null,
      noServer: false,
      backlog: null,
      // use default (511 as implemented in net.js)
      server: null,
      host: null,
      path: null,
      port: null,
      WebSocket: WebSocket2,
      ...options
    };
    if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
      throw new TypeError(
        'One and only one of the "port", "server", or "noServer" options must be specified'
      );
    }
    if (options.port != null) {
      this._server = http.createServer((req, res) => {
        const body = http.STATUS_CODES[426];
        res.writeHead(426, {
          "Content-Length": body.length,
          "Content-Type": "text/plain"
        });
        res.end(body);
      });
      this._server.listen(
        options.port,
        options.host,
        options.backlog,
        callback
      );
    } else if (options.server) {
      this._server = options.server;
    }
    if (this._server) {
      const emitConnection = this.emit.bind(this, "connection");
      this._removeListeners = addListeners(this._server, {
        listening: this.emit.bind(this, "listening"),
        error: this.emit.bind(this, "error"),
        upgrade: (req, socket, head) => {
          this.handleUpgrade(req, socket, head, emitConnection);
        }
      });
    }
    if (options.perMessageDeflate === true) options.perMessageDeflate = {};
    if (options.clientTracking) {
      this.clients = /* @__PURE__ */ new Set();
      this._shouldEmitClose = false;
    }
    this.options = options;
    this._state = RUNNING;
  }
  /**
   * Returns the bound address, the address family name, and port of the server
   * as reported by the operating system if listening on an IP socket.
   * If the server is listening on a pipe or UNIX domain socket, the name is
   * returned as a string.
   *
   * @return {(Object|String|null)} The address of the server
   * @public
   */
  address() {
    if (this.options.noServer) {
      throw new Error('The server is operating in "noServer" mode');
    }
    if (!this._server) return null;
    return this._server.address();
  }
  /**
   * Stop the server from accepting new connections and emit the `'close'` event
   * when all existing connections are closed.
   *
   * @param {Function} [cb] A one-time listener for the `'close'` event
   * @public
   */
  close(cb) {
    if (this._state === CLOSED) {
      if (cb) {
        this.once("close", () => {
          cb(new Error("The server is not running"));
        });
      }
      process.nextTick(emitClose, this);
      return;
    }
    if (cb) this.once("close", cb);
    if (this._state === CLOSING) return;
    this._state = CLOSING;
    if (this.options.noServer || this.options.server) {
      if (this._server) {
        this._removeListeners();
        this._removeListeners = this._server = null;
      }
      if (this.clients) {
        if (!this.clients.size) {
          process.nextTick(emitClose, this);
        } else {
          this._shouldEmitClose = true;
        }
      } else {
        process.nextTick(emitClose, this);
      }
    } else {
      const server = this._server;
      this._removeListeners();
      this._removeListeners = this._server = null;
      server.close(() => {
        emitClose(this);
      });
    }
  }
  /**
   * See if a given request should be handled by this server instance.
   *
   * @param {http.IncomingMessage} req Request object to inspect
   * @return {Boolean} `true` if the request is valid, else `false`
   * @public
   */
  shouldHandle(req) {
    if (this.options.path) {
      const index = req.url.indexOf("?");
      const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
      if (pathname !== this.options.path) return false;
    }
    return true;
  }
  /**
   * Handle a HTTP Upgrade request.
   *
   * @param {http.IncomingMessage} req The request object
   * @param {Duplex} socket The network socket between the server and client
   * @param {Buffer} head The first packet of the upgraded stream
   * @param {Function} cb Callback
   * @public
   */
  handleUpgrade(req, socket, head, cb) {
    socket.on("error", socketOnError);
    const key = req.headers["sec-websocket-key"];
    const upgrade = req.headers.upgrade;
    const version = +req.headers["sec-websocket-version"];
    if (req.method !== "GET") {
      const message = "Invalid HTTP method";
      abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
      return;
    }
    if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
      const message = "Invalid Upgrade header";
      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
      return;
    }
    if (key === void 0 || !keyRegex.test(key)) {
      const message = "Missing or invalid Sec-WebSocket-Key header";
      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
      return;
    }
    if (version !== 13 && version !== 8) {
      const message = "Missing or invalid Sec-WebSocket-Version header";
      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
        "Sec-WebSocket-Version": "13, 8"
      });
      return;
    }
    if (!this.shouldHandle(req)) {
      abortHandshake(socket, 400);
      return;
    }
    const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
    let protocols = /* @__PURE__ */ new Set();
    if (secWebSocketProtocol !== void 0) {
      try {
        protocols = subprotocol.parse(secWebSocketProtocol);
      } catch (err) {
        const message = "Invalid Sec-WebSocket-Protocol header";
        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
        return;
      }
    }
    const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
    const extensions = {};
    if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
      const perMessageDeflate = new PerMessageDeflate2({
        ...this.options.perMessageDeflate,
        isServer: true,
        maxPayload: this.options.maxPayload
      });
      try {
        const offers = extension.parse(secWebSocketExtensions);
        if (offers[PerMessageDeflate2.extensionName]) {
          perMessageDeflate.accept(offers[PerMessageDeflate2.extensionName]);
          extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
        }
      } catch (err) {
        const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
        return;
      }
    }
    if (this.options.verifyClient) {
      const info = {
        origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
        secure: !!(req.socket.authorized || req.socket.encrypted),
        req
      };
      if (this.options.verifyClient.length === 2) {
        this.options.verifyClient(info, (verified, code, message, headers) => {
          if (!verified) {
            return abortHandshake(socket, code || 401, message, headers);
          }
          this.completeUpgrade(
            extensions,
            key,
            protocols,
            req,
            socket,
            head,
            cb
          );
        });
        return;
      }
      if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
    }
    this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
  }
  /**
   * Upgrade the connection to WebSocket.
   *
   * @param {Object} extensions The accepted extensions
   * @param {String} key The value of the `Sec-WebSocket-Key` header
   * @param {Set} protocols The subprotocols
   * @param {http.IncomingMessage} req The request object
   * @param {Duplex} socket The network socket between the server and client
   * @param {Buffer} head The first packet of the upgraded stream
   * @param {Function} cb Callback
   * @throws {Error} If called more than once with the same socket
   * @private
   */
  completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
    if (!socket.readable || !socket.writable) return socket.destroy();
    if (socket[kWebSocket]) {
      throw new Error(
        "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
      );
    }
    if (this._state > RUNNING) return abortHandshake(socket, 503);
    const digest = createHash("sha1").update(key + GUID).digest("base64");
    const headers = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${digest}`
    ];
    const ws = new this.options.WebSocket(null, void 0, this.options);
    if (protocols.size) {
      const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
      if (protocol) {
        headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
        ws._protocol = protocol;
      }
    }
    if (extensions[PerMessageDeflate2.extensionName]) {
      const params = extensions[PerMessageDeflate2.extensionName].params;
      const value = extension.format({
        [PerMessageDeflate2.extensionName]: [params]
      });
      headers.push(`Sec-WebSocket-Extensions: ${value}`);
      ws._extensions = extensions;
    }
    this.emit("headers", headers, req);
    socket.write(headers.concat("\r\n").join("\r\n"));
    socket.removeListener("error", socketOnError);
    ws.setSocket(socket, head, {
      allowSynchronousEvents: this.options.allowSynchronousEvents,
      maxBufferedChunks: this.options.maxBufferedChunks,
      maxFragments: this.options.maxFragments,
      maxPayload: this.options.maxPayload,
      skipUTF8Validation: this.options.skipUTF8Validation
    });
    if (this.clients) {
      this.clients.add(ws);
      ws.on("close", () => {
        this.clients.delete(ws);
        if (this._shouldEmitClose && !this.clients.size) {
          process.nextTick(emitClose, this);
        }
      });
    }
    cb(ws, req);
  }
}
var websocketServer = WebSocketServer;
function addListeners(server, map) {
  for (const event of Object.keys(map)) server.on(event, map[event]);
  return function removeListeners() {
    for (const event of Object.keys(map)) {
      server.removeListener(event, map[event]);
    }
  };
}
function emitClose(server) {
  server._state = CLOSED;
  server.emit("close");
}
function socketOnError() {
  this.destroy();
}
function abortHandshake(socket, code, message, headers) {
  message = message || http.STATUS_CODES[code];
  headers = {
    Connection: "close",
    "Content-Type": "text/html",
    "Content-Length": Buffer.byteLength(message),
    ...headers
  };
  socket.once("finish", socket.destroy);
  socket.end(
    `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
  );
}
function abortHandshakeOrEmitwsClientError(server, req, socket, code, message, headers) {
  if (server.listenerCount("wsClientError")) {
    const err = new Error(message);
    Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
    server.emit("wsClientError", err, socket, req);
  } else {
    abortHandshake(socket, code, message, headers);
  }
}
const WebSocketServer$1 = /* @__PURE__ */ getDefaultExportFromCjs(websocketServer);
class ServerProxy {
  server = null;
  wss = null;
  localUpstream;
  openPairs = /* @__PURE__ */ new Set();
  perServerPairs = /* @__PURE__ */ new Set();
  resolver = null;
  port = null;
  constructor(localUpstream) {
    this.localUpstream = localUpstream;
  }
  // `preferredPort` keeps the renderer origin (http://127.0.0.1:<port>) STABLE
  // across restarts. localStorage is keyed by origin, so a random port each
  // launch would orphan all persisted state (subscriptions, theme, layout). We
  // try the preferred port first and only fall back to a free one if it's taken.
  async start(preferredPort) {
    this.server = http$2.createServer((req, res) => this.handleRequest(req, res));
    this.wss = new WebSocketServer$1({ noServer: true });
    this.server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head));
    const tryListen = (p) => new Promise((resolve) => {
      const onError2 = (err) => {
        if (err.code === "EADDRINUSE") {
          this.server.removeListener("error", onError2);
          resolve(false);
        }
      };
      this.server.once("error", onError2);
      this.server.listen(p, "127.0.0.1", () => {
        this.server.removeListener("error", onError2);
        resolve(true);
      });
    });
    let port = preferredPort ?? 0;
    if (!preferredPort || !await tryListen(preferredPort)) {
      port = await getFreePort$1();
      await new Promise((resolve) => this.server.listen(port, "127.0.0.1", resolve));
    }
    this.port = port;
    return { port };
  }
  setResolver(fn) {
    this.resolver = fn;
  }
  getPort() {
    return this.port;
  }
  authHeaders(base) {
    const headers = { ...base };
    if (this.localUpstream.token) headers["authorization"] = `Bearer ${this.localUpstream.token}`;
    return headers;
  }
  handleRequest(req, res) {
    const srvMatch = (req.url ?? "").match(/^\/srv\/([^/]+)(\/.*)$/);
    if (srvMatch) {
      const id = decodeURIComponent(srvMatch[1]);
      const target = this.resolver ? this.resolver(id) : null;
      if (!target) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("unknown server");
        return;
      }
      const rest = srvMatch[2];
      const headers = { ...req.headers };
      delete headers.host;
      if (target.token) headers["authorization"] = `Bearer ${target.token}`;
      const proxyReq2 = http$2.request(
        { host: target.host, port: target.port, method: req.method, path: rest, headers },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );
      proxyReq2.on("error", () => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
        res.end("upstream error");
      });
      req.pipe(proxyReq2);
      return;
    }
    const up = this.localUpstream;
    const proxyReq = http$2.request(
      { host: up.host, port: up.port, method: req.method, path: req.url, headers: this.authHeaders(req.headers) },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("upstream error");
    });
    req.pipe(proxyReq);
  }
  handleUpgrade(req, socket, head) {
    if (!this.wss) {
      socket.destroy();
      return;
    }
    const perServerMatch = (req.url ?? "").match(/^\/_per-server\/([^/]+)(\/.*)?$/);
    if (perServerMatch && this.resolver) {
      const serverId = decodeURIComponent(perServerMatch[1]);
      const rest = perServerMatch[2] || "/";
      const target = this.resolver(serverId);
      if (!target) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (client) => {
        const headers = {};
        if (target.token) headers["authorization"] = `Bearer ${target.token}`;
        const upConn = new WebSocket$2(`ws://${target.host}:${target.port}${rest}`, { headers });
        const pair = { client, up: upConn };
        this.perServerPairs.add(pair);
        this.wireBridge(client, upConn, pair, this.perServerPairs);
      });
      return;
    }
    const srvWsMatch = (req.url ?? "").match(/^\/srv\/([^/]+)(\/.*)$/);
    if (srvWsMatch && this.resolver) {
      const id = decodeURIComponent(srvWsMatch[1]);
      const rest = srvWsMatch[2] || "/";
      const target = this.resolver(id);
      if (!target) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (client) => {
        const headers = {};
        if (target.token) headers["authorization"] = `Bearer ${target.token}`;
        const upConn = new WebSocket$2(`ws://${target.host}:${target.port}${rest}`, { headers });
        const pair = { client, up: upConn };
        this.perServerPairs.add(pair);
        this.wireBridge(client, upConn, pair, this.perServerPairs);
      });
      return;
    }
    const up = this.localUpstream;
    this.wss.handleUpgrade(req, socket, head, (client) => {
      const headers = {};
      if (up.token) headers["authorization"] = `Bearer ${up.token}`;
      const upConn = new WebSocket$2(`ws://${up.host}:${up.port}${req.url}`, { headers });
      const pair = { client, up: upConn };
      this.openPairs.add(pair);
      this.wireBridge(client, upConn, pair, this.openPairs);
    });
  }
  wireBridge(client, upConn, pair, owner) {
    {
      const cleanup = () => {
        owner.delete(pair);
        try {
          client.terminate();
        } catch {
        }
        try {
          upConn.terminate();
        } catch {
        }
      };
      const pending = [];
      upConn.on("open", () => {
        for (const m of pending) upConn.send(m.data, { binary: m.isBinary });
        pending.length = 0;
      });
      client.on("message", (data, isBinary) => {
        if (upConn.readyState === WebSocket$2.OPEN) upConn.send(data, { binary: isBinary });
        else pending.push({ data, isBinary });
      });
      upConn.on("message", (data, isBinary) => {
        if (client.readyState === WebSocket$2.OPEN) client.send(data, { binary: isBinary });
      });
      client.on("close", cleanup);
      upConn.on("close", cleanup);
      client.on("error", cleanup);
      upConn.on("error", cleanup);
    }
  }
  async stop() {
    for (const pair of this.openPairs) {
      try {
        pair.client.terminate();
      } catch {
      }
      try {
        pair.up.terminate();
      } catch {
      }
    }
    this.openPairs.clear();
    for (const pair of this.perServerPairs) {
      try {
        pair.client.terminate();
      } catch {
      }
      try {
        pair.up.terminate();
      } catch {
      }
    }
    this.perServerPairs.clear();
    this.wss?.close();
    await new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
    this.port = null;
  }
}
const ICON_POOL = [
  "Circle",
  "Square",
  "Triangle",
  "Diamond",
  "Hexagon",
  "Star",
  "Heart",
  "Cloud",
  "Sun",
  "Moon",
  "Zap",
  "Flame",
  "Leaf",
  "Flag",
  "Anchor",
  "Box",
  "Compass",
  "Crown",
  "Feather",
  "Gem",
  "Globe",
  "Key",
  "Lock",
  "Mountain",
  "Rocket",
  "Shield",
  "Snowflake",
  "Sparkles",
  "Target",
  "Tent"
];
function pickIcon(taken) {
  const available = ICON_POOL.filter((i) => !taken.has(i));
  const pool = available.length > 0 ? available : ICON_POOL;
  return pool[Math.floor(Math.random() * pool.length)];
}
class ConnectionStore {
  entries = /* @__PURE__ */ new Map();
  // Runtime-learned server capabilities (e.g. tmux support). NOT persisted —
  // re-detected on each app launch since features may be enabled/disabled
  // server-side between sessions.
  capabilities = /* @__PURE__ */ new Map();
  // host:port of local servers the user explicitly forgot, so refreshLocal
  // doesn't auto-re-add them while the instance is still alive.
  forgotten = /* @__PURE__ */ new Set();
  userDataDir;
  instancesDir;
  safeStorage;
  serversFile;
  constructor(opts = {}) {
    this.userDataDir = opts.userDataDir ?? requireElectron().app.getPath("userData");
    this.instancesDir = opts.instancesDir ?? path.join(os.homedir(), ".mermaid-collab", "instances");
    this.safeStorage = opts.safeStorage ?? requireElectron().safeStorage;
    this.serversFile = path.join(this.userDataDir, "servers.json");
  }
  async init() {
    await promises.mkdir(this.userDataDir, { recursive: true });
    try {
      const raw = await promises.readFile(this.serversFile, "utf-8");
      const parsed = JSON.parse(raw);
      this.entries.clear();
      this.forgotten = new Set(parsed.forgotten ?? []);
      for (const p of parsed.entries ?? []) {
        const { encryptedToken, ...rest } = p;
        const entry = { ...rest };
        if (encryptedToken && encryptedToken.length > 0) {
          try {
            entry.token = this.safeStorage.decryptString(Buffer.from(encryptedToken));
          } catch {
          }
        }
        this.entries.set(entry.id, entry);
      }
    } catch {
    }
    let patched = false;
    const poolSet = new Set(ICON_POOL);
    const taken = /* @__PURE__ */ new Set();
    for (const e of this.entries.values()) {
      if (e.icon && poolSet.has(e.icon)) taken.add(e.icon);
    }
    for (const e of this.entries.values()) {
      if (!e.icon || !poolSet.has(e.icon)) {
        e.icon = pickIcon(taken);
        taken.add(e.icon);
        patched = true;
      }
    }
    if (patched) await this.persist();
  }
  takenIcons() {
    const s = /* @__PURE__ */ new Set();
    for (const e of this.entries.values()) if (e.icon) s.add(e.icon);
    return s;
  }
  /** Renderer-facing list — never includes tokens. */
  list() {
    return Array.from(this.entries.values()).map(({ token: _token, ...rest }) => rest);
  }
  get(id) {
    return this.entries.get(id) ?? null;
  }
  add(opts) {
    const id = node_crypto.randomUUID();
    this.entries.set(id, {
      id,
      label: opts.label,
      host: opts.host,
      port: opts.port,
      token: opts.token,
      status: "offline",
      source: "manual",
      icon: pickIcon(this.takenIcons())
    });
    void this.persist();
    return id;
  }
  remove(id) {
    const e = this.entries.get(id);
    if (e?.source === "local") this.forgotten.add(`${e.host}:${e.port}`);
    this.entries.delete(id);
    this.capabilities.delete(id);
    void this.persist();
  }
  getServerCapabilities(id) {
    return this.capabilities.get(id) ?? { tmux: true };
  }
  setServerCapabilities(id, caps) {
    if (!this.entries.has(id)) return;
    const current = this.capabilities.get(id) ?? { tmux: false };
    this.capabilities.set(id, { ...current, ...caps });
  }
  /** Sync the `source:'local'` entries with the live instance registry. */
  async refreshLocal() {
    let files;
    try {
      files = await promises.readdir(this.instancesDir);
    } catch {
      this.pruneLocalNotIn(/* @__PURE__ */ new Set());
      return;
    }
    const liveKeys = /* @__PURE__ */ new Set();
    const manualKeys = new Set(
      Array.from(this.entries.values()).filter((e) => e.source === "manual").map((e) => `${e.host}:${e.port}`)
    );
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      let inst;
      try {
        inst = JSON.parse(await promises.readFile(path.join(this.instancesDir, f), "utf-8"));
      } catch {
        continue;
      }
      if (typeof inst.port !== "number") continue;
      const key = `127.0.0.1:${inst.port}`;
      liveKeys.add(key);
      if (manualKeys.has(key)) continue;
      if (this.forgotten.has(key)) continue;
      const localLabel = os.hostname();
      const existing = Array.from(this.entries.values()).find(
        (e) => e.source === "local" && `${e.host}:${e.port}` === key
      );
      if (existing) {
        existing.label = localLabel;
        existing.lastProject = inst.project;
        existing.lastSession = inst.session;
      } else {
        const id = node_crypto.randomUUID();
        this.entries.set(id, {
          id,
          label: localLabel,
          host: "127.0.0.1",
          port: inst.port,
          status: "offline",
          source: "local",
          lastProject: inst.project,
          lastSession: inst.session,
          icon: pickIcon(this.takenIcons())
        });
      }
    }
    this.pruneLocalNotIn(liveKeys);
    await this.persist();
  }
  pruneLocalNotIn(liveKeys) {
    for (const [id, e] of this.entries) {
      if (e.source === "local" && !liveKeys.has(`${e.host}:${e.port}`)) {
        this.entries.delete(id);
        this.capabilities.delete(id);
      }
    }
  }
  async persist() {
    const entries = Array.from(this.entries.values()).map((e) => {
      const { token, ...rest } = e;
      const p = { ...rest };
      if (token) p.encryptedToken = Array.from(this.safeStorage.encryptString(token));
      return p;
    });
    await promises.mkdir(path.dirname(this.serversFile), { recursive: true });
    await promises.writeFile(this.serversFile, JSON.stringify({ entries, forgotten: [...this.forgotten] }, null, 2));
  }
}
function requireElectron() {
  return require("electron");
}
const WATCHED_TYPES = /* @__PURE__ */ new Set(["claude_session_registered", "claude_session_status", "claude_context_update"]);
class WatchAggregator {
  constructor(forward, onOpen) {
    this.forward = forward;
    this.onOpen = onOpen;
  }
  conns = /* @__PURE__ */ new Map();
  removed = /* @__PURE__ */ new Set();
  /** Broadcast a JSON message to every currently-open upstream ws. */
  broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const c of this.conns.values()) {
      try {
        if (c.ws && c.ws.readyState === WebSocket$2.OPEN) c.ws.send(payload);
      } catch {
      }
    }
  }
  setWatched(servers) {
    const incoming = new Set(servers.map((s) => s.id));
    for (const id of [...this.conns.keys()]) if (!incoming.has(id)) this.disconnect(id);
    for (const s of servers) if (!this.conns.has(s.id)) this.connect(s);
  }
  connect(s) {
    this.removed.delete(s.id);
    const prev = this.conns.get(s.id);
    const prevAttempt = prev?.attempt ?? 0;
    if (prev) {
      if (prev.timer) {
        clearTimeout(prev.timer);
        prev.timer = null;
      }
      try {
        prev.ws.removeAllListeners();
        prev.ws.terminate();
      } catch {
      }
    }
    const ws = new WebSocket$2(`ws://${s.host}:${s.port}/ws`, s.token ? { headers: { authorization: `Bearer ${s.token}` } } : void 0);
    this.conns.set(s.id, { ws, attempt: prevAttempt, timer: null });
    ws.on("open", () => {
      const st = this.conns.get(s.id);
      if (st) st.attempt = 0;
      this.onOpen?.(s.id);
    });
    ws.on("message", (data) => {
      try {
        const m = JSON.parse(data.toString());
        if (m && WATCHED_TYPES.has(m.type)) this.forward({ ...m, serverId: s.id });
      } catch {
      }
    });
    ws.on("close", () => this.scheduleReconnect(s));
    ws.on("error", () => this.scheduleReconnect(s));
  }
  scheduleReconnect(s) {
    if (this.removed.has(s.id)) return;
    const state = this.conns.get(s.id);
    if (!state) return;
    if (state.timer !== null) return;
    const delay = Math.min(15e3, 1e3 * Math.pow(2, state.attempt));
    state.timer = setTimeout(() => {
      state.timer = null;
      if (this.removed.has(s.id)) return;
      const cur = this.conns.get(s.id);
      if (!cur) return;
      cur.attempt++;
      this.connect(s);
    }, delay);
  }
  disconnect(id) {
    this.removed.add(id);
    const state = this.conns.get(id);
    if (!state) return;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    try {
      state.ws.terminate();
    } catch {
    }
    this.conns.delete(id);
  }
  stop() {
    for (const id of [...this.conns.keys()]) this.disconnect(id);
    this.conns.clear();
  }
}
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net$1.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}
async function enableCdp(app, opts) {
  const envPort = process.env.MC_CDP_PORT ? Number(process.env.MC_CDP_PORT) : void 0;
  const candidate = opts?.port ?? envPort;
  const port = candidate !== void 0 && Number.isFinite(candidate) && candidate > 0 ? candidate : await getFreePort();
  app.commandLine.appendSwitch("remote-debugging-port", String(port));
  app.commandLine.appendSwitch("remote-debugging-address", opts?.address ?? "127.0.0.1");
  return port;
}
async function publishDiscovery(opts) {
  try {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let wsUrl;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const res = await fetch("http://127.0.0.1:" + opts.port + "/json/list");
        const targets = await res.json();
        const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (page) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
        await sleep(300);
      } catch {
        await sleep(300);
      }
    }
    if (!wsUrl) {
      console.warn("[electron-agent-bridge] no CDP page target found after retries; writing port-only discovery record");
    }
    const outPath = opts.path ?? path.join(os.homedir(), "." + opts.appName, "electron-cdp.json");
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, JSON.stringify({
      port: opts.port,
      webSocketDebuggerUrl: wsUrl,
      pid: process.pid,
      appName: opts.appName
    }, null, 2));
  } catch (err) {
    console.warn("[electron-agent-bridge] publishDiscovery failed (non-fatal):", err);
  }
}
const gotLock = require$$1.app.requestSingleInstanceLock();
if (!gotLock) {
  require$$1.app.quit();
}
let supervisor = null;
let paneManager = null;
let proxy = null;
let store = null;
let control = null;
let aggregator = null;
function registerIpc() {
  require$$1.ipcMain.handle("mc:listServers", () => store?.list() ?? []);
  require$$1.ipcMain.handle(
    "mc:addServer",
    (_e, opts) => store?.add(opts) ?? null
  );
  require$$1.ipcMain.handle("mc:removeServer", (_e, id) => {
    store?.remove(id);
  });
  require$$1.ipcMain.handle("mc:browser:listTabs", () => paneManager?.listTabs() ?? []);
  require$$1.ipcMain.handle("mc:browser:openTab", (_e, opts) => paneManager?.openUserTab(opts ?? {}) ?? null);
  require$$1.ipcMain.handle("mc:browser:closeTab", (_e, id) => {
    paneManager?.closeTab(id);
  });
  require$$1.ipcMain.handle("mc:browser:activateTab", (_e, id) => {
    paneManager?.activateTab(id);
  });
  require$$1.ipcMain.handle("mc:browser:navigate", (_e, id, url) => paneManager?.navigate(id, url));
  require$$1.ipcMain.handle("mc:browser:goBack", (_e, id) => {
    paneManager?.goBack(id);
  });
  require$$1.ipcMain.handle("mc:browser:goForward", (_e, id) => {
    paneManager?.goForward(id);
  });
  require$$1.ipcMain.handle("mc:browser:reload", (_e, id) => {
    paneManager?.reload(id);
  });
  require$$1.ipcMain.handle("mc:browser:devtools", (_e, id) => {
    paneManager?.toggleDevTools(id);
  });
  require$$1.ipcMain.handle("mc:browser:setBounds", (_e, rect) => {
    paneManager?.setBounds(rect);
  });
  require$$1.ipcMain.handle("mc:setZoomFactor", (_e, factor) => {
    mainWindow?.webContents.setZoomFactor(factor);
  });
  require$$1.ipcMain.handle("mc:probeServer", async (_e, opts) => {
    try {
      const r = await fetch(`http://${opts.host}:${opts.port}/api/health`, { signal: AbortSignal.timeout(1500) });
      return r.ok;
    } catch {
      return false;
    }
  });
  require$$1.ipcMain.handle("mc:setWatchedServers", (_e, ids) => {
    if (!store || !aggregator) return;
    const ups = (ids ?? []).map((id) => store.get(id)).filter(Boolean).map((e) => ({ id: e.id, host: e.host, port: e.port, token: e.token }));
    aggregator.setWatched(ups);
    pushPeerRegistry();
  });
  require$$1.ipcMain.handle("mc:listSessionsForServer", async (_e, serverId) => {
    if (!store) return [];
    const entry = store.get(serverId);
    if (!entry) return [];
    try {
      const headers = {};
      if (entry.token) headers["Authorization"] = `Bearer ${entry.token}`;
      const r = await fetch(`http://${entry.host}:${entry.port}/api/sessions`, {
        headers,
        signal: AbortSignal.timeout(1500)
      });
      if (!r.ok) return [];
      const body = await r.json();
      if (Array.isArray(body)) return body;
      if (body && Array.isArray(body.sessions)) return body.sessions;
      return [];
    } catch (err) {
      console.warn(`[mc:listSessionsForServer] ${serverId} failed:`, err);
      return [];
    }
  });
  require$$1.ipcMain.handle(
    "mc:invokeOnServer",
    (_e, serverId, opts) => invokeOnServer(serverId, opts)
  );
  require$$1.ipcMain.handle("mc:getServerCapabilities", (_e, serverId) => store?.getServerCapabilities(serverId) ?? { tmux: false });
  require$$1.ipcMain.handle("mc:retry-bootstrap", () => {
    void startServicesGuarded();
  });
}
async function invokeOnServer(serverId, opts) {
  if (!store) return { ok: false, status: 0, body: "no store" };
  let entry = store.get(serverId);
  if (!entry && (!serverId || serverId === "local")) {
    const localInfo = store.list().find((s) => s.source === "local");
    if (localInfo) entry = store.get(localInfo.id);
  }
  if (!entry) return { ok: false, status: 0, body: "unknown server" };
  try {
    const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : "";
    const headers = { "content-type": "application/json" };
    if (entry.token) headers["Authorization"] = `Bearer ${entry.token}`;
    const r = await fetch(`http://${entry.host}:${entry.port}${opts.path}${qs}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== void 0 ? JSON.stringify(opts.body) : void 0,
      signal: AbortSignal.timeout(8e3)
    });
    const text = await r.text();
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
    }
    if (opts.path === "/api/ide/create-terminal" && r.ok && parsed && typeof parsed === "object" && "tmux" in parsed) {
      store.setServerCapabilities(serverId, { tmux: Boolean(parsed.tmux) });
    }
    return { ok: r.ok, status: r.status, body: parsed };
  } catch (err) {
    console.warn(`[mc:invokeOnServer] ${serverId} ${opts.path} failed:`, err);
    return { ok: false, status: 0, body: String(err) };
  }
}
function pushPeerRegistry() {
  if (!store || !aggregator) return;
  const peers = store.list().map((s) => store.get(s.id)).filter(Boolean).map((e) => ({ serverId: e.id, baseUrl: `http://${e.host}:${e.port}`, token: e.token }));
  aggregator.broadcast({ type: "peer_registry", peers });
}
const supTransition = /* @__PURE__ */ new Map();
let homeCache = null;
let homeCacheAt = 0;
async function resolveHome() {
  if (homeCache && Date.now() - homeCacheAt < 1e4) return homeCache;
  if (!store) return null;
  for (const s of store.list()) {
    try {
      const r = await invokeOnServer(s.id, { path: "/api/supervisor/identity" });
      if (r.ok && r.body && r.body.project && r.body.session) {
        homeCache = { homeServerId: s.id, identity: r.body };
        homeCacheAt = Date.now();
        return homeCache;
      }
    } catch {
    }
  }
  homeCache = null;
  homeCacheAt = Date.now();
  return null;
}
let supervisedCache = /* @__PURE__ */ new Set();
let supervisedAt = 0;
async function isSupervisedOnHome(homeServerId, project, session) {
  if (Date.now() - supervisedAt > 1e4) {
    try {
      const r = await invokeOnServer(homeServerId, { path: "/api/supervisor/supervised" });
      if (r.ok && Array.isArray(r.body?.supervised)) {
        supervisedCache = new Set(r.body.supervised.map((x) => `${x.project} ${x.session}`));
      }
    } catch {
    }
    supervisedAt = Date.now();
  }
  return supervisedCache.has(`${project} ${session}`);
}
async function onWatchEvent(e) {
  mainWindow?.webContents.send("mc:watch-event", e);
  if (e.type !== "claude_session_status") return;
  const status = e.status;
  const key = `${e.serverId} ${e.project} ${e.session}`;
  const prev = supTransition.get(key);
  if (status) supTransition.set(key, status);
  if (status !== "waiting" && status !== "permission") return;
  if (prev === status) return;
  const home = await resolveHome();
  if (!home) return;
  if (e.serverId === home.homeServerId) return;
  if (home.identity.project === e.project && home.identity.session === e.session) return;
  if (!await isSupervisedOnHome(home.homeServerId, e.project, e.session)) return;
  const base = (e.project || "").split("/").filter(Boolean).pop() || e.project;
  try {
    await invokeOnServer(home.homeServerId, {
      path: "/api/ide/tmux-send-keys",
      method: "POST",
      body: {
        project: home.identity.project,
        session: home.identity.session,
        text: `[mc-supervisor] ${e.serverId}/${base}/${e.session} → ${status}. Reconcile.`
      }
    });
  } catch {
  }
}
require$$1.app.setAsDefaultProtocolClient("mermaid-collab");
let mainWindow = null;
let pendingDeepLink = null;
function parseDeepLink(url) {
  try {
    const u = new URL(url);
    const project = u.hostname;
    const session = u.pathname.replace(/^\//, "");
    const srv = u.searchParams.get("srv");
    console.log(`[deeplink] project=${project} session=${session} srv=${srv}`);
    return { project, session, srv };
  } catch {
    console.warn(`[deeplink] could not parse: ${url}`);
    return null;
  }
}
function dispatchDeepLink(parsed, retriesLeft = 60) {
  if (!parsed) return;
  const srv = parsed.srv ?? (store?.list().find((e) => e.source === "local")?.id ?? null);
  if (srv == null) {
    if (retriesLeft > 0) {
      setTimeout(() => dispatchDeepLink(parsed, retriesLeft - 1), 500);
    } else {
      console.warn("[deeplink] no server resolved; dropping", parsed);
    }
    return;
  }
  const payload = { srv, project: parsed.project, session: parsed.session };
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send("mc:deeplink", payload);
  } else {
    pendingDeepLink = payload;
  }
}
function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}
require$$1.app.on("second-instance", (_event, argv) => {
  const url = argv.find((a) => a.startsWith("mermaid-collab://"));
  if (url) dispatchDeepLink(parseDeepLink(url));
  focusMainWindow();
});
require$$1.app.on("open-url", (event, url) => {
  event.preventDefault();
  dispatchDeepLink(parseDeepLink(url));
  focusMainWindow();
});
function loadAppIcon() {
  const iconPath = require$$1.app.isPackaged ? path.join(process.resourcesPath, "icon.png") : path.join(require$$1.app.getAppPath(), "build", "icon.png");
  return require$$1.nativeImage.createFromPath(iconPath);
}
function setupMenu() {
  const isMac = process.platform === "darwin";
  const sendZoom = (dir) => () => mainWindow?.webContents.send("mc:zoom", dir);
  const template = [
    ...isMac ? [{ role: "appMenu" }] : [],
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { label: "Actual Size", accelerator: "CommandOrControl+0", click: sendZoom("reset") },
        { label: "Zoom In", accelerator: "CommandOrControl+Plus", click: sendZoom("in") },
        // Cmd+= (no shift) is what users actually press for zoom-in; register it
        // as a hidden duplicate so the accelerator fires without a second item.
        { label: "Zoom In", accelerator: "CommandOrControl+=", click: sendZoom("in"), visible: false },
        { label: "Zoom Out", accelerator: "CommandOrControl+-", click: sendZoom("out") },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    { role: "windowMenu" }
  ];
  require$$1.Menu.setApplicationMenu(require$$1.Menu.buildFromTemplate(template));
}
function createWindow() {
  const appIcon = loadAppIcon();
  if (process.platform === "darwin" && require$$1.app.dock && !appIcon.isEmpty()) {
    require$$1.app.dock.setIcon(appIcon);
  }
  mainWindow = new require$$1.BrowserWindow({
    width: 1100,
    height: 800,
    show: true,
    icon: appIcon,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "../preload/index.js")
    }
  });
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  mainWindow.webContents.once("did-finish-load", () => {
    if (pendingDeepLink && mainWindow) {
      mainWindow.webContents.send("mc:deeplink", pendingDeepLink);
      pendingDeepLink = null;
    }
  });
  mainWindow.on("closed", () => {
    if (paneManager) {
      for (const t of paneManager.listTabs()) paneManager.closeTab(t.id);
      paneManager = null;
    }
    mainWindow = null;
  });
}
let serviceOpts = null;
async function bootstrap() {
  const cdpPort = await enableCdp(require$$1.app, { port: process.env.MC_CDP_PORT ? Number(process.env.MC_CDP_PORT) : void 0 });
  if (process.env.MC_INSPECT) require$$1.app.commandLine.appendSwitch("inspect", process.env.MC_INSPECT);
  await require$$1.app.whenReady();
  setupMenu();
  createWindow();
  registerIpc();
  paneManager = new BrowserPaneManager(mainWindow, { x: 0, y: 0, width: 0, height: 0 });
  control = new DesktopControl(paneManager);
  const { url: controlUrl, token: controlToken } = await control.start();
  serviceOpts = { cdpPort, controlUrl, controlToken };
  await startServicesGuarded();
  require$$1.app.on("activate", () => {
    if (require$$1.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  if (require$$1.app.isPackaged) {
    Promise.resolve().then(() => require("./main-BHutFUS6.js")).then((n) => n.main).then(({ autoUpdater }) => autoUpdater.checkForUpdatesAndNotify()).catch(() => {
    });
  }
}
async function startServicesGuarded() {
  if (!serviceOpts) return;
  try {
    await startServices(serviceOpts);
  } catch (err) {
    const e = err;
    console.error("[bootstrap] service startup failed:", err);
    mainWindow?.webContents.send("mc:bootstrap-error", {
      message: e?.message ?? String(err),
      detail: e?.detail,
      logPath: e?.logPath
    });
  }
}
async function startServices(opts) {
  const { cdpPort, controlUrl, controlToken } = opts;
  const repoRoot = process.env.MC_REPO_ROOT ?? path.join(require$$1.app.getAppPath(), "..");
  const prodBinary = require$$1.app.isPackaged ? path.join(process.resourcesPath, process.platform === "win32" ? "mc-server.exe" : "mc-server") : void 0;
  supervisor = new ServerSupervisor({
    repoRoot,
    project: repoRoot,
    session: process.env.MC_SESSION ?? "desktop",
    host: "127.0.0.1",
    cdpPort,
    controlUrl,
    controlToken,
    serverBinaryPath: prodBinary,
    resourcesPath: require$$1.app.isPackaged ? process.resourcesPath : void 0,
    // Tee sidecar stdout/stderr here so a failed Windows/packaged startup is
    // diagnosable; the path is also shown on the error screen.
    logFilePath: path.join(require$$1.app.getPath("logs"), "sidecar.log")
  });
  const { port, attached } = await supervisor.start();
  console.log(`[bootstrap] sidecar ${attached ? "attached" : "spawned"} on port ${port}; cdp on ${cdpPort}`);
  await fetch(`http://127.0.0.1:${port}/api/browser/electron-target`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cdpPort }) }).catch(() => {
  });
  void publishDiscovery({ appName: "mermaid-collab", port: cdpPort });
  proxy = new ServerProxy({ host: "127.0.0.1", port });
  const { port: proxyPort } = await proxy.start(9180);
  console.log(`[bootstrap] proxy on ${proxyPort} → sidecar ${port}`);
  store = new ConnectionStore();
  await store.init();
  await store.refreshLocal();
  proxy.setResolver((id) => {
    let e = store?.get(id);
    if (!e && (!id || id === "local")) {
      const localInfo = store?.list().find((s) => s.source === "local");
      if (localInfo) e = store?.get(localInfo.id);
    }
    return e ? { host: e.host, port: e.port, token: e.token } : null;
  });
  aggregator = new WatchAggregator((e) => void onWatchEvent(e), () => pushPeerRegistry());
  pushPeerRegistry();
  if (mainWindow) mainWindow.loadURL(`http://127.0.0.1:${proxyPort}`);
}
if (gotLock) {
  void bootstrap();
  let stopped = false;
  const teardownSidecar = () => {
    if (stopped) return;
    stopped = true;
    void supervisor?.stop();
  };
  require$$1.app.on("before-quit", () => {
    teardownSidecar();
    aggregator?.stop();
    void control?.stop();
    void proxy?.stop();
  });
  require$$1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      teardownSidecar();
      require$$1.app.quit();
    }
  });
}
exports.commonjsGlobal = commonjsGlobal;
