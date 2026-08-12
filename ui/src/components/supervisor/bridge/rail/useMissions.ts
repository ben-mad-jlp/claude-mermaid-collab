import { useEffect, useState, useRef } from 'react';
import { useSupervisorStore, type MissionSummary } from '@/stores/supervisorStore';
import { useLoadedState, type LoadStatus } from '@/hooks/useLoadedState';

/** Lifts the mission fetching effect and the run wrapper.
 *  Mounts: fetch missions once, then poll every 15s with an alive guard.
 *  Returns: missions array, setMissions, and a run() wrapper for busy/apply.
 *  Blanks stale project's missions synchronously when props change via key tagging. */
export function useMissions(serverId: string, project: string) {
  const fetchMissions = useSupervisorStore((s) => s.fetchMissions);
  const currentKey = `${serverId}|${project}`;
  const [loadedKey, setLoadedKey] = useState(currentKey);
  const loaded = useLoadedState<MissionSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const latestKeyRef = useRef(currentKey);

  useEffect(() => {
    latestKeyRef.current = currentKey;
  });

  const stale = loadedKey !== currentKey;
  const missions = stale ? [] : loaded.data;
  const hasLoadedOnce = stale ? false : loaded.hasLoadedOnce;
  const status: LoadStatus = stale ? 'loading' : loaded.status;

  useEffect(() => {
    let alive = true;
    const key = currentKey;
    const load = async () => {
      try {
        const next = await fetchMissions(serverId, project);
        if (alive && latestKeyRef.current === key) {
          setLoadedKey(key);
          loaded.settle(next);
        }
      } catch (err) {
        if (alive && latestKeyRef.current === key) {
          setLoadedKey(key);
          loaded.fail(err);
        }
      }
    };
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // Depend on the STABLE callbacks, never on the `loaded` object: it is re-minted every
    // render, and load() calls settle(), so listing the object here refires this effect on its
    // own completion — an infinite fetch cycle paced only by request latency. MEASURED
    // 2026-08-11: ~15 req/s against /api/supervisor/missions, ~6,000 sidecar queries per 10s,
    // health probes starved, watchdog SIGKILL. The 15s interval was decorative the whole time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, project, fetchMissions, currentKey, loaded.settle, loaded.fail]);

  const setMissions = (items: MissionSummary[]) => {
    setLoadedKey(currentKey);
    loaded.settle(items);
  };

  const run = async (fn: () => Promise<MissionSummary[]>) => {
    setBusy(true);
    try {
      setMissions(await fn());
    } finally {
      setBusy(false);
    }
  };

  return { missions, setMissions, run, busy, hasLoadedOnce, status };
}
