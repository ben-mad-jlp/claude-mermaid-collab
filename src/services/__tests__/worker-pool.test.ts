import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  POOL_TYPES,
  POOL_CONFIG,
  DEFAULT_SLOTS_PER_TYPE,
  poolSessionName,
  resolveType,
  profileTypeToType,
  typeForFiles,
  getOrCreateSlot,
  findIdleSessionForType,
  markBusy,
  markIdle,
  listPool,
  resetPool,
  removeSlot,
  poolConfigForSize,
  type PoolSlot,
} from '../worker-pool';
import { reserveLeafSlot, totalWorkersActive, _resetLeafSlots } from '../inflight-limiter';

// Single-slot config: pins capacity tests to budget=1 so they exercise the
// at-capacity gate independent of the (now 3) default slots-per-type.
const CFG1 = poolConfigForSize(1);

// listPool now returns a project-partitioned array; this helper finds the slot
// for a (project, sessionName) pair the way callers scope their readouts.
function slotOf(project: string, sessionName: string): (PoolSlot & { sessionName: string }) | undefined {
  return listPool().find((s) => s.project === project && s.sessionName === sessionName);
}

// A single test project for the legacy single-pool transition tests.
const P = '/proj/main';

describe('worker-pool config', () => {
  it('defaults to 3 slots per type (fan out by default; raise per-project)', () => {
    expect(DEFAULT_SLOTS_PER_TYPE).toBe(3);
    // POOL_CONFIG itself is env-tunable (MERMAID_POOL_<TYPE>), so assert the
    // default constant rather than the resolved map.
  });

  it('poolConfigForSize expands to a uniform per-type config, clamped to [1,16]', () => {
    const cfg = poolConfigForSize(5);
    for (const t of POOL_TYPES) expect(cfg[t]).toBe(5);
    // clamp: below 1 → 1; above MAX (16) → 16; non-finite → 1.
    for (const t of POOL_TYPES) expect(poolConfigForSize(0)[t]).toBe(1);
    for (const t of POOL_TYPES) expect(poolConfigForSize(999)[t]).toBe(16);
    for (const t of POOL_TYPES) expect(poolConfigForSize(NaN)[t]).toBe(1);
  });
});

describe('poolSessionName', () => {
  it('derives provider-tagged names defaulting to claude + slot 1 (PAW P3)', () => {
    expect(poolSessionName('frontend')).toBe('frontend-claude-1');
    expect(poolSessionName('backend')).toBe('backend-claude-1');
    expect(poolSessionName('api')).toBe('api-claude-1');
    expect(poolSessionName('ui')).toBe('ui-claude-1');
    expect(poolSessionName('library')).toBe('library-claude-1');
    expect(poolSessionName('general')).toBe('general-claude-1');
  });
  it('carries the provider dimension between type and slot', () => {
    expect(poolSessionName('backend', 'grok-build')).toBe('backend-grok-build-1');
    expect(poolSessionName('backend', 'codex', 2)).toBe('backend-codex-2');
  });
  it('respects explicit slot index (default provider)', () => {
    expect(poolSessionName('frontend', 'claude', 2)).toBe('frontend-claude-2');
  });
});

describe('resolveType', () => {
  it('maps known profile types 1:1', () => {
    expect(resolveType('frontend')).toBe('frontend');
    expect(resolveType('backend')).toBe('backend');
    expect(resolveType('api')).toBe('api');
    expect(resolveType('ui')).toBe('ui');
    expect(resolveType('library')).toBe('library');
    expect(resolveType('cad')).toBe('cad'); // CAD is a first-class routing type, not → general
  });
  it('absorbs null/unknown/default/multi-domain into general', () => {
    expect(resolveType(null)).toBe('general');
    expect(resolveType(undefined)).toBe('general');
    expect(resolveType('')).toBe('general');
    expect(resolveType('default')).toBe('general');
    expect(resolveType('something-unknown')).toBe('general');
    expect(resolveType('general')).toBe('general');
  });
  it('profileTypeToType remaps default→general', () => {
    expect(profileTypeToType('default')).toBe('general');
    expect(profileTypeToType('ui')).toBe('ui');
  });
  it('typeForFiles infers via PATH_RULES then maps to routing-type space', () => {
    expect(typeForFiles(['ui/src/App.tsx'])).toBe('ui');
    expect(typeForFiles(['parts/arm.py'])).toBe('cad'); // CAD dirs / .py → cad pool
    expect(typeForFiles(undefined)).toBe('general'); // no files → default → general
    expect(typeForFiles(['ui/App.tsx', 'src/services/x.ts'])).toBe('general'); // multi-domain
  });
});

