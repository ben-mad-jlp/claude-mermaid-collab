import { describe, it, expect } from 'bun:test';
import {
  areOrthogonal, findCycle, danglingRefs, validateMerged, runReconcile,
  type PlanNode, type ReconcileInputs,
} from '../planner-reconcile';
import type { DecisionRecord } from '../decision-record-store';

const n = (id: string, dependsOn: string[] = [], parentId: string | null = null): PlanNode => ({ id, dependsOn, parentId });
const constraint = (over: Partial<DecisionRecord>): DecisionRecord => ({
  id: 'c', project: '/p', epicId: null, kind: 'constraint', status: 'active', title: 'c',
  rationale: null, alternatives: [], supersededBy: null, linkedTodos: [], authorSession: null,
  approvedBy: null, createdAt: 0, updatedAt: 0, ...over,
});

describe('deterministic checks', () => {
  it('areOrthogonal: disjoint, non-cross-referencing deltas are orthogonal', () => {
    expect(areOrthogonal([n('a1'), n('a2')], [n('b1'), n('b2')])).toBe(true);
  });
  it('areOrthogonal: same node on both sides is NOT orthogonal', () => {
    expect(areOrthogonal([n('x')], [n('x')])).toBe(false);
  });
  it('areOrthogonal: a cross-reference (A depends on a B node) is NOT orthogonal', () => {
    expect(areOrthogonal([n('a1', ['b1'])], [n('b1')])).toBe(false);
  });
  it('findCycle detects a dependency cycle', () => {
    expect(findCycle([n('a', ['b']), n('b', ['a'])])).not.toBeNull();
    expect(findCycle([n('a', ['b']), n('b', [])])).toBeNull();
  });
  it('danglingRefs flags deps/parents pointing outside the graph', () => {
    expect(danglingRefs([n('a', ['ghost'])])).toEqual(['ghost']);
    expect(danglingRefs([n('a', []), n('b', ['a'])])).toEqual([]);
  });
  it('validateMerged reports cycle + dangling + dropped constraint todo', () => {
    const issues = validateMerged([n('a', ['b'])], [constraint({ linkedTodos: ['gone'] })]);
    expect(issues.some((i) => i.includes('dangling'))).toBe(true);
    expect(issues.some((i) => i.includes('lost linked todo'))).toBe(true);
  });
});

describe('runReconcile', () => {
  const noLlm = { llmMerge: async () => { throw new Error('should not be called'); } };

  it('orthogonal deltas short-circuit to a deterministic union (no LLM)', async () => {
    const inputs: ReconcileInputs = { deltaA: [n('a1')], deltaB: [n('b1')], constraints: [] };
    const r = await runReconcile(noLlm, inputs);
    expect(r.method).toBe('orthogonal-union');
    expect(r.valid).toBe(true);
    expect(r.mergedGraph.map((x) => x.id).sort()).toEqual(['a1', 'b1']);
  });

  it('non-orthogonal deltas delegate to llmMerge and validate the result', async () => {
    const inputs: ReconcileInputs = { deltaA: [n('x', ['y'])], deltaB: [n('y')], constraints: [] };
    const deps = { llmMerge: async () => ({ mergedGraph: [n('x', ['y']), n('y')] }) };
    const r = await runReconcile(deps, inputs);
    expect(r.method).toBe('llm-merge');
    expect(r.valid).toBe(true);
  });

  it('flags an invalid llmMerge result (cycle) as not valid', async () => {
    const inputs: ReconcileInputs = { deltaA: [n('x', ['y'])], deltaB: [n('y')], constraints: [] };
    const deps = { llmMerge: async () => ({ mergedGraph: [n('x', ['y']), n('y', ['x'])] }) };
    const r = await runReconcile(deps, inputs);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.includes('cycle'))).toBe(true);
  });

  it('passes through newConstraints from the merge', async () => {
    const inputs: ReconcileInputs = { deltaA: [n('x', ['y'])], deltaB: [n('y')], constraints: [] };
    const deps = { llmMerge: async () => ({ mergedGraph: [n('x'), n('y')], newConstraints: [{ title: 'keep Y stable' }] }) };
    const r = await runReconcile(deps, inputs);
    expect(r.newConstraints).toEqual([{ title: 'keep Y stable' }]);
  });
});
