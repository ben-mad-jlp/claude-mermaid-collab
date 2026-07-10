import { useEffect, useState } from 'react';
import { useSupervisorStore, type MissionSummary } from '@/stores/supervisorStore';

/** Lifts the mission fetching effect and the run wrapper.
 *  Mounts: fetch missions once, then poll every 15s with an alive guard.
 *  Returns: missions array, setMissions, and a run() wrapper for busy/apply. */
export function useMissions(serverId: string, project: string) {
  const fetchMissions = useSupervisorStore((s) => s.fetchMissions);
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const next = await fetchMissions(serverId, project);
      if (alive) setMissions(next);
    };
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [serverId, project, fetchMissions]);

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
