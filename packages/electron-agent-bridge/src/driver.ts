// ElectronDriver — app-agnostic CDP client over chrome-remote-interface.
// Connects to a running Electron (or Chrome) instance's remote-debugging
// endpoint and drives the renderer: navigate, screenshot, eval, click, fill,
// waitFor, snapshot. No app-specific (mermaid/.collab/session) logic lives here.
//
// Connection model: one CDP client is opened per operation and closed in a
// `finally`, mirroring the proven withCDPSession pattern. Targets are resolved
// per call so the driver tolerates window/tab churn.

import { createRequire } from 'node:module';
import { promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// chrome-remote-interface ships no types; load it as `any` via createRequire,
// matching the repo's existing pattern in src/services/cdp-session.ts.
const require = createRequire(import.meta.url);
const CDP = require('chrome-remote-interface') as any;

export type CDPTarget = {
  id: string;
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ElectronDriver {
  private host: string;
  private port?: number;
  private wsUrl?: string;
  private selectTarget?: (t: CDPTarget) => boolean;

  private constructor(opts: {
    host?: string;
    port?: number;
    wsUrl?: string;
    selectTarget?: (t: CDPTarget) => boolean;
  }) {
    this.host = opts.host ?? '127.0.0.1';
    this.port = opts.port;
    this.wsUrl = opts.wsUrl;
    this.selectTarget = opts.selectTarget;
  }

  /**
   * Discover the CDP endpoint from a JSON file written by the app at launch.
   * The file may contain { port } | { cdpPort } | { wsUrl }.
   */
  static async fromDiscovery(opts?: {
    appName?: string;
    path?: string;
    selectTarget?: (t: CDPTarget) => boolean;
  }): Promise<ElectronDriver> {
    const path =
      opts?.path ??
      join(homedir(), '.' + (opts?.appName ?? 'mermaid-collab'), 'electron-cdp.json');

    let json: { port?: number; cdpPort?: number; wsUrl?: string };
    try {
      const raw = await fsp.readFile(path, 'utf8');
      json = JSON.parse(raw);
    } catch (err: any) {
      throw new Error(
        'ElectronDriver: could not read CDP discovery file at ' + path + ': ' + (err?.message ?? String(err)),
      );
    }

    if (json.wsUrl) {
      return new ElectronDriver({ wsUrl: json.wsUrl, selectTarget: opts?.selectTarget });
    }

    const port = json.port ?? json.cdpPort;
    if (!port) {
      throw new Error(
        'ElectronDriver: discovery file ' + path + ' had no usable port/cdpPort/wsUrl',
      );
    }
    return new ElectronDriver({ host: '127.0.0.1', port, selectTarget: opts?.selectTarget });
  }

  /** Construct directly from a known WebSocket debugger URL. */
  static fromUrl(wsUrl: string): ElectronDriver {
    return new ElectronDriver({ wsUrl });
  }

  /** Open a CDP client, resolving the target per call. Caller must close it. */
  private async connect(): Promise<any> {
    try {
      if (this.wsUrl) {
        return await CDP({ host: this.host, port: this.port, target: this.wsUrl });
      }
      const targets: CDPTarget[] = await CDP.List({ host: this.host, port: this.port });
      const t = targets.find(this.selectTarget ?? ((x) => x.type === 'page'));
      if (!t || !t.webSocketDebuggerUrl) {
        throw new Error('ElectronDriver: no matching CDP target (port ' + this.port + ')');
      }
      return await CDP({ host: this.host, port: this.port, target: t.webSocketDebuggerUrl });
    } catch (err: any) {
      if (err?.code === 'ECONNREFUSED') {
        throw new Error('ElectronDriver: CDP not reachable on ' + this.host + ':' + this.port);
      }
      throw err;
    }
  }

  async navigate(url: string): Promise<{ url: string; title: string }> {
    const client = await this.connect();
    try {
      await client.Page.enable();
      await client.Page.navigate({ url });
      await sleep(500);
      const title = (
        await client.Runtime.evaluate({ expression: 'document.title', returnByValue: true })
      ).result?.value;
      return { url, title };
    } finally {
      try {
        await client.close();
      } catch {}
    }
  }

  async screenshot(opts?: { format?: 'png' | 'jpeg' }): Promise<{ base64: string }> {
    const client = await this.connect();
    try {
      await client.Page.enable();
      const r = await client.Page.captureScreenshot({ format: opts?.format ?? 'png' });
      return { base64: r.data };
    } finally {
      try {
        await client.close();
      } catch {}
    }
  }

  async eval(expression: string): Promise<unknown> {
    const client = await this.connect();
    try {
      const r = await client.Runtime.evaluate({
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) {
        throw new Error(
          r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'eval error',
        );
      }
      return r.result?.value;
    } finally {
      try {
        await client.close();
      } catch {}
    }
  }

  async click(selector: string): Promise<void> {
    const client = await this.connect();
    try {
      const sel = JSON.stringify(selector);
      const expr =
        '(function(){const el=document.querySelector(' +
        sel +
        '); if(!el) return "not-found"; el.click(); return "clicked";})()';
      const r = await client.Runtime.evaluate({ expression: expr, returnByValue: true });
      if (r.result?.value === 'not-found') {
        throw new Error('Element not found: ' + selector);
      }
    } finally {
      try {
        await client.close();
      } catch {}
    }
  }

  async fill(selector: string, value: string): Promise<void> {
    const client = await this.connect();
    try {
      const evalResult = await client.Runtime.evaluate({
        expression: 'document.querySelector(' + JSON.stringify(selector) + ')',
        returnByValue: false,
      });
      const objectId = evalResult.result?.objectId;
      if (!objectId) throw new Error('Element not found: ' + selector);
      await client.Runtime.callFunctionOn({
        objectId,
        functionDeclaration:
          'function(v){ this.value = v; this.dispatchEvent(new Event("input",{bubbles:true})); this.dispatchEvent(new Event("change",{bubbles:true})); }',
        arguments: [{ value }],
        returnByValue: true,
      });
    } finally {
      try {
        await client.close();
      } catch {}
    }
  }

  async waitFor(selector: string, timeoutMs = 5000): Promise<void> {
    const client = await this.connect();
    try {
      const deadline = Date.now() + timeoutMs;
      const expr = '!!document.querySelector(' + JSON.stringify(selector) + ')';
      while (Date.now() < deadline) {
        const ok = (await client.Runtime.evaluate({ expression: expr, returnByValue: true }))
          .result?.value;
        if (ok === true) return;
        await sleep(100);
      }
      throw new Error('Timeout: "' + selector + '" not found after ' + timeoutMs + 'ms');
    } finally {
      try {
        await client.close();
      } catch {}
    }
  }

  async snapshot(): Promise<string> {
    const client = await this.connect();
    try {
      const expr = `(function(){
        var sel = 'a,button,input,textarea,select,[role],h1,h2,h3';
        var nodes = Array.prototype.slice.call(document.querySelectorAll(sel));
        var lines = [];
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i];
          var visible = el.offsetParent !== null || el.getClientRects().length > 0;
          if (!visible) continue;
          var tag = el.tagName.toLowerCase();
          var id = el.id ? '#' + el.id : '';
          var cls = '';
          if (el.className && typeof el.className === 'string') {
            var c = el.className.trim().split(/\\s+/).filter(Boolean);
            if (c.length) cls = '.' + c.join('.');
          }
          var txt = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
          var line = tag + id + cls;
          if (txt) line += ' "' + txt + '"';
          lines.push(line);
        }
        return lines.join('\\n');
      })()`;
      const r = await client.Runtime.evaluate({ expression: expr, returnByValue: true });
      return r.result?.value ?? '';
    } finally {
      try {
        await client.close();
      } catch {}
    }
  }

  async listTargets(): Promise<CDPTarget[]> {
    if (!this.port) return [];
    return await CDP.List({ host: this.host, port: this.port });
  }

  /** No-op: connections are opened and closed per operation (connect-per-op). */
  async close(): Promise<void> {
    // intentionally empty
  }
}