describe('pool registry transitions', () => {
  beforeEach(() => resetPool());

  it('lazily creates a slot and starts idle (provider-tagged)', () => {
    const slot = getOrCreateSlot(P, 'frontend');
    expect(slot).toEqual({ project: P, type: 'frontend', provider: 'claude', slot: 1, status: 'idle' });
    expect(slotOf(P, 'frontend-claude-1')).toBeDefined();
  });

  it('reuses the existing idle slot instead of creating a new one', () => {
    const a = getOrCreateSlot(P, 'backend');
    const b = getOrCreateSlot(P, 'backend');
    expect(a).toEqual(b!);
    expect(listPool().map((s) => s.sessionName)).toEqual(['backend-claude-1']);
  });

  it('PAW P3: backend-claude-1 and backend-grok-build-1 are DISTINCT slots', () => {
    const claude = getOrCreateSlot(P, 'backend', 'claude');
    const grok = getOrCreateSlot(P, 'backend', 'grok-build');
    expect(claude).toEqual({ project: P, type: 'backend', provider: 'claude', slot: 1, status: 'idle' });
    expect(grok).toEqual({ project: P, type: 'backend', provider: 'grok-build', slot: 1, status: 'idle' });
    // Two separate lanes co-exist — provider tagging did not collide them.
    expect(listPool().map((s) => s.sessionName).sort()).toEqual(['backend-claude-1', 'backend-grok-build-1']);
    // A busy claude slot does not block grok (independent budgets per provider).
    markBusy(P, 'backend-claude-1', 'todo-c');
    expect(findIdleSessionForType(P, 'backend', 'grok-build')).toBe('backend-grok-build-1');
    expect(findIdleSessionForType(P, 'backend', 'claude')).toBeUndefined();
  });

  it('returns undefined when at capacity and no idle slot', () => {
    getOrCreateSlot(P, 'api', 'claude', CFG1);
    markBusy(P, poolSessionName('api'), 'todo-1');
    // budget pinned to 1 and the only slot is busy → at capacity
    expect(getOrCreateSlot(P, 'api', 'claude', CFG1)).toBeUndefined();
  });

  it('markBusy / markIdle drive status + currentTodoId', () => {
    getOrCreateSlot(P, 'ui');
    expect(findIdleSessionForType(P, 'ui')).toBe('ui-claude-1');

    const busy = markBusy(P, 'ui-claude-1', 'todo-42');
    expect(busy).toEqual({ project: P, type: 'ui', provider: 'claude', slot: 1, status: 'busy', currentTodoId: 'todo-42' });
    expect(findIdleSessionForType(P, 'ui')).toBeUndefined();

    const idle = markIdle(P, 'ui-claude-1');
    expect(idle).toEqual({ project: P, type: 'ui', provider: 'claude', slot: 1, status: 'idle' });
    expect(idle!.currentTodoId).toBeUndefined();
    expect(findIdleSessionForType(P, 'ui')).toBe('ui-claude-1');
  });

  it('markBusy/markIdle return undefined for unknown sessions', () => {
    expect(markBusy(P, 'nope-1', 't')).toBeUndefined();
    expect(markIdle(P, 'nope-1')).toBeUndefined();
  });

  it('listPool snapshots are copies (no aliasing into registry)', () => {
    getOrCreateSlot(P, 'library');
    const snap = listPool();
    snap.find((s) => s.sessionName === 'library-claude-1')!.status = 'busy';
    expect(slotOf(P, 'library-claude-1')!.status).toBe('idle');
  });
});

