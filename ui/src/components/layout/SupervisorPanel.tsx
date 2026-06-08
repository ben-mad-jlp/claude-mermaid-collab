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
 * Full card data (context %, elapsed, serverId) is merged from the Watching
 * feed (`useSubscriptionStore`) when a matching subscription exists; otherwise
 * we fall back to a polled persisted status (`/api/session-status`).
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  useSupervisorStore,
  type SupervisedSession,
} from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useServers } from '@/contexts/ServerContext';
import { ServerIcon } from '@/components/ServerIcon';
import { SessionCard, ClaudePixAvatar, activateSessionCard, useElapsed, type SessionCardData } from '@/components/layout/SessionCard';
import { SupervisorOnboarding } from '@/components/supervisor/SupervisorOnboarding';
import { useUIStore } from '@/stores/uiStore';
import { selectOpenEscalationsByProject } from '@/components/supervisor/bridge/escalationSelectors';
import { AddProjectDialog } from '@/components/dialogs';

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

/**
 * RoleConsoleCard — an orchestration role's own status card (steward / supervisor):
 * status-colored body, the session name, a live elapsed badge, the dancing-Claude
 * avatar, and click→open-its-tmux console. These roles aren't supervised workers,
 * so this card is the in-app way to view their session.
 */
const RoleConsoleCard: React.FC<{ card: SessionCardData; serverLabel?: string; title?: string; testid?: string; trailing?: React.ReactNode }> = ({ card, serverLabel, title, testid, trailing }) => {
  const elapsed = useElapsed(card.lastUpdate, card.status);
  const statusBg =
    card.status === 'permission'
      ? 'bg-danger-300 hover:bg-danger-400 border border-danger-500'
      : card.status === 'active'
        ? 'card-pulse-amber border border-warning-400'
        : card.status === 'waiting'
          ? 'bg-success-300 hover:bg-success-400 border border-success-500'
          : 'bg-gray-200 hover:bg-gray-300 border border-gray-300';
  return (
    <div className="flex items-center gap-1">
      <div
        data-testid={testid ?? 'supervisor-card'}
        onClick={() => void activateSessionCard(card, serverLabel)}
        title={title ?? "Open the supervisor's tmux console"}
        className={`relative flex-1 flex items-center gap-2 pl-3 pr-2 py-1 rounded text-sm cursor-pointer transition-colors min-w-0 overflow-hidden ${statusBg}`}
      >
        <div className="flex-1 min-w-0 flex items-center gap-1">
          <span className="text-xs text-black truncate">{card.session}</span>
          {elapsed && <span className="text-3xs text-black tabular-nums ml-auto">{elapsed}</span>}
        </div>
      </div>
      {trailing}
      <ClaudePixAvatar status={card.status} />
    </div>
  );
};

/** Small on/off toggle switch (the steward's "auto" gate, inline in its row). */
const AutoToggle: React.FC<{ on: boolean; onChange: (on: boolean) => void; title?: string }> = ({ on, onChange, title }) => (
  <button
    type="button"
    data-testid="steward-auto-toggle"
    data-on={on}
    role="switch"
    aria-checked={on}
    title={title}
    onClick={() => onChange(!on)}
    className="inline-flex items-center gap-1 shrink-0"
  >
    <span className="text-3xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">auto</span>
    <span className={`relative inline-block w-7 h-4 rounded-full transition-colors ${on ? 'bg-success-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
      <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-3' : ''}`} />
    </span>
  </button>
);

/** Start button shown in place of a role card when the role isn't running. */
const RoleStartButton: React.FC<{ label: string; onStart: () => void; disabled?: boolean; busy?: boolean }> = ({ label, onStart, disabled, busy }) => (
  <button
    type="button"
    data-testid={`start-${label.toLowerCase()}`}
    onClick={onStart}
    disabled={disabled || busy}
    className="w-full py-1 px-3 text-2xs font-semibold rounded bg-info-600 hover:bg-info-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
  >
    {busy ? `Starting ${label}…` : `Start ${label}`}
  </button>
);

