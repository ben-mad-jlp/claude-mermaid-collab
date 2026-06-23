import React, { useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSessionStore } from '@/stores/sessionStore';
import { computePlanTotals, type PlanTotals } from '@/components/supervisor/PlanTotals';
import { useFleetStatusByProject } from '@/hooks/useFleetStatus';
import { ZenSessionCard, type DaemonTotals } from './ZenSessionCard';
import { pulseStage, isArmed, nextUp as computeNextUp, nextWorkSuggestions, type NextUp, type NextWork } from '@/lib/zenPulse';
import { useUsageStore } from '@/stores/usageStore';
import { activateSessionCard, type SessionCardData } from '@/components/layout/SessionCard';

// One account-wide rate-limit gauge (5-hour or 7-day window) for the Zen top bar.
// Colour mirrors the statusline: green < 50, yellow 50–79, red ≥ 80.
const UsageBar: React.FC<{ label: string; percent: number | null }> = ({ label, percent }) => {
  const pct = percent ?? 0;
  // Tier colours mirror the statusline: green < 50, amber 50–79, red ≥ 80. Both the fill
  // AND the percentage read-out take the tier colour so the level is legible at a glance.
  const tier =
    percent == null
      ? { fill: 'bg-gray-400 dark:bg-gray-500', text: 'text-gray-400 dark:text-gray-500' }
      : pct >= 80
        ? { fill: 'bg-danger-500', text: 'text-danger-600 dark:text-danger-400' }
        : pct >= 50
          ? { fill: 'bg-yellow-500', text: 'text-yellow-600 dark:text-yellow-400' }
          : { fill: 'bg-success-500', text: 'text-success-600 dark:text-success-400' };
  return (
    <div className="flex items-center gap-1.5" title={`${label} usage: ${percent == null ? 'unknown' : `${pct}%`}`}>
      <span className={`text-3xs font-semibold tabular-nums ${tier.text}`}>{label}</span>
      <div className="w-20 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden ring-1 ring-black/5 dark:ring-white/10">
        <div className={`h-full rounded-full transition-all ${tier.fill}`} style={{ width: `${Math.max(percent == null ? 0 : 3, Math.min(pct, 100))}%` }} />
      </div>
      <span className={`text-3xs font-bold tabular-nums w-7 text-right ${tier.text}`}>
        {percent == null ? '—' : `${pct}%`}
      </span>
    </div>
  );
};

// ZenMode (redesign 2026-06-20) — the ENTIRE window is Zen: a calm vertical scroll
// of one card per watched session. Each card is its project bar + a centered
// progress paragraph + (only when asking) a question with selectable answers. The
// global verdict bar / pill lists / single-focus-card model of v1 is gone; every
// session is the same primitive. One button exits back to the Bridge.
//
// Ordering: sessions that need you (a live question) float to the top, then stuck,
// then active, then the rest — recency-broken within each tier — so the thing that
// matters is first without hiding anything (all watched sessions get a card).
//
// BUT the float-to-top sort only earns its keep when cards overflow and you'd have to
// scroll to find the important one. When every card already fits on screen, reordering
// is just noise — cards visibly jump as statuses/recency stream in. So we keep a STABLE
// order (subscription order) while everything fits, and switch to the ranked order only
// when the grid actually overflows (measured below).

function sessionRank(args: { needsYou: boolean; state?: string; status?: string; armedIdle?: boolean }): number {
  if (args.needsYou) return 0;
  if (args.state === 'wedged' || args.state === 'stalled' || args.status === 'stuck') return 1;
  if (args.state === 'active' || args.status === 'working') return 2;
  if (args.armedIdle) return 2.5; // ready-for-more idle floats just under live work (overflow-only)
  return 3;
}

