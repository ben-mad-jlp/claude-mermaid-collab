import * as path from 'node:path';
import type { Todo } from './todo-store';
import { listReadyTodos, claimTodo, releaseExpiredClaims, completeTodo, updateTodo, getTodo, listTodos, reclaimClaim, releaseClaim } from './todo-store';
import { WorktreeManager, INTEGRATION_BRANCH } from '../agent/worktree-manager';
import { createEscalation, resolveEscalationsForTodo, recordSupervisorAudit, addSupervised, addWatchedProject } from './supervisor-store';
import { tmuxBaseName } from './tmux-naming';
import { ensureSession, runTodoInSession } from './claude-launch';
import { runTick, type CoordinatorDeps, type GateVerdict } from './coordinator-daemon';
import { loadProjectManifest } from '../config/project-manifest';
import { runRegistryGate } from './gate-runner';
// Import for side-effect: registers the CAD gate plugin (domain tier) into the
// gate registry so a CAD step artifact is gated deterministically (Phase 1 #1).
import './cad-gate-plugin';
import { deriveBsyncSessionId, isCadTodo, bsyncSessionContextNote } from './bsync-session';
import { resolveProfile, type AgentProfile } from '../config/agent-profiles';
import {
  resolveType,
  typeForFiles,
  findIdleSessionForType,
  getOrCreateSlot,
  poolSessionName,
  markBusy,
  markIdle,
  removeSlot,
  reapDeadSlots,
} from './worker-pool';

/** Run a subprocess ASYNC and await it — NEVER block the single-threaded sidecar
 *  event loop with spawnSync (bug 944408c2: the coordinator/watchdog runs in the
 *  sidecar process, so a synchronous tmux/ps/gate call freezes the whole HTTP API
 *  — terminal + health included — until it returns). `capture` pipes stdout/stderr;
 *  otherwise they're discarded for speed. */
async function execAsync(
  cmd: string[],
  opts: { cwd?: string; capture?: boolean } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    stdout: opts.capture ? 'pipe' : 'ignore',
    stderr: opts.capture ? 'pipe' : 'ignore',
  });
  const [stdout, stderr, code] = await Promise.all([
    opts.capture && proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(''),
    opts.capture && proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(''),
    proc.exited,
  ]);
  return { code: code ?? 0, stdout, stderr };
}

/** True if a tmux session with this base name exists (worker still alive). */
async function isTmuxAlive(tmux: string): Promise<boolean> {
  try {
    return (await execAsync(['tmux', 'has-session', '-t', tmux])).code === 0;
  } catch {
    // can't check → assume alive (don't reclaim on uncertainty; the lease still backstops).
    return true;
  }
}

/** Kill a tmux session by base name. Best-effort (no-op if absent). Used by the
 *  worker-isolation lifecycle to tear down a warm session whose worktree cwd was
 *  removed on merge-back (drop keep-warm, decision c4a8bf40). */
async function killTmuxSession(tmux: string): Promise<void> {
  try {
    await execAsync(['tmux', 'kill-session', '-t', tmux]);
  } catch {
    /* best-effort */
  }
}

// --- 63a59bd6: PID-based liveness (dead Claude in a live tmux) -------------------
// A worker can sit with its tmux session ALIVE but its Claude process EXITED — the
// pane is a bare shell. This falls through BOTH existing watchdog passes:
// reapDeadClaims/reapDeadPoolSlots only fire on a DEAD tmux (this one's alive), and
// the stall classifier only matches an idle Claude TUI (a shell matches neither).
// Result observed live: dead worker, slot held, UI red, human never notified. We
// close it by walking the pane's process subtree and asking "is a `claude` process
// still running?" — definitive, unlike pane scraping.

/** One `ps` snapshot → pid → { ppid-children, comm }. Built once per detect pass
 *  so the subtree walk costs a single subprocess regardless of worker count.
 *  Returns null if ps is unavailable (→ callers treat liveness as unknown). */
async function procSnapshot(): Promise<Map<number, { children: number[]; comm: string }> | null> {
  try {
    const out = (await execAsync(['ps', '-axo', 'pid=,ppid=,comm='], { capture: true })).stdout;
    if (!out.trim()) return null;
    const byPid = new Map<number, { children: number[]; comm: string }>();
    const rows: Array<{ pid: number; ppid: number; comm: string }> = [];
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      const ppid = Number(m[2]);
      const comm = m[3];
      rows.push({ pid, ppid, comm });
      const ex = byPid.get(pid);
      if (ex) ex.comm = comm;
      else byPid.set(pid, { children: [], comm });
    }
    for (const r of rows) {
      let parent = byPid.get(r.ppid);
      if (!parent) { parent = { children: [], comm: '' }; byPid.set(r.ppid, parent); }
      parent.children.push(r.pid);
    }
    return byPid;
  } catch {
    return null;
  }
}

