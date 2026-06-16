/**
 * SupervisorPanel — the "Supervisor" sidebar section.
 *
 * Session-centric: lists the sessions the supervisor oversees (the supervised
 * set from `/api/supervisor/supervised`), grouped by project. Each session is
 * rendered with the SAME card the Watching panel uses (SessionCard), so a
 * supervised card shows everything a watched one does (project, server icon,
 * live status, context %, elapsed, avatar) and clicking it behaves identically
 * (create terminal, focus browser tab, open the terminal). Supervisor-specific
 * extras: a 🔒 lock indicator, a ⚠️ open-escalation indicator, and the shield
 * toggle acts as "stop supervising" (DELETE from the supervised set).
 *
 * Full card data (context %, elapsed, serverId) comes from the Watching feed
 * (`useSubscriptionStore`) — the SINGLE worker-liveness source (design-ui-status-
 * coherence §0/§3). The old divergent `/api/session-status` poll is gone, so this
 * left column and the Bridge graph read liveness from the same store and cannot
 * disagree (the R2/D5/D6 fix).
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  useSupervisorStore,
  type SupervisedSession,
} from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useServers } from '@/contexts/ServerContext';
import { SessionCard, ClaudePixAvatar, type SessionCardData } from '@/components/layout/SessionCard';
import { useFleetShortcuts } from '@/components/layout/useFleetShortcuts';
import { useBridgeOrderStore, applyBridgeOrder } from '@/stores/bridgeOrderStore';
import { isOrchestratorSession } from '@/lib/liveness';
import { SupervisorOnboarding } from '@/components/supervisor/SupervisorOnboarding';
import { useUIStore } from '@/stores/uiStore';
import { selectOpenEscalationCount } from '@/lib/statusSelectors';
import { AddProjectDialog } from '@/components/dialogs';
import { OrchestratorLevelBadge } from '@/components/supervisor/bridge/OrchestratorLevelBadge';
import { useFleetStatus, useFleetStatusByProject, fleetKey, fleetStateToStatus } from '@/hooks/useFleetStatus';

/**
 * Reduce a project's session-card statuses to ONE combined health status — the
 * at-a-glance per-project read (mirrors the SessionCard status palette). Severity
 * order: permission (RED) ▸ active (AMBER) ▸ waiting (GREEN) ▸ unknown (GREY).
 */
export function combineCardStatus(statuses: Array<SessionCardData['status']>): SessionCardData['status'] {
  if (statuses.some((s) => s === 'permission')) return 'permission';
  if (statuses.some((s) => s === 'active')) return 'active';
  if (statuses.some((s) => s === 'waiting')) return 'waiting';
  return 'unknown';
}

/**
 * Disambiguating display labels for a set of project PATHS. A project shows its
 * basename alone (e.g. "build123d-ocp-mcp"); but when two watched projects share
 * a basename (e.g. /Users/me/Code/build123d-ocp-mcp vs /repos/build123d-ocp-mcp)
 * the colliding ones get a parent-qualified label ("Code/build123d-ocp-mcp" vs
 * "repos/build123d-ocp-mcp") so the tree never shows two identical rows. Pure.
 */
export function disambiguateProjectLabels(paths: string[]): Record<string, string> {
  const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p;
  const counts: Record<string, number> = {};
  for (const p of paths) counts[base(p)] = (counts[base(p)] ?? 0) + 1;
  const out: Record<string, string> = {};
  for (const p of paths) {
    const segs = p.split('/').filter(Boolean);
    const b = segs[segs.length - 1] ?? p;
    out[p] = counts[b] > 1 && segs.length >= 2 ? `${segs[segs.length - 2]}/${b}` : b;
  }
  return out;
}

/** Per-project header background, mirroring SessionCard's statusBg palette. */
export function projectHeaderBg(status: SessionCardData['status']): string {
  switch (status) {
    case 'permission':
      return 'bg-danger-300 dark:bg-danger-900/40 border border-danger-500';
    case 'active':
      return 'card-pulse-amber border border-warning-400';
    case 'waiting':
      return 'bg-success-300 dark:bg-success-900/40 border border-success-500';
    default:
      return 'bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600';
  }
}

