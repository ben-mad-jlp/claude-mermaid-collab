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
} from '../worker-pool';

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
    const slot = getOrCreateSlot('frontend');
    expect(slot).toEqual({ type: 'frontend', slot: 1, status: 'idle' });
    expect(listPool()['frontend-1']).toBeDefined();
  });

  it('reuses the existing idle slot instead of creating a new one', () => {
    const a = getOrCreateSlot('backend');
    const b = getOrCreateSlot('backend');
    expect(a).toEqual(b!);
    expect(Object.keys(listPool())).toEqual(['backend-1']);
  });

  it('returns undefined when at capacity and no idle slot', () => {
    const slot = getOrCreateSlot('api');
    markBusy(poolSessionName('api'), 'todo-1');
    // budget is 1 and the only slot is busy → at capacity
    expect(getOrCreateSlot('api')).toBeUndefined();
  });

  it('markBusy / markIdle drive status + currentTodoId', () => {
    getOrCreateSlot('ui');
    expect(findIdleSessionForType('ui')).toBe('ui-1');

    const busy = markBusy('ui-1', 'todo-42');
    expect(busy).toEqual({ type: 'ui', slot: 1, status: 'busy', currentTodoId: 'todo-42' });
    expect(findIdleSessionForType('ui')).toBeUndefined();

    const idle = markIdle('ui-1');
    expect(idle).toEqual({ type: 'ui', slot: 1, status: 'idle' });
    expect(idle!.currentTodoId).toBeUndefined();
    expect(findIdleSessionForType('ui')).toBe('ui-1');
  });

  it('markBusy/markIdle return undefined for unknown sessions', () => {
    expect(markBusy('nope-1', 't')).toBeUndefined();
    expect(markIdle('nope-1')).toBeUndefined();
  });

  it('listPool snapshots are copies (no aliasing into registry)', () => {
    getOrCreateSlot('library');
    const snap = listPool();
    snap['library-1'].status = 'busy';
    expect(listPool()['library-1'].status).toBe('idle');
  });
});

describe('reapDeadSlots (889e3e26 — slot release decoupled from todo status)', () => {
  beforeEach(() => resetPool());

  it('frees a busy slot whose backing tmux is dead, leaving live ones alone', async () => {
    const a = getOrCreateSlot('backend')!;
    markBusy(poolSessionName(a.type, a.slot), 'todo-a', 'mc-proj-backend-1');
    expect(listPool()['backend-1'].status).toBe('busy');
    // backend at capacity (1 slot) → no new slot until the dead one is reaped.
    expect(getOrCreateSlot('backend')).toBeUndefined();

    // The worker's tmux vanished (dropped/abandoned todo, or killed lane). The
    // predicate is async now (944408c2: tmux liveness is a non-blocking subprocess).
    const freed = await reapDeadSlots(async (tmux) => tmux !== 'mc-proj-backend-1');
    expect(freed).toEqual(['backend-1']);
    expect(listPool()['backend-1'].status).toBe('idle');
    // Slot is reusable again — the wedge is gone.
    expect(getOrCreateSlot('backend')).toBeDefined();
  });

  it('leaves a busy slot with a LIVE tmux untouched', async () => {
    const s = getOrCreateSlot('frontend')!;
    markBusy(poolSessionName(s.type, s.slot), 'todo-x', 'mc-proj-frontend-1');
    const freed = await reapDeadSlots(async () => true); // all alive
    expect(freed).toEqual([]);
    expect(listPool()['frontend-1'].status).toBe('busy');
  });

  it('ignores a busy slot with no recorded tmux (legacy/in-flight backstop)', async () => {
    const s = getOrCreateSlot('api')!;
    markBusy(poolSessionName(s.type, s.slot), 'todo-y'); // no tmux recorded
    const freed = await reapDeadSlots(async () => false); // everything "dead"
    expect(freed).toEqual([]); // not reaped — todo-level reaper backstops it
    expect(listPool()['api-1'].status).toBe('busy');
  });
});
