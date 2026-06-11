/**
 * useFleetStatus — poll the live fleet read-model for a project from
 * GET /api/fleet?project= (server-computed from REAL tmux liveness — the same
 * primitives the watchdog uses). Returns a map keyed by worker session →
 * FleetEntry. This is what gives the Bridge worker roster TRUE liveness
 * (working / idle / permission / dead) and a STABLE per-lane lastActivity, so a
 * live-but-idle worker reads as present and each card timer reflects its own
 * real activity instead of resetting in lockstep on every poll.
 *
 * Server-aware via the desktop bridge (window.mc.invokeOnServer), else plain fetch.
 */
import { useEffect, useState } from 'react';

/** Mirror of the server's WorkerState (src/services/fleet-status.ts). */
export type FleetWorkerState =
  | 'no_tmux'
  | 'dead_shell'
  | 'permission'
  | 'working'
  | 'idle'
  | 'unknown';

/** Structural copy of the server's FleetEntry (the fields the UI consumes). */
export interface FleetEntry {
  todoId: string;
  title: string;
  type: string | null;
  worker: string;
  project: string;
  targetProject: string | null;
  claimedBy: string | null;
  /** When the worker claimed its current todo (ms epoch), or null. STABLE across
   *  polls + daemon heartbeats — anchor for the card "time-on-task" timer. */
  claimedAt: number | null;
  elapsedMs: number | null;
  leaseRemainingMs: number | null;
  overLease: boolean;
  retryCount: number;
  state: FleetWorkerState;
  /** REAL last-activity (ms epoch) or null — drives the card timer. Never render-time. */
  lastActivity: number | null;
  blockedOnTool?: string | null;
}

const POLL_MS = 5_000;

export function useFleetStatus(
  serverScope: string,
  project: string | undefined,
): Record<string, FleetEntry> {
  const [entries, setEntries] = useState<Record<string, FleetEntry>>({});

  useEffect(() => {
    if (!project) {
      setEntries({});
      return;
    }
    let cancelled = false;

    const poll = async () => {
      const path = `/api/fleet?project=${encodeURIComponent(project)}`;
      const mc = (window as any).mc;
      let rows: FleetEntry[] = [];
      try {
        if (mc?.invokeOnServer) {
          const res = await mc.invokeOnServer(serverScope, { path, method: 'GET' });
          if (res?.ok && res.body && typeof res.body === 'object') rows = (res.body as any).entries ?? [];
        } else {
          const r = await fetch(path);
          if (r.ok) rows = (await r.json()).entries ?? [];
        }
      } catch {
        return; // keep the last good map on a transient failure
      }
      if (cancelled) return;
      const map: Record<string, FleetEntry> = {};
      for (const row of rows) map[row.worker] = row;
      setEntries(map);
    };

    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [serverScope, project]);

  return entries;
}
