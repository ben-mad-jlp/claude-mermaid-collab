import React, { useMemo, useState, useEffect } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSessionStore } from '@/stores/sessionStore';
import { computePlanTotals, type PlanTotals } from '@/components/supervisor/PlanTotals';
import { useFleetStatusByProject } from '@/hooks/useFleetStatus';
import { ZenSessionCard, type DaemonTotals } from './ZenSessionCard';

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

  const allSessions = useSessionStore((s) => s.sessions);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);

  // Which card is expanded (key = `serverId:project:session`). Only one at a time.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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

  // Watched sessions + their projects (for the fleet poll). serverScope is the
  // dominant server of the watched sessions (desktop is effectively single-server).
  const watched = useMemo(() => order.map((k) => subscriptions[k]).filter(Boolean), [order, subscriptions]);
  const projects = useMemo(() => [...new Set(watched.map((s) => s.project))], [watched]);
  const serverScope = watched[0]?.serverId ?? 'local';

  // Daemon (leaf-executor) totals per project, derived from the fleet read-model.
  const fleet = useFleetStatusByProject(serverScope, projects);
  const daemonByProject = useMemo(() => {
    const m: Record<string, DaemonTotals> = {};
    for (const e of Object.values(fleet)) {
      const d = (m[e.project] ??= { working: 0, lanes: 0, permission: 0 });
      d.lanes++;
      if (e.state === 'working') d.working++;
      if (e.state === 'permission') d.permission++;
    }
    return m;
  }, [fleet]);

  // Open a watched session in the full collab UI: select it (prefer the real Session
  // object so no field is lost) then exit Zen back to the Bridge shell.
  const openSession = (project: string, session: string, serverId: string) => {
    const real = allSessions.find((s) => s.project === project && s.name === session && s.serverId === serverId)
      ?? allSessions.find((s) => s.project === project && s.name === session);
    setCurrentSession(real ?? { project, serverId, name: session });
    toggleZenMode();
  };

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

  // Density: with few cards, grow fonts/columns to fill the space; shrink as more pile
  // in. When a card is expanded it takes the large tier and every other card drops to
  // the smallest (focus + context) — only one is expanded at a time (expandedKey).
  const n = cards.length;
  const baseTier: 'xs' | 'sm' | 'md' | 'lg' = n <= 3 ? 'lg' : n <= 6 ? 'md' : n <= 12 ? 'sm' : 'xs';
  // Minimum column width — wider for fewer cards so the grid fills horizontal space.
  const minColWidth = expandedKey
    ? '32rem'
    : baseTier === 'lg' ? '34rem' : baseTier === 'md' ? '26rem' : baseTier === 'sm' ? '20rem' : '16rem';
  const cardSize = (key: string): 'xs' | 'sm' | 'md' | 'lg' =>
    expandedKey ? (key === expandedKey ? 'lg' : 'xs') : baseTier;

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

      {/* The cards — CSS grid that fills the full height, rows stretch to share space. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        {cards.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
            No watched sessions
          </div>
        ) : (
          // Grid: auto-fill columns of minColWidth, rows divide height equally (1fr) so
          // cards fill the screen instead of bunching at the top.
          <div
            className="h-full grid gap-3 py-2 transition-all"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${minColWidth}, 1fr))`,
              gridAutoRows: '1fr',
            }}
          >
            {cards.map(({ s, summary, escalation }) => {
              const key = `${s.serverId}:${s.project}:${s.session}`;
              return (
                <div key={key} className="min-h-0 h-full">
                  <ZenSessionCard
                    project={s.project}
                    session={s.session}
                    serverId={s.serverId ?? 'local'}
                    summary={summary}
                    totals={totalsByProject[s.project]}
                    daemon={daemonByProject[s.project]}
                    escalation={escalation}
                    now={now}
                    size={cardSize(key)}
                    expanded={expandedKey === key}
                    onToggleExpand={() => setExpandedKey((k) => (k === key ? null : key))}
                    onDecideEscalation={(sid, id, opt) => void decideEscalation(sid, id, opt)}
                    onAnswerPane={(sid, p, sess, v) => void nudge(sid, p, sess, v)}
                    onOpen={openSession}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ZenMode;
