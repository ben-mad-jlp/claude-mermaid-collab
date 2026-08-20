/**
 * OrchestratorLadder — per-project 2-stop segmented control for the Orchestrator
 * daemon level (epic 4b81ca59 — collapsed from the legacy off·build·nudge·propose·drive).
 * Levels: off · on.
 *
 * GET /api/orchestrator/level?project=<abs> → { project, level }
 * POST /api/orchestrator/level body { project, level } → { project, level }
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { LeverStop } from './LeverStop';

export type OrchestratorLevel = 'off' | 'on';

const LEVELS: OrchestratorLevel[] = ['off', 'on'];

const LEVEL_TITLE: Record<OrchestratorLevel, string> = {
  off: 'Off — no daemon activity for this project',
  on: 'On — supervised: builds todos, reconciles, and suggests an action per escalation (you confirm). Never acts unattended.',
};

export interface OrchestratorLadderProps {
  project: string;
  serverScope?: string;
}

export const OrchestratorLadder: React.FC<OrchestratorLadderProps> = ({ project, serverScope = 'local' }) => {
  // Optimistic level — default to 'on' until the GET resolves.
  const [level, setLevel] = useState<OrchestratorLevel>('on');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  // Single daemon-health signal (the daemon is global; the dot just reflects it).
  const [daemonUp, setDaemonUp] = useState<boolean | null>(null);
  // Guards against a project-change GET or a superseded GET landing after a newer
  // request (project swap or user click) has taken over.
  const requestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const res = await apiFetch(serverScope, '/api/orchestrator/health');
        const data = res.ok ? await res.json() : {};
        if (!cancelled) setDaemonUp(!!data?.running);
      } catch { if (!cancelled) setDaemonUp(false); }
    };
    void probe();
    const id = setInterval(probe, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [serverScope]);

  // Fetch current level on mount / project change.
  useEffect(() => {
    if (!project) return;
    setLoaded(false);
    let cancelled = false;
    const myId = ++requestIdRef.current;
    void (async () => {
      try {
        const path = `/api/orchestrator/level?project=${encodeURIComponent(project)}`;
        const r = await apiFetch(serverScope, path);
        const data = r.ok ? await r.json() : {};
        if (!cancelled && requestIdRef.current === myId && data.level && LEVELS.includes(data.level)) {
          setLevel(data.level);
        }
      } catch { /* best-effort */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [project, serverScope]);

  const onFlip = useCallback(
    async (next: OrchestratorLevel) => {
      // Supersede any in-flight GET so its resolution can't clobber this click.
      requestIdRef.current++;
      const prev = level;
      setLevel(next);
      setBusy(true);
      try {
        const body = { project, level: next };
        const r = await apiFetch(serverScope, '/api/orchestrator/level', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (r.ok) return { ok: true, level: next };
        setLevel(prev);
        let error: string | undefined;
        try {
          const data = await r.json();
          if (data?.error) error = data.error;
        } catch { /* no body */ }
        return { ok: false, error };
      } catch {
        setLevel(prev);
        return { ok: false, error: undefined };
      } finally {
        setBusy(false);
      }
    },
    [project, level, serverScope],
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
      <LeverStop
        testId="daemon"
        label="Daemon"
        project={project}
        failLabel="daemon"
        titleOn={LEVEL_TITLE.on}
        titleOff={LEVEL_TITLE.off}
        controlledLevel={level}
        onFlip={onFlip}
        icon={
          <>
            <path d="M12 4v8" />
            <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
          </>
        }
      />
    </div>
  );
};

export default OrchestratorLadder;
