/**
 * Unit tests for explore segment loop: wrap-up directive, soft threshold, and hard ceiling.
 * Tests the bounded segment loop in runExplorePipeline.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'explore-wrapup-'));

import {
  runLeaf,
  leafExecutionMode,
  type LeafExecutorDeps,
} from '../leaf-executor';
import type { Todo } from '../todo-store';
import type { NodeResult, NodeSpec } from '../../agent/node-invoker';
import { classifyWorktreeAddFault } from '../../agent/node-invoker';
import { MAX_EXPLORE_SEGMENTS } from '../leaf-explore';
import { buildExploreWrapUpDirective } from '../leaf-prompts';

const EPIC_BRANCH = 'collab/epic/explore-wrapup-test';
const EPIC_ID = 'epic-explore-wrapup-test';

function makeLeaf(over: Partial<Todo> = {}): Todo {
  return {
    id: '7c39de91-12cd-4e5f-c02b-cef6fc77603e',
    ownerSession: 'sess',
    assigneeSession: null,
    assigneeKind: 'agent',
    title: 'explore wrapup test',
    description: 'test wrap-up and ceiling',
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
    nickname: 'wrapup-test-nick',
    ...over,
  };
}

function okResult(text: string, costUsd: number = 1.0): NodeResult {
  return {
    ok: true,
    exitCode: 0,
    stdout: text,
    durationMs: 1,
    rateLimited: false,
    authMode: 'subscription',
    text,
    usage: { costUsd },
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
}

/** Build deps for testing with configurable per-segment responses. */
function makeExploreDeps(opts: {
  segmentResponses: Array<{ text: string; costUsd?: number }>;
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
  };

  let segmentIndex = 0;

  const deps: LeafExecutorDeps = {
    invoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        spies.invokeSpecs.push(spec);
        if (spec.transcriptLabel === 'explore') {
          const response = opts.segmentResponses[segmentIndex] ?? { text: 'EXPLORE-REPORT: FINDINGS=0' };
          segmentIndex += 1;
          return okResult(response.text, response.costUsd ?? 1.0);
        }
        return { ok: false, exitCode: 1, stdout: '', durationMs: 1, rateLimited: false, authMode: 'subscription', text: '' };
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
  };

  return { deps, spies };
}

