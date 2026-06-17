import * as path from 'node:path';
import type { Todo } from './todo-store';
import { listReadyTodos, claimTodo, releaseExpiredClaims, completeTodo, updateTodo, getTodo, listTodos, reclaimClaim, reclaimOrphan, releaseClaim, resetTodo } from './todo-store';
import { planOrphanReap, DEFAULT_ORPHAN_GRACE_MS, shouldPulseReap, DEFAULT_PULSE_STALE_MS } from './coordinator-core';
import { getOrchestratorLevel, levelRank, listOrchestratorProjects } from './orchestrator-config';
import { getStatus, recordSessionProvider } from './session-status-store';
import { getWebSocketHandler } from './ws-handler-manager';
import { filterClaimable } from './claim-guard';
import { summarize as summarizeLedger } from './worker-ledger';
import { WorktreeManager, INBOX_EPIC_ID } from '../agent/worktree-manager';
import { createEscalation, resolveEscalationsForTodo, recordSupervisorAudit, addSupervised, addWatchedProject, getEscalation, resolveEscalation } from './supervisor-store';
import { tmuxBaseName } from './tmux-naming';
import { sendTmuxKeysRaw } from './tmux-send';
import { mux, argvHasSession, argvKillSession, argvListPanesPanePid, argvCapturePane, argvPsComm } from './session-mux/index.ts';
import { runTick, handleWorkerComplete, type CoordinatorDeps, type GateVerdict } from './coordinator-daemon';
import { loadProjectManifest } from '../config/project-manifest';
import { runRegistryGate } from './gate-runner';
import { validateStewardProof } from './steward-proof';
// Import for side-effect: registers the CAD gate plugin (domain tier) into the
// gate registry so a CAD step artifact is gated deterministically (Phase 1 #1).
import './cad-gate-plugin';
import { deriveBsyncSessionId, isCadTodo, bsyncSessionContextNote } from './bsync-session';
import { runLeaf, makeLeafExecutorDeps } from './leaf-executor';
import {
  breakerOpen,
  tripBreaker,
  enqueuePausedLeaf,
  pausedNodesSpent,
  pausedLeavesFor,
  breakerExhausted,
  recordResume,
  resetBreakerStreak,
} from './headless-breaker';
import { resolveProfile, resolveProvider, type AgentProfile } from '../config/agent-profiles';
import type { ProviderId } from '../agent/worker-agent';
import { resolveManifestPacks } from '../config/tech-packs';
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
  restoreBusySlot,
} from './worker-pool';
// PAW P1: route the worker spawn + pane-scrape liveness through the WorkerAgent
// registry (claude-only today). The pane detectors below are RE-EXPORTED from the
// Claude adapter — they were MOVED there (regexes byte-for-byte unchanged), and
// coordinator-live keeps re-exporting them so existing importers (fleet-status,
// tmux-reaper) and tests resolve them from here exactly as before.
import { resolveWorkerAgent, resolveGrokAgent, resolveAnthropicCoreAgent } from '../agent/registry';
import { getConfig } from './config-service';

/** Per-project opt-in for the in-process Claude worker (worker-core) vs the legacy
 *  `claude` CLI. Allowlist via CLAUDE_CORE_PROJECTS (comma-sep paths/basenames); the
 *  CLAUDE_IN_PROCESS=1 ENV var is a dev-only global override. Default off → CLI. */
function claudeInProcessEnabledFor(project: string): boolean {
  if (process.env.CLAUDE_IN_PROCESS === '1') return true;
  const list = getConfig('CLAUDE_CORE_PROJECTS', '') ?? '';
  if (!list.trim()) return false;
  const base = project.split('/').pop();
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((p) => p === project || p === base);
}
import {
  agentAliveInSubtree,
  CLAUDE_COMM_MATCHER,
  isClaudeTuiPresent,
  detectPermissionPrompt,
  extractRequestedTool,
} from '../agent/adapters/claude-code';

// Re-exports (back-compat): the canonical definitions now live in the Claude
// adapter; these keep `import { … } from './coordinator-live'` resolving unchanged.
// (isActivelyWorking / extractStallContext are consumed via the registry agent
// below — workerAgent.isActivelyWorking / .extractStallContext — not re-exported.)
export { isClaudeTuiPresent, detectPermissionPrompt, extractRequestedTool };

/** The single claude WorkerAgent (registry floor). Resolved once — stateless. */
const workerAgent = resolveWorkerAgent('claude');

/** PAW P3 dispatch record: the resolved { provider, model } a todo was dispatched
 *  with. In-memory (intentionally — like the pool registry, no DB), keyed by todo
 *  id, so the fleet read-model can surface which provider/model ran a lane without
 *  a todo-schema migration. DORMANT today: provider is always 'claude'. */
export interface DispatchRecord { provider: ProviderId; model?: string }
const dispatchByTodo = new Map<string, DispatchRecord>();
function recordDispatch(todoId: string, rec: DispatchRecord): void {
  dispatchByTodo.set(todoId, rec);
}
/** The dispatch's resolved provider/model for a todo, or undefined if none ran. */
export function getDispatch(todoId: string): DispatchRecord | undefined {
  return dispatchByTodo.get(todoId);
}

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
/** Daily worker-spend cap (design-worker-fabric-ui §7). WORKER_BUDGET_DAILY (USD) caps
 *  EACH project's spend since local midnight; 0/unset = no cap. Over budget → the
 *  project's claimable set is emptied for the rest of the day (workers already running
 *  finish) and ONE escalation is raised. In-memory idempotency keyed by project+date. */
const budgetEscalated = new Set<string>();
function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function overDailyBudget(project: string): boolean {
  const cap = Number(getConfig('WORKER_BUDGET_DAILY', '') || 0);
  if (!cap || cap <= 0) return false;
  let spent = 0;
  try { spent = summarizeLedger({ project, since: startOfTodayMs() }).totalUsd; } catch { return false; }
  if (spent < cap) return false;
  const key = `${project}:${new Date().toDateString()}`;
  if (!budgetEscalated.has(key)) {
    budgetEscalated.add(key);
    try {
      createEscalation({
        project,
        session: '',
        kind: 'blocker',
        todoId: '',
        questionText: `Daily worker budget reached for ${project}: spent $${spent.toFixed(2)} ≥ cap $${cap.toFixed(2)} since midnight. ` +
          `The coordinator has STOPPED claiming new work for this project today (running lanes finish). Raise WORKER_BUDGET_DAILY or wait for the daily reset.`,
      });
    } catch { /* escalation best-effort */ }
  }
  return true;
}

async function isTmuxAlive(tmux: string): Promise<boolean> {
  try {
    return (await execAsync(mux.cmd(argvHasSession(tmux)))).code === 0;
  } catch {
    // can't check → assume alive (don't reclaim on uncertainty; the lease still backstops).
    return true;
  }
}

/**
 * In-process lane liveness (worker-fabric bootstrap, design-worker-fabric-ui §6.7).
 * The grok-own / anthropic-core harnesses run the worker IN-PROCESS — there is NO
 * tmux session — so the tmux-based reapers (isTmuxAlive / laneConfirmedDead) read a
 * HEALTHY in-process worker as dead and reclaim its claim mid-recipe (the respawn-
 * backoff churn). Ask the harnesses directly: a session either harness reports alive
 * is a live in-process lane and must NOT be reaped on tmux absence. Dynamic import
 * keeps the coordinator↔registry↔adapter graph cycle-free (same pattern as the
 * worker-transcript route). Best-effort: any failure → false (fall back to the tmux
 * path), never throw into a reaper tick.
 */
async function inProcessLaneAlive(session: string): Promise<boolean> {
  try {
    const { getGrokHarnessForInspection, getAnthropicCoreHarnessForInspection } = await import('../agent/registry');
    return getGrokHarnessForInspection().isAlive(session) || getAnthropicCoreHarnessForInspection().isAlive(session);
  } catch {
    return false;
  }
}

/** Kill a tmux session by base name. Best-effort (no-op if absent). Used by the
 *  worker-isolation lifecycle to tear down a warm session whose worktree cwd was
 *  removed on merge-back (drop keep-warm, decision c4a8bf40). */
