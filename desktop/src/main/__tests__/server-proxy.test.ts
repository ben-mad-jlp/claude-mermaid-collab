import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { getFreePort } from '../server-supervisor';
import { ServerProxy } from '../server-proxy';

interface FakeUpstream {
  port: number;
  close: () => Promise<void>;
  lastAuth: () => string | undefined;
}

async function startUpstream(body: string): Promise<FakeUpstream> {
  let lastAuth: string | undefined;
  const port = await getFreePort();
  const srv = http.createServer((req, res) => {
    lastAuth = req.headers['authorization'] as string | undefined;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(body);
  });
  await new Promise<void>((r) => srv.listen(port, '127.0.0.1', r));
  return {
    port,
    close: () => new Promise<void>((r) => srv.close(() => r())),
    lastAuth: () => lastAuth,
  };
}

async function get(port: number, path = '/api/x'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('ServerProxy', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  it('forwards a GET to the active upstream', async () => {
    const upstream = await startUpstream('hello-upstream');
    const proxy = new ServerProxy();
    const { port } = await proxy.start();
    cleanups.push(() => proxy.stop(), () => upstream.close());
    proxy.setUpstream({ host: '127.0.0.1', port: upstream.port });

    const res = await get(port);
    expect(res.status).toBe(200);
    expect(res.body).toBe('hello-upstream');
  });

  it('injects Authorization when a token is set', async () => {
    const upstream = await startUpstream('ok');
    const proxy = new ServerProxy();
    const { port } = await proxy.start();
    cleanups.push(() => proxy.stop(), () => upstream.close());
    proxy.setUpstream({ host: '127.0.0.1', port: upstream.port, token: 'mytoken' });

    await get(port);
    expect(upstream.lastAuth()).toBe('Bearer mytoken');
  });

  it('omits Authorization when no token is set', async () => {
    const upstream = await startUpstream('ok');
    const proxy = new ServerProxy();
    const { port } = await proxy.start();
    cleanups.push(() => proxy.stop(), () => upstream.close());
    proxy.setUpstream({ host: '127.0.0.1', port: upstream.port });

    await get(port);
    expect(upstream.lastAuth()).toBeUndefined();
  });

  it('returns 503 when no upstream is set', async () => {
    const proxy = new ServerProxy();
    const { port } = await proxy.start();
    cleanups.push(() => proxy.stop());

    const res = await get(port);
    expect(res.status).toBe(503);
  });

  it('proxies a WS text frame as text (not binary) end-to-end', async () => {
    // Upstream WS echo server that preserves frame type.
    const upPort = await getFreePort();
    const wss = new WebSocketServer({ port: upPort, host: '127.0.0.1' });
    wss.on('connection', (ws) => {
      ws.on('message', (data, isBinary) => ws.send(data, { binary: isBinary }));
    });
    await new Promise<void>((r) => wss.on('listening', () => r()));

    const proxy = new ServerProxy();
    const { port } = await proxy.start();
    cleanups.push(() => proxy.stop(), () => new Promise<void>((r) => wss.close(() => r())));
    proxy.setUpstream({ host: '127.0.0.1', port: upPort });

    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const received = await new Promise<{ text: string; isBinary: boolean }>((resolve, reject) => {
      client.on('open', () => client.send('hello-text'));
      client.on('message', (data, isBinary) =>
        resolve({ text: data.toString(), isBinary })
      );
      client.on('error', reject);
      setTimeout(() => reject(new Error('ws timeout')), 3000);
    });
    client.close();

    expect(received.text).toBe('hello-text');
    expect(received.isBinary).toBe(false); // regression guard: must NOT become binary
  });

  it('setUpstream swaps the forwarding target', async () => {
    const a = await startUpstream('from-A');
    const b = await startUpstream('from-B');
    const proxy = new ServerProxy();
    const { port } = await proxy.start();
    cleanups.push(() => proxy.stop(), () => a.close(), () => b.close());

    proxy.setUpstream({ host: '127.0.0.1', port: a.port });
    expect((await get(port)).body).toBe('from-A');
    proxy.setUpstream({ host: '127.0.0.1', port: b.port });
    expect((await get(port)).body).toBe('from-B');
  });
});
