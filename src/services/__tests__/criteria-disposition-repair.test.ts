/**
 * criteria-disposition-repair.test.ts — the DISPOSITION-ROUTED citability repair.
 *
 * Regression cover for the fix that replaced the "re-author the WHOLE blueprint" citability
 * repair (~138s of opus / ~11.7k output tokens / ~523k cache reads to fix one sentence, on ~15.7%
 * of all blueprint evaluations) with a repair routed on the offence KIND the verdict already
 * carries:
 *   command-result ⇒ splice the line OUT, zero nodes.
 *   absence / out-of-diff-location ⇒ ONE node asked for only the replacement sentence, spliced in.
 * Plus the FLOOR GUARD: deletions must never leave a leaf with zero acceptance criteria.
 *
 * Everything effectful is mocked (mirrors leaf-executor.test.ts's makeDeps shape). No `claude`
 * node is spawned, no worktree/git is touched, and the ledger dir is redirected to a temp dir
 * before leaf-executor is imported.
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated ledger dir — leaf-executor's direct worker-ledger writes (clearLeafBlueprint on the
// park path, base-gate rows) must never touch the developer's real ~/.mermaid-collab store.
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'crit-disposition-ledger-'));

import { runLeaf, buildCriterionRewritePrompt, type LeafExecutorDeps } from '../leaf-executor';
import {
  scanCriteriaLines, planCriteriaDispositions, applyCriteriaDispositions,
  parseCriterionReplacements, actionForKind,
} from '../blueprint-criteria-splice';
import { parseBlueprintCriteria, validateCriteriaCitability } from '../criteria-citability';
import type { Todo } from '../todo-store';
import type { NodeResult, NodeSpec } from '../../agent/node-invoker';

const EPIC_BRANCH = 'collab/epic/abcd1234';
const EPIC_ID = 'epic-abcd1234';

function makeLeaf(over: Partial<Todo> = {}): Todo {
  return {
    id: '5c58cf82-87bf-49c4-b01a-bee5fc66502d',
    ownerSession: 'sess',
    assigneeSession: null,
    assigneeKind: 'agent',
    title: 'disposition leaf',
    description: 'do the thing',
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
    sessionName: 'leaf-exec-5c58cf82',
    executedBySession: 'leaf-exec-5c58cf82',
    blueprintId: null,
    type: null,
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
    nickname: 'nick',
    ...over,
  };
}

function okResult(text: string): NodeResult {
  return { ok: true, exitCode: 0, stdout: text, durationMs: 1, rateLimited: false, authMode: 'subscription', text };
}

/** Blueprint node = grants Write but NOT Edit (same discriminator leaf-executor.test.ts uses). */
const isBlueprintSpec = (spec: { allowedTools?: string }): boolean =>
  (spec.allowedTools ?? '').includes('Write') && !(spec.allowedTools ?? '').includes('Edit');

interface Spies {
  invokeSpecs: NodeSpec[];
  blueprintPrompts: string[];
  writes: Array<{ relPath: string; content: string }>;
  gateEvals: Array<any>;
}

/** Minimal deps: the blueprint node returns `blueprintReplies[n]` as its final message (the
 *  targeted-rewrite node's reply IS the answer), readBlueprint always returns `blueprintMd`,
 *  review always PASSes, and the mechanical gate is green. */
