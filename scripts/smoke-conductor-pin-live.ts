/**
 * Live end-to-end smoke test — the autonomous conductor's per-project TARGET PIN
 * (docs/autonomous-conductor.md B0 decoupled conductor timer).
 *
 * Exercises the REAL production wiring a unit test skips:
 *   two missions (A, B) in one project  →  pin the conductor to A
 *     →  the REAL orchestrator's independent conductor timer ticks (startOrchestrator,
 *        CONDUCTOR_INTERVAL_MS = 30_000 per src/services/orchestrator-live.ts:51)
 *     →  only A's mission row moves (lastConductorKey/updatedAt); B's never does
 *     →  A converges (its sole criterion is marked met)  →  the NEXT tick's
 *        runConductorPass finds the pin terminal and lazily clears it
 *        (conductor-pass.ts:119, reason 'target-cleared')
 *     →  re-pin to B, then an EXPLICIT unpin (POST targetMissionId: null) —
 *        a direct store write, no tick required.
 *
 * Route calls go through handleSupervisorRoutes in-process (the exact handler the
 * HTTP server dispatches to), same pattern as smoke-escalation-decision-live.ts —
 * no separate HTTP listener needed since this is the backend loop, not a browser click.
 *
 * Controlled: throwaway scratch git repo + isolated supervisor.db; guarded to never
 * touch the collab self-project; never calls a deploy route.
 *
 * Run:  bun run scripts/smoke-conductor-pin-live.ts
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

// Isolate the global supervisor.db BEFORE the store module opens it.
const supDir = mkdtempSync(join(tmpdir(), 'cp-smoke-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = supDir;

import { handleSupervisorRoutes } from '../src/routes/supervisor-routes';
import { isSelfProject } from '../src/services/deploy-service';
import { getMission, setCriterionMet } from '../src/services/mission-store';
import { startOrchestrator, stopOrchestrator } from '../src/services/orchestrator-live';

// Documented at src/services/orchestrator-live.ts:51 (CONDUCTOR_INTERVAL_MS, module-private).
const CONDUCTOR_INTERVAL_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (s: string) => console.log(s);
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  (ok ? pass++ : fail++);
  log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function route(req: Request): Promise<{ status: number; body: any }> {
  const res = await handleSupervisorRoutes(req, new URL(req.url));
  const status = res?.status ?? 0;
  const body = res ? await res.json().catch(() => null) : null;
  return { status, body };
}
function post(path: string, body: unknown) {
  return route(new Request(`http://local${path}`, { method: 'POST', body: JSON.stringify(body) }));
}
function del(path: string, body: unknown) {
  return route(new Request(`http://local${path}`, { method: 'DELETE', body: JSON.stringify(body) }));
}
function get(path: string) {
  return route(new Request(`http://local${path}`, { method: 'GET' }));
}

interface Sample {
  tick: number;
  missionId: string;
  lastConductorKey: string | null;
  lastNudgeAt: number | null;
  updatedAt: number;
  conductorTarget?: string | null;
}
const transcript: Sample[] = [];
function sample(tick: number, project: string, missionId: string, conductorTarget?: string | null): Sample {
  const m = getMission(project, missionId)!;
  const s: Sample = {
    tick, missionId,
    lastConductorKey: m.lastConductorKey,
    lastNudgeAt: m.lastNudgeAt,
    updatedAt: m.updatedAt,
    conductorTarget,
  };
  transcript.push(s);
  return s;
}

const scratchProject = mkdtempSync(join(tmpdir(), 'cp-smoke-'));
log(`\n🔬 Two-mission conductor-pin live smoke test`);
log(`   project: ${scratchProject}`);
log(`   supervisor.db: ${supDir}\n`);

let started = false;
try {
  // --- Phase 0: scratch project setup + self-project guard ---
  log(`Phase 0 — scratch git repo + self-project guard`);
  execSync('git init -q', { cwd: scratchProject });
  check('scratch project is NOT the collab self-project', !isSelfProject(scratchProject), `project=${scratchProject}`);

  const reg = await post('/api/supervisor/projects', { project: scratchProject });
  check('project registered+watched', reg.status === 200 && reg.body.projects.includes(scratchProject), `status=${reg.status}`);

  // --- Phase 1: create + approve two missions ---
  log(`\nPhase 1 — create + approve missions A and B`);
  const createA = await post('/api/supervisor/missions', {
    project: scratchProject, session: 'smoke-pin-a', title: 'Mission A — pinned target',
    criteria: ['smoke: trivial criterion'],
  });
  check('mission A created', createA.status === 200 && !!createA.body?.node?.id, `status=${createA.status}`);
  const missionA = createA.body.node.id as string;
  const criterionA = createA.body.criteria?.[0]?.id as string;
  check('mission A has one criterion', !!criterionA, `criteria=${JSON.stringify(createA.body.criteria)}`);

  const createB = await post('/api/supervisor/missions', {
    project: scratchProject, session: 'smoke-pin-b', title: 'Mission B — unpinned control',
  });
  check('mission B created', createB.status === 200 && !!createB.body?.node?.id, `status=${createB.status}`);
  const missionB = createB.body.node.id as string;

  const approveA = await post('/api/supervisor/missions/approve', { project: scratchProject, todoId: missionA });
  check('mission A approve call ok', approveA.status === 200, `status=${approveA.status}`);
  const approveB = await post('/api/supervisor/missions/approve', { project: scratchProject, todoId: missionB });
  check('mission B approve call ok', approveB.status === 200, `status=${approveB.status}`);

  const missionsList = await get(`/api/supervisor/missions?project=${encodeURIComponent(scratchProject)}`);
  const summaries = missionsList.body?.missions ?? [];
  const notActionable = new Set(['unapproved', 'abandoned', 'converged']);
  const aActionable = summaries.find((m: any) => m.node.id === missionA);
  const bActionable = summaries.find((m: any) => m.node.id === missionB);
  check('mission A is actionable', !!aActionable && !notActionable.has(aActionable.mission.status), `status=${aActionable?.mission.status}`);
  check('mission B is actionable', !!bActionable && !notActionable.has(bActionable.mission.status), `status=${bActionable?.mission.status}`);

  // --- Phase 2: enable conductor + pin A ---
  log(`\nPhase 2 — enable conductor + pin mission A`);
  const pin = await post('/api/supervisor/conductor', { project: scratchProject, enabled: true, targetMissionId: missionA });
  check('pin POST ok', pin.status === 200 && pin.body.targetMissionId === missionA, `body=${JSON.stringify(pin.body)}`);
  const pinGet = await get(`/api/supervisor/conductor?project=${encodeURIComponent(scratchProject)}`);
  check('pin echoed by GET', pinGet.body.enabled === true && pinGet.body.targetMissionId === missionA, `body=${JSON.stringify(pinGet.body)}`);

  // --- Phase 3: start the REAL orchestrator, sample across ticks ---
  log(`\nPhase 3 — start real orchestrator; sample across ${CONDUCTOR_INTERVAL_MS}ms ticks (~up to 90s)`);
  const before = sample(0, scratchProject, missionA, pinGet.body.targetMissionId);
  sample(0, scratchProject, missionB, pinGet.body.targetMissionId);

  startOrchestrator();
  started = true;

  await sleep(CONDUCTOR_INTERVAL_MS + 5_000);
  const mid = sample(1, scratchProject, missionA);
  sample(1, scratchProject, missionB);

  await sleep(CONDUCTOR_INTERVAL_MS + 5_000);
  const after = sample(2, scratchProject, missionA);
  const bAfter = sample(2, scratchProject, missionB);

  const aMoved = after.lastConductorKey !== before.lastConductorKey || after.updatedAt !== before.updatedAt || mid.updatedAt !== before.updatedAt;
  const bMoved = bAfter.lastConductorKey !== transcript[1].lastConductorKey || bAfter.updatedAt !== transcript[1].updatedAt;
  check('mission A (pinned) moved across the tick window', aMoved, `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  check('mission B (unpinned) did NOT move across the same window', !bMoved, `before=${JSON.stringify(transcript[1])} after=${JSON.stringify(bAfter)}`);

  // --- Phase 4: lazy clear — converge A, wait for target-cleared ---
  log(`\nPhase 4 — mark A's criterion met → converged → next tick lazily clears the pin`);
  setCriterionMet(scratchProject, criterionA, true);
  const converged = getMission(scratchProject, missionA);
  check('mission A now reads converged', converged?.status === 'converged', `status=${converged?.status}`);

  let cleared = false;
  for (let i = 0; i < 3 && !cleared; i++) {
    await sleep(CONDUCTOR_INTERVAL_MS + 5_000);
    const g = await get(`/api/supervisor/conductor?project=${encodeURIComponent(scratchProject)}`);
    if (g.body.targetMissionId === null) cleared = true;
  }
  check('conductor target lazily cleared (target-cleared, conductor-pass.ts:119)', cleared);

  // --- Phase 5: explicit unpin path (direct store write, no tick needed) ---
  log(`\nPhase 5 — re-pin to B, then explicit unpin`);
  const repin = await post('/api/supervisor/conductor', { project: scratchProject, targetMissionId: missionB });
  check('re-pin to B ok', repin.status === 200 && repin.body.targetMissionId === missionB, `body=${JSON.stringify(repin.body)}`);
  const unpin = await post('/api/supervisor/conductor', { project: scratchProject, targetMissionId: null });
  check('explicit unpin ok', unpin.status === 200 && unpin.body.targetMissionId === null, `body=${JSON.stringify(unpin.body)}`);
  const unpinGet = await get(`/api/supervisor/conductor?project=${encodeURIComponent(scratchProject)}`);
  check('unpin reflected immediately (no tick needed)', unpinGet.body.targetMissionId === null, `body=${JSON.stringify(unpinGet.body)}`);
} finally {
  log(`\nCleanup`);
  if (started) { stopOrchestrator(); log(`  🧹 stopped orchestrator`); }
  await del('/api/supervisor/projects', { project: scratchProject }).catch(() => {});
  if (existsSync(scratchProject)) { rmSync(scratchProject, { recursive: true, force: true }); log(`  🧹 removed scratch project`); }
  if (existsSync(supDir)) { rmSync(supDir, { recursive: true, force: true }); log(`  🧹 removed isolated supervisor.db`); }
}

log(`\n📄 transcript: ${JSON.stringify(transcript)}`);
log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
