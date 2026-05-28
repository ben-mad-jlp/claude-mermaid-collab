import http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { getFreePort } from './server-supervisor';

export interface Upstream {
  host: string;
  port: number;
  token?: string;
}

/**
 * Per-server local HTTP+WS proxy in the Electron main process. The renderer
 * talks only to this loopback proxy (single origin → relative URLs keep
 * working); the proxy forwards to the active upstream collab server, injecting
 * the auth token. Switching servers = setUpstream(), which also drops open WS
 * connections so the renderer reconnects against the new target.
 */
export class ServerProxy {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private upstream: Upstream | null = null;
  private openPairs = new Set<{ client: WebSocket; up: WebSocket }>();
  private perServerPairs = new Set<{ client: WebSocket; up: WebSocket }>();
  private resolver: ((id: string) => Upstream | null) | null = null;
  private port: number | null = null;

  async start(): Promise<{ port: number }> {
    const port = await getFreePort();
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
    this.port = port;
    return { port };
  }

  setUpstream(u: Upstream | null): void {
    this.upstream = u;
    // Drop existing proxied WS connections so the renderer reconnects to the new upstream.
    // Per-server pairs are NOT dropped here — they're routed by the resolver and
    // remain valid across active-server switches.
    for (const pair of this.openPairs) {
      try { pair.client.terminate(); } catch { /* ignore */ }
      try { pair.up.terminate(); } catch { /* ignore */ }
    }
    this.openPairs.clear();
  }

  setResolver(fn: ((id: string) => Upstream | null) | null): void {
    this.resolver = fn;
  }

  getPort(): number | null {
    return this.port;
  }

  private authHeaders(base: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = { ...base };
    if (this.upstream?.token) headers['authorization'] = `Bearer ${this.upstream.token}`;
    return headers;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const up = this.upstream;
    if (!up) {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('no upstream');
      return;
    }
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

    const up = this.upstream;
    if (!up) {
      socket.destroy();
      return;
    }
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

  async stop(): Promise<void> {
    this.setUpstream(null);
    for (const pair of this.perServerPairs) {
      try { pair.client.terminate(); } catch { /* ignore */ }
      try { pair.up.terminate(); } catch { /* ignore */ }
    }
    this.perServerPairs.clear();
    this.wss?.close();
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
    this.port = null;
  }
}
