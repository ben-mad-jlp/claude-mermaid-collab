import http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { getFreePort } from './server-supervisor';

export interface Upstream {
  host: string;
  port: number;
  token?: string;
}

type WsMessage = { data: import('ws').RawData; isBinary: boolean };

/**
 * A per-server terminal bridge whose UPSTREAM attach (the expensive cross-host
 * tmux attach) is kept alive across renderer reconnects. When the renderer
 * client disconnects (e.g. the user switches to another server), the upstream
 * is parked WARM instead of torn down; switching back reuses it so only the
 * cheap browser↔localhost reconnect is paid, not a full cold cross-host attach.
 */
interface PerServerConn {
  key: string;
  up: WebSocket;
  client: WebSocket | null;
  // Upstream→client output received while no client is attached (warm), flushed
  // on reattach. Bounded by bytes — tmux re-renders the live screen anyway, so
  // dropping the oldest buffered output is safe.
  buffer: WsMessage[];
  bufferedBytes: number;
  // Client→upstream frames sent before the upstream socket finishes opening.
  pendingToUp: WsMessage[];
  // Detaches the CURRENT client's listeners (set by attachClient, cleared on detach).
  detachClient: (() => void) | null;
}

function rawLen(d: import('ws').RawData): number {
  if (Buffer.isBuffer(d)) return d.length;
  if (Array.isArray(d)) return d.reduce((n, b) => n + b.length, 0);
  if (d instanceof ArrayBuffer) return d.byteLength;
  return 0;
}

/**
 * Per-server local HTTP+WS proxy in the Electron main process. The renderer
 * talks only to this loopback proxy (single origin → relative URLs keep
 * working); the proxy forwards to the configured local upstream collab server,
 * injecting the auth token. The local upstream is fixed for the lifetime of
 * the proxy; cross-server traffic uses the /srv/<id>/... and /_per-server/<id>
 * branches resolved live via the resolver.
 */
export class ServerProxy {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly localUpstream: Upstream;
  private openPairs = new Set<{ client: WebSocket; up: WebSocket }>();
  private perServerPairs = new Set<{ client: WebSocket; up: WebSocket }>();
  // Per-server terminal bridges with a client currently attached.
  private perServerConns = new Set<PerServerConn>();
  // Warm (detached) upstream attaches, keyed by `${serverId}\n${rest}`. Map
  // insertion order is the LRU order: oldest-parked first, most-recently-parked
  // last; reuse deletes the entry, so a re-park lands it at the end.
  private warmUpstreams = new Map<string, PerServerConn>();
  // LRU bound on how many warm upstream attaches are held open at once.
  private static readonly MAX_WARM = 6;
  // Per-conn cap on output buffered while detached (oldest dropped past this).
  private static readonly MAX_WARM_BUFFER_BYTES = 1_048_576;
  private resolver: ((id: string) => Upstream | null) | null = null;
  private port: number | null = null;

  constructor(localUpstream: Upstream) {
    this.localUpstream = localUpstream;
  }

