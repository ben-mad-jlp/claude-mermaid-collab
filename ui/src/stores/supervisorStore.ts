import { create } from 'zustand';
import type { SessionTodo } from '@/types/sessionTodo';
import { kindOf } from '@/lib/todoKind';

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
 *
 * Z9: every action is pure HTTP (`invoke`) + WS-ingest; no hover/desktop-only state —
 * the Phase-2 mobile app is a straight thin-client port.
 */
export interface WatchedProject {
  project: string;
  addedAt: number;
  /** Z9: per-project context-watchdog trigger threshold (%). Null/absent = default 80%.
   *  Server-persisted (supervisor-store watchdogThresholdPercent). */
  watchdogThresholdPercent?: number | null;
}

/** Deploy-drift read-model for the self-deploy banner. From
 *  GET /api/supervisor/deploy-status. `stale` = version drift OR a self-land
 *  that post-dates the running binary; `canDeploy` mirrors the server gates. */
export interface DeployStatus {
  livePid: number | null;
  liveVersion: string | null;
  liveStartedAt: string | null;
  repoVersion: string | null;
  repoHead: string | null;
  uncommittedCount: number | null;
  drift: boolean | null;
  selfLandPending: boolean;
  lastSelfLandAt: number | null;
  versionDrift: boolean;
  modifiedTrackedCount: number;
  stale: boolean;
  canDeploy: boolean;
  deployBlockedReason: string | null;
}

/** A collab/epic/* branch carrying commits not yet landed on master (accepted
 *  work stranded off-master). From GET /api/supervisor/unlanded-epics. */
