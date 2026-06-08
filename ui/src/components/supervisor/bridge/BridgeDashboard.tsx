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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { TodoDetailView } from '@/components/editors/TodoDetailView';
import type { SessionTodo } from '@/types/sessionTodo';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useUIStore } from '@/stores/uiStore';
import { useEventStreamStore } from '@/stores/eventStreamStore';
import { useDiveIn, useSelectSessionInPlace } from '@/hooks/useDiveIn';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { SplitPane } from '@/components/layout/SplitPane';
import { SplitDeck } from './SplitDeck';
import { CommandBar } from './CommandBar';
import { isOrchestratorSession } from '@/lib/liveness';
import { NeedsYouZone } from './NeedsYouZone';
import { BridgeEscalationInbox } from './BridgeEscalationInbox';
import { FleetStatusGrid, type FleetGridRow } from './FleetStatusGrid';
import { FLEET_SENTINEL } from './fleetSentinel';
import { disambiguateProjectLabels } from '@/components/layout/SupervisorPanel';
import { RequirementsInbox } from './RequirementsInbox';
import { HumanInbox } from '@/components/todos/HumanInbox';
import { FleetVitals } from './FleetVitals';
import { WorkerRoster } from './WorkerRoster';
import { StreamTicker } from './StreamTicker';
import { FleetGraph } from './fleet/FleetGraph';
import { DecisionCard } from './focal/DecisionCard';
import { funnelCounts } from './funnel';
import { selectOpenEscalations, selectFleetOpenCount, selectOpenEscalationsByProject } from './escalationSelectors';
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
  const upsertSessionTodo = useSessionStore((s) => s.upsertSessionTodo);
  const serverScope = currentSession?.serverId ?? 'local';
  const diveIn = useDiveIn();
  const selectInPlace = useSelectSessionInPlace();
  const isDesktop = useIsDesktop();

  const activeProjectPref = useUIStore((s) => s.activeProject);
  const setActiveProject = useUIStore((s) => s.setActiveProject);

  const escalations = useSupervisorStore((s) => s.escalations);
  const supervised = useSupervisorStore((s) => s.supervised);
  const watchedProjects = useSupervisorStore((s) => s.watchedProjects);
  const loadProjects = useSupervisorStore((s) => s.loadProjects);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const loadProjectTodos = useSupervisorStore((s) => s.loadProjectTodos);
  const promoteTodo = useSupervisorStore((s) => s.promoteTodo);
  const loadEscalations = useSupervisorStore((s) => s.loadEscalations);
  const coordinatorByProject = useSupervisorStore((s) => s.coordinatorByProject);
  const loadCoordinator = useSupervisorStore((s) => s.loadCoordinator);
  const setCoordinator = useSupervisorStore((s) => s.setCoordinator);
  const loadAudit = useSupervisorStore((s) => s.loadAudit);
  const auditByProject = useSupervisorStore((s) => s.auditByProject);
  const requirementsByProject = useSupervisorStore((s) => s.requirementsByProject);
  const loadRequirements = useSupervisorStore((s) => s.loadRequirements);
  const coverageByProject = useSupervisorStore((s) => s.coverageByProject);
  const loadCoverage = useSupervisorStore((s) => s.loadCoverage);

  const subscriptions = useSubscriptionStore((s) => s.subscriptions);

  const streamEvents = useEventStreamStore((s) => s.events);
  const backfillFromAudit = useEventStreamStore((s) => s.backfillFromAudit);

  const project = activeProjectPref ?? currentSession?.project ?? supervised[0]?.project ?? '';
  // FLEET landing (design-tabbed-bridge §2a): cross-project triage + status grid,
  // shown when the "Fleet" row is selected instead of a single project's cockpit.
  const isFleet = activeProjectPref === FLEET_SENTINEL;
  const isRoleWorkspace = (p: string) => /\/\.mermaid-collab\/(supervisor|steward)\/?$/.test(p);

  // All open escalations across the fleet, urgency-sorted (newest first) — the
  // cross-project triage list. One global list; project tag rides each card.
  const allOpenEscalations = useMemo(
    () => (Array.isArray(escalations) ? escalations.filter((e) => e.status === 'open') : []).slice().sort((a, b) => b.createdAt - a.createdAt),
    [escalations],
  );

  // Per-project status rows for the FLEET grid.
  const fleetRows = useMemo<FleetGridRow[]>(() => {
    const counts = selectOpenEscalationsByProject(escalations);
    const paths = new Set<string>();
    (Array.isArray(watchedProjects) ? watchedProjects : []).forEach((w) => w.project && !isRoleWorkspace(w.project) && paths.add(w.project));
    const labels = disambiguateProjectLabels(Array.from(paths));
    return Array.from(paths)
      .map((p) => ({
        project: p,
        name: labels[p] ?? (p.split('/').filter(Boolean).pop() ?? p),
        escalationCount: counts[p] ?? 0,
        coordinatorRunning: !!coordinatorByProject[p],
        readyCount: (todosByProject[p] ?? []).filter((t) => t.status === 'ready' && !t.claimedBy).length,
        workerCount: Object.values(subscriptions).filter((s) => s.project === p && s.status === 'active' && !isOrchestratorSession(s.session)).length,
      }))
      .sort((a, b) => (b.escalationCount - a.escalationCount) || a.name.localeCompare(b.name));
  }, [escalations, watchedProjects, coordinatorByProject, todosByProject, subscriptions]);

  // Load the watched-project list for the active server (the unified Bridge tree
  // in the left column reads watchedProjects; this keeps it fresh from here too).
  useEffect(() => {
    void loadProjects(serverScope);
  }, [serverScope, loadProjects]);

  // Single place that re-fetches every Bridge store for the current scope. Run
  // on scope/project change AND on every WebSocket (re)connect — see below.
  //
  // Multi-project (design-tabbed-bridge §6 phase 2): the Project Rail + FLEET
  // status grid need per-project data for EVERY watched project, not just the
  // active one. `loadEscalations` is one global fetch (drives all rail badges via
  // selectOpenEscalationsByProject). The rail/grid essentials — coordinator state
  // (dots) + todos (ready counts / idle-with-work) — are looped over every watched
  // project so the rail is live without visiting each. The heavier detail-only
  // loaders (audit/requirements/coverage) stay scoped to the ACTIVE project to
  // keep resync cheap at 15+ projects (doc risk #2).
  const resyncBridge = useCallback(() => {
    void loadEscalations(serverScope, 'open');
    const railProjects = new Set<string>(watchedProjects.map((w) => w.project).filter(Boolean));
    if (project && project !== FLEET_SENTINEL) railProjects.add(project);
    for (const p of railProjects) {
      void loadProjectTodos(serverScope, p);
      void loadCoordinator(serverScope, p);
    }
    if (project && project !== FLEET_SENTINEL) {
      void loadAudit(serverScope, project);
      void loadRequirements(serverScope, project);
      void loadCoverage(serverScope, project);
    }
  }, [serverScope, project, watchedProjects, loadEscalations, loadProjectTodos, loadCoordinator, loadAudit, loadRequirements, loadCoverage]);

  useEffect(() => {
    resyncBridge();
  }, [resyncBridge]);

  // BUG FIX (5b8dc726): the WS client auto-reconnects after a drop (very common —
  // the API server restarts often), but the load effect above keys only on
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
  // Workers roster source: the project's SUPERVISED sessions (same source as the
  // left tree) — NOT the live `subscriptions` Watching feed, which doesn't include
  // coordinator-spawned worker sessions (so they never showed). Merge in
  // subscription liveness (status/context) when a matching subscription exists.
  // Orchestrator/role sessions (supervisor/steward/planner) drive the work-graph —
  // not workers — so they're excluded.
  const workerSubs = useMemo(() => {
    const subBySession = new Map(projectSubs.map((s) => [s.session, s]));
    const fromSupervised = supervised
      .filter((s) => s.project === project && !isOrchestratorSession(s.session))
      .map((s) => {
        const live = subBySession.get(s.session);
        return {
          serverId: live?.serverId ?? s.serverId ?? serverScope,
          project,
          session: s.session,
          status: (live?.status ?? 'unknown') as 'active' | 'waiting' | 'permission' | 'unknown',
          lastUpdate: live?.lastUpdate ?? Date.now(),
          contextPercent: live?.contextPercent,
        };
      });
    // Include any live subscription for this project not in the supervised set
    // (a manually-watched worker), still excluding orchestrators.
    const known = new Set(fromSupervised.map((s) => s.session));
    const extra = projectSubs.filter((s) => !isOrchestratorSession(s.session) && !known.has(s.session));
    return [...fromSupervised, ...extra];
  }, [supervised, projectSubs, project, serverScope]);

  // Graph-only view of the todos: the FleetGraph should not show finished noise —
  // (a) completed/dropped ORPHAN todos (no parent, not an epic), and (b) EPICS
  // whose every child is finished (hide the epic and its finished children).
  // Active epics keep showing all their children (incl. done ones) for context.
  // The inboxes/funnel/roster still use the full `todos`.
  const graphTodos = useMemo(() => {
    const finished = (t: SessionTodo) => t.status === 'done' || t.status === 'dropped';
    const ids = new Set(todos.map((t) => t.id));
    const childrenByParent = new Map<string, SessionTodo[]>();
    for (const t of todos) {
      if (t.parentId && ids.has(t.parentId)) {
        const arr = childrenByParent.get(t.parentId) ?? [];
        arr.push(t);
        childrenByParent.set(t.parentId, arr);
      }
    }
    const isEpic = (id: string) => childrenByParent.has(id);
    const doneEpics = new Set<string>();
    for (const [pid, kids] of childrenByParent) {
      if (kids.every(finished)) doneEpics.add(pid);
    }
    return todos.filter((t) => {
      if (t.parentId && doneEpics.has(t.parentId)) return false; // child of a fully-done epic
      if (isEpic(t.id) && doneEpics.has(t.id)) return false;     // the fully-done epic itself
      if (!t.parentId && !isEpic(t.id) && finished(t)) return false; // completed orphan
      return true;
    });
  }, [todos]);

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

  // G8: a todo node clicked in the FleetGraph surfaces its detail BELOW the
  // Stream card in the left panel. Seed sessionStore first — TodoDetailView reads
  // the todo from sessionStore.sessionTodos by id (same as PlanWorkspace.selectTodo).
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const handleSelectTodo = (todo: SessionTodo) => {
    upsertSessionTodo(todo);
    setSelectedTodoId(todo.id);
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
      subs={workerSubs}
      openEscalations={openEscalations}
      onWorkerSelect={selectInPlace}
      onSelectTodo={handleSelectTodo}
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
            liveCount={liveCount}
            inflightCount={inflightCount}
            needsYouCount={openEscalationCount}
            serverScope={serverScope}
            project={isFleet ? undefined : project}
          />
        }
        left={
          isFleet ? (
            // FLEET landing — cross-project triage: every open escalation, project
            // tag on each card, urgency-sorted. Resolve/decide in place.
            <div data-testid="fleet-triage" className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Triage · {selectFleetOpenCount(escalations)} open across {fleetRows.filter((r) => r.escalationCount > 0).length} project{fleetRows.filter((r) => r.escalationCount > 0).length === 1 ? '' : 's'}
              </div>
              {allOpenEscalations.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                  <span className="text-success-500" aria-hidden="true">✓</span>
                  <span>All clear — nothing needs you across the fleet</span>
                </div>
              ) : (
                <BridgeEscalationInbox
                  escalations={allOpenEscalations}
                  serverScope={serverScope}
                  onJump={(proj) => setActiveProject(proj)}
                />
              )}
            </div>
          ) : (
          <>
            {/* Progress funnel (Backlog▸Ready▸In-flight▸Blocked▸Done). The
                coordinator on/off now lives in the CommandBar role-switch line
                next to Steward/Supervisor, so this is standalone (no card). */}
            <FleetVitals
              todos={todos}
              projectName={project.split('/').filter(Boolean).pop() ?? project}
              coverage={coverageByProject[project]}
            />
            {/* Four columns above the graph: Escalations · Todos · Workers · Stream.
                Each card carries its own header — no extra column labels. */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 items-start">
              <div className="min-w-0 space-y-3">
                <NeedsYouZone
                  escalations={escalations}
                  project={project}
                  serverScope={serverScope}
                  onJump={handleJump}
                />
                {/* The confirm-loop heartbeat — sibling under escalations. */}
                <RequirementsInbox
                  requirements={requirementsByProject[project] ?? []}
                  project={project}
                  serverScope={serverScope}
                />
              </div>
              {/* "Your todos": the human-assigned, human-actionable slice of the
                  work-graph; Claim/Complete drive the transitions a person owns. */}
              <HumanInbox
                todos={todos}
                onClaim={(t) => void promoteTodo(serverScope, project, t.id, 'in_progress')}
                onComplete={(t) => void promoteTodo(serverScope, project, t.id, 'done')}
                onOpen={handleSelectTodo}
              />
              <WorkerRoster subscriptions={workerSubs} todos={todos} onJump={handleJump} />
              <StreamTicker events={projectStreamEvents} />
            </div>
            {/* G8: todo detail surfaces BELOW the columns when a node is clicked. */}
            {selectedTodoId && (
              <div
                data-testid="bridge-todo-detail"
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 min-w-0"
              >
                <div className="flex items-center justify-between pb-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Todo
                  </div>
                  <button
                    type="button"
                    aria-label="Close todo detail"
                    onClick={() => setSelectedTodoId(null)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm leading-none px-1"
                  >
                    ✕
                  </button>
                </div>
                <TodoDetailView todoId={selectedTodoId} />
              </div>
            )}
          </>
          )
        }
        right={
          isFleet ? (
            <FleetStatusGrid
              rows={fleetRows}
              onSelectProject={(p) => setActiveProject(p)}
              onStartCoordinator={(p) => void setCoordinator(serverScope, p, 'start')}
            />
          ) : (
            <FleetGraph
              todos={graphTodos}
              subs={workerSubs}
              openEscalations={openEscalations}
              onSelectTodo={handleSelectTodo}
            />
          )
        }
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
