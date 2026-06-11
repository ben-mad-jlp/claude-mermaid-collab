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

/** A collab/epic/* branch carrying commits not yet landed on master (accepted
 *  work stranded off-master). From GET /api/supervisor/unlanded-epics. */
export interface UnlandedEpic {
  branch: string;
  epicId8: string;
  ahead: number;
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
  /** The server this escalation lives on. Server-stamped so the scope selectors
   *  (design-ui-status-coherence §1) can filter the aggregated-watched union by
   *  server. Optional: payloads written before the field existed lack it. */
  serverId?: string;
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
  /** Orch P2: an inline Grok-suggested action at level `propose` (or null). The
   *  human confirms/dismisses it on the card; confirm re-validates server-side. */
  suggestedAction?: SuggestedAction | null;
  /** Triage lifecycle (epic d5b1ff4e / todo fd934fb7): true WHILE a Grok triage
   *  consult is in flight for this escalation, so the card can show "Grok is
   *  triaging…" instead of looking untouched. Server flips it on before the
   *  classify await and off after (reusing escalation_updated — no new WS event).
   *  Absent on older payloads → treated as not-in-flight. */
  triageInFlight?: boolean;
  /** Who resolved this escalation, when it is no longer open. 'ai' = the steward's
   *  drive-level auto-resolve closed it (show the outcome briefly rather than let it
   *  silently vanish); 'human' = a person decided/resolved it. Absent on older
   *  payloads. */
  resolvedBy?: 'ai' | 'human';
}

/** Orch P2: a Grok-suggested action attached inline to an escalation (mirrors the
 *  server SuggestedAction). verb=null → classify-only (routes attention, no act). */
export interface SuggestedAction {
  bucket: 'stale' | 'verified-done' | 'now-buildable' | 'genuine-decision' | 'needs-design';
  verb: 'reset_todo' | 'override_accept_todo' | null;
  args?: { proof?: unknown; status?: string } | null;
  confidence: number;
  rationale: string;
  bundleInputs?: Record<string, unknown>;
  generatedAt?: number;
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
  /** Authoring session of the proposal. `'cartographer'` discriminates an
   *  auto-inferred (ghost) proposal from a human/planner one — already on the
   *  decision-record wire, declared here for the Inbox ghost styling (zero schema
   *  change; see design-cartographer §5). */
  authorSession?: string | null;
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
const RESOLVED_ESCALATIONS_KEY = 'supervisor-escalations-resolved';
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
  /** 3-way mode (persistent): off = all→human; auto = answer-only; dogfood =
   *  answer + proactively drive/build. Defaults to auto/off derived from switchedOn. */
  mode?: StewardMode;
}

export type StewardMode = 'off' | 'auto' | 'dogfood';

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

/** An escalation is "open" (belongs in the open slice) only while its status is
 *  literally 'open' — a 'resolved'/'decided' item belongs in the resolved slice. */
const isOpen = (e: Escalation) => e.status === 'open';

/** Persist + return the state partial for an open-set write. Mirrors the canonical
 *  `openEscalations` into the deprecated `escalations` alias (same array ref) so
 *  existing `s.escalations` consumers keep reading the open set until L5. */
function writeOpen(open: Escalation[]): Pick<SupervisorState, 'openEscalations' | 'escalations'> {
  localStorage.setItem(ESCALATIONS_KEY, JSON.stringify(open));
  return { openEscalations: open, escalations: open };
}

/** Persist + return the state partial for a resolved-set write. */
function writeResolved(resolved: Escalation[]): Pick<SupervisorState, 'resolvedEscalations'> {
  localStorage.setItem(RESOLVED_ESCALATIONS_KEY, JSON.stringify(resolved));
  return { resolvedEscalations: resolved };
}

/** Authoritatively move an escalation out of the open slice and into resolved
 *  (applying `patch`, e.g. the new status + resolvedAt). This is the local source
 *  of truth for a user resolve/decide/land: a subsequent L3 hydrate merge must not
 *  resurrect the id into open. No-op move when the id isn't currently open. */
function moveOpenToResolved(
  state: SupervisorState,
  id: string,
  patch: Partial<Escalation>,
): Partial<SupervisorState> {
  const item = state.openEscalations.find((e) => e.id === id);
  const open = state.openEscalations.filter((e) => e.id !== id);
  const resolved = item
    ? [{ ...item, ...patch }, ...state.resolvedEscalations.filter((e) => e.id !== id)]
    : state.resolvedEscalations;
  return { ...writeOpen(open), ...writeResolved(resolved), hydrateEpoch: state.hydrateEpoch + 1 };
}

