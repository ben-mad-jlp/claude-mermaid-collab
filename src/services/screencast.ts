// Static import (not createRequire) so `bun build --compile` bundles
// chrome-remote-interface into the packaged sidecar binary — same reasoning as
// cdp-session.ts (a dynamic require resolves against a node_modules that does
// not exist inside the .app bundle).
// @ts-ignore - chrome-remote-interface ships no type declarations
import CDPImport from 'chrome-remote-interface';
const CDP = CDPImport as any;

import { CDP_PORT } from '../config.js';
import { getSessionTarget } from './cdp-session.js';

/**
 * streamed-panel mode (the WSL/remote-portable alternative to electron-view).
 *
 * For a session whose browser_* tools drive a CDP target in the server's OWNED
 * Chrome, ScreencastService attaches a long-lived CDP client to that same target
 * and runs CDP `Page.startScreencast`. Each `Page.screencastFrame` is handed to a
 * sink (wired by L2 to broadcast over the UI WebSocket) and immediately acked —
 * `Page.screencastFrameAck` is CDP back-pressure: Chrome won't emit the next
 * frame until the current one is acked, so the stream self-throttles to the
 * consumer's speed.
 *
 * Lifecycle: a stream is started on the first subscribe() for a session and torn
 * down on the last unsubscribe() (ref-counted) — zero idle cost when nobody is
 * watching. stopAll() is called on server shutdown.
 *
 * L1 builds the capture + lifecycle; the sink defaults to a no-op until L2 wires
 * the WS transport via setSink().
 */

export interface ScreencastFrameMeta {
  /** CSS px offset of the top of the visible page content (from CDP metadata). */
  offsetTop: number;
  /** Page scale factor at capture time. */
  pageScaleFactor: number;
  /** Device (viewport) width in CSS px. */
  deviceWidth: number;
  /** Device (viewport) height in CSS px. */
  deviceHeight: number;
  /** CDP capture timestamp (seconds since epoch, fractional). */
  timestamp: number;
}

export interface ScreencastFrame {
  /** base64-encoded JPEG frame data. */
  data: string;
  meta: ScreencastFrameMeta;
}

export type FrameSink = (session: string, frame: ScreencastFrame) => void;

export interface ScreencastOptions {
  /** JPEG quality 0-100. Lower = smaller/faster. Default 60. */
  quality?: number;
  /** Cap captured frame width in px (omit = viewport size). */
  maxWidth?: number;
  /** Cap captured frame height in px (omit = viewport size). */
  maxHeight?: number;
  /** Emit only every Nth frame (1 = every frame). Default 1. */
  everyNthFrame?: number;
}

interface Stream {
  client: any;
  refs: number;
}

export class ScreencastService {
  private streams = new Map<string, Stream>();
  private sink: FrameSink = () => {};
  private port: number;
  private opts: ScreencastOptions;

  constructor(port: number = CDP_PORT, opts: ScreencastOptions = {}) {
    this.port = port;
    this.opts = opts;
  }

  /** Wire the frame sink (L2 sets this to a WS broadcast). Replaces any prior sink. */
  setSink(sink: FrameSink): void {
    this.sink = sink;
  }

  /** True if a screencast is currently running for this session. */
  hasStream(session: string): boolean {
    return this.streams.has(session);
  }

  /**
   * Start (or ref-count into) a screencast for a session. Resolves the session's
   * current CDP target — the same one browser_open created — and streams it.
   * @throws if no tab is open for the session.
   */
  async subscribe(session: string): Promise<void> {
    const existing = this.streams.get(session);
    if (existing) {
      existing.refs++;
      return;
    }

    const targetId = getSessionTarget(session);
    if (!targetId) {
      throw new Error(`No browser tab open for session "${session}" — call browser_open first`);
    }

    const client = await CDP({ host: '127.0.0.1', port: this.port, target: targetId });
    const stream: Stream = { client, refs: 1 };
    this.streams.set(session, stream);

    try {
      await client.Page.enable();
      client.Page.screencastFrame(async (params: any) => {
        try {
          const md = params.metadata ?? {};
          this.sink(session, {
            data: params.data,
            meta: {
              offsetTop: md.offsetTop ?? 0,
              pageScaleFactor: md.pageScaleFactor ?? 1,
              deviceWidth: md.deviceWidth ?? 0,
              deviceHeight: md.deviceHeight ?? 0,
              timestamp: md.timestamp ?? 0,
            },
          });
        } finally {
          // Back-pressure ack — Chrome holds the next frame until this lands.
          try { await client.Page.screencastFrameAck({ sessionId: params.sessionId }); } catch {}
        }
      });
      await client.Page.startScreencast({
        format: 'jpeg',
        quality: this.opts.quality ?? 60,
        ...(this.opts.maxWidth ? { maxWidth: this.opts.maxWidth } : {}),
        ...(this.opts.maxHeight ? { maxHeight: this.opts.maxHeight } : {}),
        everyNthFrame: this.opts.everyNthFrame ?? 1,
      });
    } catch (err) {
      // Failed to start — don't leave a half-open client/stream behind.
      this.streams.delete(session);
      try { await client.close(); } catch {}
      throw err;
    }
  }

  /** Ref-count out of a session's screencast; stop + close on the last unsubscribe. */
  async unsubscribe(session: string): Promise<void> {
    const stream = this.streams.get(session);
    if (!stream) return;
    stream.refs--;
    if (stream.refs > 0) return;
    this.streams.delete(session);
    try { await stream.client.Page.stopScreencast(); } catch {}
    try { await stream.client.close(); } catch {}
  }

  /** Stop every active screencast (server shutdown). */
  async stopAll(): Promise<void> {
    const sessions = Array.from(this.streams.keys());
    for (const session of sessions) {
      const stream = this.streams.get(session);
      this.streams.delete(session);
      if (!stream) continue;
      try { await stream.client.Page.stopScreencast(); } catch {}
      try { await stream.client.close(); } catch {}
    }
  }
}

// Module singleton — instantiated by server.ts when MC_BROWSER_TARGET=streamed-panel.
let instance: ScreencastService | null = null;

export function getScreencastService(): ScreencastService | null {
  return instance;
}

export function initScreencastService(port?: number, opts?: ScreencastOptions): ScreencastService {
  instance = new ScreencastService(port ?? CDP_PORT, opts);
  return instance;
}
