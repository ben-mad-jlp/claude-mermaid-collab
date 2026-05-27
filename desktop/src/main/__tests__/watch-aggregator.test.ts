import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// --- Fake WebSocket (hoisted so vi.mock factory can reference it) ------------

const { instances, FakeWS } = vi.hoisted(() => {
  const instances: Array<{
    url: string;
    opts: unknown;
    terminated: boolean;
    removeAllListenersCalled: boolean;
    _handlers: Map<string, Array<(...args: unknown[]) => void>>;
    on(event: string, cb: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
    removeAllListeners(): void;
    terminate(): void;
  }> = [];

  class FakeWS {
    url: string;
    opts: unknown;
    terminated = false;
    removeAllListenersCalled = false;
    _handlers: Map<string, Array<(...args: unknown[]) => void>> = new Map();

    constructor(url: string, opts?: unknown) {
      this.url = url;
      this.opts = opts;
      instances.push(this);
    }

    on(event: string, cb: (...args: unknown[]) => void): void {
      if (!this._handlers.has(event)) this._handlers.set(event, []);
      this._handlers.get(event)!.push(cb);
    }

    emit(event: string, ...args: unknown[]): void {
      for (const cb of this._handlers.get(event) ?? []) cb(...args);
    }

    removeAllListeners(): this {
      this.removeAllListenersCalled = true;
      this._handlers.clear();
      return this;
    }

    terminate(): void {
      this.terminated = true;
    }
  }

  return { instances, FakeWS };
});

vi.mock('ws', () => ({ WebSocket: FakeWS }));

// --- import SUT AFTER mock is registered ------------------------------------

import { WatchAggregator, WatchUpstream } from '../watch-aggregator.js';

// --- helpers -----------------------------------------------------------------

function emitMessage(ws: typeof instances[0], payload: unknown): void {
  ws.emit('message', JSON.stringify(payload));
}

// --- tests -------------------------------------------------------------------

const serverA: WatchUpstream = { id: 'A', host: 'localhost', port: 3001, token: 'tok-a' };
const serverB: WatchUpstream = { id: 'B', host: 'localhost', port: 3002 };

describe('WatchAggregator', () => {
  let forward: ReturnType<typeof vi.fn>;
  let agg: WatchAggregator;

  beforeEach(() => {
    instances.length = 0;
    forward = vi.fn();
    agg = new WatchAggregator(forward);
  });

  afterEach(() => {
    vi.useRealTimers();
    agg.stop();
  });

  // -------------------------------------------------------------------------
  // 1. setWatched connection management
  // -------------------------------------------------------------------------
  describe('setWatched connection management', () => {
    it('opens one ws to ws://host:port/ws for a single server', () => {
      agg.setWatched([serverA]);

      expect(instances).toHaveLength(1);
      expect(instances[0].url).toBe('ws://localhost:3001/ws');
    });

    it('passes auth header when token is provided', () => {
      agg.setWatched([serverA]);

      expect((instances[0].opts as any)?.headers?.authorization).toBe('Bearer tok-a');
    });

    it('opens a second ws for B without reconnecting A', () => {
      agg.setWatched([serverA]);
      const wsA = instances[0];

      agg.setWatched([serverA, serverB]);

      // Only one new socket — B
      expect(instances).toHaveLength(2);
      // A's socket is the same instance (not replaced)
      expect(instances[0]).toBe(wsA);
      expect(instances[1].url).toBe('ws://localhost:3002/ws');
    });

    it("terminates B's socket when B is dropped from watched list", () => {
      agg.setWatched([serverA, serverB]);
      const wsB = instances.find(w => w.url.includes('3002'))!;

      agg.setWatched([serverA]);

      expect(wsB.terminated).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 2. message filtering
  // -------------------------------------------------------------------------
  describe('message filtering', () => {
    it('forwards watched-type messages with serverId injected', () => {
      agg.setWatched([serverA]);
      const wsA = instances[0];

      emitMessage(wsA, {
        type: 'claude_session_status',
        project: 'proj',
        session: 'sess-1',
        extra: 42,
      });

      expect(forward).toHaveBeenCalledTimes(1);
      const evt = forward.mock.calls[0][0];
      expect(evt.type).toBe('claude_session_status');
      expect(evt.serverId).toBe('A');
      expect(evt.session).toBe('sess-1');
    });

    it('forwards claude_session_registered type', () => {
      agg.setWatched([serverA]);
      emitMessage(instances[0], { type: 'claude_session_registered', project: 'p', session: 's' });
      expect(forward).toHaveBeenCalledTimes(1);
    });

    it('forwards claude_context_update type', () => {
      agg.setWatched([serverA]);
      emitMessage(instances[0], { type: 'claude_context_update', project: 'p', session: 's' });
      expect(forward).toHaveBeenCalledTimes(1);
    });

    it('does NOT forward non-watched message types', () => {
      agg.setWatched([serverA]);
      emitMessage(instances[0], { type: 'pair_mode_changed', project: 'p', session: 's' });
      expect(forward).not.toHaveBeenCalled();
    });

    it('does NOT throw and does NOT call forward on invalid JSON', () => {
      agg.setWatched([serverA]);
      instances[0].emit('message', 'not-json{{{');
      expect(forward).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 3. reconnect teardown (the bug-fix assertion)
  // -------------------------------------------------------------------------
  describe('reconnect teardown', () => {
    it('terminates old socket and creates a new one on reconnect', () => {
      vi.useFakeTimers();

      agg.setWatched([serverA]);
      const oldWs = instances[0];

      // Trigger a close → scheduleReconnect → should fire after backoff
      oldWs.emit('close');

      // At this point the old socket is still alive (waiting for timer)
      expect(instances).toHaveLength(1);

      // Advance past first backoff (attempt=0 → delay=1000ms)
      vi.advanceTimersByTime(1100);

      // A new socket must have been created
      expect(instances).toHaveLength(2);
      const newWs = instances[1];
      expect(newWs.url).toBe('ws://localhost:3001/ws');

      // The OLD socket must have been cleaned up (removeAllListeners + terminate)
      expect(oldWs.removeAllListenersCalled).toBe(true);
      expect(oldWs.terminated).toBe(true);

      // New socket is distinct
      expect(newWs).not.toBe(oldWs);
    });

    it('does not reconnect a removed server after close', () => {
      vi.useFakeTimers();

      agg.setWatched([serverA, serverB]);
      const wsB = instances.find(w => w.url.includes('3002'))!;

      // Drop B then emit close
      agg.setWatched([serverA]);
      wsB.emit('close');

      vi.advanceTimersByTime(5000);

      // Still only 2 instances (A + B — no new B socket)
      const bInstances = instances.filter(w => w.url.includes('3002'));
      expect(bInstances).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. stop()
  // -------------------------------------------------------------------------
  describe('stop()', () => {
    it('terminates all sockets', () => {
      agg.setWatched([serverA, serverB]);
      const [wsA, wsB] = instances;

      agg.stop();

      expect(wsA.terminated).toBe(true);
      expect(wsB.terminated).toBe(true);
    });

    it('after stop(), advancing timers does not create new connections', () => {
      vi.useFakeTimers();

      agg.setWatched([serverA]);
      const wsA = instances[0];

      // Trigger a pending reconnect
      wsA.emit('close');

      // Stop before the timer fires
      agg.stop();

      vi.advanceTimersByTime(5000);

      // No new sockets should have been created
      expect(instances).toHaveLength(1);
    });
  });
});
