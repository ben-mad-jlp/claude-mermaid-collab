/**
 * QUARANTINE PROOF — deliberately RED.
 *
 * Its whole job is to fail. If the backend regression floor ever goes red because of this file,
 * the quarantine exclusion is broken and every epic in the project is blocked — which is the
 * pathology quarantine exists to prevent. A green floor with this file present IS the proof.
 */
import { describe, it, expect } from 'bun:test';

describe('quarantine proof (red by design)', () => {
  it('fails on purpose', () => {
    expect(1).toBe(2);
  });
});
