import { create } from 'zustand';
import type { SessionTodo } from '@/types/sessionTodo';

/**
 * Supervisor store (v2 global model).
 *
 * In v2 the supervisor surface is global rather than scoped to a single
 * supervisor session. The app tracks a flat set of watched projects, a roadmap
 * keyed by project, and a flat list of escalations. All of
 * these live authoritatively on the server behind the `/api/supervisor/*` REST
 * surface; this store mirrors them into the renderer.
 *
 * SERVER IS SOURCE OF TRUTH. localStorage is used purely as a cache so the panel
 * paints instantly on app reopen before the corresponding `load*` call re-fetches
 * from the server and overwrites the cache wholesale. Mutations are applied
 * locally only after the server confirms (res.ok); on failure prior state is left
 * untouched.
 *
 * The `serverId` threaded through every action is the active server's id and is
 * used solely for invoke routing — the data model itself is not keyed by server.
 *
 * Persistence is manual (localStorage.setItem on every mutation) rather than via
 * zustand's persist middleware, matching `subscriptionStore.ts`.
 */
export interface WatchedProject {
  project: string;
  addedAt: number;
}

export interface RoadmapItem {
  id: string;
  project: string;
  title: string;
  description?: string | null;
  status: string;
  ord: number;
  parentId?: string | null;
  dependsOn?: string[];
  sessionName?: string | null;
  blueprintId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AuditEntry {
  id: string;
  ts: number;
  kind: string;
  project: string;
  session: string;
  detail: string | null;
  serverId: string;
}

export interface EscalationOption {
  id: string;
  label: string;
  detail?: string;
}

export interface Escalation {
  id: string;
  project: string;
  session: string;
  kind: string;
  questionText: string;
  status: string;
  createdAt: number;
  resolvedAt?: number | null;
  // ED1: structured decision options. Null/absent for a plain question, in which
  // case the UI renders the legacy Jump/Resolve card instead of a decision card.
  options?: EscalationOption[] | null;
  recommended?: string | null; // option id the worker recommends, if any
  // BR-4: optional rich JSON-render decision spec (server-validated closed
  // catalog). Carried opaquely here; the focal DecisionCard re-validates it via
  // focal/catalog.parseUiSpec before rendering. Absent/null for plain decisions.
  ui?: unknown;
  // Steward routing (Steward P3): server-decided destination at create-time
  // ('human' | 'steward'). When 'steward', the steward triaged it and routed it
  // on to the human — the provenance tag distinguishes triaged-and-deferred from
  // never-seen. Absent on payloads written before the field existed → 'human'.
  routedTo?: string;
  /** How many times the steward auto-attempted this escalation (thrash guard). */
  stewardAttempts?: number;
}

/** Machine-checkable requirement target (mirrors server RequirementSpec). */
export interface RequirementSpec {
  metric: string;
  op: string;
  target: number | string;
}

/** A requirement promise — a requirement-kind decision record. */
export interface Requirement {
  id: string;
  project: string;
  epicId: string | null;
  kind: string;
  status: string;
  title: string;
  rationale?: string | null;
  spec: RequirementSpec | null;
  supersededBy?: string | null;
  linkedTodos?: string[];
  approvedBy?: string | null;
  createdAt: number;
  updatedAt: number;
}

export type CoverageState = 'covered' | 'partial' | 'uncovered';

export interface ObjectCoverage {
  objectId: string;
  name: string;
  typeId: string;
  state: CoverageState;
  todoCount: number;
  doneCount: number;
  /** Content-hash drift: the object's proof went stale and wasn't re-authored
   *  (todo 9fd5fce8). Spec Sheet shows a stale glyph; the coverage card goes amber. */
  stale: boolean;
}

export interface CoverageRollup {
  total: number;
  covered: number;
  partial: number;
  uncovered: number;
  /** Count of stale (drifted) objects. */
  stale: number;
  byObject: ObjectCoverage[];
}

export interface SystemObjectNode {
  id: string;
  typeId: string;
  typeVersion: number;
  parentObjectId: string | null;
  qty: number;
  name: string;
  attributes: Record<string, unknown>;
  currentRevisionId: string | null;
}

export interface BomLine {
  typeId: string;
  totalQty: number;
}

export interface SupervisedSession {
  project: string;
  session: string;
  source?: string;
  addedAt?: number;
  serverId?: string;
}

const PROJECTS_KEY = 'supervisor-projects';
const ROADMAP_KEY = 'supervisor-roadmap';
const TODOS_KEY = 'supervisor-todos-by-project';
const ESCALATIONS_KEY = 'supervisor-escalations';
const SUPERVISED_KEY = 'supervisor-supervised';
const SUPERVISOR_CONFIG_KEY = 'supervisor-config';
const REQUIREMENTS_KEY = 'supervisor-requirements-by-project';

export interface SupervisorConfig {
  supervisorProject: string;
  supervisorSession: string;
}

/**
 * Liveness of the supervisor process, derived from /api/supervisor/identity.
 * `running` is the server's freshness verdict (updatedAt within the staleness
 * window); `stale` is its complement. When no supervisor has ever registered,
 * `identity` is null and `running` is false.
 */
export interface SupervisorLiveness {
  identity: { project: string; session: string; updatedAt: number; serverId?: string } | null;
  running: boolean;
  stale: boolean;
  ageMs: number | null;
}

/**
 * Liveness of the STEWARD process (Steward P3), derived from
 * /api/supervisor/steward-identity. Same shape as SupervisorLiveness plus the
 * scary observability metric the panel leads with: `overrideAccepts` — how many
 * todos the steward force-accepted past the mechanical gate.
 */
export interface StewardLiveness {
  identity: { project: string; session: string; updatedAt: number; serverId?: string } | null;
  running: boolean;
  stale: boolean;
  ageMs: number | null;
  overrideAccepts: number;
  /** Live human ON/OFF switch state (persistent; default ON when absent). */
  switchedOn?: boolean;
}

interface InvokeResult {
  ok: boolean;
  status: number;
  body: any;
}

/**
 * Route a REST call to a specific server. In the desktop app the preload bridge
 * (`window.mc.invokeOnServer`) proxies to the correct server process; in a plain
 * browser tab we fall back to a same-origin `fetch`. The DELETE body must ride
 * along in the fetch fallback (it carries the membership identity to remove).
 */
async function invoke(serverId: string, path: string, method: string, body?: any): Promise<InvokeResult | null> {
  const mc = (window as any).mc;
  if (mc?.invokeOnServer) {
    return mc.invokeOnServer(serverId, { path, method, body }).catch(() => null);
  }
  try {
    const r = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
  } catch {
    return null;
  }
}

function hydrate<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface SupervisorState {
  watchedProjects: WatchedProject[];
  roadmapByProject: Record<string, RoadmapItem[]>;
  todosByProject: Record<string, SessionTodo[]>;
  escalations: Escalation[];
  supervised: SupervisedSession[];
  config: SupervisorConfig | null;
  liveness: SupervisorLiveness | null;
  loadLiveness: (serverId: string) => Promise<void>;
  // Steward P3: independent steward role liveness + the override-accept count.
  stewardLiveness: StewardLiveness | null;
  loadStewardIdentity: (serverId: string, project?: string) => Promise<void>;
  auditByProject: Record<string, AuditEntry[]>;
  loadAudit: (serverId: string, project: string, kind?: string) => Promise<void>;
  loadSupervised: (serverId: string) => Promise<void>;
  setSupervisedLocal: (session: SupervisedSession, supervised: boolean) => void;
  loadProjects: (serverId: string) => Promise<void>;
  addProject: (serverId: string, project: string) => Promise<void>;
  removeProject: (serverId: string, project: string) => Promise<void>;
  loadRoadmap: (serverId: string, project: string) => Promise<void>;
  loadProjectTodos: (serverId: string, project: string) => Promise<void>;
  promoteTodo: (serverId: string, project: string, id: string, status: string) => Promise<void>;
  coordinatorByProject: Record<string, boolean>;
  loadCoordinator: (serverId: string, project: string) => Promise<void>;
  setCoordinator: (serverId: string, project: string, action: 'start' | 'stop') => Promise<void>;
  /** Apply a live coordinator_status WS broadcast (af49309a) so the pill flips
   *  without waiting for a re-fetch. */
  applyCoordinatorStatus: (project: string, running: boolean) => void;
  /** Start a global LLM role (steward/supervisor) via /api/ide/launch-session —
   *  the ON half of the Bridge role switch. */
  startRole: (
    serverId: string,
    role: 'steward' | 'supervisor',
    project: string,
    session: string,
  ) => Promise<{ started: boolean; reason?: string }>;
  /** Stop a global LLM role: kill its tmux + clear identity (Bridge switch OFF). */
  stopRole: (serverId: string, role: 'steward' | 'supervisor') => Promise<void>;
  loadEscalations: (serverId: string, status?: string) => Promise<void>;
  resolveEscalation: (serverId: string, id: string, status: string) => Promise<void>;
  decideEscalation: (serverId: string, id: string, optionId: string) => Promise<boolean>;
  nudge: (serverId: string, project: string, session: string, text: string) => Promise<boolean>;
  loadConfig: (serverId: string) => Promise<void>;
  saveConfig: (serverId: string, supervisorProject: string, supervisorSession: string) => Promise<void>;
  // SPEC API surface (design-system-object-ui §8). Coverage/objects/bom are live
  // (REST-poll, no WS), kept out of localStorage; requirements are cached so the
  // inbox paints instantly on reopen.
  requirementsByProject: Record<string, Requirement[]>;
  coverageByProject: Record<string, CoverageRollup>;
  systemObjectsByProject: Record<string, SystemObjectNode[]>;
  bomByRoot: Record<string, BomLine[]>;
  loadRequirements: (serverId: string, project: string, opts?: { epicId?: string; status?: string }) => Promise<void>;
  loadCoverage: (serverId: string, project: string) => Promise<void>;
  loadSystemObjects: (serverId: string, project: string) => Promise<void>;
  loadBom: (serverId: string, project: string, rootId: string) => Promise<void>;
  decideRequirement: (
    serverId: string,
    project: string,
    id: string,
    decision: 'approve' | 'reject' | 'edit',
    opts?: { approvedBy?: string; spec?: RequirementSpec; title?: string },
  ) => Promise<boolean>;
  proposeRequirement: (
    serverId: string,
    project: string,
    input: { title: string; spec?: RequirementSpec | null; epicId?: string | null; rationale?: string | null },
  ) => Promise<boolean>;
  /** Satisfy-drag (decision 8ee2469e): create an OBJECT→REQUIREMENT satisfy edge
   *  from a dragged object-linked todo. Pass the todo's `objectRef` as objectId;
   *  a null/absent objectId is rejected (no todo→req edge). Reloads coverage so
   *  the new edge's effect on the SpecCoverage card is reflected. Returns false
   *  on a missing object or a failed request. */
  addSatisfyEdge: (
    serverId: string,
    project: string,
    objectId: string | null | undefined,
    reqId: string,
  ) => Promise<boolean>;
}

export const useSupervisorStore = create<SupervisorState>((set, get) => ({
  watchedProjects: hydrate<WatchedProject[]>(PROJECTS_KEY, []),
  roadmapByProject: hydrate<Record<string, RoadmapItem[]>>(ROADMAP_KEY, {}),
  todosByProject: hydrate<Record<string, SessionTodo[]>>(TODOS_KEY, {}),
  coordinatorByProject: {},
  escalations: hydrate<Escalation[]>(ESCALATIONS_KEY, []),
  supervised: hydrate<SupervisedSession[]>(SUPERVISED_KEY, []),
  config: hydrate<SupervisorConfig | null>(SUPERVISOR_CONFIG_KEY, null),
  liveness: null,
  stewardLiveness: null,
  auditByProject: {},
  requirementsByProject: hydrate<Record<string, Requirement[]>>(REQUIREMENTS_KEY, {}),
  coverageByProject: {},
  systemObjectsByProject: {},
  bomByRoot: {},

  // Poll the supervisor's liveness (heartbeat freshness). The server computes
  // running/stale from how long ago updatedAt last advanced, so the client just
  // mirrors its verdict. Kept out of localStorage — it's a live signal, and a
  // hydrated stale value would falsely read as 'crashed' on first paint.
  loadLiveness: async (serverId) => {
    const res = await invoke(serverId, '/api/supervisor/identity', 'GET');
    if (!res?.ok) return; // keep prior verdict on transient failure
    const b = res.body ?? {};
    set({
      liveness: {
        identity: b.identity ?? null,
        running: !!b.running,
        stale: !!b.stale,
        ageMs: typeof b.ageMs === 'number' ? b.ageMs : null,
      },
    });
  },

  // Steward P3: poll the steward's INDEPENDENT liveness + override-accept count
  // from /api/supervisor/steward-identity (role='steward'). Project-scoped so the
  // server can count the steward's force-accepts in this project. Like liveness,
  // kept out of localStorage — a hydrated stale value would falsely read crashed.
  loadStewardIdentity: async (serverId, project?) => {
    const path = project
      ? `/api/supervisor/steward-identity?project=${encodeURIComponent(project)}`
      : '/api/supervisor/steward-identity';
    const res = await invoke(serverId, path, 'GET');
    if (!res?.ok) return; // keep prior verdict on transient failure
    const b = res.body ?? {};
    set({
      stewardLiveness: {
        identity: b.identity ?? null,
        running: !!b.running,
        stale: !!b.stale,
        ageMs: typeof b.ageMs === 'number' ? b.ageMs : null,
        overrideAccepts: typeof b.overrideAccepts === 'number' ? b.overrideAccepts : 0,
        switchedOn: b.switchedOn !== false, // default ON when the field is absent
      },
    });
  },

  loadAudit: async (serverId, project, kind?) => {
    const qs = new URLSearchParams({ project });
    if (kind) qs.set('kind', kind);
    const res = await invoke(serverId, `/api/supervisor/audit?${qs.toString()}`, 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    set((state) => ({ auditByProject: { ...state.auditByProject, [project]: res.body?.entries ?? [] } }));
  },

  loadSupervised: async (serverId) => {
    const res = await invoke(serverId, '/api/supervisor/supervised', 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    // Stamp the serverId we fetched FROM as authoritative. Coordinator-spawned
    // rows are persisted with serverId='' (the backend daemon has no serverId —
    // it's a client/desktop concept), so without this the Supervisor cards show
    // the wrong server icon and clicking routes to the active server instead of
    // the one this session actually lives on. The fetching server is, by
    // definition, the session's server.
    const raw: SupervisedSession[] = res.body?.supervised ?? [];
    const supervised: SupervisedSession[] = raw.map((s) => ({
      ...s,
      serverId: s.serverId || serverId,
    }));
    localStorage.setItem(SUPERVISED_KEY, JSON.stringify(supervised));
    set({ supervised });
  },

  // Optimistically add/remove a supervised session so the Supervisor panel
  // reflects a toggle immediately, instead of waiting for the next poll/reload.
  // The caller still fires the REST mutation + loadSupervised() to reconcile.
  setSupervisedLocal: (session, supervised) => {
    set((state) => {
      const key = `${session.project}:${session.session}`;
      const without = state.supervised.filter((s) => `${s.project}:${s.session}` !== key);
      const next = supervised
        ? [...without, { ...session, addedAt: session.addedAt ?? Date.now() }]
        : without;
      localStorage.setItem(SUPERVISED_KEY, JSON.stringify(next));
      return { supervised: next };
    });
  },

  loadProjects: async (serverId) => {
    const res = await invoke(serverId, '/api/supervisor/projects', 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    const watchedProjects: WatchedProject[] = res.body?.projects ?? [];
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(watchedProjects));
    set({ watchedProjects });
  },

  addProject: async (serverId, project) => {
    const res = await invoke(serverId, '/api/supervisor/projects', 'POST', { project });
    if (!res?.ok) return; // leave state unchanged on failure
    set((state) => {
      if (state.watchedProjects.some((w) => w.project === project)) return state;
      const watchedProjects = [...state.watchedProjects, { project, addedAt: Date.now() }];
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(watchedProjects));
      return { watchedProjects };
    });
  },

  removeProject: async (serverId, project) => {
    const res = await invoke(serverId, '/api/supervisor/projects', 'DELETE', { project });
    if (!res?.ok) return; // leave state unchanged on failure
    set((state) => {
      const watchedProjects = state.watchedProjects.filter((w) => w.project !== project);
      const roadmapByProject = { ...state.roadmapByProject };
      delete roadmapByProject[project];
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(watchedProjects));
      localStorage.setItem(ROADMAP_KEY, JSON.stringify(roadmapByProject));
      return { watchedProjects, roadmapByProject };
    });
  },

  loadRoadmap: async (serverId, project) => {
    const path = `/api/supervisor/roadmap?project=${encodeURIComponent(project)}`;
    const res = await invoke(serverId, path, 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    set((state) => {
      const roadmapByProject = { ...state.roadmapByProject, [project]: res.body?.items ?? [] };
      localStorage.setItem(ROADMAP_KEY, JSON.stringify(roadmapByProject));
      return { roadmapByProject };
    });
  },

  loadProjectTodos: async (serverId, project) => {
    const path = `/api/supervisor/todos?project=${encodeURIComponent(project)}`;
    const res = await invoke(serverId, path, 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    set((state) => {
      const todosByProject = { ...state.todosByProject, [project]: res.body?.todos ?? [] };
      localStorage.setItem(TODOS_KEY, JSON.stringify(todosByProject));
      return { todosByProject };
    });
  },

  promoteTodo: async (serverId, project, id, status) => {
    const res = await invoke(serverId, '/api/supervisor/todos', 'PATCH', { project, id, status });
    if (!res?.ok) return;
    // Re-fetch the project plan so the change is reflected everywhere.
    await get().loadProjectTodos(serverId, project);
  },

  loadCoordinator: async (serverId, project) => {
    const path = `/api/supervisor/coordinator?project=${encodeURIComponent(project)}`;
    const res = await invoke(serverId, path, 'GET');
    if (!res?.ok) return;
    set((state) => ({
      coordinatorByProject: { ...state.coordinatorByProject, [project]: !!res.body?.running },
    }));
  },

  setCoordinator: async (serverId, project, action) => {
    const res = await invoke(serverId, '/api/supervisor/coordinator', 'POST', { project, action });
    if (!res?.ok) return;
    set((state) => ({
      coordinatorByProject: { ...state.coordinatorByProject, [project]: !!res.body?.running },
    }));
  },

  applyCoordinatorStatus: (project, running) => {
    set((state) => ({
      coordinatorByProject: { ...state.coordinatorByProject, [project]: running },
    }));
  },

  startRole: async (serverId, role, project, session) => {
    const invokeSkill = role === 'steward' ? '/steward' : '/supervisor';
    const body = {
      project,
      session,
      role,
      invokeSkill,
      allowedTools: 'Bash Edit Write Read mcp__plugin_mermaid-collab_mermaid',
    };
    const res = await invoke(serverId, '/api/ide/launch-session', 'POST', body);
    if (!res?.ok) return { started: false, reason: res?.body?.error ?? 'request failed' };
    return { started: res.body?.started !== false, reason: res.body?.reason };
  },

  stopRole: async (serverId, role) => {
    const res = await invoke(serverId, '/api/supervisor/role/stop', 'POST', { role });
    if (!res?.ok) return;
    // Reflect not-running immediately; the next liveness poll confirms.
    if (role === 'steward') {
      set((state) => ({
        stewardLiveness: state.stewardLiveness
          ? { ...state.stewardLiveness, identity: null, running: false }
          : state.stewardLiveness,
      }));
    } else {
      set((state) => ({
        liveness: state.liveness ? { ...state.liveness, running: false } : state.liveness,
      }));
    }
  },

  loadEscalations: async (serverId, status?) => {
    const path = status
      ? `/api/supervisor/escalations?status=${encodeURIComponent(status)}`
      : '/api/supervisor/escalations';
    const res = await invoke(serverId, path, 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    const escalations: Escalation[] = res.body?.escalations ?? [];
    localStorage.setItem(ESCALATIONS_KEY, JSON.stringify(escalations));
    set({ escalations });
  },

  nudge: async (serverId, project, session, text) => {
    const res = await invoke(serverId, '/api/supervisor/nudge', 'POST', { project, session, text });
    return !!res?.ok;
  },

  loadConfig: async (serverId) => {
    const res = await invoke(serverId, '/api/supervisor/config', 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    const config: SupervisorConfig = {
      supervisorProject: res.body?.supervisorProject,
      supervisorSession: res.body?.supervisorSession,
    };
    localStorage.setItem(SUPERVISOR_CONFIG_KEY, JSON.stringify(config));
    set({ config });
  },

  saveConfig: async (serverId, supervisorProject, supervisorSession) => {
    const res = await invoke(serverId, '/api/supervisor/config', 'POST', { supervisorProject, supervisorSession });
    if (!res?.ok) return; // leave state unchanged on failure
    const config: SupervisorConfig = res.body?.supervisorProject
      ? { supervisorProject: res.body.supervisorProject, supervisorSession: res.body.supervisorSession }
      : { supervisorProject, supervisorSession };
    localStorage.setItem(SUPERVISOR_CONFIG_KEY, JSON.stringify(config));
    set({ config });
  },

  resolveEscalation: async (serverId, id, status) => {
    const res = await invoke(serverId, '/api/supervisor/escalations/resolve', 'POST', { id, status });
    if (!res?.ok) return; // leave state unchanged on failure
    set((state) => {
      const escalations = state.escalations.map((e) =>
        e.id === id ? { ...e, status, resolvedAt: Date.now() } : e,
      );
      localStorage.setItem(ESCALATIONS_KEY, JSON.stringify(escalations));
      return { escalations };
    });
  },

  // ── SPEC API surface (design-system-object-ui §8) ─────────────────────────
  // Mirror the load* pattern: GET → keep prior on failure → set keyed by project.

  loadRequirements: async (serverId, project, opts) => {
    const qs = new URLSearchParams({ project });
    if (opts?.epicId !== undefined) qs.set('epicId', opts.epicId);
    if (opts?.status) qs.set('status', opts.status);
    const res = await invoke(serverId, `/api/supervisor/requirements?${qs.toString()}`, 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    set((state) => {
      const requirementsByProject = { ...state.requirementsByProject, [project]: res.body?.requirements ?? [] };
      localStorage.setItem(REQUIREMENTS_KEY, JSON.stringify(requirementsByProject));
      return { requirementsByProject };
    });
  },

  loadCoverage: async (serverId, project) => {
    const res = await invoke(serverId, `/api/supervisor/coverage?project=${encodeURIComponent(project)}`, 'GET');
    if (!res?.ok || !res.body?.coverage) return; // keep prior on failure
    set((state) => ({ coverageByProject: { ...state.coverageByProject, [project]: res.body.coverage } }));
  },

  loadSystemObjects: async (serverId, project) => {
    const res = await invoke(serverId, `/api/supervisor/system-objects?project=${encodeURIComponent(project)}`, 'GET');
    if (!res?.ok) return; // keep prior on failure
    set((state) => ({ systemObjectsByProject: { ...state.systemObjectsByProject, [project]: res.body?.objects ?? [] } }));
  },

  loadBom: async (serverId, project, rootId) => {
    const qs = new URLSearchParams({ project, rootId });
    const res = await invoke(serverId, `/api/supervisor/bom?${qs.toString()}`, 'GET');
    if (!res?.ok) return; // keep prior on failure
    set((state) => ({ bomByRoot: { ...state.bomByRoot, [rootId]: res.body?.lines ?? [] } }));
  },

  // Sign/reject/re-sign a requirement, then re-fetch the inbox (and coverage,
  // since an approve can flip a chip's tint) so every surface reflects the change.
  decideRequirement: async (serverId, project, id, decision, opts) => {
    const res = await invoke(serverId, '/api/supervisor/requirements/decide', 'POST', {
      project, id, decision, approvedBy: opts?.approvedBy, spec: opts?.spec, title: opts?.title,
    });
    if (!res?.ok) return false; // leave state unchanged on failure
    await get().loadRequirements(serverId, project);
    await get().loadCoverage(serverId, project);
    return true;
  },

  // Propose a new requirement (Spec Sheet '+ promise' composer). Creates a
  // 'proposed' record, then re-fetches the inbox so it surfaces for signature.
  proposeRequirement: async (serverId, project, input) => {
    const res = await invoke(serverId, '/api/supervisor/requirements', 'POST', {
      project, title: input.title, spec: input.spec ?? null, epicId: input.epicId ?? null, rationale: input.rationale ?? null,
    });
    if (!res?.ok) return false; // leave state unchanged on failure
    await get().loadRequirements(serverId, project);
    return true;
  },

  // Satisfy-drag: an object-linked todo dropped on a requirement → OBJECT→req
  // satisfy edge. Reject locally when the todo has no objectRef (no server round
  // trip, no todo→req edge); otherwise POST and re-fetch coverage so the chip's
  // covered/uncovered tint updates.
  addSatisfyEdge: async (serverId, project, objectId, reqId) => {
    if (!objectId) return false; // todo has no objectRef → graceful no-op (link an object first)
    const res = await invoke(serverId, '/api/supervisor/edges/satisfy', 'POST', { project, objectId, reqId });
    if (!res?.ok) return false; // leave state unchanged on failure
    await get().loadCoverage(serverId, project);
    return true;
  },

  // ED2/ED3: answer a structured escalation by choosing one of its options. The
  // server relays the choice to the waiting worker and resolves the escalation
  // (status 'decided'); we mirror that locally so the card drops out of the list.
  decideEscalation: async (serverId, id, optionId) => {
    const res = await invoke(serverId, `/api/supervisor/escalation/${encodeURIComponent(id)}/decide`, 'POST', { optionId });
    if (!res?.ok) return false; // leave state unchanged on failure
    set((state) => {
      const escalations = state.escalations.map((e) =>
        e.id === id ? { ...e, status: 'decided', resolvedAt: Date.now() } : e,
      );
      localStorage.setItem(ESCALATIONS_KEY, JSON.stringify(escalations));
      return { escalations };
    });
    return true;
  },
}));
