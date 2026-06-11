/**
 * InlineEscalationDock — Studio's one bridge to the fleet (Control-UI §3).
 *
 * If THIS session escalates, its decision card docks here so the user can
 * answer A/B in place via `decideEscalation`. Other sessions' escalations stay
 * silent — they only feed the ModePill badge. Renders nothing when this
 * session has no open escalation.
 *
 * Reuses the structured-decision card treatment from ProjectScopeSection
 * (L436–476): one button per option, ★recommended highlight.
 */

import React from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { selectOpenEscalations } from '@/lib/statusSelectors';

export const InlineEscalationDock: React.FC = () => {
  const currentSession = useSessionStore((s) => s.currentSession);
  const openEscalations = useSupervisorStore((s) => s.openEscalations);
  const decideEscalation = useSupervisorStore((s) => s.decideEscalation);
  const resolveEscalation = useSupervisorStore((s) => s.resolveEscalation);
  const landEpic = useSupervisorStore((s) => s.landEpic);

  if (!currentSession) return null;

  const serverScope = currentSession.serverId ?? 'local';
  // Coherence: this session's open escalations via the shared session-scoped selector.
  const mine = selectOpenEscalations(openEscalations, {
    kind: 'session',
    project: currentSession.project,
    session: currentSession.name,
  });

  if (mine.length === 0) return null;

  return (
    <div
      data-testid="inline-escalation-dock"
      className="px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 space-y-1.5"
    >
      <div className="px-1 text-3xs font-semibold tracking-wide text-warning-600 dark:text-warning-400">
        ⚠ DECISION (this session)
      </div>
      {mine.map((e) => {
        const hasOptions = !!e.options && e.options.length > 0;
        return (
          <div
            key={e.id}
            className="px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 space-y-1"
          >
            <div className="text-2xs leading-snug text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
              {e.questionText}
            </div>
            {hasOptions ? (
              <div className="space-y-1 pt-0.5">
                {e.options!.map((opt) => {
                  const recommended = e.recommended === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => void decideEscalation(serverScope, e.id, opt.id)}
                      title={opt.detail ? `${opt.label} — ${opt.detail}` : opt.label}
                      className={`w-full flex items-start gap-1.5 px-1.5 py-1 rounded text-left text-2xs transition-colors border ${
                        recommended
                          ? 'border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/30 text-accent-800 dark:text-accent-200 hover:bg-accent-100 dark:hover:bg-accent-900/50'
                          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      <span className="flex-1 min-w-0">
                        <span className="font-medium leading-tight">{opt.label}</span>
                        {recommended && (
                          <span className="ml-1 text-3xs font-semibold text-accent-600 dark:text-accent-400">
                            ★ recommended
                          </span>
                        )}
                        {opt.detail && (
                          <span className="block text-3xs text-gray-500 dark:text-gray-400 leading-tight whitespace-pre-wrap break-words">
                            {opt.detail}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : e.kind === 'epic-ready-to-land' ? (
              // LAND card (epic-landing P3): LAND merges to master (server proof
              // gate); Resolve here would only dismiss + strand the work off-master.
              <div className="flex items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => void landEpic(serverScope, e.project, e.id)}
                  className="px-1.5 py-0.5 text-3xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                  title="Re-derive land-readiness server-side, then merge this epic onto master"
                >
                  🚀 Land
                </button>
                <button
                  type="button"
                  onClick={() => void resolveEscalation(serverScope, e.id, 'resolved')}
                  className="px-1.5 py-0.5 text-3xs font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                  title="Dismiss without landing (the work stays on its epic branch)"
                >
                  Dismiss
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => void resolveEscalation(serverScope, e.id, 'resolved')}
                  className="px-1.5 py-0.5 text-3xs font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                  title="Mark resolved"
                >
                  Resolve
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
