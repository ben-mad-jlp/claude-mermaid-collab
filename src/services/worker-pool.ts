/**
 * Worker Pool model (POOL-1). Pure config + in-memory registry for the
 * persistent, role-typed worker sessions described in `design-typed-session-pool`.
 *
 * This module is intentionally side-effect-free: NO tmux, NO launch, NO
 * coordinator wiring (those are POOL-3/POOL-4). It only defines the pool
 * taxonomy, per-type slot config, descriptive session-name derivation, todo→pool
 * type mapping, and an in-memory slot registry that POOL-4 will consume to route
 * todos to free sessions.
 *
 * Constraints (from approved decision records):
 * - Descriptive session names (`frontend-1`, not `worker-<id8>`).
 * - `general-1` absorbs default/untyped/multi-domain todos.
 * - 1 session per type (the parallelism dial; overridable later).
 */
import {
  type AgentProfileType,
  inferProfileType,
} from '../config/agent-profiles';
import type { ProviderId } from '../agent/worker-agent';
import { DEFAULT_PROVIDER_ID } from '../agent/worker-agent';

/**
 * The set of valid routing `type` values (canonical vocabulary: the todo routing
 * key is `type`; `pool-type`/`poolType` are RETIRED synonyms — see
 * spec-canonical-vocabulary). This `PoolType` enum is the sanctioned thin internal
 * alias for that value set (each value names a pool). It is the agent-profile
 * taxonomy with the profile `default` concept remapped to the pool's `general`
 * slot (Q5: cross-type/untyped → a `general` pool) — kept aligned with
 * `AgentProfileType` minus `default`, plus `general`.
 */
export type PoolType =
  | 'frontend'
  | 'backend'
  | 'api'
  | 'ui'
  | 'library'
  | 'cad'
  | 'general';

/** All pool types, in a stable order (config defaults + iteration). */
export const POOL_TYPES: readonly PoolType[] = [
  'frontend',
  'backend',
  'api',
  'ui',
  'library',
  'cad',
  'general',
] as const;

/**
 * Per-type slot count = how many concurrent sessions of that type the pool may
 * hold (the parallelism dial). Hardcoded to 1 per type for now; structured as a
 * map so it's overridable later (per-project config) without an API change.
 */
export type PoolConfig = Record<PoolType, number>;

export const DEFAULT_SLOTS_PER_TYPE = 1;

/** Per-type slot count, overridable via `MERMAID_POOL_<TYPE>` env (e.g.
 *  MERMAID_POOL_FRONTEND=3). Falls back to the given default. */
