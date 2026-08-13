/**
 * Regression spec (2026-08-12): the base-gate quarantine downgrade was structurally
 * dead — failing fingerprints carry a run-positional "(N/M) " prefix while quarantine
 * rows store bare paths, so raw set-membership never matched and six actively-
 * quarantined load-fragile files kept redding every epic base. The downgrade must
 * compare NORMALIZED fingerprints on both sides.
 */
import { describe, it, expect } from 'bun:test';
import { normalizeGateFingerprint } from '../leaf-gate';

describe('normalizeGateFingerprint', () => {
  it('strips the run-positional prefix from a failing-file entry', () => {
    expect(normalizeGateFingerprint('(500/600) src/services/__tests__/server-supervisor-term-grace.test.ts'))
      .toBe('src/services/__tests__/server-supervisor-term-grace.test.ts');
  });

  it('is identity for bare paths and case titles (stored quarantine forms)', () => {
    expect(normalizeGateFingerprint('src/services/__tests__/leaf-executor.test.ts'))
      .toBe('src/services/__tests__/leaf-executor.test.ts');
    expect(normalizeGateFingerprint('watchdog kill escalates SIGTERM → SIGKILL > grace window'))
      .toBe('watchdog kill escalates SIGTERM → SIGKILL > grace window');
  });

  it('does not eat a legitimate leading parenthetical that is not an ordinal', () => {
    expect(normalizeGateFingerprint('(regression) suite > case')).toBe('(regression) suite > case');
  });

  it('MUTATION-PROBE STAND-IN: a prefixed fingerprint and its bare-path quarantine row now meet', () => {
    const failing = '(502/600) src/services/__tests__/server-supervisor-watchdog.test.ts';
    const stored = 'src/services/__tests__/server-supervisor-watchdog.test.ts';
    // the exact comparison shape resolveBaseGreen uses after the fix
    const quarantined = new Set([normalizeGateFingerprint(stored)]);
    expect(quarantined.has(normalizeGateFingerprint(failing))).toBe(true);
    // and the pre-fix comparison provably failed — the guard can go red
    expect(new Set([stored]).has(failing)).toBe(false);
  });
});
