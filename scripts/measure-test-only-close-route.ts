#!/usr/bin/env bun
/**
 * measure-test-only-close-route.ts — whole-surface measurement for the test-only-close route.
 *
 * Builds a fixture mission with TWO criteria (one test-only-evidenced, one src-evidenced),
 * drives runConductorPass five times, and asserts the terminal state: exactly one claimable
 * close-out leaf for the test-only criterion, exactly one open serve-cap card citing the
 * CURRENT verdict for the src-evidenced criterion, and zero duplicate cards/leaves.
 *
 * Also reuses scripts/test-backend.ts's baseline diff (via subprocess) to compare this branch's
 * failing-test-name set against scripts/backend-test-baseline.json.
 *
 * Usage: bun run scripts/measure-test-only-close-route.ts
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Module-level openDb caches the supervisor dir at import time — must be set BEFORE importing
// conductor-pass/supervisor-store (mirrors src/services/__tests__/conductor-pass.test.ts:8-9).
if (!process.env.MERMAID_SUPERVISOR_DIR) {
  process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'measure-test-only-close-sup-'));
}

import {
  runConductorPass,
  CRITERION_SERVE_CAP_KIND,
  serveCapMarker,
} from '../src/services/conductor-pass.ts';
import { addWatchedProject, setConductorEnabled, listOpenEscalations, type Escalation } from '../src/services/supervisor-store.ts';
import { listMissions, isMissionTerminal, listCriteriaWithActions, listCriteria, setCriterionVerdict, CRITERION_SERVE_CAP } from '../src/services/mission-store.ts';
import { forgeMission } from '../src/mcp/tools/mission-forge.ts';
import { createTodo, updateTodo, listTodos, type Todo } from '../src/services/todo-store.ts';
import { recordApproachAttempt } from '../src/services/criterion-approach-store.ts';
import { isClaimable } from '../src/services/claimability.ts';

export interface FixtureResult {
  project: string;
  missionId: string;
  critIId: string;
  critIIId: string;
  verifiedAtShaI: string;
  verifiedAtShaII: string;
  closeOutEpics: Todo[];
  closeOutLeaves: Todo[];
  claimableResult: boolean;
  openServeCapCards: Escalation[];
  duplicateCardCount: number;
  duplicateLeafGroups: number;
}

/** Faithful "successful conductor node" mock (mirrors conductor-pass.test.ts:31-43): serves any
 *  remaining 'discover' gap on the active mission so the pass never wedges on an unrelated no-op. */
async function okInvoke() {
  const project = (okInvoke as any)._project as string;
  const missions = listMissions(project);
  const m = missions.find((x) => x.mission.active && !isMissionTerminal(x.mission));
  if (m) {
    for (const c of listCriteriaWithActions(project, m.node.id).filter((x) => x.action === 'discover')) {
      await createTodo(project, { ownerSession: 's1', title: `[EPIC] served ${c.id}`, kind: 'epic', parentId: m.node.id, servesCriterionIds: [c.id] });
    }
  }
  return { ok: true, rateLimited: false, text: 'served the gap' } as any;
}

async function burnServeCap(project: string, missionId: string, criterionId: string, label: string) {
  for (let i = 0; i < CRITERION_SERVE_CAP; i++) {
    const e = await createTodo(project, { ownerSession: 's1', title: `[EPIC] serve ${label} ${i}`, kind: 'epic', parentId: missionId, servesCriterionIds: [criterionId] });
    await updateTodo(project, e.id, { status: 'dropped' });
  }
  recordApproachAttempt({
    criterionId,
    missionId,
    project,
    rung: 're-decompose',
    epicId: null,
    outcome: 'attempted',
    detail: null,
    attemptedAt: Date.now(),
  });
}

