import { useEffect, useState, useRef } from 'react';
import { useSupervisorStore, type MissionSummary } from '@/stores/supervisorStore';

/** Lifts the mission fetching effect and the run wrapper.
 *  Mounts: fetch missions once, then poll every 15s with an alive guard.
 *  Returns: missions array, setMissions, and a run() wrapper for busy/apply.
 *  Blanks stale project's missions synchronously when props change via key tagging. */
export function useMissions(serverId: string, project: string) {
  const fetchMissions = useSupervisorStore((s) => s.fetchMissions);
  const currentKey = `${serverId}|${project}`;
  const [state, setState] = useState<{ key: string; items: MissionSummary[] }>({ key: currentKey, items: [] });
  const [busy, setBusy] = useState(false);
  const latestKeyRef = useRef(currentKey);

  useEffect(() => {
    latestKeyRef.current = currentKey;
  });

  const missions = state.key === currentKey ? state.items : [];

  useEffect(() => {
    let alive = true;
    const key = currentKey;
    const load = async () => {
      const next = await fetchMissions(serverId, project);
      if (alive && latestKeyRef.current === key) setState({ key, items: next });
    };
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [serverId, project, fetchMissions, currentKey]);

  const setMissions = (items: MissionSummary[]) => {
    setState({ key: currentKey, items });
  };

  const run = async (fn: () => Promise<MissionSummary[]>) => {
    setBusy(true);
    try {
      setMissions(await fn());
    } finally {
      setBusy(false);
    }
  };

  return { missions, setMissions, run, busy };
}
