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
  viewport?: { width: number; height: number; deviceScaleFactor: number };
  config?: { quality: number; maxWidth: number; maxHeight: number; everyNthFrame: number };
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

    if (entry.viewport) {
      await client.Emulation.setDeviceMetricsOverride({
        width: entry.viewport.width,
        height: entry.viewport.height,
        deviceScaleFactor: entry.viewport.deviceScaleFactor,
        mobile: false,
      }).catch(() => {});
    }
    await client.Page.startScreencast(this.screencastParams(entry));
  }

  private screencastParams(entry: SessionEntry) {
    const c = entry.config;
    return {
      format: 'jpeg' as const,
      quality: c?.quality ?? this.opts.quality,
      // Cap in DEVICE px: the screencast bitmap is viewport(CSS px) * deviceScaleFactor,
      // so capping in CSS px would force Chrome to downscale and skew the aspect ratio.
      maxWidth: c?.maxWidth ?? (entry.viewport ? entry.viewport.width * (entry.viewport.deviceScaleFactor ?? 1) : this.opts.maxWidth),
      maxHeight: c?.maxHeight ?? (entry.viewport ? entry.viewport.height * (entry.viewport.deviceScaleFactor ?? 1) : this.opts.maxHeight),
      everyNthFrame: c?.everyNthFrame ?? this.opts.everyNthFrame,
    };
  }

  async setViewport(sessionName: string, vp: { width: number; height: number; deviceScaleFactor?: number }): Promise<void> {
    const entry = this.sessions.get(sessionName);
    if (!entry) return;
    const next = {
      width: Math.max(1, Math.round(vp.width)),
      height: Math.max(1, Math.round(vp.height)),
      deviceScaleFactor: vp.deviceScaleFactor && vp.deviceScaleFactor > 0 ? vp.deviceScaleFactor : 1,
    };
    const cur = entry.viewport;
    if (cur && cur.width === next.width && cur.height === next.height && cur.deviceScaleFactor === next.deviceScaleFactor) return;
    entry.viewport = next;
    // A resize that lands while the screencast is still starting must not be dropped:
    // wait out the in-flight start, then restart with the now-current viewport.
    if (entry.starting) await entry.starting;
    if (entry.client) await this.restartScreencast(sessionName).catch(() => {});
  }

  async setQuality(sessionName: string, q: { quality?: number; maxWidth?: number; maxHeight?: number; everyNthFrame?: number }): Promise<void> {
    const entry = this.sessions.get(sessionName);
    if (!entry) return;
    entry.config = {
      quality: q.quality ?? entry.config?.quality ?? this.opts.quality,
      maxWidth: q.maxWidth ?? entry.config?.maxWidth ?? this.opts.maxWidth,
      maxHeight: q.maxHeight ?? entry.config?.maxHeight ?? this.opts.maxHeight,
      everyNthFrame: Math.max(1, q.everyNthFrame ?? entry.config?.everyNthFrame ?? this.opts.everyNthFrame),
    };
    if (entry.starting) await entry.starting;
    if (entry.client) await this.restartScreencast(sessionName).catch(() => {});
  }

  private async restartScreencast(sessionName: string): Promise<void> {
    const entry = this.sessions.get(sessionName);
    if (!entry?.client) return;
    await entry.client.Page.stopScreencast().catch(() => {});
    if (entry.viewport) {
      await entry.client.Emulation.setDeviceMetricsOverride({
        width: entry.viewport.width, height: entry.viewport.height,
        deviceScaleFactor: entry.viewport.deviceScaleFactor, mobile: false,
      }).catch(() => {});
    }
    await entry.client.Page.startScreencast(this.screencastParams(entry));
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