export async function runMeasurementFixture(): Promise<FixtureResult> {
  const project = mkdtempSync(join(tmpdir(), 'measure-test-only-close-'));
  (okInvoke as any)._project = project;

  addWatchedProject(project);
  setConductorEnabled(project, true);

  const forged = await forgeMission(project, {
    session: 's1',
    title: 'MEASURED-live: test-only-close route whole-surface run',
    criteria: ['criterion I: test-only-evidenced gap', 'criterion II: src-evidenced gap'],
  });
  const criteria = listCriteria(project, forged.missionId);
  const critI = criteria[0];
  const critII = criteria[1];

  await burnServeCap(project, forged.missionId, critI.id, 'I');
  await burnServeCap(project, forged.missionId, critII.id, 'II');

  const verifiedAtShaI = 'fixedsha1';
  const verifiedAtShaII = 'fixedsha2';

  setCriterionVerdict(project, critI.id, {
    met: false,
    evidence: 'measured at src/services/__tests__/conductor-pass.test.ts:1 — TO CLOSE the threshold needs updating',
    evidencePaths: ['src/services/__tests__/conductor-pass.test.ts'],
    verifiedAtSha: verifiedAtShaI,
    verifiedBy: 'measure',
  });
  setCriterionVerdict(project, critII.id, {
    met: false,
    evidence: 'the fix landed at src/services/conductor-pass.ts:1',
    evidencePaths: ['src/services/conductor-pass.ts'],
    verifiedAtSha: verifiedAtShaII,
    verifiedBy: 'measure',
  });

  for (let i = 0; i < 5; i++) {
    await runConductorPass(project, { invoke: okInvoke });
  }

  const todos = listTodos(project);
  const closeOutEpics = todos.filter(
    (t) => t.kind === 'epic' && t.title.startsWith('Close out:') && (t.servesCriterionIds ?? []).includes(critI.id),
  );
  const closeOutLeaves = closeOutEpics.length === 1 ? todos.filter((t) => t.parentId === closeOutEpics[0].id) : [];
  const byId = new Map(todos.map((t) => [t.id, t]));
  const claimableResult = closeOutLeaves.length === 1 ? isClaimable(closeOutLeaves[0], byId) : false;

  const openEscalations = listOpenEscalations();
  const openServeCapCards = openEscalations.filter((e) => e.kind === CRITERION_SERVE_CAP_KIND && e.todoId === forged.missionId);

  // Zero-duplicate-cards check: the only conditionKey family this fixture can produce is the
  // serve-cap card family, so a plain kind+todoId count over the fixture's own mission IS the
  // dedup check.
  const duplicateCardCount = Math.max(0, openServeCapCards.length - 1);

  const leafGroups = new Map<string, number>();
  for (const t of todos) {
    const key = `${t.parentId ?? ''}::${t.title}`;
    leafGroups.set(key, (leafGroups.get(key) ?? 0) + 1);
  }
  const duplicateLeafGroups = [...leafGroups.values()].filter((n) => n > 1).length;

  return {
    project,
    missionId: forged.missionId,
    critIId: critI.id,
    critIIId: critII.id,
    verifiedAtShaI,
    verifiedAtShaII,
    closeOutEpics,
    closeOutLeaves,
    claimableResult,
    openServeCapCards,
    duplicateCardCount,
    duplicateLeafGroups,
  };
}

function fail(message: string, actual: unknown): never {
  console.error(`\nFAILED: ${message}`);
  console.error('actual:', JSON.stringify(actual, null, 2));
  process.exit(1);
}

async function runBaselineDiff(): Promise<void> {
  const proc = Bun.spawn(
    ['bun', 'run', 'scripts/test-backend.ts', '--baseline=scripts/backend-test-baseline.json'],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    console.error('\nbaseline diff FAILED (branch has net-new failing test names vs. scripts/backend-test-baseline.json):\n');
    console.error(stdout);
    console.error(stderr);
    process.exit(1);
  }
  console.log('\nbaseline diff: PASS — no net-new failing test files/names vs. scripts/backend-test-baseline.json\n');
}

async function main() {
  const result = await runMeasurementFixture();

  if (result.closeOutEpics.length !== 1) {
    fail('expected exactly one close-out epic for criterion I', result.closeOutEpics);
  }
  if (result.closeOutLeaves.length !== 1) {
    fail('expected exactly one close-out leaf under the close-out epic', result.closeOutLeaves);
  }
  if (result.claimableResult !== true) {
    fail('expected the close-out leaf to be claimable', result.claimableResult);
  }
  if (result.openServeCapCards.length !== 1) {
    fail('expected exactly one open serve-cap card for the mission', result.openServeCapCards);
  }
  const card = result.openServeCapCards[0]!;
  const marker = serveCapMarker(result.critIIId);
  if (!card.questionText.includes(marker) || !card.questionText.includes(result.verifiedAtShaII)) {
    fail('expected the serve-cap card to cite the current verdict (marker + verifiedAtSha)', card);
  }
  if (result.duplicateCardCount !== 0) {
    fail('expected zero duplicate serve-cap cards', result.duplicateCardCount);
  }
  if (result.duplicateLeafGroups !== 0) {
    fail('expected zero duplicate (parentId,title) leaf groups', result.duplicateLeafGroups);
  }

  console.log(
    `OK: 1 claimable close-out leaf (epic=${result.closeOutEpics[0]!.id}, leaf=${result.closeOutLeaves[0]!.id}); ` +
      `1 current-verdict serve-cap card (escalation=${card.id}); 0 duplicates.`,
  );

  await runBaselineDiff();
}

if (import.meta.main) {
  main();
}
