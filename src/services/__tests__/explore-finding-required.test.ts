/**
 * Unit tests for the explore finding-gate requirement.
 * Tests that findings asserted in the explore report MUST be backed by filed Finding rows.
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'explore-finding-required-'));

import {
  runLeaf,
  type LeafExecutorDeps,
} from '../leaf-executor';
import type { Todo } from '../todo-store';
import type { Finding } from '../finding-store';
import type { NodeResult, NodeSpec } from '../../agent/node-invoker';

const EPIC_BRANCH = 'collab/epic/explore-test';
const EPIC_ID = 'epic-explore-test';

function makeLeaf(over: Partial<Todo> = {}): Todo {
  return {
    id: '5c58cf82-87bf-49c4-b01a-bee5fc66502d',
    ownerSession: 'sess',
    assigneeSession: null,
    assigneeKind: 'agent',
    title: 'explore test',
    description: 'test exploration',
    status: 'in_progress',
    completed: false,
    priority: 2,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    sessionName: 'leaf-exec-explore',
    executedBySession: 'leaf-exec-explore',
    blueprintId: null,
    type: 'explore',
    kind: null,
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
    inheritedBlueprintFrom: null,
    inheritedFiles: [],
    declaredFiles: [],
    isBucket: false,
    nickname: 'explore-nick',
    ...over,
  };
}

function okResult(text: string): NodeResult {
  return {
    ok: true,
    exitCode: 0,
    stdout: text,
    durationMs: 1,
    rateLimited: false,
    authMode: 'subscription',
    text,
  };
}

function failResult(): NodeResult {
  return {
    ok: false,
    exitCode: 1,
    stdout: '',
    durationMs: 1,
    rateLimited: false,
    authMode: 'subscription',
    text: '',
  };
}

interface Spies {
  completeCalls: Array<{ acceptance: 'accepted' | 'rejected' }>;
  mergeCalls: number;
  writeArtifactCalls: Array<{ path: string; content: string }>;
}

function makeExploreDeps(opts: {
  exploreText: string;
  findings: Finding[];
}): { deps: LeafExecutorDeps; spies: Spies } {
  const spies: Spies = {
    completeCalls: [],
    mergeCalls: 0,
    writeArtifactCalls: [],
  };

  const deps: LeafExecutorDeps = {
    invoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        if (spec.transcriptLabel === 'explore') {
          return okResult(opts.exploreText);
        }
        return failResult();
      },
    },
    wm: {
      async ensure() {
        return {
          isGit: true,
          path: `/tmp/explore-wt`,
          branch: 'b',
          baseBranch: 'm',
        } as never;
      },
      async remove() {},
    } as never,
    epicId: EPIC_ID,
    epicBranch: EPIC_BRANCH,
    assertAuth: () => 'subscription',
    async complete(_p, _t, acceptance) {
      spies.completeCalls.push({ acceptance });
      return { effective: acceptance };
    },
    async markRejecting() {
      return true;
    },
    async bumpRetry() {
      return true;
    },
    async refundRetry() {
      return true;
    },
    async releaseClaim() {
      return true;
    },
    async holdLeaf() {
      return true;
    },
    async mergeToEpic() {
      spies.mergeCalls += 1;
      return {};
    },
    escalate() {},
    recordNode: () => null as any,
    setInflight: () => undefined,
    clearInflight: () => undefined,
    writeArtifact: async (_cwd, relPath, content) => {
      spies.writeArtifactCalls.push({ path: relPath, content });
    },
    findingsForLeaf: async () => opts.findings,
  };

  return { deps, spies };
}

describe('explore finding gate', () => {
  it('blocks when findings are asserted but no typed Finding row exists', async () => {
    const leaf = makeLeaf();
    const { deps, spies } = makeExploreDeps({
      exploreText: '## Findings\n\n- x\n\nEXPLORE-REPORT: FINDINGS=2',
      findings: [],
    });
    const res = await runLeaf('proj', leaf, deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('explore-findings-claimed-no-typed-finding');
    expect(spies.mergeCalls).toBe(0);
    expect(spies.completeCalls).toEqual([{ acceptance: 'rejected' }]);
  });

  it('accepts when a valid Finding row backs the asserted findings', async () => {
    const leaf = makeLeaf();
    const { deps, spies } = makeExploreDeps({
      exploreText: '## Findings\n\n- x\n\nEXPLORE-REPORT: FINDINGS=2',
      findings: [{
        id: 'finding-1',
        todoId: 'todo-1',
        sourceLeafId: leaf.id,
        violatedClaim: 'Test claim',
        implicatedFiles: ['a.ts'],
        ruledOut: [],
        reproPath: '__quarantine__/test.test.ts',
        failureIdentity: null,
        surface: null,
        recurrenceCount: 1,
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      }],
    });
    const res = await runLeaf('proj', leaf, deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.mergeCalls).toBe(1);
    expect(spies.writeArtifactCalls.length).toBe(1);
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
  });

  it('blocks when the filed row has no implicated files', async () => {
    const leaf = makeLeaf();
    const { deps, spies } = makeExploreDeps({
      exploreText: '## Findings\n\n- x\n\nEXPLORE-REPORT: FINDINGS=2',
      findings: [{
        id: 'finding-1',
        todoId: 'todo-1',
        sourceLeafId: leaf.id,
        violatedClaim: 'Test claim',
        implicatedFiles: [],
        ruledOut: [],
        reproPath: '__quarantine__/test.test.ts',
        failureIdentity: null,
        surface: null,
        recurrenceCount: 1,
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      }],
    });
    const res = await runLeaf('proj', leaf, deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('explore-findings-claimed-no-typed-finding');
    expect(spies.mergeCalls).toBe(0);
    expect(spies.completeCalls).toEqual([{ acceptance: 'rejected' }]);
  });

  it('FINDINGS=0 with no rows is still accepted', async () => {
    const leaf = makeLeaf();
    const { deps, spies } = makeExploreDeps({
      exploreText: 'EXPLORE-REPORT: FINDINGS=0',
      findings: [],
    });
    const res = await runLeaf('proj', leaf, deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.mergeCalls).toBe(1);
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
  });
});
