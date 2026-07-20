/**
 * BridgeDashboard — the fleet command center (Bridge redesign BR-2, design §2/§8).
 *
 * The old KPI grid is gone. The Bridge is now a SplitDeck: a CommandBar on top
 * (identity + project selector + the glanceable pulse that absorbed the deleted
 * AlertRibbon), a LEFT instrument panel in strict hierarchy
 * (NeedsYouZone ▸ FleetVitals ▸ WorkerRoster ▸ StreamTicker), and a RIGHT stage
 * (MissionsStrip over PlanPanel). This component owns the data scoping; the panel
 * pieces are pure presentational cards.
 *
 * The Bridge takes no props: the artifact viewer is a SEPARATE component and does
 * not nest inside the stage.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import type { SessionTodo } from '@/types/sessionTodo';
import { isClaimable, buildById } from '@/lib/claimability';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useUIStore } from '@/stores/uiStore';
import { useEventStreamStore } from '@/stores/eventStreamStore';
import { useDiveIn, useSelectSessionInPlace } from '@/hooks/useDiveIn';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { SplitDeck } from './SplitDeck';
import { CommandBar } from './CommandBar';
import { ProjectSettingsModal } from './ProjectSettingsModal';
import { isOrchestratorSession } from '@/lib/liveness';
import { useSessionStatuses } from '@/hooks/useSessionStatuses';
import { useFleetStatus, type FleetWorkerState } from '@/hooks/useFleetStatus';
import { NeedsYouZone } from './NeedsYouZone';
import { StrandedPanel } from './StrandedPanel';
import { projectPlanStats } from '@/components/layout/SupervisorPanel';
import { SubscribersPanel } from './SubscribersPanel';
import { StreamTicker } from './StreamTicker';
import { DecisionCard } from './focal/DecisionCard';
import { funnelCounts, excludeEpics, isStranded } from './funnel';
import { selectOpenEscalations } from './escalationSelectors';
import { useDeckStore } from '@/stores/deckStore';
import { useWorkerFabricStore } from '@/stores/workerFabricStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { ExecutorStatsPanel } from './ExecutorStatsPanel';
import { DogfoodHealthPanel } from './DogfoodHealthPanel';
import { MissionsPanel } from './MissionsPanel';
import { UsagePanel } from './UsagePanel';
import { useFeatureFlags } from '@/config/featureFlags';
import { getWebSocketClient } from '@/lib/websocket';
import { epicIdSet, isEpic } from '@/lib/todoKind';
import { SignalsStrip } from './SignalsStrip';
import { BridgeRail } from './rail/BridgeRail';
import type { RailKey } from './rail/RailNav';
import { ProjectFooter } from './rail/ProjectFooter';
import { WorkPanel } from './rail/panels/WorkPanel';
import { BridgeStage } from './stage/BridgeStage';
import { BridgeInspector } from './inspector/BridgeInspector';
import { MissionDetailPanel } from './inspector/MissionDetailPanel';
import { MissionStrip } from './MissionStrip';
import { UnlandedStrip } from './UnlandedStrip';

// Match the worker-card poll cadence (useSessionStatuses POLL_MS) so the
// Escalations inbox and the worker roster refresh on the SAME clock — a
// cross-instance escalation that misses the per-process broadcast still surfaces
// within the same window the worker card turns red.
const ESCALATION_POLL_MS = 10_000;
const DAEMON_COUNTS_POLL_MS = 10_000;

/** Graph-only view: hide finished noise. An epic is an epic BY DECLARED KIND
 *  (`kind === 'epic'`), never "a todo that has children" — a split leaf keeps its
 *  children as sub-tasks and a childless epic is still an epic. */
