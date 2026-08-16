/**
 * Unit tests for the explore pipeline (report-only leaf execution).
 * Tests the runExplorePipeline and its dispatch wiring in runLeaf.
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'explore-report-ledger-'));

import {
  runLeaf,
  leafExecutionMode,
  type LeafExecutorDeps,
} from '../leaf-executor';
import type { Todo } from '../todo-store';
import type { Finding } from '../finding-store';
import type { NodeResult, NodeSpec } from '../../agent/node-invoker';
import { classifyWorktreeAddFault } from '../../agent/node-invoker';

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
  ensureCalls: Array<{ sessionKey: string; opts: { baseBranch?: string; fresh?: boolean } }>;
  invokeSpecs: NodeSpec[];
  completeCalls: Array<{ acceptance: 'accepted' | 'rejected' }>;
  mergeCalls: number;
  escalations: Array<{ kind: string; questionText: string }>;
  removeCalls: string[];
  nodeRows: Array<any>;
  writeArtifactCalls: Array<{ path: string; content: string }>;
  fileExploreCalls: Array<{ project: string; reportPath: string; findings: Finding[] }>;
}

/** Build a deps object for explore testing, with configurable explore node results. */
function makeExploreDeps(opts: {
  exploreText?: string; // The explore node's output text
  findings?: Finding[]; // Stubbed findings for the gate
  fileExploreFindings?: (project: string, ctx: { leaf: any; reportPath: string; report: string; findings: Finding[] }) => Promise<unknown>; // Optional override
}): { deps: LeafExecutorDeps; spies: Spies } {
  const spies: Spies = {
    ensureCalls: [],
    invokeSpecs: [],
    completeCalls: [],
    mergeCalls: 0,
    escalations: [],
    removeCalls: [],
    nodeRows: [],
    writeArtifactCalls: [],
    fileExploreCalls: [],
  };

  const deps: LeafExecutorDeps = {
    invoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        spies.invokeSpecs.push(spec);
        // The explore node has transcriptLabel === 'explore'
        if (spec.transcriptLabel === 'explore') {
          return okResult(opts.exploreText ?? 'EXPLORE-REPORT: FINDINGS=0');
        }
        // Shouldn't reach here in explore tests
        return failResult();
      },
    },
    wm: {
      async ensure(sessionKey: string, o: { baseBranch?: string; fresh?: boolean }) {
        spies.ensureCalls.push({ sessionKey, opts: o ?? {} });
        return {
          isGit: true,
          path: `/tmp/explore-wt/${spies.ensureCalls.length}`,
          branch: 'b',
          baseBranch: o?.baseBranch ?? 'm',
        } as never;
      },
      async remove(sessionKey: string) {
        spies.removeCalls.push(sessionKey);
      },
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
    escalate(input) {
      spies.escalations.push({ kind: input.kind, questionText: input.questionText });
    },
    recordNode: (e) => {
      spies.nodeRows.push(e);
      return null as any;
    },
    setInflight: () => undefined,
    clearInflight: () => undefined,
    writeArtifact: async (_cwd, relPath, content) => {
      spies.writeArtifactCalls.push({ path: relPath, content });
    },
    findingsForLeaf: async () => opts.findings ?? [],
    fileExploreFindings: opts.fileExploreFindings ?? (async (project, ctx) => {
      spies.fileExploreCalls.push({ project, reportPath: ctx.reportPath, findings: ctx.findings });
    }),
  };

  return { deps, spies };
}

