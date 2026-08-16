import { test, expect } from 'bun:test';
import {
  parseNamedAssertions,
  declaringCallerIn,
  assertionDeclaredIn,
  namedAssertionMisses,
  type AssertionFact,
} from '../criterion-verify-panel';

test('matches a named assertion declared with the other caller spelling', () => {
  // Criterion declares the assertion using 'it'
  const criterionText = `
  The guard checks "X" using it('X') and the test must red when the guarded behavior is reverted.
  `;

  // File declares it using 'test' instead
  const fileText = `
  test('X', () => {
    // guard logic
  });
  `;

  // Parse the names from criterion
  const names = parseNamedAssertions(criterionText);
  expect(names).toContain('X');

  // Verify that assertionDeclaredIn matches despite different caller spelling
  expect(assertionDeclaredIn(fileText, 'X')).toBe(true);

  // Verify declaringCallerIn returns 'test' when the file uses 'test'
  expect(declaringCallerIn(fileText, 'X')).toBe('test');

  // Verify that namedAssertionMisses does not list 'X' as missing
  const misses = namedAssertionMisses(criterionText, [{ path: 'test.ts', text: fileText }]);
  expect(misses).not.toContain('X');
});

test('still reports a miss when the named assertion is absent under either spelling', () => {
  // Criterion declares two assertions
  const criterionText = `
  Test 'First' and 'Second'.
  it('First') should red when neutered.
  test('Second') should also red.
  describe('Third') is the third one.
  `;

  // File only declares two of them
  const fileText = `
  describe('First', () => {
    test('nested assertion', () => {});
  });

  it('Second', () => {
    // logic here
  });
  `;

  // Parse names: should get 'First', 'Second', 'Third'
  const names = parseNamedAssertions(criterionText);
  expect(names).toContain('First');
  expect(names).toContain('Second');
  expect(names).toContain('Third');

  // 'Third' is missing — it's declared in the criterion text but not in the file
  expect(assertionDeclaredIn(fileText, 'Third')).toBe(false);
  expect(declaringCallerIn(fileText, 'Third')).toBe(null);

  // Verify namedAssertionMisses correctly reports 'Third' as missing
  const misses = namedAssertionMisses(criterionText, [{ path: 'test.ts', text: fileText }]);
  expect(misses).toContain('Third');
  expect(misses).not.toContain('First');
  expect(misses).not.toContain('Second');

  // With empty files array, everything is a miss
  const allMisses = namedAssertionMisses(criterionText, []);
  expect(allMisses).toEqual(['First', 'Second', 'Third']);
});
