import { describe, it, expect, beforeEach } from 'bun:test';
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
  reapDeadSlots,
  type PoolSlot,
} from '../worker-pool';

// listPool now returns a project-partitioned array; this helper finds the slot
// for a (project, sessionName) pair the way callers scope their readouts.
function slotOf(project: string, sessionName: string): (PoolSlot & { sessionName: string }) | undefined {
  return listPool().find((s) => s.project === project && s.sessionName === sessionName);
}

// A single test project for the legacy single-pool transition tests.
const P = '/proj/main';

describe('worker-pool config', () => {
  it('defaults to 1 slot per type, except frontend (3)', () => {
    expect(DEFAULT_SLOTS_PER_TYPE).toBe(1);
    expect(POOL_CONFIG.frontend).toBe(3); // intentional: parallel UI work
    for (const t of POOL_TYPES) if (t !== 'frontend') expect(POOL_CONFIG[t]).toBe(1);
  });
});

describe('poolSessionName', () => {
  it('derives descriptive names defaulting to slot 1', () => {
    expect(poolSessionName('frontend')).toBe('frontend-1');
    expect(poolSessionName('backend')).toBe('backend-1');
    expect(poolSessionName('api')).toBe('api-1');
    expect(poolSessionName('ui')).toBe('ui-1');
    expect(poolSessionName('library')).toBe('library-1');
    expect(poolSessionName('general')).toBe('general-1');
  });
  it('respects explicit slot index', () => {
    expect(poolSessionName('frontend', 2)).toBe('frontend-2');
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

  it('lazily creates a slot and starts idle', () => {
    const slot = getOrCreateSlot(P, 'frontend');
    expect(slot).toEqual({ project: P, type: 'frontend', slot: 1, status: 'idle' });
    expect(slotOf(P, 'frontend-1')).toBeDefined();
  });

  it('reuses the existing idle slot instead of creating a new one', () => {
    const a = getOrCreateSlot(P, 'backend');
    const b = getOrCreateSlot(P, 'backend');
    expect(a).toEqual(b!);
    expect(listPool().map((s) => s.sessionName)).toEqual(['backend-1']);
  });

  it('returns undefined when at capacity and no idle slot', () => {
    getOrCreateSlot(P, 'api');
    markBusy(P, poolSessionName('api'), 'todo-1');
    // budget is 1 and the only slot is busy → at capacity
    expect(getOrCreateSlot(P, 'api')).toBeUndefined();
  });

  it('markBusy / markIdle drive status + currentTodoId', () => {
    getOrCreateSlot(P, 'ui');
    expect(findIdleSessionForType(P, 'ui')).toBe('ui-1');

    const busy = markBusy(P, 'ui-1', 'todo-42');
    expect(busy).toEqual({ project: P, type: 'ui', slot: 1, status: 'busy', currentTodoId: 'todo-42' });
    expect(findIdleSessionForType(P, 'ui')).toBeUndefined();

    const idle = markIdle(P, 'ui-1');
    expect(idle).toEqual({ project: P, type: 'ui', slot: 1, status: 'idle' });
    expect(idle!.currentTodoId).toBeUndefined();
    expect(findIdleSessionForType(P, 'ui')).toBe('ui-1');
  });

  it('markBusy/markIdle return undefined for unknown sessions', () => {
    expect(markBusy(P, 'nope-1', 't')).toBeUndefined();
    expect(markIdle(P, 'nope-1')).toBeUndefined();
  });

  it('listPool snapshots are copies (no aliasing into registry)', () => {
    getOrCreateSlot(P, 'library');
    const snap = listPool();
    snap.find((s) => s.sessionName === 'library-1')!.status = 'busy';
    expect(slotOf(P, 'library-1')!.status).toBe('idle');
  });
});

describe('pool registry is partitioned by project (P0 regression — multi-project contention)', () => {
  beforeEach(() => resetPool());

  it('gives each project its OWN pool: same logical name, different project, no cross-project starvation', () => {
    const A = '/proj/A';
    const B = '/proj/B';

    // Each project independently gets a backend-1 slot (same logical name).
    const a = getOrCreateSlot(A, 'backend');
    const b = getOrCreateSlot(B, 'backend');
    expect(a).toEqual({ project: A, type: 'backend', slot: 1, status: 'idle' });
    expect(b).toEqual({ project: B, type: 'backend', slot: 1, status: 'idle' });
    // Distinct registry entries despite the identical session name.
    expect(slotOf(A, 'backend-1')).toBeDefined();
    expect(slotOf(B, 'backend-1')).toBeDefined();

    // Both can be busy simultaneously — they do not contend for one shared slot.
    markBusy(A, 'backend-1', 'todo-A');
    markBusy(B, 'backend-1', 'todo-B');
    expect(slotOf(A, 'backend-1')!.status).toBe('busy');
    expect(slotOf(A, 'backend-1')!.currentTodoId).toBe('todo-A');
    expect(slotOf(B, 'backend-1')!.status).toBe('busy');
    expect(slotOf(B, 'backend-1')!.currentTodoId).toBe('todo-B');

    // An idle lookup for project A never returns project B's slot.
    expect(findIdleSessionForType(A, 'backend')).toBeUndefined(); // A's only slot is busy
    expect(findIdleSessionForType(B, 'backend')).toBeUndefined(); // B's only slot is busy

    // With budget=1, project A at capacity must NOT starve project B: B still has
    // its own free slot available (and vice-versa) until each fills its own pool.
    expect(getOrCreateSlot(A, 'backend')).toBeUndefined(); // A at its own capacity
    markIdle(B, 'backend-1');
    expect(findIdleSessionForType(B, 'backend')).toBe('backend-1'); // B independently idle
    expect(findIdleSessionForType(A, 'backend')).toBeUndefined();    // A still busy — unaffected
  });
});

describe('reapDeadSlots (889e3e26 — slot release decoupled from todo status)', () => {
  beforeEach(() => resetPool());

  it('frees a busy slot whose backing tmux is dead, leaving live ones alone', async () => {
    const a = getOrCreateSlot(P, 'backend')!;
    markBusy(P, poolSessionName(a.type, a.slot), 'todo-a', 'mc-proj-backend-1');
    expect(slotOf(P, 'backend-1')!.status).toBe('busy');
    // backend at capacity (1 slot) → no new slot until the dead one is reaped.
    expect(getOrCreateSlot(P, 'backend')).toBeUndefined();

    // The worker's tmux vanished (dropped/abandoned todo, or killed lane). The
    // predicate is async now (944408c2: tmux liveness is a non-blocking subprocess).
    const freed = await reapDeadSlots(async (tmux) => tmux !== 'mc-proj-backend-1');
    expect(freed).toEqual(['backend-1']);
    expect(slotOf(P, 'backend-1')!.status).toBe('idle');
    // Slot is reusable again — the wedge is gone.
    expect(getOrCreateSlot(P, 'backend')).toBeDefined();
  });

  it('leaves a busy slot with a LIVE tmux untouched', async () => {
    const s = getOrCreateSlot(P, 'frontend')!;
    markBusy(P, poolSessionName(s.type, s.slot), 'todo-x', 'mc-proj-frontend-1');
    const freed = await reapDeadSlots(async () => true); // all alive
    expect(freed).toEqual([]);
    expect(slotOf(P, 'frontend-1')!.status).toBe('busy');
  });

  it('ignores a busy slot with no recorded tmux (legacy/in-flight backstop)', async () => {
    const s = getOrCreateSlot(P, 'api')!;
    markBusy(P, poolSessionName(s.type, s.slot), 'todo-y'); // no tmux recorded
    const freed = await reapDeadSlots(async () => false); // everything "dead"
    expect(freed).toEqual([]); // not reaped — todo-level reaper backstops it
    expect(slotOf(P, 'api-1')!.status).toBe('busy');
  });

  it('reaps across projects, keying each slot by its own stored project', async () => {
    const A = '/proj/A';
    const B = '/proj/B';
    getOrCreateSlot(A, 'backend');
    getOrCreateSlot(B, 'backend');
    markBusy(A, 'backend-1', 'todo-A', 'A-backend-1');
    markBusy(B, 'backend-1', 'todo-B', 'B-backend-1');
    // Only A's tmux is dead.
    const freed = await reapDeadSlots(async (tmux) => tmux !== 'A-backend-1');
    expect(freed).toEqual(['backend-1']); // logical name reported
    expect(slotOf(A, 'backend-1')!.status).toBe('idle'); // A freed
    expect(slotOf(B, 'backend-1')!.status).toBe('busy'); // B untouched
  });
});
