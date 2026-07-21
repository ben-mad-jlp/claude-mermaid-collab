import React from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { ZenSessionCard } from '@/components/supervisor/zen/ZenSessionCard';
import { activateSessionCard, type SessionCardData } from '@/components/layout/SessionCard';

interface OpsSessionCardsProps {
  serverScope: string;
}

export const OpsSessionCards: React.FC<OpsSessionCardsProps> = ({ serverScope }) => {
  const { openEscalations, sessionSummaries, decideEscalation } = useSupervisorStore();
  const { subscriptions, order, unsubscribe } = useSubscriptionStore();
  const allSessions = useSessionStore((s) => s.sessions);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const setActiveProject = useUIStore((s) => s.setActiveProject);

  // Enumeration: one card per watched/subscribed session
  const cards = order.map((k) => ({ k, s: subscriptions[k] })).filter(({ s }) => s);

  if (cards.length === 0) {
    return null;
  }

  const handleOpen = (project: string, session: string, serverId: string) => {
    // Mirror ZenMode.tsx:204-224 minus toggleZenMode()
    const match = allSessions.find((s) => s.project === project && s.name === session);
    setCurrentSession({ ...(match ?? {}), project, name: session, serverId: match?.serverId || serverId });
    setActiveProject(project);
    const card: SessionCardData = {
      serverId: match?.serverId ?? serverId,
      project,
      session,
      status: 'unknown',
      lastUpdate: 0,
    };
    void activateSessionCard(card).catch(() => {});
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map(({ k, s }) => {
        const summary = sessionSummaries[`${s.project}::${s.session}`];
        const escalation =
          openEscalations.find(
            (e) => e.project === s.project && e.session === s.session && e.status === 'open',
          ) ?? null;

        return (
          <div key={k} className="h-56">
            <ZenSessionCard
              project={s.project}
              session={s.session}
              serverId={s.serverId}
              summary={summary}
              escalation={escalation}
              contextPercent={s.contextPercent}
              subStatus={s.status}
              lastUpdate={s.lastUpdate}
              stale={s.stale}
              size="sm"
              onClose={() => unsubscribe(k)}
              onDecideEscalation={(sid, id, opt) => decideEscalation(sid, id, opt)}
              onAnswerPane={() => {}}
              onOpen={handleOpen}
            />
          </div>
        );
      })}
    </div>
  );
};
