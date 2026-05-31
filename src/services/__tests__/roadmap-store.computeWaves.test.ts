import { describe, it, expect, vi } from 'vitest';
vi.mock('bun:sqlite', () => ({ default: class {} }));
import { computeWaves } from '../roadmap-store';
import type { RoadmapItem } from '../roadmap-store';

function makeItem(id: string, dependsOn: string[] = []): RoadmapItem {
  return {
    id,
    project: 'test-project',
    title: `Item ${id}`,
    description: null,
    status: 'planned',
    ord: 0,
    parentId: null,
    dependsOn,
    sessionName: null,
    blueprintId: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function waveIds(waves: RoadmapItem[][]): string[][] {
  return waves.map(wave => wave.map(item => item.id).sort());
}

describe('computeWaves', () => {
  it('empty input returns []', () => {
    expect(computeWaves([])).toEqual([]);
  });

  it('linear chain A→B→C produces [[A],[B],[C]]', () => {
    const a = makeItem('A');
    const b = makeItem('B', ['A']);
    const c = makeItem('C', ['B']);
    const result = waveIds(computeWaves([a, b, c]));
    expect(result).toEqual([['A'], ['B'], ['C']]);
  });

  it('diamond: A; B,C dependsOn A; D dependsOn B,C produces [[A],[B,C],[D]]', () => {
    const a = makeItem('A');
    const b = makeItem('B', ['A']);
    const c = makeItem('C', ['A']);
    const d = makeItem('D', ['B', 'C']);
    const result = waveIds(computeWaves([a, b, c, d]));
    expect(result[0]).toEqual(['A']);
    expect(result[1]).toEqual(['B', 'C']);
    expect(result[2]).toEqual(['D']);
  });

  it('orphan / no deps: two independent items both in wave 0', () => {
    const a = makeItem('A');
    const b = makeItem('B');
    const result = computeWaves([a, b]);
    expect(result).toHaveLength(1);
    const ids = result[0].map(i => i.id).sort();
    expect(ids).toEqual(['A', 'B']);
  });

  it('unknown dep ignored: item dependsOn unknown id → treated as wave 0', () => {
    const a = makeItem('A', ['nonexistent']);
    const result = computeWaves([a]);
    expect(result).toHaveLength(1);
    expect(result[0][0].id).toBe('A');
  });

  it('cycle A↔B: terminates and both items appear exactly once', () => {
    const a = makeItem('A', ['B']);
    const b = makeItem('B', ['A']);
    const result = computeWaves([a, b]);
    const flat = result.flat().map(i => i.id).sort();
    expect(flat).toEqual(['A', 'B']);
    // Each id appears exactly once
    expect(flat.filter(id => id === 'A')).toHaveLength(1);
    expect(flat.filter(id => id === 'B')).toHaveLength(1);
  });

  it('self-dependency: terminates and item appears exactly once', () => {
    const a = makeItem('A', ['A']);
    const result = computeWaves([a]);
    const flat = result.flat().map(i => i.id);
    expect(flat).toEqual(['A']);
  });
});