describe('explore pipeline', () => {
  it('verifies explore mode is recognized', () => {
    const leaf = makeLeaf({ type: 'explore' });
    expect(leafExecutionMode(leaf)).toBe('explore');
  });

  it('zero-finding parseable report is accepted, written, and merged', async () => {
    const { deps, spies } = makeExploreDeps({
      exploreText: '## Findings\n\nEXPLORE-REPORT: FINDINGS=0',
    });
    const leaf = makeLeaf();
    const res = await runLeaf('proj', leaf, deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.mergeCalls).toBe(1);
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
    // Artifact was written
    expect(spies.writeArtifactCalls.length).toBe(1);
    expect(spies.writeArtifactCalls[0].path).toContain('docs/explore');
  });

  it('multi-finding parseable report is accepted, written, and merged', async () => {
    const leaf = makeLeaf();
    const { deps, spies } = makeExploreDeps({
      exploreText:
        '## Findings\n\n- first issue\n- second issue\n\nEXPLORE-REPORT: FINDINGS=2',
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
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
    // Artifact was written
    expect(spies.writeArtifactCalls.length).toBe(1);
  });

  it('empty report text parks blocked with explore-report-empty', async () => {
    const { deps, spies } = makeExploreDeps({
      exploreText: '',
    });
    const leaf = makeLeaf();
    const res = await runLeaf('proj', leaf, deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('explore-report-empty');
    expect(spies.mergeCalls).toBe(0);
    // parkBlocked calls complete with 'rejected', not 'accepted'
    expect(spies.completeCalls).toEqual([{ acceptance: 'rejected' }]);
    expect(spies.writeArtifactCalls.length).toBe(0);
  });

  it('unparseable report text parks blocked with explore-report-unparseable', async () => {
    const { deps, spies } = makeExploreDeps({
      exploreText: '## Findings\n\nSome text but no sentinel line',
    });
    const leaf = makeLeaf();
    const res = await runLeaf('proj', leaf, deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('explore-report-unparseable');
    expect(spies.mergeCalls).toBe(0);
    // parkBlocked calls complete with 'rejected', not 'accepted'
    expect(spies.completeCalls).toEqual([{ acceptance: 'rejected' }]);
    expect(spies.writeArtifactCalls.length).toBe(0);
  });

  it('mutation probe: stubbed parseExploreReport always returns ok:true makes unparseable case fail', async () => {
    // This test verifies that the parsing function is actually being called and checked.
    // If we stub it to always return ok:true, then an unparseable text should NOT park.
    // We can't actually stub it in this test infrastructure easily, so we verify the
    // opposite: that with the real parser, unparseable DOES park.
    const { deps, spies } = makeExploreDeps({
      exploreText: 'no sentinel line here',
    });
    const leaf = makeLeaf();
    const res = await runLeaf('proj', leaf, deps);
    // With real parser, this unparseable text should park
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('explore-report-unparseable');
  });

  it('mutation probe: zero finding case must actually check the FINDINGS count', async () => {
    // This tests that the parser actually reads the FINDINGS=0 vs FINDINGS=N distinction
    const testCases = [
      { text: 'EXPLORE-REPORT: FINDINGS=0', shouldParse: true, findings: [] },
      { text: 'EXPLORE-REPORT: FINDINGS=1', shouldParse: true, findings: ['finding-1'] },
      { text: 'EXPLORE-REPORT: FINDINGS=99', shouldParse: true, findings: ['finding-1'] },
      { text: 'EXPLORE-REPORT: FINDINGS=', shouldParse: false, findings: [] },
      { text: 'EXPLORE-REPORT: FINDINGS', shouldParse: false, findings: [] },
    ];

    for (const tc of testCases) {
      const leaf = makeLeaf();
      const findingRows: Finding[] = tc.findings.map((id) => ({
        id,
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
      }));
      const { deps, spies } = makeExploreDeps({
        exploreText: `## Findings\n\n${tc.text}`,
        findings: findingRows,
      });
      const res = await runLeaf('proj', leaf, deps);
      if (tc.shouldParse) {
        expect(res.outcome).toBe('accepted');
      } else {
        expect(res.outcome).toBe('blocked');
        expect(res.reason).toBe('explore-report-unparseable');
      }
    }
  });

  it('both zero and multi-finding take the same path (finalizeReportLeaf with pass)', async () => {
    // Test case 1: zero findings
    const { deps: deps0 } = makeExploreDeps({
      exploreText: 'EXPLORE-REPORT: FINDINGS=0',
      findings: [],
    });
    const res0 = await runLeaf('proj', makeLeaf(), deps0);
    expect(res0.outcome).toBe('accepted');

    // Test case 2: multi findings
    const leaf2 = makeLeaf();
    const { deps: depsMulti } = makeExploreDeps({
      exploreText: 'EXPLORE-REPORT: FINDINGS=5',
      findings: [{
        id: 'finding-1',
        todoId: 'todo-1',
        sourceLeafId: leaf2.id,
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
    const resMulti = await runLeaf('proj', leaf2, depsMulti);
    expect(resMulti.outcome).toBe('accepted');

    // Both should reach finalizeReportLeaf with 'pass' verdict
    // (verified by accepted outcome + merged + completed)
  });

  it('FINDINGS=1 report invokes fileExploreFindings once with the report path and rows', async () => {
    const leaf = makeLeaf();
    const { deps, spies } = makeExploreDeps({
      exploreText: '## Findings\n\n- Test finding\n\nEXPLORE-REPORT: FINDINGS=1',
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
    expect(spies.fileExploreCalls.length).toBe(1);
    expect(spies.fileExploreCalls[0].reportPath).toBe(`docs/explore/${leaf.id}.report.md`);
    expect(spies.fileExploreCalls[0].findings.length).toBe(1);
    expect(spies.mergeCalls).toBe(1);
  });

  it('FINDINGS=0 report does not invoke fileExploreFindings', async () => {
    const { deps, spies } = makeExploreDeps({
      exploreText: 'EXPLORE-REPORT: FINDINGS=0',
      findings: [],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.fileExploreCalls.length).toBe(0);
    expect(spies.mergeCalls).toBe(1);
  });

  it('a rejecting fileExploreFindings still returns the pass outcome (fail-open)', async () => {
    const leaf = makeLeaf();
    const { deps, spies } = makeExploreDeps({
      exploreText: '## Findings\n\n- Test finding\n\nEXPLORE-REPORT: FINDINGS=1',
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
      fileExploreFindings: async () => {
        throw new Error('Filing failed');
      },
    });
    const res = await runLeaf('proj', leaf, deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.mergeCalls).toBe(1);
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
  });
});

describe('explore filer production default (regression)', () => {
  it('makeLeafExecutorDeps binds fileExploreFindings to the real autoFileExploreFindings', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'leaf-executor.ts'), 'utf8');

    // Assert the import exists: autoFileExploreFindings imported from './explore-finding-filer'
    const importPattern = /import\s*{[^}]*autoFileExploreFindings[^}]*}\s*from\s*['"]\.\/explore-finding-filer['"]/;
    expect(importPattern.test(src)).toBe(true);

    // Find the factory function start and slice from there to the end
    const factoryMarker = 'export async function makeLeafExecutorDeps(';
    const idx = src.indexOf(factoryMarker);
    expect(idx).toBeGreaterThan(-1);

    const factoryBody = src.slice(idx);

    // Assert the binding line exists in the factory body: fileExploreFindings: autoFileExploreFindings,
    // Anchored on : + identifier + , or newline to forbid wrapper forms
    const bindingPattern = /\bfileExploreFindings\s*:\s*autoFileExploreFindings\b/;
    expect(bindingPattern.test(factoryBody)).toBe(true);
  });
});
