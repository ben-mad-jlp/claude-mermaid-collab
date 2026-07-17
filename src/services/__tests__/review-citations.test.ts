/**
 * Unit tests for the G3 grounding gate (review-citations.ts). Pure — no git, no spawn.
 * Run with `bun test src/services/__tests__/review-citations.test.ts`.
 */
import { describe, it, expect } from 'bun:test';
import { parseCriterionResults, extractCitations, citationResolves, validateReviewGrounding, checkConstraintCitations } from '../review-citations';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  it('ok: a criterion citing a path the change-set DELETES is grounded (deletion evidence)', () => {
    const text =
      '- [MET] MissionsStrip.tsx deleted (pure file removal) — ui/src/components/supervisor/MissionsStrip.tsx (deleted)\n\nVERDICT: PASS';
    const g = validateReviewGrounding(text, ['ui/src/components/supervisor/MissionsStrip.tsx']);
    expect(g.status).toBe('ok');
  });

  it('vacuous: a "(deleted)" citation whose path is NOT in the change-set still fails (anti-vacuous holds)', () => {
    const text =
      '- [MET] MissionsStrip.tsx deleted (pure file removal) — ui/src/components/supervisor/MissionsStrip.tsx (deleted)\n\nVERDICT: PASS';
    const g = validateReviewGrounding(text, ['src/a.ts']);
    expect(g.status).toBe('vacuous');
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

  it('a TOP-LEVEL dotfile citation is recognized — .gitignore:43 (regression: no-slash path false-blocked reviews as vacuous)', () => {
    const cites = extractCitations('- [MET] ignore digest — .gitignore:43');
    expect(cites.length).toBe(1);
    expect(cites[0].path).toBe('.gitignore');
    expect(cites[0].line).toBe(43);
  });

  it('a TOP-LEVEL extension file citation is recognized — package.json:12', () => {
    const cites = extractCitations('- [MET] bump — package.json:12');
    expect(cites[0].path).toBe('package.json');
    expect(cites[0].line).toBe(12);
  });

  it('prose "line:43" still yields no citation (no extension, no leading-dot file)', () => {
    expect(extractCitations('see line:43 above').length).toBe(0);
  });

  it('absolute path resolves against change-set via suffix rule', () => {
    expect(citationResolves('/tmp/wt/src/a.ts', ['src/a.ts'])).toBe(true);
  });

  it('a/foo.ts does NOT resolve against b/barfoo.ts (segment-anchored)', () => {
    expect(citationResolves('a/foo.ts', ['b/barfoo.ts'])).toBe(false);
  });
});

describe('checkConstraintCitations', () => {
  it('flags a fabricated id', () => {
    const result = checkConstraintCitations(
      '- [MET] honors constraint 11111111-1111-1111-1111-111111111111 — src/a.ts:3',
      ['22222222-2222-2222-2222-222222222222'],
    );
    expect(result.fabricated).toContain('11111111-1111-1111-1111-111111111111');
    expect(result.fabricated.length).toBe(1);
  });

  it('empty for a real active id', () => {
    const activeId = '11111111-1111-1111-1111-111111111111';
    const result = checkConstraintCitations(
      '- [MET] honors constraint 11111111-1111-1111-1111-111111111111 — src/a.ts:3',
      [activeId],
    );
    expect(result.fabricated).toEqual([]);
  });

  it('empty for a real active id using leading-8-hex short-id match', () => {
    const activeId = '11111111-1111-1111-1111-111111111111';
    // Citation uses only the leading 8 hex, matching via the short-id convention
    const result = checkConstraintCitations(
      '- [MET] honors constraint 11111111-XXXX-XXXX-XXXX-XXXXXXXXXXXX — src/a.ts:3',
      [activeId],
    );
    expect(result.fabricated).toEqual([]);
  });

  it('empty (no finding) for no citation', () => {
    const result = checkConstraintCitations(
      '- [MET] does the thing — src/a.ts:12\n\nVERDICT: PASS',
      ['22222222-2222-2222-2222-222222222222'],
    );
    expect(result.fabricated).toEqual([]);
  });

  it('advisory-only: the review verdict is not a function of the cite-check', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'leaf-executor.ts'), 'utf8');
    // The verdict's only inputs stay mech.status + llm — cite-check feeds neither.
    expect(src).toContain('composeVerdict(mech.status, llm)');
    expect(src).not.toMatch(/composeVerdict\([^)]*(checkConstraintCitations|citeCheck|constraintCiteNote)/);
  });

  it('result interface has only fabricated member', () => {
    const result = checkConstraintCitations('', []);
    expect(Object.keys(result)).toEqual(['fabricated']);
  });
});

