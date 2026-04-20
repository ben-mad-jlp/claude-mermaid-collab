import { describe, it, expect } from 'vitest';
import {
  getActionsForSelection,
  getActionsForNode,
  type TreeNode,
} from '../getActionsForNode';

const codeFile: TreeNode = {
  kind: 'code-file',
  id: 'code-1',
  name: 'foo.ts',
};

const doc1: TreeNode = {
  kind: 'artifact',
  artifactType: 'document',
  id: 'doc-1',
  name: 'Doc One',
};

const doc2: TreeNode = {
  kind: 'artifact',
  artifactType: 'document',
  id: 'doc-2',
  name: 'Doc Two',
};

const blueprint: TreeNode = {
  kind: 'blueprint',
  id: 'bp-1',
  name: 'Blueprint',
};

const image1: TreeNode = {
  kind: 'artifact',
  artifactType: 'image',
  id: 'img-1',
  name: 'Image',
};

function intersectionIdsInFirstOrder(nodes: TreeNode[]): string[] {
  const perNode = nodes.map((n) => getActionsForNode(n));
  const idSets = perNode.map((acts) => new Set(acts.map((a) => a.id)));
  return perNode[0]
    .filter((a) => idSets.every((s) => s.has(a.id)))
    .map((a) => a.id);
}

describe('getActionsForSelection', () => {
  it('(a) returns [] for empty input', () => {
    expect(getActionsForSelection([])).toEqual([]);
  });

  it('(b) single node returns getActionsForNode(node)', () => {
    expect(getActionsForSelection([codeFile])).toEqual(
      getActionsForNode(codeFile),
    );
  });

  it('(c) homogeneous pair of artifact-documents returns full shared set in first-node order', () => {
    const result = getActionsForSelection([doc1, doc2]);
    const expectedIds = getActionsForNode(doc1).map((a) => a.id);
    expect(result.map((a) => a.id)).toEqual(expectedIds);
  });

  it('(d) artifact-document + blueprint returns intersection ids', () => {
    const result = getActionsForSelection([doc1, blueprint]);
    const expectedIds = intersectionIdsInFirstOrder([doc1, blueprint]);
    expect(result.map((a) => a.id)).toEqual(expectedIds);
    // sanity: should be just ['deprecate'] per current action sets
    expect(expectedIds).toEqual(['deprecate']);
  });

  it('(e) artifact-document + code-file yields noop placeholder', () => {
    const result = getActionsForSelection([doc1, codeFile]);
    expect(result).toEqual([
      { id: 'noop', label: 'No shared actions', disabled: true },
    ]);
  });

  it('(f) artifact-image + artifact-document returns intersection ids in first-node order', () => {
    const result = getActionsForSelection([image1, doc1]);
    const expectedIds = intersectionIdsInFirstOrder([image1, doc1]);
    expect(result.map((a) => a.id)).toEqual(expectedIds);
    // guard: intersection must be non-empty for this combination
    expect(expectedIds.length).toBeGreaterThan(0);
  });
});
