/**
 * Probe the crit-1 falsifiability heuristic (isNonFalsifiableReviewDoubt) against realistic
 * review-FAIL prose. TRUE = "non-falsifiable doubt" → the executor ABSTAINS (does NOT gate a
 * green-mech change). FALSE = "concrete falsifiable defect" → the executor GATES (revise/reject).
 *
 * A misclassification is a real defect:
 *   - expect=false but got true  → a REAL defect gets abstained → a bug SHIPS (dangerous).
 *   - expect=true  but got false → pure doubt GATES a correct change → OVER-REJECTION.
 */
import { isNonFalsifiableReviewDoubt } from '../../src/services/leaf-executor';

interface P { text: string; expect: boolean; why: string }

const CASES: P[] = [
  // ---- genuine NON-falsifiable doubt (expect TRUE → abstain) ----
  { expect: true, why: 'classic cant-confirm', text: 'VERDICT: FAIL — I cannot confirm the change is correct without running the full suite.' },
  { expect: true, why: 'nothing to review', text: 'VERDICT: FAIL — there is nothing to review in this diff.' },
  { expect: true, why: 'not enough context', text: 'VERDICT: FAIL — not enough context to assess whether this handles all cases.' },
  { expect: true, why: 'unable to verify', text: 'VERDICT: FAIL — unable to verify the behavior end to end.' },
  { expect: true, why: 'hard to tell', text: 'VERDICT: FAIL — it is hard to tell if this covers the concurrent path.' },
  { expect: true, why: 'insufficient evidence', text: 'VERDICT: FAIL — insufficient evidence that the migration is reversible.' },
  { expect: true, why: 'cant be sure', text: "VERDICT: FAIL — I can't be sure this doesn't regress the cache." },
  { expect: true, why: 'empty finding', text: 'VERDICT: FAIL —' },

  // ---- concrete FALSIFIABLE defects (expect FALSE → gate) ----
  { expect: false, why: 'missing null check w/ cite', text: 'VERDICT: FAIL — missing null check at src/users.ts:5; getUser(undefined) throws.' },
  { expect: false, why: 'off by one', text: 'VERDICT: FAIL — off-by-one: range(k+1) includes one extra element (agg.py:3).' },
  { expect: false, why: 'sign flip', text: 'VERDICT: FAIL — discount uses (1 + rate) at cart.ts:8, which increases the total.' },
  { expect: false, why: 'unmet criterion', text: 'VERDICT: FAIL — the age >= 18 rule is not implemented in validate() (validate.ts).' },
  { expect: false, why: 'injection', text: "VERDICT: FAIL — name is interpolated into SQL at repo.ts:3 instead of bound; injection." },
  { expect: false, why: 'wrong default', text: 'VERDICT: FAIL — parsePort defaults to 80, not 8080 as required (port.js:2).' },

  // ---- ADVERSARIAL: concrete defect whose prose HAPPENS to contain a doubt-ish phrase ----
  // A real defect that also says the reviewer "cannot verify" a secondary thing must STILL gate.
  { expect: false, why: 'concrete defect + incidental cant-verify tail', text: 'VERDICT: FAIL — save() does not await db.write at save.ts:3, so the row returns before the write commits. (I also cannot verify the retry path, but the missing await alone is the defect.)' },
  { expect: false, why: 'defect worded as difficult-to but concrete', text: 'VERDICT: FAIL — the mutable default acc=[] at acc.py:1 is shared across calls; this makes it difficult to avoid cross-call accumulation.' },
  { expect: false, why: 'concrete unmet + "hard to" filler', text: 'VERDICT: FAIL — copy_prefix writes dst[dstsize] one past the buffer (copy.c:6); this makes it hard to determine safe callers, but the overflow is the bug.' },

  // ---- ADVERSARIAL: pure doubt dressed up with a file:line that grounds NOTHING real ----
  { expect: true, why: 'doubt with a vague pointer but no asserted defect', text: 'VERDICT: FAIL — looking at cart.ts:6, I am not able to determine whether the tax rounding is correct.' },
];

let bad = 0;
for (const c of CASES) {
  const got = isNonFalsifiableReviewDoubt(c.text);
  const ok = got === c.expect;
  if (!ok) bad++;
  const danger = (!ok && c.expect === false) ? '  <<< DANGER: real defect would ABSTAIN → bug ships'
              : (!ok && c.expect === true) ? '  <<< over-reject: doubt would GATE correct code'
              : '';
  console.log(`${ok ? '✓' : '✗'} expect=${String(c.expect).padEnd(5)} got=${String(got).padEnd(5)} ${c.why}${danger}`);
}
console.log(`\n${CASES.length - bad}/${CASES.length} correct; ${bad} misclassified`);