async function killTmuxSession(tmux: string): Promise<void> {
  try {
    await execAsync(mux.cmd(argvKillSession(tmux)));
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
export async function procSnapshot(): Promise<Map<number, { children: number[]; comm: string }> | null> {
  try {
    const out = (await execAsync(mux.cmd(argvPsComm()), { capture: true })).stdout;
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
export async function tmuxPanePid(tmux: string): Promise<number | null> {
  try {
    const out = (await execAsync(mux.cmd(argvListPanesPanePid(tmux)), { capture: true })).stdout;
    const first = out.split('\n').map((l) => l.trim()).filter(Boolean)[0];
    const n = Number(first);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Pure BFS: is a `claude` process anywhere in `rootPid`'s subtree, per the
 *  snapshot's child index? Exported for unit testing (no tmux/ps required). The
 *  generalized agentAliveInSubtree(root, snap, matcher) lives in the Claude
 *  adapter; this back-compat wrapper pins the `claude` matcher so existing callers
 *  (claudeProcessPresent, fleet-status, tmux-reaper) and tests are unchanged. */
export function claudeAliveInSubtree(rootPid: number, snap: Map<number, { children: number[]; comm: string }>): boolean {
  return agentAliveInSubtree(rootPid, snap, CLAUDE_COMM_MATCHER);
}

// --- P3 (fe153cdd): restart-reconcile the worker-pool registry ------------------
// The worker-pool registry (worker-pool.ts) is in-memory with no disk persistence,
// so a sidecar restart wipes it — yet the workers' tmux sessions survive (detached)
// and their claimed todos persist in SQLite (status=in_progress, sessionName=lane,
// targetProject). Without reconciliation the daemon would see an empty pool, spawn
// a DUPLICATE worker into an already-occupied lane, and never reap the orphaned
// live session. This rebuilds the busy slots from GROUND TRUTH on startup:
// mux.list() (the live sessions) ∩ the claimed in-progress todos. Also closes the
// pre-existing mac persistence gap, not just the Windows one.

/**
 * Rebuild busy pool slots from the live tmux sessions matched to claimed
 * in-progress todos. Idempotent and best-effort. Pass `projects` to scope it
 * (defaults to every orchestrator-tracked project). Returns the restored tmux
 * names. Run once at sidecar startup BEFORE the orchestrator's first build pass.
 */
export async function reconcileWorkerPoolFromLiveSessions(
  projects?: string[],
): Promise<{ restored: string[] }> {
  let live: Set<string>;
  try {
    live = new Set((await mux.list()).map((s) => s.name));
  } catch {
    return { restored: [] };
  }
  if (live.size === 0) return { restored: [] };

  const projectPaths = projects ?? listOrchestratorProjects().map((p) => p.project);
  const restored: string[] = [];
  for (const project of projectPaths) {
    let todos: Todo[];
    try {
      todos = listTodos(project, { status: 'in_progress' });
    } catch {
      continue;
    }
    for (const t of todos) {
      // Only lanes the daemon launched (a pool sessionName) map to a slot; an
      // interactive/role session has no slot and its name won't parse.
      if (!t.sessionName) continue;
      const targetProject = t.targetProject ?? project;
      const tmux = tmuxBaseName(targetProject, t.sessionName);
      if (!live.has(tmux)) continue; // worker died across the restart → leave for the reaper
      const slot = restoreBusySlot(targetProject, t.sessionName, t.id, tmux);
      if (slot) restored.push(tmux);
    }
  }
  if (restored.length > 0) {
    console.log(`[pool-reconcile] restored ${restored.length} busy slot(s) from live sessions: ${restored.join(', ')}`);
  }
  return { restored };
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

/** Dead-worker tracker (tmux → first-confirmed-dead + escalated), parallel to
 *  idleTracker. A dead shell is confirmed across DEAD_GRACE_MS so we never trip on
 *  the spawn/handoff gap before claude launches. */
const deadTracker = new Map<string, { since: number; escalated: boolean }>();
/** How long a worker's Claude must be confirmed-gone (tmux still alive) before we
 *  declare it dead. Long enough to clear cold-start; override MERMAID_DEAD_GRACE. */
const DEAD_GRACE_MS = (Number(process.env.MERMAID_DEAD_GRACE) || 45) * 1000;

/** Rate-limit tracker (tmux → first-seen + last-nudge + attempt count). A worker
 *  whose Claude hit a TRANSIENT server-side rate limit and stopped is recovered by
 *  nudging it to retry — distinct from a stall (it's not stuck on a decision) and
 *  from the user's usage cap (which is human-gated). Cleared once the pane clears. */
const rateLimitTracker = new Map<string, { firstSeen: number; lastNudge: number; attempts: number }>();
/** Wait this long after first seeing (or last nudging) a rate-limited worker before
 *  nudging it to retry — give Claude Code's own backoff a chance first. */
const RATE_LIMIT_NUDGE_MS = (Number(process.env.MERMAID_RATE_LIMIT_NUDGE_SEC) || 60) * 1000;
/** After this many nudges with the rate limit still showing, escalate (persistently
 *  throttled — a human may want to pause the fleet). */
const RATE_LIMIT_MAX_NUDGES = Number(process.env.MERMAID_RATE_LIMIT_MAX_NUDGES) || 5;

/** Resolved dead-worker grace (ms) the daemon actually uses. Read-only snapshot
 *  for observability (e.g. the runtime_config MCP tool). */
export function getDeadGraceMs(): number {
  return DEAD_GRACE_MS;
}

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
// PER-PROJECT cold-start counter (keyed by the lane's project). The cap applies
// per project so one busy project can't starve another project's cold-starts
// (the prior single module int meant project A at cap blocked project B). The cap
// (MAX_COLD_STARTS) itself stays per-project.
const coldStartsInFlightByProject = new Map<string, number>();
function coldStartsFor(project: string): number {
  return coldStartsInFlightByProject.get(project) ?? 0;
}
function incColdStarts(project: string): void {
  coldStartsInFlightByProject.set(project, coldStartsFor(project) + 1);
}
function decColdStarts(project: string): void {
  const next = coldStartsFor(project) - 1;
  if (next <= 0) coldStartsInFlightByProject.delete(project);
  else coldStartsInFlightByProject.set(project, next);
}

/** Live count of worker cold-starts currently in flight (capped per-project at
 *  MAX_COLD_STARTS). Pass a `project` for that project's count; omit it for the
 *  fleet-wide sum across all projects (the existing whole-fleet status readout).
 *  Read-only snapshot for observability (e.g. the orchestrator_status MCP tool). */
export function getColdStartsInFlight(project?: string): number {
  if (project != null) return coldStartsFor(project);
  let sum = 0;
  for (const n of coldStartsInFlightByProject.values()) sum += n;
  return sum;
}

/** Resolved cold-start concurrency cap the daemon actually uses. Read-only
 *  snapshot for observability (e.g. the runtime_config MCP tool). */
export function getMaxColdStarts(): number {
  return MAX_COLD_STARTS;
}

// --- DOGFOOD #6: idle-at-prompt stall detection ---------------------------------
// A worker can be ALIVE (tmux up, lease unexpired) yet silently stalled: it ended
// its turn sitting at the input prompt awaiting a human decision, without filing an
// escalation. reapDeadClaims only catches DEAD workers; this catches alive-but-idle
// ones and surfaces them as a structured escalation so they don't sit invisibly
// until lease-expiry.

/** Read a worker's rendered tmux pane (point-in-time). '' if unreadable. */
async function capturePane(tmux: string): Promise<string> {
  try {
    return (await execAsync(mux.cmd(argvCapturePane(tmux)), { capture: true })).stdout;
  } catch {
    return '';
  }
}

/** Detect a TRANSIENT Anthropic server-side rate limit in a worker's pane — the
 *  throttle Claude Code surfaces as e.g.:
 *    "API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited"
 *  This is recoverable: the coordinator waits a backoff then nudges the worker to
 *  retry (the worker doesn't realize it stopped, so the whole lane stalls).
 *
 *  Deliberately distinct from the user's USAGE CAP ("usage limit reached … resets
 *  at …"), which is genuinely human-gated and must NEVER be auto-nudged — note the
 *  transient message contains the phrase "not your usage limit", so we exclude only
 *  the cap-REACHED wording, not every mention of "usage limit". */
export function detectRateLimit(pane: string): boolean {
  // The human-gated usage cap — never auto-retry this.
  if (/usage limit reached|limit will reset|reached your (?:usage )?limit/i.test(pane)) return false;
  return /temporarily limiting requests/i.test(pane) || /\bRate limited\b/i.test(pane);
}

// (isActivelyWorking / extractStallContext / detectPermissionPrompt /
//  extractRequestedTool were MOVED to the Claude adapter — imported above with
//  regexes byte-for-byte unchanged. detectPermissionPrompt + extractRequestedTool
//  are re-exported for back-compat; isActivelyWorking + extractStallContext are
//  used internally below via the imported bindings.)

// --- Phase 1 (decision 9cd01858): durable per-lane staleness ---------------------
// The orphan/stall paths derive staleness from the DURABLE session_status pulse
// (session-status-store.updatedAt — a restart-safe SQLite clock) instead of an
// in-memory timer that a daemon restart wipes. This replaces the old in-memory
// `idleTracker` Map entirely: nothing to warm up on restart, and the orphan reaper
// collapses from a 15-min/​~9h grace to seconds via the two-fact rule (shouldPulseReap).

/** How long since a lane last pulsed before its session_status counts as stale for
 *  the two-fact reclaim. Override with MERMAID_PULSE_STALE_MS. */
const PULSE_STALE_MS = DEFAULT_PULSE_STALE_MS;

/** The lane's last DURABLE pulse (session_status.updatedAt, ms epoch), or null when
 *  none was ever recorded — the signal that the additive fast path must fall back to
 *  today's grace for this lane. Best-effort: any read error → null (→ fall back). */
function lanePulseAt(project: string, session: string | null): number | null {
  if (!session) return null;
  try { return getStatus(project, session)?.updatedAt ?? null; }
  catch { return null; }
}

/** Two-fact "not-alive" confirmation shared by the orphan reaper and the pool-slot
 *  reaper (point 3/5): a lane is confirmed dead when its tmux is gone, OR its tmux
 *  is alive but no `claude` process remains in its pane subtree (a bare dead shell).
 *  An UNKNOWN liveness (no ps snapshot / no pane pid) is treated as ALIVE — never
 *  reclaim on uncertainty. */
async function laneConfirmedDead(
  tmux: string,
  snap: Map<number, { children: number[]; comm: string }> | null,
): Promise<boolean> {
  if (!(await isTmuxAlive(tmux))) return true;            // tmux gone → dead
  const present = await claudeProcessPresent(tmux, snap); // ps-BFS over the pane subtree
  return present === false;                                // dead shell; null/true → alive
}

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
  // L1 (capability) × project-context (manifest profile): resolveProfile already
  // merges the global capability profile with the project's manifest profile
  // (allowedTools / contextPrompt / model / capability).
  const profile = resolveProfile(todo.type, project);
  const invokeSkill = `/mermaid-collab:worker ${todo.id}`;

  // L3 COMPOSITION (Profile L3): fold the project's DECLARED tech-packs (L2) onto
  // the L1+project-context profile — primary pack first. Each pack contributes
  // extra allowedTools (added to the surface) + a contextPrompt fragment (appended)
  // + an optional preferred model. Routing by primary pack → pool stays elsewhere;
  // here we only compose the EFFECTIVE launch config so a cad-primary todo launches
  // warm (capability × cad pack context/tools × build123d project-context).
  const { packs, primary } = project ? resolveManifestPacks(project) : { packs: [], primary: undefined };
  const ordered = primary ? [primary, ...packs.filter((p) => p.id !== primary.id)] : packs;
  if (ordered.length === 0) return { ...profile, invokeSkill };

  const allowedTools = mergeToolTokens(profile.allowedTools, ...ordered.map((p) => p.allowedTools));
  const contextPrompt =
    [profile.contextPrompt, ...ordered.map((p) => p.contextPrompt)].filter(Boolean).join('\n\n') || undefined;
  // Project/profile model wins (repo-specific); a pack's preferred model is the
  // fallback when the profile declares none.
  const model = profile.model ?? ordered.find((p) => p.model)?.model;
  return { ...profile, allowedTools, contextPrompt, model, invokeSkill };
}

/** Merge space-separated allowedTools token lists, de-duplicating while preserving
 *  first-seen order — so composing the base surface with pack fragments never
 *  repeats a tool token. */
function mergeToolTokens(...parts: Array<string | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    for (const tok of part.split(/\s+/)) {
      if (tok && !seen.has(tok)) { seen.add(tok); out.push(tok); }
    }
  }
  return out.join(' ');
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

/** True when the headless P2 leaf-executor is enabled via env flag. Default OFF
 *  ⇒ production behaviour is byte-identical (the legacy tmux launch path runs).
 *  Mirrors the workerIsolationEnabled / registry env-flag idiom. */
export function leafExecutorEnabled(): boolean {
  const v = (process.env.LEAF_EXECUTOR ?? 'off').trim().toLowerCase();
  return v === '1' || v === 'on' || v === 'true';
}

/** A leaf the headless executor may drive: a work todo with NO children (a leaf in
 *  the work-graph) that is not human-owned. Keeps gates/epics/human todos out of
 *  the executor (those go the legacy path). `project` is the tracking project. */
export function isHeadlessLeaf(todo: Todo, project: string): boolean {
  if (todo.assigneeKind === 'human') return false;
  if (/^\s*\[(EPIC|GATE)\]/i.test(todo.title ?? '')) return false;
  // Leaf = no child todos parented to it in the tracking work-graph.
  const hasChildren = listTodos(project, {}).some((t) => t.parentId === todo.id);
  return !hasChildren;
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

// --- FBPE P2: real per-epic resolution ------------------------------------------
// Each [EPIC] gets its OWN accumulation branch off master (collab/epic/<id8>);
// children of that epic accumulate on it. resolveEpicId walks a todo's parentId
// chain (via getTodo, in the TRACKING project where the work-graph lives) to the
// nearest [EPIC] ancestor and returns its id — the token epicBranchName hashes to
// the per-epic branch. A todo with no [EPIC] ancestor falls back to the synthetic
// single Inbox epic (INBOX_EPIC_ID) so every todo still maps to exactly one branch.
// Cycle- and depth-guarded against a malformed parent chain.

/** True when a todo's title marks it an [EPIC] root. */
function isEpicTodo(t: Todo): boolean {
  return /^\s*\[EPIC\]/i.test(t.title ?? '');
}

/** Resolve the [EPIC] root id for `todo` by walking parentId via getTodo in
 *  `project` (the tracking store). Returns INBOX_EPIC_ID when no [EPIC] ancestor
 *  exists. Exported for unit testing. */
export function resolveEpicId(todo: Todo, project: string): string {
  let cur: Todo | null | undefined = todo;
  const seen = new Set<string>();
  let depth = 0;
  while (cur && depth < 50) {
    if (isEpicTodo(cur)) return cur.id;
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    const parentId = cur.parentId;
    if (!parentId) break;
    cur = getTodo(project, parentId);
    depth++;
  }
  return INBOX_EPIC_ID;
}

/** FALSE-STALL GUARD (a6fcbd79): is a worker's todo already FINISHED — i.e. its
 *  change-set is committed on its epic's accumulation branch? A worker that has
 *  built + committed and is now idle at its prompt (completion handshake in
 *  flight) is byte-identical to a genuine stall, so the stall reaper would park
 *  the done leaf `blocked`. This probe lets detectStalls skip such a worker.
 *
 *  Returns false (NOT-finished → eligible for stall handling) when worker
 *  isolation is off, the project isn't a git repo, or any probe throws — the
 *  fail-safe direction keeps the existing wedge-recovery behaviour for a worker
 *  whose status we genuinely can't confirm. */
export async function workCommittedOnEpic(project: string, todo: Todo): Promise<boolean> {
  if (!workerIsolationEnabled()) return false;
  try {
    const wm = getWorktreeManager(todo.targetProject ?? project);
    if (!(await wm.isGitRepoPublic())) return false;
    const epicId = resolveEpicId(todo, project);
    return await wm.todoOnEpicBranch(epicId, todo.id);
  } catch {
    return false; // can't confirm → treat as not-finished (fail-safe)
  }
}

// --- BP0: reverse a phantom/stranded acceptance ---------------------------------
// The store marks a todo accepted BEFORE the lane→epic-branch merge runs, so a
// merge that integrates nothing (a clean worktree with no commit, or a lane whose
// commit never reached collab/epic/<id8>) leaves an `accepted` todo whose work is
// NOT on the branch — the exact stranding this bug is about. This undoes that:
//   1. the child todo → reset to 'ready' (acceptance + completion stamps cleared),
//      so it re-surfaces and a worker re-does/re-integrates it;
//   2. any epic the store rolled up off the back of THIS child → reset to
//      'in_progress' (an epic can't be done if a child just un-accepted); and
//   3. an escalation so a human sees the stranded acceptance was reversed.
// Best-effort and idempotent (resetTodo on an already-ready todo is a no-op-ish
// re-stamp); never throws back into the complete callback.
async function reopenStrandedAccept(
  project: string,
  todoId: string,
  epicId: string,
  rolledUp: string[],
  title: string,
  epicBranch: string,
  session: string,
): Promise<void> {
  try {
    await resetTodo(project, todoId, 'ready');
    for (const ep of rolledUp) {
      // Re-open epics the store closed assuming this child landed. 'in_progress'
      // keeps them out of the claimable pool (workers never claim epics) while
      // marking them not-done; they roll up again once the child truly integrates.
      await resetTodo(project, ep, 'in_progress').catch(() => {});
    }
    createEscalation({
      project,
      session,
      todoId,
      kind: 'assumption-invalidated',
      questionText: `Stranded acceptance reversed: todo "${title}" was marked done+accepted but its work never reached the epic branch ${epicBranch} (no commit, or a lane that never merged). It has been re-surfaced (status=ready) for re-integration${rolledUp.length ? `; ${rolledUp.length} prematurely-rolled-up epic(s) were re-opened` : ''}.`,
    });
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, bp0: 'stranded-accept-reversed', reopenedEpics: rolledUp }) });
  } catch (e) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, bp0: 'stranded-accept-reverse-failed', reason: e instanceof Error ? e.message : String(e) }) });
  }
}

