import { describe, test, expect } from 'bun:test';
import { escalateMainCheckoutViolation } from '../main-checkout-escalation';
import { MainCheckoutResidueError, type MainCheckoutState } from '../main-checkout-invariant';

const before: MainCheckoutState = { branch: 'master', sha: 'abc123', residue: [] };
const after: MainCheckoutState = { branch: 'master', sha: 'abc123', residue: ['D  src/foo.ts', ' M src/bar.ts'] };

describe('escalateMainCheckoutViolation', () => {
  test('calls createEscalation with op name and every residue path', () => {
    const err = new MainCheckoutResidueError(
      '/test/repo',
      'land_epic',
      ['D  src/foo.ts', ' M src/bar.ts'],
      before,
      after,
    );

    const calls: any[] = [];
    const fakeCreateEscalation = (input: any) => {
      calls.push(input);
      return { escalation: {} as any, isNew: true };
    };

    escalateMainCheckoutViolation(err, { createEscalation: fakeCreateEscalation as any });

    expect(calls.length).toBe(1);
    const call = calls[0];
    expect(call.kind).toBe('main-checkout-residue');
    expect(call.session).toBe('daemon');
    expect(call.operatorGated).toBe(true);
    expect(call.project).toBe('/test/repo');
    expect(call.questionText).toContain('land_epic');
    expect(call.questionText).toContain('D  src/foo.ts');
    expect(call.questionText).toContain(' M src/bar.ts');
  });
});
