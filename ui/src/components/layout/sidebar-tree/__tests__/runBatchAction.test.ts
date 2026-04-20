import { describe, it, expect, vi } from 'vitest';
import {
  runBatchAction,
  UnsupportedBatchAction,
  type BatchDeps,
} from '../runBatchAction';
import type { TreeNode } from '../getActionsForNode';

function makeNode(id: string): TreeNode {
  return {
    kind: 'artifact',
    id,
    name: `node-${id}`,
    artifactType: 'diagram',
  };
}

function makeDeps(overrides?: Partial<BatchDeps>): BatchDeps {
  return {
    performDelete: vi.fn().mockResolvedValue(undefined),
    applyDeprecatedToStore: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('runBatchAction', () => {
  it('rejects unknown actionId with UnsupportedBatchAction', async () => {
    const deps = makeDeps();
    await expect(runBatchAction('bogus', [makeNode('a')], deps)).rejects.toThrow(
      UnsupportedBatchAction,
    );
    try {
      await runBatchAction('bogus', [makeNode('a')], deps);
    } catch (e) {
      expect((e as UnsupportedBatchAction).actionId).toBe('bogus');
    }
  });

  it('handles empty nodes array on delete', async () => {
    const deps = makeDeps();
    const result = await runBatchAction('delete', [], deps);
    expect(result).toEqual({ ok: 0, failed: [] });
    expect(deps.performDelete).not.toHaveBeenCalled();
  });

  it('aggregates all-success delete of 3 nodes', async () => {
    const deps = makeDeps();
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const result = await runBatchAction('delete', nodes, deps);
    expect(result).toEqual({ ok: 3, failed: [] });
    expect(deps.performDelete).toHaveBeenCalledTimes(3);
    expect(deps.performDelete).toHaveBeenNthCalledWith(1, nodes[0]);
    expect(deps.performDelete).toHaveBeenNthCalledWith(2, nodes[1]);
    expect(deps.performDelete).toHaveBeenNthCalledWith(3, nodes[2]);
  });

  it('reports mixed success/failure on delete', async () => {
    const boom = new Error('boom');
    const performDelete = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce(undefined);
    const deps = makeDeps({ performDelete });
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const result = await runBatchAction('delete', nodes, deps);
    expect(result.ok).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].node.id).toBe('b');
    expect(result.failed[0].error).toBe(boom);
  });

  it('maps deprecate to applyDeprecatedToStore(node, true)', async () => {
    const deps = makeDeps();
    const nodes = [makeNode('a'), makeNode('b')];
    const result = await runBatchAction('deprecate', nodes, deps);
    expect(result).toEqual({ ok: 2, failed: [] });
    expect(deps.applyDeprecatedToStore).toHaveBeenCalledTimes(2);
    expect(deps.applyDeprecatedToStore).toHaveBeenNthCalledWith(1, nodes[0], true);
    expect(deps.applyDeprecatedToStore).toHaveBeenNthCalledWith(2, nodes[1], true);
  });

  it('maps undeprecate to applyDeprecatedToStore(node, false)', async () => {
    const deps = makeDeps();
    const nodes = [makeNode('a'), makeNode('b')];
    const result = await runBatchAction('undeprecate', nodes, deps);
    expect(result).toEqual({ ok: 2, failed: [] });
    expect(deps.applyDeprecatedToStore).toHaveBeenCalledTimes(2);
    expect(deps.applyDeprecatedToStore).toHaveBeenNthCalledWith(1, nodes[0], false);
    expect(deps.applyDeprecatedToStore).toHaveBeenNthCalledWith(2, nodes[1], false);
  });

  it('reports mixed success/failure on deprecate', async () => {
    const boom = new Error('boom');
    const applyDeprecatedToStore = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(boom);
    const deps = makeDeps({ applyDeprecatedToStore });
    const nodes = [makeNode('a'), makeNode('b')];
    const result = await runBatchAction('deprecate', nodes, deps);
    expect(result.ok).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].node.id).toBe('b');
    expect(result.failed[0].error).toBe(boom);
  });
});