// --- OI-1: accept-time ANCESTOR-OF-INTEGRATION gate -----------------------------
// Close the stranded-acceptance class: `accepted` must imply `reachable from the
// integration branch`, so accepted work can never silently fail to ship. This runs
// AT ACCEPT (once per leaf — never per-tick, so it can't flood escalations) after
// the worker→epic merge has succeeded:
//   1. probe whether the leaf's commit is already an ancestor of the integration
//      ref (the configured default branch, resolved dynamically — NOT hardcoded);
//   2. if not, attempt ONE idempotent epic→integration land reconcile (a no-op if
//      the epic already landed) so the accept path actually integrates the work
//      rather than leaving it stranded on the epic branch;
//   3. re-probe. If STILL not reachable → the work is genuinely stranded:
//      reverse the acceptance (reopenStrandedAccept resets the leaf to `ready` and
//      re-opens any prematurely-rolled-up epic) + escalate, instead of stamping a
//      false `accepted`.
// FAIL-SAFE: a null probe (non-git, isolation off, integration ref unresolvable,
// or no commit carrying the trailer) falls back to today's behaviour (accept) and
// is logged — uncertainty never hard-blocks. Returns true when the leaf is safe to
// remain accepted, false when its acceptance was reversed. Best-effort; the caller
// catches throws and treats them as fail-safe (accept).
export async function acceptTimeAncestorGate(
  project: string,
  todoId: string,
  epicId: string,
  rolledUp: string[],
  title: string,
  session: string,
): Promise<boolean> {
  // OI-1/BUILD MISMATCH FIX: the master-reachability gate (and its acceptance
  // reversal) only makes sense where the daemon AUTO-LANDS the epic to master —
  // i.e. at `drive`. At build/nudge there is NO auto-land, so accepted work
  // legitimately lives on the epic/lane branch and never reaches origin/master;
  // reversing acceptance for that re-surfaces the todo `ready` → it is re-claimed
  // and re-built forever (the infinite re-claim loop behind escalation 0ca77927,
  // reproduced live by the grok-build trial). Empty/hallucinated completions are
  // STILL caught independently by resolveCompletion's work-committed re-verify, so
  // skipping the master gate below `drive` never lets fake work through.
  if (levelRank(getOrchestratorLevel(project)) < levelRank('drive')) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, oi1: 'skip-below-drive-accept' }) });
    return true;
  }
  const targetProject = (getTodo(project, todoId)?.targetProject) ?? project;
  const wm = getWorktreeManager(targetProject);
  if (!(await wm.isGitRepoPublic())) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, oi1: 'skip-non-git' }) });
    return true; // fail-safe: not a git repo → today's behaviour.
  }
  const intRef = await wm.resolveIntegrationRef();
  if (!intRef) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, oi1: 'skip-no-integration-ref' }) });
    return true; // fail-safe: can't resolve integration → don't hard-block.
  }

  // 1. first probe.
  let reachable = await wm.commitOnIntegration(epicId, todoId, intRef);
  if (reachable === null) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, intRef, oi1: 'indeterminate-accept' }) });
    return true; // fail-safe: indeterminate (no commit / git error) → accept.
  }
  if (reachable === true) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, intRef, oi1: 'reachable-accept' }) });
    return true;
  }

  // 2. NOT reachable yet — one-shot idempotent epic→integration land reconcile.
  // landEpicToMaster is a no-op when nothing is ahead (already up to date); a
  // conflict leaves integration untouched and we fall through to reversal below.
  try {
    const land = await wm.landEpicToMaster(epicId, { baseRef: intRef });
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, intRef, oi1: 'land-reconcile', landed: land.landed, conflict: land.conflict, reason: land.reason }) });
  } catch (e) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, intRef, oi1: 'land-reconcile-error', reason: e instanceof Error ? e.message : String(e) }) });
  }

  // 3. re-probe after the reconcile attempt.
  reachable = await wm.commitOnIntegration(epicId, todoId, intRef);
  if (reachable === true) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, intRef, oi1: 'reachable-after-land' }) });
    return true;
  }
  if (reachable === null) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, intRef, oi1: 'indeterminate-after-land-accept' }) });
    return true; // fail-safe.
  }

  // Genuinely stranded → reverse the premature acceptance instead of stamping a
  // false `accepted`. reopenStrandedAccept resets the leaf to `ready` (actionable)
  // and raises an escalation; we annotate the reason as integration-unreachable.
  await reopenStrandedAccept(project, todoId, epicId, rolledUp, title, intRef, session);
  recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, intRef, oi1: 'reversed-not-on-integration' }) });
  return false;
}

// --- BP1: block a dependent whose foundation is accepted-but-stranded -----------
// The dual of OI-1's accept-time gate. depSatisfied keys only on a dep's
// status==='done', so a dependent can go 'ready' off a foundation that was marked
// done+accepted but whose commit never reached the integration branch (a pre-fix
// strand). Building on that phantom foundation produces broken/duplicated work.
// This is a PURE claim-time FILTER (composed into claimGuard — no status write):
// drop any ready todo that has a `done` dependency whose commit is provably NOT an
// ancestor of integration (commitOnIntegration === false). The dependent simply
// isn't claimed THIS tick; once OI-1's accept-time gate (or a human) re-integrates
// the foundation, commitOnIntegration flips to true and the dependent flows again.
// FAIL-SAFE: a true/null probe (reachable, or indeterminate / non-git / no
// integration ref / no commit) is treated as satisfied — uncertainty never blocks.
export async function bp1FilterStrandedFoundations(project: string, todos: Todo[]): Promise<Todo[]> {
  if (todos.length === 0) return todos;
  const out: Todo[] = [];
  for (const t of todos) {
    let foundationStranded = false;
    for (const depId of t.dependsOn ?? []) {
      const dep = getTodo(project, depId);
      // Only a DONE dep can be a (claimed-as-satisfied) foundation; a not-done dep
      // already excludes the dependent via depSatisfied, so it's not our concern.
      if (!dep || dep.status !== 'done') continue;
      try {
        const wm = getWorktreeManager(dep.targetProject ?? project);
        if (!(await wm.isGitRepoPublic())) continue; // fail-safe: non-git → satisfied
        const intRef = await wm.resolveIntegrationRef();
        if (!intRef) continue; // fail-safe: unresolvable integration → satisfied
        const reachable = await wm.commitOnIntegration(resolveEpicId(dep, project), depId, intRef);
        if (reachable === false) {
          foundationStranded = true;
          recordSupervisorAudit({ kind: 'reconcile', project, session: '', detail: JSON.stringify({ todoId: t.id, depId, intRef, bp1: 'blocked-stranded-foundation' }) });
          break;
        }
      } catch {
        // probe error → fail-safe: treat this dep as satisfied (don't block).
      }
    }
    if (!foundationStranded) out.push(t);
  }
  return out;
}

// --- BP0: sweep already-stranded accepted todos ---------------------------------
// A repair pass (Part 3 of the fix): scan the work-graph for leaf todos that are
// done+accepted but whose work is NOT reachable from their epic branch (the
// pre-fix damage — already-accepted todos whose commits stranded on lane branches,
// or that were accepted with no commit at all). Raise ONE summary escalation per
// project so a human can re-integrate or re-open them. Read-only w.r.t. the
// work-graph (it FLAGS, it does not silently re-open — the acceptance was a
// human-visible event, so its reversal should be too). Returns the flagged ids.
//
// REDESIGN (post-flood, 2026-06-11): the original raised ONE escalation PER stranded
// todo on EVERY 30s reconcile tick. Combined with step-4 of the reconcile pass
// (which auto-closes escalations whose linked todo terminally settled — and a
// stranded todo IS done+accepted), this formed an unbounded generator: 3b creates,
// 4 closes, 3b re-creates next tick → 2200+ escalations in minutes. The redesign:
//   1. THROTTLE to once per project per BP0_SWEEP_INTERVAL_MS (≈once/hour; also a
//      one-shot on process start since the map starts empty), NOT every tick.
//   2. ONE SUMMARY escalation per project (not one-per-todo), ids in the detail.
//   3. The summary carries NO todoId and a dedicated kind → step-4 settled-todo
//      auto-close never touches it (it requires a todoId AND now explicitly excludes
//      this kind), so it is not resolved-then-recreated.
//   4. Stable questionText + sentinel session → createEscalation's
//      (project,session,questionText) dedup keeps it to ONE open card per project.
//   5. Git reachability work is bounded per pass (BP0_MAX_GIT_CHECKS).

/** Throttle window: a project's stranded sweep runs at most once per this interval. */
export const BP0_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
/** Max git reachability checks per pass — bounds the per-tick git cost (was 2000+). */
export const BP0_MAX_GIT_CHECKS = 200;
/** Dedicated kind marking the per-project stranded-accept SUMMARY escalation. The
 *  reconcile step-4 settled-todo auto-close explicitly excludes this kind so the
 *  summary is never resolved-then-recreated. */
export const BP0_STRANDED_SUMMARY_KIND = 'bp0-stranded-summary';
/** Sentinel session owning the single per-project summary escalation (keeps the
 *  createEscalation (project,session,questionText) dedup stable across ticks). */
export const BP0_SUMMARY_SESSION = 'bp0-stranded';

/** module-level last-sweep-time per project (key = tracking project root). */
const lastBp0SweepAt = new Map<string, number>();

/** Exported for tests: reset the throttle so the next sweep runs immediately. */
export function _resetBp0SweepState(): void {
  lastBp0SweepAt.clear();
}