/** The shell PID running in a tmux session's (first) pane, or null. */
async function tmuxPanePid(tmux: string): Promise<number | null> {
  try {
    const out = (await execAsync(['tmux', 'list-panes', '-t', tmux, '-F', '#{pane_pid}'], { capture: true })).stdout;
    const first = out.split('\n').map((l) => l.trim()).filter(Boolean)[0];
    const n = Number(first);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Pure BFS: is a `claude` process anywhere in `rootPid`'s subtree, per the
 *  snapshot's child index? Exported for unit testing (no tmux/ps required). */
export function claudeAliveInSubtree(rootPid: number, snap: Map<number, { children: number[]; comm: string }>): boolean {
  const seen = new Set<number>();
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const node = snap.get(pid);
    if (!node) continue;
    if (/claude/i.test(node.comm)) return true;
    for (const c of node.children) if (!seen.has(c)) queue.push(c);
  }
  return false;
}

/** Is a `claude` process alive in this tmux pane's process subtree? Returns
 *  true/false, or null when it can't be determined (no pane pid / no ps snapshot)
 *  — callers MUST treat null as "assume alive" and never escalate on uncertainty. */
async function claudeProcessPresent(tmux: string, snap: Map<number, { children: number[]; comm: string }> | null): Promise<boolean | null> {
  if (!snap) return null;
  const panePid = await tmuxPanePid(tmux);
  if (panePid == null) return null;
  return claudeAliveInSubtree(panePid, snap);
}

/** Cheap corroboration: does the pane render any Claude TUI chrome (status bar,
 *  spinner, interrupt hint)? Used only to AVOID a false dead-shell call during the
 *  brief spawn gap before claude paints — the PID check is the primary signal.
 *  Deliberately omits the bare `❯` (oh-my-zsh/p10k prompts use it too). Exported
 *  for unit testing. */
export function isClaudeTuiPresent(pane: string): boolean {
  return /ctx\s*\||for agents|esc to interrupt|\(\d+(?:m\s*\d+)?s\s*·/.test(pane);
}

/** Dead-worker tracker (tmux → first-confirmed-dead + escalated), parallel to
 *  idleTracker. A dead shell is confirmed across DEAD_GRACE_MS so we never trip on
 *  the spawn/handoff gap before claude launches. */
const deadTracker = new Map<string, { since: number; escalated: boolean }>();
/** How long a worker's Claude must be confirmed-gone (tmux still alive) before we
 *  declare it dead. Long enough to clear cold-start; override MERMAID_DEAD_GRACE. */
const DEAD_GRACE_MS = (Number(process.env.MERMAID_DEAD_GRACE) || 45) * 1000;

// --- 944408c2 safety valve: respawn backoff + cold-start concurrency cap --------
// A crash-looping worker (dies → reclaim → respawn → dies) plus a thundering herd
// of simultaneous cold-starts together starved the sidecar — the storm behind the
// terminal/health wedge. Two governors keep a few failures from cascading into a
// storm:
//  1. BACKOFF — a todo that just had a spawn attempt waits backoff(retryCount)
//     before another, so a deterministic failure isn't hammered tick after tick.
//  2. COLD-START CAP — at most MERMAID_MAX_COLD_STARTS worker spawns run at once,
//     so a wave can't launch N heavy `claude` cold-starts (+ their MCP load)
//     simultaneously; the rest defer and spawn as slots free.
const lastSpawnAttempt = new Map<string, number>();
function respawnBackoffMs(retryCount: number): number {
  if (retryCount <= 0) return 0;
  return Math.min(5_000 * 2 ** (retryCount - 1), 5 * 60_000); // 5s,10s,20s,40s… cap 5m
}
const MAX_COLD_STARTS = Math.max(1, Number(process.env.MERMAID_MAX_COLD_STARTS) || 2);
let coldStartsInFlight = 0;

// --- DOGFOOD #6: idle-at-prompt stall detection ---------------------------------
// A worker can be ALIVE (tmux up, lease unexpired) yet silently stalled: it ended
// its turn sitting at the input prompt awaiting a human decision, without filing an
// escalation. reapDeadClaims only catches DEAD workers; this catches alive-but-idle
// ones and surfaces them as a structured escalation so they don't sit invisibly
// until lease-expiry.

/** Read a worker's rendered tmux pane (point-in-time). '' if unreadable. */
async function capturePane(tmux: string): Promise<string> {
  try {
    return (await execAsync(['tmux', 'capture-pane', '-t', tmux, '-p'], { capture: true })).stdout;
  } catch {
    return '';
  }
}

/** A Claude TUI pane is ACTIVELY WORKING when it shows a spinner with an elapsed
 *  timer (e.g. "✻ Zesting… (26s · ↓ 1.1k tokens)") or the interrupt hint. When the
 *  worker has ended its turn and sits at the input prompt awaiting a human, neither
 *  is present. */
function isActivelyWorking(pane: string): boolean {
  return /\(\d+(?:m\s*\d+)?s\s*·/.test(pane) || /esc to interrupt/i.test(pane);
}

/** Stable signature of the bottom of the pane (last non-empty lines). Identical
 *  signatures on two reads spanning the stall window = no progress. */
function paneSignature(pane: string): string {
  return pane.split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0).slice(-12).join('\n');
}

/** Best-effort: pull the worker's pending question/options out of the pane so the
 *  escalation card carries context (fix-3) rather than a bare "stalled". */
function extractStallContext(pane: string): string {
  const lines = pane.split('\n').map((l) => l.trim()).filter(Boolean);
  const picked = lines.filter((l) =>
    /^[•\-*]?\s*\(?[a-cA-C1-3][).]/.test(l) ||
    /\boption\b|\bescalat/i.test(l) ||
    /\brecommend/i.test(l) ||
    /reply with|which option|proceed with/i.test(l),
  );
  const ctx = picked.slice(-8).join('\n');
  return ctx.length > 0 ? ctx : lines.slice(-6).join('\n');
}

/** DOGFOOD #6 follow-up: a Claude Code PERMISSION PROMPT is a distinct class of
 *  idle-at-prompt from a self-filed escalation/decision. It renders the tool
 *  call plus the "Do you want to proceed?" 1.Yes / 2.Yes-don't-ask / 3.No menu
 *  for a non-allowlisted tool. The remedy differs: not a generic decision (the
 *  human can't usefully "decide" the worker's question — there is none), but a
 *  "permission needed: <tool>" signal (root fix is the profile allowlist; see
 *  P3 cad-profile). We classify it here so detectStalls can surface it
 *  correctly. Returns the requested tool name when extractable. */
export function detectPermissionPrompt(pane: string): { isPermission: boolean; tool: string | null } {
  // The prompt question + the don't-ask-again affordance is the most specific
  // signature (the bare "Do you want to proceed?" can appear in other prose).
  const hasQuestion = /Do you want to proceed\?/i.test(pane);
  const hasDontAsk = /Yes,?\s*(?:and\s*)?don'?t ask again/i.test(pane);
  const hasYesNoMenu =
    /(?:^|\n)\s*❯?\s*1\.\s*Yes\b/i.test(pane) && /(?:^|\n)\s*❯?\s*(?:2|3)\.\s*(?:Yes|No)\b/i.test(pane);
  const isPermission = hasQuestion && (hasDontAsk || hasYesNoMenu);
  if (!isPermission) return { isPermission: false, tool: null };
  return { isPermission: true, tool: extractRequestedTool(pane) };
}

/** Best-effort: pull the tool the permission prompt is gating out of the pane.
 *  Prefers an explicit MCP tool token (mcp__server__tool), then a tool-call
 *  line ending in "(", then null. */
export function extractRequestedTool(pane: string): string | null {
  const mcp = pane.match(/mcp__[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+/);
  if (mcp) return mcp[0];
  const lines = pane.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    // A tool call line typically looks like "ToolName(arg: …)" or "ToolName(".
    const m = l.match(/^([A-Za-z][\w-]*)\s*\(/);
    if (m && !/^(?:if|for|while|switch|function|return)$/i.test(m[1])) return m[1];
  }
  return null;
}

/** In-memory idle tracker: tmux → { sig, since, escalated }. The coordinator is a
 *  singleton daemon, so per-process module state is fine. */
const idleTracker = new Map<string, { sig: string; since: number; escalated: boolean }>();
/** How long a worker must sit idle-at-prompt (unchanged pane) before it's a stall.
 *  Long enough not to false-trip on normal between-turn idle. Override with
 *  MERMAID_STALL_MIN. */
const STALL_MS = (Number(process.env.MERMAID_STALL_MIN) || 3) * 60 * 1000;

/** Per-todo agent profile → launch params (PCS Phase 3). The todo's `type`
 *  (when present; assigned at sync time per #8) resolves to a registry profile
 *  (tools/model/runtimeMode/contextPrompt); the `invokeSkill` makes the worker
 *  autonomous: after `/collab` binds the session, the worker skill reads its
 *  claimed todo (by id), works it, runs the mechanical acceptance gate, and
 *  reports via `complete_todo`. Unknown/missing type → the `default` profile.
 *  Passing `project` lets the project's `.collab/project.json` manifest override
 *  the global profile (SEAM·collab) — e.g. a `cad` profile shipped with build123d
 *  injects its CAD/viewer allowedTools + contextPrompt. */
export function resolveWorkerProfile(todo: Todo, project?: string): AgentProfile & { invokeSkill: string } {
  const profile = resolveProfile(todo.type, project);
  return { ...profile, invokeSkill: `/mermaid-collab:worker ${todo.id}` };
}

// --- DOGFOOD #5: worker write-isolation (integration-branch recombination) ------
// Behind MERMAID_WORKER_ISOLATION (default OFF). When ON, each worker runs in a
// fresh git worktree branched off the per-project `collab/integration` branch (so
// it sees all prior ACCEPTED work — dependent-todo data-flow is preserved), and on
// `accepted` its branch is committed + merged back into integration. The
// integration branch is the accumulated result of the wave (replaces the pile of
// uncommitted edits in the shared working tree). A merge conflict leaves
// integration untouched and is escalated, never silently corrupted.

/** True when worker write-isolation is enabled via env flag. */
export function workerIsolationEnabled(): boolean {
  const v = process.env.MERMAID_WORKER_ISOLATION;
  return v === '1' || v === 'true';
}

// One WorktreeManager per target-repo root (memoised). Records + worktrees live
// under <repo>/.collab/agent-sessions to match the AgentSessionRegistry default,
// so launchWorker (ensure) and completeTodo (merge-back) key off the same store.
const worktreeManagers = new Map<string, WorktreeManager>();
export function getWorktreeManager(projectRoot: string): WorktreeManager {
  let m = worktreeManagers.get(projectRoot);
  if (!m) {
    const persistDir = path.join(projectRoot, '.collab', 'agent-sessions');
    m = new WorktreeManager({
      projectRoot,
      baseDir: path.join(persistDir, 'worktrees'),
      persistDir,
    });
    worktreeManagers.set(projectRoot, m);
  }
  return m;
}

/** Wire the Coordinator daemon to the real todo-store + a live worker launcher. */
export function makeCoordinatorDeps(): CoordinatorDeps {
  return {
    listReadyTodos,
    // Wrapped to record coordinator lifecycle events into the supervisor audit
    // log → it doubles as the unified orchestration trace (open-problem #10/obs).
    claimTodo: async (project, id, claimedBy, leaseMs) => {
      const c = await claimTodo(project, id, claimedBy, leaseMs);
      if (c) recordSupervisorAudit({ kind: 'claim', project, session: c.sessionName ?? '', detail: JSON.stringify({ todoId: id, claimedBy }) });
      return c;
    },
    releaseExpiredClaims,
    completeTodo: async (project, id, acceptance) => {
      const r = await completeTodo(project, id, acceptance);
      // POOL-4 keep-warm: the worker's pool session is NOT killed on complete —
      // mark its slot idle so it can take the next matching todo (context is bounded
      // only by the context-watchdog, never an idle-kill here). The slot frees on
      // the session name the todo was claimed under.
      const session = r.completed.sessionName ?? '';
      if (session) markIdle(session);
      recordSupervisorAudit({ kind: 'complete', project, session, detail: JSON.stringify({ todoId: id, acceptance: acceptance ?? r.completed.acceptanceStatus, promoted: r.promoted, rolledUp: r.rolledUp }) });
      // Escalation lifecycle: a todo that completes (accepted) may have left an
      // OPEN escalation behind — e.g. it exhausted its retry budget, the
      // coordinator filed a 'blocker', and it later recovered (human decision +
      // reclaim) and finished. Auto-resolve those so the inbox doesn't keep
      // phantom 'exhausted retry budget' entries. Match by exact todoId and by
      // the worker/pool session names this todo ran under.
      const accepted = (acceptance ?? r.completed.acceptanceStatus) === 'accepted';
      // DOGFOOD #5 isolation: on acceptance, commit the worker's worktree and
      // merge its branch back into the integration branch. A conflict leaves
      // integration untouched and is escalated for a human to resolve.
      if (accepted && workerIsolationEnabled() && session) {
        const targetProject = r.completed.targetProject ?? project;
        try {
          const wm = getWorktreeManager(targetProject);
          const message = `collab(${id.slice(0, 8)}): ${r.completed.title}`.slice(0, 200);
          const merge = await wm.commitAndMergeToIntegration(session, { message });
          recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, isolation: 'merge-back', merged: merge.merged, conflict: merge.conflict, committed: merge.committed, branch: merge.workerBranch }) });
          if (merge.conflict) {
            createEscalation({
              project,
              session,
              todoId: id,
              kind: 'assumption-invalidated',
              questionText: `Worker-isolation merge conflict: branch ${merge.workerBranch} could not merge into ${merge.integrationBranch} for todo "${r.completed.title}". Resolve the conflict manually, then merge the branch into ${merge.integrationBranch}.`,
            });
          } else {
            // Merge succeeded — the worktree branch is now in integration. Remove
            // the worktree so the next todo for this pool lane gets a fresh one
            // branched off the latest integration (sees this merge).
            await wm.remove(session).catch(() => {});
            // DROP keep-warm (decision c4a8bf40): the worktree is now gone, so the
            // warm session's cwd is a deleted dir. Kill its tmux session and drop
            // the pool slot so the next todo spawns a FRESH session in a FRESH
            // worktree instead of reusing a bare-shell session.
            try { await killTmuxSession(tmuxBaseName(targetProject, session)); } catch { /* best-effort teardown */ }
            removeSlot(session);
          }
        } catch (e) {
          recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, isolation: 'merge-back-failed', reason: e instanceof Error ? e.message : String(e) }) });
        }
      }
      if (accepted) {
        const sessions = [session, `worker-${id.slice(0, 8)}`].filter(Boolean);
        const resolved = resolveEscalationsForTodo(project, id, sessions, 'resolved');
        if (resolved.length > 0) {
          recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, autoResolvedEscalations: resolved.map((e) => e.id), reason: 'todo-completed' }) });
        }
      }
      return r;
    },
    launchWorker: async (project: string, todo: Todo): Promise<boolean> => {
      // SAFETY VALVE 1 — respawn backoff (944408c2): a todo whose worker was just
      // attempted waits backoff(retryCount) before another spawn, so a crash loop
      // can't hammer the sidecar tick after tick. Defer (release the claim) until
      // the window elapses; it stays re-claimable.
      const backoff = respawnBackoffMs(todo.retryCount ?? 0);
      if (backoff > 0) {
        const last = lastSpawnAttempt.get(todo.id);
        if (last != null && Date.now() - last < backoff) {
          try { await releaseClaim(project, todo.id); } catch { /* lease backstops */ }
          recordSupervisorAudit({ kind: 'spawn', project, session: '', detail: JSON.stringify({ todoId: todo.id, started: false, reason: 'respawn-backoff', backoffMs: backoff, retryCount: todo.retryCount ?? 0, released: true }) });
          return false;
        }
      }

      // POOL-4: route the todo to a persistent, role-typed pool session instead
      // of spawning a fresh worker-<id8> per todo.
      //
      // 1. Resolve the routing `type`. Prefer the todo's assigned `type` (set at
      //    sync time, the same input resolveProfile/resolveWorkerProfile uses); if
      //    it's null, fall back to file-based inference (typeForFiles). Both default
      //    unmatched → 'general'.
      const files = (todo as { files?: string[] | null }).files;
      const type = todo.type ? resolveType(todo.type) : (files ? typeForFiles(files) : 'general');

      // 2. Find a routable session of that type. Prefer a warm idle session; else
      //    lazily grab a slot within the type's budget. At capacity (no idle + no
      //    slot budget) → defer. The coordinator already claimed this todo this
      //    tick, but we never attempted a spawn — so RELEASE the claim immediately
      //    (no retry penalty: nothing ran) back to 'ready'. Otherwise the todo
      //    sits in_progress holding a dead full-length lease with no worker until
      //    the lease expires → reclaim → re-defer (DOGFOOD #3). Releasing keeps it
      //    re-claimable next tick once a slot frees, so with pool=N exactly N
      //    todos run and the rest stay 'ready'. Spawn-FAILED (a real spawn attempt
      //    that errored, below) is different: it keeps the lease for retry.
      // DROP keep-warm UNDER ISOLATION (decision c4a8bf40): a warm pool session
      // kept its prior worktree as cwd, but that worktree is REMOVED on merge-back
      // → reusing it lands the worker at a bare shell in a deleted dir (the observed
      // regression). So under isolation never route to a warm idle session; always
      // grab a slot → a FRESH session in a FRESH worktree per todo. Keep-warm reuse
      // stays for the non-isolation shared-tree path.
      let poolName = workerIsolationEnabled() ? undefined : findIdleSessionForType(type);
      if (!poolName) {
        const slot = getOrCreateSlot(type);
        if (!slot) {
          try { await releaseClaim(project, todo.id); } catch { /* lease still backstops if the release fails */ }
          recordSupervisorAudit({ kind: 'spawn', project, session: poolSessionName(type), detail: JSON.stringify({ todoId: todo.id, type, started: false, reason: 'pool-busy-deferred', released: true }) });
          return false;
        }
        poolName = poolSessionName(slot.type, slot.slot);
      }

      // Persist the pool lane onto the todo NOW — as soon as the lane is committed,
      // before the (possibly slow / failure-prone) spawn. Every downstream identity
      // derivation (fleet-status, stall detector, reaper, escalations, the UI card →
      // create-terminal) reads todo.sessionName to compute the worker's tmux name.
      // If this is left until after a successful spawn (and swallowed best-effort),
      // any race/failure leaves sessionName null → those sites fall back to a
      // fabricated `worker-<id8>` name that can NEVER match the real `<type>-<slot>`
      // tmux → the worker shows no_tmux and can't be attached/viewed. Setting it here
      // pins the identity even if the spawn later fails (a released todo leaves
      // in_progress, so it won't linger as a phantom worker in the fleet view).
      if (todo.sessionName !== poolName) {
        try { await updateTodo(project, todo.id, { sessionName: poolName }); }
        catch (e) { recordSupervisorAudit({ kind: 'spawn', project, session: poolName, detail: JSON.stringify({ todoId: todo.id, sessionNamePersist: 'failed', reason: e instanceof Error ? e.message : String(e) }) }); }
      }

      // CROSS-PROJECT (SEAM·collab): the todo lives in `project` (the tracking
      // store where it was claimed) but may be IMPLEMENTED in a different repo.
      // Spawn the worker with cwd = the target repo so its edits land there and
      // the gate (below) can see them; resolve the worker profile from the target
      // repo's manifest too. All claim/store/supervised bookkeeping stays on the
      // tracking `project` — that's where the todo + lease live.
      const targetProject = todo.targetProject ?? project;
      let { allowedTools, invokeSkill, model, runtimeMode, contextPrompt } = resolveWorkerProfile(todo, targetProject);

      // When the implementation target differs from the tracking project, the
      // worker's cwd is the target repo but its todo (get_todo/complete_todo +
      // friction note) lives in the tracking project — tell it so it reports to
      // the right store instead of defaulting every collab call to its cwd.
      if (targetProject !== project) {
        const note =
          `\n\nCROSS-PROJECT TODO: this todo is TRACKED in the collab project ${project}, but its ` +
          `implementation TARGET is your current working directory (${targetProject}). Make all code ` +
          `edits here in ${targetProject}. For collab todo operations — get_todo, complete_todo, and the ` +
          `.collab/attempts friction note — use project=${project} (the tracking project), NOT your cwd.`;
        contextPrompt = (contextPrompt ?? '') + note;
      }

      // BSYNC SESSION ISOLATION (SEAM·both): a CAD worker must not use bsync's
      // default in-memory session — concurrent CAD lanes would stomp each other's
      // live assembly. Derive a stable, unique session_id from (project, lane,
      // todo) and tell the worker to pass it on every bsync call. Keyed on the
      // tracking `project` + lane `poolName` + todo id so it is reproducible on
      // resume and distinct per concurrent worker.
      if (isCadTodo(todo)) {
        const bsyncSessionId = deriveBsyncSessionId(project, poolName, todo.id);
        contextPrompt = (contextPrompt ?? '') + bsyncSessionContextNote(bsyncSessionId);
      }

      // 2b. DOGFOOD #5 isolation: when enabled, run this worker in a fresh git
      //     worktree branched off the project's integration branch (so it sees all
      //     prior accepted work) instead of the shared working tree. cwd becomes
      //     the worktree path. Best-effort: if worktree setup fails (e.g. non-git
      //     repo), fall back to the shared-tree behavior rather than dropping the
      //     todo.
      let launchCwd: string | undefined;
      if (workerIsolationEnabled()) {
        try {
          const wm = getWorktreeManager(targetProject);
          const integ = await wm.ensureIntegration();
          if (integ) {
            const wt = await wm.ensure(poolName, { baseBranch: integ.branch });
            launchCwd = wt.path;
          }
        } catch (e) {
          recordSupervisorAudit({ kind: 'spawn', project, session: poolName, detail: JSON.stringify({ todoId: todo.id, isolation: 'worktree-setup-failed', reason: e instanceof Error ? e.message : String(e) }) });
        }
      }

      // SAFETY VALVE 2 — cold-start concurrency cap (944408c2): bound simultaneous
      // worker cold-starts so a wave can't storm the sidecar with N heavy claude
      // spawns + MCP load at once. At cap → defer (release the claim; re-claimable
      // next tick once an in-flight spawn finishes). Counts only REAL spawn attempts
      // (after all the deferrals above), so a wave of N todos with cap=2 spawns in
      // waves of 2 instead of all at once.
      if (coldStartsInFlight >= MAX_COLD_STARTS) {
        try { await releaseClaim(project, todo.id); } catch { /* lease backstops */ }
        recordSupervisorAudit({ kind: 'spawn', project, session: poolName, detail: JSON.stringify({ todoId: todo.id, started: false, reason: 'cold-start-cap', inFlight: coldStartsInFlight, cap: MAX_COLD_STARTS, released: true }) });
        return false;
      }

      // 3. Spawn or reuse the pool session (idempotent — ensureSession reuses a
      //    live, bound session), then send the worker skill into it. Profile
      //    params still drive tools/model/runtimeMode. cwd = the worktree (under
      //    isolation) or the target repo. Stamp the attempt (for backoff) and count
      //    it against the cold-start cap until the spawn finishes.
      lastSpawnAttempt.set(todo.id, Date.now());
      coldStartsInFlight++;
      let ensured: Awaited<ReturnType<typeof ensureSession>> = { ready: false };
      let started = false;
      let reason: string | undefined;
      try {
        ensured = await ensureSession({ project: targetProject, session: poolName, allowedTools, model, runtimeMode, contextPrompt, cwd: launchCwd });
        started = ensured.ready;
        reason = ensured.reason;
        if (started) {
          const run = await runTodoInSession({ session: poolName, invokeSkill, tmux: ensured.tmux });
          if (!run.sent) reason = run.reason;
        }
      } finally {
        coldStartsInFlight--;
      }
      const ok = started && reason === undefined;

      if (ok) {
        // Record the backing tmux so reapDeadSlots can free this slot on the
        // worker's death regardless of the todo's eventual status.
        markBusy(poolName, todo.id, ensured.tmux ?? tmuxBaseName(targetProject, poolName));
        // Claim continues under the pool session name (todo.sessionName = poolName)
        // so reclaim/lease semantics and the dead-claim reaper key off it.
        try { await updateTodo(project, todo.id, { sessionName: poolName }); } catch { /* spawn already succeeded; lease covers any inconsistency */ }
        // POOL-2: auto-subscribe the pool session into the supervisor's Watching
        // list so a card appears. Idempotent (addSupervised INSERT OR IGNORE on PK,
        // addWatchedProject no-ops when watched) — safe to re-run when a warm pool
        // session takes a second todo.
        // BUGFIX (2e07d1c5): record the supervised row under the project the tmux
        // session actually lives in (targetProject), NOT the tracking project.
        // The tmux is created as tmuxBaseName(targetProject, poolName) (ensureSession
        // above + markBusy), and /api/ide/create-terminal derives the tmux name from
        // the supervised row's project — so for cross-project workers (targetProject
        // != project) the tracking project produced a different name and clicking the
        // card opened an empty shell instead of attaching. For the common same-project
        // case targetProject === project, so this is a no-op there.
        try {
          // Record the launch project (targetProject) so create-terminal derives
          // the SAME tmux name this worker was launched under. tmux was created
          // via ensureSession({ project: targetProject }) → tmuxBaseName(
          // targetProject, poolName); without this the supervised row carried the
          // tracking project and create-terminal attached to the wrong/empty tmux
          // (cross-project only). addSupervised stores null when targetProject==project.
          addSupervised(project, poolName, 'spawn', '', targetProject);
          addWatchedProject(project);
        } catch { /* watching registration is best-effort; spawn already succeeded */ }
      }
      recordSupervisorAudit({ kind: 'spawn', project, session: poolName, detail: JSON.stringify({ todoId: todo.id, type, started: ok, reason }) });
      return ok;
    },
    reapDeadClaims: async (project: string): Promise<{ reclaimed: string[]; exhausted: string[] }> => {
      const reclaimed: string[] = [];
      const exhausted: string[] = [];
      // Only in_progress todos can have a dead worker. A WARM IDLE pool session is
      // never reaped here: its todo is already `done` (not in_progress) so it isn't
      // iterated, and even if an in_progress todo points at it, its tmux is alive →
      // we `continue`. We only reclaim a todo whose lease backstop applies AND whose
      // session/tmux is actually gone (hard-dead worker), then free its pool slot so
      // the slot isn't wedged busy on a vanished session.
      for (const t of listTodos(project, { status: 'in_progress' })) {
        // Identity is the persisted pool lane. No sessionName → the todo was never
        // spawned under a lane (or its persist raced); treat as dead and reclaim,
        // rather than fabricating a `worker-<id8>` name that points at no real tmux.
        const session = t.sessionName;
        if (session && await isTmuxAlive(tmuxBaseName(project, session))) continue; // worker still running (incl. warm idle pool sessions)
        const next = await reclaimClaim(project, t.id);
        // The session is gone — release the pool slot it held (no-op if it wasn't a pool session).
        if (session) markIdle(session);
        if (next === 'ready') reclaimed.push(t.id);
        else if (next === 'blocked') exhausted.push(t.id);
      }
      return { reclaimed, exhausted };
    },
    reapDeadPoolSlots: async (_project: string): Promise<string[]> => {
      // Slot-level reconciliation: a slot records its tmux at markBusy, so we can
      // free it on its worker's death regardless of the todo's status (dropped,
      // completed out-of-band, or an operator-killed lane). Project-agnostic — it
      // keys off each slot's own recorded tmux, not the in_progress todo list.
      return await reapDeadSlots((tmux) => isTmuxAlive(tmux));
    },
    detectStalls: async (project: string): Promise<string[]> => {
      // DOGFOOD #6: surface ALIVE-but-idle (stalled) workers. Signal: the pane is
      // not actively working (no spinner) AND its bottom is byte-identical across
      // >= STALL_MS. On detection we file ONE structured escalation per episode so
      // it appears in the inbox/UI decision card — we never auto-answer (the human
      // decides). A worker that resumes (pane changes / spinner returns) resets.
      const stalled: string[] = [];
      const seen = new Set<string>();
      // One process snapshot for the whole pass → the PID-liveness subtree walk
      // (63a59bd6) costs a single `ps` regardless of how many workers are live.
      const snap = await procSnapshot();
      for (const t of listTodos(project, { status: 'in_progress' })) {
        // No persisted lane → not a real spawned worker (reapDeadClaims reclaims it).
        // Never fabricate a `worker-<id8>` name: it derives a tmux that matches no
        // live session, so the worker would be invisible to stall detection.
        const session = t.sessionName;
        if (!session) continue;
        const tmux = tmuxBaseName(project, session);
        seen.add(tmux);
        if (!(await isTmuxAlive(tmux))) continue; // dead → reapDeadClaims handles it
        const pane = await capturePane(tmux);

        // 63a59bd6 — DEAD CLAUDE IN A LIVE TMUX (the watchdog blind spot): the tmux
        // is alive but no `claude` process remains in its pane subtree, and the pane
        // shows no Claude TUI chrome (so it's a bare shell, not a mid-spawn gap).
        // Confirm across DEAD_GRACE_MS, then ESCALATE (the death was previously
        // silent), kill the dud session, and reclaim the claim so the lane resets.
        const claudePresent = await claudeProcessPresent(tmux, snap);
        if (claudePresent === false && !isClaudeTuiPresent(pane)) {
          const now = Date.now();
          const prevDead = deadTracker.get(tmux);
          if (!prevDead) { deadTracker.set(tmux, { since: now, escalated: false }); continue; }
          if (prevDead.escalated || now - prevDead.since < DEAD_GRACE_MS) continue;
          try {
            createEscalation({
              project,
              session,
              kind: 'blocker',
              todoId: t.id,
              questionText:
                `Worker for "${t.title ?? t.id}" DIED — its Claude process exited but the tmux ` +
                `session stayed alive (a bare shell), so it silently held its slot with nothing ` +
                `running and showed RED without raising anything. The lane has been reset and the ` +
                `claim reclaimed. Re-open/retry with guidance, or drop it. (63a59bd6 auto-detected).`,
            });
            recordSupervisorAudit({ kind: 'escalate', project, session, detail: JSON.stringify({ todoId: t.id, reason: 'dead-claude-live-tmux', deadMs: now - prevDead.since }) });
            // Reset the lane: kill the dud bare-shell tmux, free the pool slot, and
            // reclaim the claim (retry-budget-aware → ready or blocked).
            await killTmuxSession(tmux);
            markIdle(session);
            await reclaimClaim(project, t.id);
            prevDead.escalated = true;
            stalled.push(t.id);
          } catch { /* escalation/recovery best-effort; never abort the tick */ }
          continue;
        }
        // Claude is present (or liveness unknown) → clear any dead-tracking for it.
        deadTracker.delete(tmux);

        if (!pane || isActivelyWorking(pane)) { idleTracker.delete(tmux); continue; }
        const sig = paneSignature(pane);
        const now = Date.now();
        const prev = idleTracker.get(tmux);
        if (!prev || prev.sig !== sig) {
          idleTracker.set(tmux, { sig, since: now, escalated: false });
          continue;
        }
        if (prev.escalated || now - prev.since < STALL_MS) continue;
        try {
          // DOGFOOD #6 follow-up: classify the idle-at-prompt. A permission
          // prompt is NOT a decision the human can answer in the inbox — it's a
          // "permission needed: <tool>" signal whose root fix is the worker
          // profile allowlist (P3). Surface it as a distinct 'approval'
          // escalation naming the tool, so it reads as "allowlist this tool",
          // not a generic stalled-decision card.
          const perm = detectPermissionPrompt(pane);
          const idleMin = Math.round((now - prev.since) / 60000);
          if (perm.isPermission) {
            const toolLabel = perm.tool ?? 'an unknown tool';
            createEscalation({
              project,
              session,
              kind: 'approval',
              todoId: t.id,
              questionText:
                `Permission needed: worker for "${t.title ?? t.id}" is blocked on a Claude Code ` +
                `permission prompt for ${toolLabel} (non-allowlisted) and has been idle ${idleMin}+ min. ` +
                `Root fix: add ${toolLabel} to the worker profile allowlist so it never prompts ` +
                `(see P3 cad-profile). This is a permission stall, not a decision (DOGFOOD #6 follow-up).`,
            });
            recordSupervisorAudit({ kind: 'escalate', project, session, detail: JSON.stringify({ todoId: t.id, reason: 'permission-prompt', tool: perm.tool, idleMs: now - prev.since }) });
          } else {
            createEscalation({
              project,
              session,
              kind: 'question',
              todoId: t.id,
              questionText:
                `Worker for "${t.title ?? t.id}" appears STALLED — idle at its prompt with no progress for ` +
                `${idleMin}+ min, awaiting input but no escalation was filed ` +
                `(DOGFOOD #6 auto-detected). Pending context:\n\n${extractStallContext(pane)}`,
            });
            recordSupervisorAudit({ kind: 'escalate', project, session, detail: JSON.stringify({ todoId: t.id, reason: 'stall-detected', idleMs: now - prev.since }) });
          }
          prev.escalated = true;
          stalled.push(t.id);
          // RECOVERY (41d24bee): a stalled worker would otherwise hold its claim
          // (until the 40-min lease) AND its pool slot, wedging the whole lane —
          // exactly the parked-worker-blocks-the-pool failure observed live. Now
          // that it's escalated for a human, park the todo 'blocked' (not re-run —
          // re-running a stall just re-stalls) and FREE the pool slot so the lane
          // keeps flowing; the worker session becomes a warm idle slot reused for
          // the next ready todo.
          try {
            await releaseClaim(project, t.id);
            await updateTodo(project, t.id, { status: 'blocked' });
            markIdle(session);
          } catch { /* recovery best-effort; never abort the tick */ }
        } catch { /* escalation best-effort; never abort the tick */ }
      }
      // GC trackers for tmux sessions no longer in_progress.
      for (const k of idleTracker.keys()) if (!seen.has(k)) idleTracker.delete(k);
      for (const k of deadTracker.keys()) if (!seen.has(k)) deadTracker.delete(k);
      return stalled;
    },
    escalateExhausted: async (project: string, todoId: string): Promise<void> => {
      const todo = getTodo(project, todoId);
      createEscalation({
        project,
        // Label with the real pool lane; never a fabricated `worker-<id8>` (the
        // card resolves by todoId, so a neutral label is safe when unspawned).
        session: todo?.sessionName ?? 'unassigned',
        kind: 'blocker',
        questionText: `Todo "${todo?.title ?? todoId}" exhausted its retry budget (worker repeatedly failed to complete it). Parked as blocked — needs a human decision.`,
        todoId,
      });
    },
    escalateRejected: async (project: string, todoId: string): Promise<void> => {
      const todo = getTodo(project, todoId);
      createEscalation({
        project,
        // Label with the real pool lane; never a fabricated `worker-<id8>` (the
        // card resolves by todoId, so a neutral label is safe when unspawned).
        session: todo?.sessionName ?? 'unassigned',
        kind: 'blocker',
        questionText: `Worker REJECTED todo "${todo?.title ?? todoId}" — its mechanical acceptance gate (tsc + tests) failed and it couldn't fix it in scope. Not auto-retried. Re-open with guidance, split, or drop it.`,
        todoId,
      });
    },
    runGate: async (project: string, todoId: string): Promise<GateVerdict | null> => {
      // AUTHORITATIVE gate: resolve the applicable gate plugin and run it. No
      // applicable plugin → null (honor the worker's self-report, preserving prior
      // behavior). The generic manifest-gateCommand runner is the project-tier
      // fallback; a CAD step artifact resolves the deterministic CAD gate ahead of
      // it (gate-runner registry: core → domain → project).
      //
      // CROSS-PROJECT (SEAM·collab): a todo may be implemented in a repo other
      // than the tracking project. Gate the TARGET repo — its manifest + its
      // change-set — not the tracking project's, which would be BLIND to the
      // actual edits (the observed f719e7e0 bug: gate ran in the tracking repo
      // and saw none of the target's changes).
      const todo = getTodo(project, todoId);
      const gateProject = todo?.targetProject ?? project;
      // LANE-LOCAL change-set (todo b78fd3f6): under worker isolation each lane has
      // its OWN worktree, so scope the gate to THIS lane's worktree diff rather than
      // the shared tree's git status (which returns sibling lanes' in-flight files
      // and false-rejects green work). Resolve the lane's worktree path read-only
      // from the todo's session; absent/unisolated → undefined → whole-tree fallback.
      let laneCwd: string | undefined;
      let integrationBase: string | undefined;
      if (workerIsolationEnabled() && todo?.sessionName) {
        try {
          const p = await getWorktreeManager(gateProject).existingPath(todo.sessionName);
          if (p) { laneCwd = p; integrationBase = INTEGRATION_BRANCH; }
        } catch { /* fall back to whole-tree scoping */ }
      }
      return runRegistryGate({
        project,
        gateProject,
        todoId,
        todo: todo ?? null,
        manifest: loadProjectManifest(gateProject),
        exec: execAsync,
        laneCwd,
        integrationBase,
      });
    },
  };
}