/**
 * The supervised-session card list for ONE project group. Lives in its own
 * component so it can call useFleetStatus(project) — a hook can't run per-iteration
 * inside the parent's byProject.map — and stamp each WORKER card with its
 * claim-based `taskClaimedAt`. That makes the card timer show TIME-ON-TASK (since
 * claim), which is monotonic per worker and does NOT reset when the daemon pings
 * every lane's heartbeat in lockstep (the bug this fixes). Non-worker lanes (no
 * fleet claim) keep the generic last-activity behaviour.
 */
export interface SupervisorPanelProps {
  currentProject?: string;
  currentSession?: string;
  onNavigate?: (serverId: string, project: string, session: string) => void;
  /** Called when the user clicks "Open Supervisor" to deep-link into the full SupervisorView. */
  onOpenSupervisorView?: () => void;
}

type IconServer = { id: string; icon?: string; label: string; source?: string; host?: string };

/** The actual local server, used to resolve the 'local' SENTINEL that supervised
 *  rows are stamped with (source==='local', else a loopback host). Pure; (2e3efadd). */
export function localServerOf<T extends { source?: string; host?: string }>(servers: T[]): T | undefined {
  return (
    servers.find((s) => s.source === 'local') ??
    servers.find((s) => s.host === '127.0.0.1' || s.host === 'localhost')
  );
}

/** id→icon map that ALSO aliases the 'local' sentinel to the local server's icon,
 *  so a supervised card stamped serverId='local' shows the real local-server icon
 *  instead of the generic fallback (bug 2e3efadd). Pure; unit-tested. */
export function buildServerIconMap(servers: IconServer[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of servers) if (s.icon) m.set(s.id, s.icon);
  const local = localServerOf(servers);
  if (local?.icon) m.set('local', local.icon);
  return m;
}

/** id→label map with the same 'local' aliasing as buildServerIconMap. */
export function buildServerLabelMap(servers: IconServer[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of servers) m.set(s.id, s.label);
  const local = localServerOf(servers);
  if (local) m.set('local', local.label);
  return m;
}


