/**
 * OrchestratorLevelBadge — a compact, READ-ONLY indicator of a project's current
 * Orchestrator daemon level, for the Bridge project rows in the left column. It
 * only SHOWS the level (a colored dot + the level name); changing it lives on the
 * interactive OrchestratorLadder in the Bridge CommandBar.
 *
 * GET /api/orchestrator/level?project=<abs> → { project, level }
 */
import React, { useEffect, useState } from 'react';
import type { OrchestratorLevel } from './OrchestratorLadder';

const LEVELS: OrchestratorLevel[] = ['off', 'on'];

/** Heat dot per level (matches the ladder: gray ▸ green). */
const LEVEL_DOT: Record<OrchestratorLevel, string> = {
  off: 'bg-gray-400 dark:bg-gray-500',
  on: 'bg-success-500',
};

export interface OrchestratorLevelBadgeProps {
  project: string;
}

export const OrchestratorLevelBadge: React.FC<OrchestratorLevelBadgeProps> = ({ project }) => {
  const [level, setLevel] = useState<OrchestratorLevel | null>(null);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const fetchLevel = async () => {
      try {
        const mc = (window as any).mc;
        const path = `/api/orchestrator/level?project=${encodeURIComponent(project)}`;
        let data: { level?: OrchestratorLevel } = {};
        if (mc?.invokeOnServer) {
          const res = await mc.invokeOnServer('local', { path, method: 'GET' });
          data = res?.body ?? {};
        } else {
          const r = await fetch(path);
          if (r.ok) data = await r.json();
        }
        if (!cancelled && data.level && LEVELS.includes(data.level)) setLevel(data.level);
      } catch {
        /* best-effort — badge just stays hidden until a level resolves */
      }
    };
    void fetchLevel();
    // Poll on the same cadence the panel refreshes so a CommandBar change reflects here.
    const id = setInterval(fetchLevel, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [project]);

  if (!level) return null;

  // Just a colored circle; the level name shows on hover (native tooltip).
  return (
    <span
      data-testid="orchestrator-level-badge"
      data-level={level}
      title={`Orchestrator level: ${level} (change it on the Bridge)`}
      className="shrink-0 inline-flex items-center"
    >
      <span
        className={`inline-block w-2.5 h-2.5 rounded-full ring-1 ring-gray-400/70 dark:ring-gray-500/70 ${LEVEL_DOT[level]}`}
        aria-hidden="true"
      />
    </span>
  );
};

export default OrchestratorLevelBadge;