const timers = new Map<string, ReturnType<typeof setInterval>>();
/** Per-project heartbeat: when the LAST tick COMPLETED (resolved or threw), not
 *  when it fired. A registered timer whose runTick hangs forever keeps firing but
 *  never completes — so we key liveness on completion, which goes stale if the
 *  tick body wedges. (1cb49878) */
const lastTickAt = new Map<string, number>();
/** A loop is considered wedged if no tick has COMPLETED within this many intervals. */
const STALE_TICK_INTERVALS = 4;

function isTickStale(project: string, intervalMs: number): boolean {
  const last = lastTickAt.get(project);
  if (last == null) return false; // just started, no completed tick yet — not stale
  return Date.now() - last > intervalMs * STALE_TICK_INTERVALS;
}

/** Tear down a project's timer WITHOUT touching auto-manage (unlike stopCoordinator,
 *  which also opts out of respawn). Used to force-restart a wedged loop. */
function clearTimer(project: string): void {
  const t = timers.get(project);
  if (t) clearInterval(t);
  timers.delete(project);
  lastTickAt.delete(project);
}

/** Start a per-project coordinator tick loop. Returns false if a HEALTHY loop is
 *  already running; if a loop is registered but WEDGED (no completed tick within
 *  STALE_TICK_INTERVALS), force-restarts it and returns true. Explicit-start only
 *  (never auto-started at boot). The stale-recovery path is what lets both an
 *  explicit start AND the auto-respawn watchdog rescue a dead loop — previously a
 *  wedged loop reported running:true and start no-op'd forever (1cb49878). */
