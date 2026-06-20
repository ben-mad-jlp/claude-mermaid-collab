import React from 'react';
import type { SessionSummary, Escalation } from '@/stores/supervisorStore';
import { type PlanTotals } from '@/components/supervisor/PlanTotals';
import { FUNNEL_SEGMENTS, STATUS_STYLE } from '@/components/supervisor/bridge/funnel';

// ZenSessionCard — the SINGLE Zen primitive (redesign 2026-06-20). One card per
// watched session: a project bar across the top (project + totals as symbols), a
// big centered progress paragraph, and — only when the session is asking — the
// question with selectable answers along the bottom. Nothing else; calm by default.

export interface ZenSessionCardProps {
  project: string;
  session: string;
  serverId: string;
  summary?: SessionSummary;
  /** The project's rollup totals, shown as symbols in the top bar. */
  totals?: PlanTotals;
  /** Open escalation for THIS session, if any (structured options → decide). */
  escalation?: Escalation | null;
  onDecideEscalation: (serverId: string, id: string, optionId: string) => void;
  onAnswerPane: (serverId: string, project: string, session: string, value: string) => void;
}

/** Project bar: project name on the left, the funnel rollup as colored dot+count
 *  symbols on the right (the "project totals with the symbols"). */
const ProjectBar: React.FC<{ project: string; totals?: PlanTotals }> = ({ project, totals }) => {
  const name = project.split('/').pop() || project;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-1.5 border-b border-gray-100 dark:border-gray-700/60 bg-gray-50/80 dark:bg-gray-800/50 rounded-t-2xl">
      <span className="text-3xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 truncate" title={project}>
        {name}
      </span>
      {totals && totals.total > 0 && (
        <div className="flex items-center gap-2.5 shrink-0">
          {FUNNEL_SEGMENTS.map((seg) =>
            seg.key !== 'done' && totals.counts[seg.key] > 0 ? (
              <span key={seg.key} className="flex items-center gap-1 text-3xs font-medium" title={seg.label}>
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLE[seg.key].dot}`} />
                <span className={seg.tint}>{totals.counts[seg.key]}</span>
              </span>
            ) : null,
          )}
          <span className="text-3xs text-gray-400 dark:text-gray-500">{totals.total} open</span>
        </div>
      )}
    </div>
  );
};

export const ZenSessionCard: React.FC<ZenSessionCardProps> = ({
  project,
  session,
  serverId,
  summary,
  totals,
  escalation,
  onDecideEscalation,
  onAnswerPane,
}) => {
  const sessionName = session.split('/').pop() || session;
  const structured = summary?.structured;
  const paragraph = structured?.paragraph ?? summary?.summaryText ?? '';

  // A question is live when the interpreter flags needs-input OR an open escalation
  // carries options. Options come from the escalation (decide) or the pane (answer).
  const escOptions = escalation?.options ?? null;
  const paneOptions = structured?.options ?? null;
  const questionText =
    escalation?.questionText ?? structured?.question ?? (structured?.status === 'needs-input' ? 'Waiting for input' : null);
  const hasQuestion = !!questionText && ((escOptions && escOptions.length > 0) || (paneOptions && paneOptions.length > 0) || structured?.status === 'needs-input');

  return (
    <div
      data-testid="zen-session-card"
      className="w-full max-w-2xl mx-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden"
    >
      <ProjectBar project={project} totals={totals} />

      {/* Body — centered paragraph */}
      <div className="px-6 py-8 flex flex-col items-center text-center gap-2 min-h-[7rem] justify-center">
        <span className="text-3xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
          {sessionName}
        </span>
        {paragraph ? (
          <p className="text-base leading-relaxed text-gray-800 dark:text-gray-100 max-w-prose whitespace-pre-wrap">
            {paragraph}
          </p>
        ) : (
          <p className="text-sm italic text-gray-400 dark:text-gray-500">No summary yet</p>
        )}
      </div>

      {/* Question — only when the session is asking */}
      {hasQuestion && (
        <div className="px-6 pb-6 pt-2 border-t border-gray-100 dark:border-gray-700/60 flex flex-col items-center gap-3">
          <p className="text-sm text-center text-gray-700 dark:text-gray-200 max-w-prose">{questionText}</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {escOptions && escOptions.length > 0
              ? escOptions.map((opt) => {
                  const recommended = escalation!.recommended === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onDecideEscalation(serverId, escalation!.id, opt.id)}
                      title={opt.detail ?? opt.label}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
                        recommended
                          ? 'border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/40 text-accent-800 dark:text-accent-200'
                          : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      {opt.label}
                      {recommended && <span className="ml-1 text-3xs text-accent-600 dark:text-accent-400">★</span>}
                    </button>
                  );
                })
              : (paneOptions ?? []).map((opt, i) => {
                  const recommended = i === structured?.recommended;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onAnswerPane(serverId, project, session, opt.valueToSend)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
                        recommended
                          ? 'border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/40 text-accent-800 dark:text-accent-200'
                          : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      {opt.label}
                      {recommended && <span className="ml-1 text-3xs text-accent-600 dark:text-accent-400">★</span>}
                    </button>
                  );
                })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ZenSessionCard;
