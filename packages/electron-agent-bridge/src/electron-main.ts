import net from 'node:net';
import { promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/**
 * Minimal shape of the Electron `app` object needed by these helpers.
 * Pass the real Electron `app` here so this module stays free of an
 * `electron` import (and can be unit-tested without Electron present).
 */
export interface ElectronAppLike {
  commandLine: { appendSwitch(key: string, value?: string): void };
}

/**
 * Find a free TCP port on the loopback interface.
 */
export function getFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Enable the Chrome DevTools Protocol (CDP) remote debugging endpoint.
 *
 * IMPORTANT: This MUST be called BEFORE `app.whenReady()`. The
 * `remote-debugging-port` switch is ignored once the app is ready.
 *
 * @returns the port CDP is listening on.
 */
export async function enableCdp(
  app: ElectronAppLike,
  opts?: { port?: number; address?: string },
): Promise<number> {
  const port =
    opts?.port ?? (process.env.MC_CDP_PORT ? Number(process.env.MC_CDP_PORT) : await getFreePort());
  app.commandLine.appendSwitch('remote-debugging-port', String(port));
  app.commandLine.appendSwitch('remote-debugging-address', opts?.address ?? '127.0.0.1');
  return port;
}

/**
 * Publish a CDP discovery record so external agents can find the
 * WebSocket debugger URL. Non-fatal: any failure is logged and swallowed.
 */
export async function publishDiscovery(opts: {
  appName: string;
  port: number;
  path?: string;
}): Promise<void> {
  try {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let wsUrl: string | undefined;

    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const res = await fetch('http://127.0.0.1:' + opts.port + '/json/list');
        const targets = (await res.json()) as Array<{
          type?: string;
          webSocketDebuggerUrl?: string;
        }>;
        const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
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
      console.warn(
        '[electron-agent-bridge] no CDP page target found after retries; writing port-only discovery record',
      );
    }

    const outPath = opts.path ?? join(homedir(), '.' + opts.appName, 'electron-cdp.json');
    await fsp.mkdir(dirname(outPath), { recursive: true });
    await fsp.writeFile(
      outPath,
      JSON.stringify(
        {
          port: opts.port,
          webSocketDebuggerUrl: wsUrl,
          pid: process.pid,
          appName: opts.appName,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.warn('[electron-agent-bridge] publishDiscovery failed (non-fatal):', err);
  }
}
