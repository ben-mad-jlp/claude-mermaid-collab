import React from 'react';
import type { SessionSummary, Escalation } from '@/stores/supervisorStore';
import { type PlanTotals } from '@/components/supervisor/PlanTotals';
import { FUNNEL_SEGMENTS, STATUS_STYLE } from '@/components/supervisor/bridge/funnel';

// ZenSessionCard — the SINGLE Zen primitive (redesign 2026-06-20). One card per
// watched session: a project bar across the top (project + totals as symbols), a
// big centered progress paragraph, and — only when the session is asking — the
// question with selectable answers along the bottom. Nothing else; calm by default.

/** Per-project daemon (leaf-executor) rollup — derived from the fleet read-model. */
export interface DaemonTotals {
  /** Lanes actively running a node right now. */
  working: number;
  /** Claimed in-progress lanes (working + idle). */
  lanes: number;
  /** Lanes parked on a permission prompt. */
  permission: number;
}

export interface ZenSessionCardProps {
  project: string;
  session: string;
  serverId: string;
  summary?: SessionSummary;
  /** The project's plan rollup totals, shown as symbols in the top bar. */
  totals?: PlanTotals;
  /** The project's daemon (leaf-executor) totals, shown alongside the plan totals. */
  daemon?: DaemonTotals;
  /** Open escalation for THIS session, if any (structured options → decide). */
  escalation?: Escalation | null;
  onDecideEscalation: (serverId: string, id: string, optionId: string) => void;
  onAnswerPane: (serverId: string, project: string, session: string, value: string) => void;
  /** Bring this session up in the full collab UI (sets current session + exits Zen). */
  onOpen: (project: string, session: string, serverId: string) => void;
}

/** Project bar: project name on the left; the plan funnel rollup + daemon totals as
 *  colored dot+count symbols, then an Open button, on the right. */
const ProjectBar: React.FC<{
  project: string;
  session: string;
  serverId: string;
  totals?: PlanTotals;
  daemon?: DaemonTotals;
  onOpen: (project: string, session: string, serverId: string) => void;
}> = ({ project, session, serverId, totals, daemon, onOpen }) => {
  const name = project.split('/').pop() || project;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-1.5 border-b border-gray-100 dark:border-gray-700/60 bg-gray-50/80 dark:bg-gray-800/50 rounded-t-2xl">
      <span className="text-3xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 truncate" title={project}>
        {name}
      </span>
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Plan totals — funnel buckets as colored dots */}
        {totals && totals.total > 0 && (
          <>
            {FUNNEL_SEGMENTS.map((seg) =>
              seg.key !== 'done' && totals.counts[seg.key] > 0 ? (
                <span key={seg.key} className="flex items-center gap-1 text-3xs font-medium" title={seg.label}>
                  <span className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLE[seg.key].dot}`} />
                  <span className={seg.tint}>{totals.counts[seg.key]}</span>
                </span>
              ) : null,
            )}
            <span className="text-3xs text-gray-400 dark:text-gray-500">{totals.total} open</span>
          </>
        )}
        {/* Daemon totals — leaf-executor lanes (⚙ working / claimed / ⚠ permission) */}
        {daemon && daemon.lanes > 0 && (
          <span className="flex items-center gap-1.5 text-3xs font-medium pl-2 border-l border-gray-200 dark:border-gray-600" title="Daemon lanes (working / claimed)">
            <span className="text-gray-400 dark:text-gray-500">⚙</span>
            <span className="text-info-600 dark:text-info-400">{daemon.working}</span>
            <span className="text-gray-400 dark:text-gray-500">/ {daemon.lanes}</span>
            {daemon.permission > 0 && (
              <span className="text-warning-600 dark:text-warning-400" title="awaiting permission">⚠ {daemon.permission}</span>
            )}
          </span>
        )}
        {/* Open in full collab */}
        <button
          type="button"
          onClick={() => onOpen(project, session, serverId)}
          title="Open this session in the full collab"
          className="px-2 py-0.5 rounded-full text-3xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-200/70 dark:hover:bg-gray-700 transition-colors"
        >
          Open ↗
        </button>
      </div>
    </div>
  );
};

export const ZenSessionCard: React.FC<ZenSessionCardProps> = ({
  project,
  session,
  serverId,
  summary,
  totals,
  daemon,
  escalation,
  onDecideEscalation,
  onAnswerPane,
  onOpen,
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

  // Status (interpreter status, else structural progressState) → a calm dot + label so
  // even a summary-less card conveys state at a glance.
  const status: string = structured?.status ?? summary?.progressState ?? 'unknown';
  const STATUS_META: Record<string, { dot: string; label: string }> = {
    working: { dot: 'bg-success-500', label: 'working' },
    active: { dot: 'bg-success-500', label: 'working' },
    idle: { dot: 'bg-gray-400', label: 'idle' },
    quiet: { dot: 'bg-gray-400', label: 'idle' },
    stuck: { dot: 'bg-danger-500', label: 'stuck' },
    wedged: { dot: 'bg-danger-500', label: 'stuck' },
    stalled: { dot: 'bg-warning-500', label: 'stalling' },
    'needs-input': { dot: 'bg-warning-500', label: 'needs you' },
    unknown: { dot: 'bg-gray-300 dark:bg-gray-600', label: 'unknown' },
  };
  const meta = STATUS_META[status] ?? STATUS_META.unknown;

  // Relative "updated Xm ago" from the interpreter write, so staleness is visible.
  const updatedAgo = (() => {
    const ts = summary?.summaryUpdatedAt;
    if (!ts) return null;
    const mins = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
    return mins === 0 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
  })();

  return (
    <div
      data-testid="zen-session-card"
      className={`w-full max-w-2xl mx-auto rounded-2xl border bg-white dark:bg-gray-800 shadow-sm overflow-hidden transition-shadow ${
        hasQuestion
          ? 'border-warning-300 dark:border-warning-700/70 ring-1 ring-warning-200 dark:ring-warning-900/40'
          : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      <ProjectBar project={project} session={session} serverId={serverId} totals={totals} daemon={daemon} onOpen={onOpen} />

      {/* Body — centered paragraph */}
      <div className="px-6 py-8 flex flex-col items-center text-center gap-2 min-h-[7rem] justify-center">
        <span className="flex items-center gap-1.5 text-3xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} title={meta.label} />
          {sessionName}
        </span>
        {paragraph ? (
          <p className="text-base leading-relaxed text-gray-800 dark:text-gray-100 max-w-prose whitespace-pre-wrap">
            {paragraph}
          </p>
        ) : (
          <p className="text-sm italic text-gray-400 dark:text-gray-500">No summary yet · {meta.label}</p>
        )}
        {updatedAgo && (
          <span className="text-3xs text-gray-300 dark:text-gray-600">updated {updatedAgo}</span>
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
