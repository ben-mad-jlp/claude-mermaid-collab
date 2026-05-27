import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { getFreePort } from './server-supervisor';
import type { BrowserPaneManager } from './browser-pane';

export class DesktopControl {
  private token = randomUUID();
  private server: http.Server | null = null;
  private port: number | null = null;

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

    if (req.method !== 'POST' || req.url !== '/panes/ensure') {
      send(404, { error: 'not found' });
      return;
    }

    if (req.headers.authorization !== `Bearer ${this.token}`) {
      send(401, { error: 'unauthorized' });
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