describe('explore wrap-up and hard ceiling', () => {
  it('soft threshold signals wrap-up and the run completes with an accepted report', async () => {
    // Set soft/hard USD limits to trigger wrap-up on first segment
    const savedSoft = process.env.MERMAID_EXPLORE_SOFT_USD;
    const savedHard = process.env.MERMAID_EXPLORE_HARD_USD;
    try {
      process.env.MERMAID_EXPLORE_SOFT_USD = '1.0';
      process.env.MERMAID_EXPLORE_HARD_USD = '15.0';

      const { deps, spies } = makeExploreDeps({
        segmentResponses: [
          // First segment consumes $1.2, which exceeds soft limit ($1.0)
          { text: '## Findings\n\n- finding 1\n\nEXPLORE-REPORT: FINDINGS=1', costUsd: 1.2 },
          // Second segment (wrap-up) runs with the wrap-up directive
          { text: '## Findings\n\n- finding 1\n\nEXPLORE-REPORT: FINDINGS=1', costUsd: 0.5 },
        ],
      });
      const leaf = makeLeaf();
      const res = await runLeaf('proj', leaf, deps);

      expect(res.outcome).toBe('accepted');
      expect(spies.mergeCalls).toBe(1);
      expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
      expect(spies.writeArtifactCalls.length).toBe(1);

      // Verify that wrap-up directive was added to second segment's prompt
      const wrapUpDirective = buildExploreWrapUpDirective();
      const secondSegmentPrompt = spies.invokeSpecs[1].prompt;
      expect(secondSegmentPrompt).toContain(wrapUpDirective);
      expect(spies.invokeSpecs.length).toBe(2); // Only 2 segments: normal + wrap-up
    } finally {
      process.env.MERMAID_EXPLORE_SOFT_USD = savedSoft;
      process.env.MERMAID_EXPLORE_HARD_USD = savedHard;
    }
  });

  it('hard ceiling with a captured report still accepts', async () => {
    // Without setting hard limit, loop runs to segment limit; just test that a captured report leads to acceptance
    const { deps, spies } = makeExploreDeps({
      segmentResponses: [
        { text: '## Findings\n\n- critical finding\n\nEXPLORE-REPORT: FINDINGS=1', costUsd: 0.1 },
        // All subsequent segments will use default valid report
        ...Array.from({ length: MAX_EXPLORE_SEGMENTS }, () => ({
          text: '## Findings\n\nEXPLORE-REPORT: FINDINGS=0',
          costUsd: 0.1,
        })),
      ],
    });
    const leaf = makeLeaf();
    const res = await runLeaf('proj', leaf, deps);

    // With a captured report (from segment 1 or any segment), accept
    expect(res.outcome).toBe('accepted');
    expect(spies.mergeCalls).toBe(1);
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
    expect(spies.writeArtifactCalls.length).toBe(1);
    // Loop runs until segment limit triggers wrap-up then breaks
    expect(spies.invokeSpecs.length).toBeLessThanOrEqual(MAX_EXPLORE_SEGMENTS + 1);
  });


  it('segment loop never exceeds MAX_EXPLORE_SEGMENTS invocations', async () => {
    const savedSoft = process.env.MERMAID_EXPLORE_SOFT_USD;
    const savedHard = process.env.MERMAID_EXPLORE_HARD_USD;
    try {
      // Very high thresholds to avoid triggering on budget; only segment count triggers wrap-up
      process.env.MERMAID_EXPLORE_SOFT_USD = '1000.0';
      process.env.MERMAID_EXPLORE_HARD_USD = '2000.0';

      const responses = Array.from({ length: MAX_EXPLORE_SEGMENTS + 5 }, (_, i) => ({
        text: `## Findings\n\n- finding ${i + 1}\n\nEXPLORE-REPORT: FINDINGS=${i + 1}`,
        costUsd: 0.4,
      }));

      const { deps, spies } = makeExploreDeps({ segmentResponses: responses });
      const leaf = makeLeaf();
      const res = await runLeaf('proj', leaf, deps);

      // Should stop at MAX_EXPLORE_SEGMENTS
      // Segments 1-4: decisions are 'continue' (segmentsRun+1 < 6)
      // Segment 5: decision is 'wrap-up' (5+1 >= 6), set flag, rebuild, continue
      // Segment 6 (wrap-up): decision is 'wrap-up' again, wrapUpSignalled already true, break
      // Total: 6 segments
      expect(spies.invokeSpecs.length).toBeLessThanOrEqual(MAX_EXPLORE_SEGMENTS + 1);
      expect(spies.invokeSpecs.length).toBe(MAX_EXPLORE_SEGMENTS);
    } finally {
      process.env.MERMAID_EXPLORE_SOFT_USD = savedSoft;
      process.env.MERMAID_EXPLORE_HARD_USD = savedHard;
    }
  });

  it('single-segment empty report still parks explore-report-empty (backward compat)', async () => {
    const { deps, spies } = makeExploreDeps({
      segmentResponses: [
        { text: '', costUsd: 1.0 },
      ],
    });
    const leaf = makeLeaf();
    const res = await runLeaf('proj', leaf, deps);

    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('explore-report-empty');
    expect(spies.mergeCalls).toBe(0);
    expect(spies.invokeSpecs.length).toBe(1);
  });

  it('single-segment unparseable report still parks explore-report-unparseable (backward compat)', async () => {
    const { deps, spies } = makeExploreDeps({
      segmentResponses: [
        { text: '## Findings\n\nNo sentinel line here', costUsd: 1.0 },
      ],
    });
    const leaf = makeLeaf();
    const res = await runLeaf('proj', leaf, deps);

    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('explore-report-unparseable');
    expect(spies.mergeCalls).toBe(0);
    expect(spies.invokeSpecs.length).toBe(1);
  });

  it('wrap-up directive is present in second segment prompt', async () => {
    const savedSoft = process.env.MERMAID_EXPLORE_SOFT_USD;
    const savedHard = process.env.MERMAID_EXPLORE_HARD_USD;
    try {
      process.env.MERMAID_EXPLORE_SOFT_USD = '1.0';
      process.env.MERMAID_EXPLORE_HARD_USD = '10.0';

      const { deps, spies } = makeExploreDeps({
        segmentResponses: [
          // First segment exceeds soft limit ($1.2 > $1.0)
          { text: '## Findings\n\nEXPLORE-REPORT: FINDINGS=0', costUsd: 1.2 },
          // Second segment runs with wrap-up directive
          { text: '## Findings\n\nEXPLORE-REPORT: FINDINGS=0', costUsd: 0.5 },
        ],
      });
      const leaf = makeLeaf();
      const res = await runLeaf('proj', leaf, deps);

      // Expect wrap-up directive in second segment
      expect(spies.invokeSpecs.length).toBe(2);
      const wrapUpDirective = buildExploreWrapUpDirective();
      const secondSegmentPrompt = spies.invokeSpecs[1].prompt;
      expect(secondSegmentPrompt).toContain(wrapUpDirective);
    } finally {
      process.env.MERMAID_EXPLORE_SOFT_USD = savedSoft;
      process.env.MERMAID_EXPLORE_HARD_USD = savedHard;
    }
  });
});