export interface UnlandedEpic {
  branch: string;
  epicId8: string;
  ahead: number;
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
  /** Server-stamped operator-gate flag (irreversible/outward action). Arrives as
   *  0|1 from mapEscalationRow's column spread; truthy = a hard human floor that
   *  MUST outrank routine approvals in the Zen triage stack (Z3/Z4). */
  operatorGated?: boolean | number;
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
  /** The work-graph todo this escalation was raised against (coordinator-stamped).
   *  Lets the inbox show what work the question is about and, on dismiss, optionally
   *  re-ready / block that todo. Null/absent for escalations with no todo link. */
  todoId?: string | null;
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

export type ProgressState = 'active' | 'quiet' | 'stalled' | 'wedged' | 'unknown';

export interface ZenStructured {
  paragraph: string;
  /** Fuller summary shown on "more" — richer than the glance paragraph, not a restatement. */
  detail?: string;
  status: 'working' | 'idle' | 'stuck' | 'needs-input';
  question?: string;
  options?: Array<{ label: string; valueToSend: string }>;
  recommended?: number;
  multiSelect?: boolean;
  /** AI-proposed canned replies for an open end-of-turn question (no on-screen menu). */
  suggestedAnswers?: string[];
  /** AI-proposed next-step directive for an idle, question-free session (e.g. "Run the tests"). */
  aiOption?: string;
}

/** Z3: mirror of the server session-summary heartbeat (session-summary-loop.ts).
 *  Keyed `${project}::${session}`. LIVE signal — NOT persisted to localStorage
 *  (a hydrated stale value would falsely read as wedged on first paint, same
 *  rationale as `liveness`). `snoozedUntil` is a LOCAL-only suppression set by
 *  the Zen wedge card's Snooze button — never sent by the server. */
export interface SessionSummary {
  project: string;
  session: string;
  progressState: ProgressState;
  paneSeenAt: number;
  updatedAt: number;
  snoozedUntil?: number;
  summaryText?: string;
  firstClause?: string;
  summaryUpdatedAt?: number;
  refreshState?: 'fresh' | 'stale-failing';
  /** Live pane hash (advances every tick). */
  paneHash?: string;
  /** Pane hash the carried `structured` question/options were captured from.
   *  `paneHash === summaryPaneHash` ⇒ the question is still on screen, so it's
   *  safe to answer even if refreshState is stale-failing. */
  summaryPaneHash?: string;
  structured?: ZenStructured;
}

const PROJECTS_KEY = 'supervisor-projects';
/** Legacy (unversioned) todos cache. Pre-`kind` rows live here; a v1 blob can crash a
 *  v2 client at first paint (kindOf throws before any fetch), so v2 never reads it. */
const LEGACY_TODOS_KEY = 'supervisor-todos-by-project';
const TODOS_KEY = 'supervisor-todos-by-project.v2';
const ESCALATIONS_KEY = 'supervisor-escalations';
const RESOLVED_ESCALATIONS_KEY = 'supervisor-escalations-resolved';
const SUPERVISED_KEY = 'supervisor-supervised';
const SUPERVISOR_CONFIG_KEY = 'supervisor-config';
const REQUIREMENTS_KEY = 'supervisor-requirements-by-project';

export interface SupervisorConfig {
  supervisorProject: string;
  supervisorSession: string;
}

/** Convergence-loop mission summary (GET /api/supervisor/missions). A `kind:'mission'`
 *  work-graph node plus its live convergence rollup + acceptance criteria. The
 *  capability gauge (criteria met/total) is the real convergence gauge; the mechanical
 *  gauge is this iteration's `kind:'epic'` children done/total.
 *
 *  Role is NOT read from a title here: the endpoint only ever returns mission nodes,
 *  and `epics` only ever epic children. Anything that must classify an arbitrary node
 *  uses `kindOf` from `ui/src/lib/todoKind.ts` (decision e852fb0c, stage B) — never a
 *  title prefix. Titles still carry their prefixes in stage B; they are simply no
 *  longer read. Render a label with `labelFor(kind)` / strip one with
 *  `stripKindPrefix(title)`. */
export type MissionPhase =
  | 'discover' | 'plan' | 'execute' | 'verify' | 'converged' | 'stopped';

export type MissionStatus =
  | 'abandoned' | 'over-budget' | 'blocked' | 'building'
  | 'needs-verify' | 'needs-discovery' | 'unapproved' | 'converged';

export interface MissionSummary {
  node: { id: string; title: string; status: string };
  ownerSession: string | null;
  assigneeSession: string | null;
  mission: {
    todoId: string;
    phase: MissionPhase;
    iteration: number;
    maxIterations?: number | null;
    procedure?: string | null;
    stopReason?: string | null;
    lastDiscoverAt?: number | null;
    lastVerifyAt?: number | null;
    active?: boolean;
    [k: string]: unknown;
  };
  rollup: {
    phase: MissionPhase;
    iteration: number;
    maxIterations?: number | null;
    mechanical: { done: number; total: number };
    capability: { met: number; total: number };
    converged: boolean;
    stopped?: boolean;
    stopReason?: string | null;
    status?: MissionStatus;
  };
  criteria: Array<{ id: string; text: string; met: boolean; order: number; verifiedAt?: number | null; verifiedAtSha?: string | null; evidencePaths?: string[] }>;
  /** This mission's `kind:'epic'` children, as classified server-side — no client predicate needed. */
  epics: Array<{ id: string; title: string; status: string; acceptanceStatus?: string }>;
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

/** A cache is a cache: any row we cannot classify is DROPPED, never defaulted.
 *  `kindOf` throws MissingKindError on a kind-less row — that throw is the filter,
 *  so the single kind rule stays in one place. A dropped row is refetched by
 *  `loadProjectTodos`. Project entries left empty are dropped too. */
function hasKind(t: unknown): boolean {
  try { kindOf(t as { kind?: unknown; title?: unknown } as never); return true; }
  catch { return false; }
}

function sanitizeTodosByProject(raw: unknown): Record<string, SessionTodo[]> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, SessionTodo[]> = {};
  for (const [project, rows] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    const kept = (rows as unknown[]).filter(hasKind) as SessionTodo[];
    if (kept.length > 0) out[project] = kept;
  }
  return out;
}

/** One-shot: a v1 blob is never read again, so free its bytes (measured 13 MB on the
 *  live desktop app, 2026-07-10) rather than orphaning them forever. */
function hydrateTodosByProject(): Record<string, SessionTodo[]> {
  try { localStorage.removeItem(LEGACY_TODOS_KEY); } catch { /* storage unavailable */ }
  return sanitizeTodosByProject(hydrate<unknown>(TODOS_KEY, {}));
}

// Z9: module-scope snooze resurface timers, keyed by `${project}::${session}`.
const snoozeTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleResurface(key: string, ms: number, bump: () => void) {
  const prev = snoozeTimers.get(key);
  if (prev) clearTimeout(prev);
  snoozeTimers.set(key, setTimeout(() => { snoozeTimers.delete(key); bump(); }, Math.max(0, ms)));
}

// Z9: module-scope pending-clear control records for the undo window, keyed by escalation id.
const pendingClearCtl = new Map<string, { timer: ReturnType<typeof setTimeout>; prev: Escalation }>();

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
  /** Z3: live mirror of the server session-summary heartbeat. Keyed
   *  `${project}::${session}`. NOT persisted (live signal). */
  sessionSummaries: Record<string, SessionSummary>;
  /** Fold a `session_summary_updated` WS event into the map (upsert by key).
   *  Preserves any local `snoozedUntil` already set for that key. */
  ingestSessionSummary: (s: {
    project: string; session: string; progressState: ProgressState;
    paneSeenAt: number; updatedAt: number;
    summaryText?: string; firstClause?: string; summaryUpdatedAt?: number;
    refreshState?: 'fresh' | 'stale-failing'; structured?: ZenStructured;
    paneHash?: string; summaryPaneHash?: string;
  }) => void;
  /** Locally snooze a session out of the triage stack until `untilMs`. */
  snoozeSession: (project: string, session: string, untilMs: number) => void;
  /** Z9: snooze relative — re-surfaces after `ms`. Client-side timer guarantees a
   *  re-render at expiry without depending on the freshness pulse. */
  snoozeSessionFor: (project: string, session: string, ms: number) => void;
  /** Z9: out-of-band re-hash/re-summarize for force-proof. POST → server re-reads
   *  the pane and re-runs the interpreter immediately, then broadcasts
   *  `session_summary_updated` (folded by ingestSessionSummary). Returns whether the
   *  request was accepted. No local state write — the WS event is the source of truth. */
  refreshSummaryNow: (serverId: string, project: string, session: string) => Promise<boolean>;
  /** Zen-presence heartbeat: POST /api/zen/viewing so the server gates its
   *  summary interpret + self-nudge passes on a fresh beat. Fire-and-forget. */
  pingViewing: (serverId: string) => void;
  /** Z9: in-flight optimistic clears awaiting their 5s undo window. Keyed by
   *  escalation id. Live/ephemeral — NOT persisted. The toast UI selects over this. */
  pendingClears: Record<string, { id: string; status: string; project?: string; sentAt: number }>;
  /** Z9: optimistically clear an escalation with a 5s undo window. Moves it to
   *  resolved locally, registers a pendingClear (for the toast), and after `undoMs`
   *  (default 5000) commits to the server. Server failure → revert into open. */
  clearWithUndo: (serverId: string, id: string, status: string, undoMs?: number) => void;
  /** Z9: cancel a pending clear before its window elapses — restores the item to open. */
  undoClear: (id: string) => void;
  /** Z9: operator marks/unmarks an open escalation as "only you" — sets the local
   *  operatorGated flag so it deterministically outranks routine approvals in the
   *  Zen triage stack (reuses escalationSeverity's SEV_GATED_OR_WEDGED tier). Local-
   *  first (optimistic); best-effort server persist so a reload/hydrate keeps the mark. */
  markOperatorOnly: (serverId: string, id: string, on: boolean) => Promise<void>;
  /** Z9: set (number 1-100) or clear (null → default 80%) a project's watchdog
   *  trigger threshold. Mirrors the set_watchdog_threshold MCP tool. Reloads projects. */
  setWatchdogThreshold: (serverId: string, project: string, thresholdPercent: number | null) => Promise<boolean>;
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
  loadProjectTodos: (serverId: string, project: string) => Promise<void>;
  /** Convergence-loop missions for a project (GET /api/supervisor/missions).
   *  Returns the mission summaries, or [] on any failure (fail open — the Plan
   *  board still renders without the missions strip). */
  fetchMissions: (serverId: string, project: string, session?: string) => Promise<MissionSummary[]>;
  /** Mission AUTHORING mutations (write routes under /api/supervisor/missions). Each
   *  mutates then RE-FETCHES the project's missions (no optimistic update — localhost
   *  is fast, and a refetch can't race the 15s poll) and returns the fresh list so the
   *  caller can render it. Returns [] on failure (fail open). */
  createMission: (serverId: string, project: string, body: { session: string; title: string; description?: string; criteria?: string[]; maxIterations?: number | null; procedure?: string | null }) => Promise<MissionSummary[]>;
  activateMission: (serverId: string, project: string, todoId: string) => Promise<MissionSummary[]>;
  approveMission: (serverId: string, project: string, todoId: string) => Promise<MissionSummary[]>;
  updateMission: (serverId: string, project: string, todoId: string, patch: { title?: string; description?: string; maxIterations?: number | null; procedure?: string | null }) => Promise<MissionSummary[]>;
  deleteMission: (serverId: string, project: string, todoId: string) => Promise<MissionSummary[]>;
  abandonMission: (serverId: string, project: string, todoId: string, abandonedAt: number | null) => Promise<MissionSummary[]>;
  addMissionCriterion: (serverId: string, project: string, todoId: string, text: string) => Promise<MissionSummary[]>;
  updateMissionCriterion: (serverId: string, project: string, criterionId: string, text: string) => Promise<MissionSummary[]>;
  removeMissionCriterion: (serverId: string, project: string, criterionId: string) => Promise<MissionSummary[]>;
  promoteTodo: (serverId: string, project: string, id: string, status: string) => Promise<void>;
  /** Hard-delete a work-graph todo (DELETE /api/supervisor/roadmap). Does NOT
   *  reload the plan — callers batch-deleting should reload once at the end. */
  deleteTodo: (serverId: string, project: string, id: string) => Promise<boolean>;
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
  /** Defensive summaries hydrate: fetch the server's snapshot (GET
   *  /api/supervisor/summaries — same payloads as the WS connect-snapshot) and
   *  fold each into sessionSummaries. Runs on mount + per WS (re)connect to cover
   *  cold start (before WS) and reconnects. Best-effort per server; the ingest is
   *  monotonic-guarded so a stale snapshot can't clobber a newer live WS tick. */
  hydrateSessionSummaries: (serverIds: string[]) => Promise<void>;
  resolveEscalation: (serverId: string, id: string, status: string) => Promise<void>;
  decideEscalation: (serverId: string, id: string, optionId: string) => Promise<boolean>;
  /** FBPE P4: the land click — land a green 'epic-ready-to-land' escalation onto
   *  master. Server re-derives readiness, merges, removes the epic, resolves the
   *  card. Returns the server outcome (landed / conflict / rejected). */
  landEpic: (serverId: string, project: string, id: string) => Promise<{ ok: boolean; landed: boolean; conflict?: boolean; reason: string }>;
  /** Escalation-briefing (deep markdown context): lazily generate+cache a human
   *  briefing for one escalation on the server, returned as GFM markdown. Safe to
   *  call on card open; `refresh` forces a regenerate. Returns null on any failure
   *  (the card still works without it). */
  fetchEscalationBrief: (serverId: string, project: string, escalationId: string, refresh?: boolean) => Promise<{ md: string; model: string; cached: boolean; at: number } | null>;
  /** Human-gated self-deploy of the running sidecar (STRICTLY SEPARATE from land).
   * Server hard-gates self-project; the deploy is detached and will kill+relaunch
   * the sidecar, so this resolves immediately and the UI should then poll for the
   * new live version. */
  deploySelf: (serverId: string, project: string, force?: boolean) => Promise<{ ok: boolean; started: boolean; reason: string; logPath?: string; inflightLeaves?: string[] }>;
  /** Read the deploy-drift status for the banner (live version, staleness, gate). */
  fetchDeployStatus: (serverId: string, project: string) => Promise<DeployStatus | null>;
  /** Orch P2: confirm an inline Grok suggestion → server re-validates the proof
   *  gate then applies the verb. Returns the server result message. */
  confirmSuggestion: (serverId: string, project: string, id: string) => Promise<{ ok: boolean; reason: string }>;
  /** Orch P2: dismiss an inline Grok suggestion → clears it; escalation stays open. */
  dismissSuggestion: (serverId: string, project: string, id: string) => Promise<void>;
  nudge: (serverId: string, project: string, session: string, text: string) => Promise<boolean>;
  /** Answer a Claude Code multi-select question: toggle the chosen 1-based option numbers then submit. */
  answerPaneMulti: (serverId: string, project: string, session: string, numbers: number[]) => Promise<boolean>;
  /** Z8: fetch the raw tmux capture-pane text for a session ON DEMAND (not a
   *  stream) — backs the PaneLinesPopover "show the lines it read". Returns the
   *  raw pane string, or '' on failure (keep-prior-on-failure convention). */
  capturePane: (serverId: string, project: string, session: string) => Promise<string>;
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
  todosByProject: hydrateTodosByProject(),
  unlandedEpicsByProject: {},
  sessionSummaries: {},
  pendingClears: {},
  openEscalations: hydrate<Escalation[]>(ESCALATIONS_KEY, []),
  resolvedEscalations: hydrate<Escalation[]>(RESOLVED_ESCALATIONS_KEY, []),
  // Deprecated alias — seeded from the same cache as openEscalations (§4).
  escalations: hydrate<Escalation[]>(ESCALATIONS_KEY, []),
  hydrateEpoch: 0,
  bumpEpoch: () => set((state) => ({ hydrateEpoch: state.hydrateEpoch + 1 })),
  ingestEscalationCreated: (e) =>
    set((state) => {
      // Upsert by id (server-stamped), newest first; replace an existing card in
      // place so a re-broadcast doesn't duplicate it.
      if (!isOpen(e)) {
        // A now-resolved/decided broadcast (e.g. the steward auto-resolved it):
        // drop it from open and fold it into resolved so the AI-resolved lingering
        // card (fd934fb7) can show its outcome instead of the card just vanishing.
        const open = state.openEscalations.filter((x) => x.id !== e.id);
        const resolved = [e, ...state.resolvedEscalations.filter((x) => x.id !== e.id)];
        return { ...writeOpen(open), ...writeResolved(resolved), hydrateEpoch: state.hydrateEpoch + 1 };
      }
      const open = [e, ...state.openEscalations.filter((x) => x.id !== e.id)];
      return { ...writeOpen(open), hydrateEpoch: state.hydrateEpoch + 1 };
    }),
  ingestSessionSummary: (s) =>
    set((state) => {
      const key = `${s.project}::${s.session}`;
      const prev = state.sessionSummaries[key];
      // Monotonic guard: drop an update older than what we already hold. The
      // server stamps `updatedAt` every tick (always advancing), so an out-of-
      // order arrival — e.g. a slow fetch-on-mount response landing after a
      // newer WS tick — can never clobber fresher state.
      if (prev && s.updatedAt < prev.updatedAt) return {};
      return {
        sessionSummaries: {
          ...state.sessionSummaries,
          [key]: {
            ...s,
            snoozedUntil: prev?.snoozedUntil,
            structured: s.structured ?? prev?.structured,
            summaryText: s.summaryText ?? prev?.summaryText,
            firstClause: s.firstClause ?? prev?.firstClause,
            summaryUpdatedAt: s.summaryUpdatedAt ?? prev?.summaryUpdatedAt,
            refreshState: s.refreshState ?? prev?.refreshState,
            paneHash: s.paneHash ?? prev?.paneHash,
            // summaryPaneHash tracks the carried structured payload: keep it
            // paired with whichever `structured` we end up holding above.
            summaryPaneHash: s.structured ? s.summaryPaneHash : (s.summaryPaneHash ?? prev?.summaryPaneHash),
          },
        },
      };
    }),
  snoozeSession: (project, session, untilMs) => {
    const key = `${project}::${session}`;
    set((state) => {
      const prev = state.sessionSummaries[key];
      if (!prev) return {};
      return { sessionSummaries: { ...state.sessionSummaries, [key]: { ...prev, snoozedUntil: untilMs } } };
    });
    scheduleResurface(key, untilMs - Date.now(), get().bumpEpoch);
  },
  snoozeSessionFor: (project, session, ms) => {
    get().snoozeSession(project, session, Date.now() + ms);
  },
  refreshSummaryNow: async (serverId, project, session) => {
    const res = await invoke(serverId, '/api/supervisor/refresh-summary', 'POST', { project, session });
    return !!res?.ok;
  },
  pingViewing: (serverId) => {
    void invoke(serverId, '/api/zen/viewing', 'POST');
  },
  clearWithUndo: (serverId, id, status, undoMs = 5000) => {
    const state = get();
    const prev = state.openEscalations.find((e) => e.id === id);
    if (!prev) return;
    set((s) => ({
      ...moveOpenToResolved(s, id, { status, resolvedAt: Date.now() }),
      pendingClears: { ...s.pendingClears, [id]: { id, status, project: prev.project, sentAt: Date.now() } },
    }));
    const timer = setTimeout(async () => {
      pendingClearCtl.delete(id);
      const res = await invoke(serverId, '/api/supervisor/escalations/resolve', 'POST', { id, status });
      set((s) => {
        const { [id]: _drop, ...rest } = s.pendingClears;
        if (res?.ok) return { pendingClears: rest };
        const resolved = s.resolvedEscalations.filter((e) => e.id !== id);
        const open = [prev, ...s.openEscalations.filter((e) => e.id !== id)];
        return { ...writeOpen(open), ...writeResolved(resolved), pendingClears: rest, hydrateEpoch: s.hydrateEpoch + 1 };
      });
    }, undoMs);
    pendingClearCtl.set(id, { timer, prev });
  },
  undoClear: (id) => {
    const ctl = pendingClearCtl.get(id);
    if (!ctl) return;
    clearTimeout(ctl.timer);
    pendingClearCtl.delete(id);
    set((s) => {
      const { [id]: _drop, ...rest } = s.pendingClears;
      const resolved = s.resolvedEscalations.filter((e) => e.id !== id);
      const open = [ctl.prev, ...s.openEscalations.filter((e) => e.id !== id)];
      return { ...writeOpen(open), ...writeResolved(resolved), pendingClears: rest, hydrateEpoch: s.hydrateEpoch + 1 };
    });
  },
  markOperatorOnly: async (serverId, id, on) => {
    set((state) => updateOpenItem(state, id, { operatorGated: on ? 1 : 0 }));
    await invoke(serverId, '/api/supervisor/escalation/' + encodeURIComponent(id) + '/operator-gate', 'POST', { on });
  },
  setWatchdogThreshold: async (serverId, project, thresholdPercent) => {
    const res = await invoke(serverId, '/api/supervisor/watchdog-threshold', 'POST', { project, thresholdPercent });
    if (!res?.ok) return false;
    await get().loadProjects(serverId);
    return true;
  },
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
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(watchedProjects));
      return { watchedProjects };
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

  fetchMissions: async (serverId, project, session) => {
    if (!serverId || !project) return [];
    let path = `/api/supervisor/missions?project=${encodeURIComponent(project)}`;
    if (session) path += `&session=${encodeURIComponent(session)}`;
    const res = await invoke(serverId, path, 'GET');
    if (!res?.ok) return []; // fail open — no missions strip, board still renders
    const missions = res.body?.missions;
    return Array.isArray(missions) ? (missions as MissionSummary[]) : [];
  },

  createMission: async (serverId, project, body) => {
    const res = await invoke(serverId, '/api/supervisor/missions', 'POST', { project, ...body });
    if (!res?.ok) return [];
    return get().fetchMissions(serverId, project);
  },

  activateMission: async (serverId, project, todoId) => {
    const res = await invoke(serverId, '/api/supervisor/missions/activate', 'POST', { project, todoId });
    if (!res?.ok) return [];
    return get().fetchMissions(serverId, project);
  },

  approveMission: async (serverId, project, todoId) => {
    const res = await invoke(serverId, '/api/supervisor/missions/approve', 'POST', { project, todoId });
    if (!res?.ok) return [];
    return get().fetchMissions(serverId, project);
  },

  updateMission: async (serverId, project, todoId, patch) => {
    const res = await invoke(serverId, '/api/supervisor/missions', 'PATCH', { project, todoId, ...patch });
    if (!res?.ok) return [];
    return get().fetchMissions(serverId, project);
  },

  deleteMission: async (serverId, project, todoId) => {
    const res = await invoke(serverId, '/api/supervisor/missions', 'DELETE', { project, todoId });
    if (!res?.ok) return [];
    return get().fetchMissions(serverId, project);
  },

  abandonMission: async (serverId, project, todoId, abandonedAt) => {
    const res = await invoke(serverId, '/api/supervisor/missions', 'PATCH', { project, todoId, abandonedAt });
    if (!res?.ok) return [];
    return get().fetchMissions(serverId, project);
  },

  addMissionCriterion: async (serverId, project, todoId, text) => {
    const res = await invoke(serverId, '/api/supervisor/missions/criteria', 'POST', { project, todoId, text });
    if (!res?.ok) return [];
    return get().fetchMissions(serverId, project);
  },

  updateMissionCriterion: async (serverId, project, criterionId, text) => {
    const res = await invoke(serverId, '/api/supervisor/missions/criteria', 'PATCH', { project, criterionId, text });
    if (!res?.ok) return [];
    return get().fetchMissions(serverId, project);
  },

  removeMissionCriterion: async (serverId, project, criterionId) => {
    const res = await invoke(serverId, '/api/supervisor/missions/criteria', 'DELETE', { project, criterionId });
    if (!res?.ok) return [];
    return get().fetchMissions(serverId, project);
  },

  promoteTodo: async (serverId, project, id, status) => {
    const res = await invoke(serverId, '/api/supervisor/todos', 'PATCH', { project, id, status });
    if (!res?.ok) return;
    // Re-fetch the project plan so the change is reflected everywhere.
    await get().loadProjectTodos(serverId, project);
  },

  deleteTodo: async (serverId, project, id) => {
    // Work-graph todo delete. Must hit the todos table, NOT /api/supervisor/roadmap
    // (deleteItem on the roadmap_item table) — kanban items are work-graph todos, so
    // the old roadmap route matched 0 rows and "Clear completed" silently no-opped.
    const res = await invoke(serverId, '/api/supervisor/todos', 'DELETE', { project, id });
    return !!res?.ok;
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
  hydrateSessionSummaries: async (serverIds) => {
    const ids = serverIds.length ? serverIds : ['local'];
    const results = await Promise.all(
      ids.map((id) => invoke(id, '/api/supervisor/summaries', 'GET')),
    );
    const ingest = get().ingestSessionSummary;
    for (const res of results) {
      if (!res?.ok) continue; // best-effort per server — keep prior on failure
      for (const m of (res.body?.summaries ?? []) as Array<Record<string, unknown>>) {
        if (typeof m.project !== 'string' || typeof m.session !== 'string') continue;
        if (typeof m.progressState !== 'string') continue;
        // Same validation as the WS ingest (useStatusSync); the monotonic guard in
        // ingestSessionSummary discards any entry older than what we already hold.
        ingest({
          project: m.project,
          session: m.session,
          progressState: m.progressState as ProgressState,
          paneSeenAt: typeof m.paneSeenAt === 'number' ? m.paneSeenAt : Date.now(),
          updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
          summaryText: typeof m.summaryText === 'string' ? m.summaryText : undefined,
          firstClause: typeof m.firstClause === 'string' ? m.firstClause : undefined,
          summaryUpdatedAt: typeof m.summaryUpdatedAt === 'number' ? m.summaryUpdatedAt : undefined,
          paneHash: typeof m.paneHash === 'string' ? m.paneHash : undefined,
          summaryPaneHash: typeof m.summaryPaneHash === 'string' ? m.summaryPaneHash : undefined,
          refreshState:
            m.refreshState === 'fresh' || m.refreshState === 'stale-failing' ? m.refreshState : undefined,
          structured:
            m.structured && typeof m.structured === 'object' ? (m.structured as ZenStructured) : undefined,
        });
      }
    }
  },

  nudge: async (serverId, project, session, text) => {
    const res = await invoke(serverId, '/api/supervisor/nudge', 'POST', { project, session, text });
    return !!res?.ok;
  },

  answerPaneMulti: async (serverId, project, session, numbers) => {
    const res = await invoke(serverId, '/api/supervisor/answer-multi', 'POST', { project, session, serverId, numbers });
    return !!res?.ok;
  },

  capturePane: async (serverId, project, session) => {
    const res = await invoke(serverId, '/api/supervisor/capture-pane', 'POST', { project, session });
    if (!res?.ok) return '';
    const lines = res.body?.lines;
    return typeof lines === 'string' ? lines : '';
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

  fetchEscalationBrief: async (serverId, project, escalationId, refresh) => {
    if (!project || !escalationId) return null;
    const res = await invoke(serverId, '/api/supervisor/escalation-brief', 'POST', { project, escalationId, refresh: !!refresh });
    if (!res?.ok) return null;
    const body = res.body as { md?: string; model?: string; cached?: boolean; at?: number } | null;
    if (!body || typeof body.md !== 'string') return null;
    return { md: body.md, model: body.model ?? '', cached: !!body.cached, at: body.at ?? Date.now() };
  },

  deploySelf: async (serverId, project, force) => {
    const res = await invoke(serverId, '/api/supervisor/deploy', 'POST', { project, force: !!force });
    const result = (res?.body as { ok?: boolean; started?: boolean; reason?: string; logPath?: string; inflightLeaves?: string[] }) ?? {};
    return {
      ok: !!result.ok,
      started: !!result.started,
      reason: result.reason ?? (res?.ok ? 'ok' : 'request-failed'),
      logPath: result.logPath,
      inflightLeaves: result.inflightLeaves,
    };
  },

  fetchDeployStatus: async (serverId, project) => {
    const res = await invoke(serverId, `/api/supervisor/deploy-status?project=${encodeURIComponent(project)}`, 'GET');
    if (!res?.ok || !res.body) return null;
    return res.body as DeployStatus;
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
