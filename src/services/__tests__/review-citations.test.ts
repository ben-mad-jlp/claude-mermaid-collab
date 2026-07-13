/**
 * Unit tests for the G3 grounding gate (review-citations.ts). Pure — no git, no spawn.
 * Run with `bun test src/services/__tests__/review-citations.test.ts`.
 */
import { describe, it, expect } from 'bun:test';
import { parseCriterionResults, extractCitations, citationResolves, validateReviewGrounding } from '../review-citations';

describe('validateReviewGrounding', () => {
  it('vacuous: PASS with no criteria section', () => {
    const g = validateReviewGrounding('Looks good.\n\nVERDICT: PASS', ['src/a.ts']);
    expect(g.status).toBe('vacuous');
    expect(g.reasons.join(' ')).toContain('per-criterion');
  });

  it('vacuous: criterion cites a path absent from the change-set', () => {
    const text = '- [MET] does the thing — src/ghost.ts:12\n\nVERDICT: PASS';
    const g = validateReviewGrounding(text, ['src/a.ts']);
    expect(g.status).toBe('vacuous');
    expect(g.reasons.join(' ')).toContain('src/ghost.ts:12');
  });

  it('ok: newly created file cited', () => {
    const text = '- [MET] module exists and is pure — src/services/review-citations.ts:14\n\nVERDICT: PASS';
    const g = validateReviewGrounding(text, ['src/services/review-citations.ts']);
    expect(g.status).toBe('ok');
  });

  it('ok: legitimate TERSE review of a one-line diff — no token floor, no tool-call floor', () => {
    // This test exists so nobody reintroduces a length/effort floor.
    const text = '- [MET] typo fixed — src/a.ts:3\n\nVERDICT: PASS';
    expect(text.length).toBeLessThan(200);
    const g = validateReviewGrounding(text, ['src/a.ts']);
    expect(g.status).toBe('ok');
  });

  it('ok: 782052e2 shape — a criterion citing BOTH sides of a two-file change', () => {
    const text = [
      '- [MET] both server and UI agree on gate order — ui/src/gate.ts:31, src/services/leaf-gate.ts:67',
      '- [MET] no regression to existing gate — src/services/leaf-gate.ts:20',
      '',
      'VERDICT: PASS',
    ].join('\n');
    const g = validateReviewGrounding(text, ['ui/src/gate.ts', 'src/services/leaf-gate.ts']);
    expect(g.status).toBe('ok');
  });

  it('vacuous: the 782052e2 dodge — asserted in prose with no citation', () => {
    const text = '- [MET] server and UI agree on gate order\n\nVERDICT: PASS';
    const g = validateReviewGrounding(text, ['ui/src/gate.ts', 'src/services/leaf-gate.ts']);
    expect(g.status).toBe('vacuous');
  });

  it('N/A needs no citation, but an ALL-N/A review is vacuous', () => {
    const text = '- [N/A] no migration needed — the leaf touches no schema\n\nVERDICT: PASS';
    const g = validateReviewGrounding(text, ['src/a.ts']);
    expect(g.status).toBe('vacuous');
    expect(g.reasons.join(' ')).toContain('cite');
  });

  it('ok: absence-criterion fix — a cited positive PLUS an [N/A] non-goal is NOT vacuous (04062de3 shape)', () => {
    // The exact class that repeatedly stranded the mission-rewrite epic: a floor-path leaf whose
    // spec carried an inherently-uncitable non-goal. When the reviewer marks that non-goal [N/A]
    // (not [MET]) — as the review-node prompt now instructs — the positive criterion carries the
    // citation and the leaf survives. If someone later "tightens" the gate to convict N/A even when
    // a positive criterion is cited, this fails and the whole failure class comes back.
    const text = [
      '- [MET] servesCriterionId plumbed through createTodo — src/services/todo-store.ts:872',
      '- [N/A] No phase/iteration/maxIterations changes (non-goal respected) — absence, nothing to cite',
      '',
      'VERDICT: PASS',
    ].join('\n');
    const g = validateReviewGrounding(text, ['src/services/todo-store.ts']);
    expect(g.status).toBe('ok');
  });

  it('abstain: changeSet === null, never vacuous', () => {
    const text = 'no criteria at all\n\nVERDICT: PASS';
    const g = validateReviewGrounding(text, null);
    expect(g.status).toBe('abstain');
  });

  it('vacuous: empty change-set [] plus a citation', () => {
    const text = '- [MET] does the thing — src/a.ts:1\n\nVERDICT: PASS';
    const g = validateReviewGrounding(text, []);
    expect(g.status).toBe('vacuous');
  });

  it('ok: a criterion with ≥1 resolving citation tolerates an extra out-of-change-set citation', () => {
    const text = '- [MET] both sites agree — src/a.ts:1, src/ghost.ts:9\n\nVERDICT: PASS';
    const g = validateReviewGrounding(text, ['src/a.ts']);
    expect(g.status).toBe('ok');
  });

  it('vacuous: a criterion whose citations ALL fail to resolve rejects', () => {
    const text = '- [MET] does the thing — src/ghost.ts:1, src/other.ts:2\n\nVERDICT: PASS';
    const g = validateReviewGrounding(text, ['src/a.ts']);
    expect(g.status).toBe('vacuous');
  });

  it('vacuous: a [MET] criterion citing nothing is still vacuous (placebo-hole preserved)', () => {
    const text = '- [MET] server and UI agree on gate order\n\nVERDICT: PASS';
    const g = validateReviewGrounding(text, ['src/a.ts']);
    expect(g.status).toBe('vacuous');
    expect(g.reasons.join(' ')).toContain('cites nothing');
  });
});

describe('parseCriterionResults', () => {
  it('parses [MET]/[met]/[N/A]/[NA] markers', () => {
    const text = [
      '- [MET] a — src/a.ts:1',
      '- [met] b — src/b.ts:2',
      '- [N/A] c — no reason needed',
      '- [NA] d — no reason needed',
    ].join('\n');
    const r = parseCriterionResults(text);
    expect(r.map((c) => c.outcome)).toEqual(['met', 'met', 'not-applicable', 'not-applicable']);
  });

  it('a `:12-40` range parses to the start line', () => {
    const cites = extractCitations('see src/a.ts:12-40');
    expect(cites[0].line).toBe(12);
  });

  it('prose "see step 3:12" yields no citation (no file extension)', () => {
    const cites = extractCitations('see step 3:12 for details');
    expect(cites.length).toBe(0);
  });

  it('a filename containing `_` survives (regression guard against stripSentinelFmt)', () => {
    const cites = extractCitations('- [MET] a — src/my_file_name.ts:5');
    expect(cites[0].path).toBe('src/my_file_name.ts');
  });

  it('absolute path resolves against change-set via suffix rule', () => {
    expect(citationResolves('/tmp/wt/src/a.ts', ['src/a.ts'])).toBe(true);
  });

  it('a/foo.ts does NOT resolve against b/barfoo.ts (segment-anchored)', () => {
    expect(citationResolves('a/foo.ts', ['b/barfoo.ts'])).toBe(false);
  });
});
