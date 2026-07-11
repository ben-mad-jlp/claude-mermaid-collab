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
    kind: 'leaf',
    assigneeKind: 'agent',
    type: 'backend',
    ...over,
  }) as Todo;

describe('land leaves are never headless-built (the merge-by-LLM trap)', () => {
  it('a land leaf with assigneeKind:"agent" is NOT a headless leaf', () => {
    expect(
      isHeadlessLeaf(leaf({ kind: 'land', title: 'merge epic 028625a4 to master', assigneeKind: 'agent' }), PROJECT),
    ).toBe(false);
  });

  it('a land leaf with assigneeKind:"human" is also excluded (pre-G11a shield)', () => {
    expect(
      isHeadlessLeaf(leaf({ kind: 'land', title: 'merge epic 028625a4 to master', assigneeKind: 'human' }), PROJECT),
    ).toBe(false);
  });

  it('the land exclusion keys off `kind`, not the title — a leaf titled "[LAND] ..." is not special', () => {
    // The inverse of the trap: `kind` is authoritative now. A land NODE is excluded
    // whatever its title says; a leaf whose title merely mentions landing is not.
    expect(isHeadlessLeaf(leaf({ kind: 'land', title: 'no bracket in sight' }), PROJECT)).toBe(false);
    expect(isHeadlessLeaf(leaf({ kind: 'leaf', title: '[FEAT] land the parachute' }), PROJECT)).toBe(true);
    expect(isHeadlessLeaf(leaf({ kind: 'leaf', title: 'fix the landing page copy' }), PROJECT)).toBe(true);
  });

  it('epic, mission and [GATE] remain excluded alongside land', () => {
    expect(isHeadlessLeaf(leaf({ kind: 'epic', title: 'some epic' }), PROJECT)).toBe(false);
    expect(isHeadlessLeaf(leaf({ kind: 'mission', title: 'some mission' }), PROJECT)).toBe(false);
    expect(isHeadlessLeaf(leaf({ kind: 'gate', title: 'some gate' }), PROJECT)).toBe(false);
  });

  it('an ordinary agent code leaf with no children is STILL admitted', () => {
    expect(isHeadlessLeaf(leaf({ title: 'fix: some code change' }), PROJECT)).toBe(true);
  });

  it('headlessExclusionReason returns the correct diagnostic per kind', () => {
    expect(headlessExclusionReason(leaf({ kind: 'land', title: 'merge' }), PROJECT)).toBe('land');
    expect(headlessExclusionReason(leaf({ kind: 'epic', title: 'e' }), PROJECT)).toBe('epic-or-mission');
    expect(headlessExclusionReason(leaf({ kind: 'mission', title: 'm' }), PROJECT)).toBe('epic-or-mission');
    expect(headlessExclusionReason(leaf({ kind: 'gate', title: 'g' }), PROJECT)).toBe('gate');
  });

  it('headlessExclusionReason returns "human" for human-assigned leaves before checking kind', () => {
    expect(headlessExclusionReason(leaf({ kind: 'land', title: 'merge', assigneeKind: 'human' }), PROJECT)).toBe(
      'human',
    );
  });

  it('headlessExclusionReason returns null for an ordinary agent code leaf', () => {
    expect(headlessExclusionReason(leaf({ title: 'fix: some code' }), PROJECT)).toBe(null);
  });

  it('headlessExclusionReason and isHeadlessLeaf agree (inverse consistency)', () => {
    const testCases = [
      leaf({ kind: 'land', title: 'merge epic to master' }),
      leaf({ kind: 'epic', title: 'some epic' }),
      leaf({ kind: 'mission', title: 'some mission' }),
      leaf({ kind: 'gate', title: 'some gate' }),
      leaf({ kind: 'leaf', title: 'fix: code change' }),
      leaf({ kind: 'leaf', title: 'Fix the landing page copy' }),
      leaf({ kind: 'leaf', title: '[FEAT] land the parachute' }),
      leaf({ kind: 'land', title: 'merge', assigneeKind: 'human' }),
    ];

    for (const todo of testCases) {
      const reason = headlessExclusionReason(todo, PROJECT);
      const isHeadless = isHeadlessLeaf(todo, PROJECT);
      // If reason is null, the leaf IS headless; if reason is non-null, it is NOT headless.
      expect(reason === null).toBe(isHeadless);
    }
  });
});
