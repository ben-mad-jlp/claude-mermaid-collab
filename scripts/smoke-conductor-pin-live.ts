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
 *        (conductor-pass.ts:130, reason 'target-cleared')
 *     →  re-pin to B, then an EXPLICIT unpin (POST targetMissionId: null) —
 *        a direct store write, no tick required.
 *
 * Route calls go through handleSupervisorRoutes in-process (the exact handler the
 * HTTP server dispatches to), same pattern as smoke-escalation-decision-live.ts —
 * no separate HTTP listener needed since this is the backend loop, not a browser click.
 *
 * Transport: defaults to in-process. Set MERMAID_SMOKE_BASE_URL or pass
 * --base-url <url> to run against a real deployed server over HTTP instead — in
 * that mode the orchestrator timer and setCriterionMet are the DEPLOYED server's,
 * not this script's, so Phase 3's orchestrator start/stop and Phase 4's criterion-set
 * are skipped/gated accordingly (see markCriterionMet below).
 *
 * Controlled: throwaway scratch git repo + isolated supervisor.db (in-process mode
 * only); guarded to never touch the collab self-project; never calls a deploy route.
 *
 * Run:  bun run scripts/smoke-conductor-pin-live.ts
 *       bun run scripts/smoke-conductor-pin-live.ts --base-url http://localhost:9002
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

function resolveBaseUrl(): string | null {
  const flagIdx = process.argv.indexOf('--base-url');
  if (flagIdx >= 0 && process.argv[flagIdx + 1]) return process.argv[flagIdx + 1];
  const inline = process.argv.find((a) => a.startsWith('--base-url='));
  if (inline) return inline.slice('--base-url='.length);
  return process.env.MERMAID_SMOKE_BASE_URL || null;
}
const baseUrl = resolveBaseUrl();
const liveMode = baseUrl !== null;

import { isSelfProject } from '../src/services/deploy-service';

// Documented at src/services/orchestrator-live.ts:51 (CONDUCTOR_INTERVAL_MS, module-private).
const CONDUCTOR_INTERVAL_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (s: string) => console.log(s);
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  (ok ? pass++ : fail++);
  log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function pollUntil<T>(
  deadlineMs: number,
  stepMs: number,
  probe: () => Promise<T>,
  satisfied: (v: T) => boolean,
): Promise<{ satisfiedAt: T | null; samples: T[] }> {
  const start = Date.now();
  const samples: T[] = [];
  while (Date.now() - start < deadlineMs) {
    const v = await probe();
    samples.push(v);
    if (satisfied(v)) return { satisfiedAt: v, samples };
    await sleep(stepMs);
  }
  return { satisfiedAt: null, samples };
}

let handleSupervisorRoutes: typeof import('../src/routes/supervisor-routes').handleSupervisorRoutes | undefined;
let startOrchestrator: typeof import('../src/services/orchestrator-live').startOrchestrator | undefined;
let stopOrchestrator: typeof import('../src/services/orchestrator-live').stopOrchestrator | undefined;
let setCriterionMet: typeof import('../src/services/mission-store').setCriterionMet | undefined;
let supDir: string | null = null;

