import * as path from 'node:path';
import type { Todo } from './todo-store';
import { listReadyTodos, claimTodo, releaseExpiredClaims, completeTodo, updateTodo, getTodo, listTodos, reclaimClaim, reclaimOrphan, releaseClaim, resetTodo, stampEpicLandedAt, bumpRetryCountIfOwned } from './todo-store';
import { isEpic, isLand, isMission, kindOf, labelFor, stripLabel, type TodoKind } from './todo-kind.ts';
import { findBlockedSplits, type BlockedSplit } from './claimability';
import { DEFAULT_ORPHAN_GRACE_MS, DEFAULT_PULSE_STALE_MS } from './coordinator-core';
import { reapDeadWorkers as reapDeadWorkersImpl, type WorkerLivenessDeps } from './worker-liveness';
import { MAX_REDISPATCH, STRANDED_REOPEN_CAP } from './harness-caps';
import { getOrchestratorLevel, listOrchestratorProjects, getProjectPoolConfig, getProjectPoolSize } from './orchestrator-config';
import { getStatus } from './session-status-store';
import { getWebSocketHandler } from './ws-handler-manager';
import { filterClaimable } from './claim-guard';
import { summarize as summarizeLedger, reapStaleInflight, reapSameEpochOrphanInflight, clearLeafInflight, isLeafInflightLive, getLeafResume, clearLeafResume, clearLeafBlueprint, listLeafInflight } from './worker-ledger';
import { listTrackedLeaves, killLeafSubtree, markRunLive, markRunDone, isRunLive } from './leaf-subprocess-registry';
import { reapOrphanedLeafWorktrees, tickGcLeafWorktrees } from './leaf-worktree-reaper.js';
import { WorktreeManager, INBOX_EPIC_ID } from '../agent/worktree-manager';
import { createEscalation, resolveEscalationsForTodo, recordSupervisorAudit, listSupervisorAudit, addSupervised, addWatchedProject, getEscalation, resolveEscalation, getProjectDigestEnabled } from './supervisor-store';
import { selectBudgetTrips, DEFAULT_BUDGET_CONFIG, type LaneBudgetRow } from './convergence-breaker';

/** P1 breaker memory: lanes already SOFT-warned this process, so a soft (non-parking)
 *  breach is surfaced once, not re-audited every 30s tick. HARD trips park the lane
 *  out of in_progress, so they self-dedup; the escalation store dedups too. */
const budgetSoftWarned = new Set<string>();
import { tmuxBaseName } from './tmux-naming';
import { runTick, handleWorkerComplete, type CoordinatorDeps, type GateVerdict } from './coordinator-daemon';
import { reserveLeafSlot, releaseLeafSlot, reconcileInflight } from './inflight-limiter';
import { loadProjectManifest, type ProjectManifest } from '../config/project-manifest';
import { runRegistryGate } from './gate-runner';
import { findOwningMission } from './land-authority';
import { getMission, isMissionTerminal } from './mission-store';
// Landing subsystem (extracted to coordinator-land.ts). surfaceEpicLand is the one
// moved function this file still calls directly (makeCoordinatorDeps' completeTodo
// continuation); the rest are re-exported below for back-compat only.
import { surfaceEpicLand } from './coordinator-land';
// Import for side-effect: registers the CAD gate plugin (domain tier) into the
// gate registry so a CAD step artifact is gated deterministically (Phase 1 #1).
import './cad-gate-plugin';
// Import for side-effect: registers the iOS Swift gate plugin (domain tier) so a
// type:'ios' leaf is gated by a strict swift build/test, not the tsc manifest command.
import './ios-gate-plugin';
import { deriveBsyncSessionId, isCadTodo, bsyncSessionContextNote } from './bsync-session';
import { runLeaf, makeLeafExecutorDeps, parseSizeManifest } from './leaf-executor';
import { leafAbortReason } from './leaf-abort';
import { listOpenSplitProposals } from './split-proposal';
import { getLeafRun } from './ledger-stats';
import { getEpicBranchStatus, type EpicBranchStatusReport } from './epic-branch-status.ts';
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
import { resolveProfile, type AgentProfile } from '../config/agent-profiles';
import type { ProviderId } from '../agent/worker-agent';
import { resolveManifestPacks } from '../config/tech-packs';
import {
  resolveType,
  typeForFiles,
  findIdleSessionForType,
  getOrCreateSlot,
  poolSessionName,
  markIdle,
  removeSlot,
  DEFAULT_SLOTS_PER_TYPE,
} from './worker-pool';
import { getConfig } from './config-service';
import { recordFriction } from './friction-store';

// ---------------------------------------------------------------------------
// Pure pane-scrape detectors — the in-app terminal UI + interactive-launch tmux
// stack was removed (Phase 4); these detectors are kept here ONLY because
// session-summary-loop.ts (interactive-session summaries) still consumes them.
// Pure string → boolean/struct, no tmux/ps. Byte-identical to the retired Claude
// adapter's copies.
// ---------------------------------------------------------------------------

/** Cheap corroboration: does the pane render any Claude TUI chrome (status bar,
 *  spinner, interrupt hint)? */
