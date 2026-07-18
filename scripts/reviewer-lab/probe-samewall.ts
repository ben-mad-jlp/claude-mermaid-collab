/**
 * Probe sameReviewWall(a,b) — the repeat-finding detector. TRUE = "same wall" (the revise loop
 * is stuck → stop reusing / park with a fork reason). FALSE = "different findings" (keep revising).
 *
 *   expect=true  but got false  → a genuine repeat is missed → implement↔review THRASH to
 *                                 node-budget exhaustion (wasted opus/sonnet calls).
 *   expect=false but got true   → two DIFFERENT findings read as the same → the loop gives up
 *                                 early on fixable work (a premature park = an over-rejection).
 */
import { sameReviewWall } from '../../src/services/leaf-executor';

interface P { a: string; b: string; expect: boolean; why: string }

const F = (lines: string[]) => lines.join('\n');

const CASES: P[] = [
  // ---- genuine repeats (expect TRUE) ----
  {
    expect: true, why: 'identical finding',
    a: F(['VERDICT: FAIL — missing null check', 'getUser throws on undefined id at src/users.ts:5']),
    b: F(['VERDICT: FAIL — missing null check', 'getUser throws on undefined id at src/users.ts:5']),
  },
  {
    expect: true, why: 'same finding, line number drifted',
    a: F(['- [UNMET] age>=18 rule not implemented — src/validate.ts:12']),
    b: F(['- [UNMET] age>=18 rule not implemented — src/validate.ts:20']),
  },
  {
    expect: true, why: 'same multi-line finding, one line reworded slightly',
    a: F(['the discount sign is flipped at cart.ts:8', 'total increases instead of decreasing']),
    b: F(['the discount sign is flipped at cart.ts:8', 'the total goes up rather than down']),
  },

  // ---- different findings (expect FALSE) ----
  {
    expect: false, why: 'wholly different defects',
    a: F(['VERDICT: FAIL — missing null check at src/users.ts:5']),
    b: F(['VERDICT: FAIL — sql injection via string interpolation at src/repo.ts:3']),
  },
  {
    expect: false, why: 'first finding fixed, a NEW second finding appears',
    a: F(['- [UNMET] empty name not rejected — src/validate.ts:8']),
    b: F(['- [UNMET] age<18 not rejected — src/validate.ts:14']),
  },

  // ---- ADVERSARIAL: same defect, fully reworded (drift defeats line-overlap) ----
  {
    expect: true, why: 'same defect, paraphrased with no shared long line',
    a: F(['the file handle leaks on the empty-file early return path at fsz.py:4']),
    b: F(['an early return skips f.close(), so the descriptor is never released (fsz.py:4)']),
  },
  // ---- ADVERSARIAL: different defects that SHARE boilerplate lines ----
  {
    expect: false, why: 'different defects sharing a common preamble line',
    a: F(['Reviewed the working tree against the blueprint.', 'VERDICT: FAIL — missing null check at users.ts:5']),
    b: F(['Reviewed the working tree against the blueprint.', 'VERDICT: FAIL — off-by-one in the loop at agg.py:3']),
  },
];

let bad = 0;
for (const c of CASES) {
  const got = sameReviewWall(c.a, c.b);
  const ok = got === c.expect;
  if (!ok) bad++;
  const danger = (!ok && c.expect === true) ? '  <<< missed repeat → THRASH to budget exhaustion'
              : (!ok && c.expect === false) ? '  <<< false repeat → premature PARK (gives up on fixable work)'
              : '';
  console.log(`${ok ? '✓' : '✗'} expect=${String(c.expect).padEnd(5)} got=${String(got).padEnd(5)} ${c.why}${danger}`);
}
console.log(`\n${CASES.length - bad}/${CASES.length} correct; ${bad} misclassified`);
