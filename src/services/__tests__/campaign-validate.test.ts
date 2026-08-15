// Runs via `bun test` (uses bun:test) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect } from 'bun:test';
import { validateCampaign, type ProbeForgeInput } from '../campaign-validate';

/**
 * Factory to build a valid ProbeForgeInput, overridable per test.
 */
function makeProbe(overrides: Partial<ProbeForgeInput>): ProbeForgeInput {
  return {
    ref: 'p',
    kind: 'command',
    environment: 'worktree',
    command: 'echo ok',
    dependsOn: [],
    ...overrides,
  };
}

describe('validateCampaign', () => {
  test('reports both probes missing a command out of three', () => {
    const probes = [
      makeProbe({ ref: 'a', command: undefined }),
      makeProbe({ ref: 'b', command: '   ' }),
      makeProbe({ ref: 'c', command: 'echo fine' }),
    ];

    const result = validateCampaign({ title: 'test', probes });

    expect(result.ok).toBe(false);
    const badRefs = result.offenders
      .filter((o) => o.reason.includes('runner command is required'))
      .map((o) => o.ref);
    expect(badRefs.sort()).toEqual(['a', 'b']);
  });

  test('flags every probe in a dependency cycle', () => {
    const probes = [
      makeProbe({ ref: 'a', dependsOn: ['b'] }),
      makeProbe({ ref: 'b', dependsOn: ['c'] }),
      makeProbe({ ref: 'c', dependsOn: ['a'] }),
    ];

    const result = validateCampaign({ title: 'test', probes });

    expect(result.ok).toBe(false);
    const cycleRefs = result.offenders.filter((o) => o.reason.includes('dependency cycle')).map((o) => o.ref);
    expect(cycleRefs.sort()).toEqual(['a', 'b', 'c']);
  });

  test('accepts an asserts naming a path outside the repository', () => {
    const probes = [
      makeProbe({ ref: 'a', asserts: '/var/log/deploy-report.json contains a green row' }),
    ];

    const result = validateCampaign({ title: 'test', probes });

    expect(result.ok).toBe(true);
    expect(result.offenders).toEqual([]);
  });

  test('rejects an out-of-union environment and an unresolvable dependsOn', () => {
    const probes = [
      makeProbe({ ref: 'a', environment: 'moon' as unknown as ProbeForgeInput['environment'] }),
      makeProbe({ ref: 'b', dependsOn: ['ghost'] }),
      makeProbe({ ref: 'c' }),
    ];

    const result = validateCampaign({ title: 'test', probes });

    expect(result.ok).toBe(false);
    expect(result.offenders.some((o) => o.ref === 'a' && o.reason.includes('invalid environment: moon'))).toBe(true);
    expect(result.offenders.some((o) => o.ref === 'b' && o.reason.includes('unresolvable dependsOn: ghost'))).toBe(
      true
    );
    expect(result.offenders.some((o) => o.ref === 'c')).toBe(false);
  });
});
