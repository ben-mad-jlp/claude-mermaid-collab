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
import { useSessionStatuses } from '@/hooks/useSessionStatuses';
import { useFleetStatus, type FleetWorkerState } from '@/hooks/useFleetStatus';
import { NeedsYouZone } from './NeedsYouZone';
import { RequirementsInbox } from './RequirementsInbox';
import { HumanInbox } from '@/components/todos/HumanInbox';
import { selectHumanInbox } from '@/components/todos/humanInboxSelectors';
import { FleetVitals } from './FleetVitals';
import { WorkerRoster } from './WorkerRoster';
import { StreamTicker } from './StreamTicker';
import { PlanPanel } from '../PlanPanel';
import { DecisionCard } from './focal/DecisionCard';
import { funnelCounts, excludeEpics } from './funnel';
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
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const unlandedEpicsByProject = useSupervisorStore((s) => s.unlandedEpicsByProject);
  const loadProjectTodos = useSupervisorStore((s) => s.loadProjectTodos);
  const promoteTodo = useSupervisorStore((s) => s.promoteTodo);
  const loadEscalations = useSupervisorStore((s) => s.loadEscalations);
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
    if (project) railProjects.add(project);
    for (const p of railProjects) {
      void loadProjectTodos(serverScope, p);
    }
    if (project) {
      void loadAudit(serverScope, project);
      void loadRequirements(serverScope, project);
      void loadCoverage(serverScope, project);
    }
  }, [serverScope, project, watchedProjects, loadEscalations, loadProjectTodos, loadAudit, loadRequirements, loadCoverage]);

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

  // Bridge shows ONLY the active project's own work. A todo's project identity is
  // its `targetProject` (now a total field). Cross-project coordination todos
  // (epics here whose children target build123d/yolox/etc.) are filtered out so
  // the diagram stops combining multiple projects into one graph. (null is treated
  // as "this project" for any row not yet backfilled.) The planner views
  // (PlanWorkspace/PlanPanel) read todosByProject directly and keep the full set.
  const todos = useMemo(
    () => (todosByProject[project] ?? []).filter((t) => !t.targetProject || t.targetProject === project),
    [todosByProject, project],
  );
  const projectSubs = useMemo(
    () => Object.values(subscriptions).filter((s) => s.project === project),
    [subscriptions, project],
  );
  // Workers roster source: the project's SUPERVISED sessions (same source as the
  // left tree) — NOT the live `subscriptions` Watching feed, which doesn't include
  // coordinator-spawned worker sessions (so they never showed).
  //
  // LIVENESS + the card timer come from the fleet read-model (/api/fleet →
  // WorkerState derived from REAL tmux, plus a stable per-lane lastActivity), NOT
  // from session-status age. This is the root fix for two coupled bugs (todo
  // caae8574): (1) coordinator-spawned workers that aren't in the Watching feed and
  // have no session-status row read as 'no workers'; (2) every timestamp-less card
  // was re-stamped to `now` on each 2s poll, so ALL timers reset in lockstep.
  // We NEVER fabricate a render-time timestamp here — a lane with no real
  // lastActivity carries `lastUpdate: null` (the roster shows '—').
  //
  // Per decision 5d54e01e (ANY-ALIVE-IS-PRESENT): working → bright, idle → dimmed
  // but listed, dead_shell/no_tmux → hidden. Orchestrator/role sessions
  // (supervisor/steward/planner) drive the work-graph, not workers — excluded.
  const sessionStatuses = useSessionStatuses(serverScope, project || undefined);
  const fleet = useFleetStatus(serverScope, project || undefined);
  const workerSubs = useMemo(() => {
    const subBySession = new Map(projectSubs.map((s) => [s.session, s]));
    // fleet WorkerState → the roster's coarse status. dead_shell/no_tmux map to a
    // 'dead' sentinel that the filter below drops (hidden, per 5d54e01e).
    const fleetToStatus = (st: FleetWorkerState): 'active' | 'waiting' | 'permission' | 'unknown' | 'dead' => {
      switch (st) {
        case 'working': return 'active';
        case 'idle': return 'waiting';
        case 'permission': return 'permission';
        case 'dead_shell':
        case 'no_tmux': return 'dead';
        default: return 'unknown';
      }
    };
    const fromSupervised = supervised
      .filter((s) => s.project === project && !isOrchestratorSession(s.session))
      .map((s) => {
        const live = subBySession.get(s.session);
        const entry = fleet[s.session];
        // Prefer REAL tmux liveness (fleet); else the live Watching subscription;
        // else the polled session-status. lastUpdate is the REAL lastActivity
        // (fleet) or a real heartbeat — never a fabricated `Date.now()`.
        const status = entry
          ? fleetToStatus(entry.state)
          : ((live?.status ?? sessionStatuses[`${project}:${s.session}`]?.status ?? 'unknown') as 'active' | 'waiting' | 'permission' | 'unknown' | 'dead');
        const lastUpdate: number | null = entry
          ? entry.lastActivity
          : live?.lastUpdate ?? sessionStatuses[`${project}:${s.session}`]?.updatedAt ?? null;
        return {
          serverId: live?.serverId ?? s.serverId ?? serverScope,
          project,
          session: s.session,
          status,
          lastUpdate,
          contextPercent: live?.contextPercent,
        };
      });
    // Include any live subscription for this project not in the supervised set
    // (a manually-watched worker), still excluding orchestrators.
    const known = new Set(fromSupervised.map((s) => s.session));
    const extra = projectSubs
      .filter((s) => !isOrchestratorSession(s.session) && !known.has(s.session))
      .map((s) => {
        const entry = fleet[s.session];
        return {
          serverId: s.serverId ?? serverScope,
          project,
          session: s.session,
          status: (entry ? fleetToStatus(entry.state) : s.status) as 'active' | 'waiting' | 'permission' | 'unknown' | 'dead',
          lastUpdate: (entry ? entry.lastActivity : s.lastUpdate ?? null) as number | null,
          contextPercent: s.contextPercent,
        };
      });
    // Hide DEAD lanes (dead_shell/no_tmux) and GRAY lanes (status 'unknown' — stale
    // past the liveness window / never reported). A still-known status
    // (active/waiting/permission, even if dimmed) stays.
    return [...fromSupervised, ...extra]
      .filter((s) => s.status !== 'unknown' && s.status !== 'dead')
      .map((s) => ({ ...s, status: s.status as 'active' | 'waiting' | 'permission' | 'unknown' }));
  }, [supervised, projectSubs, project, serverScope, sessionStatuses, fleet]);

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
  const inflightCount = useMemo(() => funnelCounts(excludeEpics(todos)).inflight, [todos]);

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
  const [bridgeTab, setBridgeTab] = useState<'escalations' | 'todos' | 'workers' | 'stream'>('escalations');
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

  return (
    <div className="relative h-full">
      <SplitDeck
        commandBar={
          <CommandBar
            liveCount={liveCount}
            inflightCount={inflightCount}
            needsYouCount={openEscalationCount}
            serverScope={serverScope}
            project={project}
            onRefresh={resyncBridge}
          />
        }
        left={
          <>
            {/* Progress funnel (Backlog▸Ready▸In-flight▸Blocked▸Done). The
                coordinator on/off now lives in the CommandBar role-switch line
                next to Steward/Supervisor, so this is standalone (no card). */}
            <FleetVitals
              todos={todos}
              coverage={coverageByProject[project]}
              unlandedEpics={unlandedEpicsByProject[project]}
            />
            {/* The confirm-loop heartbeat — full width above the columns, self-hides
                when there's no requirement to sign off. */}
            <RequirementsInbox
              requirements={requirementsByProject[project] ?? []}
              project={project}
              serverScope={serverScope}
            />
            {/* Two columns above the graph: a TABBED instrument panel
                (Escalations · Todos · Workers · Stream) + a Todo-description panel
                that fills when a todo node is clicked in the graph. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
              {/* Column 1 — tabbed instrument panel. */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col min-h-[18rem] max-h-[28rem] min-w-0">
                <div className="shrink-0 flex items-stretch border-b border-gray-200 dark:border-gray-700">
                  {([
                    { key: 'escalations', label: 'Escalations', count: openEscalationCount, loud: true },
                    { key: 'todos', label: 'Todos', count: selectHumanInbox(todos).length },
                    { key: 'workers', label: 'Workers', count: workerSubs.length },
                    { key: 'stream', label: 'Stream' },
                  ] as const).map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      data-testid={`bridge-tab-${t.key}`}
                      data-active={bridgeTab === t.key}
                      onClick={() => setBridgeTab(t.key)}
                      className={`flex items-center gap-1 px-3 py-2 text-2xs font-semibold uppercase tracking-wide border-b-2 -mb-px transition-colors ${
                        bridgeTab === t.key
                          ? 'border-accent-500 text-accent-700 dark:text-accent-300'
                          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                      }`}
                    >
                      {t.label}
                      {'count' in t && t.count != null && t.count > 0 && (
                        <span className={'loud' in t && t.loud ? 'text-danger-600 dark:text-danger-400 font-bold' : 'text-gray-400 dark:text-gray-500'}>{t.count}</span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-2">
                  {bridgeTab === 'escalations' && (
                    <NeedsYouZone embedded escalations={escalations} project={project} serverScope={serverScope} onJump={handleJump} />
                  )}
                  {bridgeTab === 'todos' && (
                    <HumanInbox
                      embedded
                      todos={todos}
                      onClaim={(t) => void promoteTodo(serverScope, project, t.id, 'in_progress')}
                      onComplete={(t) => void promoteTodo(serverScope, project, t.id, 'done')}
                      onOpen={handleSelectTodo}
                    />
                  )}
                  {bridgeTab === 'workers' && <WorkerRoster embedded subscriptions={workerSubs} todos={todos} onJump={handleJump} />}
                  {bridgeTab === 'stream' && <StreamTicker embedded events={projectStreamEvents} />}
                </div>
              </div>

              {/* Column 2 — Todo description (fills on graph-todo click). */}
              <div
                data-testid="bridge-todo-detail"
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col min-h-[18rem] max-h-[28rem] min-w-0"
              >
                <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Todo</span>
                  {selectedTodoId && (
                    <button
                      type="button"
                      aria-label="Close todo detail"
                      onClick={() => setSelectedTodoId(null)}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm leading-none px-1"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-3">
                  {selectedTodoId ? (
                    <TodoDetailView todoId={selectedTodoId} />
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-gray-500 italic">Click a todo in the Plan below to see its description.</p>
                  )}
                </div>
              </div>
            </div>
          </>
        }
        right={
          <PlanPanel
            serverId={serverScope}
            project={project}
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
    </div>
  );
};

export default BridgeDashboard;