export const SupervisorPanel: React.FC<SupervisorPanelProps> = ({ currentProject, currentSession, onNavigate, onOpenSupervisorView }) => {
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
    loadEscalations,
    loadConfig,
    loadLiveness,
  } = useSupervisorStore();

  // Unified Bridge tree (design-tabbed-bridge PIVOT): the watched-project set is
  // the project index; escalation counts + coordinator state badge each row;
  // clicking a row drives the Bridge. watch === supervise (add/remove couples).
  const stewardLiveness = useSupervisorStore((s) => s.stewardLiveness);
  const loadStewardIdentity = useSupervisorStore((s) => s.loadStewardIdentity);
  const setStewardMode = useSupervisorStore((s) => s.setStewardMode);
  const startRole = useSupervisorStore((s) => s.startRole);
  const watchedProjects = useSupervisorStore((s) => s.watchedProjects);
  const coordinatorByProject = useSupervisorStore((s) => s.coordinatorByProject);
  const escalations = useSupervisorStore((s) => s.escalations);
  const loadProjects = useSupervisorStore((s) => s.loadProjects);
  const loadCoordinator = useSupervisorStore((s) => s.loadCoordinator);
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
  const collapsedProjects = useUIStore((s) => s.supervisorCollapsedProjects);
  const toggleSupervisorProject = useUIStore((s) => s.toggleSupervisorProject);
  const [collapsed, setCollapsed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // The supervisor's console is now opened by clicking its status card (the
  // SupervisorRoleCard → activateSessionCard), mirroring the steward card.
  // Persisted status source: map keyed `${serverId}:${project}:${session}` -> status.
  // Polled from GET /api/session-status?project= per distinct (serverId, project).
  const [fetchedStatuses, setFetchedStatuses] = useState<Record<string, string>>({});

  // Load supervised sessions / escalations for the active routing server, and
  // refresh on an interval so newly-supervised sessions appear.
  useEffect(() => {
    const refresh = () => {
      void loadSupervised(serverScope);
      void loadEscalations(serverScope);
      // Config + liveness drive the front-door state ('none' / 'crashed' /
      // 'running'); poll them on the same cadence so the panel flips to the
      // Restart front door within the staleness window when the supervisor dies.
      void loadConfig(serverScope);
      void loadLiveness(serverScope);
      void loadStewardIdentity(serverScope);
      // Unified tree: the watched-project set + per-project coordinator dots.
      void loadProjects(serverScope);
    };
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [serverScope, loadSupervised, loadEscalations, loadConfig, loadLiveness, loadStewardIdentity, loadProjects]);

  // Coordinator state for every watched project (drives the per-row ●/○ dot).
  const watchedList = Array.isArray(watchedProjects) ? watchedProjects : [];
  useEffect(() => {
    watchedList.forEach((w) => w.project && void loadCoordinator(serverScope, w.project));
  }, [serverScope, watchedList, loadCoordinator]);

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

  // The supervisor's own status card (mirrors the steward card): live status off
  // its tmux session's subscription, falling back to the liveness heartbeat.
  // Click → open its console. Resolve a REAL server id for routing (the terminal
  // WS won't connect through the 'local' sentinel — same reasoning as
  // handleOpenConsole).
  const supervisorProjectName = liveness?.identity?.project ?? config?.supervisorProject ?? '';
  const supervisorSessionName = liveness?.identity?.session ?? config?.supervisorSession ?? '';
  const consoleServerId = useMemo(() => {
    const localServer =
      servers.find((s) => s.source === 'local') ??
      servers.find((s) => s.host === '127.0.0.1' || s.host === 'localhost');
    return (activeId && servers.some((s) => s.id === activeId))
      ? activeId
      : localServer?.id ?? servers[0]?.id ?? serverScope;
  }, [servers, activeId, serverScope]);
  const supervisorSub = useMemo(
    () => Object.values(subscriptions).find((s) => s.project === supervisorProjectName && s.session === supervisorSessionName),
    [subscriptions, supervisorProjectName, supervisorSessionName],
  );
  const supervisorCard: SessionCardData = useMemo(
    () => ({
      serverId: supervisorSub?.serverId || consoleServerId,
      project: supervisorProjectName,
      session: supervisorSessionName,
      status:
        supervisorSub?.status && supervisorSub.status !== 'unknown'
          ? supervisorSub.status
          : liveness?.running
            ? 'waiting'
            : 'unknown',
      lastUpdate: supervisorSub?.lastUpdate ?? liveness?.identity?.updatedAt ?? Date.now(),
      contextPercent: supervisorSub?.contextPercent,
    }),
    [supervisorSub, consoleServerId, supervisorProjectName, supervisorSessionName, liveness],
  );

  // Steward card data (mirrors the supervisor card): live status off the steward
  // session's subscription, falling back to its liveness heartbeat. The steward
  // runs in a fixed global workspace resolved from the server steward-config.
  const [stewardWs, setStewardWs] = useState<{ project: string; session: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mc = (window as any).mc;
        const res = mc?.invokeOnServer
          ? await mc.invokeOnServer(serverScope, { path: '/api/supervisor/steward-config', method: 'GET' })
          : { body: await (await fetch('/api/supervisor/steward-config')).json() };
        const cfg = res?.body ?? {};
        if (!cancelled && cfg.stewardProject && cfg.stewardSession) {
          setStewardWs({ project: cfg.stewardProject, session: cfg.stewardSession });
        }
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [serverScope]);

  const stewardRunning = !!stewardLiveness?.running;
  const stewardSessionName = stewardLiveness?.identity?.session ?? stewardWs?.session ?? '';
  const stewardProjectName = stewardLiveness?.identity?.project ?? stewardWs?.project ?? '';
  const stewardAutoOn = (stewardLiveness?.mode ?? (stewardLiveness?.switchedOn !== false ? 'auto' : 'off')) !== 'off';
  const stewardSub = useMemo(
    () => Object.values(subscriptions).find((s) => s.project === stewardProjectName && s.session === stewardSessionName),
    [subscriptions, stewardProjectName, stewardSessionName],
  );
  const stewardCard: SessionCardData = useMemo(
    () => ({
      serverId: stewardSub?.serverId || stewardLiveness?.identity?.serverId || consoleServerId,
      project: stewardProjectName,
      session: stewardSessionName,
      status:
        stewardSub?.status && stewardSub.status !== 'unknown'
          ? stewardSub.status
          : stewardLiveness?.running
            ? 'waiting'
            : 'unknown',
      lastUpdate: stewardSub?.lastUpdate ?? stewardLiveness?.identity?.updatedAt ?? Date.now(),
      contextPercent: stewardSub?.contextPercent,
    }),
    [stewardSub, consoleServerId, stewardProjectName, stewardSessionName, stewardLiveness],
  );

  // Start handlers (roles are normally always-running; the Start button shows
  // only when a role isn't live). Steward launches with Remote Control so it's
  // reachable from the Claude app, mirroring the old GlobalRoleSwitches path.
  const [startingRole, setStartingRole] = useState<'steward' | 'supervisor' | null>(null);
  const startSteward = async () => {
    if (!stewardWs) return;
    setStartingRole('steward');
    try {
      const r = await startRole(serverScope, 'steward', stewardWs.project, stewardWs.session, true);
      if (!r.started) alert(`Steward failed to start: ${r.reason ?? 'unknown'}`);
    } finally {
      setStartingRole(null);
      void loadStewardIdentity(serverScope);
    }
  };
  const startSupervisor = async () => {
    if (!hasConfig) return;
    setStartingRole('supervisor');
    try {
      await startRole(serverScope, 'supervisor', config!.supervisorProject, config!.supervisorSession);
    } finally {
      setStartingRole(null);
      void loadLiveness(serverScope);
    }
  };

  // The global role workspaces (~/.mermaid-collab/supervisor, .../steward) are not
  // user projects — never list them in the Bridge tree.
  const isRoleWorkspace = (p: string) => /\/\.mermaid-collab\/(supervisor|steward)\/?$/.test(p);

  // Unified Bridge tree rows: the union of WATCHED projects (the index) and any
  // project that has supervised sessions, each carrying its sessions + the
  // per-row metadata (open-escalation count from the single roll-up path, the
  // coordinator dot). Sorted urgency-first: red (most escalations) → quiet
  // (alphabetical), so "which project needs you" floats to the top.
  const escalationCounts = useMemo(() => selectOpenEscalationsByProject(escalations), [escalations]);
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
        escalationCount: escalationCounts[project] ?? 0,
        coordinatorRunning: !!coordinatorByProject[project],
      }))
      .sort((a, b) => {
        if ((b.escalationCount > 0 ? 1 : 0) !== (a.escalationCount > 0 ? 1 : 0)) {
          return (b.escalationCount > 0 ? 1 : 0) - (a.escalationCount > 0 ? 1 : 0);
        }
        if (a.escalationCount !== b.escalationCount) return b.escalationCount - a.escalationCount;
        return a.project.localeCompare(b.project);
      });
  }, [supervised, watchedList, escalationCounts, coordinatorByProject]);

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

  // Distinct (activeId, project) pairs from supervised sessions — the unit of
  // the per-project session-status API.
  const distinctPairs = useMemo(() => {
    const map = new Map<string, { serverId: string; project: string }>();
    for (const s of supervised) {
      map.set(`${activeId}|${s.project}`, { serverId: activeId ?? '', project: s.project });
    }
    return Array.from(map.values()).sort((a, b) =>
      `${a.serverId}|${a.project}`.localeCompare(`${b.serverId}|${b.project}`),
    );
  }, [activeId, supervised]);
  // Stable primitive dependency so the poll effect re-runs only when the
  // actual set of (serverId, project) pairs changes, not on every render.
  const distinctPairsKey = useMemo(
    () => distinctPairs.map((p) => `${p.serverId}|${p.project}`).join('\n'),
    [distinctPairs],
  );

  // Poll persisted statuses from GET /api/session-status?project= for each
  // distinct (serverId, project). Server-aware via mc.invokeOnServer when the
  // desktop bridge is present, otherwise plain fetch. Rows older than 120s are
  // treated as 'unknown' (stale). Live WS events layer on top of this below.
  useEffect(() => {
    const pairs = distinctPairs;
    if (pairs.length === 0) {
      setFetchedStatuses({});
      return;
    }

    let cancelled = false;
    const STALE_MS = 120_000;

    const fetchOne = async (
      serverId: string,
      project: string,
    ): Promise<Array<{ project: string; session: string; status: string; updatedAt?: number }>> => {
      const path = `/api/session-status?project=${encodeURIComponent(project)}`;
      const mc = (window as any).mc;
      try {
        if (mc?.invokeOnServer) {
          const res = await mc.invokeOnServer(serverId, { path, method: 'GET' });
          if (res?.ok && res.body && typeof res.body === 'object') {
            return (res.body as any).statuses ?? [];
          }
          return [];
        }
        const r = await fetch(path);
        if (!r.ok) return [];
        const data = await r.json();
        return data.statuses ?? [];
      } catch {
        return [];
      }
    };

    const poll = async () => {
      const now = Date.now();
      const results = await Promise.all(pairs.map((p) => fetchOne(p.serverId, p.project)));
      if (cancelled) return;
      const map: Record<string, string> = {};
      pairs.forEach((p, i) => {
        for (const row of results[i]) {
          const stale = typeof row.updatedAt === 'number' && now - row.updatedAt > STALE_MS;
          // Keyed by project:session (serverId-agnostic) so lookups don't depend
          // on which server we routed through — supervised rows may carry a
          // different/blank serverId than the active one.
          const key = `${row.project}:${row.session}`;
          map[key] = stale ? 'unknown' : row.status;
        }
      });
      if (!cancelled) setFetchedStatuses(map);
    };

    void poll();
    const id = setInterval(() => void poll(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [distinctPairsKey]);

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

  // Build full card data for a supervised session: prefer the live subscription
  // entry, fall back to the polled persisted status. Resolve a serverId for
  // per-server routing from the subscription, the supervised record, or active.
  const cardDataFor = useCallback(
    (s: SupervisedSession): SessionCardData => {
      const matched = findSubscription(s.project, s.session);
      const status = (matched?.status && matched.status !== 'unknown'
        ? matched.status
        : (fetchedStatuses[`${s.project}:${s.session}`] as SessionCardData['status'])) ?? 'unknown';
      const serverId = matched?.serverId || s.serverId || activeId || 'local';
      return {
        serverId,
        project: s.project,
        session: s.session,
        claudeSessionId: matched?.claudeSessionId,
        status,
        lastUpdate: matched?.lastUpdate ?? Date.now(),
        contextPercent: matched?.contextPercent,
      };
    },
    [findSubscription, fetchedStatuses, activeId],
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
          {/* Role cards — Steward above Supervisor. Each is click→tmux-console;
              the steward row carries an inline "auto" switch (between the card
              and the dancing Claude). A role that isn't running shows a Start
              button in place of its card. */}
          <div className="mb-2 space-y-0.5">
            {/* Steward */}
            {stewardRunning && stewardSessionName ? (
              <RoleConsoleCard
                testid="steward-card"
                title="Open the steward's tmux console"
                card={stewardCard}
                serverLabel={serverLabelById.get(stewardCard.serverId)}
                trailing={
                  <AutoToggle
                    on={stewardAutoOn}
                    onChange={(on) => void setStewardMode(serverScope, on ? 'auto' : 'off')}
                    title={stewardAutoOn ? 'Auto ON — steward auto-answers escalations. Click to turn off.' : 'Auto OFF — escalations wait for you. Click to turn on.'}
                  />
                }
              />
            ) : (
              <RoleStartButton label="Steward" onStart={() => void startSteward()} disabled={!stewardWs} busy={startingRole === 'steward'} />
            )}
            {/* Supervisor */}
            {supervisorState === 'running' && supervisorSessionName ? (
              <RoleConsoleCard card={supervisorCard} serverLabel={serverLabelById.get(supervisorCard.serverId)} />
            ) : (
              <RoleStartButton label="Supervisor" onStart={() => void startSupervisor()} disabled={!hasConfig} busy={startingRole === 'supervisor'} />
            )}
          </div>
          {byProject.length === 0 ? (
            <div className="px-2 py-4 text-xs text-gray-500 dark:text-gray-400 text-center">
              No projects yet — add one below
            </div>
          ) : (
            byProject.map(({ project, sessions: projSessions, escalationCount, coordinatorRunning }, i) => {
              const cards = projSessions.map((s) => cardDataFor(s));
              // Combined per-project health: reduce every card's status to one.
              const combined = combineCardStatus(cards.map((c) => c.status));
              const isProjCollapsed = !!collapsedProjects[project];
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
                    aria-expanded={!isProjCollapsed}
                    className={`group w-full flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium text-gray-800 dark:text-gray-100 ${projectHeaderBg(combined)} ${isActive ? 'ring-2 ring-accent-500' : ''}`}
                  >
                    <button
                      type="button"
                      aria-label="Toggle sessions"
                      aria-expanded={!isProjCollapsed}
                      onClick={() => toggleSupervisorProject(project)}
                      className="shrink-0 text-gray-500"
                    >
                      <svg className={`w-3 h-3 transition-transform ${isProjCollapsed ? '-rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectProject(project)}
                      title={`Open ${projName} in the Bridge`}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left"
                    >
                      <span className="flex-shrink-0">
                        <ClaudePixAvatar status={combined} />
                      </span>
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${coordinatorRunning ? 'bg-success-500' : 'border border-gray-400 dark:border-gray-500'}`}
                        title={coordinatorRunning ? 'Coordinator running' : 'Coordinator off'}
                        aria-hidden="true"
                      />
                      <span className="truncate" title={project}>{projName}</span>
                      {escalationCount > 0 && (
                        <span data-testid="supervisor-project-badge" className="shrink-0 text-3xs font-bold text-danger-600 dark:text-danger-400">
                          ▲{escalationCount > 99 ? '99+' : escalationCount}
                        </span>
                      )}
                      <span className="text-gray-500 dark:text-gray-400 font-normal">{projSessions.length}</span>
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

                  {/* Supervised sessions — same card as Watching. Hidden when the
                      project group is collapsed. */}
                  {!isProjCollapsed && projSessions.length > 0 && (
                    <div className="space-y-1 mt-1">
                      {projSessions.map((s, idx) => {
                        const card = cards[idx];
                        const isSelected =
                          !!storeCurrentSession &&
                          storeCurrentSession.project === s.project &&
                          storeCurrentSession.name === s.session;
                        return (
                          <SessionCard
                            key={s.session}
                            sub={card}
                            serverLabel={serverLabelById.get(card.serverId) ?? undefined}
                            serverIcon={serverIconById.get(card.serverId) ?? activeServerIcon}
                            onNavigate={handleNavigate}
                            isSelected={isSelected}
                            supervised
                            onToggleSupervise={handleToggleSupervise}
                          />
                        );
                      })}
                    </div>
                  )}
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