export function isClaudeTuiPresent(pane: string): boolean {
  return /ctx\s*\||for agents|esc to interrupt|\(\d+(?:m\s*\d+)?s\s*·/.test(pane);
}

/** A Claude Code PERMISSION PROMPT is a distinct class of idle-at-prompt from a
 *  self-filed escalation/decision. Returns the requested tool name when extractable. */
export function detectPermissionPrompt(pane: string): { isPermission: boolean; tool: string | null } {
  const hasQuestion = /Do you want to proceed\?/i.test(pane);
  const hasDontAsk = /Yes,?\s*(?:and\s*)?don'?t ask again/i.test(pane);
  const hasYesNoMenu =
    /(?:^|\n)\s*❯?\s*1\.\s*Yes\b/i.test(pane) && /(?:^|\n)\s*❯?\s*(?:2|3)\.\s*(?:Yes|No)\b/i.test(pane);
  const isPermission = hasQuestion && (hasDontAsk || hasYesNoMenu);
  if (!isPermission) return { isPermission: false, tool: null };
  return { isPermission: true, tool: extractRequestedTool(pane) };
}

/** Best-effort: pull the tool the permission prompt is gating out of the pane. */
export function extractRequestedTool(pane: string): string | null {
  const mcp = pane.match(/mcp__[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+/);
  if (mcp) return mcp[0];
  const lines = pane.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    const m = l.match(/^([A-Za-z][\w-]*)\s*\(/);
    if (m && !/^(?:if|for|while|switch|function|return)$/i.test(m[1])) return m[1];
  }
  return null;
}

/** A Claude TUI pane is ACTIVELY WORKING when it shows a spinner with an elapsed
 *  timer or the interrupt hint. */
export function isActivelyWorking(pane: string): boolean {
  return /\(\d+(?:m\s*\d+)?s\s*·/.test(pane) || /esc to interrupt/i.test(pane);
}

// Re-exports (back-compat): the landing subsystem (epic gating-children, the land
// mutex/proof, auto-land arming sweeps, convergent land-leaf stamping, the
// epic-ready-to-land surface, stale-epic revalidation, post-land digest refresh, and
// the human/daemon land click) was MOVED to coordinator-land.ts. These keep
// `import { … } from './coordinator-live'` resolving unchanged for every existing
// importer (routes, mcp, reconcile-pass, tests) — see .collab notes on the move.
export {
  surfaceEpicLand,
  type EpicRepoPartition,
  partitionEpicChildrenByRepo,
  type EpicGatingChildren,
  epicGatingChildren,
  type LandEpicOutcome,
  type LandProof,
  surfaceDirtyLandBlocker,
  deriveStuckAutoLandAction,
  surfaceStuckAutoLand,
  autoLandReadiness,
  missionLandLeafPromotion,
  autoLandArmedMissionEpics,
  surfaceBuildGreenNonMissionEpics,
  stampLandLeafOnMerge,
  convergeObservedMerge,
  type RevalidateResult,
  type RevalidateDeps,
  revalidateStaleEpic,
  refreshProjectDigestOnLand,
  landEpic,
  STRANDED_EPIC_SWEEP_INTERVAL_MS,
  STRANDED_EPIC_MAX_GIT_CHECKS,
  strandedEpicCandidates,
  sweepStrandedEpics,
} from './coordinator-land';

/** Run a subprocess ASYNC and await it — NEVER block the single-threaded sidecar
 *  event loop with spawnSync (bug 944408c2: the coordinator/watchdog runs in the
 *  sidecar process, so a synchronous tmux/ps/gate call freezes the whole HTTP API
 *  — terminal + health included — until it returns). `capture` pipes stdout/stderr;
 *  otherwise they're discarded for speed.
 *  shared with coordinator-land: used by both this file's tmux/ps helpers AND
 *  coordinator-land.ts's revalidateStaleEpic default GateExec — exported so the
 *  landing-subsystem extraction can import it rather than duplicate it. */
export async function execAsync(
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

/** Tear down a worker-isolation warm session by base name. The tmux-backed warm
 *  session this used to kill no longer exists (workers run in-process, §6.7) —
 *  kept as a no-op call target so the 5 best-effort teardown call sites below
 *  don't need individual edits. */
async function killTmuxSession(_tmux: string): Promise<void> {
  /* no-op: tmux/terminal stack removed (Phase 4) */
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
// P7: reconcileWorkerPoolFromLiveSessions (restart-time rebuild of busy pool slots
// from live tmux worker sessions) was deleted with the tmux worker lane — a headless
// leaf runs in-process and cannot survive a restart to be reconciled (an interrupted
// leaf orphans → reapOrphanedLeaves). The interactive-terminal tmux sessions are not
// worker lanes and were never reconciled here.

/** Resolved dead-worker grace (ms) the daemon actually uses. Read-only snapshot
 *  for observability (e.g. the runtime_config MCP tool). */
const DEAD_GRACE_MS = (Number(process.env.MERMAID_DEAD_GRACE) || 45) * 1000;
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
// MAX_REDISPATCH (HARD RE-DISPATCH CAP loop breaker) moved to harness-caps.ts (the
// harness's single loop-breaker cap surface); imported above.
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

/** This daemon process's epoch — minted once per process at module load, stamped
 *  onto every claim this process mints (claimTodo). A claim carrying a DIFFERENT
 *  epoch was minted by a now-dead daemon; since the leaf-executor runs in-process
 *  it cannot have outlived that process, so such a claim is reclaimable on sight
 *  (the heal that un-strands leaves killed by a sidecar hot-swap — no liveness
 *  probe, which a lingering reusable tmux shell would defeat). */
const COORDINATOR_EPOCH = crypto.randomUUID();

/** The lane's last DURABLE pulse (session_status.updatedAt, ms epoch), or null when
 *  none was ever recorded — the signal that the additive fast path must fall back to
 *  today's grace for this lane. Best-effort: any read error → null (→ fall back). */
function lanePulseAt(project: string, session: string | null): number | null {
  if (!session) return null;
  try { return getStatus(project, session)?.updatedAt ?? null; }
  catch { return null; }
}

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



/** Human-facing label for a todo: role label from `kind`, never from the title.
 *  `stripLabel` first so this is idempotent against not-yet-migrated stored titles;
 *  leaves have an empty label and render bare. */
export function displayTitle(t: { kind?: TodoKind | null; title?: string | null; id?: string }): string {
  const label = labelFor(kindOf(t));
  const bare = stripLabel(t.title ?? '') || (t.id ?? '');
  return label ? `${label} ${bare}` : bare;
}

/** Containerhood is about OPEN work: a child that is `done` or `dropped` no longer makes its
 *  parent a container. Without the `dropped` clause, the documented way to DECLINE a split
 *  (drop the children) bricked the parent forever — `not-headless: has-children`, unclaimable,
 *  with no path back to being a leaf (observed 2026-07-08).
 *
 *  Mirrors planCoordinatorTick's `openChildParents` guard (coordinator-core.ts) — same rule,
 *  same two terminal statuses. Uses includeCompleted:true + an explicit filter rather than
 *  leaning on listTodos' implicit `status != 'done'`, so the rule is readable in one place.
 *
 *  NOTE (second-order, do NOT overstate this fix): dropping the children does not make a
 *  decline *durable*. The deterministic size gate re-splits the leaf on the next claim.
 *  A decline only sticks once the leaf's SPEC changes (a conductor re-cut) or SR-3 lands
 *  (split becomes a proposal with a safe default). This change only restores the *ability*
 *  to decline; it does not make the decline survive the next tick.
 */
/** Groups todos by parentId so hasOpenChildren is an O(1)-ish Map lookup instead of a
 *  full-table scan. Build ONCE per tick/scan (O(n)) from a `listTodos(includeCompleted:
 *  true)` snapshot and thread the same index through every isHeadlessLeaf/
 *  headlessExclusionReason call in that scan — each of those used to call listTodos
 *  internally (via hasOpenChildren), so a per-todo loop over N candidates cost O(N)
 *  FULL-TABLE reads (O(n^2) SQLite reads per tick). Exported so tests (and any other
 *  caller with a todos array already in hand, e.g. a fixture list) can build one directly
 *  instead of hand-rolling the grouping. */
export function buildChildrenIndex(todos: Todo[]): Map<string, Todo[]> {
  const idx = new Map<string, Todo[]>();
  for (const t of todos) {
    if (!t.parentId) continue;
    const arr = idx.get(t.parentId);
    if (arr) arr.push(t);
    else idx.set(t.parentId, [t]);
  }
  return idx;
}

/** Containerhood is about OPEN work: a child that is `done` or `dropped` no longer makes its
 *  parent a container. Without the `dropped` clause, the documented way to DECLINE a split
 *  (drop the children) bricked the parent forever — `not-headless: has-children`, unclaimable,
 *  with no path back to being a leaf (observed 2026-07-08).
 *
 *  Mirrors planCoordinatorTick's `openChildParents` guard (coordinator-core.ts) — same rule,
 *  same two terminal statuses. Uses includeCompleted:true + an explicit filter rather than
 *  leaning on listTodos' implicit `status != 'done'`, so the rule is readable in one place. */
function hasOpenChildren(childrenIndex: Map<string, Todo[]>, todoId: string): boolean {
  const children = childrenIndex.get(todoId);
  if (!children) return false;
  return children.some((t) => t.status !== 'dropped' && t.status !== 'done');
}

/** A leaf the headless executor may drive: a work todo with NO children (a leaf in
 *  the work-graph) that is not human-owned. Keeps gates/epics/missions/human todos out
 *  of the executor (those go the legacy path). `childrenIndex` is a per-tick snapshot
 *  from buildChildrenIndex — build it ONCE per scan, not once per todo (see that
 *  function's doc for why). */
export function isHeadlessLeaf(todo: Todo, childrenIndex: Map<string, Todo[]>): boolean {
  if (todo.assigneeKind === 'human') return false;
  if (isEpic(todo) || isMission(todo)) return false;
  // Dead-letter kind: no production path mints 'land' anymore, but a legacy row
  // could still exist pre-backfill. Defensive skip, not a safety boundary.
  if (isLand(todo)) return false;
  if (kindOf(todo) === 'gate') return false;
  // NOTE: 'reviewer' leaves USED to be excluded here (a review's deliverable is a judgment,
  // not a commit, so the code path's work-committed re-verify wrongly reversed accept→ready —
  // the L7 case). That exclusion stranded every epic that ends with a completeness-review leaf
  // before review→[LAND]. FIXED (epic d8ac1a18): the leaf-executor now has a 'review' execution
  // shape (leafExecutionMode → runReviewPipeline) whose deliverable IS a committed report, so
  // it survives the re-verify exactly like the 'verify' shape. Reviewer leaves are now headless.
  // Leaf = no OPEN child todos parented to it in the tracking work-graph.
  return !hasOpenChildren(childrenIndex, todo.id);
}

/** P7 Phase-2 coverage probe: WHY is `todo` not a headless leaf? Returns the
 *  exclusion reason (the inverse of isHeadlessLeaf, in the same order), or null
 *  when it IS headless. Used only to LOG tmux-fallback claims while the executor is
 *  default-on, so we can prove — before deleting the tmux lane — that every claim
 *  that still falls through is an EXPECTED non-work exclusion (human/epic/mission/gate/
 *  reviewer/parent) and never a genuine work leaf that would strand. Pure/read-only.
 *  `childrenIndex` — see isHeadlessLeaf: one per-tick snapshot, not one per todo. */
export function headlessExclusionReason(todo: Todo, childrenIndex: Map<string, Todo[]>): string | null {
  if (todo.assigneeKind === 'human') return 'human';
  if (isEpic(todo) || isMission(todo)) return 'epic-or-mission';
  if (isLand(todo)) return 'land';
  if (kindOf(todo) === 'gate') return 'gate';
  // 'reviewer' is no longer excluded — it runs the 'review' execution shape (epic d8ac1a18).
  if (hasOpenChildren(childrenIndex, todo.id)) return 'has-children';
  return null;
}

// One WorktreeManager per target-repo root (memoised). Records + worktrees live
// under <repo>/.collab/agent-sessions to match the AgentSessionRegistry default,
// so launchWorker (ensure) and completeTodo (merge-back) key off the same store.
//
// shared with coordinator-land: this file's launchWorker/completeTodo AND every
// landing-subsystem function in coordinator-land.ts resolve their WorktreeManager
// through this one memoised map — kept here (not duplicated) and imported back.
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
// Each epic-kind root gets its OWN accumulation branch off master (collab/epic/<id8>);
// children of that epic accumulate on it. resolveEpicId walks a todo's parentId
// chain (via getTodo, in the TRACKING project where the work-graph lives) to the
// nearest epic-kind ancestor and returns its id — the token epicBranchName hashes to
// the per-epic branch. A todo with no epic-kind ancestor falls back to the synthetic
// single Inbox epic (INBOX_EPIC_ID) so every todo still maps to exactly one branch.
// Cycle- and depth-guarded against a malformed parent chain.

/** Resolve the epic root id for `todo` by walking parentId via getTodo in
 *  `project` (the tracking store). Returns INBOX_EPIC_ID when no epic-kind ancestor
 *  exists. Exported for unit testing.
 *  shared with coordinator-land: both this file's completeTodo/gate wiring AND the
 *  moved landing subsystem (missionLandLeafPromotion's caller, landEpic) resolve an
 *  epic id through this one walk — kept here and imported back. */
export function resolveEpicId(todo: Todo, project: string): string {
  let cur: Todo | null | undefined = todo;
  const seen = new Set<string>();
  let depth = 0;
  while (cur && depth < 50) {
    if (isEpic(cur)) return cur.id;
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

// --- verify-only / already-satisfied leaf (estimatedFiles:0) ----------------------
// 3rd flavour of the no-commit edge (todo 231d10d4; sibling of the reviewer-leaf
// case). When a leaf's BLUEPRINT determines the work is ALREADY DONE — its size
// manifest declares `estimatedFiles: 0` (verify-only) — the implement/review nodes
// run with no edits, review PASSes, and there is NO commit. That clean-lane, nothing-
// committed shape is the EXPECTED, CORRECT outcome for such a leaf, NOT a hallucinated
// completion. Both no-commit reversal sites must recognise it and accept the verified
// no-op instead of downgrading to 'pending' (verifyWorkCommitted) or reversing to
// 'ready' (reopenStrandedAccept):
//   - verifyWorkCommitted: a verify-only leaf is read AFTER the dirty/ahead/on-branch
//     positive checks, so we only reach here on a genuinely clean lane — exactly when
//     a no-op is legitimate.
//   - the completeTodo callback's merge-back: a verify-only leaf either reports
//     integrated:false (clean worktree, nothing merged) OR — the path it actually hits —
//     THROWS 'no worktree' because its clean lane was already torn down at accept-time.
//     Both skip the stranded-accept reversal for a verify-only leaf and let it stand.
// Reads the size manifest from the BLUEPRINT node's recorded output in the worker
// ledger (getLeafRun) — the DURABLE source. The blueprint node emits its manifest as
// a trailing ```json fence in its final message, which the executor records to the
// ledger regardless of whether the model also wrote the .md to disk (it often does
// NOT, and the lane worktree is torn down at accept anyway — so neither the on-disk
// file nor the worktree is reliable here). Scoped to leaf-executor leaves — the legacy
// tmux lane records no leaf run, so getLeafRun is null and this is a no-op for it.
// Best-effort: any error / no run / unparseable manifest ⇒ false (today's behaviour).
function leafNoCommitExpected(todoId: string): boolean {
  try {
    const run = getLeafRun(todoId);
    if (!run) return false;
    // Latest blueprint node (a fresh attempt emits one each) carries the manifest.
    const bp = [...(run.nodes ?? [])].reverse().find((n) => n.nodeKind === 'blueprint');
    if (!bp?.outputText) return false;
    const manifest = parseSizeManifest(bp.outputText);
    return manifest != null && manifest.estimatedFiles === 0;
  } catch {
    return false;
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

// --- OI-1 loop-bound: cap stranded-accept reopens -------------------------------
// reopenStrandedAccept re-surfaces an un-integratable leaf as `ready` so a worker
// re-does it. But if the LAND itself is structurally stuck (e.g. the work was
// salvaged to the integration branch out-of-band, so the leaf's OWN commit can
// never become an ancestor; or the epic→integration land keeps conflicting),
// re-doing produces another commit that ALSO won't integrate — an infinite
// re-claim/re-build loop that burns the model budget forever (observed live:
// build123d A1 "dump_plan core" looped ~5h at `drive`). Bound it: after N reopens
// for the same leaf, stop re-surfacing and PARK it held + escalate, exactly like
// the lease-retry-exhaust path, so a human integrates it once instead of the
// daemon rebuilding it endlessly.
// STRANDED_REOPEN_CAP moved to harness-caps.ts (the harness's single loop-breaker cap
// surface); imported above and re-exported here so existing importers (tests) keep
// working unchanged.
export { STRANDED_REOPEN_CAP };

/** How many times THIS leaf has already been reversed as not-on-integration. */
export function countStrandedReversals(project: string, todoId: string): number {
  try {
    return listSupervisorAudit({ project, kind: 'reconcile', limit: 1000 }).filter((r) => {
      try {
        const d = JSON.parse((r as { detail?: string }).detail ?? '{}');
        return d.todoId === todoId && d.oi1 === 'reversed-not-on-integration';
      } catch { return false; }
    }).length;
  } catch { return 0; }
}

/** Park a leaf whose acceptance can't be integrated after repeated reopens: hold it
 *  (not claimable → the loop stops) + escalate for manual integration. Mirrors
 *  reopenStrandedAccept's epic re-open, but parks `blocked`/held instead of `ready`. */
async function parkStrandedAccept(
  project: string,
  todoId: string,
  epicId: string,
  rolledUp: string[],
  title: string,
  intRef: string,
  session: string,
  reversals: number,
): Promise<void> {
  try {
    // resetTodo('blocked') translates to a HOLD (heldAt set) → isClaimable=false, so
    // the daemon stops re-claiming it. (resetTodo auto-resolves stale escalations, so
    // raise the new one AFTER.)
    await resetTodo(project, todoId, 'blocked');
    for (const ep of rolledUp) await resetTodo(project, ep, 'in_progress').catch(() => {});
    createEscalation({
      project,
      session,
      todoId,
      kind: 'blocker',
      questionText: `Stranded acceptance could NOT be integrated after ${reversals} re-attempts: "${title}" keeps being accepted but its commit never becomes reachable from ${intRef}, and the epic→integration land keeps failing. Re-building won't help (the land is structurally stuck — e.g. the work was merged to the integration branch out-of-band). PARKED (held) to stop the re-claim loop. Integrate the epic / mark this todo done by hand, then clear the hold.`,
    });
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, intRef, oi1: 'parked-held-reopen-cap', reversals }) });
  } catch (e) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, intRef, oi1: 'park-held-failed', reason: e instanceof Error ? e.message : String(e) }) });
  }
}

