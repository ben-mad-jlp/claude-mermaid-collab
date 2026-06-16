// Static import (not createRequire) so `bun build --compile` bundles
// chrome-remote-interface into the packaged sidecar binary. A dynamic
// createRequire isn't followed by the compiler and resolves against the real
// filesystem at runtime — which has no node_modules inside the .app bundle,
// so the binary crashed on startup with "Cannot find package".
// @ts-ignore - chrome-remote-interface ships no type declarations
import CDPImport from 'chrome-remote-interface';
const CDP = CDPImport as any;

import { ensureTab } from './cdp-session.js';
import {
  MC_SCREENCAST_QUALITY,
  MC_SCREENCAST_MAX_WIDTH,
  MC_SCREENCAST_MAX_HEIGHT,
  MC_SCREENCAST_EVERY_NTH_FRAME,
} from '../config.js';

export type ScreencastSink = (frame: { data: string; metadata: any; sessionName: string }) => void;

export interface ScreencastServiceOpts {
  cdpPort: number;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  everyNthFrame?: number;
  cdpImpl?: any;
}

interface SessionEntry {
  client: any;
  subscribers: Set<ScreencastSink>;
  starting?: Promise<void>;
}

export class ScreencastService {
  private readonly opts: Required<Omit<ScreencastServiceOpts, 'cdpImpl'>> & { cdpImpl: any };
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(opts: ScreencastServiceOpts) {
    this.opts = {
      cdpPort: opts.cdpPort,
      quality: opts.quality ?? MC_SCREENCAST_QUALITY,
      maxWidth: opts.maxWidth ?? MC_SCREENCAST_MAX_WIDTH,
      maxHeight: opts.maxHeight ?? MC_SCREENCAST_MAX_HEIGHT,
      everyNthFrame: opts.everyNthFrame ?? MC_SCREENCAST_EVERY_NTH_FRAME,
      cdpImpl: opts.cdpImpl ?? CDP,
    };
  }

  async subscribe(sessionName: string, sink: ScreencastSink): Promise<() => void> {
    let entry = this.sessions.get(sessionName);
    if (!entry) {
      entry = { client: null, subscribers: new Set() };
      this.sessions.set(sessionName, entry);
    }
    entry.subscribers.add(sink);

    if (entry.subscribers.size === 1) {
      // First subscriber — lazily start. Guard concurrent first-subscribes.
      if (!entry.starting) {
        entry.starting = this.startScreencast(sessionName).finally(() => {
          const e = this.sessions.get(sessionName);
          if (e) delete e.starting;
        });
      }
      await entry.starting;
    }

    return () => {
      const e = this.sessions.get(sessionName);
      if (!e) return;
      e.subscribers.delete(sink);
      if (e.subscribers.size === 0) {
        this.stopScreencast(sessionName).catch(() => {});
      }
    };
  }

  private async startScreencast(sessionName: string): Promise<void> {
    const entry = this.sessions.get(sessionName);
    if (!entry) return;

    const targetId = await ensureTab(sessionName, this.opts.cdpPort);
    const client = await this.opts.cdpImpl({ host: '127.0.0.1', port: this.opts.cdpPort, target: targetId });
    entry.client = client;

    await client.Page.enable();

    client.Page.screencastFrame(async (params: any) => {
      const e = this.sessions.get(sessionName);
      if (e) {
        for (const s of e.subscribers) {
          try { s({ data: params.data, metadata: params.metadata, sessionName }); } catch {}
        }
      }
      try { await client.Page.screencastFrameAck({ sessionId: params.sessionId }); } catch {}
    });

    await client.Page.startScreencast({
      format: 'jpeg',
      quality: this.opts.quality,
      maxWidth: this.opts.maxWidth,
      maxHeight: this.opts.maxHeight,
      everyNthFrame: this.opts.everyNthFrame,
    });
  }

  private async stopScreencast(sessionName: string): Promise<void> {
    const entry = this.sessions.get(sessionName);
    if (!entry?.client) {
      this.sessions.delete(sessionName);
      return;
    }
    await entry.client.Page.stopScreencast().catch(() => {});
    await entry.client.close().catch(() => {});
    this.sessions.delete(sessionName);
  }

  stop(): void {
    for (const [sessionName, entry] of this.sessions) {
      if (entry.client) {
        entry.client.Page.stopScreencast().catch(() => {});
        entry.client.close().catch(() => {});
      }
      this.sessions.delete(sessionName);
    }
  }

  isAlive(): boolean {
    return this.sessions.size > 0;
  }

  activeSessions(): string[] {
    return Array.from(this.sessions.keys());
  }
}
