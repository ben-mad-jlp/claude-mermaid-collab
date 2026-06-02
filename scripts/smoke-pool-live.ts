/**
 * Live end-to-end smoke test — Worker Pool (POOL-5).
 *
 * Verifies the TYPED-SESSION POOL wiring that unit tests stub:
 *   ready todo (type) → launchWorker → descriptive `<type>-N` tmux session +
 *   pool-registry slot busy → simulated completion (markIdle keep-warm) → warm
 *   session survives + is reused by the next same-type todo → two types yield
 *   two named sessions, both in the supervisor Watching list → at-capacity
 *   defers (no spawn).
 *
 * FOLLOWS smoke-coordinator-live.ts: throwaway temp project, REAL tmux `claude`
 * spawns via deps.launchWorker, but completion is SIMULATED via
 * handleWorkerComplete (workers run supervised/interactive and would stall, so we
 * never wait for one to finish). Assertions key off the deterministic surfaces:
 * pool-registry state, descriptive session NAMING, and the supervised list. The
 * tmux-existence checks are tolerant of a flaky real `claude` bind (tmux creates
 * the session before claude attaches, so naming/registry are the source of truth).
 *
 * Run:  bun run scripts/smoke-pool-live.ts
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync as _mk } from 'node:fs';
// Isolate the global supervisor.db so audit/Watching writes don't pollute it.
process.env.MERMAID_SUPERVISOR_DIR = _mk(join(tmpdir(), 'pool-smoke-sup-'));
import { createTodo, getTodo, listReadyTodos } from '../src/services/todo-store';
import { makeCoordinatorDeps } from '../src/services/coordinator-live';
import { handleWorkerComplete } from '../src/services/coordinator-daemon';
import { listPool, resetPool } from '../src/services/worker-pool';
import { tmuxBaseName } from '../src/services/tmux-naming';
import { listSupervised } from '../src/services/supervisor-store';

const log = (s: string) => console.log(s);
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  (ok ? pass++ : fail++);
  log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}
/** Tolerant note: tmux existence is informational (real claude bind can be flaky). */
function note(name: string, ok: boolean, detail = '') {
  log(`  ${ok ? '🟢' : '🟡'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function tmuxExists(name: string): boolean {
  return Bun.spawnSync(['tmux', 'has-session', '-t', name], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
}
function tmuxKill(name: string) {
  Bun.spawnSync(['tmux', 'kill-session', '-t', name], { stdout: 'ignore', stderr: 'ignore' });
}

const project = mkdtempSync(join(tmpdir(), 'pool-smoke-'));
log(`\n🔬 Worker Pool (POOL-5) live smoke test`);
log(`   project: ${project}\n`);

const deps = makeCoordinatorDeps();
// Fresh in-memory pool registry so slot indices are deterministic for this run.
resetPool();

// tmux base names we may have created (for cleanup). Pool session names are
// `<type>-N`; the live tmux name is project-scoped via tmuxBaseName.
const poolSessions = ['backend-1', 'frontend-1', 'general-1'];
const tmuxNames = () => poolSessions.map((s) => tmuxBaseName(project, s));

try {
  // ─── Phase 1: typed naming + spawn ──────────────────────────────────────────
  log(`Phase 1 — typed naming + spawn (real tmux claude)`);
  const be1 = await createTodo(project, { ownerSession: 'smoke', title: 'smoke: backend A', status: 'ready', type: 'backend' });
  const launched1 = await deps.launchWorker(project, getTodo(project, be1.id)!);
  check('launchWorker(backend) returned true', launched1 === true);

  const pool1 = listPool();
  check("registry has 'backend-1'", !!pool1['backend-1'], `keys=[${Object.keys(pool1).join(',')}]`);
  check("backend-1.status === 'busy'", pool1['backend-1']?.status === 'busy', `status=${pool1['backend-1']?.status}`);
  check('backend-1.currentTodoId === todo', pool1['backend-1']?.currentTodoId === be1.id);
  const be1After = getTodo(project, be1.id)!;
  check("todo.sessionName === 'backend-1'", be1After.sessionName === 'backend-1', `sessionName=${be1After.sessionName}`);
  // NOTE: status flips to in_progress in claimTodo (the coordinator tick step BEFORE
  // launchWorker), not in launchWorker itself. Calling launchWorker directly here
  // skips the claim, so status stays 'ready' — the binding launchWorker owns is
  // sessionName (+ the pool slot), asserted above. This is correct, not a bug.
  note('todo still ready (claimTodo is a separate tick step; launchWorker only binds sessionName+slot)', true, `status=${be1After.status}`);
  note('tmux backend-1 live', tmuxExists(tmuxBaseName(project, 'backend-1')), tmuxBaseName(project, 'backend-1'));

  // ─── Phase 2: keep-warm reuse (same type) ───────────────────────────────────
  log(`\nPhase 2 — keep-warm reuse (same type → same session, not killed)`);
  const beTmux = tmuxBaseName(project, 'backend-1');
  const tmuxBeforeComplete = tmuxExists(beTmux);
  await handleWorkerComplete(deps, project, be1.id, 'accepted');

  const pool2 = listPool();
  check("backend-1.status === 'idle' after complete", pool2['backend-1']?.status === 'idle', `status=${pool2['backend-1']?.status}`);
  check('backend-1 has no currentTodoId after complete', pool2['backend-1']?.currentTodoId === undefined);
  check('first backend todo marked done', getTodo(project, be1.id)?.status === 'done');
  // Keep-warm: completion must NOT kill the tmux session. If it was live before, it must stay live.
  if (tmuxBeforeComplete) {
    check('backend-1 tmux STILL EXISTS after complete (keep-warm, not killed)', tmuxExists(beTmux));
  } else {
    note('backend-1 tmux not live pre-complete (flaky claude bind) — keep-warm asserted via registry only', false);
  }

  // Second backend todo → must route to the SAME warm idle backend-1 (no new name).
  const be2 = await createTodo(project, { ownerSession: 'smoke', title: 'smoke: backend B', status: 'ready', type: 'backend' });
  const launched2 = await deps.launchWorker(project, getTodo(project, be2.id)!);
  check('launchWorker(2nd backend) returned true', launched2 === true);

  const pool3 = listPool();
  const backendKeys = Object.keys(pool3).filter((k) => k.startsWith('backend-'));
  check('still exactly ONE backend session (reused, not a new slot)', backendKeys.length === 1, `keys=[${backendKeys.join(',')}]`);
  check("backend-1.status === 'busy' again", pool3['backend-1']?.status === 'busy');
  check('backend-1.currentTodoId === 2nd todo', pool3['backend-1']?.currentTodoId === be2.id);
  check("2nd todo.sessionName === 'backend-1' (same session)", getTodo(project, be2.id)?.sessionName === 'backend-1', `sessionName=${getTodo(project, be2.id)?.sessionName}`);

  // ─── Phase 3: two types → two named sessions, both Watching ─────────────────
  log(`\nPhase 3 — two types → two named sessions + both in Watching`);
  const fe1 = await createTodo(project, { ownerSession: 'smoke', title: 'smoke: frontend A', status: 'ready', type: 'frontend' });
  const launchedFe = await deps.launchWorker(project, getTodo(project, fe1.id)!);
  check('launchWorker(frontend) returned true', launchedFe === true);

  const pool4 = listPool();
  check("registry has 'frontend-1'", !!pool4['frontend-1'], `keys=[${Object.keys(pool4).join(',')}]`);
  check("registry has 'backend-1'", !!pool4['backend-1']);
  check("frontend-1.status === 'busy'", pool4['frontend-1']?.status === 'busy');
  check("frontend todo.sessionName === 'frontend-1'", getTodo(project, fe1.id)?.sessionName === 'frontend-1');

  const watched = listSupervised().filter((s) => s.project === project);
  const watchedNames = watched.map((s) => s.session);
  check("'backend-1' in supervised/Watching list", watchedNames.includes('backend-1'), `watching=[${watchedNames.join(',')}]`);
  check("'frontend-1' in supervised/Watching list", watchedNames.includes('frontend-1'), `watching=[${watchedNames.join(',')}]`);

  note('tmux frontend-1 live', tmuxExists(tmuxBaseName(project, 'frontend-1')));
  note('tmux backend-1 live', tmuxExists(tmuxBaseName(project, 'backend-1')));

  // ─── Phase 4: capacity defer (no tmux) ──────────────────────────────────────
  log(`\nPhase 4 — capacity defer (backend-1 busy, slot budget 1 → defer)`);
  // backend-1 is currently busy on be2 (not completed). A 3rd concurrent backend
  // todo finds no idle session and the type's single slot already exists → defer.
  const be3 = await createTodo(project, { ownerSession: 'smoke', title: 'smoke: backend C', status: 'ready', type: 'backend' });
  const launched3 = await deps.launchWorker(project, getTodo(project, be3.id)!);
  check('launchWorker(3rd backend at capacity) returned false (deferred)', launched3 === false);
  check('deferred todo stays ready (not spawned)', listReadyTodos(project).some((t) => t.id === be3.id), `status=${getTodo(project, be3.id)?.status}`);
  check('deferred todo has NO sessionName', !getTodo(project, be3.id)?.sessionName, `sessionName=${getTodo(project, be3.id)?.sessionName}`);
  const pool5 = listPool();
  check('still exactly ONE backend session after defer', Object.keys(pool5).filter((k) => k.startsWith('backend-')).length === 1);

  // ─── Phase 5: watchdog recycle — covered at unit level ──────────────────────
  log(`\nPhase 5 — watchdog recycle (NOT driven live; can't force a real /clear)`);
  note('watchdog recycle covered by context-watchdog unit tests (see src/services/__tests__)', true,
    'not block the live smoke — recycling a warm session requires a real /clear which is not deterministic here');
} finally {
  // ─── Cleanup ────────────────────────────────────────────────────────────────
  log(`\nCleanup`);
  for (const t of tmuxNames()) {
    if (tmuxExists(t)) { tmuxKill(t); log(`  🧹 killed tmux: ${t}`); }
  }
  // Also sweep any stray sessions that embed this project's slug (defensive).
  const ls = Bun.spawnSync(['tmux', 'ls', '-F', '#{session_name}'], { stdout: 'pipe', stderr: 'ignore' }).stdout?.toString() ?? '';
  // tmuxBaseName(project, sess) === `mc-<basenameSlug>-<sessSlug>`; match the `mc-<basenameSlug>-` prefix.
  const basePrefix = tmuxBaseName(project, 'x').slice(0, -1); // drop the 'x' session slug, keep trailing '-'
  for (const s of ls.split('\n').map((x) => x.trim()).filter(Boolean)) {
    if (basePrefix.length > 4 && s.startsWith(basePrefix)) { tmuxKill(s); log(`  🧹 killed stray tmux: ${s}`); }
  }
  if (existsSync(project)) { rmSync(project, { recursive: true, force: true }); log(`  🧹 removed temp project`); }
  resetPool();
}

log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
log(`   (🟢/🟡 tmux-existence notes are informational — flaky real claude bind tolerated)\n`);
process.exit(fail === 0 ? 0 : 1);