/** Patch an escalation in place within the open slice (it stays open). */
function updateOpenItem(
  state: SupervisorState,
  id: string,
  patch: Partial<Escalation>,
): Partial<SupervisorState> {
  const open = state.openEscalations.map((e) => (e.id === id ? { ...e, ...patch } : e));
  return { ...writeOpen(open), hydrateEpoch: state.hydrateEpoch + 1 };
}

interface SupervisorState {
  watchedProjects: WatchedProject[];
  roadmapByProject: Record<string, RoadmapItem[]>;
  todosByProject: Record<string, SessionTodo[]>;
  /** Per-project unlanded-epic readout (design-epic-landing P1): collab/epic/*
   *  branches with commits not on master = accepted work stranded off-master.
   *  Refreshed alongside todos on the existing per-project load (no new poll). */
  unlandedEpicsByProject: Record<string, UnlandedEpic[]>;
  /** The live "needs you" set (status==='open'), each item server-stamped. THE
   *  single open-escalation source every surface selects over (design-ui-status-
   *  coherence §0/§4). Loaded/ingested independently of `resolvedEscalations` so a
   *  resolved-tab fetch can never zero the open counts (the D2 fix). */
  openEscalations: Escalation[];
  /** Resolved/decided escalations — populated ONLY by the resolved-tab load. Kept
   *  in its own slice so viewing resolved never overwrites the open set. */
  resolvedEscalations: Escalation[];
  /** @deprecated Backward-compat alias for `openEscalations`, kept in lockstep on
   *  every open-set mutation so existing `s.escalations` consumers keep compiling
   *  and reading the open set until L5 migrates them to `selectOpenEscalations`. */
  escalations: Escalation[];
  /** Monotonic generation counter bumped on every WS ingest / open-set mutation.
   *  L3's reconnect hydrate snapshots it before its REST call and discards a stale
   *  in-flight result if it advanced meanwhile (the hydrate-vs-ingest race guard,
   *  design §2.1). */
  hydrateEpoch: number;
  /** Advance `hydrateEpoch` (called by every open-set mutation + WS ingest). */
  bumpEpoch: () => void;
  /** Fold an `escalation_created` WS event into `openEscalations` (upsert by id,
   *  server-stamped) and bump the epoch — the incremental refresh path (design §2),
   *  replacing App.tsx's blanket `loadEscalations` reload. */
  ingestEscalationCreated: (e: Escalation) => void;
  supervised: SupervisedSession[];
  config: SupervisorConfig | null;
  liveness: SupervisorLiveness | null;
  loadLiveness: (serverId: string) => Promise<void>;
  // Steward P3: independent steward role liveness + the override-accept count.
  stewardLiveness: StewardLiveness | null;
  loadStewardIdentity: (serverId: string, project?: string) => Promise<void>;
  setStewardMode: (serverId: string, mode: StewardMode) => Promise<void>;
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
  /** Start a global LLM role (steward/supervisor) via /api/ide/launch-session —
   *  the ON half of the Bridge role switch. `remoteControl` launches with Claude
   *  Code Remote Control so the session is drivable from the Claude app. */
  startRole: (
    serverId: string,
    role: 'steward' | 'supervisor',
    project: string,
    session: string,
    remoteControl?: boolean,
  ) => Promise<{ started: boolean; reason?: string }>;
  /** Stop a global LLM role: kill its tmux + clear identity (Bridge switch OFF). */
  stopRole: (serverId: string, role: 'steward' | 'supervisor') => Promise<void>;
  loadEscalations: (serverId: string, status?: string) => Promise<void>;
  /** L3 bootstrap/reconnect hydrate (design-ui-status-coherence §2 + §2.1).
   *  Fetch the open escalations across the watched `serverIds` and merge them
   *  into `openEscalations`, server-stamped. Epoch-guarded: snapshots
   *  `hydrateEpoch` before the REST read and DISCARDS its result if a newer WS
   *  ingest / mutation / hydrate bumped the epoch meanwhile — so a slow reconnect
   *  snapshot can never clobber a newer WS upsert. Never resurrects a
   *  locally-resolved id. The single full REST read (replaces every
   *  per-component interval/useEffect). */
  hydrateOpenEscalations: (serverIds: string[]) => Promise<void>;
  resolveEscalation: (serverId: string, id: string, status: string) => Promise<void>;
  decideEscalation: (serverId: string, id: string, optionId: string) => Promise<boolean>;
  /** FBPE P4: the land click — land a green 'epic-ready-to-land' escalation onto
   *  master. Server re-derives readiness, merges, removes the epic, resolves the
   *  card. Returns the server outcome (landed / conflict / rejected). */
  landEpic: (serverId: string, project: string, id: string) => Promise<{ ok: boolean; landed: boolean; conflict?: boolean; reason: string }>;
  /** Orch P2: confirm an inline Grok suggestion → server re-validates the proof
   *  gate then applies the verb. Returns the server result message. */
  confirmSuggestion: (serverId: string, project: string, id: string) => Promise<{ ok: boolean; reason: string }>;
  /** Orch P2: dismiss an inline Grok suggestion → clears it; escalation stays open. */
  dismissSuggestion: (serverId: string, project: string, id: string) => Promise<void>;
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
  unlandedEpicsByProject: {},
  openEscalations: hydrate<Escalation[]>(ESCALATIONS_KEY, []),
  resolvedEscalations: hydrate<Escalation[]>(RESOLVED_ESCALATIONS_KEY, []),
  // Deprecated alias — seeded from the same cache as openEscalations (§4).
  escalations: hydrate<Escalation[]>(ESCALATIONS_KEY, []),
  hydrateEpoch: 0,
  bumpEpoch: () => set((state) => ({ hydrateEpoch: state.hydrateEpoch + 1 })),
  ingestEscalationCreated: (e) =>
    set((state) => {
      // Upsert by id (server-stamped), newest first; replace an existing card in
      // place so a re-broadcast doesn't duplicate it. Resolved items never enter
      // the open slice.
      if (!isOpen(e)) return { hydrateEpoch: state.hydrateEpoch + 1 };
      const open = [e, ...state.openEscalations.filter((x) => x.id !== e.id)];
      return { ...writeOpen(open), hydrateEpoch: state.hydrateEpoch + 1 };
    }),
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
        mode: (b.mode as StewardMode) ?? (b.switchedOn !== false ? 'auto' : 'off'),
      },
    });
  },

  setStewardMode: async (serverId, mode) => {
    // Optimistic: reflect the new mode immediately, then persist.
    const prev = get().stewardLiveness;
    if (prev) set({ stewardLiveness: { ...prev, mode, switchedOn: mode !== 'off' } });
    await invoke(serverId, '/api/supervisor/steward/mode', 'POST', { mode });
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
    // Fold the unlanded-epic readout into the same per-project refresh (no new
    // poll) — surfaces accepted work stranded off-master (design-epic-landing P1).
    const ue = await invoke(serverId, `/api/supervisor/unlanded-epics?project=${encodeURIComponent(project)}`, 'GET');
    if (ue?.ok) {
      set((state) => ({
        unlandedEpicsByProject: { ...state.unlandedEpicsByProject, [project]: ue.body?.unlandedEpics ?? [] },
      }));
    }
  },

  promoteTodo: async (serverId, project, id, status) => {
    const res = await invoke(serverId, '/api/supervisor/todos', 'PATCH', { project, id, status });
    if (!res?.ok) return;
    // Re-fetch the project plan so the change is reflected everywhere.
    await get().loadProjectTodos(serverId, project);
  },

  startRole: async (serverId, role, project, session, remoteControl) => {
    const invokeSkill = role === 'steward' ? '/steward' : '/supervisor';
    const body = {
      project,
      session,
      role,
      invokeSkill,
      allowedTools: 'Bash Edit Write Read mcp__plugin_mermaid-collab_mermaid',
      remoteControl: !!remoteControl,
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

  // Route the fetch into the matching slice. status==='resolved' writes ONLY the
  // resolved slice (never touches openEscalations — the D2 fix); any other call
  // (no status, or 'open') refreshes the open slice, filtered to status==='open'
  // so an all-statuses response can't smuggle resolved items into the open set.
  // Each open mutation bumps the epoch for L3's hydrate-vs-ingest race guard.
  loadEscalations: async (serverId, status?) => {
    const path = status
      ? `/api/supervisor/escalations?status=${encodeURIComponent(status)}`
      : '/api/supervisor/escalations';
    const res = await invoke(serverId, path, 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    const fetched: Escalation[] = res.body?.escalations ?? [];
    if (status === 'resolved') {
      set(writeResolved(fetched));
      return;
    }
    const open = fetched.filter(isOpen);
    set((state) => ({ ...writeOpen(open), hydrateEpoch: state.hydrateEpoch + 1 }));
  },

  // L3 bootstrap/reconnect hydrate (design §2 + §2.1). Snapshot the epoch,
  // fetch each watched server's OPEN escalations, then merge under the race
  // guard. If any watched server fails to respond we keep prior state (matching
  // the store's keep-prior-on-failure convention) rather than risk dropping that
  // server's open items from the merged set.
  hydrateOpenEscalations: async (serverIds) => {
    const ids = serverIds.length ? serverIds : ['local'];
    const sinceEpoch = get().hydrateEpoch;
    const results = await Promise.all(
      ids.map((id) => invoke(id, '/api/supervisor/escalations?status=open', 'GET')),
    );
    if (results.some((r) => !r?.ok)) return; // keep prior on any transient failure
    const fetched: Escalation[] = [];
    results.forEach((res, i) => {
      for (const e of (res!.body?.escalations ?? []) as Escalation[]) {
        // Server-stamp each item so the union across servers is addressable.
        fetched.push({ ...e, serverId: (e as Escalation & { serverId?: string }).serverId || ids[i] });
      }
    });
    set((state) => {
      // Race guard (§2.1): a newer ingest / mutation / hydrate bumped the epoch
      // while our REST read was in flight → our snapshot is stale; discard it so
      // we never clobber a newer WS upsert.
      if (state.hydrateEpoch !== sinceEpoch) return {};
      // Local resolves stay authoritative — never resurrect an id the user just
      // moved into the resolved slice (§2.1.3).
      const resolvedIds = new Set(state.resolvedEscalations.map((e) => e.id));
      // Merge by id (dedupe across servers); the fresh open snapshot is the set.
      const byId = new Map<string, Escalation>();
      for (const e of fetched) {
        if (isOpen(e) && !resolvedIds.has(e.id)) byId.set(e.id, e);
      }
      const open = [...byId.values()];
      return { ...writeOpen(open), hydrateEpoch: state.hydrateEpoch + 1 };
    });
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
    set((state) => moveOpenToResolved(state, id, { status, resolvedAt: Date.now() }));
  },

  landEpic: async (serverId, project, id) => {
    const res = await invoke(serverId, '/api/supervisor/escalations/land', 'POST', { project, escalationId: id });
    const result = (res?.body as { ok?: boolean; landed?: boolean; conflict?: boolean; reason?: string }) ?? {};
    const landed = !!result.landed;
    // On a successful land the escalation is resolved server-side; reflect that
    // locally so the card leaves the open inbox immediately. A conflict/rejection
    // leaves the card open (and may add a re-land escalation on the next poll).
    if (landed) {
      set((state) => moveOpenToResolved(state, id, { status: 'resolved', resolvedAt: Date.now() }));
    }
    return {
      ok: !!result.ok,
      landed,
      conflict: result.conflict,
      reason: result.reason ?? (res?.ok ? 'ok' : 'request-failed'),
    };
  },

  confirmSuggestion: async (serverId, project, id) => {
    const res = await invoke(serverId, `/api/orchestrator/escalation/${encodeURIComponent(id)}/confirm-suggestion`, 'POST', { project });
    const result = (res?.body as { ok?: boolean; reason?: string }) ?? {};
    const ok = !!result.ok;
    // On a successful apply the escalation is resolved server-side; either way the
    // suggestion is cleared. Optimistically reflect that locally.
    set((state) =>
      ok
        ? moveOpenToResolved(state, id, { suggestedAction: null, status: 'resolved', resolvedAt: Date.now() })
        : updateOpenItem(state, id, { suggestedAction: null, routedTo: 'human' }),
    );
    return { ok, reason: result.reason ?? (res?.ok ? 'ok' : 'request-failed') };
  },

  dismissSuggestion: async (serverId, project, id) => {
    const res = await invoke(serverId, `/api/orchestrator/escalation/${encodeURIComponent(id)}/dismiss-suggestion`, 'POST', { project });
    if (!res?.ok) return;
    set((state) => updateOpenItem(state, id, { suggestedAction: null }));
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
    // 'decided' leaves the open slice → resolved slice (the card drops out of the
    // open inbox; a later hydrate merge must not resurrect it).
    set((state) => moveOpenToResolved(state, id, { status: 'decided', resolvedAt: Date.now() }));
    return true;
  },
}));
