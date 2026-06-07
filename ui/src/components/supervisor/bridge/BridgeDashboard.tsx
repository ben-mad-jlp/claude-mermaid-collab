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
import { AddProjectDialog } from '@/components/dialogs';
import { useServers } from '@/contexts/ServerContext';
import { RolesStrip } from './RolesStrip';
import { NeedsYouZone } from './NeedsYouZone';
import { RequirementsInbox } from './RequirementsInbox';
import { HumanInbox } from '@/components/todos/HumanInbox';
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
  const addProject = useSupervisorStore((s) => s.addProject);
  const removeProject = useSupervisorStore((s) => s.removeProject);
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
  const { servers } = useServers();

  const streamEvents = useEventStreamStore((s) => s.events);
  const backfillFromAudit = useEventStreamStore((s) => s.backfillFromAudit);

  // Projects removed this session — kept hidden immediately even when their row
  // still arrives from a derived source (supervised/subscriptions/todos), since
  // removeProject only unwatches and those feeds would otherwise re-add them.
  const [hiddenProjects, setHiddenProjects] = useState<Set<string>>(() => new Set());

  // The global role workspaces (~/.mermaid-collab/supervisor, .../steward) are
  // not user projects — never list them in the Bridge project picker.
  const isRoleWorkspace = (p: string) => /\/\.mermaid-collab\/(supervisor|steward)\/?$/.test(p);

  const project = activeProjectPref ?? currentSession?.project ?? supervised[0]?.project ?? '';

  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    if (currentSession?.project) set.add(currentSession.project);
    supervised.forEach((s) => s.project && set.add(s.project));
    Object.values(subscriptions).forEach((s) => s.project && set.add(s.project));
    Object.keys(todosByProject).forEach((p) => p && set.add(p));
    // Watched projects added via the dropdown appear even before they have a
    // supervised session or any todos.
    watchedProjects.forEach((w) => w.project && set.add(w.project));
    if (project) set.add(project);
    return Array.from(set).filter((p) => !isRoleWorkspace(p) && !hiddenProjects.has(p));
  }, [currentSession?.project, supervised, subscriptions, todosByProject, watchedProjects, project, hiddenProjects]);

  // Load the watched-project list once for the active server so the dropdown is
  // populated (and reflects add/remove) independent of supervised sessions.
  useEffect(() => {
    void loadProjects(serverScope);
  }, [serverScope, loadProjects]);

  // Add/remove a project from the Bridge dropdown. "Add" opens the same
  // AddProjectDialog the Header uses (server picker + validated path input);
  // on submit we register/watch the project and scope the Bridge to it.
  const [addOpen, setAddOpen] = useState(false);
  const handleAddSubmit = useCallback(
    async (sid: string, path: string) => {
      await addProject(sid, path);
      setActiveProject(path);
    },
    [addProject, setActiveProject],
  );
  const handleRemoveProject = useCallback(
    (path: string) => {
      // Hide it immediately (derived feeds would otherwise re-add it), then
      // unwatch on the server.
      setHiddenProjects((prev) => new Set(prev).add(path));
      void removeProject(serverScope, path);
      // If the removed project was active, fall back to another visible option.
      if (project === path) {
        const next = projectOptions.find((p) => p !== path) ?? '';
        setActiveProject(next || null);
      }
    },
    [serverScope, removeProject, project, projectOptions, setActiveProject],
  );

  // Single place that re-fetches every Bridge store for the current scope. Run
  // on scope/project change AND on every WebSocket (re)connect — see below.
  const resyncBridge = useCallback(() => {
    void loadEscalations(serverScope, 'open');
    if (project) {
      void loadProjectTodos(serverScope, project);
      void loadCoordinator(serverScope, project);
      void loadAudit(serverScope, project);
      void loadRequirements(serverScope, project);
      void loadCoverage(serverScope, project);
    }
  }, [serverScope, project, loadEscalations, loadProjectTodos, loadCoordinator, loadAudit, loadRequirements, loadCoverage]);

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
      subs={projectSubs}
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
            project={project}
            projectOptions={projectOptions}
            onSelectProject={setActiveProject}
            onAddProject={() => setAddOpen(true)}
            onRemoveProject={handleRemoveProject}
            liveCount={liveCount}
            inflightCount={inflightCount}
            needsYouCount={openEscalationCount}
          />
        }
        left={
          <>
            {/* Role control surface: one switch each for Steward (global),
                Supervisor (global) and Coordinator (this project), with live
                status. Turning a role ON spawns it; the left-column role panels
                appear only while running. */}
            <RolesStrip project={project} serverScope={serverScope} />
            {/* Z1: top-pinned escalation zone — first in DOM, never scrolled away.
                (P4: NeedsYouRail removed; Z1 + the CommandBarBadge carry salience.) */}
            <NeedsYouZone
              escalations={escalations}
              project={project}
              serverScope={serverScope}
              onJump={handleJump}
            />
            {/* The confirm-loop heartbeat — sibling below NeedsYouZone, amber
                (one-red discipline). Silent until a promise needs signing. */}
            <RequirementsInbox
              requirements={requirementsByProject[project] ?? []}
              project={project}
              serverScope={serverScope}
            />
            {/* "Your todos": the human-assigned, human-actionable slice of the
                work-graph. Derived from the same project todos store (no new WS
                events); Claim/Complete drive the work-graph transitions a person
                owns, and the link chip deep-links into the program's native UI. */}
            <HumanInbox
              todos={todos}
              onClaim={(t) => void promoteTodo(serverScope, project, t.id, 'in_progress')}
              onComplete={(t) => void promoteTodo(serverScope, project, t.id, 'done')}
              onOpen={handleSelectTodo}
            />
            <FleetVitals
              running={running}
              readyCount={readyCount}
              todos={todos}
              onToggle={() => void setCoordinator(serverScope, project, running ? 'stop' : 'start')}
              coverage={coverageByProject[project]}
            />
            <WorkerRoster subscriptions={projectSubs} todos={todos} onJump={handleJump} />
            <StreamTicker events={projectStreamEvents} />
            {/* G8: todo detail surfaces BELOW the Stream card when a node is clicked. */}
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
        }
        right={
          <FleetGraph
            todos={graphTodos}
            subs={projectSubs}
            openEscalations={openEscalations}
            onSelectTodo={handleSelectTodo}
          />
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

      {addOpen && (
        <AddProjectDialog
          servers={servers}
          defaultServerId={servers.find((s) => s.id === serverScope)?.id ?? servers.find((s) => s.source === 'local')?.id ?? servers[0]?.id ?? serverScope}
          onSubmit={handleAddSubmit}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
};

export default BridgeDashboard;
