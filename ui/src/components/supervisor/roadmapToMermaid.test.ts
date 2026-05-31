import { describe, it, expect } from 'vitest';
import type { RoadmapItem } from '@/stores/supervisorStore';
import { roadmapToMermaid } from './roadmapToMermaid';

function makeItem(overrides: Partial<RoadmapItem> & { id: string; title: string; status: string }): RoadmapItem {
  return {
    project: 'test-project',
    ord: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    dependsOn: [],
    parentId: undefined,
    sessionName: undefined,
    ...overrides,
  } as RoadmapItem;
}

describe('roadmapToMermaid', () => {
  it('1. empty → exact empty output', () => {
    expect(roadmapToMermaid([])).toBe('flowchart TD\n  empty["No roadmap items"]');
    expect(roadmapToMermaid(null as any)).toBe('flowchart TD\n  empty["No roadmap items"]');
  });

  describe('2. single item graph mode', () => {
    it('done → :::done', () => {
      const result = roadmapToMermaid([makeItem({ id: 'a', title: 'Alpha', status: 'done' })]);
      expect(result).toContain('flowchart TD');
      expect(result).toContain('classDef done');
      expect(result).toContain('a["Alpha"]:::done');
    });

    it('in_progress → :::inprogress', () => {
      const result = roadmapToMermaid([makeItem({ id: 'b', title: 'Beta', status: 'in_progress' })]);
      expect(result).toContain('b["Beta"]:::inprogress');
    });

    it('unknown status → :::planned', () => {
      const result = roadmapToMermaid([makeItem({ id: 'c', title: 'Gamma', status: 'unknown_xyz' })]);
      expect(result).toContain('c["Gamma"]:::planned');
    });
  });

  describe('3. edges', () => {
    it('item B dependsOn A produces edge A --> B', () => {
      const a = makeItem({ id: 'alpha', title: 'Alpha', status: 'done' });
      const b = makeItem({ id: 'beta', title: 'Beta', status: 'planned', dependsOn: ['alpha'] });
      const result = roadmapToMermaid([a, b]);
      expect(result).toContain('alpha --> beta');
    });

    it('dep to non-existent id is NOT emitted as edge', () => {
      const b = makeItem({ id: 'beta', title: 'Beta', status: 'planned', dependsOn: ['nonexistent'] });
      const result = roadmapToMermaid([b]);
      expect(result).not.toContain('nonexistent -->');
      expect(result).not.toContain('--> beta');
    });
  });

  describe('4. parent/subgraph graph mode — double-emit regression', () => {
    it('parent with child: subgraph present, parent bare node NOT emitted standalone', () => {
      const parent = makeItem({ id: 'parent1', title: 'Parent Title', status: 'planned' });
      const child = makeItem({ id: 'child1', title: 'Child Title', status: 'in_progress', parentId: 'parent1' });
      const result = roadmapToMermaid([parent, child]);

      // subgraph should be emitted
      expect(result).toContain('subgraph parent1["Parent Title"]');
      // child nested inside
      expect(result).toContain('    child1["Child Title"]:::inprogress');
      // parent standalone bare node at 2-space indent should NOT exist outside the subgraph header
      // the bare node would be: '  parent1["Parent Title"]:::planned'
      expect(result).not.toContain('  parent1["Parent Title"]:::planned');
    });
  });

  describe('5. waves mode', () => {
    it('independent items land in wave 0; dependent items in higher waves', () => {
      const a = makeItem({ id: 'a', title: 'A', status: 'done' });
      const b = makeItem({ id: 'b', title: 'B', status: 'planned', dependsOn: ['a'] });
      const result = roadmapToMermaid([a, b], { mode: 'waves' });

      expect(result).toContain('subgraph wave_0["Wave 0"]');
      expect(result).toContain('subgraph wave_1["Wave 1"]');
      // a is in wave 0, b in wave 1
      const wave0Idx = result.indexOf('wave_0');
      const wave1Idx = result.indexOf('wave_1');
      const aIdx = result.indexOf('a["A"]');
      const bIdx = result.indexOf('b["B"]');
      expect(aIdx).toBeGreaterThan(wave0Idx);
      expect(aIdx).toBeLessThan(wave1Idx);
      expect(bIdx).toBeGreaterThan(wave1Idx);
    });
  });

  describe('6. sanitization and escaping', () => {
    it('id with special chars is sanitized to [A-Za-z0-9_] only', () => {
      const item = makeItem({ id: 'a/b c', title: 'Special', status: 'planned' });
      const result = roadmapToMermaid([item]);
      // sanitized id: 'a_b_c'
      expect(result).toContain('a_b_c["Special"]:::planned');
      expect(result).not.toContain('a/b c');
    });

    it('title with double-quote is escaped to #quot;', () => {
      const item = makeItem({ id: 'q', title: 'Say "Hello"', status: 'planned' });
      const result = roadmapToMermaid([item]);
      expect(result).toContain('q["Say #quot;Hello#quot;"]:::planned');
      // no raw double quote inside the label
      expect(result).not.toMatch(/q\["Say "Hello/);
    });
  });

  describe('7. id starting with digit gets prefixed', () => {
    it('id starting with digit does not start with digit after sanitization', () => {
      const item = makeItem({ id: '1abc', title: 'Numeric Start', status: 'planned' });
      const result = roadmapToMermaid([item]);
      // sanitized: '_1abc'
      expect(result).toContain('_1abc["Numeric Start"]:::planned');
      // should NOT have a node starting with 1
      expect(result).not.toMatch(/^\s+1abc\[/m);
    });
  });
});
