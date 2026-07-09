import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, mock } from 'bun:test';

// Isolate the GLOBAL supervisor.db before any imports that touch it.
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'mc-land-excl-'));

// Mock todo-store so isHeadlessLeaf/headlessExclusionReason operate DB-free.
// Registered before import of coordinator-live so the mock intercepts the static
// import graph. listTodos returns empty (no children to any todo in this test).
mock.module('../todo-store', () => ({
  listReadyTodos: () => [],
  claimTodo: async () => null,
  releaseExpiredClaims: async () => {},
  completeTodo: async () => ({ completed: { sessionName: '' }, promoted: [], rolledUp: [] }),
  updateTodo: async () => ({}),
  resetTodo: async () => ({}),
  getTodo: () => null,
  listTodos: () => [],
  reclaimClaim: async () => 'ready',
  releaseClaim: async () => {},
  reclaimOrphan: async () => null,
}));

import { isHeadlessLeaf, headlessExclusionReason } from '../coordinator-live';
import type { Todo } from '../todo-store';

const PROJECT = '/tmp/mc-land-excl-project';

const leaf = (over: Partial<Todo>): Todo =>
  ({
    id: 'x',
    title: 'a leaf',
    assigneeKind: 'agent',
    type: 'backend',
    ...over,
  }) as Todo;

describe('[LAND] leaves are never headless-built (the merge-by-LLM trap)', () => {
  it('a [LAND] leaf with assigneeKind:"agent" is NOT a headless leaf', () => {
    expect(isHeadlessLeaf(leaf({ title: '[LAND] merge epic 028625a4 to master', assigneeKind: 'agent' }), PROJECT)).toBe(
      false,
    );
  });

  it('a [LAND] leaf with assigneeKind:"human" is also excluded (pre-G11a shield)', () => {
    expect(isHeadlessLeaf(leaf({ title: '[LAND] merge epic 028625a4 to master', assigneeKind: 'human' }), PROJECT)).toBe(
      false,
    );
  });

  it('[LAND] is case-insensitive and allows leading whitespace', () => {
    expect(isHeadlessLeaf(leaf({ title: '[land] lowercase' }), PROJECT)).toBe(false);
    expect(isHeadlessLeaf(leaf({ title: '[Land] mixed case' }), PROJECT)).toBe(false);
    expect(isHeadlessLeaf(leaf({ title: '  [LAND] leading space' }), PROJECT)).toBe(false);
    expect(isHeadlessLeaf(leaf({ title: '\t[LAND] leading tab' }), PROJECT)).toBe(false);
  });

  it('[EPIC] and [GATE] remain excluded alongside [LAND]', () => {
    expect(isHeadlessLeaf(leaf({ title: '[EPIC] some epic' }), PROJECT)).toBe(false);
    expect(isHeadlessLeaf(leaf({ title: '[GATE] some gate' }), PROJECT)).toBe(false);
  });

  it('an ordinary agent code leaf with no children is STILL admitted', () => {
    expect(isHeadlessLeaf(leaf({ title: 'fix: some code change' }), PROJECT)).toBe(true);
    expect(isHeadlessLeaf(leaf({ title: 'fix the landing page copy' }), PROJECT)).toBe(true);
    expect(isHeadlessLeaf(leaf({ title: '[FEAT] land the parachute' }), PROJECT)).toBe(true);
  });

  it('headlessExclusionReason returns the correct diagnostic for [LAND]', () => {
    expect(headlessExclusionReason(leaf({ title: '[LAND] merge' }), PROJECT)).toBe('epic-or-gate-or-land');
    expect(headlessExclusionReason(leaf({ title: '[land] merge' }), PROJECT)).toBe('epic-or-gate-or-land');
    expect(headlessExclusionReason(leaf({ title: '  [LAND] merge' }), PROJECT)).toBe('epic-or-gate-or-land');
  });

  it('headlessExclusionReason returns "human" for human-assigned leaves before checking title', () => {
    expect(headlessExclusionReason(leaf({ title: '[LAND] merge', assigneeKind: 'human' }), PROJECT)).toBe('human');
  });

  it('headlessExclusionReason returns null for an ordinary agent code leaf', () => {
    expect(headlessExclusionReason(leaf({ title: 'fix: some code' }), PROJECT)).toBe(null);
  });

  it('headlessExclusionReason and isHeadlessLeaf agree (inverse consistency)', () => {
    const testCases = [
      leaf({ title: '[LAND] merge epic to master' }),
      leaf({ title: '[EPIC] some epic' }),
      leaf({ title: '[GATE] some gate' }),
      leaf({ title: 'fix: code change' }),
      leaf({ title: 'Fix the landing page copy' }),
      leaf({ title: '[FEAT] land the parachute' }),
      leaf({ title: '[land] lowercase', assigneeKind: 'agent' }),
      leaf({ title: '[LAND] merge', assigneeKind: 'human' }),
    ];

    for (const todo of testCases) {
      const reason = headlessExclusionReason(todo, PROJECT);
      const isHeadless = isHeadlessLeaf(todo, PROJECT);
      // If reason is null, the leaf IS headless; if reason is non-null, it is NOT headless.
      expect(reason === null).toBe(isHeadless);
    }
  });
});
