/**
 * Live-evidence harness for two consecutive landed-epic-sweep passes — runs the
 * composite reconcile+landed-epic-sweep pass twice, in-process, directly against the
 * live/self project DB (mirroring scripts/blueprint-lab/emit.ts's self-project
 * resolution), and asserts convergence + idempotency from BEFORE/AFTER snapshots.
 *
 * Talks to the live DB directly (no HTTP transport, no scratch project) — this
 * harness's whole point is to prove the sweep against the REAL live/self project.
 *
 * Run:  bun run scripts/landed-epic-sweep-live-evidence.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { listMissions } from '../src/services/mission-store';
import { listTodos } from '../src/services/todo-store';
import { findLandedAtDivergence } from '../src/services/invariant-check';
import { buildEpicBranchStatus, makeGitProbe } from '../src/services/epic-branch-status';
import { runReconcilePass } from '../src/services/reconcile-pass';
import { runLandedEpicSweep, type RunLandedEpicSweepResult } from '../src/services/landed-epic-sweep';

const OUT = join(import.meta.dir, 'blueprint-lab', 'results');
mkdirSync(OUT, { recursive: true });

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const PROJECT = REPO_ROOT;

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

interface MissionSnapshot {
  sessionKey: string;
  missionId: string;
  active: boolean;
  status: string | null;
  awaitingApprovalSince: number | null;
  queuePos: number | null;
}

interface Snapshot {
  takenAt: number;
  missions: MissionSnapshot[];
  divergenceViolations: { todoId: string; title: string; reason: string }[];
  fullyOnMasterBranches: { epicId: string; branch: string }[];
}

interface EvidenceBlob {
  startedAt: number;
  finishedAt: number;
  project: string;
  before1: Snapshot;
  sweep1: RunLandedEpicSweepResult;
  after1: Snapshot;
  before2: Snapshot;
  sweep2: RunLandedEpicSweepResult;
  after2: Snapshot;
  assertions: Assertion[];
  verdict: 'PASS' | 'FAIL';
}

const assertions: Assertion[] = [];

function check(name: string, ok: boolean, detail = ''): boolean {
  assertions.push({ name, ok, detail: detail || undefined });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

function buildSnapshot(project: string): Snapshot {
  const todos = listTodos(project, { includeCompleted: true });
  const probe = makeGitProbe(project);
  const report = buildEpicBranchStatus(todos, probe, 'master', project);
  const aheadById = new Map(report.epics.map((e) => [e.epicId, e.ahead]));
  const aheadOf = (epicId: string) => aheadById.get(epicId);
  const divergence = findLandedAtDivergence(todos, aheadOf);
  const fullyOnMaster = report.epics
    .filter((e) => e.exists === true && (e.ahead ?? -1) === 0)
    .map((e) => ({ epicId: e.epicId, branch: e.branch }));
  const missions = listMissions(project).map((m) => ({
    sessionKey: m.ownerSession ?? m.assigneeSession ?? '(none)',
    missionId: m.node.id,
    active: m.mission.active,
    status: m.rollup.status ?? m.mission.status ?? null,
    awaitingApprovalSince: m.mission.awaitingApprovalSince,
    queuePos: m.mission.queuePos,
  }));
  return {
    takenAt: Date.now(),
    missions,
    divergenceViolations: divergence.map((v) => ({ todoId: v.todoId, title: v.title, reason: v.reason })),
    fullyOnMasterBranches: fullyOnMaster,
  };
}

function sortedJson<T>(items: T[], keyFn: (item: T) => string): string {
  return JSON.stringify([...items].sort((a, b) => keyFn(a).localeCompare(keyFn(b))));
}

function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
  return (
    sortedJson(a.missions, (m) => m.missionId) === sortedJson(b.missions, (m) => m.missionId) &&
    sortedJson(a.divergenceViolations, (v) => v.todoId) === sortedJson(b.divergenceViolations, (v) => v.todoId) &&
    sortedJson(a.fullyOnMasterBranches, (e) => e.epicId) === sortedJson(b.fullyOnMasterBranches, (e) => e.epicId)
  );
}

function renderMarkdown(evidence: EvidenceBlob): string {
  const lines: string[] = [];
  lines.push(`# Landed-epic-sweep live evidence — ${new Date(evidence.finishedAt).toISOString()}`);
  lines.push('');
  lines.push(`Project: \`${evidence.project}\``);
  lines.push(`Verdict: **${evidence.verdict}**`);
  lines.push('');
  lines.push('| Assertion | Result | Detail |');
  lines.push('|---|---|---|');
  for (const a of evidence.assertions) {
    lines.push(`| ${a.name} | ${a.ok ? 'PASS' : 'FAIL'} | ${(a.detail ?? '').replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  lines.push('## Raw counts');
  lines.push('');
  for (const [label, snap] of [
    ['before1', evidence.before1],
    ['after1', evidence.after1],
    ['before2', evidence.before2],
    ['after2', evidence.after2],
  ] as const) {
    lines.push(`### ${label}`);
    lines.push('');
    lines.push('Mission sessions:');
    for (const m of snap.missions) {
      lines.push(
        `- session=${m.sessionKey} mission=${m.missionId} active=${m.active} status=${m.status} awaitingApprovalSince=${m.awaitingApprovalSince} queuePos=${m.queuePos}`,
      );
    }
    lines.push(`Divergence violations: ${snap.divergenceViolations.map((v) => v.todoId).join(', ') || '(none)'}`);
    lines.push(
      `Fully-on-master branches: ${snap.fullyOnMasterBranches.map((e) => e.branch).join(', ') || '(none)'}`,
    );
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const startedAt = Date.now();
  console.log(`\n📡 Landed-epic-sweep live evidence harness`);
  console.log(`   project: ${PROJECT}`);
  console.log('');

  console.log('Run 1');
  const before1 = buildSnapshot(PROJECT);
  await runReconcilePass(PROJECT);
  const sweep1 = await runLandedEpicSweep(PROJECT, { force: true });
  const after1 = buildSnapshot(PROJECT);

  console.log('\nRun 2');
  const before2 = buildSnapshot(PROJECT);
  await runReconcilePass(PROJECT);
  const sweep2 = await runLandedEpicSweep(PROJECT, { force: true });
  const after2 = buildSnapshot(PROJECT);

  console.log('\nAssertions');

  // 1. run 1 auto-activates a converged-active + approved-queued session.
  const sessionsBefore1 = new Map<string, MissionSnapshot[]>();
  for (const m of before1.missions) {
    const arr = sessionsBefore1.get(m.sessionKey) ?? [];
    arr.push(m);
    sessionsBefore1.set(m.sessionKey, arr);
  }
  const checkedSessions: string[] = [];
  const passedSessions: string[] = [];
  let autoActivateOk = true;
  for (const [sessionKey, missions] of sessionsBefore1) {
    const hasActive = missions.some((m) => m.active === true);
    const approvedQueued = missions.filter((m) => m.awaitingApprovalSince == null && m.queuePos != null);
    if (!hasActive && approvedQueued.length > 0) {
      checkedSessions.push(sessionKey);
      const nowActive = after1.missions.some((m) => m.sessionKey === sessionKey && m.active);
      if (nowActive) {
        passedSessions.push(sessionKey);
      } else {
        autoActivateOk = false;
      }
    }
  }
  check(
    'run 1 auto-activates a converged-active + approved-queued session',
    autoActivateOk,
    `checked=${JSON.stringify(checkedSessions)} passed=${JSON.stringify(passedSessions)} missionIds=${JSON.stringify(
      approvedQueuedMissionIds(sessionsBefore1),
    )}`,
  );

  // 2. zero landed-at-divergence violations after run 1.
  check(
    'zero landed-at-divergence violations after run 1',
    after1.divergenceViolations.length === 0,
    after1.divergenceViolations.length === 0
      ? ''
      : `violated=${JSON.stringify(after1.divergenceViolations.map((v) => v.todoId))}`,
  );

  // 3. zero fully-on-master collab/epic/* branches remain after run 1.
  check(
    'zero fully-on-master collab/epic/* branches remain after run 1',
    after1.fullyOnMasterBranches.length === 0,
    after1.fullyOnMasterBranches.length === 0
      ? ''
      : `branches=${JSON.stringify(after1.fullyOnMasterBranches.map((e) => e.branch))}`,
  );

  // 4. run 2 is a no-op.
  const sweep2NoOp =
    sweep2.reconcile.reconciled.length === 0 && sweep2.gc.deleted.length === 0 && sweep2.promoted.length === 0;
  const snapshotsMatch = snapshotsEqual(before2, after2);
  check(
    'run 2 is a no-op',
    sweep2NoOp && snapshotsMatch,
    `sweep2NoOp=${sweep2NoOp} snapshotsMatch=${snapshotsMatch} reconciled=${JSON.stringify(
      sweep2.reconcile.reconciled,
    )} deleted=${JSON.stringify(sweep2.gc.deleted)} promoted=${JSON.stringify(sweep2.promoted)}`,
  );

  const finishedAt = Date.now();
  const fail = assertions.filter((a) => !a.ok).length;
  const verdict: 'PASS' | 'FAIL' = fail === 0 ? 'PASS' : 'FAIL';

  const evidence: EvidenceBlob = {
    startedAt,
    finishedAt,
    project: PROJECT,
    before1,
    sweep1,
    after1,
    before2,
    sweep2,
    after2,
    assertions,
    verdict,
  };

  const jsonPath = join(OUT, `landed-epic-sweep-live-evidence-${finishedAt}.json`);
  const mdPath = join(OUT, `landed-epic-sweep-live-evidence-${finishedAt}.md`);
  writeFileSync(jsonPath, JSON.stringify(evidence, null, 2));
  writeFileSync(mdPath, renderMarkdown(evidence));

  console.log(`\n📄 evidence written: ${jsonPath}`);
  console.log(`📄 evidence written: ${mdPath}`);
  console.log(JSON.stringify(evidence, null, 2));
  console.log(`\n${verdict === 'PASS' ? '✅ ALL PASS' : '❌ FAILURES'} — ${assertions.length - fail} passed, ${fail} failed\n`);

  process.exitCode = assertions.every((a) => a.ok) ? 0 : 1;
}

function approvedQueuedMissionIds(sessionsBefore1: Map<string, MissionSnapshot[]>): string[] {
  const ids: string[] = [];
  for (const missions of sessionsBefore1.values()) {
    for (const m of missions) {
      if (m.awaitingApprovalSince == null && m.queuePos != null) ids.push(m.missionId);
    }
  }
  return ids;
}

await main();
