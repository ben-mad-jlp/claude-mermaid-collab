/**
 * OrchestratorLadder — per-project 3-stop segmented control for the Orchestrator
 * daemon level (epic 4b81ca59 — collapsed from the legacy off·build·nudge·propose·drive).
 * Levels: off · on · auto.
 *
 * GET /api/orchestrator/level?project=<abs> → { project, level }
 * POST /api/orchestrator/level body { project, level } → { project, level }
 */
import React, { useEffect, useState, useCallback } from 'react';

export type OrchestratorLevel = 'off' | 'on' | 'auto';

const LEVELS: OrchestratorLevel[] = ['off', 'on', 'auto'];

const LEVEL_TITLE: Record<OrchestratorLevel, string> = {
  off: 'Off — no daemon activity for this project',
  on: 'On — supervised: builds todos, reconciles, and suggests an action per escalation (you confirm). Never acts unattended.',
  auto: 'Auto — on + acts for you: auto-lands green epics, auto-resolves confident suggestions (behind the proof gate), reachability gates.',
};

/** Per-stop heat: off = neutral gray, on = green (safe/supervised), auto = red
 *  (acting unattended). Only the selected stop is bright. */
const STOP_ACTIVE: Record<OrchestratorLevel, string> = {
  off: 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200',
  on: 'bg-success-500 dark:bg-success-600 text-white',
  auto: 'bg-danger-500 dark:bg-danger-600 text-white',
};

export interface OrchestratorLadderProps {
  project: string;
}

export const OrchestratorLadder: React.FC<OrchestratorLadderProps> = ({ project }) => {
  // Optimistic level — default to 'on' until the GET resolves.
  const [level, setLevel] = useState<OrchestratorLevel>('on');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  // Single daemon-health signal (the daemon is global; the dot just reflects it).
  const [daemonUp, setDaemonUp] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const mc = (window as any).mc;
        const path = '/api/orchestrator/health';
        const data = mc?.invokeOnServer
          ? (await mc.invokeOnServer('local', { path, method: 'GET' }))?.body
          : await (await fetch(path)).json();
        if (!cancelled) setDaemonUp(!!data?.running);
      } catch { if (!cancelled) setDaemonUp(false); }
    };
    void probe();
    const id = setInterval(probe, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

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
            const res = await mc.invokeOnServer('local', { path, method: 'POST', body });
            if (!res?.ok || (typeof res.status === 'number' && res.status >= 400)) setLevel(prev);
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

  return (
    <div
      data-testid="orchestrator-ladder"
      data-project={project}
      data-level={level}
      title={LEVEL_TITLE[level]}
      className={`flex items-center rounded overflow-hidden border text-3xs font-medium select-none shrink-0 transition-opacity ${busy ? 'opacity-60' : ''} ${loaded ? '' : 'opacity-50'} border-gray-300 dark:border-gray-600`}
    >
      {/* Daemon-health dot — green when the Orchestrator daemon is running. */}
      <span
        data-testid="orchestrator-health-dot"
        title={daemonUp == null ? 'Orchestrator daemon: checking…' : daemonUp ? 'Orchestrator daemon: running' : 'Orchestrator daemon: down'}
        className={`shrink-0 w-1.5 h-1.5 rounded-full mx-1 ${daemonUp == null ? 'bg-gray-300 dark:bg-gray-600' : daemonUp ? 'bg-success-500' : 'bg-danger-500'}`}
        aria-hidden="true"
      />
      {LEVELS.map((stop, idx) => {
        const isActive = stop === level;
        // ONLY the selected stop is bright — it fills with its OWN heat color
        // (gray ▸ green ▸ yellow ▸ orange ▸ red). Every other stop stays light/dim,
        // so the single bright segment reads as "you are here".
        const dim = 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700';
        const segColor = isActive ? STOP_ACTIVE[stop] : dim;

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
