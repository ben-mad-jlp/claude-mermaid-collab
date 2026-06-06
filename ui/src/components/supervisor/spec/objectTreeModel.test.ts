/**
 * systemObjectTree — proves the flat object list nests by parentObjectId,
 * flattens pre-order with depth, resolves coverage state, and that uncovered is
 * amber (warning), never red (one-red discipline).
 */

import { describe, it, expect } from 'vitest';
import { buildSystemObjectTree, flattenTree, coverageStateOf, COVERAGE_TINTS } from './objectTreeModel';
import type { SystemObjectNode, CoverageRollup } from '@/stores/supervisorStore';

function obj(p: Partial<SystemObjectNode>): SystemObjectNode {
  return {
    id: p.id ?? 'o1',
    typeId: p.typeId ?? 'pump',
    typeVersion: 1,
    parentObjectId: p.parentObjectId ?? null,
    qty: p.qty ?? 1,
    name: p.name ?? 'Pump',
    attributes: {},
    currentRevisionId: null,
    ...p,
  };
}

describe('buildSystemObjectTree', () => {
  it('nests children under parents and stamps depth', () => {
    const roots = buildSystemObjectTree([
      obj({ id: 'child', name: 'Valve', parentObjectId: 'root' }),
      obj({ id: 'root', name: 'Pump', parentObjectId: null }),
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('root');
    expect(roots[0].depth).toBe(0);
    expect(roots[0].children[0].id).toBe('child');
    expect(roots[0].children[0].depth).toBe(1);
  });

  it('surfaces orphans (missing parent) as roots — never dropped', () => {
    const roots = buildSystemObjectTree([obj({ id: 'x', parentObjectId: 'gone' })]);
    expect(roots.map((r) => r.id)).toEqual(['x']);
  });

  it('flattens pre-order', () => {
    const roots = buildSystemObjectTree([
      obj({ id: 'a', name: 'A', parentObjectId: null }),
      obj({ id: 'a1', name: 'A1', parentObjectId: 'a' }),
      obj({ id: 'b', name: 'B', parentObjectId: null }),
    ]);
    expect(flattenTree(roots).map((n) => n.id)).toEqual(['a', 'a1', 'b']);
  });
});

describe('coverageStateOf / COVERAGE_TINTS', () => {
  const coverage: CoverageRollup = {
    total: 1,
    covered: 0,
    partial: 0,
    uncovered: 1,
    byObject: [{ objectId: 'o1', name: 'Pump', typeId: 'pump', state: 'uncovered', todoCount: 0, doneCount: 0 }],
  };

  it('reads a row state and returns null for unknown objects', () => {
    expect(coverageStateOf('o1', coverage)).toBe('uncovered');
    expect(coverageStateOf('nope', coverage)).toBeNull();
    expect(coverageStateOf('o1', undefined)).toBeNull();
  });

  it('tints uncovered amber (warning), not red', () => {
    expect(COVERAGE_TINTS.uncovered.bg).toContain('warning');
    expect(COVERAGE_TINTS.uncovered.bg).not.toContain('danger');
    expect(COVERAGE_TINTS.covered.bg).toContain('success');
    expect(COVERAGE_TINTS.partial.bg).toContain('info');
  });
});