export async function sweepStrandedAccepted(
  project: string,
  opts?: { force?: boolean; now?: number },
): Promise<string[]> {
  const now = opts?.now ?? Date.now();
  // THROTTLE: skip if this project was swept within the interval (one-shot on a
  // cold map). `force` is for tests / explicit one-off invocations.
  const last = lastBp0SweepAt.get(project) ?? 0;
  if (!opts?.force && now - last < BP0_SWEEP_INTERVAL_MS) return [];
  lastBp0SweepAt.set(project, now);

  const flagged: string[] = [];
  const all = listTodos(project, { includeCompleted: true });
  const isEpic = (t: Todo) => all.some((c) => c.parentId === t.id);
  let gitChecks = 0;
  let truncated = false;
  for (const t of all) {
    // Only leaf work todos that claim to be accepted+done can be stranded.
    if (t.status !== 'done' || t.acceptanceStatus !== 'accepted') continue;
    if (isEpic(t)) continue; // epics carry no commit of their own
    // BOUND the git work: stop checking once we hit the per-pass cap. Remaining
    // stranded todos (if any) are surfaced next pass; the summary notes truncation.
    if (gitChecks >= BP0_MAX_GIT_CHECKS) { truncated = true; break; }
    try {
      const wm = getWorktreeManager(t.targetProject ?? project);
      if (!(await wm.isGitRepoPublic())) continue;
      const epicId = resolveEpicId(t, project);
      gitChecks++;
      if (await wm.todoOnEpicBranch(epicId, t.id)) continue; // work is on the branch — fine
      flagged.push(t.id);
    } catch { /* a single bad todo never aborts the sweep */ }
  }
  if (flagged.length > 0) {
    const detail = `${flagged.length} stranded acceptance(s)${truncated ? ` (truncated at ${BP0_MAX_GIT_CHECKS} git checks this pass — more may remain, re-run next pass)` : ''}. Flagged todo ids: ${flagged.join(', ')}.`;
    // ONE summary escalation per project. NO todoId (so the step-4 settled-todo
    // auto-close — which keys on todoId — never resolves it) and a stable
    // questionText (NO count) so the open-card dedup holds it to one per project.
    createEscalation({
      project,
      session: BP0_SUMMARY_SESSION,
      kind: BP0_STRANDED_SUMMARY_KIND,
      questionText:
        'Stranded acceptances detected in this project: one or more todos are marked done+accepted but their work is NOT on the epic branch (commit stranded on a lane branch, or accepted with no commit). Re-integrate the lane branches onto their epic branch, or re-open the todos. Current flagged ids are in this card and in the supervisor audit (bp0: stranded-accept-sweep).',
      options: [{ id: 'review', label: 'Review flagged todos', detail }],
    });
    recordSupervisorAudit({ kind: 'reconcile', project, session: '', detail: JSON.stringify({ bp0: 'stranded-accept-sweep', flagged, truncated }) });
  }
  return flagged;
}

// --- FBPE P5: cross-repo epics --------------------------------------------------
// An epic whose children span repos gets ONE accumulation branch PER target repo
// (git can't merge across repos), so the land surface raises one card per repo and
// each repo lands independently. Partition the epic's children by their resolved
// target repo. A child with NO targetProject is assigned to the tracking project,
// UNLESS the epic is genuinely cross-repo (≥1 child targets a foreign repo) — then
// that orphan can't be confidently placed and is reported `ambiguous` so the caller
// escalates a decision rather than guessing which repo's branch it should land on.
export interface EpicRepoPartition {
  /** target repo root → ids of the epic's children that land in that repo. */
  byRepo: Map<string, string[]>;
  /** child ids with no targetProject in a cross-repo epic — unplaceable. */
  ambiguous: string[];
}

/** Partition an epic's direct children by the repo their branch lands in. Exported
 *  for unit testing. */
export function partitionEpicChildrenByRepo(
  children: Todo[],
  trackingProject: string,
): EpicRepoPartition {
  const explicitRepos = new Set<string>();
  for (const c of children) if (c.targetProject) explicitRepos.add(c.targetProject);
  // Genuinely cross-repo iff some child targets a repo other than the tracking one.
  const hasForeignRepo = [...explicitRepos].some((p) => p !== trackingProject);
  const byRepo = new Map<string, string[]>();
  const ambiguous: string[] = [];
  const push = (repo: string, id: string) => {
    const arr = byRepo.get(repo);
    if (arr) arr.push(id);
    else byRepo.set(repo, [id]);
  };
  for (const c of children) {
    if (c.targetProject) {
      push(c.targetProject, c.id);
    } else if (hasForeignRepo) {
      ambiguous.push(c.id); // can't place a repo-less child once repos diverge.
    } else {
      push(trackingProject, c.id);
    }
  }
  return { byRepo, ambiguous };
}

// --- FBPE P4: the land click — human-gated epic→master land ---------------------
// Per-project land mutex: concurrent LAND clicks for the same target repo must not
// race two merges into master. Each land chains onto the previous one for that
// project so they serialise; the chain is fault-tolerant (a failed/throwing land
// does not wedge the next click).
const landChains = new Map<string, Promise<unknown>>();
function withLandMutex<T>(project: string, fn: () => Promise<T>): Promise<T> {
  const prev = landChains.get(project) ?? Promise.resolve();
  // Run fn whether the previous land resolved or rejected (serialise, don't wedge).
  const next = prev.then(fn, fn);
  landChains.set(project, next.then(() => {}, () => {}));
  return next;
}

export interface LandEpicOutcome {
  ok: boolean;
  landed: boolean;
  conflict?: boolean;
  reason: string;
  epicId?: string;
  epicBranch?: string;
  masterSha?: string;
}

/**
 * Surface (and, at level>=drive, AUTO-LAND) the epic-ready-to-land card(s) for a
 * rolled-up epic. Extracted from completeTodo so the reconcile-pass sweep can call
 * the IDENTICAL logic every tick — making the land surface SELF-HEALING (it catches
 * epics that rolled up out-of-band, the exact stranded-work incident). Best-effort;
 * never throws. createEscalation dedups on (project,session,questionText,open) so a
 * stable card is not re-raised every tick.
 *
 * AUTO-LAND (design-epic-landing P2): on a GREEN proof at level>=drive it calls the
 * existing landEpic — which re-derives the proof, lands behind the per-project mutex,
 * and on conflict leaves master UNTOUCHED + re-surfaces a rebase card. Dormant at the
 * default 'build' level: landing only happens automatically once a human sets the
 * project to 'drive'. Red proof or level<drive → the card just surfaces (human lands).
 */
export async function surfaceEpicLand(
  project: string,
  epicId: string,
  opts: { sessionHint?: string; preferLinkTodoId?: string } = {},
): Promise<void> {
  const session = opts.sessionHint || 'coordinator';
  const id = opts.preferLinkTodoId;
  const autoLand = levelRank(getOrchestratorLevel(project)) >= levelRank('drive');
  try {
    const children = listTodos(project, { includeCompleted: true })
      .filter((t) => t.parentId === epicId && t.status !== 'dropped');
    const { byRepo, ambiguous } = partitionEpicChildrenByRepo(children, project);

    // Can't cleanly partition (cross-repo epic with repo-less children) → escalate a
    // decision instead of guessing which repo's branch to land. Never auto-landed.
    if (ambiguous.length > 0) {
      const repos = [...byRepo.keys()];
      createEscalation({
        project,
        session,
        todoId: id ?? null,
        kind: 'decision',
        questionText: `Epic ${epicId.slice(0, 8)} spans repos ${repos.map((p) => path.basename(p)).join(', ')}, but ${ambiguous.length} child todo(s) have no targetProject so they can't be assigned to a repo to land. Assign a targetProject to each, then re-land.`,
        options: [
          { id: 'tracking', label: `Treat as ${path.basename(project)}`, detail: `Land the orphan child(ren) with the tracking repo ${project}.` },
          { id: 'fix', label: 'Assign targetProject manually', detail: 'Set each orphan child\'s targetProject, then re-trigger the land surface.' },
        ],
        recommended: 'fix',
      });
      recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, epicId, landSurface: 'ambiguous-partition', ambiguous: ambiguous.length, repos }) });
      return;
    }

    const multiRepo = byRepo.size > 1;
    for (const [repo, repoChildIds] of byRepo) {
      const wm = getWorktreeManager(repo);
      const epicBranch = wm.epicBranchName(epicId);
      // The worktree-cwd seam: tsc runs in the epic's accumulation worktree; the
      // dry-merge runs in this repo's master checkout. Store-truth proof is scoped
      // to THIS repo's children only (per-repo gate).
      const epic = await wm.ensureEpic(epicId).catch(() => null);
      const verdict = validateStewardProof(
        'land_epic',
        { kind: 'epic-landable', epicId, epicBranch },
        {
          project,
          dependsOn: [],
          getDep: (cid) => {
            const d = getTodo(project, cid);
            return d ? { id: d.id, status: d.status, acceptanceStatus: d.acceptanceStatus } : null;
          },
          epicChildIds: repoChildIds,
          epicWorktreeCwd: epic?.path ?? repo,
          masterCwd: repo,
        },
      );
      // Staleness FLAG (never auto-rebase): how far behind master the epic base drifted.
      const behind = await wm.epicBehindBase(epicId).catch(() => 0);
      const staleFlag = behind > 0 ? ` ⚠️ ${behind} commit(s) behind master (flag only — no auto-rebase)` : '';
      const repoTag = multiRepo ? ` [repo ${path.basename(repo)}]` : '';
      const proofSummary = verdict.ok
        ? `✅ epic-landable: ${repoChildIds.length} children done+accepted, tsc clean, dry-merge into master clean`
        : `❌ blocked (${verdict.reason}): epic ${epicBranch} is NOT ready to land`;
      // Link a child IN THIS REPO so the land click resolves the right repo
      // (landEpic keys the WorktreeManager off the linked todo's targetProject).
      const linkTodoId = (id && repoChildIds.includes(id)) ? id : (repoChildIds[0] ?? id ?? null);
      const { escalation } = createEscalation({
        project,
        session,
        todoId: linkTodoId,
        kind: 'epic-ready-to-land',
        questionText: `Epic ${epicBranch} (${epicId.slice(0, 8)})${repoTag} rolled up. ${proofSummary}${staleFlag}. Land onto master? (read-only surface — master untouched)`,
      });
      recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: linkTodoId, epicId, epicBranch, repo, landable: verdict.ok, reason: verdict.reason, children: repoChildIds.length, behindMaster: behind, multiRepo, autoLand }) });

      // AUTO-LAND at level>=drive on a green proof — reuse the safe landEpic path
      // (re-derives the proof, lands behind the mutex, conflict→rebase card). The
      // dedup above ensures we don't re-fire on an already-open card.
      if (verdict.ok && autoLand && escalation?.id) {
        const outcome = await landEpic(project, escalation.id);
        recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ epicId, epicBranch, autoLand: true, landed: outcome.landed, conflict: outcome.conflict ?? false, reason: outcome.reason }) });
      }
    }
  } catch (e) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ epicId, landSurface: 'failed', reason: e instanceof Error ? e.message : String(e), preferLinkTodoId: id }) });
  }
}

/**
 * The land click (FBPE P4). Given an open 'epic-ready-to-land' escalation, RE-DERIVE
 * land-readiness server-side at click time (never trust the summary baked into the
 * card at roll-up) and, on a green proof, perform ONE --no-ff epic→master merge behind
 * the per-project land mutex, then remove the epic branch/worktree and resolve the
 * card. A conflict leaves master UNTOUCHED and re-surfaces a 'needs human rebase, then
 * re-land' escalation (the original card stays open).
 */
