// Pure summarizeRoadmap tests — no DB needed.
import { describe, test, expect } from 'bun:test';
import type { RoadmapItem } from '../roadmap-store';
import { summarizeRoadmap } from '../roadmap-rollup';

let seq = 0;
function item(partial: Partial<RoadmapItem> & { title: string }): RoadmapItem {
  return {
    id: partial.id ?? `i${++seq}`,
    project: '/p',
    description: null,
    status: 'planned',
    ord: 0,
    parentId: null,
    dependsOn: [],
    sessionName: null,
    blueprintId: null,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe('summarizeRoadmap', () => {
  test('empty → zeroed rollup', () => {
    const r = summarizeRoadmap([], new Map());
    expect(r).toEqual({ total: 0, spawned: 0, unspawned: 0, items: [] });
  });

  test('joins items to their linked todos and counts session bindings', () => {
    const items = [
      item({ id: 'i1', title: 'A', sessionName: 'backend-1', status: 'in_progress' }),
      item({ id: 'i2', title: 'B', sessionName: null }),
    ];
    const todos = new Map<string, string[]>([
      ['i1', ['t1', 't2']],
      // i2 absent → no linked todos
    ]);
    const r = summarizeRoadmap(items, todos);
    expect(r.total).toBe(2);
    expect(r.spawned).toBe(1);
    expect(r.unspawned).toBe(1);
    expect(r.items[0]).toEqual({
      id: 'i1', title: 'A', status: 'in_progress', parentId: null,
      sessionName: 'backend-1', todoIds: ['t1', 't2'], todoCount: 2,
    });
    expect(r.items[1].sessionName).toBeNull();
    expect(r.items[1].todoIds).toEqual([]);
    expect(r.items[1].todoCount).toBe(0);
  });
});