function makeDeps(opts: {
  blueprintMd: string;
  blueprintReplies?: string[];
}): { deps: LeafExecutorDeps; spies: Spies } {
  const spies: Spies = { invokeSpecs: [], blueprintPrompts: [], writes: [], gateEvals: [] };
  let bpIdx = 0;
  const deps = {
    invoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        spies.invokeSpecs.push(spec);
        if (isBlueprintSpec(spec)) {
          spies.blueprintPrompts.push(spec.prompt ?? '');
          const reply = opts.blueprintReplies?.[bpIdx] ?? 'done';
          bpIdx += 1;
          return okResult(reply);
        }
        if ((spec.allowedTools ?? '').startsWith('Read Grep Glob Bash')) {
          return okResult('- [MET] src/services/foo.ts:12\n\nVERDICT: PASS');
        }
        return okResult('done');
      },
    },
    wm: {
      async ensure(_k: string, o: { baseBranch?: string; fresh?: boolean }) {
        return { isGit: true, path: '/tmp/wt/crit1', branch: 'b', baseBranch: o?.baseBranch ?? 'm' } as never;
      },
      async remove() {},
    } as never,
    epicId: EPIC_ID,
    epicBranch: EPIC_BRANCH,
    epicBaseSha: 'base-sha-xyz',
    assertAuth: () => 'subscription',
    async complete(_p: string, _t: string, acceptance: 'accepted' | 'rejected') {
      return { effective: acceptance };
    },
    async markRejecting() { return true; },
    async bumpRetry() { return true; },
    async refundRetry() { return true; },
    async releaseClaim() { return true; },
    async holdLeaf() { return true; },
    async mergeToEpic() { return {}; },
    escalate() {},
    recordNode: () => null as any,
    setInflight: () => {},
    clearInflight: () => {},
    runGate: async () => ({ status: 'pass' as const, output: '', reasons: [], declared: true }),
    recordGateEval: async (_p: string, input: any) => { spies.gateEvals.push(input); return {} as any; },
    gateShadowMode: () => false,
    typedContractGating: () => false,
    readBlueprint: async () => opts.blueprintMd,
    writeArtifact: async (_cwd: string, relPath: string, content: string) => {
      spies.writes.push({ relPath, content });
    },
    worktreeDirty: () => [],
  } as unknown as LeafExecutorDeps;
  return { deps, spies };
}

const MANIFEST = '```json\n' + JSON.stringify({
  schemaVersion: 1,
  estimatedFiles: 1,
  estimatedTasks: 1,
  nonEnumerableFanout: false,
  filesToCreate: [],
  filesToEdit: ['src/services/foo.ts'],
  tasks: [{ id: 'task-1', files: ['src/services/foo.ts'] }],
}) + '\n```';

/** A citable criterion: cites a file:line inside the declared change-set (Rule 0 acquits). */
const CITABLE_A = '- `exportBar` is defined at src/services/foo.ts:12';
const CITABLE_B = '- `registerFoo` calls `exportBar` at src/services/foo.ts:31';
/** Uncitable command-result: exactly the redundant restatement the mechanical gate already runs. */
const COMMAND_RESULT = '- The full test suite passes';
const COMMAND_RESULT_2 = '- `bun test src/services/__tests__/foo.test.ts` passes';
/** Uncitable absence: real work nothing else enforces. */
const ABSENCE = '- src/services/foo.ts no longer imports legacyThing';

const blueprint = (criteria: string[]): string =>
  ['# Blueprint', '', '## Plan', '', 'Edit `src/services/foo.ts`.', '', '## Acceptance Criteria', '', ...criteria, '', MANIFEST].join('\n');

/** Byte-exact expectation helper: the original document minus the named lines. */
const withoutLines = (md: string, lines: string[]): string =>
  md.split('\n').filter((l) => !lines.includes(l)).join('\n');

/** The blueprint the executor wrote back after the citability repair (last write wins). */
const splicedWrite = (spies: Spies): string | undefined =>
  [...spies.writes].reverse().find((w) => w.relPath.includes('blueprint'))?.content;

const blueprintCalls = (spies: Spies): number => spies.invokeSpecs.filter(isBlueprintSpec).length;

// ─────────────────────────────────────────────────────────────────────────────
// The splice module (pure).
// ─────────────────────────────────────────────────────────────────────────────
describe('blueprint-criteria-splice — scanner mirrors parseBlueprintCriteria', () => {
  const fixtures = [
    blueprint([CITABLE_A, COMMAND_RESULT, ABSENCE]),
    blueprint(['1. first criterion', '2) second criterion', '* third criterion']),
    blueprint(['- [ ] unchecked criterion', '- [x] checked criterion']),
    blueprint(['- cited thing — cite src/services/foo.ts:12']),
    '# Blueprint\n\nno criteria section at all\n\n' + MANIFEST,
    '# Blueprint\n\n## Acceptance Criteria\n\n- one\n\n## Notes\n\n- not a criterion\n',
  ];
  it('extracts the SAME criterion texts as the gate parser, for every fixture', () => {
    for (const md of fixtures) {
      expect(scanCriteriaLines(md).map((c) => c.text)).toEqual(parseBlueprintCriteria(md));
    }
  });
  it('line indices point at the real source lines', () => {
    const md = blueprint([CITABLE_A, COMMAND_RESULT]);
    const lines = md.split('\n');
    for (const c of scanCriteriaLines(md)) expect(lines[c.lineIndex]).toBe(c.raw);
  });
});

