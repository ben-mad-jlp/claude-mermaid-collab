import { describe, it, expect } from 'vitest';
import { systemToMermaid, type SystemNode } from './systemToMermaid';

const fleet: SystemNode[] = [
  { id: 'sup', kind: 'supervisor', label: 'Supervisor', status: 'running' },
  { id: 'plan-A', kind: 'planner', label: 'Planner A', status: 'idle', parentId: 'sup', session: 'planner-a' },
  { id: 'coord-A', kind: 'coordinator', label: 'Coordinator A', status: 'running', parentId: 'plan-A' },
  { id: 'w-1', kind: 'worker', label: 'worker-1', status: 'running', parentId: 'coord-A', heldTodo: 'add route', session: 'worker-1' },
  { id: 'w-2', kind: 'worker', label: 'worker-2', status: 'waiting', parentId: 'coord-A', session: 'worker-2' },
];

describe('systemToMermaid', () => {
  it('emits a flowchart with classDefs', () => {
    const { mermaid } = systemToMermaid(fleet);
    expect(mermaid.startsWith('flowchart TD')).toBe(true);
    expect(mermaid).toContain('classDef running');
    expect(mermaid).toContain('classDef escalation');
  });

  it('colors nodes by status', () => {
    const { mermaid } = systemToMermaid(fleet);
    expect(mermaid).toContain(':::running');
    expect(mermaid).toContain(':::waiting');
    expect(mermaid).toContain(':::idle');
  });

  it('uses distinct shapes per role', () => {
    const { mermaid } = systemToMermaid(fleet);
    expect(mermaid).toContain('sup{{"Supervisor"}}');     // supervisor = hexagon
    expect(mermaid).toContain('coord_A[["Coordinator A"]]'); // coordinator = subroutine
    expect(mermaid).toContain('plan_A(["Planner A"])');   // planner = stadium
  });

  it('annotates a worker with its held todo', () => {
    const { mermaid } = systemToMermaid(fleet);
    expect(mermaid).toContain('▸ add route');
  });

  it('draws hierarchy edges parent→child', () => {
    const { mermaid } = systemToMermaid(fleet);
    expect(mermaid).toContain('sup --> plan_A');
    expect(mermaid).toContain('plan_A --> coord_A');
    expect(mermaid).toContain('coord_A --> w_1');
  });

  it('skips edges to unknown parents', () => {
    const { mermaid } = systemToMermaid([{ id: 'orphan', kind: 'worker', label: 'o', parentId: 'ghost' }]);
    expect(mermaid).not.toContain('ghost');
    expect(mermaid).not.toContain('-->');
  });

  it('builds a node-id → session map (sanitized ids) for click→tmux', () => {
    const { nodeSessionMap } = systemToMermaid(fleet);
    expect(nodeSessionMap['w_1']).toBe('worker-1');
    expect(nodeSessionMap['plan_A']).toBe('planner-a');
    expect(nodeSessionMap['sup']).toBeUndefined(); // no session → not mapped
  });

  it('sanitizes ids and escapes quotes in labels', () => {
    const { mermaid } = systemToMermaid([{ id: '1-bad.id', kind: 'worker', label: 'a "b"', status: 'done' }]);
    expect(mermaid).toContain('_1_bad_id["a #quot;b#quot;"]:::done');
  });

  it('defaults missing status to unknown', () => {
    const { mermaid } = systemToMermaid([{ id: 'x', kind: 'worker', label: 'x' }]);
    expect(mermaid).toContain(':::unknown');
  });
});