async function route(req: Request): Promise<{ status: number; body: any }> {
  if (liveMode) {
    const u = new URL(req.url);
    const target = new URL(u.pathname + u.search, baseUrl!);
    const init: RequestInit = { method: req.method };
    if (req.method !== 'GET' && req.method !== 'HEAD') init.body = await req.clone().text();
    const res = await fetch(target, init);
    const status = res.status;
    const body = await res.json().catch(() => null);
    return { status, body };
  }
  const res = await handleSupervisorRoutes!(req, new URL(req.url));
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

async function missionRow(project: string, missionId: string) {
  const listed = await get(`/api/supervisor/missions?project=${encodeURIComponent(project)}`);
  const found = (listed.body?.missions ?? []).find((m: any) => m.node.id === missionId);
  if (!found) throw new Error(`missionRow: ${missionId} not present in GET /api/supervisor/missions response`);
  return found.mission as { status?: string; lastConductorKey: string | null; lastNudgeAt: number | null; updatedAt: number };
}

async function sample(tick: number, project: string, missionId: string, conductorTarget?: string | null): Promise<Sample> {
  const m = await missionRow(project, missionId);
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

async function markCriterionMet(project: string, criterionId: string, met: boolean): Promise<boolean> {
  if (liveMode) {
    check(
      'criterion verdict settable over live transport',
      false,
      'no REST surface exists for setCriterionMet — deliberately not exposed ' +
        '(src/routes/supervisor-routes.ts:249-252, steward/MCP-only for maker≠checker independence); ' +
        'skipping the convergence + lazy-clear phase in live mode',
    );
    return false;
  }
  setCriterionMet!(project, criterionId, met);
  return true;
}

async function main() {
  if (!liveMode) {
    supDir = mkdtempSync(join(tmpdir(), 'cp-smoke-sup-'));
    process.env.MERMAID_SUPERVISOR_DIR = supDir;
    ({ handleSupervisorRoutes } = await import('../src/routes/supervisor-routes'));
    ({ startOrchestrator, stopOrchestrator } = await import('../src/services/orchestrator-live'));
    ({ setCriterionMet } = await import('../src/services/mission-store'));
  }

  const scratchProject = mkdtempSync(join(tmpdir(), 'cp-smoke-'));
  log(`\n🔬 Two-mission conductor-pin live smoke test`);
  log(`   project: ${scratchProject}`);
  log(`   transport: ${liveMode ? `HTTP → ${baseUrl}` : 'in-process'}`);
  if (!liveMode) log(`   supervisor.db: ${supDir}`);
  log('');

  let started = false;
  try {
    // --- Phase 0: scratch project setup + self-project guard ---
    log(`Phase 0 — scratch git repo + self-project guard`);
    execSync('git init -q', { cwd: scratchProject });
    if (isSelfProject(scratchProject)) {
      throw new Error(`refusing to run: scratch project ${scratchProject} resolves to the collab self-project`);
    }
    check('scratch project is NOT the collab self-project', true, `project=${scratchProject}`);

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

    // --- Phase 3: start the REAL orchestrator, poll across >= 2 distinct ticks ---
    log(`\nPhase 3 — start real orchestrator; poll for >= 2 distinct ${CONDUCTOR_INTERVAL_MS}ms ticks`);
    const before = await sample(0, scratchProject, missionA, pinGet.body.targetMissionId);
    const beforeB = await sample(0, scratchProject, missionB, pinGet.body.targetMissionId);

    if (!liveMode) {
      startOrchestrator!();
      started = true;
    }

    const pollDeadlineMs = 3 * CONDUCTOR_INTERVAL_MS + 15_000;
    const pollStepMs = Math.max(2_000, Math.floor(CONDUCTOR_INTERVAL_MS / 6));
    let tick = 0;
    const distinctAdvanceTicks = new Set<number>();
    let allBChecksPassed = true;

    const { satisfiedAt } = await pollUntil(
      pollDeadlineMs,
      pollStepMs,
      async () => {
        tick++;
        const a = await sample(tick, scratchProject, missionA);
        const b = await sample(tick, scratchProject, missionB);

        const bUnchanged =
          b.lastConductorKey === beforeB.lastConductorKey &&
          b.lastNudgeAt === beforeB.lastNudgeAt &&
          b.updatedAt === beforeB.updatedAt;
        if (!bUnchanged) allBChecksPassed = false;
        check(
          `mission B (unpinned) unchanged at tick ${tick} vs pre-pin baseline`,
          bUnchanged,
          `before=${JSON.stringify(beforeB)} tick${tick}=${JSON.stringify(b)}`,
        );

        const aAdvanced = a.lastConductorKey !== before.lastConductorKey || a.updatedAt !== before.updatedAt;
        if (aAdvanced) distinctAdvanceTicks.add(tick);

        return { tick, a, distinctAdvanceTicks: distinctAdvanceTicks.size };
      },
      (v) => v.distinctAdvanceTicks >= 2,
    );
    void satisfiedAt;

    check(
      'mission A (pinned) advanced across >= 2 distinct conductor ticks',
      distinctAdvanceTicks.size >= 2,
      `ticks=${JSON.stringify([...distinctAdvanceTicks])} transcript=${JSON.stringify(transcript)}`,
    );
    check(
      'mission B (unpinned) byte-identical to pre-pin baseline across every observed tick',
      allBChecksPassed,
      `before=${JSON.stringify(beforeB)}`,
    );

    // --- Phase 4: lazy clear — converge A, wait for target-cleared ---
    log(`\nPhase 4 — mark A's criterion met → converged → next tick lazily clears the pin`);
    const criterionSet = await markCriterionMet(scratchProject, criterionA, true);
    if (criterionSet) {
      const converged = await missionRow(scratchProject, missionA);
      check('mission A now reads converged', converged.status === 'converged', `status=${converged.status}`);

      const clearDeadlineMs = 3 * CONDUCTOR_INTERVAL_MS + 15_000;
      const clearStepMs = Math.max(2_000, Math.floor(CONDUCTOR_INTERVAL_MS / 6));
      const { satisfiedAt: clearedState } = await pollUntil(
        clearDeadlineMs,
        clearStepMs,
        () => get(`/api/supervisor/conductor?project=${encodeURIComponent(scratchProject)}`),
        (g) => g.body?.targetMissionId === null,
      );
      check(
        'conductor target lazily cleared (target-cleared, conductor-pass.ts:130)',
        clearedState !== null,
        `lastSeen=${JSON.stringify(clearedState)}`,
      );
    } else {
      log('  ⏭️  skipped: live mode has no transport for setCriterionMet');
    }

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
    if (started) { stopOrchestrator!(); log(`  🧹 stopped orchestrator`); }
    await del('/api/supervisor/projects', { project: scratchProject }).catch(() => {});
    if (existsSync(scratchProject)) { rmSync(scratchProject, { recursive: true, force: true }); log(`  🧹 removed scratch project`); }
    if (supDir && existsSync(supDir)) { rmSync(supDir, { recursive: true, force: true }); log(`  🧹 removed isolated supervisor.db`); }
  }

  log(`\n📄 transcript: ${JSON.stringify(transcript)}`);
  log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

await main();
