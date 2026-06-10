/**
 * useSessionStatuses — poll the persisted per-session status for a project from
 * GET /api/session-status?project= (the same source the Supervisor tree uses for
 * accurate liveness). Returns a map keyed `${project}:${session}` → { status,
 * updatedAt }. Rows older than STALE_MS report 'unknown' so a long-dead session
 * doesn't read as alive. Server-aware via the desktop bridge, else plain fetch.
 *
 * This is what gives coordinator-spawned workers (which aren't in the live
 * `subscriptions` Watching feed) real-time status in the Bridge Workers roster.
 */
import { useEffect, useState } from 'react';

export interface SessionStatusEntry {
  status: 'active' | 'waiting' | 'permission' | 'unknown';
  /**
   * The row's REAL last-update (ms epoch), or null when the row carries none.
   * NEVER fabricated to render-time `Date.now()`: a missing timestamp must read
   * as "unknown activity" ('—' in the UI), not as a value that grows from when
   * the poll happened to run (which restamped every timestamp-less card on each
   * 2s poll → all timers reset in lockstep — todo caae8574).
   */
  updatedAt: number | null;
}

// A worker parked on a permission prompt (or waiting) does NOT heartbeat, so a
// short staleness window would blank its last-known status to 'unknown' and hide
// that it needs attention. Use a generous window so a recently-stuck worker still
// surfaces its real state; only a long-silent session (>15m) reads as unknown.
const STALE_MS = 15 * 60_000;
const POLL_MS = 10_000;

export function useSessionStatuses(
  serverScope: string,
  project: string | undefined,
  /** Bump to force an IMMEDIATE re-poll (e.g. the Bridge ↺ refresh button) instead
   *  of waiting up to POLL_MS for the next interval tick — so worker cards refresh
   *  on demand, not just every 10s. */
  refreshNonce?: number,
): Record<string, SessionStatusEntry> {
  const [statuses, setStatuses] = useState<Record<string, SessionStatusEntry>>({});

  useEffect(() => {
    if (!project) {
      setStatuses({});
      return;
    }
    let cancelled = false;

    const poll = async () => {
      const path = `/api/session-status?project=${encodeURIComponent(project)}`;
      const mc = (window as any).mc;
      let rows: Array<{ project: string; session: string; status: string; updatedAt?: number }> = [];
      try {
        if (mc?.invokeOnServer) {
          const res = await mc.invokeOnServer(serverScope, { path, method: 'GET' });
          if (res?.ok && res.body && typeof res.body === 'object') rows = (res.body as any).statuses ?? [];
        } else {
          const r = await fetch(path);
          if (r.ok) rows = (await r.json()).statuses ?? [];
        }
      } catch {
        return; // keep the last good map on a transient failure
      }
      if (cancelled) return;
      const now = Date.now();
      const map: Record<string, SessionStatusEntry> = {};
      for (const row of rows) {
        const stale = typeof row.updatedAt === 'number' && now - row.updatedAt > STALE_MS;
        map[`${row.project}:${row.session}`] = {
          status: stale ? 'unknown' : (row.status as SessionStatusEntry['status']),
          updatedAt: row.updatedAt ?? null,
        };
      }
      setStatuses(map);
    };

    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [serverScope, project, refreshNonce]);

  return statuses;
}
