import React, { useMemo, useState, useEffect } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useFreshnessStore } from '@/stores/freshnessStore';
import { selectFreshness } from '@/lib/freshnessSelectors';
import { computePlanTotals } from '@/components/supervisor/PlanTotals';
import {
  selectTriageTop,
  DEFAULT_SNOOZE_MS,
  nextSnoozeWakeup,
  isRefreshable,
} from '@/lib/triageSelectors';
import { selectParagraphStack } from '@/lib/paragraphStack';
import { VerdictBar } from './VerdictBar';
import { CalmCanvas } from './CalmCanvas';
import { FocusCard } from './FocusCard';
import { WedgeFocusCard } from './WedgeFocusCard';
import { PillList } from './PillList';
import { ProjectPill } from './ProjectPill';
import { SessionPill } from './SessionPill';
import { SessionParagraphCard } from './SessionParagraphCard';

export const ZenMode: React.FC = () => {
  const toggleZenMode = useUIStore((s) => s.toggleZenMode);

  const openEscalations = useSupervisorStore((s) => s.openEscalations);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const decideEscalation = useSupervisorStore((s) => s.decideEscalation);
  const landEpic = useSupervisorStore((s) => s.landEpic);
  const sessionSummaries = useSupervisorStore((s) => s.sessionSummaries);
  const snoozeSessionFor = useSupervisorStore((s) => s.snoozeSessionFor);
  const refreshSummaryNow = useSupervisorStore((s) => s.refreshSummaryNow);
  const clearWithUndo = useSupervisorStore((s) => s.clearWithUndo);
  const undoClear = useSupervisorStore((s) => s.undoClear);
  const markOperatorOnly = useSupervisorStore((s) => s.markOperatorOnly);
  const setWatchdogThreshold = useSupervisorStore((s) => s.setWatchdogThreshold);
  const pendingClears = useSupervisorStore((s) => s.pendingClears);
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

  // Re-surface ticker: arm one timer for the earliest snoozed wakeup so ZenMode
  // re-renders when a session resurfaces (ZenMode doesn't subscribe to hydrateEpoch).
  const [, forceTick] = useState(0);
  useEffect(() => {
    const wake = nextSnoozeWakeup(sessionSummaries, Date.now());
    if (wake == null) return;
    const t = setTimeout(() => forceTick((n) => n + 1), Math.max(0, wake - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [sessionSummaries]);

  // Watchdog threshold UI state (percent, 1–100)
  const [thresholdVal, setThresholdVal] = useState<string>('80');

  // Zone 2: ordered session list
  const sessions = useMemo(
    () => order.map((k) => subscriptions[k]).filter(Boolean),
    [order, subscriptions],
  );

  const serverFor = (p: string, s: string) =>
    sessions.find((x) => x.project === p && x.session === s)?.serverId ?? 'local';

  // clearedIds: pending-clear window items are excluded from triage focus slot
  const clearedIds = useMemo(() => new Set(Object.keys(pendingClears)), [pendingClears]);

  const freshness = useMemo(() => selectFreshness(lastWsMessageAt, now), [lastWsMessageAt, now]);
  const triageTop = useMemo(
    () => selectTriageTop(openEscalations, sessionSummaries, now, { clearedIds }),
    [openEscalations, sessionSummaries, now, clearedIds],
  );
  const paragraphStack = useMemo(
    () => selectParagraphStack(sessionSummaries, 5),
    [sessionSummaries],
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

  // Focus project for watchdog threshold control
  const focusProject = triageTop
    ? triageTop.kind === 'escalation'
      ? triageTop.escalation.project
      : triageTop.summary.project
    : projectTotals[0]?.project;
  const focusServerId =
    (triageTop?.kind === 'escalation' ? triageTop.escalation.serverId : null) ??
    sessions.find((s) => s.project === focusProject)?.serverId ??
    'local';

  const handleOpenSession = (_project: string, _session: string) => {
    // No session-jump helper exists yet; leave Zen.
    toggleZenMode();
  };
  const handleKillSession = (_project: string, _session: string) => {
    console.warn('kill not yet wired');
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-50 dark:bg-gray-900">
      <VerdictBar openEscalations={openEscalations} freshness={freshness} now={now} />

      <CalmCanvas>
        {/* Focus card — triage-top: escalation or wedge/unknown session */}
        {triageTop?.kind === 'escalation' && (
          <div className="space-y-2">
            <FocusCard
              escalation={triageTop.escalation}
              serverScope={triageTop.escalation.serverId ?? 'local'}
              onDecide={(sid, id, optId) => void decideEscalation(sid, id, optId)}
              onResolve={(sid, id, _status) => clearWithUndo(sid, id, 'resolved')}
              onLand={(sid, project, id) => void landEpic(sid, project, id)}
            />
            {/* Z9 affordance row: operator-gated only-you toggle + optimistic clear */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  void markOperatorOnly(
                    triageTop.escalation.serverId ?? 'local',
                    triageTop.escalation.id,
                    !((triageTop.escalation as { operatorGated?: number | boolean }).operatorGated),
                  )
                }
                className={`px-2 py-1 rounded text-3xs font-semibold transition-colors ${
                  (triageTop.escalation as { operatorGated?: number | boolean }).operatorGated
                    ? 'bg-warning-500 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                }`}
              >
                {(triageTop.escalation as { operatorGated?: number | boolean }).operatorGated
                  ? '✓ Only you'
                  : 'Only you'}
              </button>
              <button
                type="button"
                onClick={() =>
                  clearWithUndo(
                    triageTop.escalation.serverId ?? 'local',
                    triageTop.escalation.id,
                    'resolved',
                  )
                }
                className="px-2 py-1 rounded text-3xs font-semibold bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        )}
        {(triageTop?.kind === 'wedge' || triageTop?.kind === 'unknown') && (
          <div className="space-y-1">
            <WedgeFocusCard
              summary={triageTop.summary}
              now={now}
              onOpen={handleOpenSession}
              onNudge={(p, s) =>
                void nudge(serverFor(p, s), p, s, 'Are you stuck? Reply with status or next step.')
              }
              onKill={handleKillSession}
              onSnooze={(p, s) => snoozeSessionFor(p, s, DEFAULT_SNOOZE_MS)}
            />
            {isRefreshable(triageTop.summary, now) && (
              <button
                type="button"
                onClick={() =>
                  void refreshSummaryNow(
                    serverFor(triageTop.summary.project, triageTop.summary.session),
                    triageTop.summary.project,
                    triageTop.summary.session,
                  )
                }
                className="px-2 py-1 rounded text-3xs font-semibold bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
              >
                Refresh now
              </button>
            )}
          </div>
        )}

        {/* Z9 undo toasts — optimistic clears pending server commit */}
        {Object.values(pendingClears).length > 0 && (
          <div className="space-y-1" data-testid="zen-undo-toasts">
            {Object.values(pendingClears).map((pc) => (
              <div
                key={pc.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gray-800 dark:bg-gray-700 text-white text-xs"
              >
                <span>sent → {pc.status}</span>
                <button
                  type="button"
                  onClick={() => undoClear(pc.id)}
                  className="font-semibold underline"
                >
                  Undo
                </button>
              </div>
            ))}
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
                <div key={m.key} className="space-y-1">
                  <SessionParagraphCard
                    summary={m.summary}
                    now={now}
                    serverId={serverFor(m.project, m.session)}
                    escalation={
                      openEscalations.find(
                        (e) => e.project === m.project && e.session === m.session && e.status === 'open',
                      ) ?? null
                    }
                    onDecideEscalation={(sid, id, opt) => void decideEscalation(sid, id, opt)}
                    onAnswerPane={(sid, p, s, v) => void nudge(sid, p, s, v)}
                    onResolve={(sid, id, _st) => clearWithUndo(sid, id, 'resolved')}
                    onSnooze={(p, s) => snoozeSessionFor(p, s, DEFAULT_SNOOZE_MS)}
                    onFetchPane={(p, s) => capturePane(serverFor(p, s), p, s)}
                  />
                  {isRefreshable(m.summary, now) && (
                    <button
                      type="button"
                      onClick={() =>
                        void refreshSummaryNow(serverFor(m.project, m.session), m.project, m.session)
                      }
                      className="px-2 py-1 rounded text-3xs font-semibold bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
                    >
                      Refresh now
                    </button>
                  )}
                </div>
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

        {/* Watchdog threshold — percent-clamped numeric input wired to setWatchdogThreshold */}
        {focusProject && (
          <div className="space-y-1.5">
            <div className="text-3xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Watchdog threshold
            </div>
            <div className="flex items-center gap-2">
              {/* clampWatchdogThreshold is the minutes-domain helper; route uses thresholdPercent (1–100), hence the inline percent clamp */}
              <input
                type="number"
                min={1}
                max={100}
                value={thresholdVal}
                onChange={(e) => setThresholdVal(e.target.value)}
                className="w-16 px-2 py-1 rounded text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
              />
              <span className="text-3xs text-gray-400">%</span>
              <button
                type="button"
                onClick={() =>
                  void setWatchdogThreshold(
                    focusServerId,
                    focusProject,
                    Math.min(100, Math.max(1, Math.round(Number(thresholdVal)))),
                  )
                }
                className="px-2 py-1 rounded text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
              >
                Set
              </button>
            </div>
          </div>
        )}

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
