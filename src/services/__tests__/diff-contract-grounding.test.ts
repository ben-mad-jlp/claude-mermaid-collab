/**
 * Unit tests for the Phase-3 typed review-grounding path:
 *   parseBallotVerdicts (review-citations.ts) + groundReviewViaContract (diff-contract-review.ts).
 *
 * These prove the closed-ballot grounding used by the review node when TYPED_CONTRACT_GATING is ON
 * and a valid typed contract is present: mechanical stages run, undeclared/fabricated requirement
 * ids are rejected, uncited 'met' verdicts are rejected, and an unaddressed ballot requirement is a
 * vacuous PASS. Run with `bun test src/services/__tests__/diff-contract-grounding.test.ts`.
 */
import { describe, it, expect } from 'bun:test';
import { groundReviewViaContract, contractBallotRequirements, type DiffContractReviewDeps, type ParsedDiff } from '../diff-contract-review';
import { parseBallotVerdicts } from '../review-citations';
import { buildNodePrompt } from '../leaf-prompts';
import type { DiffContract, DiffRequirement } from '../diff-contract';
import type { Todo } from '../todo-store';

function makeContract(requirements: DiffRequirement[], leafKind: DiffContract['leafKind'] = 'feature'): DiffContract {
  return {
    schemaVersion: 2,
    estimatedFiles: 1,
    estimatedTasks: 1,
    nonEnumerableFanout: false,
    filesToCreate: [],
    filesToEdit: ['src/a.ts'],
    tasks: [],
    leafKind,
    requirements,
    outOfScope: [],
  };
}

// Deps that never touch git: tests flip returns whatever `flip` is; metrics resolve to null.
function makeDeps(flip: boolean | null = null): DiffContractReviewDeps {
  return {
    cwd: '/tmp/nowhere',
    baseSha: null,
    testsFlipBaseToBranch: async () => flip,
    readGateMetric: async () => null,
    runGrepCount: async () => null,
  };
}

const diff = (files: string[]): ParsedDiff => ({ changedFiles: files });

describe('parseBallotVerdicts', () => {
  it('parses a REQ-keyed verdict line with an outcome marker and keeps the line for citation extraction', () => {
    const v = parseBallotVerdicts('- [MET] REQ:obs-1 — src/a.ts:12\nsome prose\n- [UNMET] REQ:inv-2 explanation');
    expect(v).toEqual([
      { id: 'obs-1', outcome: 'met', text: '- [MET] REQ:obs-1 — src/a.ts:12' },
      { id: 'inv-2', outcome: 'unmet', text: '- [UNMET] REQ:inv-2 explanation' },
    ]);
  });
  it('ignores lines missing a REQ id or an outcome marker', () => {
    expect(parseBallotVerdicts('- [MET] no id here\nREQ:obs-1 but no marker')).toEqual([]);
  });
});

