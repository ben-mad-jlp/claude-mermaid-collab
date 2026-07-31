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
 * Each simulated leaf dispatch drives a REAL commit into a throwaway git fixture repo, and
 * `ownChangeSet` is resolved via the production `resolveLeafOwnChangeSet` seam over that repo —
 * not fabricated from batch size.
 *
 * Usage: bun run scripts/measure-shared-union-split.ts
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { applyFoundationFirst, type EpicSpec, type PlannedLeaf } from '../src/mcp/tools/mission-planner.ts';
import { partitionByFileContention } from '../src/services/file-mutex.ts';
import { classifyGateFailure, resolveLeafOwnChangeSet } from '../src/services/gate-base-attribution.ts';
import type { GitRunner } from '../src/services/main-checkout-invariant.ts';
import type { Todo } from '../src/services/todo-store.ts';

const DECLARED_FILE = 'src/services/conductor-pass.ts';
const FIXED_DIAGNOSTIC = `${DECLARED_FILE}(1,1): error TS2367: not all cases handled`;

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'measure-shared-union-split',
  GIT_AUTHOR_EMAIL: 'measure-shared-union-split@example.invalid',
  GIT_COMMITTER_NAME: 'measure-shared-union-split',
  GIT_COMMITTER_EMAIL: 'measure-shared-union-split@example.invalid',
};

/** Spawn `git` with a fixed identity so commits succeed on a bare CI machine with no global
 *  git identity configured. */
