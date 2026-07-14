import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// Isolate the GLOBAL supervisor.db before any imports that touch it.
const supervisorDir = mkdtempSync(join(tmpdir(), 'mc-epic-autoland-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

// Mock mission-store before importing coordinator-live.
// getMission is called with (project, todoId) and returns a MissionRow or undefined.
const missions = new Map<string, { status: string; active: boolean; abandonedAt: number | null }>();

mock.module('../mission-store', () => ({
  getMission: (project: string, todoId: string) => {
    const m = missions.get(todoId);
    if (!m) return undefined;
    return {
      todoId,
      status: m.status,
      active: m.active,
      abandonedAt: m.abandonedAt,
      createdAt: 0,
      updatedAt: 0,
      lastNudgeAt: null,
    };
  },
  isMissionTerminal: (m: { status: string; abandonedAt: number | null }) => m.abandonedAt != null || m.status === 'converged',
}));

// Mock todo-store so no real SQLite is touched.
mock.module('../todo-store', () => ({
  listTodos: () => [],
  listReadyTodos: () => [],
  claimTodo: async () => null,
  releaseExpiredClaims: async () => {},
  completeTodo: async () => ({ completed: { sessionName: '' }, promoted: [], rolledUp: [] }),
  updateTodo: async () => ({}),
  resetTodo: async () => ({}),
  getTodo: () => null,
  reclaimClaim: async () => 'ready',
  releaseClaim: async () => {},
  reclaimOrphan: async () => null,
}));

import { epicAutoLandAuthority, todoIsMissionScoped } from '../coordinator-live';
import type { Todo } from '../todo-store';

afterAll(() => {
  delete process.env.MERMAID_SUPERVISOR_DIR;
  try { rmSync(supervisorDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

const PROJECT = '/tmp/mc-epic-autoland-project';

// ============================================================================
// Fixtures: todo() builder, missions registry
// ============================================================================

let seq = 0;

function inferKind(title: string): Todo['kind'] {
  if (/^\s*\[MISSION\]/i.test(title)) return 'mission';
  if (/^\s*\[EPIC\]/i.test(title)) return 'epic';
  if (/^\s*\[LAND\]/i.test(title)) return 'land';
  return 'leaf';
}

function todo(partial: Partial<Todo> & { id?: string; title: string }): Todo {
  const { title, id, status: statusOverride, ...rest } = partial;
  const status = statusOverride ?? ('ready' as const);
  return {
    id: id ?? `t${++seq}`,
    title,
    kind: inferKind(title),
    isBucket: false,
    ownerSession: 's',
    assigneeSession: null,
    assigneeKind: 'agent',
    description: null,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    sessionName: null,
    executedBySession: null,
    blueprintId: null,
    type: null,
    targetProject: null,
    acceptanceStatus: null,
    claimedBy: null,
    claimToken: null,
    claimedAt: null,
    claimLeaseMs: null,
    claim: null,
    approvedAt: null,
    approvedBy: null,
    heldAt: null,
    heldReason: null,
    retryCount: 0,
    completedBy: null,
    objectRef: null,
    decisionRef: null,
    claimProbe: null,
    status,
    completed: status === 'done',
    ...rest,
  } as Todo;
}

/**
 * Build a graph:
 *   [MISSION] m1 (active, non-terminal)
 *     └─ [EPIC] e1
 */
function mkActiveGraph() {
  const m1 = todo({ id: 'm1', title: '[MISSION] converge', status: 'ready' });
  const e1 = todo({ id: 'e1', title: '[EPIC] the work', parentId: 'm1', status: 'ready' });
  missions.set('m1', { status: 'needs-discovery', active: true, abandonedAt: null });
  return { m1, e1 };
}

// ============================================================================
// Test Suites
// ============================================================================

describe('epicAutoLandAuthority', () => {
  beforeEach(() => {
    seq = 0;
    missions.clear();
  });

  it('REGRESSION PIN: active mission epic → true', () => {
    const { m1, e1 } = mkActiveGraph();
    const result = epicAutoLandAuthority(PROJECT, 'e1', [m1, e1]);
    expect(result).toBe(true);
  });

  it('non-mission epic (no mission ancestor) → false', () => {
    const e1 = todo({ id: 'e1', title: '[EPIC] orphan epic', status: 'ready' });
    const result = epicAutoLandAuthority(PROJECT, 'e1', [e1]);
    expect(result).toBe(false);
  });

  it('BRAKE PIN: terminal mission (status: converged) + epic → false', () => {
    const m1 = todo({ id: 'm1', title: '[MISSION] converge', status: 'ready' });
    const e1 = todo({ id: 'e1', title: '[EPIC] the work', parentId: 'm1', status: 'ready' });
    missions.set('m1', { status: 'converged', active: true, abandonedAt: null });
    const result = epicAutoLandAuthority(PROJECT, 'e1', [m1, e1]);
    expect(result).toBe(false);
  });

  it('BRAKE PIN: inactive mission (active: false) + epic → false', () => {
    const m1 = todo({ id: 'm1', title: '[MISSION] converge', status: 'ready' });
    const e1 = todo({ id: 'e1', title: '[EPIC] the work', parentId: 'm1', status: 'ready' });
    missions.set('m1', { status: 'needs-discovery', active: false, abandonedAt: null });
    const result = epicAutoLandAuthority(PROJECT, 'e1', [m1, e1]);
    expect(result).toBe(false);
  });

  it('abandoned mission (abandonedAt != null) + epic → false', () => {
    const m1 = todo({ id: 'm1', title: '[MISSION] converge', status: 'ready' });
    const e1 = todo({ id: 'e1', title: '[EPIC] the work', parentId: 'm1', status: 'ready' });
    missions.set('m1', { status: 'needs-discovery', active: true, abandonedAt: 1000 });
    const result = epicAutoLandAuthority(PROJECT, 'e1', [m1, e1]);
    expect(result).toBe(false);
  });

  it('mission row missing entirely (not in registry) → false', () => {
    const m1 = todo({ id: 'm1', title: '[MISSION] converge', status: 'ready' });
    const e1 = todo({ id: 'e1', title: '[EPIC] the work', parentId: 'm1', status: 'ready' });
    missions.clear();
    const result = epicAutoLandAuthority(PROJECT, 'e1', [m1, e1]);
    expect(result).toBe(false);
  });
});

describe('todoIsMissionScoped', () => {
  beforeEach(() => {
    seq = 0;
    missions.clear();
  });

  it('mission leaf → true', () => {
    const { m1, e1 } = mkActiveGraph();
    const l1 = todo({ id: 'l1', title: 'leaf', parentId: 'e1', status: 'ready' });
    const result = todoIsMissionScoped(PROJECT, 'l1', [m1, e1, l1]);
    expect(result).toBe(true);
  });

  it('non-mission leaf → false', () => {
    const e1 = todo({ id: 'e1', title: '[EPIC] orphan epic', status: 'ready' });
    const l1 = todo({ id: 'l1', title: 'leaf', parentId: 'e1', status: 'ready' });
    const result = todoIsMissionScoped(PROJECT, 'l1', [e1, l1]);
    expect(result).toBe(false);
  });

  it('unknown todoId → false', () => {
    const result = todoIsMissionScoped(PROJECT, 'nope', []);
    expect(result).toBe(false);
  });
});
