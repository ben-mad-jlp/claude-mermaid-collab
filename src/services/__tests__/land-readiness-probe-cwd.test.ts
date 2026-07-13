import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// Isolate the GLOBAL supervisor.db before any imports that touch it.
const supervisorDir = mkdtempSync(join(tmpdir(), 'mc-land-cwd-probe-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

// Mock mission-store before importing land-authority.
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

import {
  landReadiness,
  type LandProbes,
} from '../land-authority';
import { epicBranchName } from '../epic-branch-status';
import type { LandReadinessReport } from '../epic-land-readiness';
import type { EpicLandGateResult } from '../epic-land-gate';
import type { Todo } from '../todo-store';

afterAll(() => {
  delete process.env.MERMAID_SUPERVISOR_DIR;
  try { rmSync(supervisorDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

const PROJECT = '/tmp/mc-land-cwd-project';
const FAKE_EPIC_CWD = '/tmp/epic-wt/e1';
const SESSION = 'conductor-A';

let seq = 0;

function inferKind(title: string): Todo['kind'] {
  if (/^\s*\[MISSION\]/i.test(title)) return 'mission';
  if (/^\s*\[EPIC\]/i.test(title)) return 'epic';
  if (/^\s*\[LAND\]/i.test(title)) return 'land';
  return 'leaf';
}

function inferBucket(title: string): boolean {
  return /\binbox\b/i.test(title);
}

function todo(partial: Partial<Todo> & { id?: string; title: string }): Todo {
  const { title, id, status: statusOverride, ...rest } = partial;
  const status = statusOverride ?? ('ready' as const);
  return {
    id: id ?? `t${++seq}`,
    title,
    kind: inferKind(title),
    isBucket: inferBucket(title),
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

function mkGraph() {
  const m1 = todo({ id: 'm1', title: '[MISSION] converge', ownerSession: SESSION, status: 'ready' });
  const e1 = todo({ id: 'e1', title: '[EPIC] the work', parentId: 'm1', status: 'ready' });
  const l1 = todo({
    id: 'l1',
    title: 'leaf: code',
    parentId: 'e1',
    status: 'done',
    acceptanceStatus: 'accepted',
  });
  const d1 = todo({
    id: 'd1',
    title: '[LAND] merge e1',
    parentId: 'e1',
    dependsOn: ['l1'],
    assigneeKind: 'human',
    status: 'ready',
  });

  missions.set('m1', { status: 'needs-discovery', active: true, abandonedAt: null });

  return { m1, e1, l1, d1 };
}

const greenPresence = (): LandReadinessReport => ({
  project: PROJECT,
  epicId: 'e1',
  epicBranch: epicBranchName('e1'),
  blocking: false,
  findings: [],
  exemptions: [],
  duplicateCommits: [],
  checked: 1,
});

const greenGate = (): EpicLandGateResult => ({
  status: 'pass',
  declared: true,
  manifestPath: 'x',
  units: [],
  regressions: [],
  inherited: [],
  incidents: [],
  reasons: [],
  specFiles: [],
  epicTipSha: 'abc',
  baseSha: 'def',
});

describe('landReadiness cwd probe threading', () => {
  beforeEach(() => {
    seq = 0;
    missions.clear();
  });

  it('threads the epic worktree cwd to merge probe and gate opts', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const allTodos = [m1, e1, l1, d1];

    let seenMergeCwd: string | undefined;
    let seenGateCwd: string | undefined;

    const probes: LandProbes = {
      presence: greenPresence,
      worktreeCwd: () => FAKE_EPIC_CWD,
      merge: (p, b, cwd) => {
        seenMergeCwd = cwd;
        return { tscClean: true, mergeClean: true };
      },
      gate: async (opts) => {
        seenGateCwd = opts.epicWorktreeCwd;
        return greenGate();
      },
      todos: () => allTodos,
    };

    const verdict = await landReadiness(PROJECT, 'e1', { probes, todos: allTodos });

    expect(seenMergeCwd).toBe(FAKE_EPIC_CWD);
    expect(seenMergeCwd).not.toBe(PROJECT);
    expect(seenGateCwd).toBe(FAKE_EPIC_CWD);
    expect(seenGateCwd).not.toBe(PROJECT);
    expect(verdict.green).toBe(true);
  });

  it('proof remains green when all probes report clean', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const allTodos = [m1, e1, l1, d1];

    const probes: LandProbes = {
      presence: greenPresence,
      worktreeCwd: () => FAKE_EPIC_CWD,
      merge: () => ({ tscClean: true, mergeClean: true }),
      gate: async () => greenGate(),
      todos: () => allTodos,
    };

    const verdict = await landReadiness(PROJECT, 'e1', { probes, todos: allTodos });

    expect(verdict.green).toBe(true);
    expect(verdict.blockers.length).toBe(0);
  });
});
