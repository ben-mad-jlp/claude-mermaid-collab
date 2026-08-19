// Runs via `bun test` (uses bun:test) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, it } from 'bun:test';
import { deriveFront, type CampaignProbe } from '../campaign-store';
import { computeFrontFingerprint } from '../campaign-front';

/**
 * Factory to build a full CampaignProbe from minimal input.
 */
function makeProbe(overrides: Partial<CampaignProbe>): CampaignProbe {
  return {
    id: '',
    campaignId: 'test-campaign',
    kind: 'command',
    environment: 'worktree',
    dependsOn: [],
    declaredPaths: [],
    verdict: 'not-run',
    command: null,
    createdAt: 1,
    ...overrides,
  };
}

describe('deriveFront', () => {
  test('yields one front probe for a chain-shaped dependency graph', () => {
    // A (not-run, no deps) -> B (not-run, deps on A) -> C (not-run, deps on B)
    // Only A should be in the front because:
    // - A: verdict is not-run (not pass), no deps to check -> IN FRONT
    // - B: verdict is not-run (not pass), but depends on A which is not-run (not pass) -> NOT IN FRONT
    // - C: verdict is not-run (not pass), but depends on B which is not-run (not pass) -> NOT IN FRONT
    const probes = [
      makeProbe({ id: 'A', dependsOn: [], verdict: 'not-run' }),
      makeProbe({ id: 'B', dependsOn: ['A'], verdict: 'not-run' }),
      makeProbe({ id: 'C', dependsOn: ['B'], verdict: 'not-run' }),
    ];

    const front = deriveFront(probes);
    expect(front).toHaveLength(1);
    expect(front[0]?.id).toBe('A');
  });

  test('yields every failing probe for a dependency-free graph', () => {
    // Three probes, all failing, no dependencies.
    // All should be in the front because:
    // - Each: verdict is fail (not pass), no deps to check -> IN FRONT
    const probes = [
      makeProbe({ id: 'X', dependsOn: [], verdict: 'fail' }),
      makeProbe({ id: 'Y', dependsOn: [], verdict: 'fail' }),
      makeProbe({ id: 'Z', dependsOn: [], verdict: 'fail' }),
    ];

    const front = deriveFront(probes);
    expect(front).toHaveLength(3);
    expect(front.map((p) => p.id)).toEqual(['X', 'Y', 'Z']);
  });

  test('omits a probe whose dependency holds verdict fail', () => {
    // A (verdict: fail) and B (depends on A, verdict: not-run)
    // - A: verdict is fail (not pass), no deps -> IN FRONT
    // - B: verdict is not-run (not pass), but depends on A which is fail (not pass) -> NOT IN FRONT
    const probes = [
      makeProbe({ id: 'A', dependsOn: [], verdict: 'fail' }),
      makeProbe({ id: 'B', dependsOn: ['A'], verdict: 'not-run' }),
    ];

    const front = deriveFront(probes);
    const ids = front.map((p) => p.id);
    expect(ids).toContain('A');
    expect(ids).not.toContain('B');
  });
});

describe('computeFrontFingerprint', () => {
  it('computeFrontFingerprint is stable under input order', () => {
    const probes = [
      makeProbe({ id: 'A', verdict: 'fail' }),
      makeProbe({ id: 'B', verdict: 'fail' }),
      makeProbe({ id: 'C', verdict: 'fail' }),
    ];

    const shaFn = (id: string) => {
      const shas: Record<string, string> = {
        A: 'sha1',
        B: 'sha2',
        C: 'sha3',
      };
      return shas[id] ?? null;
    };

    // Same probes in different order should yield the same fingerprint.
    const result1 = computeFrontFingerprint(probes, shaFn);
    const reorderedProbes = [probes[2]!, probes[0]!, probes[1]!];
    const result2 = computeFrontFingerprint(reorderedProbes, shaFn);

    expect(result1).toBe('A@sha1|B@sha2|C@sha3');
    expect(result2).toBe('A@sha1|B@sha2|C@sha3');
    expect(result1).toBe(result2);
  });

  it('computeFrontFingerprint changes when a probe latest verdict sha changes', () => {
    const probes = [
      makeProbe({ id: 'A', verdict: 'fail' }),
      makeProbe({ id: 'B', verdict: 'fail' }),
    ];

    const shaFn1 = (id: string) => {
      const shas: Record<string, string> = {
        A: 'sha1',
        B: 'sha2',
      };
      return shas[id] ?? null;
    };

    const shaFn2 = (id: string) => {
      const shas: Record<string, string> = {
        A: 'sha1-new',
        B: 'sha2',
      };
      return shas[id] ?? null;
    };

    const result1 = computeFrontFingerprint(probes, shaFn1);
    const result2 = computeFrontFingerprint(probes, shaFn2);

    expect(result1).toBe('A@sha1|B@sha2');
    expect(result2).toBe('A@sha1-new|B@sha2');
    expect(result1).not.toBe(result2);
  });

  it('computeFrontFingerprint changes when a probe leaves the failing set', () => {
    const probes = [
      makeProbe({ id: 'A', verdict: 'fail' }),
      makeProbe({ id: 'B', verdict: 'fail' }),
    ];

    const shaFn = (id: string) => {
      const shas: Record<string, string | null> = {
        A: 'sha1',
        B: null,
      };
      return shas[id] ?? null;
    };

    // With both probes.
    const result1 = computeFrontFingerprint(probes, shaFn);

    // With only the first probe.
    const result2 = computeFrontFingerprint([probes[0]!], shaFn);

    expect(result1).toBe('A@sha1|B@none');
    expect(result2).toBe('A@sha1');
    expect(result1).not.toBe(result2);
  });
});
