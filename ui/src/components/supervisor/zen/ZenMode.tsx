import React, { useEffect, useMemo } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { computePlanTotals } from '@/components/supervisor/PlanTotals';
import { selectTriageTop } from '@/lib/triageSelectors';
import { VerdictBar } from './VerdictBar';
import { CalmCanvas } from './CalmCanvas';
import { FocusCard } from './FocusCard';
import { WedgeFocusCard } from './WedgeFocusCard';
import { PillList } from './PillList';
import { ProjectPill } from './ProjectPill';
import { SessionPill } from './SessionPill';

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

  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const order = useSubscriptionStore((s) => s.order);

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

  const now = Date.now();
  const triageTop = useMemo(
    () => selectTriageTop(openEscalations, sessionSummaries, now),
    [openEscalations, sessionSummaries, now],
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
      <VerdictBar openEscalations={openEscalations} />

      <CalmCanvas>
        {/* Focus card — triage-top: escalation or wedge/unknown session */}
        {triageTop?.kind === 'escalation' && (
          <FocusCard
            escalation={triageTop.escalation}
            serverScope={triageTop.escalation.serverId ?? 'local'}
            onDecide={(sid, id, optId) => void decideEscalation(sid, id, optId)}
            onResolve={(sid, id, status) => void resolveEscalation(sid, id, status)}
            onLand={(sid, project, id) => void landEpic(sid, project, id)}
          />
        )}
        {(triageTop?.kind === 'wedge' || triageTop?.kind === 'unknown') && (
          <WedgeFocusCard
            summary={triageTop.summary}
            now={now}
            onOpen={handleOpenSession}
            onNudge={(p, s) => void nudge(serverFor(p, s), p, s, 'Are you stuck? Reply with status or next step.')}
            onKill={handleKillSession}
            onSnooze={(p, s) => snoozeSession(p, s, Date.now() + 10 * 60_000)}
          />
        )}

        {/* Zone 1 — project totals */}
        <PillList title="Projects" emptyLabel="No projects tracked">
          {projectTotals.map(({ project, totals }) => (
            <ProjectPill key={project} project={project} totals={totals} />
          ))}
        </PillList>

        {/* Zone 2 — session status pills */}
        <PillList title="Sessions" emptyLabel="No subscribed sessions">
          {sessions.map((s) => (
            <SessionPill
              key={`${s.serverId}:${s.project}:${s.session}`}
              session={s}
              progressState={sessionSummaries[`${s.project}::${s.session}`]?.progressState}
            />
          ))}
        </PillList>

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