/** HARD RE-DISPATCH CAP park (loop breaker). A todo dispatched MAX_REDISPATCH times
 *  without converging is re-blueprinting on a loop. PARK it held (resetTodo 'blocked' →
 *  heldAt set → not claimable, so the daemon stops re-dispatching) and raise ONE human
 *  blocker escalation so a human or the conductor investigates the root cause. reset_todo
 *  clears retryCount → the count restarts if the cause is fixed. Mirrors parkStrandedAccept. */
async function parkRedispatchCap(project: string, todoId: string, title: string, dispatches: number): Promise<void> {
  const session = 'coordinator';
  try {
    // resetTodo('blocked') → HOLD (heldAt set); it also auto-resolves stale escalations,
    // so raise the new blocker AFTER.
    await resetTodo(project, todoId, 'blocked');
    createEscalation({
      project,
      session,
      todoId,
      kind: 'blocker',
      questionText: `Re-dispatch cap: "${title}" has been dispatched ${dispatches}× without reaching done/accepted — each dispatch re-runs (and re-pays) a full blueprint, so this is a LOOP, not progress. PARKED (held) to stop the re-blueprint burn. Investigate the root cause (\`leaf_inspect ${todoId.slice(0, 8)}\` for the failure/parseError), fix the leaf spec / a bad constraint or drop it, then \`reset_todo\` to grant a fresh attempt.`,
    });
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, redispatchCap: MAX_REDISPATCH, dispatches, oi1: 'parked-held-redispatch-cap' }) });
  } catch (e) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, redispatchCap: MAX_REDISPATCH, park: 'failed', reason: e instanceof Error ? e.message : String(e) }) });
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
  // OI-1 A1 re-key: the master-reachability gate accompanies AUTO-LANDING, so it applies exactly
  // when the epic is auto-land-authorized (a live mission epic + armed) — NOT keyed on level.
  // A mission epic at level `on` now GETS the gate (previously skipped because level != 'auto'),
  // closing the silent-strand class. Empty/hallucinated completions are STILL caught by
  // resolveCompletion's work-committed re-verify, so skipping here is safe.
  const allTodos = listTodos(project, { includeCompleted: true });
  if (!epicAutoLandAuthority(project, epicId, allTodos)) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, oi1: 'skip-not-autoland-authorized' }) });
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
    stampEpicLandedAt(project, epicId, new Date().toISOString());
    return true;
  }

  // 2. NOT reachable yet — one-shot idempotent epic→integration land reconcile.
  // landEpicToMaster is a no-op when nothing is ahead (already up to date); a
  // conflict leaves integration untouched and we fall through to reversal below.
  let landConflict = false;
  try {
    const land = await wm.landEpicToMaster(epicId, { baseRef: intRef });
    landConflict = land.conflict === true;
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, intRef, oi1: 'land-reconcile', landed: land.landed, conflict: land.conflict, reason: land.reason }) });
    if (land.landed === true) {
      stampEpicLandedAt(project, epicId, new Date().toISOString());
    }
  } catch (e) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, intRef, oi1: 'land-reconcile-error', reason: e instanceof Error ? e.message : String(e) }) });
  }

  // 3. re-probe after the reconcile attempt.
  reachable = await wm.commitOnIntegration(epicId, todoId, intRef);
  if (reachable === true) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, intRef, oi1: 'reachable-after-land' }) });
    stampEpicLandedAt(project, epicId, new Date().toISOString());
    return true;
  }
  if (reachable === null) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId, epicId, intRef, oi1: 'indeterminate-after-land-accept' }) });
    return true; // fail-safe.
  }

  // Genuinely stranded. Re-doing the leaf only helps if the NEXT build can integrate;
  // if it's failed to integrate repeatedly, re-surfacing it `ready` just loops forever
  // (the build123d A1 ~5h burn). Bound it: under the cap, reverse to `ready` for a
  // re-attempt; at/over the cap, PARK held + escalate so a human integrates it once.
  const reversals = countStrandedReversals(project, todoId);
  // A merge CONFLICT at epic→integration (e.g. a long-stale epic that now conflicts with the
  // integration ref) is STRUCTURAL — re-building the leaf can never resolve it, so reversing
  // for a re-attempt just burns claim/quota cycles until the cap. Park-held IMMEDIATELY on a
  // conflict (a human must rebase/resolve the epic). Only the non-conflict strand (a transient
  // integration miss) benefits from the capped re-attempt below.
  if (landConflict || reversals >= STRANDED_REOPEN_CAP) {
    await parkStrandedAccept(project, todoId, epicId, rolledUp, title, intRef, session, reversals);
    return false;
  }
  // reopenStrandedAccept resets the leaf to `ready` (actionable) and raises an
  // escalation; we annotate the reason as integration-unreachable (counted above).
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
  const allTodos = listTodos(project, { includeCompleted: true });
  const out: Todo[] = [];
  for (const t of todos) {
    // A1 re-key (per-epic): the integration-reachability test only makes sense where the
    // dependent's OWN epic auto-lands (live mission epic + armed). Otherwise the foundation
    // legitimately lives on the epic accumulation branch — keep the todo (fail-safe preserved).
    if (!epicAutoLandAuthority(project, resolveEpicId(t, project), allTodos)) { out.push(t); continue; }
    let foundationStranded = false;
    for (const depId of t.dependsOn ?? []) {
      const dep = getTodo(project, depId);
      // Only a DONE dep can be a (claimed-as-satisfied) foundation; a not-done dep
      // already excludes the dependent via depSatisfied, so it's not our concern.
      if (!dep || dep.status !== 'done') continue;
      try {
        const wm = getWorktreeManager(dep.targetProject ?? project);
        if (!(await wm.isGitRepoPublic())) continue; // fail-safe: non-git → satisfied
        const depEpicId = resolveEpicId(dep, project);
        // UNION REACHABILITY (claim-time surface fix). The foundation is satisfied if
        // its commit is reachable from EITHER surface the dependent's worker lane can
        // see; stranded ONLY if reachable from NEITHER:
        //   ARM A — trunk (`resolveIntegrationRef`): the OI-1 accept-time surface; admits
        //           any foundation already LANDED (in-epic or cross-epic).
        //   ARM B — the DEPENDENT's OWN epic accumulation branch tip: the base its lane
        //           forks from. An on-epic-branch foundation (a same-epic sibling accepted
        //           earlier, accumulated but NOT yet human-LANDed) IS already visible to it.
        // Trunk-only (the old behaviour) wrongly stranded EVERY in-epic sibling of an auto
        // epic whose human [LAND] hadn't run — the foundation lived on the epic branch, not
        // trunk. This union is STRICTLY more permissive than trunk-only (trunk is arm A), so
        // it can never newly-strand anything the old test passed. FAIL-SAFE preserved: a
        // true/null on EITHER arm → satisfied (uncertainty never blocks).
        const intRef = await wm.resolveIntegrationRef();
        const reachableTrunk = intRef
          ? await wm.commitOnIntegration(depEpicId, depId, intRef)
          : null;
        // Arm B runs in the DEPENDENT's repo against the DEPENDENT's epic branch.
        const wmT = getWorktreeManager(t.targetProject ?? project);
        const tEpicBranch = wmT.epicBranchName(resolveEpicId(t, project));
        const reachableEpic = await wmT.commitOnIntegration(depEpicId, depId, tEpicBranch);
        if (reachableTrunk === false && reachableEpic === false) {
          foundationStranded = true;
          recordSupervisorAudit({ kind: 'reconcile', project, session: '', detail: JSON.stringify({ todoId: t.id, depId, intRef, epicBranch: tEpicBranch, bp1: 'blocked-stranded-foundation' }) });
          // DURABLE FIX: never strand SILENTLY. A done+accepted foundation whose commit
          // isn't reachable from integration (e.g. salvaged/committed out-of-band without
          // the Collab-Todo trailer the merge-back stamps) would otherwise drop EVERY
          // dependent from the claimable set on every tick, forever, with NO signal —
          // exactly how Epic A's A2/A3 sat dead behind a done A1. Surface it ONCE (the
          // (project,session,questionText) dedup + the stable per-foundation text keep it
          // to a single card) so a human re-integrates/stamps the foundation. Best-effort.
          try {
            createEscalation({
              project,
              session: 'bp1-stranded-foundation',
              todoId: depId,
              kind: 'assumption-invalidated',
              questionText: `Dependents are blocked at \`drive\`: foundation todo ${depId} is done+accepted, but its commit is reachable from NEITHER trunk (${intRef ?? 'unresolved'}) NOR the dependent's epic branch (${tEpicBranch}) — i.e. its work never reached the epic accumulation branch (no Collab-Todo trailer; e.g. landed out-of-band). Its dependents can't be claimed until it's integrated. Fix: re-land/merge the foundation onto ${tEpicBranch} (stamping its trailer), or drop the project to \`build\` to build dependents on the epic branch instead.`,
            });
          } catch { /* never block the claim pass on escalation bookkeeping */ }
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

// --- TRANSPARENCY: why is a project not claiming? -------------------------------
// The claim pipeline (claimGuard) silently DROPS ready leaves for several distinct
// reasons — over daily budget, an open rate-cap breaker, a failing env probe, a
// stranded foundation (stale base), or a non-headless todo. From the outside you see
// only "auto, ticking, 0 in_progress" and have to grep reconcile-audit blobs to learn
// why (observed live: 20min spelunking to find a single bp1:blocked-stranded-foundation).
// This runs the SAME predicates the tick uses — in the SAME order — but REPORTS the
// reason each ready leaf was held instead of filtering silently. Reusing the real
// functions (not a reimplementation) guarantees it can't drift from actual behavior.
export interface ClaimSuppressionReport {
  level: ReturnType<typeof getOrchestratorLevel>;
  ready: number;
  claimable: number;
  /** Project-wide gate that suppresses ALL claiming this tick, or null. */
  projectGate: 'over-daily-budget' | 'breaker-open' | null;
  /** Per-leaf hold reasons (only the suppressed ones). */
  suppressed: Array<{ todoId: string; title: string; reason: string }>;
  claimableIds: string[];
  /** Split parents with unapproved open children — the project is BLOCKED ON A DECISION,
   *  not idle. Non-empty ⇒ `claimable: 0` is NEVER quiescence. */
  blockedSplits: import('./claimability').BlockedSplit[];
  /** SR-3: open split PROPOSALS (raised, no children yet). Non-empty ⇒ a decision is pending. */
  pendingSplitProposals: Array<{ escalationId: string; todoId: string | null; createdAt: number }>;
  /** blockedSplits.length > 0 || pendingSplitProposals.length > 0. */
  blocked: boolean;
}

export async function diagnoseClaimSuppression(project: string): Promise<ClaimSuppressionReport> {
  const level = getOrchestratorLevel(project);
  const ready = listReadyTodos(project);
  const mk = (reason: string) => ready.map((t) => ({ todoId: t.id, title: displayTitle(t), reason }));
  // One full-table snapshot for the whole diagnostic pass: findBlockedSplits needs it,
  // and the childrenIndex built from it is threaded into isHeadlessLeaf/
  // headlessExclusionReason below instead of each re-querying per candidate.
  const allTodosSnapshot = listTodos(project, { includeCompleted: true });
  const childrenIndex = buildChildrenIndex(allTodosSnapshot);
  const blockedSplits = findBlockedSplits(allTodosSnapshot);
  const pendingSplitProposals = listOpenSplitProposals(project);
  const blocked = blockedSplits.length > 0 || pendingSplitProposals.length > 0;
  // Project-wide gates short-circuit the whole set (mirror claimGuard's early returns).
  if (overDailyBudget(project)) {
    return { level, ready: ready.length, claimable: 0, projectGate: 'over-daily-budget', suppressed: mk('over-daily-budget'), claimableIds: [], blockedSplits, pendingSplitProposals, blocked };
  }
  // Per-leaf pipeline, in claimGuard order: probe → stranded-foundation → headless.
  const ids = (ts: Todo[]) => new Set(ts.map((t) => t.id));
  const afterProbe = await filterClaimable(ready);
  const probeOk = ids(afterProbe);
  const afterBp1 = await bp1FilterStrandedFoundations(project, afterProbe);
  const bp1Ok = ids(afterBp1);
  const afterHeadless = afterBp1.filter((t) => isHeadlessLeaf(t, childrenIndex));
  const headlessOk = ids(afterHeadless);
  const suppressed = classifyClaimSuppression(
    ready.map((t) => ({ id: t.id, title: displayTitle(t), claimProbe: t.claimProbe ?? null, notHeadlessReason: headlessExclusionReason(t, childrenIndex) })),
    probeOk, bp1Ok, headlessOk,
  );
  // The breaker gate applies AFTER the per-leaf filters in claimGuard, suppressing the
  // remaining set; report it as the project gate when open (the per-leaf reasons above
  // still hold and are kept for detail).
  const projectGate = breakerOpen() ? 'breaker-open' as const : null;
  const claimable = projectGate ? [] : afterHeadless;
  return {
    level,
    ready: ready.length,
    claimable: claimable.length,
    projectGate,
    suppressed,
    claimableIds: claimable.map((t) => t.id),
    blockedSplits,
    pendingSplitProposals,
    blocked,
  };
}

/** Pure classification (exported for tests): given the ready leaves and the id-sets
 *  that SURVIVED each successive claimGuard filter, attribute each suppressed leaf to
 *  the FIRST filter that dropped it — same order claimGuard applies them (probe →
 *  stranded-foundation → headless). A leaf in all three sets is claimable (omitted). */
export function classifyClaimSuppression(
  ready: Array<{ id: string; title: string; claimProbe: string | null; notHeadlessReason: string | null }>,
  probeOk: Set<string>,
  bp1Ok: Set<string>,
  headlessOk: Set<string>,
): Array<{ todoId: string; title: string; reason: string }> {
  const out: Array<{ todoId: string; title: string; reason: string }> = [];
  for (const t of ready) {
    if (!probeOk.has(t.id)) out.push({ todoId: t.id, title: t.title, reason: `probe-down: ${t.claimProbe ?? '?'}` });
    else if (!bp1Ok.has(t.id)) out.push({ todoId: t.id, title: t.title, reason: 'stranded-foundation (dep accepted but reachable from neither trunk nor the epic branch — truly unintegrated; drops at auto only)' });
    else if (!headlessOk.has(t.id)) out.push({ todoId: t.id, title: t.title, reason: `not-headless: ${t.notHeadlessReason ?? 'unknown'}` });
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


// --- Corrupt-epic self-heal (falsely-stamped land leaf) --------------------------
// A land leaf marked done while its epic branch is STILL ahead of master (corrupt)
// is the false-stamp incident: the graph reads landed but master never got the work.
// buildEpicBranchStatus flags it git-derived (landLeafDone===true && ahead>0). Here we
// REVERT the false stamp — reset the land leaf to `ready` — so F1's observed-merge path
// re-attempts the land. Guarded STRICTLY on the git-derived `corrupt` flag (ahead>0),
// never on the stamp alone. Best-effort; one bad epic never aborts the sweep.
export const CORRUPT_EPIC_SWEEP_INTERVAL_MS = 90 * 1000; // ~3 ticks — prompt but not per-tick
/** module-level last-corrupt-sweep-time per project (key = tracking project root). */
const lastCorruptEpicSweepAt = new Map<string, number>();

/** Exported for tests: reset the corrupt-sweep throttle so the next sweep runs immediately. */
export function _resetCorruptEpicSweepState(): void {
  lastCorruptEpicSweepAt.clear();
}

export async function sweepCorruptEpics(
  project: string,
  opts?: { force?: boolean; now?: number; report?: EpicBranchStatusReport },
): Promise<string[]> {
  const now = opts?.now ?? Date.now();
  const last = lastCorruptEpicSweepAt.get(project) ?? 0;
  if (!opts?.force && now - last < CORRUPT_EPIC_SWEEP_INTERVAL_MS) return [];
  lastCorruptEpicSweepAt.set(project, now);

  const report = opts?.report ?? getEpicBranchStatus(project);
  const reopened: string[] = [];
  for (const e of report.epics) {
    if (!e.corrupt) continue;          // git-derived: landLeafDone===true && ahead>0
    if (!e.landLeafId) continue;       // nothing to reopen
    try {
      await resetTodo(project, e.landLeafId, 'ready'); // revert the false stamp
      reopened.push(e.landLeafId);
      recordSupervisorAudit({
        kind: 'reconcile',
        project,
        session: 'coordinator',
        detail: JSON.stringify({ landLeaf: 'reopened-corrupt', epicId: e.epicId, landLeafId: e.landLeafId, ahead: e.ahead }),
      });
    } catch { /* one bad epic never aborts the sweep */ }
  }
  return reopened;
}

// --- Dropped-epic worktree release (H6a) -----------------------------------------------
// A DROPPED epic leaves its accumulation worktree on disk. Reclaim the checkout dir
// but KEEP the branch (it may hold unlanded commits). A DIRTY worktree is never
// destroyed — we skip it and record a friction note so the uncommitted work is visible.
export const DROPPED_EPIC_SWEEP_INTERVAL_MS = 90 * 1000; // ~3 ticks — prompt but throttled
const lastDroppedEpicSweepAt = new Map<string, number>();

/** Exported for tests: reset the dropped-epic throttle so the next sweep runs now. */
export function _resetDroppedEpicSweepState(): void {
  lastDroppedEpicSweepAt.clear();
}

/** Pure: the epics currently in status 'dropped' — worktree-release candidates. */
export function droppedEpicCandidates(todos: Todo[]): Todo[] {
  return todos.filter((t) => t.kind === 'epic' && t.status === 'dropped');
}

export async function releaseDroppedEpicWorktrees(
  project: string,
  opts?: { force?: boolean; now?: number },
): Promise<string[]> {
  const now = opts?.now ?? Date.now();
  const last = lastDroppedEpicSweepAt.get(project) ?? 0;
  if (!opts?.force && now - last < DROPPED_EPIC_SWEEP_INTERVAL_MS) return [];
  lastDroppedEpicSweepAt.set(project, now);

  const released: string[] = [];
  const candidates = droppedEpicCandidates(listTodos(project, { includeCompleted: true }));
  for (const epic of candidates) {
    try {
      const wm = getWorktreeManager(epic.targetProject ?? project);
      if (!(await wm.isGitRepoPublic())) continue;
      const wtPath = wm.epicWorktreePath(epic.id);
      const status = await wm.statusAt(wtPath);
      if (status === null) {
        // Worktree already gone, but the branch can still strand in listUnlandedEpics() —
        // archive it independently (renameEpicBranchToDropped is standalone + idempotent).
        if (await wm.renameEpicBranchToDropped(epic.id)) released.push(epic.id);
        continue;
      }
      if (status.length > 0) {
        // DIRTY — never destroy uncommitted work; record friction and move on.
        await recordFriction(project, {
          todoId: epic.id,
          layer: 'operational',
          retryReason: 'dropped-epic-worktree-dirty',
          detail: `Dropped epic ${epic.id.slice(0, 8)} worktree is dirty (${status.length} change(s)); ` +
            `skipped removal to preserve uncommitted work. Sample: ${status.slice(0, 5).join('; ')}`,
        });
        continue;
      }
      await wm.removeEpicWorktree(epic.id, { keepBranch: true });
      await wm.renameEpicBranchToDropped(epic.id);
      released.push(epic.id);
    } catch { /* one bad epic never aborts the sweep */ }
  }
  if (released.length > 0) {
    recordSupervisorAudit({
      kind: 'reconcile',
      project,
      session: 'coordinator',
      detail: JSON.stringify({ source: 'reconcile-pass', droppedEpicWorktreeRelease: released }),
    });
  }
  return released;
}




/**
 * Arming gate for the intrinsic mission-membership auto-land authority (C1). The authority is
 * DERIVED (isMissionEpic && green proof) and audited every tick, but stays DISARMED until P0
 * 0949289b Part 2 (post-land stale-checkout tree corruption) is fully fixed — CONSTRAINT
 * 020b7ab1: build the new autonomy path, do not enable it unattended while that P0 is open.
 * Flip to true (with the P0 closed) to arm; no other change required.
 *
 * ARMED 2026-07-11 (v6.17.15): P0 0949289b Part 2 is fixed at the SOURCE (worktree-manager land
 * self-syncs the on-master checkout after the ref advance) AND confirmed live via a throwaway
 * proof-land — the 13th land and the first that self-healed (post-land write-tree == HEAD^tree,
 * zero manual tripwire). The daemon now auto-lands a mission epic that reaches a GREEN land proof
 * (children accepted + tsc-clean + dry-merge-clean + subset verify). DEPLOY stays human-gated and
 * STRICTLY SEPARATE (deploy_self). Disarm by flipping back to false, or via steward_pause /
 * orchestrator off.
 *
 * shared with coordinator-land: kept in THIS file (not moved with the rest of the
 * landing subsystem) because epicAutoLandAuthority below is also consumed by
 * accept-time code that stayed here (acceptTimeAncestorGate, bp1FilterStrandedFoundations)
 * — coordinator-land.ts imports isMissionEpic/MISSION_AUTOLAND_ARMED/epicAutoLandAuthority
 * back from here rather than duplicating them.
 */
export const MISSION_AUTOLAND_ARMED = true;


// STUCK_AUTOLAND_THRESHOLD (threshold of consecutive identical red reasons before the
// operator card surfaces) moved to harness-caps.ts (the harness's single loop-breaker
// cap surface); imported directly by coordinator-land.ts (the stuck-auto-land counter
// it gates now lives there).

/** An epic is a "mission epic" when it has an owning mission that is active and non-terminal.
 *  Mirrors land-authority Rules 3-4 (findOwningMission + active/non-terminal), minus the
 *  conductor-session ownership check — the daemon is the actor here, not a conductor.
 *  shared with coordinator-land: see the MISSION_AUTOLAND_ARMED note above. */
export function isMissionEpic(project: string, epicId: string, todos: Todo[]): boolean {
  const { mission } = findOwningMission(todos, epicId);
  if (!mission) return false;
  const row = getMission(project, mission.id);
  return !!row?.active && !isMissionTerminal(row);
}

/** Single source of truth for "may the daemon AUTO-LAND this epic?" (mission criterion A1).
 *  TRUE iff the epic is a live mission epic AND the mission-autoland path is armed. PURE apart
 *  from the mission-row read inside isMissionEpic. Deliberately level-agnostic: the off/on/auto
 *  ladder no longer gates the reachability sites (OI-1 accept gate, bp1 claim filter,
 *  surfaceEpicLand). The `off` brake lives in the reconcile pass being level-gated, not here.
 *  shared with coordinator-land: called by BOTH this file's acceptTimeAncestorGate /
 *  bp1FilterStrandedFoundations (accept-time, stayed here) AND the moved surfaceEpicLand
 *  (landing subsystem, coordinator-land.ts) — kept here and imported back rather than split. */
export function epicAutoLandAuthority(project: string, epicId: string, todos: Todo[]): boolean {
  return MISSION_AUTOLAND_ARMED && isMissionEpic(project, epicId, todos);
}

/** A3 (crit_f1404796_8): may the daemon AUTO-RESOLVE a triage suggestion whose linked todo is
 *  `todoId`? TRUE iff the todo chain resolves to an epic owned by an ACTIVE, non-terminal mission
 *  (reuses isMissionEpic). Walks the passed `todos` array (cycle- + depth-guarded), so it is pure
 *  over its inputs. Mission-scoped replacement for the removed per-project `auto` level: all
 *  non-mission escalations stay SUGGEST. */
export function todoIsMissionScoped(project: string, todoId: string, todos: Todo[]): boolean {
  const byId = new Map(todos.map((t) => [t.id, t]));
  let cur: Todo | undefined = byId.get(todoId);
  const seen = new Set<string>();
  let depth = 0;
  while (cur && depth < 50) {
    if (isEpic(cur)) return isMissionEpic(project, cur.id, todos);
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    if (!cur.parentId) break;
    cur = byId.get(cur.parentId);
    depth++;
  }
  return false;
}


/** Wire the Coordinator daemon to the real todo-store + a live worker launcher. */
export function makeCoordinatorDeps(): CoordinatorDeps {
  // Progress reader for 0-node kill detection: durable nodesSpent === 0 ⇒ no progress.
  const leafHadProgress = (project: string) => (id: string) => (getLeafResume(project, id)?.nodesSpent ?? 0) >= 1;
  return {
    // Push daemon-driven todo-status changes to the UI (the Bridge otherwise only
    // hears session_todos_updated from MCP tool calls, so a server-side block/reclaim
    // left a stale in-flight card). Best-effort; never throws.
    notifyTodosChanged: (project: string) => {
      try { getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' } as any); }
      catch { /* broadcast is best-effort */ }
    },
    // A reaper/sweep step threw and runTick swallowed it (must-not-abort-the-tick
    // contract) — surface it into the audit trail instead of leaving it silent, so a
    // reaper that starts throwing every tick is observable (open-problem #10/obs).
    onTickError: (project: string, step: string, err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      recordSupervisorAudit({ kind: 'reconcile', project, session: '', detail: JSON.stringify({ tickError: step, reason }) });
    },
    // Concurrent-dispatch budget = the per-project pool size (uniform across types),
    // defaulting to DEFAULT_SLOTS_PER_TYPE when unset. Lets the daemon run up to N
    // headless leaves at once instead of awaiting each serially.
    maxConcurrency: (project: string) => getProjectPoolSize(project) ?? DEFAULT_SLOTS_PER_TYPE,
    // Fire-and-track concurrency limiter: wiring BOTH switches the daemon tick to the
    // fire-and-track dispatch path (claim+launch up to the global+per-project caps, then
    // return — never await a leaf run). launchWorker (below) fires the leaf and releases
    // its slot in the run continuation.
    reserveLeafSlot,
    releaseLeafSlot,
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
      // S4 (epic b2c858d4): the daemon can ONLY launch HEADLESS LEAVES (node-invoker spawns).
      // A non-headless-leaf that is isClaimable (e.g. an epic/mission/[GATE] left status='ready')
      // would otherwise be claimed → launchWorker rejects (excl: epic-or-mission/gate) → released every tick —
      // pure churn, and a livelock when any release fires a kick. Pre-filter so it's NEVER
      // claimed. (Defense-in-depth with dropping the releaseClaim capacity-kick.)
      // ONE full-table snapshot for this tick's filter (only when there's still something to
      // filter) — isHeadlessLeaf used to call listTodos per candidate here, so this loop alone
      // was an O(n) full-table reads per tick (O(n^2) across n ticks' worth of candidates).
      if (claimable.length > 0) {
        const childrenIndex = buildChildrenIndex(listTodos(project, { includeCompleted: true }));
        claimable = claimable.filter((t) => isHeadlessLeaf(t, childrenIndex));
      }
      // P3 headless circuit-breaker: while the per-process cap window is open, hold ALL headless
      // leaves out too (the only thing left after the filter) — claim nothing this window.
      if (breakerOpen()) return [];
      return claimable;
    },
    // Wrapped to record coordinator lifecycle events into the supervisor audit
    // log → it doubles as the unified orchestration trace (open-problem #10/obs).
    claimTodo: async (project, id, claimedBy, leaseMs) => {
      const c = await claimTodo(project, id, claimedBy, leaseMs, COORDINATOR_EPOCH);
      if (c) recordSupervisorAudit({ kind: 'claim', project, session: c.sessionName ?? '', detail: JSON.stringify({ todoId: id, claimedBy }) });
      return c;
    },
    // HARDENING: pass run-liveness so a live leaf's claim is never lease-reaped (which
    // would spawn a duplicate run). isRunLive = whole run (incl. between nodes);
    // isLeafInflightLive = an active node. Either ⇒ skip the lease release for that row.
    releaseExpiredClaims: (project, now) => releaseExpiredClaims(project, now, (id) => isRunLive(id) || isLeafInflightLive(id), leafHadProgress(project)),
    completeTodo: async (project, id, acceptance, claimToken) => {
      // E2 ownership-CAS + token-scope (bf2eaf84): this is the fire-and-track worker
      // continuation. A run can finish minutes after it claimed — requireInProgress AND
      // the claim token gate the write so the completion applies ONLY if the todo is still
      // the in_progress claim THIS run owns (not a row re-claimed by another run).
      const r = await completeTodo(project, id, acceptance, undefined, { requireInProgress: true, claimToken });
      if (r.skipped) {
        // The todo was dropped / held / re-claimed / already terminal while this run
        // was in flight — it is no longer ours. DISCARD the outcome: no merge-back, no
        // accept side effects, no escalation. Clear the inflight row (the Bridge would
        // otherwise show a phantom in-flight run), free the slot, and audit the discard.
        try { clearLeafInflight(id); } catch { /* best-effort */ }
        const discardSession = r.completed.sessionName ?? '';
        const discardSlotProject = r.completed.targetProject ?? project;
        if (discardSession) markIdle(discardSlotProject, discardSession);
        recordSupervisorAudit({ kind: 'complete', project, session: discardSession, detail: JSON.stringify({ todoId: id, discarded: 'todo-no-longer-owned', status: r.completed.status }) });
        return r;
      }
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
      // epic-kind root has its own collab/epic/<id8> off master). A conflict leaves the
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
          // REVERTED 60e99489 (caused data loss): trusting the durable `merged` flag here
          // is UNSAFE — under concurrency a leaf's self-merge can set merged=1 yet its merge
          // commit never persists on the epic TIP (a sibling lane's simultaneous merge
          // overwrites the ref). The flag then LIES, and synthesizing integrated=true skips
          // the stranded-accept recovery → the leaf's work is silently lost (observed: BETA
          // orphaned, GAMMA=ALPHA+BETA tsc-broke). `todoOnEpicBranch` (reachable-from-tip) is
          // the AUTHORITATIVE check; its false-negative-under-concurrency re-dispatch is a
          // wasteful-but-SAFE recovery that actually re-lands the work. Real fix = serialize
          // the concurrent merge-back (bug 60e99489), not trust a stale flag.
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
              questionText: `Worker-isolation merge conflict: branch ${merge.workerBranch} could not merge into ${merge.epicBranch} for todo "${displayTitle(r.completed)}". Resolve the conflict manually, then merge the branch into ${merge.epicBranch}.`,
            });
            // DEFECT 3 — tear down the lane worktree so it can NEVER be reused stale
            // (a surviving worktree feeds the cached-reuse bug). `git worktree
            // remove` deletes only the worktree DIR — the worker's branch survives,
            // so the human's commit is preserved for manual integration.
            await wm.remove(session).catch(() => {});
            try { await killTmuxSession(tmuxBaseName(targetProject, session)); } catch { /* best-effort teardown */ }
            removeSlot(targetProject, session);
            recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, epicId, conflict: 'parked-blocked-teardown' }) });
          } else if (!merge.integrated && leafNoCommitExpected(id)) {
            // VERIFY-ONLY (todo 231d10d4): the merge reported nothing integrated because
            // there was genuinely nothing to integrate — the blueprint declared this a
            // no-op leaf (estimatedFiles:0, work already done). That clean-lane outcome is
            // EXPECTED, not a strand: keep the acceptance and tear the lane down as on a
            // normal integrated accept. (Mirrors the integrated branch's teardown.)
            recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, epicId, isolation: 'verify-only-noop-accept' }) });
            await wm.remove(session).catch(() => {});
            try { await killTmuxSession(tmuxBaseName(targetProject, session)); } catch { /* best-effort teardown */ }
            removeSlot(targetProject, session);
          } else if (!merge.integrated) {
            // BP0 INVARIANT: the merge reported success but the todo's work is NOT
            // on the epic branch (PHANTOM: a clean worktree with no commit; or a
            // lane whose commit never reached collab/epic/<id8>). `accepted` must
            // NOT survive that — the upstream guarantee is accepted ⇒ work-on-branch.
            // Reverse the premature acceptance: re-surface this todo (and any epic
            // the store just rolled up off the back of this child) and escalate.
            await reopenStrandedAccept(project, id, epicId, r.rolledUp, displayTitle(r.completed), merge.epicBranch, session);
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
              safe = await acceptTimeAncestorGate(project, id, epicId, r.rolledUp, displayTitle(r.completed), session);
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
            if (leafNoCommitExpected(id)) {
              // VERIFY-ONLY (todo 231d10d4): the merge-back threw because there was no
              // lane/worktree to merge — but the blueprint declared this a no-op leaf
              // (estimatedFiles:0, work already done), so "nothing to integrate" is the
              // EXPECTED outcome, not a strand. Keep the acceptance; just tear the lane
              // down. (This is the path verify-only leaves actually hit: a clean lane is
              // torn down by accept-time, so commitAndMergeToEpic throws 'no worktree'.)
              recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, epicId, isolation: 'verify-only-noop-accept-on-throw' }) });
              await wm.remove(session).catch(() => {});
              try { await killTmuxSession(tmuxBaseName(errTargetProject, session)); } catch { /* best-effort teardown */ }
              removeSlot(errTargetProject, session);
            } else if (!(await wm.todoOnEpicBranch(epicId, id))) {
              await reopenStrandedAccept(project, id, epicId, r.rolledUp, displayTitle(r.completed), wm.epicBranchName(epicId), session);
              try {
                createEscalation({
                  project,
                  session,
                  todoId: id,
                  kind: 'assumption-invalidated',
                  questionText: `Stranded leaf: todo "${displayTitle(r.completed)}" was accepted but its commit was NOT integrated onto its epic branch (merge-back failed: ${reason}). The work lives only on the worker's session branch — integrate it manually onto the epic branch, then it will land with the epic.`,
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
      // SAFETY VALVE 0 — HARD RE-DISPATCH CAP (loop breaker): a todo dispatched
      // MAX_REDISPATCH times without reaching done/accepted is looping — each dispatch
      // re-pays a full blueprint. PARK it held + escalate instead of paying another.
      // Checked BEFORE backoff so a capped todo is retired, not just slowed. reset_todo
      // clears retryCount, so a human/conductor can grant a fresh attempt post-fix.
      if ((todo.retryCount ?? 0) >= MAX_REDISPATCH) {
        await parkRedispatchCap(project, todo.id, todo.title ?? todo.id, todo.retryCount ?? 0);
        recordSupervisorAudit({ kind: 'spawn', project, session: '', detail: JSON.stringify({ todoId: todo.id, started: false, reason: 'redispatch-cap', dispatches: todo.retryCount ?? 0, cap: MAX_REDISPATCH }) });
        return false;
      }

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

      // P7 PHASE 2: the tmux CLI lane and the in-process grok-build/anthropic-core harnesses
      // are RETIRED — the headless leaf-executor (below) is the sole worker path. The pool
      // slot registry is still provider-tagged for lane-name back-compat, so pin a constant
      // 'claude' tag. (Collapsing the pool to a bare per-project concurrency limiter is a
      // later P7 step.)
      const provider: ProviderId = 'claude';

      let poolName = workerIsolationEnabled() ? undefined : findIdleSessionForType(poolProject, type, provider);
      if (!poolName) {
        const slot = getOrCreateSlot(poolProject, type, provider, getProjectPoolConfig(poolProject));
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

      // Headless leaf-executor (P7): the SOLE worker path — deterministic
      // blueprint→implement→review executor, always-on (the tmux escape hatch and
      // its LEAF_EXECUTOR gate were retired). The lane identity is already persisted
      // above (so the executor lane still shows in the fleet with a real sessionName).
      // On any auth-halt or hard error we release + escalate rather than silently
      // dropping the todo.
      // One snapshot for this single dispatch — shared by isHeadlessLeaf below and by
      // headlessExclusionReason further down (mutually exclusive branches of the same
      // check), so this call site still costs exactly one listTodos per launch, not two.
      const launchChildrenIndex = buildChildrenIndex(listTodos(project, { includeCompleted: true }));
      if (isHeadlessLeaf(todo, launchChildrenIndex)) {
        // P3 breaker gate: if the cap window is still open, do NOT spawn. Release the
        // claim so the todo returns to `ready` (the claimGuard filter normally holds
        // it out, but a todo claimed before the breaker tripped this tick can still
        // reach here). Transient hold — no escalation. The lease also backstops.
        if (breakerOpen()) {
          try { await releaseClaim(project, todo.id); } catch { /* lease backstops */ }
          return false;
        }
        // Count THIS dispatch toward the hard re-dispatch cap (SAFETY VALVE 0 above).
        // releaseExpiredClaims only bumps retryCount on LEASE EXPIRY, so a leaf that
        // finishes its run cleanly (e.g. raising a blocker/assumption escalation) would
        // otherwise re-dispatch forever with retryCount≈1 — the observed re-blueprint
        // burn. Bumping here (owned-guarded — we hold the claim) makes retryCount a true
        // per-dispatch counter so the cap actually fires. Best-effort: never block a dispatch.
        try { await bumpRetryCountIfOwned(project, todo.id, todo.claimToken ?? undefined); } catch { /* counter is telemetry — never break the dispatch */ }
        // FIRE-AND-TRACK: run the leaf in the BACKGROUND and return immediately so the
        // orchestrator tick is never blocked on a multi-minute leaf run (the coupling that
        // serialized the whole fleet). The leaf's in-flight slot was reserved by the tick
        // before this call; the continuation below releases it when the run settles, and
        // owns ALL post-run handling (audit, paused/breaker, resume, streak reset). On any
        // pre-launch failure (makeLeafExecutorDeps throws) the continuation releases the
        // claim + escalates, exactly as the prior inline path did.
        const ledProject = todo.targetProject ?? project;
        void (async () => {
          // E4: mark the run live for the same-epoch orphan-inflight sweep — removed in
          // the finally below on EVERY exit (normal/abort/throw), so a row left behind by
          // an aborted/errored run becomes reapable within a tick.
          markRunLive(todo.id);
          try {
            // P3 resume: carry the paused leaf's prior nodesSpent forward so the master
            // NODE_BUDGET bounds total spawns across all pause/resume cycles. The in-memory
            // breaker record is freshest (graceful pause); the DURABLE leaf_resume row
            // (slice 1b) is the fallback that survives a hard kill / hot-swap so a crashed
            // mid-run leaf doesn't reset its budget to 20 and redo blueprint+implement.
            const carried = pausedNodesSpent(project, todo.id) || getLeafResume(project, todo.id)?.nodesSpent || 0;
            // Captured at LAUNCH (this dispatch's claim token) — threaded into the executor's
            // shouldAbort so a later claim release/re-mint (a DIFFERENT run now owns the todo)
            // stops THIS run instead of racing the new owner.
            const launchToken = todo.claimToken ?? null;
            const execDeps = await makeLeafExecutorDeps(project, ledProject, todo, carried);
            execDeps.shouldAbort = (p, id) => leafAbortReason(p, id, launchToken);
            execDeps.clearResume = (id) => clearLeafResume(id);
            const res = await runLeaf(project, todo, execDeps);
            recordSupervisorAudit({ kind: 'spawn', project, session: poolName, detail: JSON.stringify({ todoId: todo.id, executor: 'leaf', outcome: res.outcome, attempts: res.attempts, nodesSpent: res.nodesSpent, reason: res.reason }) });
            if (res.outcome === 'aborted') {
              // The daemon (ancestor-drop cascade, hold, or a claim-loss it detected
              // elsewhere) already decided this todo's terminal state — do NOT
              // recordResume/resetBreakerStreak and do NOT releaseClaim (re-releasing
              // could stomp a claim a fresh run already took). Just clear this run's
              // own bookkeeping and stop.
              recordSupervisorAudit({ kind: 'reconcile', project, session: poolName, detail: JSON.stringify({ source: 'executor-aborted', todoId: todo.id, reason: res.reason }) });
              clearLeafInflight(todo.id);
              clearLeafResume(todo.id);
              return;
            }
            if (res.outcome === 'paused') {
              // The executor hit a rate cap and yielded WITHOUT backing off. The DAEMON
              // owns the response: trip the breaker (backoff/capReset), record the leaf
              // for exhaustion tracking, and release the claim so the ordinary claim
              // loop re-dispatches it once the breaker closes.
              tripBreaker(res.paused?.capReset);
              enqueuePausedLeaf(project, todo.id, res.paused!);
              // A live-process pause leaves no terminal node-finally to clear the leaf's
              // live in-flight row, and reapStaleInflight() only deletes OTHER-epoch
              // (dead-process) rows — so the row would linger and inflate daemon_status'
              // in-flight count until re-dispatch. The daemon owns the pause response, so
              // it also owns clearing the row here. Best-effort (telemetry never blocks).
              clearLeafInflight(todo.id);
              try { await releaseClaim(project, todo.id); } catch { /* lease backstops */ }
              return;
            }
            // A non-paused outcome is TERMINAL for this dispatch (accepted/blocked/
            // rejected/pending) — clear the in-memory paused record AND the durable
            // resume row so a future claim starts clean (no stale carried budget).
            recordResume(project, todo.id);
            clearLeafResume(todo.id);
            // P3 follow-up: an ACCEPTED leaf proves the account is serving again — reset the
            // backoff STREAK (not the whole breaker) so the next isolated cap starts at
            // BASE_BACKOFF_MS instead of inheriting a stale, ceiling-high consecutiveTrips.
            // G8: also clear the durable blueprint row so an accepted leaf's blueprint does
            // not linger forever.
            if (res.outcome === 'accepted') {
              resetBreakerStreak();
              clearLeafBlueprint(todo.id);
            }
          } catch (e) {
            try { await releaseClaim(project, todo.id); } catch { /* best-effort */ }
            // E4: an errored run never reached finishWith, so its run-spanning inflight
            // row would linger as a current-epoch phantom (and block reclaim via the
            // lease-fix guard). Clear it here. Best-effort — telemetry never blocks.
            try { clearLeafInflight(todo.id); } catch { /* best-effort */ }
            try {
              createEscalation({ project, session: poolName, kind: 'blocker', todoId: todo.id,
                questionText: `Leaf-executor failed for "${displayTitle(todo)}": ${e instanceof Error ? e.message : String(e)}` });
            } catch { /* escalation best-effort */ }
          } finally {
            // Release the in-flight slot the tick reserved for this leaf (fire-and-track
            // ownership: the tick handed the slot to this run when launchWorker returned true).
            releaseLeafSlot(ledProject);
            markRunDone(todo.id); // E4: run is over (any outcome) — drop run-level liveness
          }
        })();
        // Launched (fired). The tick records it as spawned and moves on without awaiting
        // the run; the continuation above owns completion + slot release.
        return true;
      }

      // P7 PHASE 2 — TMUX LANE RETIRED. The headless leaf-executor above is the SOLE
      // worker path; the legacy tmux CLI spawn and the in-process grok-build/anthropic-core
      // harnesses have been deleted. Reaching here means a CLAIMED todo is NOT a headless
      // leaf — which, for claimable WORK, isHeadlessLeaf coverage proved should not happen
      // (epic/mission/GATE/human/reviewer/parent are never claimed as work). Fail SAFE: release the
      // claim and escalate a blocker rather than silently dropping it. (No tmux lane remains
      // to fall back to; the LEAF_EXECUTOR escape hatch is retired with it.)
      try { await releaseClaim(project, todo.id); } catch { /* lease backstops */ }
      const exclReason = headlessExclusionReason(todo, launchChildrenIndex) ?? 'unknown';
      try {
        createEscalation({
          project,
          session: poolName,
          kind: 'blocker',
          todoId: todo.id,
          questionText:
            `No worker lane for "${displayTitle(todo)}": the tmux worker lane was retired (P7) and ` +
            `the headless leaf-executor only runs headless work leaves. This todo is not one (${exclReason}). ` +
            `Re-scope it as a headless work leaf, split it under an epic, or handle it manually.`,
        });
      } catch { /* escalation is best-effort; the released claim already parks the todo */ }
      recordSupervisorAudit({ kind: 'spawn', project, session: poolName, detail: JSON.stringify({ todoId: todo.id, started: false, reason: 'tmux-retired-not-headless-leaf', excl: exclReason, released: true }) });
      return false;
    },
    // Single death-detection surface (unification of the former reapDeadClaims +
    // reapOrphanedLeaves deps — see src/services/worker-liveness.ts for the ordered
    // rule engine + the shared shield chain). Wires the SAME functions/closures this
    // file used inline before the extraction; the live wiring stays here, the pure
    // ordered-rule logic lives in worker-liveness.ts.
    reapDeadWorkers: (project: string): Promise<{ reclaimed: string[]; exhausted: string[] }> => {
      const wlDeps: WorkerLivenessDeps = {
        listTodos,
        getTodo,
        reclaimClaim,
        reclaimOrphan,
        leafHadProgress,
        isRunLive,
        isLeafInflightLive,
        inProcessLaneAlive,
        lanePulseAt,
        markIdle,
        recordSupervisorAudit,
        clearLeafInflight,
        reapStaleInflight,
        reapSameEpochOrphanInflight,
        listLeafInflight,
        reconcileInflight,
        listTrackedLeaves,
        killLeafSubtree,
        leafAbortReason,
        reapOrphanedLeafWorktrees,
        tickGcLeafWorktrees,
        isHeadlessLeaf,
        buildChildrenIndex,
        coordinatorEpoch: COORDINATOR_EPOCH,
        pulseStaleMs: PULSE_STALE_MS,
        orphanGraceMs: DEFAULT_ORPHAN_GRACE_MS,
      };
      return reapDeadWorkersImpl(project, wlDeps);
    },
    escalateExhausted: async (project: string, todoId: string): Promise<void> => {
      const todo = getTodo(project, todoId);
      createEscalation({
        project,
        // Label with the real pool lane; never a fabricated `worker-<id8>` (the
        // card resolves by todoId, so a neutral label is safe when unspawned).
        session: todo?.sessionName ?? 'unassigned',
        kind: 'blocker',
        questionText: `Todo "${todo ? displayTitle(todo) : todoId}" exhausted its retry budget (worker repeatedly failed to complete it). Parked as blocked — needs a human decision.`,
        todoId,
      });
    },
    enforceBudgetCaps: async (project: string): Promise<string[]> => {
      // P1 governance breaker (87452094). Pure deterministic caps over OBSERVABLE
      // lane telemetry — iteration count (retryCount), wall-clock (now-claimedAt).
      // (Token budget is wired when per-lane usage telemetry is plumbed; the selector
      // already tolerates an undefined tokens axis.) HARD breach → park BLOCKED via the
      // SAME completion funnel parkBlocked/sweepExhaustedHeadless use (→ non-claimable,
      // cannot re-spawn) + structured escalation + loud audit. Soft breach → warn once.
      const now = Date.now();
      const rows: LaneBudgetRow[] = listTodos(project, { status: 'in_progress' }).map((t) => ({
        todoId: t.id,
        title: displayTitle(t),
        session: t.sessionName,
        claimedAtMs: t.claimedAt ? new Date(t.claimedAt as unknown as string).getTime() : undefined,
        iterations: typeof t.retryCount === 'number' ? t.retryCount : undefined,
      }));
      const trips = selectBudgetTrips(rows, now, DEFAULT_BUDGET_CONFIG);
      const parked: string[] = [];
      const deps = makeCoordinatorDeps();
      for (const trip of trips) {
        const todo = getTodo(project, trip.todoId);
        const session = trip.session ?? todo?.sessionName ?? 'unassigned';
        if (trip.tier === 'soft') {
          // Surface once — non-parking warning that the lane is approaching a hard cap.
          if (budgetSoftWarned.has(trip.todoId)) continue;
          budgetSoftWarned.add(trip.todoId);
          recordSupervisorAudit({ kind: 'nudge', project, session, detail: JSON.stringify({ todoId: trip.todoId, reason: 'budget-soft', breaches: trip.breaches }) });
          continue;
        }
        // HARD: park BLOCKED (non-claimable) via the completion funnel, then escalate.
        // Thread the row's LIVE claim token so a lane already re-claimed by a fresh
        // run no-ops instead of parking the new owner's in-flight work.
        try { await handleWorkerComplete(deps, project, trip.todoId, 'rejected', todo?.claim?.token ?? undefined); }
        catch { /* park funnel best-effort; the escalation still files below */ }
        // Structured payload (design §2.5): the literal trip trajectory + the exhausted
        // action-class (it ran past its budget) + concrete options + recommendation.
        createEscalation({
          project,
          session,
          kind: 'blocker',
          todoId: trip.todoId,
          questionText:
            `Lane "${todo ? displayTitle(todo) : trip.todoId}" hit a HARD budget cap and was PARKED (blocked, cannot re-spawn). ` +
            `Trip: ${trip.reason}. ` +
            `It burned its budget without completing — running longer is the same action class at higher cost. ` +
            `Decide: (1) extend the cap and re-open (if it was genuinely close), ` +
            `(2) split it into smaller lanes, or (3) drop it. (P1 deterministic breaker — 87452094.)`,
        });
        recordSupervisorAudit({ kind: 'escalate', project, session, detail: JSON.stringify({ todoId: trip.todoId, reason: 'budget-hard', breaches: trip.breaches }) });
        budgetSoftWarned.delete(trip.todoId);
        parked.push(trip.todoId);
      }
      return parked;
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
        // Thread the row's LIVE claim token so a lane already re-claimed by a fresh
        // run no-ops instead of parking the new owner's in-flight work.
        try { await handleWorkerComplete(deps, project, entry.todoId, 'rejected', todo?.claim?.token ?? undefined); }
        catch { /* gate funnel best-effort on the exhaustion path */ }
        createEscalation({
          project,
          session: todo?.sessionName ?? 'unassigned',
          kind: 'blocker',
          questionText: `Leaf "${todo ? displayTitle(todo) : entry.todoId}" is RATE-CAP exhausted — the claude.ai account stayed capped for over 2h. Parked blocked; needs a human (wait for the cap to reset, then re-open, or split/drop).`,
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
        questionText: `Worker REJECTED todo "${todo ? displayTitle(todo) : todoId}" — its mechanical acceptance gate (tsc + tests) failed and it couldn't fix it in scope. Not auto-retried. Re-open with guidance, split, or drop it.`,
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
        // VERIFY-ONLY (todo 231d10d4): before calling a clean lane a hallucination, check
        // whether the blueprint declared this a no-op leaf (estimatedFiles:0). If so the
        // empty lane is the EXPECTED outcome — preserve (null), don't false-downgrade to
        // pending. Only reached on the genuinely-clean path, so it can't mask real work.
        if (leafNoCommitExpected(todoId)) return null;
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
  // NOTE: session-subscription notifications used to run here, but they are now
  // driven by the orchestrator tick (runOrchestratorTick → notify) for every
  // WATCHED project regardless of level — so subscribe-and-be-notified works even
  // when autonomous building is off. See orchestrator-live.ts.
}

// ---------------------------------------------------------------------------
// Phase 5 (mission c4eb4fcc) — throttle the PERIODIC build scan off the every-tick loop.
//
// runTick's per-tick work (releaseExpiredClaims, reapDeadClaims/OrphanedLeaves,
// detectStalls, enforceBudgetCaps, listReadyTodos + claimGuard) is a synchronous
// bun:sqlite sweep over the whole todos table — the LAST every-tick block still
// starving the shared HTTP loop after Phase 1–4. But real-time claiming is NOT
// carried by this periodic scan: a todo becoming `ready` (approve/unheld/dep-terminal/
// created-approved) fires fireOrchestratorKick → kickOrchestrator, which forces an
// immediate tick. The periodic scan is therefore a SAFETY NET (lease expiry at the
// 40-min DEFAULT_LEASE_MS, orphan/stall reap, any missed kick) — correct to run at a
// coarser cadence, exactly like the reconcile pass (RECONCILE_INTERVAL_MS).
//
// So gate the PERIODIC build scan to at most once per BUILD_PASS_INTERVAL_MS per
// project (same proven shape as shouldRunReconcilePass). A KICK-triggered tick BYPASSES
// this gate (force=true in runOrchestratorTick), so a ready-todo event still claims
// immediately — claim latency is preserved. Only the time-based safety-net scan is
// throttled.
// ---------------------------------------------------------------------------

/** Minimum spacing between PERIODIC build-safety-net scans for a single project. The
 *  event-driven kick path bypasses this (force), so latency-sensitive claiming is
 *  unaffected; this only coarsens the lease/orphan/stall catch-up cadence. */
export const BUILD_PASS_INTERVAL_MS = 120_000; // 2 min

const lastBuildPassMs = new Map<string, number>();

/**
 * Throttle gate for the PERIODIC build pass. Returns true (and records `now` as the
 * last run) when the periodic scan is due for `project`; false when a previous run is
 * still within BUILD_PASS_INTERVAL_MS. First call for a project always runs. `now` is
 * injectable for deterministic tests. NB: a kicked (force) tick does NOT consult this
 * gate — it always builds — so this never delays claiming a ready todo.
 */
export function shouldRunBuildPass(project: string, now: number = Date.now()): boolean {
  const last = lastBuildPassMs.get(project);
  if (last !== undefined && now - last < BUILD_PASS_INTERVAL_MS) return false;
  lastBuildPassMs.set(project, now);
  return true;
}

/** Test seam: clear the per-project build throttle clock (all projects, or one). */
export function _resetBuildPassThrottle(project?: string): void {
  if (project === undefined) lastBuildPassMs.clear();
  else lastBuildPassMs.delete(project);
}
