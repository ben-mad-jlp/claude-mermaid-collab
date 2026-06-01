/**
 * Live end-to-end smoke test — PCS Phase 2c coordinator.
 *
 * Exercises the REAL wiring that unit tests skip:
 *   ready todo  →  startCoordinator tick  →  claimTodo  →  launchWorker (real tmux `claude`)
 *               →  sessionName bound  →  handleWorkerComplete  →  dependent promoted.
 *
 * Controlled: throwaway temp project, exactly ONE worker, short tick interval,
 * coordinator stopped immediately, tmux session + temp dir cleaned up at the end.
 *
 * Run:  bun run scripts/smoke-coordinator-live.ts
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, getTodo, listReadyTodos } from '../src/services/todo-store';
import { makeCoordinatorDeps, startCoordinator, stopCoordinator, isCoordinatorRunning } from '../src/services/coordinator-live';
import { handleWorkerComplete } from '../src/services/coordinator-daemon';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (s: string) => console.log(s);
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  (ok ? pass++ : fail++);
  log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function tmuxExists(name: string): boolean {
  return Bun.spawnSync(['tmux', 'has-session', '-t', name], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
}
function tmuxKill(name: string) {
  Bun.spawnSync(['tmux', 'kill-session', '-t', name], { stdout: 'ignore', stderr: 'ignore' });
}

const project = mkdtempSync(join(tmpdir(), 'pcs-smoke-'));
log(`\n🔬 PCS Phase 2c live smoke test`);
log(`   project: ${project}\n`);

let workerTmux: string | null = null;
try {
  // --- Seed: one ready todo + one blocked dependent ---
  const root = await createTodo(project, { ownerSession: 'smoke', title: 'smoke: root task', status: 'ready' });
  const dep = await createTodo(project, { ownerSession: 'smoke', title: 'smoke: dependent task', status: 'blocked', dependsOn: [root.id] });
  log(`Phase 1 — seed`);
  check('root todo is ready', listReadyTodos(project).some((t) => t.id === root.id));
  check('dependent is blocked', getTodo(project, dep.id)?.status === 'blocked');

  // --- Start coordinator (short interval) and let exactly one tick run ---
  log(`\nPhase 2 — start coordinator + spawn worker (real tmux claude; ~up to 90s)`);
  const started = startCoordinator(project, 2_000);
  check('startCoordinator returned true', started === true);
  check('isCoordinatorRunning true', isCoordinatorRunning(project));
  check('startCoordinator idempotent', startCoordinator(project, 2_000) === false);

  // Poll for the claim (status flips to in_progress + sessionName set).
  let claimed = getTodo(project, root.id)!;
  for (let i = 0; i < 90 && !(claimed.status === 'in_progress' && claimed.sessionName); i++) {
    await sleep(1_000);
    claimed = getTodo(project, root.id)!;
  }
  // Stop the loop NOW so it can't spawn a second worker while we verify.
  stopCoordinator(project);
  check('coordinator stopped', !isCoordinatorRunning(project));
  check('root claimed → in_progress', claimed.status === 'in_progress', `status=${claimed.status}`);
  check('claimedBy = coordinator', claimed.claimedBy === 'coordinator', `claimedBy=${claimed.claimedBy}`);
  check('sessionName bound', !!claimed.sessionName, `sessionName=${claimed.sessionName}`);

  workerTmux = claimed.sessionName ?? null;
  if (workerTmux) {
    // sessionName is the collab session; launchAndBind derives the tmux base name.
    // The session name is worker-<id8>; confirm a matching tmux session is live.
    const found = Bun.spawnSync(['tmux', 'ls'], { stdout: 'pipe', stderr: 'ignore' }).stdout?.toString() ?? '';
    const id8 = root.id.slice(0, 8);
    check('tmux worker session live', found.includes(id8) || found.includes(workerTmux), `tmux ls had: ${found.split('\n').filter(Boolean).join(', ') || '(none)'}`);
  }

  // --- Simulate worker completion (self-report path not yet wired) ---
  log(`\nPhase 3 — worker completion → promote dependent`);
  const { promoted } = await handleWorkerComplete(makeCoordinatorDeps(), project, root.id, 'accepted');
  check('root marked done', getTodo(project, root.id)?.status === 'done');
  check('completion promoted dependent', promoted.includes(dep.id), `promoted=[${promoted.join(',')}]`);
  check('dependent now ready', getTodo(project, dep.id)?.status === 'ready');
} finally {
  // --- Cleanup ---
  log(`\nCleanup`);
  if (isCoordinatorRunning(project)) stopCoordinator(project);
  // Kill any tmux session matching this run (base name embeds a project-dir hash + session).
  const ls = Bun.spawnSync(['tmux', 'ls', '-F', '#{session_name}'], { stdout: 'pipe', stderr: 'ignore' }).stdout?.toString() ?? '';
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
  const baseSlug = slug(project.split('/').filter(Boolean).pop() ?? '');
  for (const s of ls.split('\n').map((x) => x.trim()).filter(Boolean)) {
    if ((baseSlug && s.includes(baseSlug)) || (workerTmux && s.includes(workerTmux.slice(-8)))) {
      tmuxKill(s);
      log(`  🧹 killed tmux: ${s}`);
    }
  }
  if (existsSync(project)) { rmSync(project, { recursive: true, force: true }); log(`  🧹 removed temp project`); }
}

log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
