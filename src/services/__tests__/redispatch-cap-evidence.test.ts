import { describe, it, expect } from 'bun:test';
import { classifyRedispatchHistory, redispatchCapCardText, type RedispatchClaim } from '../redispatch-cap-evidence';

describe('redispatch-cap-evidence', () => {
  it('a zero-node dispatch history is carded as gate-killed, never as a blueprint loop', () => {
    const claims: RedispatchClaim[] = [
      { session: 'w1', nodesSpent: 0 },
      { session: 'w2', nodesSpent: 0 },
      { session: 'w3', nodesSpent: 0 },
    ];

    const classification = classifyRedispatchHistory(claims);
    expect(classification).toBe('gate-killed');

    const text = redispatchCapCardText({
      title: 'test-leaf',
      todoId: 'abc123def456',
      dispatches: 3,
      claims,
    });

    // Must contain the gate-kill cause wording.
    expect(text).toMatch(/before any node ran/i);
    expect(text).toMatch(/no blueprint was ever paid/i);

    // Must NOT contain the loop wording.
    expect(text).not.toMatch(/re-pays a full blueprint|this is a LOOP/i);

    // Should mention leaf_inspect.
    expect(text).toMatch(/leaf_inspect/);
  });

  it('a real blueprint-paying history keeps the loop wording', () => {
    const claims: RedispatchClaim[] = [
      { session: 'w1', nodesSpent: 5 },
      { session: 'w2', nodesSpent: 3 },
    ];

    const classification = classifyRedispatchHistory(claims);
    expect(classification).toBe('blueprint-loop');

    const text = redispatchCapCardText({
      title: 'test-leaf',
      todoId: 'abc123def456',
      dispatches: 2,
      claims,
    });

    // Must contain the loop wording.
    expect(text).toMatch(/re-pays\) a full blueprint/);
    expect(text).toMatch(/this is a LOOP/);

    // Should mention leaf_inspect.
    expect(text).toMatch(/leaf_inspect/);
  });
});
