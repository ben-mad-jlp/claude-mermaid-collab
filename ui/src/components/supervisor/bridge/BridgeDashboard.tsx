/**
 * BridgeDashboard — the fleet command center (Bridge redesign BR-2, design §2/§8).
 *
 * The old KPI grid is gone. The Bridge is now a SplitDeck: a CommandBar on top
 * (identity + project selector + the glanceable pulse that absorbed the deleted
 * AlertRibbon), a LEFT instrument panel in strict hierarchy
 * (NeedsYouZone ▸ FleetVitals ▸ WorkerRoster ▸ StreamTicker), and a RIGHT graph
 * stage (a placeholder frame until FleetGraph lands in BR-3). This component
 * owns the data scoping; the panel pieces are pure presentational cards.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useUIStore } from '@/stores/uiStore';
import { useEventStreamStore } from '@/stores/eventStreamStore';
import { useDiveIn, useSelectSessionInPlace } from '@/hooks/useDiveIn';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { SplitPane } from '@/components/layout/SplitPane';
import { SplitDeck } from './SplitDeck';
import { CommandBar } from './CommandBar';
import { NeedsYouZone } from './NeedsYouZone';
import { FleetVitals } from './FleetVitals';
import { WorkerRoster } from './WorkerRoster';
import { StreamTicker } from './StreamTicker';
import { FleetGraph } from './fleet/FleetGraph';
import { DecisionCard } from './focal/DecisionCard';
import { funnelCounts } from './funnel';
import { selectOpenEscalations } from './escalationSelectors';
import { useDeckStore } from '@/stores/deckStore';
import { useFeatureFlags } from '@/config/featureFlags';
import { getWebSocketClient } from '@/lib/websocket';

export interface BridgeDashboardProps {
  /**
   * P5: the artifact viewer/editor node (App's renderMainContent output) when
   * the viewer is open for the current session. Present → the Z3 graph stage
   * becomes a nested SplitPane {FleetGraph}{viewer} so artifacts show BESIDE the
   * live graph without leaving Bridge. Absent → the stage is just the graph.
   */
  artifactViewer?: React.ReactNode;
}

