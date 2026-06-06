// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  upsertType, getType, listTypes,
  createObject, getObject, listObjects,
  newRevision, listRevisions,
  contentHash, stableStringify, validateAttributes, validateChild,
  _closeProject,
} from '../system-object-store';
import type { SystemObjectType } from '../domain-plugin';

let project: string;

const TYPE_A: SystemObjectType = {
  id: 'demo:Widget', version: 1, domain: 'demo',
  attributeSchema: { properties: { color: {} }, required: ['color'], additionalProperties: false },
  allowedChildTypes: ['demo:Part'], requiredArtifacts: [], gateBinding: null, agentProfile: null,
};
const TYPE_PART: SystemObjectType = {
  id: 'demo:Part', version: 1, domain: 'demo',
  attributeSchema: {}, allowedChildTypes: [], requiredArtifacts: [], gateBinding: null, agentProfile: null,
};

beforeEach(async () => {
  project = mkdtempSync(join(tmpdir(), 'sys-obj-store-'));
  await upsertType(project, TYPE_A);
  await upsertType(project, TYPE_PART);
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

describe('pure helpers', () => {
  test('stableStringify is key-order independent', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });
  test('contentHash is stable across attribute key order and child order', () => {
    const h1 = contentHash({ x: 1, y: 2 }, [{ id: 'b', qty: 1 }, { id: 'a', qty: 2 }], ['z', 'a']);
    const h2 = contentHash({ y: 2, x: 1 }, [{ id: 'a', qty: 2 }, { id: 'b', qty: 1 }], ['a', 'z']);
    expect(h1).toBe(h2);
  });
  test('contentHash differs when qty differs', () => {
    expect(contentHash({}, [{ id: 'a', qty: 1 }], [])).not.toBe(contentHash({}, [{ id: 'a', qty: 2 }], []));
  });
  test('validateAttributes enforces required + additionalProperties:false', () => {
    const s = { properties: { color: {} }, required: ['color'], additionalProperties: false };
    expect(validateAttributes(s, { color: 'red' })).toEqual([]);
    expect(validateAttributes(s, {})).toEqual(['missing required attribute: color']);
    expect(validateAttributes(s, { color: 'red', extra: 1 })).toEqual(['unexpected attribute: extra']);
  });
  test('validateChild checks allowedChildTypes membership', () => {
    expect(validateChild('demo:Part', TYPE_A)).toBe(true);
    expect(validateChild('demo:Widget', TYPE_A)).toBe(false);
  });
});

describe('type registry', () => {
  test('getType returns highest version when unversioned', async () => {
    await upsertType(project, { ...TYPE_A, version: 2 });
    expect(getType(project, 'demo:Widget')?.version).toBe(2);
    expect(getType(project, 'demo:Widget', 1)?.version).toBe(1);
  });
  test('listTypes returns all seeded types', () => {
    expect(listTypes(project).map((t) => t.id).sort()).toEqual(['demo:Part', 'demo:Widget']);
  });
});

describe('createObject', () => {
  test('pins typeVersion at create and validates attributes', async () => {
    const o = await createObject(project, { typeId: 'demo:Widget', name: 'w1', attributes: { color: 'red' } });
    expect(o.typeVersion).toBe(1);
    expect(o.currentRevisionId).toBeNull();
    expect(getObject(project, o.id)?.name).toBe('w1');
  });
  test('rejects attributes that fail the type schema', async () => {
    await expect(createObject(project, { typeId: 'demo:Widget', name: 'bad', attributes: {} }))
      .rejects.toThrow(/attribute validation failed/);
  });
  test('enforces composition grammar on parent', async () => {
    const parent = await createObject(project, { typeId: 'demo:Widget', name: 'p', attributes: { color: 'b' } });
    const child = await createObject(project, { typeId: 'demo:Part', name: 'c', parentObjectId: parent.id });
    expect(child.parentObjectId).toBe(parent.id);
    // Widget is not an allowed child of Widget.
    await expect(createObject(project, { typeId: 'demo:Widget', name: 'x', attributes: { color: 'b' }, parentObjectId: parent.id }))
      .rejects.toThrow(/not an allowed child/);
  });
  test('rejects unknown type', async () => {
    await expect(createObject(project, { typeId: 'demo:Nope', name: 'n' })).rejects.toThrow(/unknown type/);
  });
  test('instances table carries NO lifecycle columns (firewall)', () => {
    // The mapped object exposes only durable fields — never status/claim/lease.
    // (Schema-level: see DDL. Here we assert the shape has no leaked keys.)
    return createObject(project, { typeId: 'demo:Part', name: 'fw' }).then((o) => {
      expect(Object.keys(o).sort()).toEqual(
        ['attributes', 'currentRevisionId', 'id', 'name', 'parentObjectId', 'qty', 'typeId', 'typeVersion'].sort(),
      );
    });
  });
});

describe('newRevision (content-hash reuse)', () => {
  test('reuses the revision on identical content, creates a new one on change', async () => {
    const o = await createObject(project, { typeId: 'demo:Widget', name: 'w', attributes: { color: 'red' } });
    const r1 = await newRevision(project, o.id);
    const r2 = await newRevision(project, o.id); // identical content
    expect(r2.id).toBe(r1.id);
    expect(r1.gateVerdict).toBe('unknown');
    expect(getObject(project, o.id)?.currentRevisionId).toBe(r1.id);
    expect(listRevisions(project, o.id)).toHaveLength(1);

    // Adding a child changes the canonical content → new revision.
    await createObject(project, { typeId: 'demo:Part', name: 'c', parentObjectId: o.id });
    const r3 = await newRevision(project, o.id);
    expect(r3.id).not.toBe(r1.id);
    expect(listRevisions(project, o.id)).toHaveLength(2);
  });
});

describe('listObjects', () => {
  test('filters by parent (incl. roots via null)', async () => {
    const root = await createObject(project, { typeId: 'demo:Widget', name: 'r', attributes: { color: 'b' } });
    await createObject(project, { typeId: 'demo:Part', name: 'c1', parentObjectId: root.id });
    await createObject(project, { typeId: 'demo:Part', name: 'c2', parentObjectId: root.id });
    expect(listObjects(project, { parentObjectId: root.id })).toHaveLength(2);
    expect(listObjects(project, { parentObjectId: null }).map((o) => o.name)).toContain('r');
  });
});
