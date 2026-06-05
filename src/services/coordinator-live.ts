import type { Todo } from './todo-store';
import { listReadyTodos, claimTodo, releaseExpiredClaims, completeTodo, updateTodo, getTodo, listTodos, reclaimClaim, releaseClaim } from './todo-store';
import { createEscalation, resolveEscalationsForTodo, recordSupervisorAudit, addSupervised, addWatchedProject } from './supervisor-store';
import { tmuxBaseName } from './tmux-naming';
import { ensureSession, runTodoInSession } from './claude-launch';
import { runTick, type CoordinatorDeps, type GateVerdict } from './coordinator-daemon';
import { loadProjectManifest } from '../config/project-manifest';
import { resolveProfile, type AgentProfile } from '../config/agent-profiles';
import {
  todoTypeToPoolType,
  poolTypeForFiles,
  findIdleSessionForType,
  getOrCreateSlot,
  poolSessionName,
  markBusy,
  markIdle,
  reapDeadSlots,
} from './worker-pool';

/** True if a tmux session with this base name exists (worker still alive). */
function isTmuxAlive(tmux: string): boolean {
  try {
    return Bun.spawnSync(['tmux', 'has-session', '-t', tmux], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
  } catch {
    // can't check → assume alive (don't reclaim on uncertainty; the lease still backstops).
    return true;
  }
}

// --- DOGFOOD #6: idle-at-prompt stall detection ---------------------------------
// A worker can be ALIVE (tmux up, lease unexpired) yet silently stalled: it ended
// its turn sitting at the input prompt awaiting a human decision, without filing an
// escalation. reapDeadClaims only catches DEAD workers; this catches alive-but-idle
// ones and surfaces them as a structured escalation so they don't sit invisibly
// until lease-expiry.

/** Read a worker's rendered tmux pane (point-in-time). '' if unreadable. */
function capturePane(tmux: string): string {
  try {
    const p = Bun.spawnSync(['tmux', 'capture-pane', '-t', tmux, '-p'], { stdout: 'pipe', stderr: 'ignore' });
    return p.stdout?.toString() ?? '';
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
      // POOL-4: route the todo to a persistent, role-typed pool session instead
      // of spawning a fresh worker-<id8> per todo.
      //
      // 1. Resolve the pool type. Prefer the todo's assigned `type` (set at sync
      //    time, the same input resolveProfile/resolveWorkerProfile uses); if it's
      //    null, fall back to file-based inference (poolTypeForFiles). Both default
      //    unmatched → 'general'.
      const files = (todo as { files?: string[] | null }).files;
      const poolType = todo.type ? todoTypeToPoolType(todo.type) : (files ? poolTypeForFiles(files) : 'general');

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
      let poolName = findIdleSessionForType(poolType);
      if (!poolName) {
        const slot = getOrCreateSlot(poolType);
        if (!slot) {
          try { await releaseClaim(project, todo.id); } catch { /* lease still backstops if the release fails */ }
          recordSupervisorAudit({ kind: 'spawn', project, session: poolSessionName(poolType), detail: JSON.stringify({ todoId: todo.id, type: poolType, started: false, reason: 'pool-busy-deferred', released: true }) });
          return false;
        }
        poolName = poolSessionName(slot.type, slot.slot);
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

      // 3. Spawn or reuse the pool session (idempotent — ensureSession reuses a
      //    live, bound session), then send the worker skill into it. Profile
      //    params still drive tools/model/runtimeMode. cwd = the target repo.
      const ensured = await ensureSession({ project: targetProject, session: poolName, allowedTools, model, runtimeMode, contextPrompt });
      const started = ensured.ready;
      let reason = ensured.reason;
      if (started) {
        const run = await runTodoInSession({ session: poolName, invokeSkill, tmux: ensured.tmux });
        if (!run.sent) reason = run.reason;
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
        try {
          addSupervised(project, poolName, 'spawn');
          addWatchedProject(project);
        } catch { /* watching registration is best-effort; spawn already succeeded */ }
      }
      recordSupervisorAudit({ kind: 'spawn', project, session: poolName, detail: JSON.stringify({ todoId: todo.id, type: poolType, started: ok, reason }) });
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
        const session = t.sessionName ?? `worker-${t.id.slice(0, 8)}`;
        if (isTmuxAlive(tmuxBaseName(project, session))) continue; // worker still running (incl. warm idle pool sessions)
        const next = await reclaimClaim(project, t.id);
        // The session is gone — release the pool slot it held (no-op if it wasn't a pool session).
        markIdle(session);
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
      return reapDeadSlots((tmux) => isTmuxAlive(tmux));
    },
    detectStalls: async (project: string): Promise<string[]> => {
      // DOGFOOD #6: surface ALIVE-but-idle (stalled) workers. Signal: the pane is
      // not actively working (no spinner) AND its bottom is byte-identical across
      // >= STALL_MS. On detection we file ONE structured escalation per episode so
      // it appears in the inbox/UI decision card — we never auto-answer (the human
      // decides). A worker that resumes (pane changes / spinner returns) resets.
      const stalled: string[] = [];
      const seen = new Set<string>();
      for (const t of listTodos(project, { status: 'in_progress' })) {
        const session = t.sessionName ?? `worker-${t.id.slice(0, 8)}`;
        const tmux = tmuxBaseName(project, session);
        seen.add(tmux);
        if (!isTmuxAlive(tmux)) continue; // dead → reapDeadClaims handles it
        const pane = capturePane(tmux);
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
      return stalled;
    },
    escalateExhausted: async (project: string, todoId: string): Promise<void> => {
      const todo = getTodo(project, todoId);
      createEscalation({
        project,
        session: todo?.sessionName ?? `worker-${todoId.slice(0, 8)}`,
        kind: 'blocker',
        questionText: `Todo "${todo?.title ?? todoId}" exhausted its retry budget (worker repeatedly failed to complete it). Parked as blocked — needs a human decision.`,
        todoId,
      });
    },
    escalateRejected: async (project: string, todoId: string): Promise<void> => {
      const todo = getTodo(project, todoId);
      createEscalation({
        project,
        session: todo?.sessionName ?? `worker-${todoId.slice(0, 8)}`,
        kind: 'blocker',
        questionText: `Worker REJECTED todo "${todo?.title ?? todoId}" — its mechanical acceptance gate (tsc + tests) failed and it couldn't fix it in scope. Not auto-retried. Re-open with guidance, split, or drop it.`,
        todoId,
      });
    },
    runGate: async (project: string, todoId: string): Promise<GateVerdict | null> => {
      // AUTHORITATIVE gate: run the manifest-declared gate command in the repo
      // dir and derive a verdict the worker cannot fake. No gateCommand → null
      // (honor the worker's self-report, preserving prior behavior).
      //
      // CROSS-PROJECT (SEAM·collab): a todo may be implemented in a repo other
      // than the tracking project. Gate the TARGET repo — its manifest + its
      // change-set — not the tracking project's, which would be BLIND to the
      // actual edits (the observed f719e7e0 bug: gate ran in the tracking repo
      // and saw none of the target's changes).
      const gateProject = getTodo(project, todoId)?.targetProject ?? project;
      const cmd = loadProjectManifest(gateProject)?.gateCommand?.trim();
      if (!cmd) return null;
      try {
        const proc = Bun.spawnSync(['sh', '-c', cmd], { cwd: gateProject, stdout: 'pipe', stderr: 'pipe' });
        const out = (proc.stdout?.toString() ?? '') + '\n' + (proc.stderr?.toString() ?? '');
        // Prefer a structured verdict if the gate emits a trailing JSON line
        // (e.g. a CAD fitness gate: {"passed":false,"reasons":[...],"metrics":{...}}).
        const structured = parseTrailingVerdict(out);
        if (structured) return structured;
        const passed = proc.exitCode === 0;
        return { passed, reasons: passed ? [] : [`gate command exited ${proc.exitCode}: ${lastLines(out, 20)}`] };
      } catch (e) {
        // Fail CLOSED — an un-runnable gate blocks acceptance, never passes it.
        return { passed: false, reasons: [`gate could not run (${cmd}): ${e instanceof Error ? e.message : String(e)}`] };
      }
    },
  };
}

/** Scan the tail of gate output for a JSON object carrying a boolean `passed`.
 *  Lets a domain gate emit a structured {passed, reasons, metrics} verdict on its
 *  last line; anything else falls back to the exit code. */
function parseTrailingVerdict(out: string): GateVerdict | null {
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj.passed === 'boolean') {
        return {
          passed: obj.passed,
          reasons: Array.isArray(obj.reasons) ? obj.reasons.map(String) : [],
          metrics: obj.metrics && typeof obj.metrics === 'object' ? obj.metrics : undefined,
        };
      }
    } catch { /* not JSON — keep scanning upward */ }
  }
  return null;
}

/** Last `n` non-empty lines of a string, joined — for compact failure reasons. */
function lastLines(s: string, n: number): string {
  return s.split('\n').map((l) => l.trimEnd()).filter(Boolean).slice(-n).join('\n');
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