describe('blueprint-criteria-splice — routing + splicing', () => {
  it('routes command-result to delete and everything else to rewrite', () => {
    expect(actionForKind('command-result')).toBe('delete');
    expect(actionForKind('absence')).toBe('rewrite');
    expect(actionForKind('out-of-diff-location')).toBe('rewrite');
    expect(actionForKind(undefined)).toBe('rewrite'); // conservative: never delete the unclassified
  });

  it('deletion removes ONLY the offending line — every other byte is identical', () => {
    const md = blueprint([CITABLE_A, COMMAND_RESULT, CITABLE_B]);
    const res = applyCriteriaDispositions(md, { deletes: ['The full test suite passes'], rewrites: [] });
    expect(res.deleted).toBe(1);
    expect(res.md).toBe(withoutLines(md, [COMMAND_RESULT]));
  });

  it('rewrite replaces the body in place, keeping indent/marker/checkbox', () => {
    const md = blueprint(['  - [ ] src/services/foo.ts no longer imports legacyThing', CITABLE_A]);
    const res = applyCriteriaDispositions(md, {
      deletes: [],
      rewrites: [{ text: 'src/services/foo.ts no longer imports legacyThing', replacement: '`grep -n legacyThing src/services/foo.ts` returns no matches' }],
    });
    expect(res.rewritten).toBe(1);
    expect(res.md.split('\n')).toContain('  - [ ] `grep -n legacyThing src/services/foo.ts` returns no matches');
    expect(res.md.split('\n')).toContain(CITABLE_A);
    // Same line count — a rewrite never adds or drops a line.
    expect(res.md.split('\n').length).toBe(md.split('\n').length);
  });

  it('FLOOR GUARD: an all-command-result blueprint is vacuous', () => {
    const md = blueprint([COMMAND_RESULT, COMMAND_RESULT_2]);
    const v = validateCriteriaCitability(md, ['src/services/foo.ts']);
    const plan = planCriteriaDispositions(md, v.offenders);
    expect(plan.deletes.length).toBe(2);
    expect(plan.remaining).toBe(0);
    expect(plan.vacuous).toBe(true);
  });

  it('a surviving criterion means NOT vacuous', () => {
    const md = blueprint([CITABLE_A, COMMAND_RESULT]);
    const v = validateCriteriaCitability(md, ['src/services/foo.ts']);
    const plan = planCriteriaDispositions(md, v.offenders);
    expect(plan.vacuous).toBe(false);
    expect(plan.remaining).toBe(1);
  });

  it('parses the numbered reply contract and ignores everything else', () => {
    const reply = [
      'Here are the replacements:',
      '1) `grep -c legacyThing src/services/foo.ts` returns 0',
      '2. - [ ] src/services/foo.ts:44 imports only `helper`',
      '9) out of range',
      '1) a later duplicate that must NOT win',
    ].join('\n');
    const parsed = parseCriterionReplacements(reply, 2);
    expect(parsed.get(1)).toBe('`grep -c legacyThing src/services/foo.ts` returns 0');
    expect(parsed.get(2)).toBe('src/services/foo.ts:44 imports only `helper`');
    expect(parsed.has(9)).toBe(false);
    expect(parsed.size).toBe(2);
  });

  it('an unparseable reply yields no replacements (criterion keeps its text)', () => {
    expect(parseCriterionReplacements('done', 1).size).toBe(0);
  });
});

