import { describe, it, expect } from 'bun:test';
import { observedSubject } from './observed-subject';

describe('mutation-probe: observed shape', () => {
  it('observedSubject resolves to the expected computed value', async () => {
    const result = await observedSubject(5);
    expect(result).toBe(20);
  });
});