function slotsFor(type: PoolType, fallback: number): number {
  const env = process.env[`MERMAID_POOL_${type.toUpperCase()}`];
  const n = env != null ? Number(env) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Default pool config: lazy-spawn, keep-warm. `frontend` defaults to 3 so a
 *  same-type wave (e.g. parallel UI todos) fans out; others stay at 1. Tune per
 *  type with MERMAID_POOL_<TYPE>. */
export const POOL_CONFIG: PoolConfig = {
  frontend: slotsFor('frontend', 3),
  backend: slotsFor('backend', DEFAULT_SLOTS_PER_TYPE),
  api: slotsFor('api', DEFAULT_SLOTS_PER_TYPE),
  ui: slotsFor('ui', DEFAULT_SLOTS_PER_TYPE),
  library: slotsFor('library', DEFAULT_SLOTS_PER_TYPE),
  cad: slotsFor('cad', DEFAULT_SLOTS_PER_TYPE),
  general: slotsFor('general', DEFAULT_SLOTS_PER_TYPE),
};

/**
 * Map an `AgentProfileType` to a routing `type`. The only divergence is
 * `default` → `general` (the absorbing slot); every other profile type is a
 * 1:1 routing type. (`profile` is a DISTINCT concept from `type` per the
 * canonical vocabulary — this is the deliberate, explicit bridge between them.)
 */
export function profileTypeToType(profileType: AgentProfileType): PoolType {
  return profileType === 'default' ? 'general' : profileType;
}

/**
 * Resolve a todo's `type` string to a valid routing `type`. Null/unknown/
 * `default`/multi-domain → `general`. Reuses the agent-profile taxonomy; a
 * recognized profile type maps directly, anything else falls through to
 * `general`.
 *
 * NOTE: this does NOT re-run PATH_RULES file inference — that lives in
 * `agent-profiles.inferProfileType` and operates on a task's touched files, not
 * a todo's already-assigned `type` string. POOL-4 can call `typeForFiles`
 * below when it only has files.
 */
export function resolveType(todoType?: string | null): PoolType {
  if (!todoType) return 'general';
  if ((POOL_TYPES as readonly string[]).includes(todoType)) {
    // already a valid routing type (frontend/backend/api/ui/library/general)
    return todoType as PoolType;
  }
  if (todoType === 'default') return 'general';
  // Recognized agent-profile type? (e.g. a future profile-only type.)
  const known: AgentProfileType[] = ['default', 'frontend', 'backend', 'api', 'ui', 'library', 'cad'];
  if ((known as string[]).includes(todoType)) {
    return profileTypeToType(todoType as AgentProfileType);
  }
  return 'general';
}

/**
 * Convenience for POOL-4 when routing from a task's touched files instead of a
 * pre-assigned `type` string: defers to agent-profiles' PATH_RULES inference,
 * then maps the resulting profile type into routing-`type` space.
 */
export function typeForFiles(files: string[] | undefined | null): PoolType {
  return profileTypeToType(inferProfileType(files));
}

/**
 * Descriptive session name for a (type, provider, slot). `slot` is 1-based.
 * e.g. `poolSessionName('frontend')` → `frontend-claude-1`;
 *      `poolSessionName('backend', 'grok-build')` → `backend-grok-build-1`.
 *
 * PAW P3: the logical name now carries the PROVIDER dimension between the type
 * and the slot, so two providers of the same type occupy DISTINCT slots
 * (`backend-claude-1` ≠ `backend-grok-build-1`). Provider defaults to 'claude',
 * so existing callers that don't pass a provider still resolve to
 * `<type>-claude-<slot>`.
 *
 * COMPOSES with the per-project keying that landed separately on master (the
 * registry there is keyed `${project} ${sessionName}`): this only changes the
 * sessionName segment, leaving the project key dimension untouched — the eventual
 * 3-way merge just adds the leading `project` param alongside this provider one.
 */
export function poolSessionName(type: PoolType, provider: ProviderId = DEFAULT_PROVIDER_ID, slot = 1): string {
  return `${type}-${provider}-${slot}`;
}

// --- In-memory pool registry (POOL-4 consumes this) ---

export type SlotStatus = 'idle' | 'busy';

export interface PoolSlot {
  /** The project whose pool owns this slot. The registry is partitioned by
   *  project so concurrent projects don't contend for one shared set of slots —
   *  each project independently gets up to budget slots per type, and the same
   *  logical slot name (`backend-1`) can exist once per project. */
  project: string;
  type: PoolType;
  /** Provider this slot is tagged for (PAW P3). Defaults to 'claude'. A
   *  (type, provider) pair is the slot's identity, so `backend-claude-1` and
   *  `backend-grok-build-1` are distinct slots. */
  provider: ProviderId;
  /** 1-based slot index within the (type, provider). */
  slot: number;
  status: SlotStatus;
  /** The todo id the slot is currently working, when busy. */
  currentTodoId?: string;
  /** The full tmux base name backing this slot while busy. Recorded at markBusy
   *  so a slot can be reaped on its OWN worker's death, independent of any todo's
   *  status (a dropped/completed-out-of-band todo must still free its slot). */
  tmux?: string;
}

/** regKey (`<project> <sessionName>`) → slot. Module-level; no DB (intentional).
 *  Partitioned by project: the key combines the owning project with the logical
 *  session name so each project has its own pool of slots. The logical session
 *  name (`backend-1`) stays per-project-unscoped — the tmux layer scopes by
 *  project via tmuxBaseName(targetProject, poolName), so adding project here only
 *  (not to poolSessionName) avoids double-scoping. */
const registry = new Map<string, PoolSlot>();

/** Registry key for a slot: project + logical session name. */
function regKey(project: string, sessionName: string): string {
  return `${project} ${sessionName}`;
}

/** Reset the registry. Test-only helper; harmless in prod. */
export function resetPool(): void {
  registry.clear();
}

/**
 * Get an existing idle/busy slot for a type, or lazily create the next slot if
 * the type's slot budget (`config[type]`) has room. Returns the slot, or
 * `undefined` if the type is at capacity (all slots exist and are busy is a
 * separate concern — this only governs slot existence vs budget).
 *
 * Slots are created at the lowest free index (1..config[type]). A newly created
 * slot starts `idle`.
 */
export function getOrCreateSlot(
  project: string,
  type: PoolType,
  provider: ProviderId = DEFAULT_PROVIDER_ID,
  config: PoolConfig = POOL_CONFIG,
): PoolSlot | undefined {
  const budget = config[type] ?? 0;
  // Prefer an existing idle slot of this (type, provider) IN THIS PROJECT.
  const idle = findIdleSlotForType(project, type, provider);
  if (idle) return idle;
  // No idle slot — create the next one if this project's budget allows.
  for (let slot = 1; slot <= budget; slot++) {
    const name = poolSessionName(type, provider, slot);
    const key = regKey(project, name);
    if (!registry.has(key)) {
      const created: PoolSlot = { project, type, provider, slot, status: 'idle' };
      registry.set(key, created);
      return created;
    }
  }
  // All this project's slots exist (and none idle) — at capacity.
  return undefined;
}

/** All slots of a (type, provider) IN A PROJECT that are currently idle. */
function findIdleSlotForType(project: string, type: PoolType, provider: ProviderId = DEFAULT_PROVIDER_ID): PoolSlot | undefined {
  for (const s of registry.values()) {
    if (s.project === project && s.type === type && s.provider === provider && s.status === 'idle') return s;
  }
  return undefined;
}

/**
 * Find the session NAME of an idle slot for a (type, provider) IN A PROJECT
 * (what POOL-4 routes to), or `undefined` if none is idle/exists.
 */
export function findIdleSessionForType(project: string, type: PoolType, provider: ProviderId = DEFAULT_PROVIDER_ID): string | undefined {
  for (const s of registry.values()) {
    if (s.project === project && s.type === type && s.provider === provider && s.status === 'idle') {
      return poolSessionName(s.type, s.provider, s.slot);
    }
  }
  return undefined;
}

/** Inverse of `poolSessionName`: parse `<type>-<provider>-<slot>` back into its
 *  parts. `provider` may itself contain hyphens (e.g. `grok-build`), so the first
 *  token is the type, the last is the 1-based slot index, and everything between
 *  is the provider. Returns null when the name isn't a valid pool-lane name (a
 *  recognized PoolType + numeric slot) — e.g. an interactive/role session. */
export function parsePoolSessionName(
  sessionName: string,
): { type: PoolType; provider: ProviderId; slot: number } | null {
  const parts = sessionName.split('-');
  if (parts.length < 3) return null;
  const type = parts[0] as PoolType;
  if (!POOL_TYPES.includes(type)) return null;
  const slot = Number(parts[parts.length - 1]);
  if (!Number.isInteger(slot) || slot < 1) return null;
  const provider = parts.slice(1, -1).join('-') as ProviderId;
  if (!provider) return null;
  return { type, provider, slot };
}

/** Rebuild a BUSY slot in the registry from ground truth (a live tmux session
 *  matched to a claimed todo on sidecar restart — P3). Pure registry mutation, no
 *  tmux/IO. Idempotent: overwrites any existing entry for the key. Returns the
 *  restored slot, or null if `sessionName` isn't a parseable pool-lane name. */
export function restoreBusySlot(
  project: string,
  sessionName: string,
  todoId: string,
  tmux: string,
): PoolSlot | null {
  const parsed = parsePoolSessionName(sessionName);
  if (!parsed) return null;
  const slot: PoolSlot = {
    project,
    type: parsed.type,
    provider: parsed.provider,
    slot: parsed.slot,
    status: 'busy',
    currentTodoId: todoId,
    tmux,
  };
  registry.set(regKey(project, sessionName), slot);
  return slot;
}

/** Mark a session busy on a todo. Pass `tmux` (the slot's tmux base name) so the
 *  slot can be reaped on its worker's death independent of todo status. */
export function markBusy(project: string, sessionName: string, todoId: string, tmux?: string): PoolSlot | undefined {
  const s = registry.get(regKey(project, sessionName));
  if (!s) return undefined;
  s.status = 'busy';
  s.currentTodoId = todoId;
  if (tmux !== undefined) s.tmux = tmux;
  return s;
}

/** Mark a session idle (todo finished). Returns the slot, or undefined if unknown. */
export function markIdle(project: string, sessionName: string): PoolSlot | undefined {
  const s = registry.get(regKey(project, sessionName));
  if (!s) return undefined;
  s.status = 'idle';
  delete s.currentTodoId;
  delete s.tmux;
  return s;
}

/** Remove a slot from the registry entirely (not just mark idle). Used by the
 *  worker-isolation lifecycle: under isolation keep-warm is DROPPED — once a todo
 *  completes its worktree is removed and its session killed, so the slot must NOT
 *  linger as a reusable warm session. Dropping it lets getOrCreateSlot recreate a
 *  FRESH slot (→ a fresh session in a fresh worktree) for the next todo. Returns
 *  true if a slot was removed. No-op (false) for the non-isolation keep-warm path,
 *  which calls markIdle instead. */
export function removeSlot(project: string, sessionName: string): boolean {
  return registry.delete(regKey(project, sessionName));
}

/** Free every busy slot whose backing tmux session is dead. Decouples slot
 *  release from todo status: a slot orphaned by a dropped/abandoned todo (its
 *  worker gone) is reclaimed here so the pool doesn't wedge "busy" on a vanished
 *  session. `isAlive` is injected (tmux liveness check) to keep this pure. A busy
 *  slot with no recorded tmux is left alone (legacy/in-flight — the todo-level
 *  reaper still backstops it). Returns the freed session names. */
export async function reapDeadSlots(isAlive: (tmux: string) => boolean | Promise<boolean>): Promise<string[]> {
  const freed: string[] = [];
  // Snapshot busy slots first so we can await liveness without iterating the
  // registry while it may mutate. The predicate is async (944408c2: tmux liveness
  // is an async subprocess call now, never a blocking spawnSync on the sidecar).
  const busy = [...registry.entries()].filter(([, s]) => s.status === 'busy' && s.tmux);
  for (const [key, s] of busy) {
    if (!(await isAlive(s.tmux!))) {
      // Re-read in case it changed while awaiting. Key by the slot's stored
      // project so we re-read the same partitioned entry.
      const cur = registry.get(key);
      if (cur && cur.status === 'busy') {
        cur.status = 'idle';
        delete cur.currentTodoId;
        delete cur.tmux;
        // Report the logical session name (what callers route by).
        freed.push(poolSessionName(cur.type, cur.provider, cur.slot));
      }
    }
  }
  return freed;
}

/** Snapshot of the registry as an array of slots (shallow copies). Each entry
 *  carries its `project` and logical session name so callers can group/scope by
 *  project (the registry is partitioned by project). */
export function listPool(): Array<PoolSlot & { sessionName: string }> {
  const out: Array<PoolSlot & { sessionName: string }> = [];
  for (const s of registry.values()) {
    out.push({ ...s, sessionName: poolSessionName(s.type, s.provider, s.slot) });
  }
  return out;
}
