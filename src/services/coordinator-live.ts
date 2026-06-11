import * as path from 'node:path';
import type { Todo } from './todo-store';
import { listReadyTodos, claimTodo, releaseExpiredClaims, completeTodo, updateTodo, getTodo, listTodos, reclaimClaim, reclaimOrphan, releaseClaim, resetTodo } from './todo-store';
import { planOrphanReap, DEFAULT_ORPHAN_GRACE_MS, shouldPulseReap, DEFAULT_PULSE_STALE_MS } from './coordinator-core';
import { getOrchestratorLevel, levelRank } from './orchestrator-config';
import { getStatus } from './session-status-store';
import { getWebSocketHandler } from './ws-handler-manager';
import { filterClaimable } from './claim-guard';
import { WorktreeManager, INBOX_EPIC_ID } from '../agent/worktree-manager';
import { createEscalation, resolveEscalationsForTodo, recordSupervisorAudit, addSupervised, addWatchedProject, getEscalation, resolveEscalation } from './supervisor-store';
import { tmuxBaseName } from './tmux-naming';
import { sendTmuxKeysRaw } from './tmux-send';
import { ensureSession, runTodoInSession } from './claude-launch';
import { runTick, type CoordinatorDeps, type GateVerdict } from './coordinator-daemon';
import { loadProjectManifest } from '../config/project-manifest';
import { runRegistryGate } from './gate-runner';
import { validateStewardProof } from './steward-proof';
// Import for side-effect: registers the CAD gate plugin (domain tier) into the
// gate registry so a CAD step artifact is gated deterministically (Phase 1 #1).
import './cad-gate-plugin';
import { deriveBsyncSessionId, isCadTodo, bsyncSessionContextNote } from './bsync-session';
import { resolveProfile, type AgentProfile } from '../config/agent-profiles';
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
export async function procSnapshot(): Promise<Map<number, { children: number[]; comm: string }> | null> {
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
export async function tmuxPanePid(tmux: string): Promise<number | null> {
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

/** Live count of worker cold-starts currently in flight (capped at MAX_COLD_STARTS).
 *  Read-only snapshot for observability (e.g. the orchestrator_status MCP tool). */
export function getColdStartsInFlight(): number {
  return coldStartsInFlight;
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

// --- BP0: sweep already-stranded accepted todos ---------------------------------
// A repair pass (Part 3 of the fix): scan the work-graph for leaf todos that are
// done+accepted but whose work is NOT reachable from their epic branch (the
// pre-fix damage — already-accepted todos whose commits stranded on lane branches,
// or that were accepted with no commit at all). For each, raise ONE escalation so
// a human can re-integrate or re-open it. Read-only w.r.t. the work-graph (it
// FLAGS, it does not silently re-open — the acceptance was a human-visible event,
// so its reversal should be too). Returns the flagged todo ids.
export async function sweepStrandedAccepted(project: string): Promise<string[]> {
  const flagged: string[] = [];
  const all = listTodos(project, { includeCompleted: true });
  const isEpic = (t: Todo) => all.some((c) => c.parentId === t.id);
  for (const t of all) {
    // Only leaf work todos that claim to be accepted+done can be stranded.
    if (t.status !== 'done' || t.acceptanceStatus !== 'accepted') continue;
    if (isEpic(t)) continue; // epics carry no commit of their own
    try {
      const wm = getWorktreeManager(t.targetProject ?? project);
      if (!(await wm.isGitRepoPublic())) continue;
      const epicId = resolveEpicId(t, project);
      if (await wm.todoOnEpicBranch(epicId, t.id)) continue; // work is on the branch — fine
      flagged.push(t.id);
      createEscalation({
        project,
        session: t.sessionName ?? `worker-${t.id.slice(0, 8)}`,
        todoId: t.id,
        kind: 'assumption-invalidated',
        questionText: `Stranded acceptance detected: todo "${t.title}" is done+accepted but its work is NOT on epic branch ${wm.epicBranchName(epicId)} (commit stranded on a lane branch, or accepted with no commit). Re-integrate the lane branch onto the epic branch, or re-open the todo.`,
      });
    } catch { /* a single bad todo never aborts the sweep */ }
  }
  if (flagged.length > 0) {
    recordSupervisorAudit({ kind: 'reconcile', project, session: '', detail: JSON.stringify({ bp0: 'stranded-accept-sweep', flagged }) });
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
    claimGuard: (_project, todos) => filterClaimable(todos),
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
          const merge = await wm.commitAndMergeToEpic(session, epicId, { message, todoId: id });
          recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, epicId, isolation: 'merge-back', merged: merge.merged, conflict: merge.conflict, committed: merge.committed, branch: merge.workerBranch }) });
          if (merge.conflict) {
            createEscalation({
              project,
              session,
              todoId: id,
              kind: 'assumption-invalidated',
              questionText: `Worker-isolation merge conflict: branch ${merge.workerBranch} could not merge into ${merge.epicBranch} for todo "${r.completed.title}". Resolve the conflict manually, then merge the branch into ${merge.epicBranch}.`,
            });
          } else if (!merge.integrated) {
            // BP0 INVARIANT: the merge reported success but the todo's work is NOT
            // on the epic branch (PHANTOM: a clean worktree with no commit; or a
            // lane whose commit never reached collab/epic/<id8>). `accepted` must
            // NOT survive that — the upstream guarantee is accepted ⇒ work-on-branch.
            // Reverse the premature acceptance: re-surface this todo (and any epic
            // the store just rolled up off the back of this child) and escalate.
            await reopenStrandedAccept(project, id, epicId, r.rolledUp, r.completed.title, merge.epicBranch, session);
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
          // BP0 + abb4fd7e (unioned): the merge-back THREW, so the work almost
          // certainly never reached the epic branch — yet the store already marked the
          // todo accepted. Verify; if genuinely stranded, REVERSE the acceptance
          // (reopenStrandedAccept) AND raise an escalation so a human integrates the
          // orphaned session branch rather than discovering it via `git log --all`.
          const reason = e instanceof Error ? e.message : String(e);
          recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, isolation: 'merge-back-failed', reason }) });
          try {
            const wm = getWorktreeManager(r.completed.targetProject ?? project);
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
        // executedBySession pins the WORKER lane as the durable executor (distinct
        // from claimedBy=coordinator). Set alongside sessionName here at launch.
        try { await updateTodo(project, todo.id, { sessionName: poolName, executedBySession: poolName }); }
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
            const wt = await wm.ensure(poolName, { baseBranch: epic.branch });
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
        if (session && await isTmuxAlive(tmuxBaseName(project, session))) continue; // worker still running (incl. warm idle pool sessions)
        const next = await reclaimClaim(project, t.id);
        // The session is gone — release the pool slot it held (no-op if it wasn't a pool session).
        if (session) markIdle(session);
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
        const tmux = tmuxBaseName(project, session);
        const dead = await laneConfirmedDead(tmux, snap);
        if (!shouldPulseReap(pulseAt, nowMs, PULSE_STALE_MS, dead)) continue;
        const next = await reclaimOrphan(project, t.id);
        if (next == null) continue; // raced to a terminal state
        markIdle(session);          // free any pool slot it held
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
        // Case B (claim past lease): only reap once the worker's tmux is confirmed
        // gone — a still-live worker on an over-long task must not be yanked. Case A
        // (claimedBy NULL → needsTmuxProbe false) has no live claim by definition.
        if (c.needsTmuxProbe && c.sessionName && await isTmuxAlive(tmuxBaseName(project, c.sessionName))) continue;
        // reclaimOrphan (NOT reclaimClaim) reclaims regardless of claimToken — an
        // orphan's whole problem is the missing token. Retry-budget-aware: → ready,
        // or blocked once the retry cap is exceeded.
        const next = await reclaimOrphan(project, c.id);
        if (next == null) continue; // raced to a terminal state — nothing to reap
        if (c.sessionName) markIdle(c.sessionName); // free any pool slot it held
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
        if (claudePresent === false && !isClaudeTuiPresent(pane)) {
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
            markIdle(session);
            await reclaimClaim(project, t.id);
            prev.escalated = true;
            stalled.push(t.id);
          } catch { /* escalation/recovery best-effort; never abort the tick */ }
          continue;
        }
        // Claude is present (or liveness unknown) → clear any dead-tracking for it.
        deadTracker.delete(tmux);

        if (!pane || isActivelyWorking(pane)) continue;

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
          const perm = detectPermissionPrompt(pane);
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
                `(DOGFOOD #6 auto-detected). Pending context:\n\n${extractStallContext(pane)}`,
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
            markIdle(session);
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
