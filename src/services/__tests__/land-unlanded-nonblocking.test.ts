import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// Isolate the GLOBAL supervisor.db before any imports that touch it.
const supervisorDir = mkdtempSync(join(tmpdir(), 'mc-land-unlanded-'));
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

import { landReadiness, type LandProbes } from '../land-authority';
import { isEpicWorkReachable } from '../epic-landedness';
import { epicBranchName } from '../epic-branch-status';
import type { LandReadinessReport } from '../epic-land-readiness';
import type { EpicLandGateResult } from '../epic-land-gate';
import type { Todo } from '../todo-store';

afterAll(() => {
  delete process.env.MERMAID_SUPERVISOR_DIR;
  try { rmSync(supervisorDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

const PROJECT = '/tmp/mc-land-unlanded-project';
const SESSION = 'conductor-A';

// ============================================================================
// Fixtures: todo() builder, missions registry, probe factories
// ============================================================================

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
  const m1 = todo({ id: 'm1', title: '[MISSION] test', ownerSession: SESSION, status: 'ready' });
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

const greenMerge = () => ({ tscClean: true, mergeClean: true });

const probes = (over: Partial<LandProbes> = {}): LandProbes => ({
  presence: async () => ({
    project: PROJECT,
    epicId: 'e1',
    epicBranch: epicBranchName('e1'),
    blocking: false,
    findings: [],
    exemptions: [],
    duplicateCommits: [],
    checked: 1,
  }),
  gate: async () => greenGate(),
  merge: greenMerge,
  ...over,
});

// ============================================================================
// Test Suite: Unlanded findings should not block land authority or reachability
// ============================================================================

describe('land-unlanded-nonblocking', () => {
  beforeEach(() => {
    seq = 0;
    missions.clear();
  });

  describe('landReadiness with unlanded-only findings', () => {
    it('unlanded-only presence findings produce no presence-findings blocker', async () => {
      const { m1, e1, l1, d1 } = mkGraph();
      const unlandedOnlyPresence = async (): Promise<LandReadinessReport> => ({
        project: PROJECT,
        epicId: 'e1',
        epicBranch: epicBranchName('e1'),
        blocking: true, // blocking: true because findings.length > 0
        findings: [
          {
            todoId: 'l1',
            title: 'leaf: code',
            kind: 'unlanded',
            strayShas: ['abc123'],
            reason: 'unlanded: abc123 — reachable from collab/epic/e1000001, absent from master',
          },
        ],
        exemptions: [],
        duplicateCommits: [],
        checked: 1,
      });

      const verdict = await landReadiness(PROJECT, 'e1', {
        probes: probes({ presence: unlandedOnlyPresence }),
        todos: [m1, e1, l1, d1],
      });

      // The key assertion: no presence-findings blocker despite blocking:true in the report
      const presenceBlocker = verdict.blockers.find((b) => b.code === 'presence-findings');
      expect(presenceBlocker).toBeUndefined();
      expect(verdict.green).toBe(true);
    });

    it('a report mixing unlanded with missing still blocks and names only the missing leaf', async () => {
      const { m1, e1, l1, d1 } = mkGraph();
      const mixedPresence = async (): Promise<LandReadinessReport> => ({
        project: PROJECT,
        epicId: 'e1',
        epicBranch: epicBranchName('e1'),
        blocking: true,
        findings: [
          {
            todoId: 'l1',
            title: 'leaf: code',
            kind: 'unlanded',
            strayShas: ['abc123'],
            reason: 'unlanded: abc123 — reachable from collab/epic/e1000001, absent from master',
          },
          {
            todoId: 'l2',
            title: 'leaf: missing',
            kind: 'missing',
            strayShas: [],
            reason: 'accepted with no commit on any ref',
          },
        ],
        exemptions: [],
        duplicateCommits: [],
        checked: 2,
      });

      const verdict = await landReadiness(PROJECT, 'e1', {
        probes: probes({ presence: mixedPresence }),
        todos: [m1, e1, l1, d1],
      });

      // The presence-findings blocker should exist and name only the missing leaf
      const presenceBlocker = verdict.blockers.find((b) => b.code === 'presence-findings');
      expect(presenceBlocker).toBeDefined();
      expect(presenceBlocker?.detail).toMatch(/l2/);
      expect(presenceBlocker?.detail).not.toMatch(/l1/);
      expect(verdict.green).toBe(false);
    });
  });

  describe('isEpicWorkReachable with unlanded-only findings', () => {
    it('isEpicWorkReachable reports reachable:true for an unlanded-only report', async () => {
      const unlandedOnlyReport = async (): Promise<LandReadinessReport> => ({
        project: PROJECT,
        epicId: 'e1',
        epicBranch: epicBranchName('e1'),
        blocking: true,
        findings: [
          {
            todoId: 'l1',
            title: 'leaf: code',
            kind: 'unlanded',
            strayShas: ['abc123'],
            reason: 'unlanded: abc123 — reachable from collab/epic/e1000001, absent from master',
          },
        ],
        exemptions: [],
        duplicateCommits: [],
        checked: 1,
      });

      const reachability = await isEpicWorkReachable(PROJECT, 'e1', unlandedOnlyReport);
      expect(reachability.reachable).toBe(true);
      expect(reachability.indeterminate).toBe(false);
      expect(reachability.stranded).toEqual([]);
    });

    it('isEpicWorkReachable still reports reachable:false when missing findings exist', async () => {
      const withMissingReport = async (): Promise<LandReadinessReport> => ({
        project: PROJECT,
        epicId: 'e1',
        epicBranch: epicBranchName('e1'),
        blocking: true,
        findings: [
          {
            todoId: 'l1',
            title: 'leaf: missing',
            kind: 'missing',
            strayShas: [],
            reason: 'accepted with no commit on any ref',
          },
        ],
        exemptions: [],
        duplicateCommits: [],
        checked: 1,
      });

      const reachability = await isEpicWorkReachable(PROJECT, 'e1', withMissingReport);
      expect(reachability.reachable).toBe(false);
      expect(reachability.indeterminate).toBe(false);
      expect(reachability.stranded.length).toBe(1);
      expect(reachability.stranded[0].kind).toBe('missing');
    });

    it('isEpicWorkReachable with injected readiness reader parameter', async () => {
      let callCount = 0;
      const injectedReadiness = async () => {
        callCount++;
        return {
          project: PROJECT,
          epicId: 'e1',
          epicBranch: epicBranchName('e1'),
          blocking: true,
          findings: [
            {
              todoId: 'l1',
              title: 'leaf: unlanded',
              kind: 'unlanded' as const,
              strayShas: ['abc123'],
              reason: 'unlanded',
            },
          ],
          exemptions: [],
          duplicateCommits: [],
          checked: 1,
        } as LandReadinessReport;
      };

      const reachability = await isEpicWorkReachable(PROJECT, 'e1', injectedReadiness);

      // Verify the injected reader was called
      expect(callCount).toBe(1);
      // Verify the correct result
      expect(reachability.reachable).toBe(true);
      expect(reachability.indeterminate).toBe(false);
    });
  });
});