export function selectGraphTodos(todos: SessionTodo[]): SessionTodo[] {
  const finished = (t: SessionTodo) => t.status === 'done' || t.status === 'dropped';
  const ids = new Set(todos.map((t) => t.id));
  const epicIds = epicIdSet(todos);

  // STRUCTURE (not role): children of each present parent, for the done-rollup below.
  const childrenByParent = new Map<string, SessionTodo[]>();
  for (const t of todos) {
    if (t.parentId && ids.has(t.parentId)) {
      const arr = childrenByParent.get(t.parentId) ?? [];
      arr.push(t);
      childrenByParent.set(t.parentId, arr);
    }
  }

  // A "done epic" is a declared epic that HAS children and all of them are finished.
  // Zero children ⇒ not done (an empty epic lane stays visible).
  const doneEpics = new Set<string>();
  for (const pid of epicIds) {
    const kids = childrenByParent.get(pid);
    if (kids && kids.length > 0 && kids.every(finished)) doneEpics.add(pid);
  }

  return todos.filter((t) => {
    if (t.parentId && doneEpics.has(t.parentId)) return false;   // child of a done epic
    if (doneEpics.has(t.id)) return false;                        // the done epic itself
    if (!t.parentId && !isEpic(t) && finished(t)) return false;   // completed orphan
    return true;
  });
}

