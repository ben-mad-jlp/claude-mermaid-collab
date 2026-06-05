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

/**
 * Pool types = the agent-profile taxonomy, with the profile `default` concept
 * remapped to the pool's `general` slot (Q5: cross-type/untyped → a `general`
 * pool). Keep this aligned with `AgentProfileType` minus `default`, plus
 * `general`.
 */
export type PoolType =
  | 'frontend'
  | 'backend'
  | 'api'
  | 'ui'
  | 'library'
  | 'general';

/** All pool types, in a stable order (config defaults + iteration). */
export const POOL_TYPES: readonly PoolType[] = [
  'frontend',
  'backend',
  'api',
  'ui',
  'library',
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
  general: slotsFor('general', DEFAULT_SLOTS_PER_TYPE),
};

/**
 * Map an `AgentProfileType` to a `PoolType`. The only divergence is
 * `default` → `general` (the absorbing slot); every other profile type is a
 * 1:1 pool type.
 */
export function profileTypeToPoolType(profileType: AgentProfileType): PoolType {
  return profileType === 'default' ? 'general' : profileType;
}

/**
 * Map a todo's `type` string to a pool type. Null/unknown/`default`/multi-domain
 * → `general`. Reuses the agent-profile taxonomy; a recognized profile type maps
 * directly, anything else falls through to `general`.
 *
 * NOTE: this does NOT re-run PATH_RULES file inference — that lives in
 * `agent-profiles.inferProfileType` and operates on a task's touched files, not
 * a todo's already-assigned `type` string. POOL-4 can call `poolTypeForFiles`
 * below when it only has files.
 */
export function todoTypeToPoolType(todoType?: string | null): PoolType {
  if (!todoType) return 'general';
  if ((POOL_TYPES as readonly string[]).includes(todoType)) {
    // already a valid pool type (covers frontend/backend/api/ui/library/general)
    return todoType as PoolType;
  }
  if (todoType === 'default') return 'general';
  // Recognized agent-profile type? (e.g. a future profile-only type.)
  const known: AgentProfileType[] = ['default', 'frontend', 'backend', 'api', 'ui', 'library'];
  if ((known as string[]).includes(todoType)) {
    return profileTypeToPoolType(todoType as AgentProfileType);
  }
  return 'general';
}

/**
 * Convenience for POOL-4 when routing from a task's touched files instead of a
 * pre-assigned `type` string: defers to agent-profiles' PATH_RULES inference,
 * then maps the resulting profile type into pool space.
 */
export function poolTypeForFiles(files: string[] | undefined | null): PoolType {
  return profileTypeToPoolType(inferProfileType(files));
}

/**
 * Descriptive session name for a (type, slot). `slot` is 1-based.
 * e.g. `poolSessionName('frontend')` → `frontend-1`.
 */
export function poolSessionName(type: PoolType, slot = 1): string {
  return `${type}-${slot}`;
}

// --- In-memory pool registry (POOL-4 consumes this) ---

export type SlotStatus = 'idle' | 'busy';

export interface PoolSlot {
  type: PoolType;
  /** 1-based slot index within the type. */
  slot: number;
  status: SlotStatus;
  /** The todo id the slot is currently working, when busy. */
  currentTodoId?: string;
  /** The full tmux base name backing this slot while busy. Recorded at markBusy
   *  so a slot can be reaped on its OWN worker's death, independent of any todo's
   *  status (a dropped/completed-out-of-band todo must still free its slot). */
  tmux?: string;
}

/** sessionName (`frontend-1`) → slot. Module-level; no DB (intentional). */
const registry = new Map<string, PoolSlot>();

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
export function getOrCreateSlot(type: PoolType, config: PoolConfig = POOL_CONFIG): PoolSlot | undefined {
  const budget = config[type] ?? 0;
  // Prefer an existing idle slot of this type.
  const idle = findIdleSlotForType(type);
  if (idle) return idle;
  // No idle slot — create the next one if budget allows.
  for (let slot = 1; slot <= budget; slot++) {
    const name = poolSessionName(type, slot);
    if (!registry.has(name)) {
      const created: PoolSlot = { type, slot, status: 'idle' };
      registry.set(name, created);
      return created;
    }
  }
  // All slots exist (and none idle) — at capacity.
  return undefined;
}

/** All slots of a type that are currently idle. */
function findIdleSlotForType(type: PoolType): PoolSlot | undefined {
  for (const s of registry.values()) {
    if (s.type === type && s.status === 'idle') return s;
  }
  return undefined;
}

/**
 * Find the session NAME of an idle slot for a type (what POOL-4 routes to), or
 * `undefined` if none is idle/exists.
 */
export function findIdleSessionForType(type: PoolType): string | undefined {
  for (const [name, s] of registry.entries()) {
    if (s.type === type && s.status === 'idle') return name;
  }
  return undefined;
}

/** Mark a session busy on a todo. Pass `tmux` (the slot's tmux base name) so the
 *  slot can be reaped on its worker's death independent of todo status. */
export function markBusy(sessionName: string, todoId: string, tmux?: string): PoolSlot | undefined {
  const s = registry.get(sessionName);
  if (!s) return undefined;
  s.status = 'busy';
  s.currentTodoId = todoId;
  if (tmux !== undefined) s.tmux = tmux;
  return s;
}

/** Mark a session idle (todo finished). Returns the slot, or undefined if unknown. */
export function markIdle(sessionName: string): PoolSlot | undefined {
  const s = registry.get(sessionName);
  if (!s) return undefined;
  s.status = 'idle';
  delete s.currentTodoId;
  delete s.tmux;
  return s;
}

/** Free every busy slot whose backing tmux session is dead. Decouples slot
 *  release from todo status: a slot orphaned by a dropped/abandoned todo (its
 *  worker gone) is reclaimed here so the pool doesn't wedge "busy" on a vanished
 *  session. `isAlive` is injected (tmux liveness check) to keep this pure. A busy
 *  slot with no recorded tmux is left alone (legacy/in-flight — the todo-level
 *  reaper still backstops it). Returns the freed session names. */
export function reapDeadSlots(isAlive: (tmux: string) => boolean): string[] {
  const freed: string[] = [];
  for (const [name, s] of registry.entries()) {
    if (s.status === 'busy' && s.tmux && !isAlive(s.tmux)) {
      s.status = 'idle';
      delete s.currentTodoId;
      delete s.tmux;
      freed.push(name);
    }
  }
  return freed;
}

/** Snapshot of the registry: sessionName → slot (shallow copies). */
export function listPool(): Record<string, PoolSlot> {
  const out: Record<string, PoolSlot> = {};
  for (const [name, s] of registry.entries()) out[name] = { ...s };
  return out;
}