// ── Retained-code tolerance + retained mode (decision review-grounding-retained-mode) ──
// Production false-block regressions: c8a58a92 (empty change-set after claim churn — work
// already carried by the epic base) and 8dbbdc8d (two-line criterion format parsed as an
// empty criterion). Grok-consulted design: worktree existence check per citation, change-set
// floor kept, NO blanket abstain, NO whole-review-only grounding.

describe('retained-code tolerance (citationExists)', () => {
  const existsAll = () => true;
  const existsNone = () => false;

  it('retained mode: empty change-set + citations resolving in the worktree → ok + flagged', () => {
    const text = [
      '1. [MET] preload exposes abort — bsync-viewer/desktop/preload.cjs:86',
      '2. [MET] chat-preload tracks turnId — bsync-viewer/desktop/assistant/chat-preload.cjs:5',
    ].join('\n');
    const g = validateReviewGrounding(text, [], { citationExists: existsAll });
    expect(g.status).toBe('ok');
    expect(g.retainedMode).toBe(true);
    expect(g.reasons.join(' ')).toContain('retained mode');
  });

  it('retained mode: fabricated citations (not in worktree) still block', () => {
    const text = '- [MET] does the thing — src/ghost.ts:12';
    const g = validateReviewGrounding(text, [], { citationExists: existsNone });
    expect(g.status).toBe('vacuous');
    expect(g.reasons.join(' ')).toContain('does not resolve in the worktree');
  });

  it('retained mode WITHOUT a predicate stays strict (no silent tolerance)', () => {
    const text = '- [MET] does the thing — src/real.ts:12';
    const g = validateReviewGrounding(text, []);
    expect(g.status).toBe('vacuous');
  });

  it('mixed leaf: retained-code criterion outside the change-set tolerated when it resolves in the worktree', () => {
    const text = [
      '- [MET] new flag wired — src/changed.ts:10',
      '- [MET] legacy path untouched and still correct — src/retained.ts:99',
    ].join('\n');
    const g = validateReviewGrounding(text, ['src/changed.ts'], {
      citationExists: (p) => p === 'src/retained.ts',
    });
    expect(g.status).toBe('ok');
    expect(g.retainedMode).toBe(false);
  });

  it('change-set floor: worktree tolerance never substitutes for ALL delta contact', () => {
    const text = [
      '- [MET] one — src/retained-a.ts:5',
      '- [MET] two — src/retained-b.ts:9',
    ].join('\n');
    const g = validateReviewGrounding(text, ['src/changed.ts'], { citationExists: existsAll });
    expect(g.status).toBe('vacuous');
    expect(g.reasons.join(' ')).toContain('never touched the delta');
  });
});

describe('two-line criterion format (8dbbdc8d regression)', () => {
  it('bare marker line adopts the preceding line text + citations', () => {
    const text = [
      '1. `McBridge.addSpellCheckWords` declared — ui/src/contexts/ServerContext.tsx:70',
      '   - [MET]',
      '2. hook exposes vocabWords — ui/src/hooks/useAutocorrect.ts:18, ui/src/hooks/useAutocorrect.ts:79',
      '   - [MET]',
    ].join('\n');
    const criteria = parseCriterionResults(text);
    expect(criteria).toHaveLength(2);
    expect(criteria[0].citations.map((c) => c.path)).toEqual(['ui/src/contexts/ServerContext.tsx']);
    expect(criteria[0].text).toContain('addSpellCheckWords');
    expect(criteria[1].citations).toHaveLength(2);
  });

  it('the full 8dbbdc8d shape grounds against its change-set', () => {
    const text = [
      '## CRITERIA',
      '1. `McBridge.addSpellCheckWords?: (words: string[]) => void;` declared — ui/src/contexts/ServerContext.tsx:70',
      '   - [MET]',
      '2. `useAutocorrect` return type includes `vocabWords` — ui/src/hooks/useAutocorrect.ts:18, ui/src/hooks/useAutocorrect.ts:79',
      '   - [MET]',
      '',
      'VERDICT: PASS',
    ].join('\n');
    const g = validateReviewGrounding(text, [
      'ui/src/contexts/ServerContext.tsx',
      'ui/src/hooks/useAutocorrect.ts',
    ]);
    expect(g.status).toBe('ok');
  });

  it('a bare marker with no citable predecessor still reads as citing nothing', () => {
    const text = 'prose line without citations\n- [MET]';
    const g = validateReviewGrounding(text, ['src/a.ts']);
    expect(g.status).toBe('vacuous');
    expect(g.reasons.join(' ')).toContain('cites nothing');
  });
});
