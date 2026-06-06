// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertType, createObject, newRevision, _closeProject } from '../system-object-store';
import {
  derive, allocate, satisfy, verify, listEdges, coverage,
  markStaleForObject, markStaleForRequirement,
} from '../system-object-edges';
import type { SystemObjectType } from '../domain-plugin';

let project: string;
let objId: string;

const T: SystemObjectType = {
  id: 'demo:Thing', version: 1, domain: 'demo', attributeSchema: {},
  allowedChildTypes: [], requiredArtifacts: [], gateBinding: null, agentProfile: null,
};

beforeEach(async () => {
  project = mkdtempSync(join(tmpdir(), 'sys-obj-edges-'));
  await upsertType(project, T);
  const o = await createObject(project, { typeId: 'demo:Thing', name: 'thing', attributes: { v: 1 } });
  objId = o.id;
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

describe('the 4 SysML verbs', () => {
  test('derive/allocate/satisfy/verify create typed edges (satisfy+verify carry aboutObjectId)', () => {
    expect(derive(project, 'req:A', 'req:B').kind).toBe('derive');
    expect(allocate(project, 'req:A', objId).kind).toBe('allocate');
    const s = satisfy(project, objId, 'req:A');
    expect(s.kind).toBe('satisfy');
    expect(s.aboutObjectId).toBe(objId);
    const v = verify(project, 'verdict:1', 'req:A', objId);
    expect(v.aboutObjectId).toBe(objId);
    expect(listEdges(project)).toHaveLength(4);
    expect(listEdges(project, { kind: 'satisfy' })).toHaveLength(1);
  });
});

describe('coverage (LEFT JOIN active requirements × edges)', () => {
  test('a requirement with a satisfy/verify path is covered; others are not', () => {
    satisfy(project, objId, 'req:A');
    verify(project, 'verdict:1', 'req:B', objId);
    const r = coverage(project, ['req:A', 'req:B', 'req:C']);
    expect(r.covered.sort()).toEqual(['req:A', 'req:B']);
    expect(r.uncovered).toEqual(['req:C']);
  });
  test('allocate/derive edges do NOT count as coverage', () => {
    allocate(project, 'req:A', objId);
    derive(project, 'req:A', 'req:B');
    expect(coverage(project, ['req:A']).uncovered).toEqual(['req:A']);
  });
  test('empty requirement set → empty result', () => {
    expect(coverage(project, [])).toEqual({ covered: [], uncovered: [] });
  });
});

describe('STALE-on-bump', () => {
  test('markStaleForObject flips its satisfy+verify edges and drops coverage', () => {
    satisfy(project, objId, 'req:A');
    verify(project, 'verdict:1', 'req:A', objId);
    expect(coverage(project, ['req:A']).covered).toEqual(['req:A']);

    const staled = markStaleForObject(project, objId);
    expect(staled).toBe(2);
    expect(listEdges(project, { status: 'stale' })).toHaveLength(2);
    expect(coverage(project, ['req:A']).uncovered).toEqual(['req:A']);
  });

  test('markStaleForObject only affects satisfy/verify, not allocate', () => {
    allocate(project, 'req:A', objId);
    satisfy(project, objId, 'req:A');
    expect(markStaleForObject(project, objId)).toBe(1); // only the satisfy edge
    expect(listEdges(project, { kind: 'allocate' })[0].status).toBe('active');
  });

  test('requirement supersede marks edges pointing at it stale', () => {
    satisfy(project, objId, 'req:A');
    verify(project, 'verdict:1', 'req:A', objId);
    satisfy(project, objId, 'req:B');
    expect(markStaleForRequirement(project, 'req:A')).toBe(2);
    expect(coverage(project, ['req:A', 'req:B']).covered).toEqual(['req:B']);
  });

  test('newRevision triggers stale-on-bump only on a genuine content change', async () => {
    // Establish a baseline revision FIRST (a new revision always stales, so the
    // edge must be created after the baseline to observe the reuse-vs-change split).
    await newRevision(project, objId);                 // baseline (created)
    satisfy(project, objId, 'req:A');
    await newRevision(project, objId);                 // identical hash → reuse → no stale
    expect(coverage(project, ['req:A']).covered).toEqual(['req:A']);

    // Change content (add a child → new canonical hash → bump → stale).
    await upsertType(project, { ...T, allowedChildTypes: ['demo:Thing'] });
    await createObject(project, { typeId: 'demo:Thing', name: 'c', parentObjectId: objId });
    await newRevision(project, objId);                 // new hash → created → stale
    expect(coverage(project, ['req:A']).uncovered).toEqual(['req:A']);
  });
});
