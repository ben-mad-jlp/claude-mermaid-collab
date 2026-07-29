import { describe, it, expect } from 'vitest';
import { selectHumanRedCount, isScopeRed } from '@/lib/humanRedDerivation';
import type { Escalation } from '@/stores/supervisorStore';
import type { StatusScope } from '@/lib/statusSelectors';

const scope: StatusScope = { kind: 'project', project: 'p' };

function esc(overrides: Partial<Escalation>): Escalation {
  return {
    id: 'esc-1',
    project: 'p',
    session: 's1',
    kind: 'blocker',
    questionText: 'q',
    status: 'open',
    createdAt: 0,
    ...overrides,
  };
}

describe('humanRedDerivation', () => {
  it('an open human-audience escalation makes the scope red', () => {
    const e = esc({ audience: 'human', kind: 'blocker' });
    expect(isScopeRed([e], scope)).toBe(true);
    expect(selectHumanRedCount([e], scope)).toBe(1);
  });

  it('an open internal-audience escalation does not make the scope red', () => {
    const e = esc({ audience: 'internal' });
    expect(isScopeRed([e], scope)).toBe(false);
    expect(selectHumanRedCount([e], scope)).toBe(0);
  });

  it('clears when the last open human escalation resolves', () => {
    const e1 = esc({ id: 'esc-1', audience: 'human', status: 'closed' });
    const e2 = esc({ id: 'esc-2', audience: 'human', status: 'open' });
    expect(isScopeRed([e1, e2], scope)).toBe(true);

    const afterResolve = [e1, { ...e2, status: 'closed' as const }];
    expect(isScopeRed(afterResolve, scope)).toBe(false);
  });

  it('no kind-specific carve-out — every escalation kind reddens the scope', () => {
    const kinds = ['mission-stalled', 'epic-base-red', 'over-budget'];
    for (const kind of kinds) {
      const e = esc({ kind, audience: 'human', status: 'open' });
      expect(isScopeRed([e], scope)).toBe(true);
    }
  });
});
