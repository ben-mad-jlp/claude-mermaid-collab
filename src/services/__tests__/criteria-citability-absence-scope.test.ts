import { describe, it, expect } from 'bun:test';
import { classifyCriterion, namesTestFileAndAssertion } from '../criteria-citability.ts';

/**
 * Rule 3 (absence) convicts on a bare word match — "unchanged", "untouched", "no longer",
 * "without …ing". Correct for a bare assertion; wrong when the criterion also names a test file
 * AND an assertion inside it, where the absence word qualifies an INPUT rather than being the
 * claim. These pin both halves and the boundary between them.
 *
 * Why the acquittal is this narrow: namesTestInvocation abstains whenever declaredFiles is empty,
 * and MISSION criteria are always validated with none — so a citable mission criterion naming a
 * test file could never be acquitted. The generous namesDaemonProvableProof was tried and
 * rejected: it rescues bare `git diff` and arbitrary source paths, breaking eight existing
 * assertions in criteria-citability.test.ts.
 *
 * Measured cost of the false convictions this fixes (friction 192f35cf): leaf c2014368 blocked on
 * `criterion "Implementation untouched"`, a second leaf parked on the same wall while serving
 * campaign v2 criterion 5, and four forge_mission round-trips spent rewording citable criteria.
 */
describe('criteria-citability — absence acquits on a named test file plus assertion', () => {
  const ACQUITTED =
    "The conductor admits the verify arm past a serve signature unchanged from the prior pass, " +
    "asserted by it('runs the verify panel under an identical signature') in " +
    'src/services/__tests__/conductor-debounce-arm-selective.test.ts.';

  it('still convicts a bare absence assertion naming no proof', () => {
    const r = classifyCriterion('Implementation untouched', []);
    expect(r.citable).toBe(false);
    expect(r.kind).toBe('absence');
  });

  it('still convicts a bare "no new files" assertion naming no proof', () => {
    const r = classifyCriterion('No new files are added to the services directory', []);
    expect(r.citable).toBe(false);
    expect(r.kind).toBe('absence');
  });

  it('acquits an absence word when the criterion names a test file and an assertion', () => {
    expect(/\bunchanged\b/i.test(ACQUITTED)).toBe(true); // really does trip the absence pattern
    const r = classifyCriterion(ACQUITTED, []);
    expect(r.citable).toBe(true);
    expect(r.kind).not.toBe('absence');
  });

  // BOUNDARY. A source path or a file:line is NOT enough — that is the generous predicate this
  // acquittal deliberately avoids, because it would rescue vague removal claims.
  it('keeps convicting an absence that cites only a source file:line', () => {
    const r = classifyCriterion(
      'The legacy branch at src/services/mission-store.ts:1057 is no longer reachable.',
      [],
    );
    expect(r.citable).toBe(false);
    expect(namesTestFileAndAssertion('src/services/mission-store.ts:1057')).toBe(false);
  });

  // BOUNDARY. A test FILE with no assertion name is a vague suite claim, not a citation.
  it('keeps convicting an absence that names a test file but no assertion', () => {
    const r = classifyCriterion(
      'The behaviour is unchanged, covered by src/services/__tests__/foo.test.ts.',
      [],
    );
    expect(r.citable).toBe(false);
  });

  /**
   * MUTATION ARM. The guard is `rule3.uncitable && !namesTestFileAndAssertion(text)`. Dropping
   * it collapses Rule 3 to its old form. This re-derives that the acquitted text is convicted by
   * the un-guarded rule — so if the guard were reverted this suite goes red rather than passing
   * vacuously.
   */
  it('would convict the acquitted case if the guard were removed', () => {
    // The predicate is the ONLY thing standing between this text and an absence conviction:
    expect(namesTestFileAndAssertion(ACQUITTED)).toBe(true);
    expect(/\bunchanged\b/i.test(ACQUITTED)).toBe(true);
    expect(classifyCriterion(ACQUITTED, []).citable).toBe(true);
    // And it does not fire on the bare case, which is why that stays convicted either way:
    expect(namesTestFileAndAssertion('Implementation untouched')).toBe(false);
    expect(classifyCriterion('Implementation untouched', []).citable).toBe(false);
  });
});
