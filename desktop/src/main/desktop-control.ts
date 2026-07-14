import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { getFreePort } from './server-supervisor';
import type { BrowserPaneManager } from './browser-pane';

export class DesktopControl {
  private token = randomUUID();
  private server: http.Server | null = null;
  private port: number | null = null;

  /** Set by index.ts — triggers a sidecar-only hot-swap restart (Phase-2 deploy,
   *  49e3c1f6). Returns true iff the new sidecar came up healthy. */
  onHotSwap: (() => Promise<boolean>) | null = null;

  constructor(private paneManager: BrowserPaneManager) {}

  async start(): Promise<{ url: string; token: string }> {
    this.port = await getFreePort();
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port!, '127.0.0.1', () => resolve());
      this.server!.once('error', reject);
    });
    return { url: `http://127.0.0.1:${this.port}`, token: this.token };
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const send = (code: number, obj: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    if (
      !(req.method === 'GET' && req.url === '/main/ping') &&
      !(req.method === 'POST' && (req.url === '/panes/ensure' || req.url === '/sidecar/hot-swap'))
    ) {
      send(404, { error: 'not found' });
      return;
    }

    if (req.headers.authorization !== `Bearer ${this.token}`) {
      send(401, { error: 'unauthorized' });
      return;
    }

    // Main-liveness probe (deploy sidecar-death fix, leaf 0f2cc486). This handler
    // runs ON the Electron main event loop, so a wedged main (pegged loop, frozen
    // HTTP) cannot answer it. The deploy script pings this AFTER a "successful"
    // hot-swap: a healthy sidecar on :9002 with an UNRESPONSIVE main is the Mode-B
    // cosmetic deploy (app window stuck) — the script escalates to a full external
    // relaunch when this doesn't answer 200 in time. `pid` lets the caller correlate.
    if (req.method === 'GET' && req.url === '/main/ping') {
      send(200, { ok: true, pid: process.pid, ts: Date.now() });
      return;
    }

    // Sidecar-only hot-swap restart (Phase-2 deploy). The deploy script POSTs this
    // AFTER swapping the binary; we restart just the child (window survives) and
    // report whether it came up healthy so the script can fall back if not.
    if (req.url === '/sidecar/hot-swap') {
      if (!this.onHotSwap) { send(503, { error: 'hot-swap unavailable' }); return; }
      try {
        const healthy = await this.onHotSwap();
        send(healthy ? 200 : 500, { ok: healthy });
      } catch (e) {
        send(500, { ok: false, error: String(e) });
      }
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }

    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      send(400, { error: 'bad request' });
      return;
    }

    const session = (body as Record<string, unknown>)?.session;
    if (typeof session !== 'string') {
      send(400, { error: 'bad request' });
      return;
    }

    try {
      await this.paneManager.ensureSessionTab(session);
      send(200, { ok: true });
    } catch (e) {
      send(500, { error: String(e) });
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => (err ? reject(err) : resolve()));
      });
      this.server = null;
    }
  }
}