export const SupervisorPanel: React.FC<SupervisorPanelProps> = ({ currentProject, currentSession, onNavigate, onOpenSupervisorView }) => {
  // Global fleet shortcuts: Shift+F# → watch card, Ctrl+Shift+F# → Bridge project.
  useFleetShortcuts();
  const activeId = useSessionStore((s) => s.currentSession)?.serverId ?? null;
  // Routing scope for supervisor API calls. The supervisor store is GLOBAL
  // (server-side), so its data is the same regardless of which server we route
  // through; fall back to 'local' so the panel still loads when no server is
  // active (e.g. the standalone sidebar). When a desktop bridge is present,
  // 'local' resolves to the local server via the fetch fallback.
  const serverScope = activeId ?? 'local';

  const {
    supervised,
    config,
    liveness,
    loadSupervised,
    loadConfig,
    loadLiveness,
  } = useSupervisorStore();

  // Unified Bridge tree (design-tabbed-bridge PIVOT): the watched-project set is
  // the project index; escalation counts + coordinator state badge each row;
  // clicking a row drives the Bridge. watch === supervise (add/remove couples).
  const watchedProjects = useSupervisorStore((s) => s.watchedProjects);
  // Coherence: the open slice, read through the shared scoped selector below.
  const openEscalations = useSupervisorStore((s) => s.openEscalations);
  const loadProjects = useSupervisorStore((s) => s.loadProjects);
  const addProject = useSupervisorStore((s) => s.addProject);
  const removeProject = useSupervisorStore((s) => s.removeProject);
  const activeProject = useUIStore((s) => s.activeProject);
  const setActiveProject = useUIStore((s) => s.setActiveProject);
  const setMode = useUIStore((s) => s.setMode);

  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const sessions = useSessionStore((s) => s.sessions);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const storeCurrentSession = useSessionStore((s) => s.currentSession);
  const { servers } = useServers();
  const [collapsed, setCollapsed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // Escalations + worker liveness are no longer refreshed here — escalations flow
  // through the app-root useStatusSync (WS ingest + bootstrap hydrate) and liveness
  // through subscriptionStore. This interval is scoped to the supervisor-ROLE facts
  // the coherence design does not govern: supervised membership, watched projects,
  // and the config/liveness that drive the 'none'/'crashed'/'running' front door
  // (polled so the panel flips to Restart within the staleness window on a crash).
  useEffect(() => {
    const refresh = () => {
      void loadSupervised(serverScope);
      void loadConfig(serverScope);
      void loadLiveness(serverScope);
      void loadProjects(serverScope);
    };
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [serverScope, loadSupervised, loadConfig, loadLiveness, loadProjects]);

  const watchedList = Array.isArray(watchedProjects) ? watchedProjects : [];

  // Front-door state: no config saved → 'none' (Become the Supervisor); config
  // present but the heartbeat has gone stale (or never registered) → 'crashed'
  // (Restart front door); config present and the heartbeat is fresh → 'running'
  // (the live dashboard below). `liveness === null` means we haven't polled yet,
  // so don't flash the crashed door before the first identity response lands.
  const hasConfig = !!(config?.supervisorProject && config?.supervisorSession);
  const supervisorState: 'none' | 'crashed' | 'running' = !hasConfig
    ? 'none'
    : liveness == null || liveness.running
      ? 'running'
      : 'crashed';

  // Supervised rows are stamped with the 'local' SENTINEL (serverScope = activeId
  // ?? 'local'), but these maps are keyed by REAL server ids — so a 'local' row
  // missed and fell back to the generic/alien icon (bug 2e3efadd). The map builders
  // alias 'local' → the actual local server's icon/label (tested helpers; also
  // handle a loopback-host local server). activeServerIcon falls back to 'local'.
  const serverIconById = useMemo(() => buildServerIconMap(servers), [servers]);
  const serverLabelById = useMemo(() => buildServerLabelMap(servers), [servers]);
  const activeServerIcon = (activeId ? serverIconById.get(activeId) : undefined) ?? serverIconById.get('local');

  // The global role workspaces (~/.mermaid-collab/supervisor, .../steward) are not
  // user projects — never list them in the Bridge tree.
  const isRoleWorkspace = (p: string) => /\/\.mermaid-collab\/(supervisor|steward)\/?$/.test(p);

  // Unified Bridge tree rows: the union of WATCHED projects (the index) and any
  // project that has supervised sessions, each carrying its sessions + the
  // per-row metadata (open-escalation count from the single roll-up path, the
  // coordinator dot). Sorted urgency-first: red (most escalations) → quiet
  // (alphabetical), so "which project needs you" floats to the top.
  const byProject = useMemo(() => {
    const m = new Map<string, SupervisedSession[]>();
    for (const s of supervised) {
      const arr = m.get(s.project) ?? [];
      arr.push(s);
      m.set(s.project, arr);
    }
    const paths = new Set<string>();
    watchedList.forEach((w) => w.project && !isRoleWorkspace(w.project) && paths.add(w.project));
    for (const p of m.keys()) if (!isRoleWorkspace(p)) paths.add(p);
    return Array.from(paths)
      .map((project) => ({
        project,
        sessions: (m.get(project) ?? []).slice().sort((a, b) => a.session.localeCompare(b.session)),
        escalationCount: selectOpenEscalationCount(openEscalations, { kind: 'project', project }),
      }))
      .sort((a, b) => {
        if ((b.escalationCount > 0 ? 1 : 0) !== (a.escalationCount > 0 ? 1 : 0)) {
          return (b.escalationCount > 0 ? 1 : 0) - (a.escalationCount > 0 ? 1 : 0);
        }
        if (a.escalationCount !== b.escalationCount) return b.escalationCount - a.escalationCount;
        return a.project.localeCompare(b.project);
      });
  }, [supervised, watchedList, openEscalations]);

  // Manual project order (drag-reorder; option 1 — fully wins over the urgency
  // sort). Also drives the Ctrl+Shift+F# project mapping. New projects append.
  const bridgeOrder = useBridgeOrderStore((s) => s.order);
  const reorderProjects = useBridgeOrderStore((s) => s.reorder);
  const orderedProjects = useMemo(() => applyBridgeOrder(byProject, bridgeOrder), [byProject, bridgeOrder]);

  // TRUE worker liveness across every watched project (server-computed from real
  // tmux). Daemon-spawned pool workers don't emit the subscription WS status
  // events, so without this they read 'unknown' and get decluttered (the "no
  // workers in the Bridge" bug). cardDataFor falls back to this when no fresh sub.
  const projectPaths = useMemo(() => byProject.map((r) => r.project), [byProject]);
  const fleetByProject = useFleetStatusByProject(serverScope, projectPaths);

  // Display labels, parent-qualified only where basenames collide.
  const projectLabels = useMemo(
    () => disambiguateProjectLabels(byProject.map((r) => r.project)),
    [byProject],
  );

  // Live-but-unwatched projects (supervised/subscriptions − watched − role) — the
  // dim "watch+" affordance at the bottom of the tree.
  const detectedProjects = useMemo(() => {
    const known = new Set(byProject.map((r) => r.project));
    const set = new Set<string>();
    supervised.forEach((s) => s.project && set.add(s.project));
    Object.values(subscriptions).forEach((s) => s.project && set.add(s.project));
    return Array.from(set).filter((p) => !known.has(p) && !isRoleWorkspace(p));
  }, [supervised, subscriptions, byProject]);

  // Click a project row → make it the active Bridge project and jump to Bridge
  // mode (decision C: the left column is the single master).
  const handleSelectProject = useCallback(
    (project: string) => {
      setActiveProject(project);
      setMode('bridge');
    },
    [setActiveProject, setMode],
  );

  // watch === supervise (decision B). Adding a project watches it AND supervises
  // every session of it currently known (from subscriptions); removing unwatches
  // and stops supervising those sessions. Per-session shield still opts out.
  const superviseSession = useCallback(
    async (project: string, session: string, on: boolean) => {
      const mc = (window as any).mc;
      const path = '/api/supervisor/supervised';
      const body = on ? { project, session, source: 'manual' } : { project, session };
      const method = on ? 'POST' : 'DELETE';
      if (mc?.invokeOnServer) await mc.invokeOnServer(serverScope, { path, method, body });
      else await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
    },
    [serverScope],
  );
  const handleAddProject = useCallback(
    async (path: string) => {
      await addProject(serverScope, path);
      // Couple: supervise the project's currently-known sessions.
      const sess = Object.values(subscriptions).filter((s) => s.project === path).map((s) => s.session);
      await Promise.all(sess.map((s) => superviseSession(path, s, true)));
      void loadSupervised(serverScope);
      handleSelectProject(path);
    },
    [serverScope, addProject, subscriptions, superviseSession, loadSupervised, handleSelectProject],
  );
  const handleRemoveProjectRow = useCallback(
    async (path: string) => {
      const sess = (byProject.find((r) => r.project === path)?.sessions ?? []).map((s) => s.session);
      await Promise.all(sess.map((s) => superviseSession(path, s, false)));
      void removeProject(serverScope, path);
      if (activeProject === path) setActiveProject(null);
      void loadSupervised(serverScope);
    },
    [serverScope, byProject, superviseSession, removeProject, activeProject, setActiveProject, loadSupervised],
  );

  // Find the Watching-feed subscription that matches a project+session (any
  // serverId). It carries the live status, context %, lastUpdate, and the
  // serverId we should route per-server actions through.
  const findSubscription = useCallback(
    (project: string, session: string): SessionCardData | undefined => {
      for (const sub of Object.values(subscriptions)) {
        if (sub.project === project && sub.session === session) return sub as SessionCardData;
      }
      return undefined;
    },
    [subscriptions],
  );

  // Build full card data for a supervised session from the live subscription
  // (subscriptionStore — the single worker-liveness source; the divergent
  // /api/session-status poll is gone). A session with no live subscription, or a
  // status gone stale past 15 min, reads 'unknown' (gray); past 2 min it dims.
  const cardDataFor = useCallback(
    (s: SupervisedSession): SessionCardData => {
      const matched = findSubscription(s.project, s.session);
      const matchedAge = typeof matched?.lastUpdate === 'number' ? Date.now() - matched.lastUpdate : Infinity;
      const fresh = !!(matched?.status && matched.status !== 'unknown' && matchedAge <= 15 * 60_000);
      // Fall back to the fleet read-model for daemon-spawned pool workers, which
      // don't publish subscription WS status (else they'd be 'unknown' → hidden).
      const fleetEntry = fleetByProject[fleetKey(s.project, s.session)];
      const fleetStatus = fleetStateToStatus(fleetEntry?.state);
      const status = (fresh ? matched!.status : fleetStatus) as SessionCardData['status'];
      const serverId = matched?.serverId || s.serverId || activeId || 'local';
      // Dim (not gray) once past the short window; only a live match can dim.
      const stale = fresh ? matchedAge > 120_000 : false;
      return {
        serverId,
        project: s.project,
        session: s.session,
        claudeSessionId: matched?.claudeSessionId,
        status,
        lastUpdate: matched?.lastUpdate ?? fleetEntry?.lastActivity ?? Date.now(),
        contextPercent: matched?.contextPercent,
        stale,
      };
    },
    [findSubscription, activeId, fleetByProject],
  );

  // Navigate: mirror the Watching panel — update local session state for
  // same-server rows (the card's click side-effects handle terminal/browser).
  const handleNavigate = useCallback(
    (sub: SessionCardData) => {
      if (sub.serverId && activeId && sub.serverId !== activeId) return; // cross-server — don't switch active
      const target = sessions.find((x) => x.project === sub.project && x.name === sub.session);
      if (target) setCurrentSession(target);
      onNavigate?.(sub.serverId ?? activeId ?? '', sub.project, sub.session);
    },
    [sessions, setCurrentSession, onNavigate, activeId],
  );

  // Stop supervising (or, defensively, start) — DELETE/POST the supervised set
  // then refresh. In this panel every card is supervised, so this removes it.
  const handleToggleSupervise = useCallback(
    async (sub: SessionCardData, next: boolean) => {
      const mc = (window as any).mc;
      const path = '/api/supervisor/supervised';
      const body = next
        ? { project: sub.project, session: sub.session, source: 'manual' }
        : { project: sub.project, session: sub.session };
      const method = next ? 'POST' : 'DELETE';
      if (mc?.invokeOnServer) {
        await mc.invokeOnServer(serverScope, { path, method, body });
      } else {
        await fetch(path, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => {});
      }
      void loadSupervised(serverScope);
    },
    [serverScope, loadSupervised],
  );

  return (
    <div className="border-b border-gray-200 dark:border-gray-700">
      {/* Header — collapse toggle for the project tree. */}
      <div className="flex items-center">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex-1 flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <span>Bridge</span>
          <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">{byProject.length}</span>
          <svg className={`w-3 h-3 ml-auto text-gray-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
        {onOpenSupervisorView && (
          <button
            onClick={onOpenSupervisorView}
            className="px-2 py-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Open Supervisor view"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v6a2 2 0 002 2h6a2 2 0 002-2v-4M14 4h4m0 0v4m0-4L10 10" />
            </svg>
          </button>
        )}
      </div>

      {/* Body */}
      {collapsed ? null : supervisorState === 'none' ? (
        // Unconfigured supervisor (first run): the onboarding sets project+session
        // and starts the role. Once configured the unified project tree shows even
        // if the supervisor process is stopped — it's the project INDEX, not the
        // supervisor dashboard. (Restart lives on the header ▶ button.)
        <div className="pb-2">
          <SupervisorOnboarding
            serverId={serverScope}
            state={supervisorState}
            lastSession={config?.supervisorSession}
          />
        </div>
      ) : (
        <div className="px-2 pb-2">
          {byProject.length === 0 ? (
            <div className="px-2 py-4 text-xs text-gray-500 dark:text-gray-400 text-center">
              No projects yet — add one below
            </div>
          ) : (
            orderedProjects.map(({ project, sessions: projSessions, escalationCount }, i) => {
              const cards = projSessions.map((s) => cardDataFor(s));
              // Combined per-project health: reduce every card's status to one.
              const combined = combineCardStatus(cards.map((c) => c.status));
              // Visible sessions = those NOT hidden by the gray-declutter filter
              // below (gray worker lanes are dropped; orchestrator/role sessions
              // always show). The row count must match what's actually listed.
              const isVisibleSession = (s: SupervisedSession, idx: number) =>
                isOrchestratorSession(s.session) || cards[idx].status !== 'unknown';
              const visibleCount = projSessions.filter(isVisibleSession).length;
              const projName = projectLabels[project] ?? (project.split('/').filter(Boolean).pop() ?? project);
              const isActive = activeProject === project;
              return (
                <div key={project} className={i > 0 ? 'mt-2' : ''}>
                  {/* Per-project row: click the name → activate the Bridge for this
                      project; the chevron collapses its sessions. Escalation badge
                      (red) + coordinator dot ride the row; active row gets a ring. */}
                  <div
                    data-testid="supervisor-project-header"
                    data-project={project}
                    data-combined-status={combined}
                    data-active={isActive}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/x-mc-project', project); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-mc-project')) e.preventDefault(); }}
                    onDrop={(e) => {
                      const drag = e.dataTransfer.getData('text/x-mc-project');
                      if (drag && drag !== project) { e.preventDefault(); reorderProjects(orderedProjects.map((p) => p.project), drag, project); }
                    }}
                    className={`group w-full flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium text-gray-800 dark:text-gray-100 ${projectHeaderBg(combined)} ${isActive ? 'ring-2 ring-accent-500' : ''}`}
                  >
                    <button
                      type="button"
                      data-bridge-project={project}
                      onClick={() => handleSelectProject(project)}
                      title={`Open ${projName} in the Bridge`}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left"
                    >
                      <span className="flex-shrink-0">
                        <ClaudePixAvatar status={combined} />
                      </span>
                      {/* Orchestrator level dot (replaces the old coordinator dot) —
                          colored by level with an outline; hover shows the level. */}
                      <OrchestratorLevelBadge project={project} />
                      <span className="truncate" title={project}>{projName}</span>
                      {escalationCount > 0 && (
                        <span data-testid="supervisor-project-badge" className="shrink-0 text-3xs font-bold text-danger-600 dark:text-danger-400">
                          ▲{escalationCount > 99 ? '99+' : escalationCount}
                        </span>
                      )}
                      <span className="text-gray-500 dark:text-gray-400 font-normal">{visibleCount}</span>
                    </button>
                    <button
                      type="button"
                      data-testid="supervisor-project-remove"
                      title={`Remove ${projName} from the Bridge`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Remove "${projName}" from the Bridge?\n\nStops watching + supervising its sessions; files on disk are untouched.`)) {
                          void handleRemoveProjectRow(project);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded text-gray-500 hover:text-danger-600"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                  {/* Per-project session cards removed (option 2): the Bridge tree is now
                      a pure project index. Live sessions are read in the Watching panel and
                      the Bridge Workers tab; the count badge on the row remains the at-a-
                      glance "N sessions" read. */}
                </div>
              );
            })
          )}

          {/* Detected (live-but-unwatched) projects — one click to watch+supervise. */}
          {detectedProjects.length > 0 && (
            <div className="mt-2 pt-1 border-t border-gray-200 dark:border-gray-700">
              <div className="px-2 text-3xs uppercase tracking-wide text-gray-400 dark:text-gray-500">detected</div>
              {detectedProjects.map((p) => (
                <button
                  key={p}
                  type="button"
                  data-testid="supervisor-detected"
                  onClick={() => void handleAddProject(p)}
                  title={`Watch + supervise ${p}`}
                  className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full border border-dashed border-gray-400 shrink-0" aria-hidden="true" />
                  <span className="flex-1 min-w-0 truncate text-left">{p.split('/').filter(Boolean).pop() ?? p}</span>
                  <span className="shrink-0 text-3xs text-accent-600 dark:text-accent-400">watch+</span>
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            data-testid="supervisor-add-project"
            onClick={() => setAddOpen(true)}
            className="mt-2 w-full flex items-center justify-center gap-1 px-2 py-1 text-xs text-accent-600 dark:text-accent-400 border border-dashed border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            Add project
          </button>
        </div>
      )}

      {addOpen && (
        <AddProjectDialog
          servers={servers}
          defaultServerId={servers.find((s) => s.id === serverScope)?.id ?? localServerOf(servers)?.id ?? servers[0]?.id ?? serverScope}
          onSubmit={async (_sid, path) => { await handleAddProject(path); }}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
};