describe('buildCriterionRewritePrompt', () => {
  it('quotes the offender, names the reason and the compliant shape, and asks for text only', () => {
    const p = buildCriterionRewritePrompt(makeLeaf(), [
      { text: 'src/services/foo.ts no longer imports legacyThing', reason: 'criterion asserts an absence', shape: 'Compliant shape: name a scope guard' },
    ]);
    expect(p).toContain('src/services/foo.ts no longer imports legacyThing');
    expect(p).toContain('criterion asserts an absence');
    expect(p).toContain('Compliant shape: name a scope guard');
    expect(p).toContain('1) <the replacement criterion');
    expect(p).toContain('Do NOT re-author the blueprint');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The executor wiring.
// ─────────────────────────────────────────────────────────────────────────────
describe('disposition-routed citability repair (runLeaf)', () => {
  it('command-result offender: ZERO extra blueprint nodes, survivors byte-identical', async () => {
    const md = blueprint([CITABLE_A, COMMAND_RESULT, CITABLE_B]);
    const { deps, spies } = makeDeps({ blueprintMd: md });
    const res = await runLeaf('proj', makeLeaf(), deps);

    // The whole point: the repair costs NO node. One blueprint call — the original authoring.
    expect(blueprintCalls(spies)).toBe(1);
    expect(res.outcome).toBe('accepted');
    // The spliced blueprint is the original minus exactly the offending line.
    expect(splicedWrite(spies)).toBe(withoutLines(md, [COMMAND_RESULT]));
  });

  it('absence offender: exactly ONE node, and every other criterion is byte-identical', async () => {
    const md = blueprint([CITABLE_A, ABSENCE, CITABLE_B]);
    const replacement = '`grep -n legacyThing src/services/foo.ts` returns no matches';
    const { deps, spies } = makeDeps({
      blueprintMd: md,
      // [0] the authoring node, [1] the targeted-rewrite node.
      blueprintReplies: [md, `1) ${replacement}`],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);

    expect(blueprintCalls(spies)).toBe(2); // authoring + ONE targeted rewrite
    expect(spies.blueprintPrompts[1]).toContain('Do NOT re-author the blueprint');
    expect(res.outcome).toBe('accepted');

    const out = splicedWrite(spies)!;
    // The offending line is replaced in place; nothing else moved.
    expect(out).toBe(md.split('\n').map((l) => (l === ABSENCE ? `- ${replacement}` : l)).join('\n'));
    expect(out.split('\n')).toContain(CITABLE_A);
    expect(out.split('\n')).toContain(CITABLE_B);
    expect(out).toContain(MANIFEST);
  });

  it('ALL criteria are command-results: parks as a SPEC DEFECT, never an empty criteria list', async () => {
    const md = blueprint([COMMAND_RESULT, COMMAND_RESULT_2]);
    const { deps, spies } = makeDeps({ blueprintMd: md });
    const res = await runLeaf('proj', makeLeaf(), deps);

    expect(res.outcome).toBe('blocked');
    expect(res.reason).toContain('blueprint-uncitable-criterion-vacuous');
    expect(res.reason).toContain('ZERO criteria');
    // Nothing was spliced, and no repair node was spent on an unsalvageable spec.
    expect(blueprintCalls(spies)).toBe(1);
    expect(spies.writes.filter((w) => w.content !== md).length).toBe(0);
    expect(spies.gateEvals.some((e) => e.verdict === 'vacuous-after-disposition')).toBe(true);
  });

  it('still uncitable after ONE targeted rewrite: parks, no second repair (bounded at once)', async () => {
    const md = blueprint([CITABLE_A, ABSENCE]);
    const { deps, spies } = makeDeps({
      blueprintMd: md,
      // The rewrite node answers off-contract ⇒ nothing parses ⇒ the criterion keeps its text.
      blueprintReplies: [md, 'I could not do it'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);

    expect(res.outcome).toBe('blocked');
    expect(res.reason).toContain('blueprint-uncitable-criterion');
    expect(res.reason).not.toContain('vacuous');
    expect(blueprintCalls(spies)).toBe(2); // authoring + ONE rewrite — never a second repair
  });

  it('a rewrite that is STILL uncitable also parks after exactly one attempt', async () => {
    const md = blueprint([CITABLE_A, ABSENCE]);
    const { deps, spies } = makeDeps({
      blueprintMd: md,
      blueprintReplies: [md, '1) legacyThing is no longer referenced anywhere'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toContain('blueprint-uncitable-criterion');
    expect(blueprintCalls(spies)).toBe(2);
  });
});
