import { useEffect, useState } from 'react';
import type { FleetEntry } from './useFleetStatus';
import type { MissionSummary } from '@/stores/supervisorStore';

interface DaemonStatus {
  now: number;
  state?: string;
  inflight: Array<{
    leafId: string;
    epicId: string | null;
    nodeKind: string | null;
    model: string | null;
    attempt: number | null;
    startedAt: number;
    elapsedMs: number;
    stale: boolean;
  }>;
  breaker: { open: boolean; openUntil: number };
  paused: Array<{
    todoId: string;
    project: string;
    firstTrippedAt: number | null;
  }>;
  recentSpawns: Array<{
    id?: string;
    ts?: number;
    project?: string;
    session?: string;
    detail?: string | null;
    serverId?: string;
  }>;
  failures: Array<{
    leafId: string;
    finalOutcome: string | null;
    reason: string | null;
    pathTaken?: string | null;
    nodesSpent?: number;
  }>;
  limits?: {
    global: { max: number; active: number };
    project?: { max: number; active: number };
  };
  claimSuppression?: unknown;
}

interface BurnSnapshot {
  windowMs: number;
  project: string | null;
  sources: Array<Record<string, unknown>>;
}

export interface OpsData {
  fleet: Record<string, FleetEntry>;
  daemon: DaemonStatus | null;
  missions: MissionSummary[];
  burn: BurnSnapshot | null;
}

const POLL_MS = 5_000;

export function useOpsData(serverScope: string, project: string | undefined): OpsData {
  const [data, setData] = useState<OpsData>({ fleet: {}, daemon: null, missions: [], burn: null });

  useEffect(() => {
    if (!project) {
      setData({ fleet: {}, daemon: null, missions: [], burn: null });
      return;
    }
    let cancelled = false;

    const getJson = async (path: string): Promise<any> => {
      const mc = (window as any).mc;
      if (mc?.invokeOnServer) {
        const res = await mc.invokeOnServer(serverScope, { path, method: 'GET' });
        return res?.ok ? res.body : null;
      }
      const r = await fetch(path);
      return r.ok ? r.json() : null;
    };

    const poll = async () => {
      const q = `project=${encodeURIComponent(project)}`;
      const [fleetBody, daemonBody, missionsBody, burnBody] = await Promise.all([
        getJson(`/api/fleet?${q}`).catch(() => null),
        getJson(`/api/leaf-executor/daemon?${q}`).catch(() => null),
        getJson(`/api/supervisor/missions?${q}`).catch(() => null),
        getJson(`/api/usage/burn?${q}`).catch(() => null),
      ]);
      if (cancelled) return;
      setData((prev) => ({
        fleet: fleetBody?.entries
          ? Object.fromEntries((fleetBody.entries as FleetEntry[]).map((e) => [e.worker, e]))
          : prev.fleet,
        daemon: daemonBody ?? prev.daemon,
        missions: missionsBody?.missions ?? prev.missions,
        burn: burnBody ?? prev.burn,
      }));
    };

    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [serverScope, project]);

  return data;
}