export function startCoordinator(project: string, intervalMs = 30_000): boolean {
  if (timers.has(project)) {
    if (!isTickStale(project, intervalMs)) return false; // healthy → genuine no-op
    clearTimer(project); // wedged → force-restart below
  }
  const deps = makeCoordinatorDeps();
  const mark = () => lastTickAt.set(project, Date.now()); // stamp on COMPLETION
  const t = setInterval(() => {
    void runTick(deps, project).then(mark, mark); // mark whether it resolves or throws
  }, intervalMs);
  (t as { unref?: () => void }).unref?.();
  timers.set(project, t);
  lastTickAt.set(project, Date.now()); // seed so a fresh loop isn't judged stale
  return true;
}

/** Coordinator liveness for visibility/diagnostics: is a timer registered, when
 *  did the last tick complete, and is the loop wedged (stale heartbeat)? */
export function getCoordinatorLiveness(project: string, intervalMs = 30_000): {
  running: boolean;
  lastTickAt: number | null;
  stale: boolean;
} {
  return {
    running: timers.has(project),
    lastTickAt: lastTickAt.get(project) ?? null,
    stale: timers.has(project) && isTickStale(project, intervalMs),
  };
}

export function stopCoordinator(project: string): boolean {
  // An explicit stop also opts the project out of auto-respawn — otherwise the
  // watchdog would immediately fight a deliberate UI/operator "Stop daemon".
  autoManaged.delete(project);
  maybeStopWatchdog();
  const t = timers.get(project);
  if (!t) return false;
  clearInterval(t);
  timers.delete(project);
  lastTickAt.delete(project);
  return true;
}