export async function landEpic(project: string, escalationId: string): Promise<LandEpicOutcome> {
  const esc = getEscalation(escalationId);
  if (!esc) return { ok: false, landed: false, reason: 'escalation-not-found' };
  if (esc.kind !== 'epic-ready-to-land') return { ok: false, landed: false, reason: 'not-a-land-escalation' };
  const todoId = esc.todoId;
  if (!todoId) return { ok: false, landed: false, reason: 'no-todo-link' };
  const child = getTodo(project, todoId);
  if (!child) return { ok: false, landed: false, reason: 'todo-not-found' };
  const targetProject = child.targetProject ?? project;
  const epicId = resolveEpicId(child, project);
  const wm = getWorktreeManager(targetProject);
  const epicBranch = wm.epicBranchName(epicId);

  return withLandMutex(targetProject, async (): Promise<LandEpicOutcome> => {
    try {
      // RE-DERIVE the land_epic proof from ground truth: every epic child done+accepted
      // in the store; tsc clean IN the epic's accumulation worktree; the epic branch
      // dry-merges cleanly into a master checkout. The click NEVER trusts the summary.
      // FBPE P5: scope the store-truth check to THIS repo's children — a cross-repo
      // epic lands per-repo, so one repo's land must not depend on a sibling repo's
      // children (each repo's branch is gated + landed independently).
      const epicChildren = listTodos(project, { includeCompleted: true })
        .filter((t) => t.parentId === epicId && t.status !== 'dropped');
      const { byRepo } = partitionEpicChildrenByRepo(epicChildren, project);
      const epicChildIds = byRepo.get(targetProject) ?? epicChildren.map((t) => t.id);
      const epic = await wm.ensureEpic(epicId).catch(() => null);
      const verdict = validateStewardProof(
        'land_epic',
        { kind: 'epic-landable', epicId, epicBranch },
        {
          project,
          dependsOn: [],
          getDep: (cid) => {
            const d = getTodo(project, cid);
            return d ? { id: d.id, status: d.status, acceptanceStatus: d.acceptanceStatus } : null;
          },
          epicChildIds,
          epicWorktreeCwd: epic?.path ?? targetProject,
          masterCwd: targetProject,
        },
      );
      if (!verdict.ok) {
        recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, land: 'rejected', reason: verdict.reason }) });
        return { ok: false, landed: false, reason: verdict.reason, epicId, epicBranch };
      }

      // Green proof → perform the real single --no-ff epic→master merge.
      const land = await wm.landEpicToMaster(epicId);
      if (land.conflict) {
        // Master untouched. Re-surface as a human-rebase request; the ready-to-land
        // card stays open so the human can re-land after resolving.
        createEscalation({
          project,
          session: esc.session,
          todoId,
          kind: 'assumption-invalidated',
          questionText: `Land conflict: epic ${epicBranch} did not merge cleanly into master (master untouched). Rebase ${epicBranch} onto master, resolve conflicts, then re-land.`,
        });
        recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, land: 'conflict' }) });
        return { ok: false, landed: false, conflict: true, reason: 'epic-merge-conflict', epicId, epicBranch };
      }
      if (!land.landed) {
        recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, land: 'failed', reason: land.reason }) });
        return { ok: false, landed: false, reason: land.reason ?? 'land-failed', epicId, epicBranch };
      }

      // Landed — remove the epic branch + worktree (gated on land success), resolve the card.
      await wm.removeEpic(epicId, targetProject).catch(() => {});
      resolveEscalation(escalationId, 'resolved', 'ai');
      recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, land: 'landed', masterSha: land.masterSha }) });
      return { ok: true, landed: true, reason: 'ok', epicId, epicBranch, masterSha: land.masterSha };
    } catch (e) {
      recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, land: 'error', reason: e instanceof Error ? e.message : String(e) }) });
      return { ok: false, landed: false, reason: e instanceof Error ? e.message : String(e), epicId, epicBranch };
    }
  });
}

