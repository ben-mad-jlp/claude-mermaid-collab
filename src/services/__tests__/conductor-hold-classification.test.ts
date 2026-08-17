import { describe, it, expect } from 'bun:test';
import { SIBLING_COLLISION_HOLD, holdOutcomeFor } from '../conductor-hold-classification.js';
import { CONDUCTOR_PASS_OUTCOME_CLASS, classifyConductorPassOutcome } from '../conductor-pass-outcome-class.js';

describe('conductor-hold-classification', () => {
  it('maps the sibling-collision hold reason to the held outcome', () => {
    expect(SIBLING_COLLISION_HOLD).toBe('sibling-collision');
    expect(holdOutcomeFor(SIBLING_COLLISION_HOLD)).toBe('held');
  });

  it('returns null for every other held reason', () => {
    expect(holdOutcomeFor('manual')).toBeNull();
    expect(holdOutcomeFor('retry-exhausted')).toBeNull();
    expect(holdOutcomeFor('migrated-park')).toBeNull();
    expect(holdOutcomeFor('dup-of-landed:abc12345')).toBeNull();
    expect(holdOutcomeFor(null)).toBeNull();
  });

  it('classifies the held pass outcome as stuck', () => {
    // Verify 'held' is an own key of the class table
    expect(Object.prototype.hasOwnProperty.call(CONDUCTOR_PASS_OUTCOME_CLASS, 'held')).toBe(true);
    // Verify it classifies as 'stuck'
    expect(classifyConductorPassOutcome('held')).toBe('stuck');
  });
});
