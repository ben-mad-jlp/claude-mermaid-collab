/**
 * Live conductor-pin EVIDENCE harness — HTTP-only, asserts directly against the
 * `lastPass` observable (src/services/supervisor-store.ts:501-527,
 * `getConductorLastPass`/`ConductorLastPass = { missionId, reason, tickAt }`) exposed at
 * `GET /api/supervisor/conductor` (src/routes/supervisor-routes.ts:897-907, field
 * `lastPass`). Sibling to scripts/smoke-conductor-pin-live.ts, which infers activity
 * indirectly via mission-row fields — this script reads the pass outcome directly.
 *
 * Talks ONLY over HTTP to an already-running server at BASE_URL — no in-process
 * transport, no orchestrator start/stop, no scratch-repo creation. The target project
 * must already be a real git repo the operator has chosen; this script does not create
 * one (unlike smoke-conductor-pin-live.ts's throwaway scratch project).
 *
 * Writes a JSON evidence artifact to docs/evidence/live-conductor-pin-evidence-<ts>.json
 * and also prints the same JSON to stdout.
 *
 * Run:  bun run scripts/live-conductor-pin-evidence.ts [--project=<path>] [--base-url=<url>]
 *       MERMAID_LIVE_BASE_URL=http://host:9002 bun run scripts/live-conductor-pin-evidence.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL =
  process.env.MERMAID_LIVE_BASE_URL ??
  process.argv.find((a) => a.startsWith('--base-url='))?.slice('--base-url='.length) ??
  'http://127.0.0.1:9002';

const project =
  process.argv.find((a) => a.startsWith('--project='))?.slice('--project='.length) ??
  process.cwd();

// Documented at src/services/orchestrator-live.ts:51 (CONDUCTOR_INTERVAL_MS, module-private).
const CONDUCTOR_INTERVAL_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (s: string) => console.log(s);

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}
interface LastPassSample {
  missionId: string | null;
  reason: string;
  tickAt: number;
}
interface EvidenceBlob {
  startedAt: number;
  finishedAt: number;
  baseUrl: string;
  project: string;
  missionA: string;
  missionB: string;
  samples: LastPassSample[];
  assertions: Assertion[];
  verdict: 'PASS' | 'FAIL';
  notes: string[];
  assertionsSkipped: number;
}

const assertions: Assertion[] = [];
const notes: string[] = [];

function check(name: string, ok: boolean, detail = ''): boolean {
  assertions.push({ name, ok, detail: detail || undefined });
  log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'GET' });
  const status = res.status;
  const body = await res.json().catch(() => null);
  return { status, body };
}
async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const status = res.status;
  const respBody = await res.json().catch(() => null);
  return { status, body: respBody };
}
async function patch(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const status = res.status;
  const respBody = await res.json().catch(() => null);
  return { status, body: respBody };
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

const ACCEPTED_DROVE_REASONS = ['conducted', 'debounced', 'building-wait', 'target-not-actionable'];

async function main() {
  const startedAt = Date.now();
  log(`\n📡 Live conductor-pin evidence harness`);
  log(`   base url: ${BASE_URL}`);
  log(`   project:  ${project}`);
  log('');

  // --- (a) ensure watched + conductor enabled ---
  log(`Step (a) — ensure project watched + conductor enabled`);
  const reg = await post('/api/supervisor/projects', { project });
  check('project registered+watched', reg.status === 200 && (reg.body?.projects ?? []).includes(project), `status=${reg.status}`);
  const enable = await post('/api/supervisor/conductor', { project, enabled: true });
  check('conductor enabled', enable.status === 200 && enable.body?.enabled === true, `body=${JSON.stringify(enable.body)}`);

  // --- (b) ensure two actionable missions ---
  log(`\nStep (b) — ensure at least two actionable missions`);
  const notActionable = new Set(['unapproved', 'abandoned', 'converged']);
  const listInitial = await get(`/api/supervisor/missions?project=${encodeURIComponent(project)}`);
  const summariesInitial = (listInitial.body?.missions ?? []) as any[];
  let actionable = summariesInitial.filter((m) => !notActionable.has(m.mission?.status));

  async function createAndApproveMission(title: string): Promise<string> {
    const created = await post('/api/supervisor/missions', {
      project, session: 'live-conductor-pin-evidence', title,
      criteria: ['smoke: trivial criterion'],
    });
    const id = created.body?.node?.id as string;
    check(`mission created (${title})`, created.status === 200 && !!id, `status=${created.status}`);
    const approved = await post('/api/supervisor/missions/approve', { project, todoId: id });
    check(`mission approved (${title})`, approved.status === 200, `status=${approved.status}`);
    return id;
  }

  while (actionable.length < 2) {
    await createAndApproveMission(`Live conductor-pin evidence mission ${actionable.length + 1}`);
    const relisted = await get(`/api/supervisor/missions?project=${encodeURIComponent(project)}`);
    actionable = ((relisted.body?.missions ?? []) as any[]).filter((m) => !notActionable.has(m.mission?.status));
  }

  const missionA = actionable[0].node.id as string;
  const missionB = actionable[1].node.id as string;
  check('two distinct actionable missions present', missionA !== missionB && !!missionA && !!missionB, `missionA=${missionA} missionB=${missionB}`);

  const missionBBaselineList = await get(`/api/supervisor/missions?project=${encodeURIComponent(project)}`);
  const missionBBaseline = ((missionBBaselineList.body?.missions ?? []) as any[]).find((m) => m.node.id === missionB);
  const missionBBaselineKey = missionBBaseline?.mission?.lastConductorKey ?? null;

  // --- (c) pin missionA ---
  log(`\nStep (c) — pin conductor target to mission A`);
  const pin = await post('/api/supervisor/conductor', { project, targetMissionId: missionA });
  check('pin POST targets mission A', pin.status === 200 && pin.body?.targetMissionId === missionA, `body=${JSON.stringify(pin.body)}`);

  // --- (d) poll lastPass for >= 2 distinct tickAt samples ---
  log(`\nStep (d) — poll lastPass for >= 2 distinct ticks`);
  const pollDeadlineMs = 5 * CONDUCTOR_INTERVAL_MS;
  const pollStepMs = Math.max(3_000, Math.floor(CONDUCTOR_INTERVAL_MS / 6));
  const samples: LastPassSample[] = [];
  const seenTickAt = new Set<number>();

  await pollUntil(
    pollDeadlineMs,
    pollStepMs,
    async () => {
      const g = await get(`/api/supervisor/conductor?project=${encodeURIComponent(project)}`);
      const lastPass = g.body?.lastPass as LastPassSample | null;
      if (lastPass && !seenTickAt.has(lastPass.tickAt)) {
        seenTickAt.add(lastPass.tickAt);
        samples.push(lastPass);
      }
      return samples.length;
    },
    (n) => n >= 2,
  );

  check('collected >= 2 distinct lastPass ticks', samples.length >= 2, `samples=${JSON.stringify(samples)}`);

  // --- (e) assert both ticks name the pinned mission ---
  log(`\nStep (e) — assert every sample names mission A with an accepted reason`);
  const allNameMissionA = samples.every((s) => s.missionId === missionA);
  const allReasonsAccepted = samples.every((s) => ACCEPTED_DROVE_REASONS.includes(s.reason));
  const noneNameMissionB = samples.every((s) => s.missionId !== missionB);
  check('all samples name mission A', allNameMissionA, `samples=${JSON.stringify(samples)}`);
  check('all samples have an accepted reason', allReasonsAccepted, `accepted=${JSON.stringify(ACCEPTED_DROVE_REASONS)} samples=${JSON.stringify(samples)}`);
  check('no sample names mission B', noneNameMissionB, `missionB=${missionB} samples=${JSON.stringify(samples)}`);

  const missionBAfterList = await get(`/api/supervisor/missions?project=${encodeURIComponent(project)}`);
  const missionBAfter = ((missionBAfterList.body?.missions ?? []) as any[]).find((m) => m.node.id === missionB);
  const missionBAfterKey = missionBAfter?.mission?.lastConductorKey ?? null;
  check('mission B lastConductorKey unchanged across pinned ticks (positive ignore proof)', missionBAfterKey === missionBBaselineKey, `before=${missionBBaselineKey} after=${missionBAfterKey}`);

  // --- (f) explicit unpin + lazy self-clear ---
  log(`\nStep (f) — explicit unpin + lazy self-clear`);
  const unpin = await post('/api/supervisor/conductor', { project, targetMissionId: null });
  check('explicit unpin ok', unpin.status === 200 && unpin.body?.targetMissionId === null, `body=${JSON.stringify(unpin.body)}`);
  const unpinGet = await get(`/api/supervisor/conductor?project=${encodeURIComponent(project)}`);
  check('unpin reflected by GET', unpinGet.body?.targetMissionId === null, `body=${JSON.stringify(unpinGet.body)}`);

  // Lazy self-clear needs a terminal/converged mission. Drive a dedicated mission C
  // terminal via the PATCH /api/supervisor/missions transport instead of hoping one
  // already exists, so this sub-assertion always runs (no SKIP).
  const missionC = await createAndApproveMission('Live conductor-pin evidence mission (terminal)');
  const abandon = await patch('/api/supervisor/missions', { project, todoId: missionC, abandonedAt: Date.now() });
  check('mission C driven abandoned via PATCH', abandon.status === 200 && abandon.body?.mission?.abandonedAt != null, `body=${JSON.stringify(abandon.body)}`);

  const pinTerminal = await post('/api/supervisor/conductor', { project, targetMissionId: missionC });
  check('pin to terminal mission ok', pinTerminal.status === 200 && pinTerminal.body?.targetMissionId === missionC, `body=${JSON.stringify(pinTerminal.body)}`);

  const clearDeadlineMs = 5 * CONDUCTOR_INTERVAL_MS;
  const clearStepMs = Math.max(3_000, Math.floor(CONDUCTOR_INTERVAL_MS / 6));
  const { satisfiedAt } = await pollUntil(
    clearDeadlineMs,
    clearStepMs,
    () => get(`/api/supervisor/conductor?project=${encodeURIComponent(project)}`),
    (g) => g.body?.lastPass?.reason === 'target-cleared' && g.body?.targetMissionId === null,
  );
  check(
    'lazy self-clear observed (lastPass.reason === target-cleared, targetMissionId === null)',
    satisfiedAt !== null,
    `lastSeen=${JSON.stringify(satisfiedAt)}`,
  );

  const finishedAt = Date.now();
  const assertionsSkipped = notes.filter((n) => n.includes('SKIPPED')).length;
  const fail = assertions.filter((a) => !a.ok).length;
  const verdict: 'PASS' | 'FAIL' = fail === 0 && assertionsSkipped === 0 ? 'PASS' : 'FAIL';

  const blob: EvidenceBlob = {
    startedAt, finishedAt, baseUrl: BASE_URL, project,
    missionA, missionB, samples, assertions, verdict, notes, assertionsSkipped,
  };

  const evidenceDir = join(process.cwd(), 'docs', 'evidence');
  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = join(evidenceDir, `live-conductor-pin-evidence-${finishedAt}.json`);
  writeFileSync(evidencePath, JSON.stringify(blob, null, 2));

  log(`\n📄 evidence written: ${evidencePath}`);
  console.log(JSON.stringify(blob));
  log(`\n${verdict === 'PASS' ? '✅ ALL PASS' : '❌ FAILURES'} — ${assertions.length - fail} passed, ${fail} failed, ${assertionsSkipped} skipped\n`);
  process.exit(verdict === 'PASS' ? 0 : 1);
}

await main();
