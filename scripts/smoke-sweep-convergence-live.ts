/**
 * Live end-to-end smoke test — convergence+land sweep measurement.
 *
 * Exercises the REAL `runSweepMeasurement` primitive against the live/self project
 * (no temp-project fixture — this sweep is read-mostly and must observe actual repo
 * state), runs it twice consecutively, and asserts:
 *   - each run's zero-count invariants hold
 *   - the second (idempotence) run promotes/deletes nothing new
 *   - the two runs agree on their zero-counts (no oscillation)
 *
 * Run:  bun run scripts/smoke-sweep-convergence-live.ts
 */
import { runSweepMeasurement, type SweepMeasurement } from '../src/services/sweep-measurement.js';
import { MERMAID_PROJECT } from '../src/config.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const project = MERMAID_PROJECT;
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log(`\n🔬 Live sweep-measurement convergence smoke test`);
console.log(`   project: ${project}\n`);

function assertRunInvariants(run: SweepMeasurement, n: number) {
  check(
    `run ${n}: sessionsZeroActiveWithQueuedApproved empty`,
    run.sessionsZeroActiveWithQueuedApproved.length === 0,
    JSON.stringify(run.sessionsZeroActiveWithQueuedApproved),
  );
  check(
    `run ${n}: landedAtDivergence.count === 0`,
    run.landedAtDivergence.count === 0,
    JSON.stringify(run.landedAtDivergence.ids),
  );
  check(
    `run ${n}: fullyOnMasterBranchesRemaining === 0`,
    run.fullyOnMasterBranchesRemaining.length === 0,
    JSON.stringify(run.fullyOnMasterBranchesRemaining),
  );
}

console.log(`Run 1`);
const run1: SweepMeasurement = runSweepMeasurement(project);
assertRunInvariants(run1, 1);

console.log(`\nRun 2 (idempotence check)`);
const run2: SweepMeasurement = runSweepMeasurement(project);
assertRunInvariants(run2, 2);

check('run 2 promoted no new missions', run2.promoted.length === 0, `promoted=[${run2.promoted.join(',')}]`);
check('run 2 deleted no new branches', run2.gcDeleted.length === 0, `gcDeleted=[${run2.gcDeleted.join(',')}]`);
check(
  'run 2 identical zero counts to run 1 (no oscillation)',
  run1.landedAtDivergence.count === run2.landedAtDivergence.count &&
    run1.fullyOnMasterBranchesRemaining.length === run2.fullyOnMasterBranchesRemaining.length &&
    run1.sessionsZeroActiveWithQueuedApproved.length === run2.sessionsZeroActiveWithQueuedApproved.length,
  `run1={div:${run1.landedAtDivergence.count},fom:${run1.fullyOnMasterBranchesRemaining.length},zaq:${run1.sessionsZeroActiveWithQueuedApproved.length}} run2={div:${run2.landedAtDivergence.count},fom:${run2.fullyOnMasterBranchesRemaining.length},zaq:${run2.sessionsZeroActiveWithQueuedApproved.length}}`,
);

const resultsDir = join(process.cwd(), '.collab', 'sweep-measurement-results');
mkdirSync(resultsDir, { recursive: true });
const resultsPath = join(resultsDir, `run-${Date.now()}.json`);
writeFileSync(
  resultsPath,
  JSON.stringify({ project, timestamp: new Date().toISOString(), run1, run2, pass, fail }, null, 2),
);
console.log(`\n📄 results written: ${resultsPath}`);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
