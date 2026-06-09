/**
 * OrchestratorLadder — per-project 5-stop segmented control for the Orchestrator
 * daemon level. Replaces the Coordinator RoleSwitch pill and the steward/supervisor
 * role cards. Levels: off · build · nudge · propose · consult.
 *
 * GET /api/orchestrator/level?project=<abs> → { project, level }
 * POST /api/orchestrator/level body { project, level } → { project, level }
 */
import React, { useEffect, useState, useCallback } from 'react';

export type OrchestratorLevel = 'off' | 'build' | 'nudge' | 'propose' | 'consult';

const LEVELS: OrchestratorLevel[] = ['off', 'build', 'nudge', 'propose', 'consult'];

const LEVEL_TITLE: Record<OrchestratorLevel, string> = {
  off: 'Orchestrator off — no daemon activity',
  build: 'Build — daemon executes claimed todos autonomously',
  nudge: 'Nudge — daemon nudges idle workers',
  propose: 'Propose — daemon proposes next actions',
  consult: 'Consult — daemon checks in before every action',
};

/** Index of a level (0 = off … 4 = consult). */
const levelIndex = (l: OrchestratorLevel) => LEVELS.indexOf(l);

export interface OrchestratorLadderProps {
  project: string;
}

export const OrchestratorLadder: React.FC<OrchestratorLadderProps> = ({ project }) => {
  // Optimistic level — default to 'build' until the GET resolves.
  const [level, setLevel] = useState<OrchestratorLevel>('build');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  // Fetch current level on mount / project change.
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void (async () => {
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
        if (!cancelled && data.level && LEVELS.includes(data.level)) {
          setLevel(data.level);
        }
      } catch { /* best-effort */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [project]);

  const handleSelect = useCallback(
    (next: OrchestratorLevel) => {
      if (busy || !project) return;
      // Optimistic update.
      const prev = level;
      setLevel(next);
      setBusy(true);
      void (async () => {
        try {
          const mc = (window as any).mc;
          const path = '/api/orchestrator/level';
          const body = { project, level: next };
          if (mc?.invokeOnServer) {
            await mc.invokeOnServer('local', { path, method: 'POST', body });
          } else {
            const r = await fetch(path, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            if (!r.ok) setLevel(prev);
          }
        } catch {
          setLevel(prev);
        } finally {
          setBusy(false);
        }
      })();
    },
    [busy, project, level],
  );

  const activeIdx = levelIndex(level);

  return (
    <div
      data-testid="orchestrator-ladder"
      data-project={project}
      data-level={level}
      title={LEVEL_TITLE[level]}
      className={`flex items-center rounded overflow-hidden border text-3xs font-medium select-none shrink-0 transition-opacity ${busy ? 'opacity-60' : ''} ${loaded ? '' : 'opacity-50'} border-gray-300 dark:border-gray-600`}
    >
      {LEVELS.map((stop, idx) => {
        const isActive = stop === level;
        // Determine segment color:
        //   off-segment selected  → grey active
        //   off-segment not selected → grey dim
        //   non-off segment at/below active level → accent fill
        //   non-off segment above active level → dim
        let segColor: string;
        if (stop === 'off') {
          segColor = isActive
            ? 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700';
        } else if (idx <= activeIdx) {
          segColor = 'bg-accent-500 dark:bg-accent-600 text-white';
        } else {
          segColor = 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700';
        }

        return (
          <button
            key={stop}
            type="button"
            data-testid={`orchestrator-stop-${stop}`}
            data-active={isActive}
            disabled={busy}
            onClick={() => handleSelect(stop)}
            title={LEVEL_TITLE[stop]}
            className={`px-1.5 py-0.5 transition-colors cursor-pointer disabled:cursor-not-allowed ${segColor} ${idx > 0 ? 'border-l border-gray-300 dark:border-gray-600' : ''}`}
          >
            {stop}
          </button>
        );
      })}
    </div>
  );
};

export default OrchestratorLadder;