describe('pool registry is partitioned by project (P0 regression — multi-project contention)', () => {
  beforeEach(() => resetPool());

  it('gives each project its OWN pool: same logical name, different project, no cross-project starvation', () => {
    const A = '/proj/A';
    const B = '/proj/B';

    // Each project independently gets a backend-claude-1 slot (same logical name).
    const a = getOrCreateSlot(A, 'backend', 'claude', CFG1);
    const b = getOrCreateSlot(B, 'backend', 'claude', CFG1);
    expect(a).toEqual({ project: A, type: 'backend', provider: 'claude', slot: 1, status: 'idle' });
    expect(b).toEqual({ project: B, type: 'backend', provider: 'claude', slot: 1, status: 'idle' });
    // Distinct registry entries despite the identical session name.
    expect(slotOf(A, 'backend-claude-1')).toBeDefined();
    expect(slotOf(B, 'backend-claude-1')).toBeDefined();

    // Both can be busy simultaneously — they do not contend for one shared slot.
    markBusy(A, 'backend-claude-1', 'todo-A');
    markBusy(B, 'backend-claude-1', 'todo-B');
    expect(slotOf(A, 'backend-claude-1')!.status).toBe('busy');
    expect(slotOf(A, 'backend-claude-1')!.currentTodoId).toBe('todo-A');
    expect(slotOf(B, 'backend-claude-1')!.status).toBe('busy');
    expect(slotOf(B, 'backend-claude-1')!.currentTodoId).toBe('todo-B');

    // An idle lookup for project A never returns project B's slot.
    expect(findIdleSessionForType(A, 'backend')).toBeUndefined(); // A's only slot is busy
    expect(findIdleSessionForType(B, 'backend')).toBeUndefined(); // B's only slot is busy

    // With budget=1, project A at capacity must NOT starve project B: B still has
    // its own free slot available (and vice-versa) until each fills its own pool.
    expect(getOrCreateSlot(A, 'backend', 'claude', CFG1)).toBeUndefined(); // A at its own capacity
    markIdle(B, 'backend-claude-1');
    expect(findIdleSessionForType(B, 'backend')).toBe('backend-claude-1'); // B independently idle
    expect(findIdleSessionForType(A, 'backend')).toBeUndefined();    // A still busy — unaffected
  });
});

describe('machine-wide total-worker cap wiring (capacity-fixes FIX 2)', () => {
  beforeEach(() => {
    resetPool();
    _resetLeafSlots();
    process.env.MERMAID_MAX_WORKERS_TOTAL = '3';
  });
  afterEach(() => {
    delete process.env.MERMAID_MAX_WORKERS_TOTAL;
    resetPool();
    _resetLeafSlots();
  });

  it('counts newly-created pool slots into the shared total-worker count', () => {
    expect(totalWorkersActive()).toBe(0);
    getOrCreateSlot(P, 'frontend', 'claude', CFG1);
    expect(totalWorkersActive()).toBe(1);
  });

  it('refuses to create a new pool slot once the combined cap (pool + headless) is hit', () => {
    // 2 headless leaves reserved elsewhere in the machine…
    expect(reserveLeafSlot('/proj/other-a')).toBe(true);
    expect(reserveLeafSlot('/proj/other-b')).toBe(true);
    expect(totalWorkersActive()).toBe(2);

    // …leaves room for exactly one more pool slot before the cap (3) is hit.
    const cfg3 = poolConfigForSize(3);
    const first = getOrCreateSlot(P, 'frontend', 'claude', cfg3);
    expect(first).toBeDefined();
    expect(totalWorkersActive()).toBe(3);

    // A second NEW slot (different type, so budget/idle-reuse isn't the blocker) is
    // refused — fail-closed at the machine-wide ceiling.
    const second = getOrCreateSlot(P, 'backend', 'claude', cfg3);
    expect(second).toBeUndefined();
  });

  it('reusing an existing idle slot does not consume additional total-worker headroom', () => {
    const cfg3 = poolConfigForSize(3);
    getOrCreateSlot(P, 'frontend', 'claude', cfg3); // 1 pool slot
    expect(reserveLeafSlot('/proj/other-a')).toBe(true);
    expect(reserveLeafSlot('/proj/other-b')).toBe(true); // total = 3 = cap
    // Reusing the existing idle frontend slot must succeed even at the cap — it
    // isn't a NEW worker.
    const reused = getOrCreateSlot(P, 'frontend', 'claude', cfg3);
    expect(reused).toBeDefined();
    expect(totalWorkersActive()).toBe(3);
  });

  it('removeSlot frees total-worker headroom for a subsequent creation', () => {
    const cfg3 = poolConfigForSize(3);
    getOrCreateSlot(P, 'frontend', 'claude', cfg3);
    expect(reserveLeafSlot('/proj/other-a')).toBe(true);
    expect(reserveLeafSlot('/proj/other-b')).toBe(true);
    expect(getOrCreateSlot(P, 'backend', 'claude', cfg3)).toBeUndefined(); // at cap

    removeSlot(P, 'frontend-claude-1');
    expect(totalWorkersActive()).toBe(2);
    expect(getOrCreateSlot(P, 'backend', 'claude', cfg3)).toBeDefined(); // headroom freed
  });
});