export const ZenMode: React.FC = () => {
  const toggleZenMode = useUIStore((s) => s.toggleZenMode);

  const openEscalations = useSupervisorStore((s) => s.openEscalations);
  const sessionSummaries = useSupervisorStore((s) => s.sessionSummaries);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const decideEscalation = useSupervisorStore((s) => s.decideEscalation);
  const nudge = useSupervisorStore((s) => s.nudge);
  const answerPaneMulti = useSupervisorStore((s) => s.answerPaneMulti);
  const refreshSummaryNow = useSupervisorStore((s) => s.refreshSummaryNow);

  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const order = useSubscriptionStore((s) => s.order);
  const subscribe = useSubscriptionStore((s) => s.subscribe);
  const unsubscribe = useSubscriptionStore((s) => s.unsubscribe);

  const allSessions = useSessionStore((s) => s.sessions);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const setActiveProject = useUIStore((s) => s.setActiveProject);

  // "Add session" picker (Zen-native): list sessions not already watched → subscribe.
  const [addOpen, setAddOpen] = useState(false);
  const available = useMemo(
    () => allSessions
      .filter((s) => !subscriptions[`${s.serverId ?? 'local'}:${s.project}:${s.name}`])
      .sort((a, b) => (a.project + a.name).localeCompare(b.project + b.name)),
    [allSessions, subscriptions],
  );
  // Grouped by project for the picker — each project is a collapsible section.
  const availableByProject = useMemo(() => {
    const groups = new Map<string, typeof available>();
    for (const s of available) {
      const list = groups.get(s.project) ?? [];
      list.push(s);
      groups.set(s.project, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [available]);
  // Which project sections are expanded. Starts EMPTY → every project collapsed; reset
  // to collapsed each time the picker opens.
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const openAddPicker = () => { setExpandedProjects(new Set()); setAddOpen(true); };
  const toggleProject = (project: string) =>
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project); else next.add(project);
      return next;
    });

  // Which card is expanded (key = `serverId:project:session`). Only one at a time.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Live-ticking clock so recency ordering refreshes (cheap; once a second).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Account-wide rate-limit usage (5h / 7d) — kept fresh by the statusline hook via WS
  // (`claude_usage_update`); first-paint hydration happens in App (zen zones must not do
  // direct network, per mobile-parity). Statusline ticks frequently, so this stays current.
  const usage = useUsageStore((s) => s.usage);

  // Per-project rollup totals for each card's project bar.
  const totalsByProject = useMemo(() => {
    const m: Record<string, PlanTotals> = {};
    for (const [project, todos] of Object.entries(todosByProject)) m[project] = computePlanTotals(todos);
    return m;
  }, [todosByProject]);

  // The next-ready (or blocked) work per project — drives the idle Pulse chip.
  const nextUpByProject = useMemo(() => {
    const m: Record<string, NextUp> = {};
    for (const [project, todos] of Object.entries(todosByProject)) m[project] = computeNextUp(todos);
    return m;
  }, [todosByProject]);

  // The fuller next-work candidate lists (ready leaves / epics / inbox) per project —
  // drives the "What's next" full-card panel.
  const nextWorkByProject = useMemo(() => {
    const m: Record<string, NextWork> = {};
    for (const [project, todos] of Object.entries(todosByProject)) m[project] = nextWorkSuggestions(todos);
    return m;
  }, [todosByProject]);

  // Per-card Pulse dismissal: key → the paneSeenAt it was dismissed at (sleeps the lane
  // for that idle episode; re-arms when paneSeenAt advances). See zenPulse.pulseStage.
  const [dismissed, setDismissed] = useState<Record<string, number>>({});

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

  // Open a watched session in the full collab UI. Route through the shared `useDiveIn`
  // so it behaves IDENTICALLY to a watching-card click: select the session, fire its
  // activation side-effects (spawn the terminal on the row's server, focus its browser
  // tab, open the terminal drawer). Zen is a NON-MUTATING overlay: opening a card must
  // NOT change the underlying studio layout — it does EXACTLY what a watched-card click
  // does, then drops the overlay so the user lands back in whatever they had open.
  const openSession = (project: string, session: string, serverId: string) => {
    // Mirror a watched-session-card click EXACTLY (SessionCard onClick → handleNavigate +
    // activateSessionCard): select the session, drive the Bridge to its project, then fire
    // the same activation side-effects (spawn terminal on the row's server, focus its
    // browser tab, open the terminal drawer). We deliberately do NOT call setMode('studio')
    // — that force-opened the artifact viewer (viewerVisible:true) on top of the card
    // click. Exiting Zen (toggleZenMode) reveals the pre-Zen layout unchanged; the only
    // delta is the card click itself, which is what the user asked for.
    const match = allSessions.find((s) => s.project === project && s.name === session);
    setCurrentSession(match ?? { project, name: session, serverId });
    setActiveProject(project);
    const card: SessionCardData = {
      serverId: match?.serverId ?? serverId,
      project,
      session,
      status: 'unknown',
      lastUpdate: 0,
    };
    void activateSessionCard(card).catch(() => {});
    // Drop the Zen overlay — back to the exact pre-Zen layout, plus the card click.
    toggleZenMode();
  };

  // All watched sessions, enriched. `stable` keeps the subscription order (no jumping);
  // `ranked` is the needs-you → stuck → active → rest float-to-top sort. We pick between
  // them based on whether the grid overflows (see `overflowing` below).
  const { stable, ranked } = useMemo(() => {
    const list = order.filter((k) => subscriptions[k]).map((k) => ({ k, s: subscriptions[k] }));
    const stable = list.map(({ k, s }) => {
      const summary = sessionSummaries[`${s.project}::${s.session}`];
      const escalation =
        openEscalations.find((e) => e.project === s.project && e.session === s.session && e.status === 'open') ?? null;
      const needsYou =
        !!escalation || summary?.structured?.status === 'needs-input';
      const recency = Math.max(summary?.summaryUpdatedAt ?? 0, summary?.paneSeenAt ?? 0, summary?.updatedAt ?? 0);
      // Idle Pulse: a green (idle/quiet) session with no question warms up over minutes.
      const isIdle = !escalation && summary?.structured?.status !== 'needs-input'
        && (summary?.structured?.status === 'idle' || summary?.progressState === 'quiet');
      const stage = isIdle ? pulseStage(summary?.paneSeenAt, now, dismissed[k] ?? 0) : 'off';
      const rank = sessionRank({ needsYou, state: summary?.progressState, status: summary?.structured?.status, armedIdle: isArmed(stage) });
      return { k, s, summary, escalation, rank, recency, stage };
    });
    const ranked = [...stable].sort((a, b) => (a.rank - b.rank) || (b.recency - a.recency));
    return { stable, ranked };
  }, [order, subscriptions, sessionSummaries, openEscalations, now, dismissed]);

  // Does the grid overflow its scroll area (i.e. you'd have to scroll to see every
  // card)? Measured on the scroll container; re-checked on resize and whenever the
  // card set / sizing changes. When it doesn't overflow we keep the stable order.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  const cards = overflowing ? ranked : stable;

  // Density: with few cards, grow fonts/columns to fill the space; shrink as more pile in.
  const n = cards.length;
  const baseTier: 'xs' | 'sm' | 'md' | 'lg' = n <= 3 ? 'lg' : n <= 6 ? 'md' : n <= 12 ? 'sm' : 'xs';
  // Balanced grid: distribute cards into near-square rows so the last row isn't lopsided
  // and the whole viewport fills (6 → 3×2, 4 → 2×2, 9 → 3×3) — no row-of-4-then-2.
  // rows = round(√n), cols = ceil(n/rows). Crucially this does NOT depend on which card is
  // expanded — expanding shows that card's detail IN PLACE; the grid and every OTHER card
  // stay put. (Coupling the layout to expandedKey made the whole screen reflow on every
  // "more" click, which read as a distracting full refresh.)
  const balancedRows = Math.max(1, Math.round(Math.sqrt(n)));
  const fixedCols = Math.max(1, Math.ceil(n / balancedRows));
  const cardSize = (_key: string): 'xs' | 'sm' | 'md' | 'lg' => baseTier;
  // Per-tier minimum row height: few cards still stretch (1fr) to fill the viewport,
  // but once enough pile in to push past the screen the grid overflows into a scroll —
  // which is exactly when the ranked float-to-top order kicks in.
  const minRowHeight =
    baseTier === 'lg' ? '15rem' : baseTier === 'md' ? '12rem' : baseTier === 'sm' ? '10rem' : '8rem';

  return (
    <div className="flex flex-col h-screen min-h-0 bg-gray-50 dark:bg-gray-900" style={{ fontFamily: "'Open Sans', ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      {/* Minimal top strip — title + add session + exit. */}
      <div className="flex items-center justify-between px-5 py-2.5 shrink-0">
        <span className="text-sm font-semibold text-gray-500 dark:text-gray-400 tracking-wide">Zen</span>
        {/* Account-wide rate-limit usage — the 5-hour and 7-day rolling windows. */}
        <div className="flex items-center gap-4">
          <UsageBar label="5h" percent={usage?.fiveHourPercent ?? null} />
          <UsageBar label="7d" percent={usage?.sevenDayPercent ?? null} />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openAddPicker}
            title="Watch another session"
            className="px-3 py-1 rounded-full text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-200/70 dark:hover:bg-gray-800 transition-colors"
          >
            + Add session
          </button>
          <button
            type="button"
            onClick={toggleZenMode}
            title="Exit Zen — back to the Bridge"
            className="px-3 py-1 rounded-full text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-200/70 dark:hover:bg-gray-800 transition-colors"
          >
            ⤢ Exit Zen
          </button>
        </div>
      </div>

      {/* Add-session picker — sessions not already watched; click to subscribe. */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setAddOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl w-96 max-h-[28rem] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Watch a session</span>
              <button type="button" onClick={() => setAddOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {available.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-gray-400 dark:text-gray-500">All known sessions are already being watched.</div>
              ) : (
                availableByProject.map(([project, sessions]) => {
                  const open = expandedProjects.has(project);
                  const name = project.split('/').pop() || project;
                  return (
                    <div key={project} className="mb-0.5">
                      {/* Collapsible project header — starts collapsed. */}
                      <button
                        type="button"
                        onClick={() => toggleProject(project)}
                        title={project}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors text-left"
                      >
                        <svg
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className={`w-3 h-3 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
                          aria-hidden
                        >
                          <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{name}</span>
                        <span className="shrink-0 text-3xs tabular-nums text-gray-400 dark:text-gray-500">{sessions.length}</span>
                      </button>
                      {/* Sessions in this project — only when expanded. */}
                      {open && sessions.map((s) => (
                        <button
                          key={`${s.serverId ?? 'local'}:${s.project}:${s.name}`}
                          type="button"
                          onClick={() => { subscribe(s.serverId ?? 'local', s.project, s.name); setAddOpen(false); }}
                          className="w-full text-left pl-8 pr-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors flex items-center gap-2"
                        >
                          <span className="text-sm text-gray-700 dark:text-gray-200 truncate">{s.name}</span>
                        </button>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* The cards — CSS grid that fills the full height, rows stretch to share space. */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
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
              gridTemplateColumns: `repeat(${fixedCols}, minmax(0, 1fr))`,
              gridAutoRows: `minmax(${minRowHeight}, 1fr)`,
            }}
          >
            {cards.map(({ k, s, summary, escalation, stage }) => {
              const key = k;
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
                    contextPercent={s.contextPercent}
                    onClose={() => unsubscribe(k)}
                    stage={stage}
                    nextUp={nextUpByProject[s.project]}
                    nextWork={nextWorkByProject[s.project]}
                    onDismiss={() => setDismissed((d) => ({ ...d, [k]: summary?.paneSeenAt ?? now }))}
                    now={now}
                    size={cardSize(key)}
                    expanded={expandedKey === key}
                    onToggleExpand={() => setExpandedKey((k) => (k === key ? null : key))}
                    onDecideEscalation={(sid, id, opt) => decideEscalation(sid, id, opt)}
                    subStatus={s.status}
                    lastUpdate={s.lastUpdate}
                    stale={s.stale}
                    onAnswerPane={(sid, p, sess, v) => nudge(sid, p, sess, v)}
                    onAnswerPaneMulti={(sid, p, sess, nums) => answerPaneMulti(sid, p, sess, nums)}
                    onRequestRefresh={(sid, p, sess) => void refreshSummaryNow(sid, p, sess)}
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