export const BridgeDashboard: React.FC<BridgeDashboardProps> = ({ artifactViewer }) => {
  const currentSession = useSessionStore((s) => s.currentSession);
  const serverScope = currentSession?.serverId ?? 'local';
  const diveIn = useDiveIn();
  const selectInPlace = useSelectSessionInPlace();
  const isDesktop = useIsDesktop();

  const activeProjectPref = useUIStore((s) => s.activeProject);
  const setActiveProject = useUIStore((s) => s.setActiveProject);

  const escalations = useSupervisorStore((s) => s.escalations);
  const supervised = useSupervisorStore((s) => s.supervised);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const loadProjectTodos = useSupervisorStore((s) => s.loadProjectTodos);
  const loadEscalations = useSupervisorStore((s) => s.loadEscalations);
  const coordinatorByProject = useSupervisorStore((s) => s.coordinatorByProject);
  const loadCoordinator = useSupervisorStore((s) => s.loadCoordinator);
  const setCoordinator = useSupervisorStore((s) => s.setCoordinator);
  const loadAudit = useSupervisorStore((s) => s.loadAudit);
  const auditByProject = useSupervisorStore((s) => s.auditByProject);

  const subscriptions = useSubscriptionStore((s) => s.subscriptions);

  const streamEvents = useEventStreamStore((s) => s.events);
  const backfillFromAudit = useEventStreamStore((s) => s.backfillFromAudit);

  const project = activeProjectPref ?? currentSession?.project ?? supervised[0]?.project ?? '';

  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    if (currentSession?.project) set.add(currentSession.project);
    supervised.forEach((s) => s.project && set.add(s.project));
    Object.values(subscriptions).forEach((s) => s.project && set.add(s.project));
    Object.keys(todosByProject).forEach((p) => p && set.add(p));
    if (project) set.add(project);
    return Array.from(set);
  }, [currentSession?.project, supervised, subscriptions, todosByProject, project]);

  // Single place that re-fetches every Bridge store for the current scope. Run
  // on scope/project change AND on every WebSocket (re)connect — see below.
  const resyncBridge = useCallback(() => {
    void loadEscalations(serverScope, 'open');
    if (project) {
      void loadProjectTodos(serverScope, project);
      void loadCoordinator(serverScope, project);
      void loadAudit(serverScope, project);
    }
  }, [serverScope, project, loadEscalations, loadProjectTodos, loadCoordinator, loadAudit]);

  useEffect(() => {
    resyncBridge();
  }, [resyncBridge]);

  // BUG FIX: the WS client auto-reconnects after a drop (very common — the API
  // server restarts often), but the load effect above keys only on
  // [serverScope, project], so on reconnect nothing re-fetched and the
  // funnel/graph/roster/stream stayed stale until a project-switch or reload.
  // Register a client.onConnect handler (modeled on useAgentSession's resync)
  // so each (re)connect re-runs the loaders for the CURRENT scope.
  useEffect(() => {
    const client = getWebSocketClient();
    const sub = client.onConnect(() => {
      resyncBridge();
    });
    return () => sub.unsubscribe();
  }, [resyncBridge]);

  const projectAudit = auditByProject[project];
  useEffect(() => {
    if (projectAudit && projectAudit.length > 0) backfillFromAudit(projectAudit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectAudit]);

  const todos = todosByProject[project] ?? [];
  const projectSubs = useMemo(
    () => Object.values(subscriptions).filter((s) => s.project === project),
    [subscriptions, project],
  );

  const running = !!coordinatorByProject[project];
  const readyCount = useMemo(
    () => todos.filter((t) => t.status === 'ready' && !t.claimedBy).length,
    [todos],
  );

  // The single source of "needs you" — same selector the CommandBarBadge, the
  // Z-rail and the FleetGraph danger ring derive from (badge ⟺ ring parity).
  const openEscalations = useMemo(
    () => selectOpenEscalations(escalations, project),
    [escalations, project],
  );
  const openEscalationCount = openEscalations.length;
  const liveCount = useMemo(
    () => projectSubs.filter((s) => s.status === 'active').length,
    [projectSubs],
  );
  const inflightCount = useMemo(() => funnelCounts(todos).inflight, [todos]);

  const projectStreamEvents = useMemo(
    () => streamEvents.filter((e) => !e.project || e.project === project),
    [streamEvents, project],
  );

  const handleJump = (proj: string, session: string) => {
    diveIn({ project: proj, session });
  };

  // BR-4: focal DecisionCard overlay (behind a flag; inline inbox card untouched).
  const flags = useFeatureFlags();
  const focalEscalationId = useDeckStore((s) => s.focalEscalationId);
  const setFocalEscalationId = useDeckStore((s) => s.setFocalEscalationId);
  const setFocusNodeId = useDeckStore((s) => s.setFocusNodeId);
  const focalEscalation = useMemo(
    () => openEscalations.find((e) => e.id === focalEscalationId) ?? null,
    [openEscalations, focalEscalationId],
  );
  const closeFocal = () => {
    setFocalEscalationId(null);
    setFocusNodeId(null);
  };

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500">
        No project in scope. Open a session or pick a project.
      </div>
    );
  }

  // Z3 stage (the SplitDeck's right half): the live FleetGraph, optionally docked
  // beside the artifact viewer in a nested SplitPane. The graph is ALWAYS the
  // primary pane so it never unmounts when the viewer opens/closes; on narrow it
  // becomes a bottom sheet (vertical split) with the graph dimmed but mounted.
  const graphPane = (
    <FleetGraph
      todos={todos}
      subs={projectSubs}
      openEscalations={openEscalations}
      onWorkerSelect={selectInPlace}
    />
  );
  const stage = artifactViewer ? (
    <SplitPane
      direction={isDesktop ? 'horizontal' : 'vertical'}
      storageId={isDesktop ? 'bridge-stage-split-h' : 'bridge-stage-split-v'}
      primaryContent={<div className={`h-full w-full ${isDesktop ? '' : 'opacity-90'}`}>{graphPane}</div>}
      secondaryContent={artifactViewer}
      defaultPrimarySize={60}
      minPrimarySize={30}
      maxPrimarySize={80}
    />
  ) : (
    graphPane
  );

  return (
    <div className="relative h-full">
      <SplitDeck
        commandBar={
          <CommandBar
            project={project}
            projectOptions={projectOptions}
            onSelectProject={setActiveProject}
            liveCount={liveCount}
            inflightCount={inflightCount}
            needsYouCount={openEscalationCount}
          />
        }
        left={
          <>
            {/* Z1: top-pinned escalation zone — first in DOM, never scrolled away.
                (P4: NeedsYouRail removed; Z1 + the CommandBarBadge carry salience.) */}
            <NeedsYouZone
              escalations={escalations}
              project={project}
              serverScope={serverScope}
              onJump={handleJump}
            />
            <FleetVitals
              running={running}
              readyCount={readyCount}
              todos={todos}
              onToggle={() => void setCoordinator(serverScope, project, running ? 'stop' : 'start')}
            />
            <WorkerRoster subscriptions={projectSubs} todos={todos} onJump={handleJump} />
            <StreamTicker events={projectStreamEvents} />
          </>
        }
        right={<FleetGraph todos={todos} subs={projectSubs} openEscalations={openEscalations} />}
      />

      {flags.jsonRenderDecisionCard && focalEscalation && (
        <DecisionCard
          escalation={focalEscalation}
          serverScope={serverScope}
          onClose={closeFocal}
          onJump={handleJump}
        />
      )}
    </div>
  );
};

export default BridgeDashboard;
