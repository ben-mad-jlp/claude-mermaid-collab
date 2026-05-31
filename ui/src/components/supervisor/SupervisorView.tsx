/**
 * SupervisorView — full-page supervisor dashboard.
 *
 * State switch:
 *   - No config (null or empty supervisorProject/supervisorSession) → SupervisorOnboarding full-bleed.
 *   - Config present → identity bar + two-column layout (lg) / tabbed layout (< lg).
 *
 * Responsive layout:
 *   - lg+  : hidden lg:grid  — 2-column grid [340px, 1fr] with left=EscalationInbox, right=RoadmapPanel+SupervisedSessions
 *   - <lg  : lg:hidden       — 3-tab switcher: Escalations / Roadmap / Sessions
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { activateSessionCard } from '@/components/layout/SessionCard';
import { EscalationInbox } from './EscalationInbox';
import { RoadmapPanel } from './RoadmapPanel';
import { SupervisedSessions } from './SupervisedSessions';
import { SupervisorOnboarding } from './SupervisorOnboarding';

export interface SupervisorViewProps {
  currentProject?: string;
  onNavigate?: (serverId: string, project: string, session: string) => void;
}

type Tab = 'escalations' | 'roadmap' | 'sessions';

export const SupervisorView: React.FC<SupervisorViewProps> = ({
  currentProject,
  onNavigate,
}) => {
  // Mirror SupervisorPanel's serverScope derivation exactly.
  const activeId = useSessionStore((s) => s.currentSession)?.serverId ?? null;
  const serverScope = activeId ?? 'local';

  const config = useSupervisorStore((s) => s.config);
  const supervised = useSupervisorStore((s) => s.supervised);
  const escalations = useSupervisorStore((s) => s.escalations);
  const loadConfig = useSupervisorStore((s) => s.loadConfig);

  const sessions = useSessionStore((s) => s.sessions);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);

  const [tab, setTab] = useState<Tab>('escalations');

  // Load config on mount / when serverScope changes.
  useEffect(() => {
    void loadConfig(serverScope);
  }, [serverScope, loadConfig]);

  // onJump: mirrors SupervisorPanel's handleNavigate + activateSessionCard.
  const onJump = useCallback(
    (project: string, session: string) => {
      const target = sessions.find((x) => x.project === project && x.name === session);
      if (target) setCurrentSession(target);
      onNavigate?.(activeId ?? 'local', project, session);
      // Fire card side-effects (terminal create + browser focus).
      void activateSessionCard(
        {
          serverId: activeId ?? 'local',
          project,
          session,
          status: 'unknown',
          lastUpdate: Date.now(),
        },
        undefined,
      );
    },
    [sessions, setCurrentSession, onNavigate, activeId],
  );

  const openEscalationCount = escalations.filter((e) => e.status === 'open').length;
  const activeProject = currentProject ?? config?.supervisorProject ?? '';

  // No config → onboarding screen full-bleed.
  const hasConfig = !!(config?.supervisorProject && config?.supervisorSession);

  if (!hasConfig) {
    return (
      <div className="flex-1 overflow-auto">
        <SupervisorOnboarding
          serverId={serverScope}
          state="none"
          onStarted={() => void loadConfig(serverScope)}
        />
      </div>
    );
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'escalations', label: `Escalations${openEscalationCount > 0 ? ` (${openEscalationCount})` : ''}` },
    { id: 'roadmap', label: 'Roadmap' },
    { id: 'sessions', label: `Sessions (${supervised.length})` },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-gray-900">
      {/* Identity bar */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <span className="text-base" role="img" aria-label="supervisor">🛡</span>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Supervisor</span>
        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate max-w-[160px]">
          {config.supervisorSession}
        </span>
        {/* Neutral running indicator — TODO: wire real running state */}
        <span
          className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0"
          title="Status unknown — TODO: wire real running state"
        />
        <div className="ml-auto flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 shrink-0">
          <span>{supervised.length} sessions</span>
          <span
            className={openEscalationCount > 0 ? 'text-yellow-600 dark:text-yellow-400 font-medium' : ''}
          >
            {openEscalationCount} escalations
          </span>
        </div>
      </div>

      {/* --- Mobile tabbed layout (hidden on lg+) --- */}
      <div className="lg:hidden flex flex-col flex-1 overflow-hidden">
        {/* Tab bar */}
        <div className="shrink-0 flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                tab === id
                  ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Tab content */}
        <div className="flex-1 overflow-auto p-3">
          {tab === 'escalations' && (
            <EscalationInbox serverId={serverScope} onJump={onJump} />
          )}
          {tab === 'roadmap' && (
            <div className="h-full min-h-[300px]">
              <RoadmapPanel serverId={serverScope} project={activeProject} />
            </div>
          )}
          {tab === 'sessions' && (
            <SupervisedSessions serverId={serverScope} onJump={onJump} />
          )}
        </div>
      </div>

      {/* --- Desktop 2-column layout (hidden below lg) --- */}
      <div className="hidden lg:grid lg:grid-cols-[340px_1fr] flex-1 overflow-hidden">
        {/* Left: Escalation inbox */}
        <div className="overflow-auto border-r border-gray-200 dark:border-gray-700 p-3">
          <EscalationInbox serverId={serverScope} onJump={onJump} />
        </div>

        {/* Right: Roadmap (top) + Supervised Sessions (bottom) */}
        <div className="flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden min-h-0 p-3">
            <RoadmapPanel serverId={serverScope} project={activeProject} />
          </div>
          <div className="shrink-0 max-h-64 overflow-auto border-t border-gray-200 dark:border-gray-700 p-3">
            <SupervisedSessions serverId={serverScope} onJump={onJump} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupervisorView;
