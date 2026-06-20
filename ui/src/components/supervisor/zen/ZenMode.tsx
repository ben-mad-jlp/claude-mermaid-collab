import React, { useMemo, useState, useEffect } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { computePlanTotals, type PlanTotals } from '@/components/supervisor/PlanTotals';
import { ZenSessionCard } from './ZenSessionCard';

// ZenMode (redesign 2026-06-20) — the ENTIRE window is Zen: a calm vertical scroll
// of one card per watched session. Each card is its project bar + a centered
// progress paragraph + (only when asking) a question with selectable answers. The
// global verdict bar / pill lists / single-focus-card model of v1 is gone; every
// session is the same primitive. One button exits back to the Bridge.
//
// Ordering: sessions that need you (a live question) float to the top, then stuck,
// then active, then the rest — recency-broken within each tier — so the thing that
// matters is first without hiding anything (all watched sessions get a card).

function sessionRank(args: { needsYou: boolean; state?: string; status?: string }): number {
  if (args.needsYou) return 0;
  if (args.state === 'wedged' || args.state === 'stalled' || args.status === 'stuck') return 1;
  if (args.state === 'active' || args.status === 'working') return 2;
  return 3;
}

export const ZenMode: React.FC = () => {
  const toggleZenMode = useUIStore((s) => s.toggleZenMode);

  const openEscalations = useSupervisorStore((s) => s.openEscalations);
  const sessionSummaries = useSupervisorStore((s) => s.sessionSummaries);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const decideEscalation = useSupervisorStore((s) => s.decideEscalation);
  const nudge = useSupervisorStore((s) => s.nudge);

  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const order = useSubscriptionStore((s) => s.order);

  // Live-ticking clock so recency ordering refreshes (cheap; once a second).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Per-project rollup totals for each card's project bar.
  const totalsByProject = useMemo(() => {
    const m: Record<string, PlanTotals> = {};
    for (const [project, todos] of Object.entries(todosByProject)) m[project] = computePlanTotals(todos);
    return m;
  }, [todosByProject]);

  // All watched sessions, enriched + ordered (needs-you → stuck → active → rest).
  const cards = useMemo(() => {
    const list = order.map((k) => subscriptions[k]).filter(Boolean);
    const decorated = list.map((s) => {
      const summary = sessionSummaries[`${s.project}::${s.session}`];
      const escalation =
        openEscalations.find((e) => e.project === s.project && e.session === s.session && e.status === 'open') ?? null;
      const needsYou =
        !!escalation || summary?.structured?.status === 'needs-input';
      const recency = Math.max(summary?.summaryUpdatedAt ?? 0, summary?.paneSeenAt ?? 0, summary?.updatedAt ?? 0);
      const rank = sessionRank({ needsYou, state: summary?.progressState, status: summary?.structured?.status });
      return { s, summary, escalation, rank, recency };
    });
    return decorated.sort((a, b) => (a.rank - b.rank) || (b.recency - a.recency));
  }, [order, subscriptions, sessionSummaries, openEscalations]);

  return (
    <div className="flex flex-col h-screen min-h-0 bg-gray-50 dark:bg-gray-900">
      {/* Minimal top strip — title + exit. Nothing else. */}
      <div className="flex items-center justify-between px-5 py-2.5 shrink-0">
        <span className="text-sm font-semibold text-gray-500 dark:text-gray-400 tracking-wide">Zen</span>
        <button
          type="button"
          onClick={toggleZenMode}
          title="Exit Zen — back to the Bridge"
          className="px-3 py-1 rounded-full text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-200/70 dark:hover:bg-gray-800 transition-colors"
        >
          ⤢ Exit Zen
        </button>
      </div>

      {/* The cards — calm vertical scroll, one per session. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-10">
        {cards.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
            No watched sessions
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            {cards.map(({ s, summary, escalation }) => (
              <ZenSessionCard
                key={`${s.serverId}:${s.project}:${s.session}`}
                project={s.project}
                session={s.session}
                serverId={s.serverId ?? 'local'}
                summary={summary}
                totals={totalsByProject[s.project]}
                escalation={escalation}
                onDecideEscalation={(sid, id, opt) => void decideEscalation(sid, id, opt)}
                onAnswerPane={(sid, p, sess, v) => void nudge(sid, p, sess, v)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ZenMode;