/** Wire the Coordinator daemon to the real todo-store + a live worker launcher. */
export function makeCoordinatorDeps(): CoordinatorDeps {
  return {
    // Push daemon-driven todo-status changes to the UI (the Bridge otherwise only
    // hears session_todos_updated from MCP tool calls, so a server-side block/reclaim
    // left a stale in-flight card). Best-effort; never throws.
    notifyTodosChanged: (project: string) => {
      try { getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' } as any); }
      catch { /* broadcast is best-effort */ }
    },
    listReadyTodos,
    // Readiness-gates P4: claim-time liveness probe filter. A todo carrying a
    // `claimProbe` (e.g. 'tcp://127.0.0.1:8082') is held out of the claimable set
    // while its env service is down, and auto-claimed once the probe passes — no
    // status write, no human completing a [GATE].
    // Two pure claim-time filters, composed: (1) readiness-gates P4 liveness probe
    // (hold a claimProbe todo while its env is down), then (2) BP1 — drop a
    // dependent whose foundation is accepted-but-stranded off integration. Neither
    // writes status; a held-back todo is just not claimed this tick.
    claimGuard: async (project, todos) => {
      // Budget gate first: over the daily cap → claim nothing for this project today.
      if (overDailyBudget(project)) return [];
      let claimable = await bp1FilterStrandedFoundations(project, await filterClaimable(todos));
      // P3 headless circuit-breaker: while the per-process cap window is open, hold
      // HEADLESS leaves out of the claimable set (mirrors the probe-gate filter
      // above). This avoids the claim→release spin a launch-time gate alone would
      // cause. tmux/legacy lanes are untouched — only node-invoker spawns are gated.
      if (breakerOpen()) {
        claimable = claimable.filter(
          (t) => !(leafExecutorEnabled() && isHeadlessLeaf(t, project)),
        );
      }
      return claimable;
    },
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
      // The slot lives in the project the worker's tmux/worktree ran in
      // (targetProject for cross-project todos, else the tracking project).
      const slotProject = r.completed.targetProject ?? project;
      if (session) markIdle(slotProject, session);
      recordSupervisorAudit({ kind: 'complete', project, session, detail: JSON.stringify({ todoId: id, acceptance: acceptance ?? r.completed.acceptanceStatus, promoted: r.promoted, rolledUp: r.rolledUp }) });
      // Escalation lifecycle: a todo that completes (accepted) may have left an
      // OPEN escalation behind — e.g. it exhausted its retry budget, the
      // coordinator filed a 'blocker', and it later recovered (human decision +
      // reclaim) and finished. Auto-resolve those so the inbox doesn't keep
      // phantom 'exhausted retry budget' entries. Match by exact todoId and by
      // the worker/pool session names this todo ran under.
      const accepted = (acceptance ?? r.completed.acceptanceStatus) === 'accepted';
      // DOGFOOD #5 isolation: on acceptance, commit the worker's worktree and
      // merge its branch back into its EPIC's accumulation branch (FBPE P2 — each
      // [EPIC] has its own collab/epic/<id8> off master). A conflict leaves the
      // epic branch untouched and is escalated for a human to resolve. The merge
      // commit carries Collab-Epic/Collab-Todo trailers (commitAndMergeToEpic).
      if (accepted && workerIsolationEnabled() && session) {
        const targetProject = r.completed.targetProject ?? project;
        try {
          const wm = getWorktreeManager(targetProject);
          // Walk the parent chain in the TRACKING project (where the work-graph lives).
          const epicId = resolveEpicId(r.completed, project);
          const message = `collab(${id.slice(0, 8)}): ${r.completed.title}`.slice(0, 200);
          // IDEMPOTENT merge-back: the LEAF-EXECUTOR self-merges its lane onto the epic
          // branch in runLeaf (before proposing acceptance), so by accept-time the work is
          // ALREADY integrated. Re-running commitAndMergeToEpic on that already-merged lane
          // can report a spurious conflict and wrongly park the (correctly-accepted) todo
          // BLOCKED. If the todo's commit is already on the epic branch, the merge is done —
          // synthesize a clean integrated result and skip the re-merge. The legacy tmux lane
          // is NOT yet on the branch at accept-time, so it still merges here as before.
          const alreadyOnEpic = await wm.todoOnEpicBranch(epicId, id).catch(() => false);
          const merge = alreadyOnEpic
            ? { merged: true, conflict: false, committed: false, integrated: true, workerBranch: '', epicBranch: wm.epicBranchName(epicId) }
            : await wm.commitAndMergeToEpic(session, epicId, { message, todoId: id });
          recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, epicId, isolation: 'merge-back', merged: merge.merged, conflict: merge.conflict, committed: merge.committed, branch: merge.workerBranch }) });
          if (merge.conflict) {
            // DEFECT 2 — a conflicted merge-back must NOT leave the todo accepted.
            // Reverse the premature accept by PARKING the todo BLOCKED (a conflict
            // needs a human to integrate the branch — not an auto-rebuild, so we do
            // NOT reset it to `ready`). Clear the acceptance/completion the store
            // stamped (mirrors reopenStrandedAccept's field-clearing, but blocked).
            try {
              await updateTodo(project, id, { status: 'blocked', completed: false, acceptanceStatus: null });
            } catch (e) {
              recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, epicId, conflict: 'park-blocked-failed', reason: e instanceof Error ? e.message : String(e) }) });
            }
            createEscalation({
              project,
              session,
              todoId: id,
              kind: 'assumption-invalidated',
              questionText: `Worker-isolation merge conflict: branch ${merge.workerBranch} could not merge into ${merge.epicBranch} for todo "${r.completed.title}". Resolve the conflict manually, then merge the branch into ${merge.epicBranch}.`,
            });
            // DEFECT 3 — tear down the lane worktree so it can NEVER be reused stale
            // (a surviving worktree feeds the cached-reuse bug). `git worktree
            // remove` deletes only the worktree DIR — the worker's branch survives,
            // so the human's commit is preserved for manual integration.
            await wm.remove(session).catch(() => {});
            try { await killTmuxSession(tmuxBaseName(targetProject, session)); } catch { /* best-effort teardown */ }
            removeSlot(targetProject, session);
            recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, epicId, conflict: 'parked-blocked-teardown' }) });
          } else if (!merge.integrated) {
            // BP0 INVARIANT: the merge reported success but the todo's work is NOT
            // on the epic branch (PHANTOM: a clean worktree with no commit; or a
            // lane whose commit never reached collab/epic/<id8>). `accepted` must
            // NOT survive that — the upstream guarantee is accepted ⇒ work-on-branch.
            // Reverse the premature acceptance: re-surface this todo (and any epic
            // the store just rolled up off the back of this child) and escalate.
            await reopenStrandedAccept(project, id, epicId, r.rolledUp, r.completed.title, merge.epicBranch, session);
          } else {
            // OI-1 ACCEPT-TIME ANCESTOR GATE: the worker→epic merge succeeded, but
            // `accepted` must imply `reachable from the integration branch`, not
            // merely `on the epic branch`. Verify the leaf's commit is an ancestor
            // of the integration ref (one-shot epic→integration land reconcile if
            // not); if it's genuinely stranded, REVERSE the acceptance (keep the
            // leaf actionable) rather than tearing down its worktree on a false
            // accept. Only proceed with teardown when the leaf is confirmed-safe
            // (or fail-safe: indeterminate/non-git → accept). Best-effort.
            let safe = true;
            try {
              safe = await acceptTimeAncestorGate(project, id, epicId, r.rolledUp, r.completed.title, session);
            } catch (e) {
              // Gate threw → fail-safe to accept (today's behaviour), but log it.
              recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, epicId, oi1: 'gate-error-failsafe-accept', reason: e instanceof Error ? e.message : String(e) }) });
            }
            if (!safe) {
              // Acceptance reversed: leaf is back to `ready`. Leave its worktree in
              // place so the re-surfaced leaf / human can re-integrate the work
              // rather than losing it to teardown.
              return r;
            }
            // Merge succeeded — the worktree branch is now in integration. Remove
            // the worktree so the next todo for this pool lane gets a fresh one
            // branched off the latest integration (sees this merge).
            await wm.remove(session).catch(() => {});
            // DROP keep-warm (decision c4a8bf40): the worktree is now gone, so the
            // warm session's cwd is a deleted dir. Kill its tmux session and drop
            // the pool slot so the next todo spawns a FRESH session in a FRESH
            // worktree instead of reusing a bare-shell session.
            try { await killTmuxSession(tmuxBaseName(targetProject, session)); } catch { /* best-effort teardown */ }
            removeSlot(targetProject, session);
          }
        } catch (e) {
          // BP0 + abb4fd7e (unioned): the merge-back THREW, so the work almost
          // certainly never reached the epic branch — yet the store already marked the
          // todo accepted. Verify; if genuinely stranded, REVERSE the acceptance
          // (reopenStrandedAccept) AND raise an escalation so a human integrates the
          // orphaned session branch rather than discovering it via `git log --all`.
          const reason = e instanceof Error ? e.message : String(e);
          const errTargetProject = r.completed.targetProject ?? project;
          recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, isolation: 'merge-back-failed', reason }) });
          try {
            const wm = getWorktreeManager(errTargetProject);
            const epicId = resolveEpicId(r.completed, project);
            if (!(await wm.todoOnEpicBranch(epicId, id))) {
              await reopenStrandedAccept(project, id, epicId, r.rolledUp, r.completed.title, wm.epicBranchName(epicId), session);
              try {
                createEscalation({
                  project,
                  session,
                  todoId: id,
                  kind: 'assumption-invalidated',
                  questionText: `Stranded leaf: todo "${r.completed.title}" was accepted but its commit was NOT integrated onto its epic branch (merge-back failed: ${reason}). The work lives only on the worker's session branch — integrate it manually onto the epic branch, then it will land with the epic.`,
                });
              } catch { /* best-effort: never let escalation failure mask the accept */ }
              // DEFECT 3 — an errored lane must also be torn down so its worktree
              // can't be reused stale. The branch survives `git worktree remove`, so
              // the orphaned commit is preserved for the human to integrate.
              await wm.remove(session).catch(() => {});
              try { await killTmuxSession(tmuxBaseName(errTargetProject, session)); } catch { /* best-effort teardown */ }
              removeSlot(errTargetProject, session);
              recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, epicId, conflict: 'parked-blocked-teardown' }) });
            }
          } catch { /* best-effort BP0 re-surface; never throw from the complete callback */ }
        }
      }
      if (accepted) {
        const sessions = [session, `worker-${id.slice(0, 8)}`].filter(Boolean);
        const resolved = resolveEscalationsForTodo(project, id, sessions, 'resolved');
        if (resolved.length > 0) {
          recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, autoResolvedEscalations: resolved.map((e) => e.id), reason: 'todo-completed' }) });
        }
      }
      // FBPE P3 — land proof + inbox surface (READ-ONLY; master is NEVER mutated).
      // Completing the last child of an epic rolls the epic up (r.rolledUp). For each
      // such epic, re-derive epic-landability from ground truth via the land_epic proof
      // gate (children done+accepted in the store; tsc clean IN the epic worktree;
      // epic branch dry-merges cleanly into a master checkout) and raise a single
      // 'epic-ready-to-land' card carrying a green/red proof summary. A red proof
      // annotates the same card with the blocking reason — it never acts. Piggybacks
      // on this completeTodo callback (no new tick phase); fully best-effort.
      if (accepted && r.rolledUp.length > 0) {
        for (const epicId of r.rolledUp) {
          await surfaceEpicLand(project, epicId, { sessionHint: session, preferLinkTodoId: id });
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
      // The pool is partitioned by project; use the project that OWNS the lane —
      // i.e. the project the worker's tmux/worktree lives in. That is the target
      // repo (todo.targetProject) for cross-project todos, else the tracking
      // project. Match tmuxBaseName(targetProject, poolName) below so the registry
      // partition and the tmux name agree.
      const poolProject = todo.targetProject ?? project;

      // PAW P3: resolve the worker PROVIDER (manual selection, ships DORMANT).
      // Precedence session.provider → profile.provider → 'claude'. With nothing
      // pinned this is ALWAYS 'claude' (pass-through), so the pool tags slots
      // `<type>-claude-<slot>` exactly as before. A session pin (set via the
      // ProviderSelector, stored on the session-status row) routes the lane to a
      // provider-tagged slot instead. No automatic cost routing, no spend caps.
      const launchProfile = resolveProfile(todo.type, todo.targetProject ?? project);
      const sessionPin = todo.sessionName
        ? getStatus(project, todo.sessionName)?.provider ?? null
        : null;
      const provider: ProviderId = resolveProvider(launchProfile, todo, { provider: sessionPin });

      let poolName = workerIsolationEnabled() ? undefined : findIdleSessionForType(poolProject, type, provider);
      if (!poolName) {
        const slot = getOrCreateSlot(poolProject, type, provider);
        if (!slot) {
          try { await releaseClaim(project, todo.id); } catch { /* lease still backstops if the release fails */ }
          recordSupervisorAudit({ kind: 'spawn', project, session: poolSessionName(type, provider), detail: JSON.stringify({ todoId: todo.id, type, provider, started: false, reason: 'pool-busy-deferred', released: true }) });
          return false;
        }
        poolName = poolSessionName(slot.type, slot.provider, slot.slot);
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
        // executedBySession pins the WORKER lane as the durable executor (distinct
        // from claimedBy=coordinator). Set alongside sessionName here at launch.
        try { await updateTodo(project, todo.id, { sessionName: poolName, executedBySession: poolName }); }
        catch (e) { recordSupervisorAudit({ kind: 'spawn', project, session: poolName, detail: JSON.stringify({ todoId: todo.id, sessionNamePersist: 'failed', reason: e instanceof Error ? e.message : String(e) }) }); }
      }

      // LEAF_EXECUTOR (P2): headless deterministic blueprint→implement→review
      // executor, default OFF. The lane identity is already persisted above (so the
      // executor lane still shows in the fleet with a real sessionName); this runs
      // BEFORE the legacy provider-resolution / tmux machinery below. On any auth-halt
      // or hard error we release + escalate rather than silently fall through to tmux.
      if (leafExecutorEnabled() && isHeadlessLeaf(todo, project)) {
        // P3 breaker gate: if the cap window is still open, do NOT spawn. Release the
        // claim so the todo returns to `ready` (the claimGuard filter normally holds
        // it out, but a todo claimed before the breaker tripped this tick can still
        // reach here). Transient hold — no escalation. The lease also backstops.
        if (breakerOpen()) {
          try { await releaseClaim(project, todo.id); } catch { /* lease backstops */ }
          return false;
        }
        try {
          const ledProject = todo.targetProject ?? project;
          // P3 resume: carry the paused leaf's prior nodesSpent forward so the master
          // NODE_BUDGET bounds total spawns across all pause/resume cycles.
          const carried = pausedNodesSpent(project, todo.id);
          const res = await runLeaf(project, todo, await makeLeafExecutorDeps(project, ledProject, todo, carried));
          recordSupervisorAudit({ kind: 'spawn', project, session: poolName, detail: JSON.stringify({ todoId: todo.id, executor: 'leaf', outcome: res.outcome, attempts: res.attempts, nodesSpent: res.nodesSpent, reason: res.reason }) });
          if (res.outcome === 'paused') {
            // The executor hit a rate cap and yielded WITHOUT backing off. The DAEMON
            // owns the response: trip the breaker (backoff/capReset), record the leaf
            // for exhaustion tracking, and release the claim so the ordinary claim
            // loop re-dispatches it once the breaker closes.
            tripBreaker(res.paused?.capReset);
            enqueuePausedLeaf(project, todo.id, res.paused!);
            try { await releaseClaim(project, todo.id); } catch { /* lease backstops */ }
            return false;
          }
          // A non-paused outcome means the leaf made progress past the cap (or never
          // hit one) — clear any stale paused record so a future pause starts clean.
          recordResume(project, todo.id);
          // P3 follow-up: an ACCEPTED leaf proves the account is serving again — reset the
          // backoff STREAK (not the whole breaker) so the next isolated cap starts at
          // BASE_BACKOFF_MS instead of inheriting a stale, ceiling-high consecutiveTrips.
          if (res.outcome === 'accepted') resetBreakerStreak();
          return res.outcome === 'accepted';
        } catch (e) {
          try { await releaseClaim(project, todo.id); } catch { /* best-effort */ }
          createEscalation({ project, session: poolName, kind: 'blocker', todoId: todo.id,
            questionText: `Leaf-executor failed for "${todo.title ?? todo.id}": ${e instanceof Error ? e.message : String(e)}` });
          return false;
        }
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
      //     worktree branched off ITS EPIC's accumulation branch (FBPE P2 — so it
      //     sees all prior accepted work for that epic) instead of the shared
      //     working tree. cwd becomes the worktree path. Best-effort: if worktree
      //     setup fails (e.g. non-git repo), fall back to the shared-tree behavior
      //     rather than dropping the todo.
      let launchCwd: string | undefined;
      if (workerIsolationEnabled()) {
        try {
          const wm = getWorktreeManager(targetProject);
          // Resolve the epic by walking parentId in the TRACKING project (work-graph).
          const epicId = resolveEpicId(todo, project);
          const epic = await wm.ensureEpic(epicId, targetProject);
          if (epic) {
            // DEFECT 1 — under isolation each lane worktree is per-todo: pass
            // `fresh` so a cached worktree from a prior todo is torn down (never
            // reused with its stale branch). Branch off the epic's accumulation
            // branch TIP so the lane sees all prior accepted work for this epic;
            // ensureEpic just materialised the branch, so it exists. (If it
            // somehow doesn't, ensure() falls back to the detected base branch.)
            const wt = await wm.ensure(poolName, { baseBranch: epic.branch, fresh: true });
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
      if (coldStartsFor(poolProject) >= MAX_COLD_STARTS) {
        try { await releaseClaim(project, todo.id); } catch { /* lease backstops */ }
        recordSupervisorAudit({ kind: 'spawn', project, session: poolName, detail: JSON.stringify({ todoId: todo.id, started: false, reason: 'cold-start-cap', inFlight: coldStartsFor(poolProject), cap: MAX_COLD_STARTS, released: true }) });
        return false;
      }

      // 3. Spawn or reuse the pool session (idempotent — ensureSession reuses a
      //    live, bound session), then send the worker skill into it. Profile
      //    params still drive tools/model/runtimeMode. cwd = the worktree (under
      //    isolation) or the target repo. Stamp the attempt (for backoff) and count
      //    it against the cold-start cap until the spawn finishes.
      lastSpawnAttempt.set(todo.id, Date.now());
      incColdStarts(poolProject);
      // PAW P1/P4: route the spawn through the WorkerAgent registry. ONE branch —
      // when the resolved provider is 'grok-build', go through the conformance-gated
      // GrokOwnHarness (an in-process AI SDK loop; resolveGrokAgent() throws unless it
      // passes conformance). Otherwise the UNTOUCHED Claude tmux path (claude-only
      // floor): the adapter wraps the exact ensureSession + runTodoInSession path so
      // `ready` / `reason` / `tmux` carry today's semantics — ensure-then-(if
      // ready)-dispatch. The grok handle has the SAME shape, so the bookkeeping below
      // (markBusy / recordDispatch / supervised) is shared; completion for BOTH lanes
      // funnels through the MCP complete_todo verb → handleWorkerComplete →
      // resolveCompletion (gate + work-committed re-verify) — never a model self-report.
      // NO SILENT GROK→CLAUDE FALLBACK (in-process-mcp fix): for a grok-pinned
      // todo, resolveGrokAgent() throws unless the GrokOwnHarness passes
      // conformance. We must NOT swallow that and fall through to the Claude
      // default agent — a grok-pinned todo running on Claude is a silent
      // provider swap. Resolve grok in its OWN guarded block; on failure release
      // the claim and ESCALATE (blocker), then bail — never reassign to Claude.
      let launchAgent: typeof workerAgent;
      if (provider === 'grok-build') {
        try {
          launchAgent = resolveGrokAgent();
        } catch (e) {
          decColdStarts(poolProject);
          try { await releaseClaim(project, todo.id); } catch { /* lease backstops */ }
          const reasonText = e instanceof Error ? e.message : String(e);
          try {
            createEscalation({
              project,
              session: poolName,
              kind: 'blocker',
              todoId: todo.id,
              questionText:
                `Grok worker launch FAILED for "${todo.title ?? todo.id}" — this todo is pinned to ` +
                `the 'grok-build' provider but resolveGrokAgent() threw: ${reasonText}. The claim has ` +
                `been released and the todo NOT reassigned to a Claude worker (no silent provider swap). ` +
                `Resolve the grok harness issue and retry, re-pin the provider, or drop the pin.`,
            });
          } catch { /* escalation is best-effort; the released claim already parks the todo */ }
          recordSupervisorAudit({ kind: 'escalate', project, session: poolName, detail: JSON.stringify({ todoId: todo.id, reason: 'grok-resolve-failed', error: reasonText, released: true }) });
          return false;
        }
      } else if (provider === 'claude' && claudeInProcessEnabledFor(project)) {
        // PARALLEL-RUN: route claude todos to the in-process worker-core harness instead
        // of the legacy CLI. On any resolve issue, FALL BACK to the CLI claude worker —
        // same provider, proven runtime — so this is never a hard fail, never a swap.
        try {
          launchAgent = resolveAnthropicCoreAgent();
        } catch (e) {
          launchAgent = workerAgent;
          recordSupervisorAudit({ kind: 'escalate', project, session: poolName, detail: JSON.stringify({ todoId: todo.id, reason: 'anthropic-core-resolve-failed-fell-back-to-cli', error: e instanceof Error ? e.message : String(e) }) });
        }
      } else {
        launchAgent = workerAgent;
      }
      let handle: { ready: boolean; tmux?: string; sent?: boolean; reason?: string } = { ready: false };
      let started = false;
      let reason: string | undefined;
      try {
        handle = await launchAgent.launch({ project: targetProject, session: poolName, allowedTools, model, runtimeMode, contextPrompt, cwd: launchCwd, invokeSkill });
        started = handle.ready;
        reason = handle.reason;
      } finally {
        decColdStarts(poolProject);
      }
      const ok = started && reason === undefined;

      // NO SILENT GROK→CLAUDE FALLBACK (in-process-mcp fix): a grok-pinned launch
      // that returns ready:false must ESCALATE rather than leave the claim to be
      // re-claimed (where the same grok pin would loop) or, worse, run on Claude.
      // Release the claim + file a blocker; the Claude path is unchanged.
      if (!ok && provider === 'grok-build') {
        try { await releaseClaim(project, todo.id); } catch { /* lease backstops */ }
        try {
          createEscalation({
            project,
            session: poolName,
            kind: 'blocker',
            todoId: todo.id,
            questionText:
              `Grok worker launch FAILED for "${todo.title ?? todo.id}" — this todo is pinned to the ` +
              `'grok-build' provider but the harness returned not-ready (reason: ${reason ?? 'unknown'}). ` +
              `The claim has been released and the todo NOT reassigned to a Claude worker (no silent ` +
              `provider swap). Resolve the grok launch issue and retry, re-pin, or drop the pin.`,
          });
        } catch { /* escalation is best-effort; the released claim already parks the todo */ }
        recordSupervisorAudit({ kind: 'escalate', project, session: poolName, detail: JSON.stringify({ todoId: todo.id, reason: 'grok-launch-not-ready', launchReason: reason, released: true }) });
        return false;
      }

      if (ok) {
        // Record the backing tmux so reapDeadSlots can free this slot on the
        // worker's death regardless of the todo's eventual status.
        markBusy(poolProject, poolName, todo.id, handle.tmux ?? tmuxBaseName(targetProject, poolName));
        // PAW P3: record the dispatch's resolved { provider, model } so the watch
        // card / fleet-status can surface WHICH provider ran this lane. DORMANT
        // today (provider is always 'claude'), but persisting it now means the
        // surfacing is in place the moment a real pin is set. Pinned on the
        // session-status row (the slice the watch card reads); model goes into the
        // in-memory dispatch record below for the fleet read-model.
        try { recordSessionProvider(project, poolName, provider); } catch { /* best-effort surfacing */ }
        recordDispatch(todo.id, { provider, model });
        // Claim continues under the pool session name (todo.sessionName = poolName)
        // so reclaim/lease semantics and the dead-claim reaper key off it.
        // executedBySession pins the durable executor (the worker lane).
        try { await updateTodo(project, todo.id, { sessionName: poolName, executedBySession: poolName }); } catch { /* spawn already succeeded; lease covers any inconsistency */ }
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
        if (t.assigneeKind === 'human') continue; // human-owned (e.g. a [SESSION] note) — never reclaim
        // Identity is the persisted pool lane. No sessionName → the todo was never
        // spawned under a lane (or its persist raced); treat as dead and reclaim,
        // rather than fabricating a `worker-<id8>` name that points at no real tmux.
        const session = t.sessionName;
        // In-process lanes have no tmux — ask the harness before the tmux probe, or a
        // healthy in-process worker reads as dead (§6.7 bootstrap).
        if (session && await inProcessLaneAlive(session)) continue; // live in-process lane
        if (session && await isTmuxAlive(tmuxBaseName(project, session))) continue; // worker still running (incl. warm idle pool sessions)
        const next = await reclaimClaim(project, t.id);
        // The session is gone — release the pool slot it held (no-op if it wasn't a pool session).
        // The slot lives in the project the worker's lane ran in (target for cross-project).
        if (session) markIdle(t.targetProject ?? project, session);
        if (next === 'ready') reclaimed.push(t.id);
        else if (next === 'blocked') exhausted.push(t.id);
      }
      return { reclaimed, exhausted };
    },
    reapOrphanedLeaves: async (project: string): Promise<{ reclaimed: string[]; exhausted: string[] }> => {
      // CLAIM-INDEPENDENT sweep (gap 2026-06-09, real instance 19b097a1): a LEAF left
      // status=in_progress with claimedBy/claimedAt NULL is invisible to BOTH existing
      // reapers — releaseExpiredClaims needs a live lease, reapDeadClaims needs a
      // claimToken — so it never ages out (sat ~9h across 3 deploys). The in-memory
      // deadTracker only holds workers THIS process spawned, wiped on every restart;
      // this sweep instead ages off the PERSISTED updatedAt, so it survives restarts.
      const reclaimed: string[] = [];
      const exhausted: string[] = [];
      const now = new Date().toISOString();
      const nowMs = Date.parse(now);
      const inProgress = listTodos(project, { status: 'in_progress' });

      // FAST PATH (Phase 1, decision 9cd01858): derive staleness from the DURABLE
      // session_status pulse instead of the 15-min/​~9h todo-updatedAt grace. A leaf
      // whose lane last pulsed > PULSE_STALE_MS ago AND whose worker is CONFIRMED
      // not-alive (two-fact rule) is reclaimed in SECONDS. One ps snapshot for the
      // whole pass keeps the subtree liveness walk to a single `ps`. Strictly
      // additive: a lane with NO durable pulse is skipped here (shouldPulseReap →
      // false) and falls through to the grace sweep below, so it can NEVER be worse
      // than today.
      const snap = await procSnapshot();
      const fastReaped = new Set<string>();
      for (const t of inProgress) {
        if (t.assigneeKind === 'human') continue; // human-owned (e.g. a [SESSION] note) — never reclaim
        if (t.parentId == null) continue; // epics are containers — never reaped
        const session = t.sessionName;
        if (!session) continue;           // never-spawned leaf → grace sweep handles it
        const pulseAt = lanePulseAt(project, session);
        if (pulseAt == null || nowMs - pulseAt <= PULSE_STALE_MS) continue; // fresh/absent → fall back
        if (await inProcessLaneAlive(session)) continue; // live in-process lane — no tmux to probe (§6.7)
        const tmux = tmuxBaseName(project, session);
        const dead = await laneConfirmedDead(tmux, snap);
        if (!shouldPulseReap(pulseAt, nowMs, PULSE_STALE_MS, dead)) continue;
        const next = await reclaimOrphan(project, t.id);
        if (next == null) continue; // raced to a terminal state
        markIdle(t.targetProject ?? project, session);          // free any pool slot it held
        fastReaped.add(t.id);
        if (next === 'ready') reclaimed.push(t.id);
        else exhausted.push(t.id);
        recordSupervisorAudit({
          kind: 'reconcile',
          project,
          session,
          detail: JSON.stringify({ source: 'pulse-reap', todoId: t.id, outcome: next, stalePulseMs: nowMs - pulseAt }),
        });
      }

      // FALLBACK (never-worse): the existing claim+age grace sweep for every leaf
      // the fast path did not already reap (incl. all NULL-pulse / fresh-pulse lanes).
      const candidates = planOrphanReap(inProgress, now, DEFAULT_ORPHAN_GRACE_MS);
      for (const c of candidates) {
        if (fastReaped.has(c.id)) continue; // already reclaimed via the durable pulse
        // Live in-process lane (no tmux) → never reap on tmux absence (§6.7 bootstrap).
        if (c.sessionName && await inProcessLaneAlive(c.sessionName)) continue;
        // Case B (claim past lease): only reap once the worker's tmux is confirmed
        // gone — a still-live worker on an over-long task must not be yanked. Case A
        // (claimedBy NULL → needsTmuxProbe false) has no live claim by definition.
        if (c.needsTmuxProbe && c.sessionName && await isTmuxAlive(tmuxBaseName(project, c.sessionName))) continue;
        // reclaimOrphan (NOT reclaimClaim) reclaims regardless of claimToken — an
        // orphan's whole problem is the missing token. Retry-budget-aware: → ready,
        // or blocked once the retry cap is exceeded.
        const next = await reclaimOrphan(project, c.id);
        if (next == null) continue; // raced to a terminal state — nothing to reap
        if (c.sessionName) {
          // The slot lives in the project the worker's lane ran in (target for cross-project).
          const cProject = inProgress.find((t) => t.id === c.id)?.targetProject ?? project;
          markIdle(cProject, c.sessionName); // free any pool slot it held
        }
        if (next === 'ready') reclaimed.push(c.id);
        else exhausted.push(c.id);
        recordSupervisorAudit({
          kind: 'reconcile',
          project,
          session: c.sessionName ?? 'orphan-reap',
          detail: JSON.stringify({ source: 'orphan-reap', todoId: c.id, outcome: next, hadClaim: c.needsTmuxProbe }),
        });
      }
      return { reclaimed, exhausted };
    },
    reapDeadPoolSlots: async (_project: string): Promise<string[]> => {
      // Slot-level reconciliation: a slot records its tmux at markBusy, so we can
      // free it on its worker's death regardless of the todo's status (dropped,
      // completed out-of-band, or an operator-killed lane). Project-agnostic — it
      // keys off each slot's own recorded tmux, not the in_progress todo list.
      //
      // Phase 1 (point 5): pooled-slot liveness reads the SAME two-fact not-alive
      // path as the orphan reaper (no separate code path) — a slot is freed when its
      // tmux is gone OR its tmux is a bare shell with no `claude` in its subtree.
      // One ps snapshot for the pass; an UNKNOWN liveness stays alive (kept busy).
      const snap = await procSnapshot();
      return await reapDeadSlots(async (tmux) => !(await laneConfirmedDead(tmux, snap)));
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
        if (claudePresent === false && !workerAgent.isTuiPresent(pane)) {
          const now = Date.now();
          const prevDead = deadTracker.get(tmux);
          if (prevDead?.escalated) continue;
          if (!prevDead) deadTracker.set(tmux, { since: now, escalated: false });
          // Restart-robust grace (the bug this fixes): the in-memory deadTracker is
          // wiped on every sidecar restart (deploy / app relaunch / crash), so a
          // dead worker could silently hold its slot forever if restarts kept
          // out-pacing the 45s confirmation. Use the PERSISTED claim age as the
          // primary clock — a worker claimed > DEAD_GRACE_MS ago with NO Claude in
          // its pane is past cold-start and genuinely dead, regardless of restarts.
          // The in-memory timer remains a fallback for the (rare) no-claimedAt case.
          const claimTs = t.claimedAt ? new Date(t.claimedAt as unknown as string).getTime() : NaN;
          const claimAgeMs = Number.isFinite(claimTs) ? now - claimTs : Infinity;
          const inMemAgeMs = now - (deadTracker.get(tmux)?.since ?? now);
          const deadForMs = Math.max(claimAgeMs, inMemAgeMs);
          if (deadForMs < DEAD_GRACE_MS) continue;
          const prev = deadTracker.get(tmux)!;
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
            recordSupervisorAudit({ kind: 'escalate', project, session, detail: JSON.stringify({ todoId: t.id, reason: 'dead-claude-live-tmux', deadMs: deadForMs }) });
            // Reset the lane: kill the dud bare-shell tmux, free the pool slot, and
            // reclaim the claim (retry-budget-aware → ready or blocked).
            await killTmuxSession(tmux);
            markIdle(t.targetProject ?? project, session);
            await reclaimClaim(project, t.id);
            prev.escalated = true;
            stalled.push(t.id);
          } catch { /* escalation/recovery best-effort; never abort the tick */ }
          continue;
        }
        // Claude is present (or liveness unknown) → clear any dead-tracking for it.
        deadTracker.delete(tmux);

        if (!pane || workerAgent.isActivelyWorking(pane)) continue;

        // TRANSIENT RATE-LIMIT RECOVERY: a worker whose Claude hit Anthropic's
        // server-side throttle ("temporarily limiting requests · Rate limited")
        // stops mid-turn but doesn't realize it — the lane silently stalls (the
        // user's report: "the coordinator doesn't realize it, so it just stops
        // everything"). This is NOT a stall (no decision pending) and NOT the
        // user's usage cap (human-gated). After a backoff (RATE_LIMIT_NUDGE_MS),
        // NUDGE the worker to retry; only escalate if it stays throttled past
        // RATE_LIMIT_MAX_NUDGES. Handled BEFORE the stall path so a throttled
        // worker is never parked 'blocked'.
        if (detectRateLimit(pane)) {
          const nowRL = Date.now();
          const rl = rateLimitTracker.get(tmux) ?? { firstSeen: nowRL, lastNudge: 0, attempts: 0 };
          if (!rateLimitTracker.has(tmux)) rateLimitTracker.set(tmux, rl);
          // Wait out the backoff (since the last nudge, or since first seen) so
          // Claude Code's own retry gets first crack before we intervene.
          if (nowRL - (rl.lastNudge || rl.firstSeen) < RATE_LIMIT_NUDGE_MS) continue;
          if (rl.attempts >= RATE_LIMIT_MAX_NUDGES) {
            // Persistently throttled — surface it once so a human can pause the
            // fleet (level→off) until it clears; then re-arm if it recurs.
            try {
              createEscalation({
                project,
                session,
                kind: 'blocker',
                todoId: t.id,
                questionText:
                  `Worker for "${t.title ?? t.id}" has been API rate-limited for a while ` +
                  `(${rl.attempts} retry nudges over ~${Math.max(1, Math.round((nowRL - rl.firstSeen) / 60000))} min) ` +
                  `and isn't recovering. This is a TRANSIENT server throttle (not your usage cap) — ` +
                  `consider pausing the fleet (level → off) until it clears, then resume.`,
              });
              recordSupervisorAudit({ kind: 'escalate', project, session, detail: JSON.stringify({ todoId: t.id, reason: 'rate-limit-persistent', attempts: rl.attempts }) });
            } catch { /* best-effort */ }
            rateLimitTracker.delete(tmux);
            continue;
          }
          // Nudge the worker to retry the throttled request.
          try {
            await sendTmuxKeysRaw(tmux, 'Please retry the request that was rate-limited and continue.');
            rl.attempts += 1;
            rl.lastNudge = nowRL;
            recordSupervisorAudit({ kind: 'nudge', project, session, detail: JSON.stringify({ todoId: t.id, reason: 'rate-limit', attempt: rl.attempts }) });
          } catch { /* best-effort; retry next tick */ }
          continue; // handled — do NOT fall through to the stall/park-blocked path
        }
        // Not rate-limited → clear any stale rate-limit tracking for this lane.
        rateLimitTracker.delete(tmux);

        // DURABLE staleness (Phase 1, decision 9cd01858): the idle clock is the
        // restart-safe session_status pulse (updatedAt = the lane's last status
        // report), not an in-memory pane-signature timer. A worker idle at its
        // prompt stopped pulsing when it went quiet, so `now - pulseAt` is its true
        // idle age and survives a daemon restart. A lane with NO durable pulse yet
        // has no staleness signal here → skip (the orphan reaper + dead-shell
        // detection backstop it). Re-escalation is debounced by the recovery below
        // parking the todo `blocked` (it leaves the in_progress set next tick).
        const now = Date.now();
        const pulseAt = lanePulseAt(project, session);
        if (pulseAt == null || now - pulseAt < STALL_MS) continue;
        const prevSince = pulseAt;
        // FALSE-STALL GUARD (a6fcbd79): a worker that has FINISHED — built its
        // change-set and got it committed onto the epic branch — then sits idle
        // at its prompt while its `complete_todo` handshake is still in flight
        // (or about to fire) looks byte-identical to a genuinely stalled worker:
        // alive, no spinner, pulse gone quiet. Parking it `blocked` here REVERTS
        // a done leaf to status='blocked' with acceptanceStatus=null (the live
        // defect: every type:ui / type:reviewer leaf flipped back to blocked,
        // only un-stuck by a manual re-promote). type:backend was unaffected only
        // because its completion handshake reliably lands before STALL_MS — a
        // race, not a real difference. So: if the work is already on the epic
        // branch, the worker is finished, NOT stalled — skip it and let the
        // completion/roll-up path finalize it (done+accepted). Best-effort: any
        // probe failure falls through to the normal stall handling (fail-safe).
        if (await workCommittedOnEpic(project, t)) continue;
        try {
          // DOGFOOD #6 follow-up: classify the idle-at-prompt. A permission
          // prompt is NOT a decision the human can answer in the inbox — it's a
          // "permission needed: <tool>" signal whose root fix is the worker
          // profile allowlist (P3). Surface it as a distinct 'approval'
          // escalation naming the tool, so it reads as "allowlist this tool",
          // not a generic stalled-decision card.
          const perm = workerAgent.detectPermissionPrompt(pane);
          const idleMin = Math.round((now - prevSince) / 60000);
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
            recordSupervisorAudit({ kind: 'escalate', project, session, detail: JSON.stringify({ todoId: t.id, reason: 'permission-prompt', tool: perm.tool, idleMs: now - prevSince }) });
          } else {
            createEscalation({
              project,
              session,
              kind: 'question',
              todoId: t.id,
              questionText:
                `Worker for "${t.title ?? t.id}" appears STALLED — idle at its prompt with no progress for ` +
                `${idleMin}+ min, awaiting input but no escalation was filed ` +
                `(DOGFOOD #6 auto-detected). Pending context:\n\n${workerAgent.extractStallContext(pane)}`,
            });
            recordSupervisorAudit({ kind: 'escalate', project, session, detail: JSON.stringify({ todoId: t.id, reason: 'stall-detected', idleMs: now - prevSince }) });
          }
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
            markIdle(t.targetProject ?? project, session);
          } catch { /* recovery best-effort; never abort the tick */ }
        } catch { /* escalation best-effort; never abort the tick */ }
      }
      // GC the dead-shell tracker for tmux sessions no longer in_progress. (The old
      // in-memory idleTracker is gone — durable session_status replaces it.)
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
    sweepExhaustedHeadless: async (project: string): Promise<void> => {
      // P3: any leaf paused on a rate cap past the 2h total-wait ceiling is parked
      // BLOCKED + escalated. The cap may persist indefinitely (account out of quota
      // for the billing window); bound the total wait rather than spin forever.
      const deps = makeCoordinatorDeps();
      for (const entry of pausedLeavesFor(project)) {
        if (!breakerExhausted(entry.firstTrippedAt)) continue;
        const todo = getTodo(project, entry.todoId);
        // Park BLOCKED via the EXISTING completion funnel (route a 'rejected' →
        // status blocked, completion cleared), same mechanism parkBlocked uses.
        try { await handleWorkerComplete(deps, project, entry.todoId, 'rejected'); }
        catch { /* gate funnel best-effort on the exhaustion path */ }
        createEscalation({
          project,
          session: todo?.sessionName ?? 'unassigned',
          kind: 'blocker',
          questionText: `Leaf "${todo?.title ?? entry.todoId}" is RATE-CAP exhausted — the claude.ai account stayed capped for over 2h. Parked blocked; needs a human (wait for the cap to reset, then re-open, or split/drop).`,
          todoId: entry.todoId,
        });
        recordResume(project, entry.todoId);
      }
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
          const gateWm = getWorktreeManager(gateProject);
          const p = await gateWm.existingPath(todo.sessionName);
          // FBPE P2: each lane branches off ITS epic's accumulation branch
          // (collab/epic/<id8>), so the gate diff base must be THAT epic's branch —
          // resolved by walking the todo's parent chain — to correctly scope the
          // lane's change-set against its own epic, not a global trunk.
          if (p) { laneCwd = p; integrationBase = gateWm.epicBranchName(resolveEpicId(todo, project)); }
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
    verifyWorkCommitted: async (project: string, todoId: string): Promise<boolean | null> => {
      // PAW P1 re-verify: corroborate a worker's 'accepted' actually produced
      // committable work, closing the hallucinated-completion hole (complete_todo
      // with no edits/commit). Under isolation each lane has its OWN worktree, so
      // "real work" = a DIRTY worktree (uncommitted edits, not yet merged back) OR
      // commits already ahead of the epic base. A clean tree with 0 ahead is a
      // hallucination → false → resolved 'pending' not 'accepted'.
      //
      // Returns null (indeterminate → PRESERVE prior trust, never false-downgrade)
      // for the shared-tree path (not lane-isolatable), a missing lane worktree, or
      // any probe error — strictly never-worse than today. CROSS-PROJECT: the lane
      // worktree lives in the TARGET repo; the work-graph (epic walk) in the tracking project.
      if (!workerIsolationEnabled()) return null;
      const todo = getTodo(project, todoId);
      if (!todo?.sessionName) return null;
      const targetProject = todo.targetProject ?? project;
      try {
        const wm = getWorktreeManager(targetProject);
        const wtPath = await wm.existingPath(todo.sessionName);
        if (!wtPath) return null; // no lane worktree → can't isolate work → preserve
        if (await wm.isDirty(todo.sessionName)) return true; // uncommitted edits present
        const epicId = resolveEpicId(todo, project);
        if ((await wm.laneCommitsAheadOfEpic(todo.sessionName, epicId)) > 0) return true;
        // LEAF-EXECUTOR (the real-daemon dogfood finding): the leaf-executor MERGES the
        // lane onto the epic accumulation branch (collab/epic/<id8>) BEFORE proposing
        // acceptance — so a clean lane, 0-ahead, is the NORMAL success shape, not a
        // hallucination. Work on the epic branch IS real, committable work (it ships when
        // the epic lands). Recognize it FIRST, before the stricter integration probe (the
        // epic branch is the accumulation tier; master is only reached at epic-land).
        // Without this, EVERY leaf-executor PASS false-downgrades to 'pending'.
        if (await wm.todoOnEpicBranch(epicId, todoId)) return true;
        // BUG 7b7d66d5(b): a clean lane NOT on its epic branch is still not proof of a
        // hallucination — the work may have landed on the INTEGRATION branch directly
        // (hand cherry-pick / steward reconcile / a prior accepted+landed run that tore
        // the lane down). Before false-downgrading to 'pending', check whether the todo's
        // commit (by its Collab-Todo trailer) is reachable from integration. Only a
        // provable "nowhere" (clean lane, not on epic, provably not on integration) is a
        // real hallucination; an indeterminate probe preserves prior trust (never downgrades).
        const onInt = await wm.commitOnIntegration(epicId, todoId);
        if (onInt === true) return true; // landed on master/integration → real work
        if (onInt === null) return null; // indeterminate → preserve (never false-downgrade)
        return false; // clean lane, not on epic branch, not on integration → hallucination
      } catch {
        return null; // probe error → indeterminate → preserve (never false-downgrade)
      }
    },
  };
}

/** Run one coordinator pass for `project` — claim ready todos, launch workers,
 *  reap dead claims, and evaluate gates. Safe to call repeatedly; all re-entrancy
 *  guards (coldStartsInFlight, lastSpawnAttempt, cold-start caps) are module-level
 *  and prevent double-claiming across overlapping calls.
 *
 *  This is THE build-tick entry-point: the Orchestrator daemon's tick calls it
 *  directly (orchestrator-live). The old per-project coordinator setInterval loop
 *  + its respawn watchdog were retired once the Orchestrator took ownership of the
 *  build/reconcile cadence (decision 9cb065a3, scope A). */
export async function runBuildPass(project: string): Promise<void> {
  const deps = makeCoordinatorDeps();
  await runTick(deps, project);
}