export const BridgeDashboard: React.FC = () => {
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
  // Bumped by the ↺ refresh button to force an immediate worker-card (session-status)
  // re-poll — otherwise the cards only refresh on useSessionStatuses' 10s interval.
  const [statusRefreshNonce, setStatusRefreshNonce] = useState(0);
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
    // Force the worker cards (polled session statuses) to refresh now, not in ≤10s.
    setStatusRefreshNonce((n) => n + 1);
  }, [serverScope, project, watchedProjects, loadEscalations, loadProjectTodos, loadAudit, loadRequirements, loadCoverage]);

  // EXPLICIT refresh (the ↺ button) — data resync PLUS a terminal reattach, since a
  // common reason to hit refresh is a blanked console. Kept separate from the
  // automatic resyncBridge effect so the terminal isn't remounted on every
  // dependency-driven resync (only on a deliberate click).
  const onManualRefresh = useCallback(() => {
    resyncBridge();
    useTerminalStore.getState().reattachConsole();
  }, [resyncBridge]);

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
    // Live-update the Bridge todo cards on ANY session_todos_updated — including
    // DAEMON-driven transitions (reclaim→blocked, retry-exhaust, claim→in_progress)
    // which now broadcast (coordinator notifyTodosChanged). Without this the Bridge
    // only resynced on mount/reconnect/manual-↺, so a server-side block left a stale
    // in-flight card. Targeted reload of just the affected project's todos.
    const msgSub = client.onMessage((msg: any) => {
      if (msg?.type === 'session_todos_updated' && typeof msg.project === 'string' && msg.project) {
        void loadProjectTodos(serverScope, msg.project);
      }
      // Live-update the Escalations inbox on the escalation_created broadcast —
      // the SAME on-demand re-poll d1367b0 gave the todo/worker cards. This is the
      // fast same-instance path: a worker on THIS server raises an escalation and
      // the inbox refreshes immediately, matching the red worker card. (App.tsx
      // also re-polls globally for the toast, but the Bridge subscribing on its own
      // serverScope is the d1367b0-shaped fix and avoids relying on the App root.)
      if (msg?.type === 'escalation_created') {
        void loadEscalations(serverScope, 'open');
      }
      // Worker-fabric spine (design-worker-fabric-ui §6.4): fold each phase event into
      // the fabric store so the work-graph nodes can decorate live.
      if (msg?.type === 'worker_phase' && typeof msg.todoId === 'string') {
        useWorkerFabricStore.getState().applyPhase(msg);
      }
    });
    // Hydrate live lanes for every watched project on connect/reconnect (the WS stream
    // keeps them fresh after; ledger is authoritative for cost on hydration).
    for (const p of new Set<string>(watchedProjects.map((w) => w.project).filter(Boolean))) {
      void useWorkerFabricStore.getState().hydrateFromServer(p);
    }
    return () => { sub.unsubscribe(); msgSub.unsubscribe(); };
  }, [resyncBridge, serverScope, loadProjectTodos, loadEscalations, watchedProjects]);

  // The broadcast above only reaches clients on the SAME server process that
  // handled escalation_create. A CROSS-PROJECT worker can be served by a different
  // instance (which writes the shared supervisor store but broadcasts only to its
  // own WS clients), so the Bridge would miss the event and the inbox stayed empty
  // behind a red worker card until the next reconnect/manual-↺. Worker cards never
  // showed this lag because useSessionStatuses polls every 10s. Give the Escalations
  // inbox the SAME periodic re-poll so both surfaces share one clock: a cross-instance
  // escalation now surfaces within the same ~10s window the worker card turns red.
  useEffect(() => {
    const id = setInterval(() => { void loadEscalations(serverScope, 'open'); }, ESCALATION_POLL_MS);
    return () => clearInterval(id);
  }, [serverScope, loadEscalations]);

  // AUTHORITATIVE Ready / In-flight counts from the daemon read-model (the same
  // /api/leaf-executor/daemon the Executor tab polls). The local todo-derived counts
  // drift from reality: `Ready` OVER-counts (it skips the daemon's probe / git-stranded /
  // headless / breaker gates) and `In-flight` UNDER-counts (a headless leaf doesn't flip
  // its todo's local status, so an actively-building project read 0). Prefer the daemon's
  // numbers; fall back to the local derivation until the first poll lands.
  const [daemonCounts, setDaemonCounts] = useState<{ claimable: number | null; inflight: number | null; claimableIds: string[] | null }>({ claimable: null, inflight: null, claimableIds: null });
  useEffect(() => {
    if (!project) { setDaemonCounts({ claimable: null, inflight: null, claimableIds: null }); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/leaf-executor/daemon?project=${encodeURIComponent(project)}`);
        if (!res.ok || cancelled) return;
        const d = await res.json();
        if (cancelled) return;
        setDaemonCounts({
          claimable: typeof d?.claimSuppression?.claimable === 'number' ? d.claimSuppression.claimable : null,
          inflight: Array.isArray(d?.inflight) ? d.inflight.length : null,
          claimableIds: Array.isArray(d?.claimSuppression?.claimableIds) ? d.claimSuppression.claimableIds : null,
        });
      } catch { /* best-effort; keep the last good / local fallback */ }
    };
    void poll();
    const id = setInterval(() => { void poll(); }, DAEMON_COUNTS_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [project]);

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
  const sessionStatuses = useSessionStatuses(serverScope, project || undefined, statusRefreshNonce);
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
          // Claim-based anchor for the roster's time-on-task timer (stable across
          // daemon heartbeats). Null when the lane holds no in-progress claim.
          taskClaimedAt: entry?.claimedAt ?? null,
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
          taskClaimedAt: entry?.claimedAt ?? null,
          contextPercent: s.contextPercent,
        };
      });
    // THIRD source: daemon-spawned pool lanes (e.g. backend-grok-build-2,
    // backend-claude-1) are in NEITHER the supervised set NOR the Watching feed and
    // emit no subscription, so without this they never become a card even though
    // /api/fleet HAS them. Source a row directly from each fleet entry whose session
    // isn't already known and isn't an orchestrator. The fleet map is keyed by the
    // worker session, so the KEY is the session.
    for (const s of [...fromSupervised, ...extra]) known.add(s.session);
    const fromFleet = Object.entries(fleet)
      .filter(([session]) => !isOrchestratorSession(session) && !known.has(session))
      .map(([session, entry]) => {
        known.add(session);
        return {
          serverId: serverScope,
          project,
          session,
          status: fleetToStatus(entry.state),
          lastUpdate: entry.lastActivity as number | null,
          taskClaimedAt: entry.claimedAt ?? null,
          contextPercent: undefined as number | undefined,
        };
      });
    // Hide DEAD lanes (dead_shell/no_tmux) and GRAY lanes (status 'unknown' — stale
    // past the liveness window / never reported). A still-known status
    // (active/waiting/permission, even if dimmed) stays.
    return [...fromSupervised, ...extra, ...fromFleet]
      .filter((s) => s.status !== 'unknown' && s.status !== 'dead')
      .map((s) => ({ ...s, status: s.status as 'active' | 'waiting' | 'permission' | 'unknown' }));
  }, [supervised, projectSubs, project, serverScope, sessionStatuses, fleet]);

  const graphTodos = useMemo(() => selectGraphTodos(todos), [todos]);

  const readyCount = useMemo(
    () => {
      const byId = buildById(todos);
      return todos.filter((t) => isClaimable(t, byId)).length;
    },
    [todos],
  );

  const strandedCount = useMemo(() => {
    const byId = buildById(todos);
    return excludeEpics(todos).filter((t) => isStranded(t, byId)).length;
  }, [todos]);

  // todoId→title for enriching the stream's thin todo-lifecycle events (render-time join).
  const titleByTodoId = useMemo(
    () => new Map(todos.map((t) => [t.id, t.title ?? t.id])),
    [todos],
  );

  // The single source of "needs you" — same selector the CommandBarBadge, the
  // Z-rail and the FleetGraph danger ring derive from (badge ⟺ ring parity).
  const openEscalations = useMemo(
    () => selectOpenEscalations(escalations, project),
    [escalations, project],
  );
  const openEscalationCount = openEscalations.length;
  // Split the open escalations the way the project cards do: land-ready (a positive
  // "ship to master" prompt → its own Land tab) vs blockers (genuine "needs you").
  const landEscalations = useMemo(
    () => openEscalations.filter((e) => e.kind === 'epic-ready-to-land'),
    [openEscalations],
  );
  const blockerEscalations = useMemo(
    () => openEscalations.filter((e) => e.kind !== 'epic-ready-to-land'),
    [openEscalations],
  );
  const liveCount = useMemo(
    () => projectSubs.filter((s) => s.status === 'active').length,
    [projectSubs],
  );
  const inflightCount = useMemo(() => funnelCounts(excludeEpics(todos)).inflight, [todos]);
  // Same plan stats the project cards show (open / in-progress / blocked / parked),
  // so the Bridge top totals and the left-column card never disagree.
  const planStats = useMemo(() => projectPlanStats(todos), [todos]);

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
  // Per-epic history (todo b05125b6): clicking an epic node in the FleetGraph
  // surfaces its escalation + decision history in Column 2 (taking precedence over
  // the todo detail). Cleared on close or when a todo is clicked.
  const [selectedEpic, setSelectedEpic] = useState<{ id: string; label: string } | null>(null);
  // Mission detail renders in the STAGE (like a rail panel), not the inspector
  // drawer (design 2026-07-13): clicking the MissionStrip swaps the stage to the
  // MissionDetailPanel, the same window where Plan/Stream/Escalations render.
  const [missionInStage, setMissionInStage] = useState(false);
  const [railPanel, setRailPanel] = useState<RailKey | null>('escalations');
  // Per-project settings modal (gear button in the CommandBar header).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const handleSelectTodo = (todo: SessionTodo) => {
    upsertSessionTodo(todo);
    setSelectedTodoId(todo.id);
    setSelectedEpic(null);
  };
  const handleSelectEpic = (epic: { id: string; label: string }) => {
    setSelectedEpic(epic);
    setSelectedTodoId(null);
  };
  // Clicking the mission bar shows the mission detail in the stage; a subsequent
  // rail click swaps it back out (handleRailSelect clears missionInStage).
  const handleOpenMissions = useCallback(() => {
    setMissionInStage(true);
  }, []);

  // crit 4: single dismiss path shared by the drawer's close button, a backdrop
  // click, and the Escape key. Clears both selections → inspectorOpen goes false.
  const closeInspector = useCallback(() => {
    setSelectedEpic(null);
    setSelectedTodoId(null);
  }, []);

  // crit 4: Esc closes the inspector drawer (only wired while open so it doesn't
  // swallow Escape used elsewhere).
  const inspectorOpen = Boolean(selectedEpic || selectedTodoId);
  useEffect(() => {
    if (!inspectorOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeInspector(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [inspectorOpen, closeInspector]);

  const panels = useMemo<Partial<Record<RailKey, React.ReactNode>>>(
    () => ({
      escalations: <div className="p-2"><NeedsYouZone embedded escalations={blockerEscalations} project={project} serverScope={serverScope} onJump={handleJump} onSelectTodo={handleSelectTodo} /></div>,
      land: <div className="p-2"><NeedsYouZone embedded escalations={landEscalations} project={project} serverScope={serverScope} onJump={handleJump} onSelectTodo={handleSelectTodo} emptyLabel="No epics ready to land" variant="land" /></div>,
      work: <WorkPanel todos={todos} project={project} serverScope={serverScope} claimableIds={daemonCounts.claimableIds} onJump={handleJump} onSelectTodo={handleSelectTodo} />,
      stranded: <StrandedPanel todos={todos} onSelectTodo={handleSelectTodo} />,
      stream: <div className="p-2"><StreamTicker embedded events={projectStreamEvents} titleByTodoId={titleByTodoId} onSelectEvent={(e) => { const t = e.todoId ? todos.find((x) => x.id === e.todoId) : undefined; if (t) handleSelectTodo(t); }} /></div>,
      executor: <div className="p-2"><ExecutorStatsPanel project={project} serverScope={serverScope} /></div>,
      subscribers: <SubscribersPanel project={project} serverScope={serverScope} todos={todos} onSelectTodo={handleSelectTodo} />,
      usage: <UsagePanel project={project} serverScope={serverScope} />,
      missions: <MissionsPanel serverId={serverScope} project={project} />,
      dogfood: <div className="p-2"><DogfoodHealthPanel project={project} serverScope={serverScope} /></div>,
    }),
    [blockerEscalations, landEscalations, todos, project, serverScope, daemonCounts.claimableIds, projectStreamEvents, titleByTodoId, handleJump],
  );

  // Mission detail is a stage view (design 2026-07-13): when the mission strip is
  // clicked it takes over the stage, just like a rail panel does.
  const missionStagePanel = (
    <MissionDetailPanel serverId={serverScope} project={project} session={currentSession?.name} />
  );
  const activePanel = missionInStage ? missionStagePanel : railPanel ? panels[railPanel] : undefined;

  const handleRailSelect = (k: RailKey | null) => {
    setMissionInStage(false);
    setRailPanel(k === 'plan' ? null : k);
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
            needsYouCount={blockerEscalations.length}
            landReadyCount={landEscalations.length}
            openCount={planStats.open}
            inProgressCount={planStats.inProgress}
            blockedCount={planStats.blocked}
            parked={planStats.idleWithWork}
            project={project}
            onRefresh={onManualRefresh}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        }
        signals={
          <SignalsStrip
            requirements={requirementsByProject[project] ?? []}
            project={project}
            serverScope={serverScope}
          />
        }
        rail={
          <BridgeRail
            selected={railPanel ?? 'plan'}
            onSelect={handleRailSelect}
            counts={{
              escalations: blockerEscalations.length,
              land: landEscalations.length,
              inflight: daemonCounts.inflight ?? inflightCount,
              ready: daemonCounts.claimable ?? readyCount,
              stranded: strandedCount,
            }}
            footer={
              <ProjectFooter
                unlandedEpics={unlandedEpicsByProject[project]}
                coverage={coverageByProject[project]}
                onSelectPanel={setRailPanel}
              />
            }
          />
        }
        unlandedStrip={
          <UnlandedStrip
            unlandedEpics={unlandedEpicsByProject[project]}
            onSelectPanel={setRailPanel}
          />
        }
        missionStrip={
          <MissionStrip
            serverId={serverScope}
            project={project}
            session={currentSession?.name}
            onOpenMissions={handleOpenMissions}
          />
        }
        stage={
          <BridgeStage
            serverId={serverScope}
            project={project}
            events={projectStreamEvents}
            activePanel={activePanel}
            titleByTodoId={titleByTodoId}
            onSelectTodo={handleSelectTodo}
            onSelectEpic={handleSelectEpic}
            onSelectRailPanel={setRailPanel}
          />
        }
        inspector={
          <BridgeInspector
            selectedEpic={selectedEpic}
            selectedTodoId={selectedTodoId}
            project={project}
            serverScope={serverScope}
          />
        }
        inspectorOpen={inspectorOpen}
        onInspectorClose={closeInspector}
      />

      <ProjectSettingsModal
        project={project}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
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
