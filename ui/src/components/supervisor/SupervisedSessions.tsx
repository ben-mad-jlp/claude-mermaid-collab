/**
 * SupervisedSessions — a standalone view of sessions currently being supervised.
 *
 * Grouped by project, each session row shows name, source tag, roadmap link,
 * and actions: nudge, open (jump), and stop supervising (DELETE).
 */
import React, { useMemo, useEffect, useCallback } from 'react';
import {
  useSupervisorStore,
  type SupervisedSession,
} from '@/stores/supervisorStore';

const DEFAULT_NUDGE_TEXT = 'continue';

export interface SupervisedSessionsProps {
  serverId: string;
  onJump?: (project: string, session: string) => void;
}

export const SupervisedSessions: React.FC<SupervisedSessionsProps> = ({
  serverId,
  onJump,
}) => {
  const supervised = useSupervisorStore((s) => s.supervised);
  const loadSupervised = useSupervisorStore((s) => s.loadSupervised);
  const setSupervisedLocal = useSupervisorStore((s) => s.setSupervisedLocal);
  const nudge = useSupervisorStore((s) => s.nudge);

  useEffect(() => {
    void loadSupervised(serverId);
  }, [serverId, loadSupervised]);

  const byProject = useMemo(() => {
    const m = new Map<string, SupervisedSession[]>();
    for (const s of supervised) {
      const arr = m.get(s.project) ?? [];
      arr.push(s);
      m.set(s.project, arr);
    }
    return Array.from(m.entries())
      .map(([project, sessions]) => ({
        project,
        sessions: sessions.sort((a, b) => a.session.localeCompare(b.session)),
      }))
      .sort((a, b) => a.project.localeCompare(b.project));
  }, [supervised]);

  const handleStop = useCallback(
    async (s: SupervisedSession) => {
      // Optimistic removal
      setSupervisedLocal(s, false);
      const mc = (window as any).mc;
      const path = '/api/supervisor/supervised';
      const body = { project: s.project, session: s.session };
      try {
        if (mc?.invokeOnServer) {
          await mc.invokeOnServer(serverId, { path, method: 'DELETE', body });
        } else {
          await fetch(path, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        }
      } catch {
        // best-effort
      }
      void loadSupervised(serverId);
    },
    [serverId, setSupervisedLocal, loadSupervised],
  );

  const handleNudge = useCallback(
    async (s: SupervisedSession) => {
      await nudge(serverId, s.project, s.session, DEFAULT_NUDGE_TEXT);
    },
    [serverId, nudge],
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
          Supervised Sessions
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">
          {supervised.length}
        </span>
      </div>

      {/* Body */}
      {supervised.length === 0 ? (
        <div className="px-2 py-4 text-xs text-gray-500 dark:text-gray-400 text-center">
          Not supervising any sessions.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {byProject.map(({ project, sessions }, gi) => {
            const projectBasename = project.split('/').pop() ?? project;

            return (
              <div
                key={project}
                className={`flex flex-col gap-1 ${gi > 0 ? 'pt-2 border-t border-gray-200 dark:border-gray-700' : ''}`}
              >
                {/* Project header */}
                <div className="px-1 text-2xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 truncate">
                  {projectBasename}
                </div>

                {/* Session rows */}
                {sessions.map((s) => {
                  return (
                    <div
                      key={s.session}
                      className="flex flex-col gap-0.5 px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40"
                    >
                      {/* Name + source tag */}
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate flex-1">
                          {s.session}
                        </span>
                        {s.source && (
                          <span className="text-3xs text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-600 rounded px-1 shrink-0">
                            {s.source}
                          </span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 pt-0.5">
                        <button
                          onClick={() => void handleNudge(s)}
                          className="px-2 py-0.5 text-2xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors border border-gray-200 dark:border-gray-600"
                          title="Nudge session to continue"
                        >
                          Nudge
                        </button>
                        <button
                          onClick={() => onJump?.(s.project, s.session)}
                          className="px-2 py-0.5 text-2xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors border border-gray-200 dark:border-gray-600"
                          title="Open session"
                        >
                          Open
                        </button>
                        <button
                          onClick={() => void handleStop(s)}
                          className="px-2 py-0.5 text-2xs rounded text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20 transition-colors border border-danger-200 dark:border-danger-800"
                          title="Stop supervising this session"
                        >
                          Stop
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
