#!/usr/bin/env bun
/**
 * measure-shared-union-split.ts — whole-surface measurement comparing the ON (foundation-first +
 * file-mutex) dispatch path against the OFF (no serialization) path for four leaves that all
 * extend the same shared closed union `ConductorPassReason`.
 *
 * ON run: applyFoundationFirst prepends a foundation leaf and rewires the 4 arms to depend on it;
 * partitionByFileContention then serializes dispatch of the same-file arms one per tick, so each
 * leaf lands alone against the file and its gate failure classifies as `own` (0 parks).
 *
 * OFF run: the same 4 arms dispatch together in one batch with no foundation leaf and no file
 * mutex, so each leaf's gate failure classifies as `epic-base-red` against the shared file (parks).
 *
 * Usage: bun run scripts/measure-shared-union-split.ts
 */
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyFoundationFirst, type EpicSpec, type PlannedLeaf } from '../src/mcp/tools/mission-planner.ts';
import { partitionByFileContention } from '../src/services/file-mutex.ts';
import { classifyGateFailure } from '../src/services/gate-base-attribution.ts';
import type { Todo } from '../src/services/todo-store.ts';

const DECLARED_FILE = 'src/services/conductor-pass.ts';
const FIXED_DIAGNOSTIC = `${DECLARED_FILE}(1,1): error TS2367: not all cases handled`;

interface DispatchRecord {
  id: string;
  title: string;
  declaredFiles: string[];
  dependsOn: string[];
}

interface DispatchedLeaf {
  id: string;
  title: string;
  run: 'on' | 'off';
  batchSize: number;
  kind: 'own' | 'epic-base-red' | 'unattributable';
}

function buildArmLeaves(): PlannedLeaf[] {
  return Array.from({ length: 4 }, (_, i) => ({
    title: `Arm ${i}: extend ConductorPassReason`,
    description: `Arm ${i}: extend ConductorPassReason in ${DECLARED_FILE}.`,
    files: [DECLARED_FILE],
  }));
}

function toRecords(leaves: PlannedLeaf[], idPrefix: string): DispatchRecord[] {
  return leaves.map((leaf, idx) => ({
    id: `${idPrefix}-${idx}`,
    title: leaf.title,
    declaredFiles: leaf.files ?? [],
    dependsOn: leaf.dependsOn ?? [],
  }));
}

/** Resolve $-token dependsOn (positional within the batch) to real record ids. */
function resolveDeps(records: DispatchRecord[]): void {
  for (const r of records) {
    r.dependsOn = r.dependsOn.map((d) => {
      const m = /^\$(\d+)$/.exec(d);
      if (!m) return d;
      const target = records[Number(m[1])];
      return target ? target.id : d;
    });
  }
}

function classify(leaf: DispatchRecord, batchSize: number, run: 'on' | 'off'): DispatchedLeaf {
  const ownChangeSet = batchSize === 1 ? leaf.declaredFiles : ['scripts/__fixtures__/unrelated.ts'];
  const classification = classifyGateFailure({
    command: 'tsc',
    output: FIXED_DIAGNOSTIC,
    ownChangeSet,
  });
  return { id: leaf.id, title: leaf.title, run, batchSize, kind: classification.kind };
}

function runOn(): DispatchedLeaf[] {
  const tmpDir = mkdtempSync(join(tmpdir(), 'measure-shared-union-'));
  const tempFile = join(tmpDir, 'conductor-pass.ts');
  writeFileSync(tempFile, `export type ConductorPassReason = 'a' | 'b' | 'c';\n`);

  const spec: EpicSpec = { title: 'Extend ConductorPassReason', leaves: buildArmLeaves() };
  const normalised = applyFoundationFirst(spec, {
    readFile: (p) => (p === DECLARED_FILE ? readFileSync(tempFile, 'utf8') : null),
  });

  if (normalised.leaves.length !== 5) {
    throw new Error(`applyFoundationFirst shape mismatch: expected 5 leaves, got ${normalised.leaves.length}`);
  }
  const arms = normalised.leaves.slice(1);
  for (const arm of arms) {
    if (!arm.dependsOn || arm.dependsOn.length !== 1 || arm.dependsOn[0] !== '$0') {
      throw new Error(`applyFoundationFirst shape mismatch: arm dependsOn was ${JSON.stringify(arm.dependsOn)}, expected ['$0']`);
    }
  }

  const records = toRecords(normalised.leaves, 'on');
  resolveDeps(records);

  const landed = new Set<string>();
  const dispatched = new Set<string>();
  const results: DispatchedLeaf[] = [];

  while (landed.size < records.length) {
    const ready = records.filter(
      (r) => !dispatched.has(r.id) && r.dependsOn.every((d) => landed.has(d)),
    );
    const heldFiles = new Set<string>();
    const { dispatch } = partitionByFileContention(ready as unknown as Todo[], heldFiles);
    if (dispatch.length === 0) {
      throw new Error('ON run dispatch loop stalled: no ready leaves could dispatch this tick');
    }
    const batchSize = dispatch.length;
    for (const rec of dispatch as unknown as DispatchRecord[]) {
      dispatched.add(rec.id);
      landed.add(rec.id);
      results.push(classify(rec, batchSize, 'on'));
    }
  }

  return results;
}

function runOff(): DispatchedLeaf[] {
  const spec: EpicSpec = { title: 'Extend ConductorPassReason', leaves: buildArmLeaves() };
  const records = toRecords(spec.leaves, 'off');
  const batchSize = records.length;
  return records.map((r) => classify(r, batchSize, 'off'));
}

export function runSharedUnionSplitMeasurement(): {
  parksOn: number;
  parksOff: number;
  onLeaves: string[];
  offParkReasons: string[];
} {
  const onResults = runOn();
  const offResults = runOff();

  const parksOn = onResults.filter((r) => r.kind === 'epic-base-red').length;
  const parksOff = offResults.filter((r) => r.kind === 'epic-base-red').length;
  const onLeaves = onResults.map((r) => r.title);
  const offParkReasons = offResults
    .filter((r) => r.kind === 'epic-base-red')
    .map((r) => `${r.title}: kind=epic-base-red batchSize=${r.batchSize}`);

  return { parksOn, parksOff, onLeaves, offParkReasons };
}

function main() {
  const { parksOn, parksOff, onLeaves, offParkReasons } = runSharedUnionSplitMeasurement();

  console.log(`MEASURE shared-union-split parksOn=${parksOn} parksOff=${parksOff}`);
  console.log('-- ON run (foundation-first + file-mutex) --');
  onLeaves.forEach((title, i) => console.log(`  [on] #${i} ${title}`));
  console.log('-- OFF run (no foundation-first, no file-mutex) --');
  offParkReasons.forEach((reason) => console.log(`  [off,parked] ${reason}`));

  if (parksOn !== 0 || parksOff < 3) {
    process.exit(1);
  }
  process.exit(0);
}

if (import.meta.main) main();