export function isCoordinatorRunning(project: string): boolean {
  return timers.has(project);
}

// --- Always-on auto-start + self-respawn (PCS infra) ---
//
// Projects registered via autoStartCoordinator() are kept running by a single
// global watchdog: it periodically re-asserts startCoordinator() for each, so a
// loop that died (e.g. cleared by a crash recovery path) is respawned on the
// next sweep. The daemon is safe to leave always-on — it only ever claims todos
// already in `ready`, which only the Planner sets post-approval, so an empty
// ready-queue idles. An explicit stopCoordinator() opts a project back out.
const autoManaged = new Map<string, number>(); // project → intervalMs
let watchdog: ReturnType<typeof setInterval> | null = null;
const WATCHDOG_INTERVAL_MS = 30_000;

function maybeStopWatchdog(): void {
  if (autoManaged.size === 0 && watchdog) {
    clearInterval(watchdog);
    watchdog = null;
  }
}

function ensureWatchdog(): void {
  if (watchdog) return;
  const w = setInterval(() => {
    for (const [project, intervalMs] of autoManaged) {
      // Idempotent: startCoordinator returns false (no-op) if already running,
      // and respawns the loop if it had died.
      startCoordinator(project, intervalMs);
    }
  }, WATCHDOG_INTERVAL_MS);
  (w as { unref?: () => void }).unref?.();
  watchdog = w;
}

/** Start a coordinator for `project` and keep it always-on: it is respawned by
 *  a watchdog if its loop ever dies. Idempotent. Returns whether the loop was
 *  (re)started by this call. */
export function autoStartCoordinator(project: string, intervalMs = 30_000): boolean {
  autoManaged.set(project, intervalMs);
  ensureWatchdog();
  return startCoordinator(project, intervalMs);
}

/** True if `project` is registered for always-on auto-respawn. */
export function isCoordinatorAutoManaged(project: string): boolean {
  return autoManaged.has(project);
}
