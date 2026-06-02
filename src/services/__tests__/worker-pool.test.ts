import { describe, it, expect, beforeEach } from 'bun:test';
import {
  POOL_TYPES,
  POOL_CONFIG,
  DEFAULT_SLOTS_PER_TYPE,
  poolSessionName,
  todoTypeToPoolType,
  profileTypeToPoolType,
  poolTypeForFiles,
  getOrCreateSlot,
  findIdleSessionForType,
  markBusy,
  markIdle,
  listPool,
  resetPool,
} from '../worker-pool';

describe('worker-pool config', () => {
  it('has 1 slot per type by default', () => {
    expect(DEFAULT_SLOTS_PER_TYPE).toBe(1);
    for (const t of POOL_TYPES) expect(POOL_CONFIG[t]).toBe(1);
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

describe('todoTypeToPoolType', () => {
  it('maps known profile types 1:1', () => {
    expect(todoTypeToPoolType('frontend')).toBe('frontend');
    expect(todoTypeToPoolType('backend')).toBe('backend');
    expect(todoTypeToPoolType('api')).toBe('api');
    expect(todoTypeToPoolType('ui')).toBe('ui');
    expect(todoTypeToPoolType('library')).toBe('library');
  });
  it('absorbs null/unknown/default/multi-domain into general', () => {
    expect(todoTypeToPoolType(null)).toBe('general');
    expect(todoTypeToPoolType(undefined)).toBe('general');
    expect(todoTypeToPoolType('')).toBe('general');
    expect(todoTypeToPoolType('default')).toBe('general');
    expect(todoTypeToPoolType('something-unknown')).toBe('general');
    expect(todoTypeToPoolType('general')).toBe('general');
  });
  it('profileTypeToPoolType remaps default→general', () => {
    expect(profileTypeToPoolType('default')).toBe('general');
    expect(profileTypeToPoolType('ui')).toBe('ui');
  });
  it('poolTypeForFiles infers via PATH_RULES then maps to pool space', () => {
    expect(poolTypeForFiles(['ui/src/App.tsx'])).toBe('ui');
    expect(poolTypeForFiles(undefined)).toBe('general'); // no files → default → general
    expect(poolTypeForFiles(['ui/App.tsx', 'src/services/x.ts'])).toBe('general'); // multi-domain
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