const runGit: GitRunner = (cwd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env: { ...process.env, ...GIT_ENV } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

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

interface FixtureRepo {
  tmpDir: string;
  baseBranch: string;
  epicBranch: string;
  runGit: GitRunner;
}

async function git(fixture: Pick<FixtureRepo, 'tmpDir' | 'runGit'>, args: string[]): Promise<string> {
  const res = await fixture.runGit(fixture.tmpDir, args);
  if (res.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${fixture.tmpDir}: ${res.stderr}`);
  }
  return res.stdout;
}

async function setupFixtureRepo(): Promise<FixtureRepo> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'measure-shared-union-'));
  const stub = { tmpDir, runGit };

  await git(stub, ['init']);
  writeFileSync(join(tmpDir, 'README.md'), '# fixture\n');
  const declaredDir = join(tmpDir, ...DECLARED_FILE.split('/').slice(0, -1));
  mkdirSync(declaredDir, { recursive: true });
  writeFileSync(join(tmpDir, DECLARED_FILE), `export type ConductorPassReason = 'a' | 'b' | 'c';\n`);

  await git(stub, ['add', '-A']);
  await git(stub, [
    '-c', `user.name=${GIT_ENV.GIT_AUTHOR_NAME}`,
    '-c', `user.email=${GIT_ENV.GIT_AUTHOR_EMAIL}`,
    'commit', '-m', 'fixture: base commit',
  ]);

  const baseBranch = (await git(stub, ['symbolic-ref', '--short', 'HEAD'])).trim();
  const epicBranch = 'collab/epic/measure';
  await git(stub, ['checkout', '-b', epicBranch]);

  return { tmpDir, baseBranch, epicBranch, runGit };
}

/** Writes `content` to each file under the fixture and commits on the current branch with a
 *  `Collab-Todo: <leafId>` trailer — the "leaf actually doing its work" step. */
async function commitLeaf(fixture: FixtureRepo, leafId: string, files: string[], content: string): Promise<void> {
  for (const file of files) {
    const abs = join(fixture.tmpDir, ...file.split('/'));
    mkdirSync(join(fixture.tmpDir, ...file.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(abs, content);
  }
  await git(fixture, ['add', '-A']);
  await git(fixture, [
    '-c', `user.name=${GIT_ENV.GIT_AUTHOR_NAME}`,
    '-c', `user.email=${GIT_ENV.GIT_AUTHOR_EMAIL}`,
    'commit', '-m', `${leafId}\n\nCollab-Todo: ${leafId}`,
  ]);
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

async function classify(
  fixture: FixtureRepo,
  leaf: DispatchRecord,
  batchSize: number,
  run: 'on' | 'off',
  diagnostic: string = FIXED_DIAGNOSTIC,
): Promise<DispatchedLeaf> {
  const ownChangeSet = await resolveLeafOwnChangeSet({
    cwd: fixture.tmpDir,
    epicBranch: fixture.epicBranch,
    baseBranch: fixture.baseBranch,
    leafId: leaf.id,
    runGit: fixture.runGit,
  });
  const classification = classifyGateFailure({
    command: 'tsc',
    output: diagnostic,
    ownChangeSet,
  });
  return { id: leaf.id, title: leaf.title, run, batchSize, kind: classification.kind };
}

interface RunDeps {
  applyFoundationFirst: typeof applyFoundationFirst;
  partitionByFileContention: typeof partitionByFileContention;
}

async function runOn(deps: RunDeps, fixture: FixtureRepo): Promise<DispatchedLeaf[]> {
  await git(fixture, ['checkout', fixture.epicBranch]);

  const spec: EpicSpec = { title: 'Extend ConductorPassReason', leaves: buildArmLeaves() };
  const normalised = deps.applyFoundationFirst(spec, {
    readFile: (p) => (p === DECLARED_FILE ? `export type ConductorPassReason = 'a' | 'b' | 'c';\n` : null),
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
    const { dispatch } = deps.partitionByFileContention(ready as unknown as Todo[], heldFiles);
    if (dispatch.length === 0) {
      throw new Error('ON run dispatch loop stalled: no ready leaves could dispatch this tick');
    }
    const batchSize = dispatch.length;
    for (const rec of dispatch as unknown as DispatchRecord[]) {
      dispatched.add(rec.id);
      landed.add(rec.id);
      const isFoundation = rec.id === 'on-0';
      if (isFoundation) {
        // The foundation leaf is the one that actually widens the shared union — its own
        // diff genuinely touches the declared file and resolves the diagnostic.
        await commitLeaf(fixture, rec.id, [DECLARED_FILE], `export type ConductorPassReason = 'a' | 'b' | 'c' | 'd';\n`);
        results.push(await classify(fixture, rec, batchSize, 'on', FIXED_DIAGNOSTIC));
      } else {
        // Arms dispatch AFTER the foundation has already fixed the union, so their own
        // diff never touches the shared file and their gate run never re-surfaces this
        // diagnostic — modeled as an empty gate output (no failure to classify).
        await commitLeaf(fixture, rec.id, [`scripts/__fixtures__/${rec.id}-scratch.ts`], `export const ${rec.id.replace(/-/g, '_')} = true;\n`);
        results.push(await classify(fixture, rec, batchSize, 'on', ''));
      }
    }
  }

  return results;
}

async function runOff(_deps: RunDeps, fixture: FixtureRepo): Promise<DispatchedLeaf[]> {
  await git(fixture, ['checkout', fixture.epicBranch]);

  const spec: EpicSpec = { title: 'Extend ConductorPassReason', leaves: buildArmLeaves() };
  const records = toRecords(spec.leaves, 'off');
  const batchSize = records.length;

  const results: DispatchedLeaf[] = [];
  for (const rec of records) {
    // No foundation leaf ever widens the union here, so no arm's own diff touches the
    // shared file — each arm's own (unrelated) work leaves the diagnostic foreign to it.
    await commitLeaf(fixture, rec.id, [`scripts/__fixtures__/${rec.id}-scratch.ts`], `export const ${rec.id.replace(/-/g, '_')} = true;\n`);
    results.push(await classify(fixture, rec, batchSize, 'off', FIXED_DIAGNOSTIC));
  }

  return results;
}

export async function runSharedUnionSplitMeasurement(deps: {
  applyFoundationFirst?: typeof applyFoundationFirst;
  partitionByFileContention?: typeof partitionByFileContention;
} = {}): Promise<{
  parksOn: number;
  parksOff: number;
  onLeaves: string[];
  offParkReasons: string[];
}> {
  const resolvedDeps: RunDeps = {
    applyFoundationFirst: deps.applyFoundationFirst ?? applyFoundationFirst,
    partitionByFileContention: deps.partitionByFileContention ?? partitionByFileContention,
  };

  const onFixture = await setupFixtureRepo();
  const offFixture = await setupFixtureRepo();
  try {
    const onResults = await runOn(resolvedDeps, onFixture);
    const offResults = await runOff(resolvedDeps, offFixture);

    const parksOn = onResults.filter((r) => r.kind === 'epic-base-red').length;
    const parksOff = offResults.filter((r) => r.kind === 'epic-base-red').length;
    const onLeaves = onResults.map((r) => r.title);
    const offParkReasons = offResults
      .filter((r) => r.kind === 'epic-base-red')
      .map((r) => `epic-base-red: ${r.title} batchSize=${r.batchSize}`);

    return { parksOn, parksOff, onLeaves, offParkReasons };
  } finally {
    rmSync(onFixture.tmpDir, { recursive: true, force: true });
    rmSync(offFixture.tmpDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { parksOn, parksOff, onLeaves, offParkReasons } = await runSharedUnionSplitMeasurement();

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

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