describe('groundReviewViaContract', () => {
  it('abstains (no park) when the change-set is unreadable (null diff)', async () => {
    const c = makeContract([{ kind: 'observable', id: 'obs-1', description: 'x' }]);
    const g = await groundReviewViaContract('anything', c, null, makeDeps());
    expect(g.status).toBe('abstain');
  });

  it('OK when the contract has only mechanical requirements and the review cites no ballot ids', async () => {
    const c = makeContract([{ kind: 'symbol-present', id: 'sym-1', file: 'src/a.ts', symbol: 'foo', description: 'foo added' }]);
    const g = await groundReviewViaContract('VERDICT: PASS', c, diff(['src/a.ts']), makeDeps());
    expect(g.status).toBe('ok');
  });

  it('REJECTS (vacuous) a review that cites a requirement id NOT declared in the contract', async () => {
    const c = makeContract([{ kind: 'observable', id: 'obs-1', description: 'x' }]);
    const g = await groundReviewViaContract('- [MET] REQ:ghost — src/a.ts:1\nVERDICT: PASS', c, diff(['src/a.ts']), makeDeps());
    expect(g.status).toBe('vacuous');
    expect(g.reasons.join(' ')).toMatch(/ghost/);
  });

  it('REJECTS (vacuous) a ballot requirement the review does not address at all', async () => {
    const c = makeContract([{ kind: 'observable', id: 'obs-1', description: 'x' }]);
    const g = await groundReviewViaContract('VERDICT: PASS', c, diff(['src/a.ts']), makeDeps());
    expect(g.status).toBe('vacuous');
    expect(g.reasons.join(' ')).toMatch(/obs-1/);
  });

  it('REJECTS (vacuous) a met ballot verdict whose citation resolves nowhere in the change-set', async () => {
    const c = makeContract([{ kind: 'observable', id: 'obs-1', description: 'x' }]);
    const g = await groundReviewViaContract('- [MET] REQ:obs-1 — src/other.ts:1', c, diff(['src/a.ts']), makeDeps());
    expect(g.status).toBe('vacuous');
  });

  it('OK when every ballot requirement is addressed by a declared, resolving verdict', async () => {
    const c = makeContract([{ kind: 'observable', id: 'obs-1', description: 'x' }]);
    const g = await groundReviewViaContract('- [MET] REQ:obs-1 — src/a.ts:1\nVERDICT: PASS', c, diff(['src/a.ts']), makeDeps());
    expect(g.status).toBe('ok');
  });

  it('runs the mechanical named-test stage (diffContractReview) — a flipping test yields a met verdict', async () => {
    const c = makeContract([{ kind: 'named-test', id: 'nt-1', testFile: 'src/a.test.ts', testName: 'does x', mechanical: true }], 'test');
    const g = await groundReviewViaContract('VERDICT: PASS', c, diff(['src/a.ts']), makeDeps(true));
    const nt = g.verdicts.find((v) => v.stage === 'named-test');
    expect(nt?.decision).toBe('met');
    // named-test is mechanical, not a ballot requirement, so grounding needs no REQ line ⇒ ok.
    expect(g.status).toBe('ok');
  });
});

describe('contractBallotRequirements', () => {
  it('returns ONLY the observable/invariant requirements, keyed by declared id', () => {
    const c = makeContract([
      { kind: 'symbol-present', id: 'sym-1', file: 'src/a.ts', symbol: 'foo', description: 'foo added' },
      { kind: 'observable', id: 'obs-1', description: 'panel shows the count' },
      { kind: 'invariant', id: 'inv-2', description: 'routes keep responding' },
    ]);
    expect(contractBallotRequirements(c)).toEqual([
      { id: 'obs-1', kind: 'observable', description: 'panel shows the count' },
      { id: 'inv-2', kind: 'invariant', description: 'routes keep responding' },
    ]);
  });
});

describe('review-prompt ballot → grounder closed loop (bug 6559ce96)', () => {
  const leaf = { id: 'leaf-1', title: 'a leaf', description: 'do the thing' } as unknown as Todo;

  it('a review that OBEYS the emitted ballot instruction grounds OK for every requirement id', async () => {
    const c = makeContract([
      { kind: 'observable', id: 'obs-1', description: 'panel shows the count' },
      { kind: 'invariant', id: 'inv-2', description: 'routes keep responding' },
    ]);
    const ballot = contractBallotRequirements(c).map((r) => ({ id: r.id, kind: r.kind, text: r.description }));
    const prompt = buildNodePrompt('review', leaf, undefined, undefined, undefined, ballot);
    // the prompt names every ballot id the grounder will demand a verdict for
    for (const r of ballot) expect(prompt).toContain(`REQ:${r.id}`);

    // A reviewer that follows the instruction: exactly one `- [MET] REQ:<id> — file:line` per id.
    const reviewText = [
      '- [MET] REQ:obs-1 — src/a.ts:12',
      '- [MET] REQ:inv-2 — src/a.ts:20',
      'VERDICT: PASS',
    ].join('\n');
    // parseBallotVerdicts recovers a verdict for every requirement id...
    expect(parseBallotVerdicts(reviewText).map((v) => v.id).sort()).toEqual(['inv-2', 'obs-1']);
    // ...and the full grounder passes (no uncited-gap, no fabricated id, met verdicts resolve).
    const g = await groundReviewViaContract(reviewText, c, diff(['src/a.ts']), makeDeps());
    expect(g.status).toBe('ok');
  });

  it('the PRE-FIX behaviour (review with NO ballot lines) parks as vacuous — what the fix cures', async () => {
    const c = makeContract([{ kind: 'observable', id: 'obs-1', description: 'panel shows the count' }]);
    const g = await groundReviewViaContract('VERDICT: PASS', c, diff(['src/a.ts']), makeDeps());
    expect(g.status).toBe('vacuous');
    expect(g.reasons.join(' ')).toMatch(/obs-1/);
  });
});
