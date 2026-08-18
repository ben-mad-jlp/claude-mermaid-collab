/**
 * Channel nudge transport — delivers text nudges to idle sessions via a pluggable
 * transport interface, gated on session idle status. This is the replacement
 * for the removed terminal notification transport.
 *
 * The transport interface is intentionally minimal (async delivery only) to
 * support testing and future delivery mechanisms (HTTP, WebSocket, etc.) without
 * coupling this module to any transport implementation.
 *
 * Idle gating: a session's ClaudeStatus must be 'waiting' to receive a nudge.
 * Other statuses ('active', 'permission', 'checkpoint_ready') indicate the
 * session is engaged and a nudge is not helpful. A missing row is undeliverable
 * (the session is unknown to the system).
 */

import { getStatus } from './session-status-store.js';

export interface ChannelDelivery {
  project: string;
  session: string;
  text: string;
  ts: number;
}

export interface ChannelTransport {
  deliver(project: string, session: string, text: string): Promise<void>;
}

/**
 * Create an in-memory recording transport for testing. Pushes each delivery
 * to the `deliveries` array with a timestamp, never performs I/O.
 */
export function createRecordingChannelTransport(): ChannelTransport & { deliveries: ChannelDelivery[] } {
  const deliveries: ChannelDelivery[] = [];

  return {
    deliveries,
    async deliver(project: string, session: string, text: string): Promise<void> {
      deliveries.push({
        project,
        session,
        text,
        ts: Date.now(),
      });
    },
  };
}

/**
 * Factory for the nudge function wired to session-notification-tick.ts.
 *
 * Returns a function with signature:
 *   (project, session, text) => Promise<'sent' | 'busy' | 'undeliverable'>
 *
 * Resolution order:
 *   1. Check if the session is idle (via isIdle predicate or default getStatus read).
 *   2. If not idle: return 'busy' (or 'undeliverable' for missing row in default path).
 *   3. If idle: deliver exactly once via transport, then return 'sent'.
 *   4. Any error (from getStatus, from transport.deliver) is caught and resolves 'undeliverable'.
 *      The returned promise NEVER rejects.
 *
 * Deps are all optional and all injectable for testing.
 */
export function makeChannelNudge(deps?: {
  transport?: ChannelTransport;
  isIdle?: (project: string, session: string) => boolean;
  now?: () => number;
}): (project: string, session: string, text: string) => Promise<'sent' | 'busy' | 'undeliverable'> {
  const transport = deps?.transport ?? createNotWiredTransport();
  const isIdle = deps?.isIdle;
  const now = deps?.now ?? (() => Date.now());

  return async (project: string, session: string, text: string): Promise<'sent' | 'busy' | 'undeliverable'> => {
    try {
      if (isIdle) {
        // Injected predicate: no row-existence signal, so false → 'busy', true → deliver.
        if (!isIdle(project, session)) {
          return 'busy';
        }
      } else {
        // Default path: read the status row to distinguish 'busy' from 'undeliverable'.
        const row = getStatus(project, session);
        if (!row) {
          return 'undeliverable';
        }
        if (row.status !== 'waiting') {
          return 'busy';
        }
      }

      // Idle: deliver exactly once.
      await transport.deliver(project, session, text);
      return 'sent';
    } catch {
      // Any error resolves 'undeliverable'; the promise never rejects.
      return 'undeliverable';
    }
  };
}

/**
 * Default transport when none is injected: a NOT-WIRED transport whose deliver
 * rejects, so an unconfigured makeChannelNudge() reports 'undeliverable' rather
 * than falsely reporting 'sent'. This preserves byte-for-byte behavior if the
 * nudge function is ever used without explicit wiring.
 */
function createNotWiredTransport(): ChannelTransport {
  return {
    async deliver(): Promise<void> {
      throw new Error('ChannelTransport not wired');
    },
  };
}