  // `preferredPort` keeps the renderer origin (http://127.0.0.1:<port>) STABLE
  // across restarts. localStorage is keyed by origin, so a random port each
  // launch would orphan all persisted state (subscriptions, theme, layout). We
  // try the preferred port first and only fall back to a free one if it's taken.
  async start(preferredPort?: number): Promise<{ port: number }> {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));

    const tryListen = (p: number) =>
      new Promise<boolean>((resolve) => {
        const onError = (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') { this.server!.removeListener('error', onError); resolve(false); }
        };
        this.server!.once('error', onError);
        this.server!.listen(p, '127.0.0.1', () => { this.server!.removeListener('error', onError); resolve(true); });
      });

    let port = preferredPort ?? 0;
    if (!preferredPort || !(await tryListen(preferredPort))) {
      port = await getFreePort();
      await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
    }
    this.port = port;
    return { port };
  }

  setResolver(fn: ((id: string) => Upstream | null) | null): void {
    this.resolver = fn;
  }

  getPort(): number | null {
    return this.port;
  }

  private authHeaders(base: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = { ...base };
    if (this.localUpstream.token) headers['authorization'] = `Bearer ${this.localUpstream.token}`;
    return headers;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const srvMatch = (req.url ?? '').match(/^\/srv\/([^/]+)(\/.*)$/);
    if (srvMatch) {
      const id = decodeURIComponent(srvMatch[1]);
      const target = this.resolver ? this.resolver(id) : null;
      if (!target) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('unknown server');
        return;
      }
      const rest = srvMatch[2];
      const headers: http.OutgoingHttpHeaders = { ...req.headers };
      delete headers.host;
      if (target.token) headers['authorization'] = `Bearer ${target.token}`;
      const proxyReq = http.request(
        { host: target.host, port: target.port, method: req.method, path: rest, headers },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );
      proxyReq.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
        res.end('upstream error');
      });
      req.pipe(proxyReq);
      return;
    }
    const up = this.localUpstream;
    const proxyReq = http.request(
      { host: up.host, port: up.port, method: req.method, path: req.url, headers: this.authHeaders(req.headers) },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('upstream error');
    });
    req.pipe(proxyReq);
  }

  private handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.wss) {
      socket.destroy();
      return;
    }
    // Per-server bridge: /_per-server/<serverId>/<rest>. Resolved live via the
    // resolver so tokens stay in main and the connection survives active-server
    // switches.
    const perServerMatch = (req.url ?? '').match(/^\/_per-server\/([^/]+)(\/.*)?$/);
    if (perServerMatch && this.resolver) {
      const serverId = decodeURIComponent(perServerMatch[1]);
      const rest = perServerMatch[2] || '/';
      const target = this.resolver(serverId);
      if (!target) {
        socket.destroy();
        return;
      }
      const key = `${serverId}\n${rest}`;
      this.wss.handleUpgrade(req, socket, head, (client) => {
        const warm = this.warmUpstreams.get(key); // warm-key delimiter: newline (not in URL paths)
        if (
          warm &&
          (warm.up.readyState === WebSocket.OPEN || warm.up.readyState === WebSocket.CONNECTING)
        ) {
          // Warm hit: reuse the live upstream attach — only the browser↔localhost
          // socket is new, the cross-host tmux attach is already established.
          this.warmUpstreams.delete(key);
          this.attachClient(warm, client);
          return;
        }
        if (warm) {
          // Stale warm entry (upstream already closed) — discard it.
          this.warmUpstreams.delete(key);
          this.disposeConn(warm);
        }
        const headers: Record<string, string> = {};
        if (target.token) headers['authorization'] = `Bearer ${target.token}`;
        const upConn = new WebSocket(`ws://${target.host}:${target.port}${rest}`, { headers });
        const conn: PerServerConn = {
          key,
          up: upConn,
          client: null,
          buffer: [],
          bufferedBytes: 0,
          pendingToUp: [],
          detachClient: null,
        };
        this.wireUpstream(conn);
        this.attachClient(conn, client);
      });
      return;
    }

    const srvWsMatch = (req.url ?? '').match(/^\/srv\/([^/]+)(\/.*)$/);
    if (srvWsMatch && this.resolver) {
      const id = decodeURIComponent(srvWsMatch[1]);
      const rest = srvWsMatch[2] || '/';
      const target = this.resolver(id);
      if (!target) { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (client) => {
        const headers: Record<string, string> = {};
        if (target.token) headers['authorization'] = `Bearer ${target.token}`;
        const upConn = new WebSocket(`ws://${target.host}:${target.port}${rest}`, { headers });
        const pair = { client, up: upConn };
        this.perServerPairs.add(pair);
        this.wireBridge(client, upConn, pair, this.perServerPairs);
      });
      return;
    }

    const up = this.localUpstream;
    this.wss.handleUpgrade(req, socket, head, (client) => {
      const headers: Record<string, string> = {};
      if (up.token) headers['authorization'] = `Bearer ${up.token}`;
      const upConn = new WebSocket(`ws://${up.host}:${up.port}${req.url}`, { headers });
      const pair = { client, up: upConn };
      this.openPairs.add(pair);
      this.wireBridge(client, upConn, pair, this.openPairs);
    });
  }

  private wireBridge(
    client: WebSocket,
    upConn: WebSocket,
    pair: { client: WebSocket; up: WebSocket },
    owner: Set<{ client: WebSocket; up: WebSocket }>
  ): void {
    {
      const cleanup = () => {
        owner.delete(pair);
        try { client.terminate(); } catch { /* ignore */ }
        try { upConn.terminate(); } catch { /* ignore */ }
      };

      // Buffer client→upstream frames sent before the upstream socket opens,
      // then flush on open — otherwise an eager first frame is silently dropped.
      const pending: Array<{ data: import('ws').RawData; isBinary: boolean }> = [];
      upConn.on('open', () => {
        for (const m of pending) upConn.send(m.data, { binary: m.isBinary });
        pending.length = 0;
      });

      // Preserve frame type: the collab server sends JSON as TEXT frames; without
      // the binary flag `ws` would re-send them as binary and the browser's
      // JSON.parse(event.data) would fail. `isBinary` comes from the ws v8 event.
      client.on('message', (data, isBinary) => {
        if (upConn.readyState === WebSocket.OPEN) upConn.send(data, { binary: isBinary });
        else pending.push({ data, isBinary });
      });
      upConn.on('message', (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
      });
      client.on('close', cleanup);
      upConn.on('close', cleanup);
      client.on('error', cleanup);
      upConn.on('error', cleanup);
    }
  }

  // Wire the UPSTREAM side of a per-server terminal bridge exactly once, for the
  // lifetime of the upstream attach (it outlives individual client connections).
  private wireUpstream(conn: PerServerConn): void {
    const { up } = conn;
    up.on('open', () => {
      for (const m of conn.pendingToUp) up.send(m.data, { binary: m.isBinary });
      conn.pendingToUp.length = 0;
    });
    up.on('message', (data, isBinary) => {
      if (conn.client && conn.client.readyState === WebSocket.OPEN) {
        conn.client.send(data, { binary: isBinary });
        return;
      }
      // Detached (warm): buffer output to flush on reattach, bounded by bytes.
      conn.buffer.push({ data, isBinary });
      conn.bufferedBytes += rawLen(data);
      while (
        conn.bufferedBytes > ServerProxy.MAX_WARM_BUFFER_BYTES &&
        conn.buffer.length > 0
      ) {
        const dropped = conn.buffer.shift()!;
        conn.bufferedBytes -= rawLen(dropped.data);
      }
    });
    const onUpGone = () => this.disposeConn(conn);
    up.on('close', onUpGone);
    up.on('error', onUpGone);
  }

  // Bind a renderer client to a per-server bridge (fresh or reused-warm), flush
  // any buffered upstream output, and forward client→upstream frames.
  private attachClient(conn: PerServerConn, client: WebSocket): void {
    conn.client = client;
    this.perServerConns.add(conn);

    if (conn.buffer.length) {
      for (const m of conn.buffer) {
        if (client.readyState === WebSocket.OPEN) client.send(m.data, { binary: m.isBinary });
      }
      conn.buffer.length = 0;
      conn.bufferedBytes = 0;
    }

    const onClientMsg = (data: import('ws').RawData, isBinary: boolean) => {
      if (conn.up.readyState === WebSocket.OPEN) conn.up.send(data, { binary: isBinary });
      else conn.pendingToUp.push({ data, isBinary });
    };
    // Client gone (switch-away or socket error) → keep the upstream warm.
    const onClientGone = () => this.detachToWarm(conn);
    client.on('message', onClientMsg);
    client.on('close', onClientGone);
    client.on('error', onClientGone);
    conn.detachClient = () => {
      client.off('message', onClientMsg);
      client.off('close', onClientGone);
      client.off('error', onClientGone);
    };
  }

  // The renderer side closed: detach its listeners, terminate the dead client
  // socket, and park the still-live upstream warm (LRU-bounded) for reuse.
  private detachToWarm(conn: PerServerConn): void {
    conn.detachClient?.();
    conn.detachClient = null;
    try { conn.client?.terminate(); } catch { /* ignore */ }
    conn.client = null;
    this.perServerConns.delete(conn);

    if (conn.up.readyState === WebSocket.OPEN || conn.up.readyState === WebSocket.CONNECTING) {
      const existing = this.warmUpstreams.get(conn.key);
      if (existing && existing !== conn) this.disposeConn(existing);
      this.warmUpstreams.delete(conn.key);
      this.warmUpstreams.set(conn.key, conn);
      this.evictWarm();
    } else {
      this.disposeConn(conn);
    }
  }

  // Enforce the LRU bound: evict the oldest-parked warm upstreams.
  private evictWarm(): void {
    while (this.warmUpstreams.size > ServerProxy.MAX_WARM) {
      const oldestKey = this.warmUpstreams.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const old = this.warmUpstreams.get(oldestKey);
      this.warmUpstreams.delete(oldestKey);
      if (old) this.disposeConn(old);
    }
  }

  // Fully tear down a per-server bridge: both sockets and all registries.
  private disposeConn(conn: PerServerConn): void {
    this.perServerConns.delete(conn);
    if (this.warmUpstreams.get(conn.key) === conn) this.warmUpstreams.delete(conn.key);
    conn.detachClient?.();
    conn.detachClient = null;
    try { conn.client?.terminate(); } catch { /* ignore */ }
    try { conn.up.terminate(); } catch { /* ignore */ }
    conn.client = null;
  }

  async stop(): Promise<void> {
    for (const pair of this.openPairs) {
      try { pair.client.terminate(); } catch { /* ignore */ }
      try { pair.up.terminate(); } catch { /* ignore */ }
    }
    this.openPairs.clear();
    for (const pair of this.perServerPairs) {
      try { pair.client.terminate(); } catch { /* ignore */ }
      try { pair.up.terminate(); } catch { /* ignore */ }
    }
    this.perServerPairs.clear();
    for (const conn of [...this.perServerConns, ...this.warmUpstreams.values()]) {
      this.disposeConn(conn);
    }
    this.perServerConns.clear();
    this.warmUpstreams.clear();
    this.wss?.close();
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
    this.port = null;
  }
}
