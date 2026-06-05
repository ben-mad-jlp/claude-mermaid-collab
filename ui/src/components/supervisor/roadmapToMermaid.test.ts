import { describe, it, expect } from 'vitest';
import { computeWaveMap, sanitizeId } from './roadmapToMermaid';
import type { PlanItem } from '@/types/planItem';

/**
 * Bridge P6 retired the mermaid graph/waves render path; these tests now cover
 * the two helpers that survive (and feed the PlanKanban + FleetGraph).
 */

function item(p: Partial<PlanItem> & { id: string }): PlanItem {
  return {
    id: p.id,
    title: p.id,
    status: 'planned',
    parentId: null,
    dependsOn: [],
    ...p,
  } as PlanItem;
}

describe('computeWaveMap', () => {
  it('roots are wave 0; a dependent is one wave deeper', () => {
    const w = computeWaveMap([item({ id: 'a' }), item({ id: 'b', dependsOn: ['a'] })]);
    expect(w.get('a')).toBe(0);
    expect(w.get('b')).toBe(1);
  });

  it('wave = longest dependency chain depth', () => {
    const w = computeWaveMap([
      item({ id: 'a' }),
      item({ id: 'b', dependsOn: ['a'] }),
      item({ id: 'c', dependsOn: ['b'] }),
      // c also depends on a directly, but the longest chain (a→b→c) wins.
      item({ id: 'd', dependsOn: ['a', 'c'] }),
    ]);
    expect(w.get('a')).toBe(0);
    expect(w.get('b')).toBe(1);
    expect(w.get('c')).toBe(2);
    expect(w.get('d')).toBe(3);
  });

  it('ignores deps that point outside the item set', () => {
    const w = computeWaveMap([item({ id: 'b', dependsOn: ['missing'] })]);
    expect(w.get('b')).toBe(0);
  });

  it('does not loop forever on a dependency cycle', () => {
    const w = computeWaveMap([
      item({ id: 'a', dependsOn: ['b'] }),
      item({ id: 'b', dependsOn: ['a'] }),
    ]);
    expect(w.get('a')).toBeGreaterThanOrEqual(0);
    expect(w.get('b')).toBeGreaterThanOrEqual(0);
  });
});

describe('sanitizeId', () => {
  it('replaces non [A-Za-z0-9_] chars with underscores', () => {
    expect(sanitizeId('a/b c')).toBe('a_b_c');
  });

  it('prefixes ids that start with a digit', () => {
    expect(sanitizeId('1abc')).toBe('_1abc');
  });

  it('leaves an already-safe id unchanged', () => {
    expect(sanitizeId('Epic_1')).toBe('Epic_1');
  });
});
