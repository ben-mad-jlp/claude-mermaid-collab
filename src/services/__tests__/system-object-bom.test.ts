// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertType, createObject, _closeProject } from '../system-object-store';
import { bom, whereUsed } from '../system-object-bom';
import type { SystemObjectType } from '../domain-plugin';

let project: string;

function type(id: string, allowedChildTypes: string[] = []): SystemObjectType {
  return { id, version: 1, domain: 'robotics', attributeSchema: {}, allowedChildTypes, requiredArtifacts: [], gateBinding: null, agentProfile: null };
}

// IDs captured for the §5 tree so the tests can query from specific nodes.
let robotId: string;
let motorId: string;

beforeEach(async () => {
  project = mkdtempSync(join(tmpdir(), 'sys-obj-bom-'));
  await upsertType(project, type('robotics:Robot', ['robotics:Axis', 'robotics:Sensor']));
  await upsertType(project, type('robotics:Axis', ['robotics:Motor', 'robotics:Encoder', 'robotics:Gearbox']));
  await upsertType(project, type('robotics:Motor'));
  await upsertType(project, type('robotics:Encoder'));
  await upsertType(project, type('robotics:Gearbox'));
  await upsertType(project, type('robotics:Sensor'));

  // §5 tree: Robot ─ Axis×6 ─ {Motor×1, Encoder×1, Gearbox×1}; Robot ─ Sensor×2
  const robot = await createObject(project, { typeId: 'robotics:Robot', name: 'Robot', qty: 1 });
  robotId = robot.id;
  const axis = await createObject(project, { typeId: 'robotics:Axis', name: 'Axis', qty: 6, parentObjectId: robot.id });
  const motor = await createObject(project, { typeId: 'robotics:Motor', name: 'Motor', qty: 1, parentObjectId: axis.id });
  motorId = motor.id;
  await createObject(project, { typeId: 'robotics:Encoder', name: 'Encoder', qty: 1, parentObjectId: axis.id });
  await createObject(project, { typeId: 'robotics:Gearbox', name: 'Gearbox', qty: 1, parentObjectId: axis.id });
  await createObject(project, { typeId: 'robotics:Sensor', name: 'Sensor', qty: 2, parentObjectId: robot.id });
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

describe('bom (recursive CTE, qty multiplies down)', () => {
  test('reproduces the §5 Robot example totals', () => {
    const totals = Object.fromEntries(bom(project, robotId).map((l) => [l.typeId, l.totalQty]));
    expect(totals['robotics:Motor']).toBe(6);
    expect(totals['robotics:Encoder']).toBe(6);
    expect(totals['robotics:Gearbox']).toBe(6);
    expect(totals['robotics:Sensor']).toBe(2);
    expect(totals['robotics:Axis']).toBe(6); // intermediate also rolls up
    expect(totals['robotics:Robot']).toBeUndefined(); // root excluded
  });

  test('empty for a leaf / unknown root', () => {
    expect(bom(project, motorId)).toEqual([]);
    expect(bom(project, 'nope')).toEqual([]);
  });
});

describe('whereUsed (walk up)', () => {
  test('returns the ancestor chain nearest-first', () => {
    const chain = whereUsed(project, motorId).map((n) => n.typeId);
    expect(chain).toEqual(['robotics:Axis', 'robotics:Robot']);
  });

  test('empty for the root', () => {
    expect(whereUsed(project, robotId)).toEqual([]);
  });
});
