// Hermetic tests pinning the OR-of-refs union in buildLandReadiness and acceptTimeAncestorGate.
// Tests the union reachability logic: a leaf counts as landed if it is reachable from EITHER
// the epic tip (onEpicTip) OR the trunk (onTrunk) — not requiring both.
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Todo, TodoStatus } from '../todo-store';
import {
  buildLandReadiness,
  type CommitProbe,
  type CommitProbeResult,
} from '../epic-land-readiness';

// Point the orchestrator-config store at a throwaway supervisor.db BEFORE importing
// the modules that open it (mirrors oi1-build-accept.test.ts and orchestrator-config.test.ts).
const dir = mkdtempSync(join(tmpdir(), 'land-union-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

const { setOrchestratorLevel, _closeDb } = await import('../orchestrator-config');
const { acceptTimeAncestorGate, countStrandedReversals } = await import('../coordinator-live');

afterAll(() => {
  _closeDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;

/** `kind` is authoritative now, but these fixtures are written in the older title
 *  dialect ("[EPIC] …", "[LAND] …"). Derive the kind from that prefix so a fixture
 *  keeps reading as one line. An explicit `kind` in the partial always wins. */
function inferKind(title: string): Todo['kind'] {
  if (/^\s*\[EPIC\]/i.test(title)) return 'epic';
  if (/^\s*\[LAND\]/i.test(title)) return 'land';
  return 'leaf';
}

function todo(partial: Partial<Todo> & { id?: string; title: string; status?: TodoStatus }): Todo {
  const status = partial.status ?? 'ready';
  return {
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
    servesCriterionId: null,
    servesCriterionIds: [],
    decisionRef: null,
    claimProbe: null,
    ...partial,
    kind: partial.kind ?? inferKind(partial.title),
    inheritedBlueprintFrom: partial.inheritedBlueprintFrom ?? null,
    inheritedFiles: partial.inheritedFiles ?? [],
    declaredFiles: partial.declaredFiles ?? [],
    isBucket: partial.isBucket ?? false,
    nickname: partial.nickname ?? 'nick',
    id: partial.id ?? `t${++seq}`,
    status,
    completed: status === 'done',
  };
}

/** A probe driven by a todoId→facts table; unknown ids return empty arrays. */
function probeFrom(table: Record<string, CommitProbeResult>): CommitProbe {
  return (todoId: string) => table[todoId] ?? { onEpicTip: [], anyRef: [] };
}

describe('land-readiness union reachability', () => {
  it('a landed epic whose branch was deleted reports blocking false with empty findings', async () => {
    // A leaf accepted and completed on the epic, but the epic branch was deleted (so onEpicTip=[]).
    // The union should still pass because the work IS reachable from trunk (onTrunk=['abc123']).
    const epic = todo({ id: 'e1', title: '[EPIC] union', status: 'done' });
    const work = todo({ id: 'w1', title: 'work', parentId: 'e1', acceptanceStatus: 'accepted' });
    const report = await buildLandReadiness(
      [epic, work],
      'e1',
      probeFrom({ w1: { onEpicTip: [], onTrunk: ['abc123'], anyRef: ['abc123'] } }),
    );
    expect(report.findings).toHaveLength(0);
    expect(report.blocking).toBe(false);
  });

  it('a trailer reachable from neither ref still reports stranded', async () => {
    // A leaf with a commit on some stray ref, but NOT reachable from either epic tip or trunk.
    // The union should fail (both arms false) and report stranded with blocking=true.
    const epic = todo({ id: 'e1', title: '[EPIC] union', status: 'done' });
    const work = todo({ id: 'w1', title: 'work', parentId: 'e1', acceptanceStatus: 'accepted' });
    const report = await buildLandReadiness(
      [epic, work],
      'e1',
      probeFrom({ w1: { onEpicTip: [], onTrunk: undefined, anyRef: ['abc123'] } }),
      '',
      undefined,
      'master',
    );
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].kind).toBe('stranded');
    expect(report.findings[0].strayShas).toContain('abc123');
    expect(report.findings[0].reason).toMatch(/absent from .* and .*/);
    expect(report.blocking).toBe(true);
  });

  it('acceptTimeAncestorGate records a stranded reversal when both union arms are false', async () => {
    const project = '/tmp/land-union-both-false';
    setOrchestratorLevel(project, 'on');

    // Stub worktree manager: both ARM A (trunk) and ARM B (epic) return false (unreachable).
    const stubWm = {
      isGitRepoPublic: async () => true,
      resolveIntegrationRef: async () => 'master',
      commitOnIntegration: async (_epicId: string, _todoId: string, _ref: string) => false,
      epicBranchName: (_epicId: string) => 'collab/epic/epic-u1',
      // Minimal Oi1LandWorktree stubs (unused in this path, but needed for interface).
      ensureEpic: async () => null,
      landEpicToMaster: async () => ({ landed: false }),
      epicHeadSha: async () => null,
    };

    const deps = {
      authority: (_project: string, _epicId: string, _todos: any[]) => true,
      wm: stubWm,
    };

    const ok = await acceptTimeAncestorGate(project, 'todo-u1', 'epic-u1', [], 'Trial', 'sess', deps);
    expect(ok).toBe(false);

    // Verify the stranded reversal was recorded.
    const reversals = countStrandedReversals(project, 'todo-u1');
    expect(reversals).toBe(1);
  });
});
