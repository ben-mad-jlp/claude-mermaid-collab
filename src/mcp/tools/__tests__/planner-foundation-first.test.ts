import { describe, test, expect } from 'bun:test';
import { applyFoundationFirst, type EpicSpec } from '../mission-planner.js';

describe('applyFoundationFirst', () => {
  test('groups leaves extending the same exported closed union into one foundation leaf that arms depend on', () => {
    const fixtureFile = 'src/services/conductor-pass.ts';
    const fixtureText = `export type ConductorPassReason = 'a' | 'b';\n`;
    const readFile = (p: string) => (p === fixtureFile ? fixtureText : null);

    const spec: EpicSpec = {
      title: 'Handle ConductorPassReason variants',
      leaves: [
        {
          title: 'Handle ConductorPassReason case a',
          description: 'branch on ConductorPassReason in conductor-pass.ts',
          files: [fixtureFile],
        },
        {
          title: 'Handle ConductorPassReason case b',
          description: 'branch on ConductorPassReason in conductor-pass.ts',
          files: [fixtureFile],
        },
        {
          title: 'Handle ConductorPassReason case c',
          description: 'branch on ConductorPassReason in conductor-pass.ts',
          files: [fixtureFile],
        },
      ],
    };

    const result = applyFoundationFirst(spec, { readFile });

    expect(result.leaves[0].files).toEqual([fixtureFile]);
    expect(result.leaves[0].dependsOn).toBeUndefined();
    expect(result.leaves[0].title).toContain('ConductorPassReason');
    expect(result.leaves[0].title).toContain(fixtureFile);

    const armLeaves = result.leaves.slice(1);
    expect(armLeaves).toHaveLength(3);
    for (const leaf of armLeaves) {
      expect(leaf.dependsOn).toContain('$0');
    }
  });

  test('returns the spec unchanged when leaves share no exported closed type', () => {
    const spec: EpicSpec = {
      title: 'Disjoint work',
      leaves: [
        { title: 'Leaf A', description: 'touch file A', files: ['src/a.ts'] },
        { title: 'Leaf B', description: 'touch file B', files: ['src/b.ts'] },
        { title: 'Leaf C', description: 'touch file C', files: ['src/c.ts'] },
      ],
    };
    const readFile = () => null;

    const result = applyFoundationFirst(spec, { readFile });

    expect(result.leaves).toHaveLength(spec.leaves.length);
    result.leaves.forEach((leaf, i) => {
      expect(leaf.dependsOn ?? []).toEqual(spec.leaves[i].dependsOn ?? []);
    });
  });
});
