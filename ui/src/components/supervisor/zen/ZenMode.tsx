import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useFreshnessStore } from '@/stores/freshnessStore';
import { selectFreshness } from '@/lib/freshnessSelectors';
import { computePlanTotals } from '@/components/supervisor/PlanTotals';
import { selectTriageTop } from '@/lib/triageSelectors';
import { selectParagraphStack } from '@/lib/paragraphStack';
import { VerdictBar } from './VerdictBar';
import { CalmCanvas } from './CalmCanvas';
import { FocusCard } from './FocusCard';
import { WedgeFocusCard } from './WedgeFocusCard';
import { PillList } from './PillList';
import { ProjectPill } from './ProjectPill';
import { SessionPill } from './SessionPill';
import { SessionParagraphCard } from './SessionParagraphCard';

const THRESHOLDS = [60, 70, 80, 90] as const;

export const ZenMode: React.FC = () => {
  const toggleZenMode = useUIStore((s) => s.toggleZenMode);

  const openEscalations = useSupervisorStore((s) => s.openEscalations);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const decideEscalation = useSupervisorStore((s) => s.decideEscalation);
  const resolveEscalation = useSupervisorStore((s) => s.resolveEscalation);
  const landEpic = useSupervisorStore((s) => s.landEpic);
  const sessionSummaries = useSupervisorStore((s) => s.sessionSummaries);
  const snoozeSession = useSupervisorStore((s) => s.snoozeSession);
  const nudge = useSupervisorStore((s) => s.nudge);
  const capturePane = useSupervisorStore((s) => s.capturePane);

  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const order = useSubscriptionStore((s) => s.order);

  const lastWsMessageAt = useFreshnessStore((s) => s.lastWsMessageAt);

  // §1 — live-ticking now so snooze/freshness re-evaluate each second
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // §2 — escalation-level client snooze
  const [snoozedEsc, setSnoozedEsc] = useState<Record<string, number>>({});
  const snoozeItem = useCallback(
    (id: string, ms: number) => setSnoozedEsc((m) => ({ ...m, [id]: Date.now() + ms })),
    [],
  );

  // §4 — optimistic clear + toast + 5s undo
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ serverId: string; id: string; label: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearItem = useCallback(
    (serverId: string, id: string, label: string) => {
      setCleared((s) => new Set(s).add(id));
      setToast({ serverId, id, label });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void resolveEscalation(serverId, id, 'resolved');
        setToast(null);
      }, 5000);
    },
    [resolveEscalation],
  );

  const undoClear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast((t) => {
      if (t) setCleared((s) => { const n = new Set(s); n.delete(t.id); return n; });
      return null;
    });
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // §3 — operator-gated "only you" mark for deterministic top-tier outranking
  const [onlyYou, setOnlyYou] = useState<Set<string>>(new Set());
  const markOnlyYou = useCallback(
    (id: string) =>
      setOnlyYou((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    [],
  );

  // §5 — watchdog sensitivity threshold (local optimistic state; commit is TODO)
  const [threshold, setThreshold] = useState(80);

  // Derived: snoozed + cleared items hidden; onlyYou items boosted to gated tier
  const visibleEscalations = useMemo(
    () =>
      openEscalations.filter(
        (e) => !(snoozedEsc[e.id] && snoozedEsc[e.id] > now) && !cleared.has(e.id),
      ),
    [openEscalations, snoozedEsc, cleared, now],
  );

  const gatedEscalations = useMemo(
    () => visibleEscalations.map((e) => (onlyYou.has(e.id) ? { ...e, operatorGated: true } : e)),
    [visibleEscalations, onlyYou],
  );

  // Zone 1: per-project plan totals
  const projectTotals = useMemo(
    () =>
      Object.entries(todosByProject).map(([project, todos]) => ({
        project,
        totals: computePlanTotals(todos),
      })),
    [todosByProject],
  );

  // Zone 2: ordered session list
  const sessions = useMemo(
    () => order.map((k) => subscriptions[k]).filter(Boolean),
    [order, subscriptions],
  );

  const freshness = useMemo(() => selectFreshness(lastWsMessageAt, now), [lastWsMessageAt, now]);
  const triageTop = useMemo(
    () => selectTriageTop(gatedEscalations, sessionSummaries, now),
    [gatedEscalations, sessionSummaries, now],
  );
  const paragraphStack = useMemo(
    () => selectParagraphStack(sessionSummaries, 5),
    [sessionSummaries],
  );

  const serverFor = (p: string, s: string) =>
    sessions.find((x) => x.project === p && x.session === s)?.serverId ?? 'local';

  const handleOpenSession = (_project: string, _session: string) => {
    // TODO(zen): no session-jump helper exists yet; best-effort leave Zen.
    toggleZenMode();
  };
  const handleKillSession = (_project: string, _session: string) => {
    // TODO(zen): backend kill route does not exist yet.
    console.warn('kill not yet wired');
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-50 dark:bg-gray-900">
      <VerdictBar openEscalations={gatedEscalations} freshness={freshness} now={now} />

      <CalmCanvas>
        {/* Focus card — triage-top: escalation or wedge/unknown session */}
        {triageTop?.kind === 'escalation' && (
          <div className="space-y-2">
            {/* §2/§3 — inline snooze + only-you mark (FocusCard has no such props) */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => markOnlyYou(triageTop.escalation.id)}
                className={`px-2 py-1 rounded text-3xs font-semibold transition-colors ${
                  onlyYou.has(triageTop.escalation.id)
                    ? 'bg-warning-500 text-white hover:bg-warning-600'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
                title="Boost to top priority (only you)"
              >
                {onlyYou.has(triageTop.escalation.id) ? '★ Only you' : '☆ Mark priority'}
              </button>
              <button
                type="button"
                onClick={() => snoozeItem(triageTop.escalation.id, 10 * 60_000)}
                className="px-2 py-1 rounded text-3xs font-semibold bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                title="Snooze for 10 minutes"
              >
                Snooze 10m
              </button>
            </div>
            <FocusCard
              escalation={triageTop.escalation}
              serverScope={triageTop.escalation.serverId ?? 'local'}
              onDecide={(sid, id, optId) => void decideEscalation(sid, id, optId)}
              onResolve={(sid, id, _status) =>
                clearItem(
                  sid,
                  id,
                  triageTop.escalation.questionText?.slice(0, 40) ?? id,
                )
              }
              onLand={(sid, project, id) => void landEpic(sid, project, id)}
            />
          </div>
        )}
        {(triageTop?.kind === 'wedge' || triageTop?.kind === 'unknown') && (
          <WedgeFocusCard
            summary={triageTop.summary}
            now={now}
            onOpen={handleOpenSession}
            onNudge={(p, s) =>
              void nudge(serverFor(p, s), p, s, 'Are you stuck? Reply with status or next step.')
            }
            onKill={handleKillSession}
            onSnooze={(p, s) => snoozeSession(p, s, Date.now() + 10 * 60_000)}
          />
        )}

        {/* §4 — sent → X toast with undo */}
        {toast && (
          <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gray-800 dark:bg-gray-700 text-white text-xs">
            <span>sent → {toast.label}</span>
            <button
              type="button"
              onClick={undoClear}
              className="font-semibold underline hover:no-underline"
            >
              Undo
            </button>
          </div>
        )}

        {/* Z8 — always-visible interpreter paragraph stack (recency-sorted ≤5) */}
        {paragraphStack.length > 0 && (
          <div className={`space-y-2 ${!freshness.live ? 'grayscale opacity-60 transition-all' : ''}`}>
            <div className="text-3xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Watched sessions
            </div>
            <div className="space-y-2">
              {paragraphStack.map((m) => (
                <SessionParagraphCard
                  key={m.key}
                  summary={m.summary}
                  now={now}
                  serverId={serverFor(m.project, m.session)}
                  escalation={
                    visibleEscalations.find(
                      (e) => e.project === m.project && e.session === m.session && e.status === 'open',
                    ) ?? null
                  }
                  onDecideEscalation={(sid, id, opt) => void decideEscalation(sid, id, opt)}
                  onAnswerPane={(sid, p, s, v) => void nudge(sid, p, s, v)}
                  onResolve={(sid, id, _st) =>
                    clearItem(
                      sid,
                      id,
                      visibleEscalations.find((e) => e.id === id)?.questionText?.slice(0, 40) ?? id,
                    )
                  }
                  onSnooze={(p, s) => snoozeSession(p, s, Date.now() + 10 * 60_000)}
                  onFetchPane={(p, s) => capturePane(serverFor(p, s), p, s)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Zone 1 — project totals */}
        <PillList title="Projects" emptyLabel="No projects tracked" desaturated={!freshness.live}>
          {projectTotals.map(({ project, totals }) => (
            <ProjectPill key={project} project={project} totals={totals} />
          ))}
        </PillList>

        {/* Zone 2 — session status pills */}
        <PillList title="Sessions" emptyLabel="No subscribed sessions" desaturated={!freshness.live}>
          {sessions.map((s) => (
            <SessionPill
              key={`${s.serverId}:${s.project}:${s.session}`}
              session={s}
              progressState={sessionSummaries[`${s.project}::${s.session}`]?.progressState}
            />
          ))}
        </PillList>

        {/* §5 — watchdog sensitivity (tap-uniform; commit wiring is TODO once route lands) */}
        <div className="space-y-1.5">
          <div className="text-3xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Watchdog sensitivity
          </div>
          <div className="flex gap-1">
            {THRESHOLDS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setThreshold(t);
                  // TODO(z9): wire to set_watchdog_threshold once a /api/supervisor/watchdog-threshold route + store action land (sibling leaf).
                }}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  threshold === t
                    ? 'bg-accent-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {t}%
              </button>
            ))}
          </div>
        </div>

        {/* Bridge toggle */}
        <div className="pt-2">
          <button
            type="button"
            onClick={toggleZenMode}
            className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            title="Switch to Bridge view"
          >
            ⤢ Bridge
          </button>
        </div>
      </CalmCanvas>
    </div>
  );
};

export default ZenMode;
