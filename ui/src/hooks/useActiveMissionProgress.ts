import { useEffect, useState } from 'react';
import { selectActiveMissionProgress } from '@/lib/missionProgress';
import type { MissionSummary } from '@/stores/supervisorStore';

const POLL_MS = 5_000;

export function useActiveMissionProgressByProject(
  serverScope: string,
  projects: string[],
): Record<string, { met: number; total: number }> {
  const [progress, setProgress] = useState<Record<string, { met: number; total: number }>>({});
  // Stable key so the effect only re-subscribes when the project SET changes.
  const projectsKey = [...new Set(projects)].sort().join('|');

  useEffect(() => {
    const list = projectsKey ? projectsKey.split('|') : [];
    if (list.length === 0) { setProgress({}); return; }
    let cancelled = false;

    const poll = async () => {
      const mc = (window as any).mc;
      const map: Record<string, { met: number; total: number }> = {};
      await Promise.all(list.map(async (project) => {
        const path = `/api/supervisor/missions?project=${encodeURIComponent(project)}`;
        try {
          let missions: MissionSummary[] = [];
          if (mc?.invokeOnServer) {
            const res = await mc.invokeOnServer(serverScope, { path, method: 'GET' });
            if (res?.ok && res.body && typeof res.body === 'object') {
              missions = (res.body as any).missions ?? [];
            }
          } else {
            const r = await fetch(path);
            if (r.ok) missions = (await r.json()).missions ?? [];
          }
          const result = selectActiveMissionProgress(missions);
          if (result) map[project] = result;
        } catch { /* skip this project this tick */ }
      }));
      if (!cancelled) setProgress(map);
    };

    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [serverScope, projectsKey]);

  return progress;
}
