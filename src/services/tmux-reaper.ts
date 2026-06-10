/**
 * tmux-reaper — a periodic, deterministic sweep that kills ORPHANED / very old
 * collab tmux sessions so dead `mc-*` panes don't accumulate forever.
 *
 * Gap it closes: terminalManager.reconcileSessions is on-demand + per-(project,
 * session) and only prunes records vs untracked orphans; the coordinator's
 * reapDeadClaims/detectStalls only touch coordinator-managed lanes. Nothing reaps
 * a stale tmux by AGE. This daemon does (deterministic-daemon-first, eb3c3e60).
 *
 * Safety: a session is reaped ONLY when it is (a) older than the idle threshold,
 * (b) has NO live `claude` process anywhere in its pane's process subtree, AND
 * (c) shows no Claude TUI chrome in the pane. A live session (steward, planner,
 * worker, an interactive console) is never killed — including remote-controlled
 * ones, which keep a live `claude` process. Reuses the coordinator's liveness
 * helpers so the "alive" test is identical.
 */
import { procSnapshot, tmuxPanePid, claudeAliveInSubtree, isClaudeTuiPresent, isActivelyWorking } from './coordinator-live.ts';

/** Only collab-owned sessions (tmuxBaseName prefixes every name with `mc-`). */
const MC_PREFIX = 'mc-';

/** The IDE-attached wrapper for a base `mc-<X>` session is a GROUPED tmux session
 *  `vscode-collab-mc-<X>` (PTYManager) that SHARES the base's windows/panes. The live
 *  Claude is therefore held by the GROUP, not by either name alone — killing only the
 *  base leaves the wrapper alive holding the Claude, freeing zero real procs. Every
 *  reap must target BOTH names (verified 2026-06-10 during manual cleanup). */
function pairedWrapperName(base: string): string {
  return `vscode-collab-${base}`;
}

/** Default idle age before an orphaned (dead-shell) session is eligible for reaping
 *  (1 week). Old dead tmux sessions are cheap (a detached shell) — this is hygiene,
 *  not safety — so the threshold is deliberately conservative. */
const MAX_IDLE_MS = (Number(process.env.MERMAID_TMUX_MAX_IDLE_H) || 24 * 7) * 60 * 60 * 1000;
/** Idle-at-prompt reap age (distinct from the dead-path threshold). An idle-but-ALIVE
 *  worker lane (live Claude sitting at the prompt, not working) older than this is
 *  reaped to bound per-uid process accumulation — the wedge the dead-only path missed
 *  entirely (idle lanes keep a live Claude, so the liveness gate kept every one). Much
 *  shorter than MAX_IDLE_MS because an idle lane costs ~27 live procs, not a bare shell.
 *  Override with MERMAID_TMUX_IDLE_REAP_H (default 8h). */
const IDLE_REAP_MS = (Number(process.env.MERMAID_TMUX_IDLE_REAP_H) || 8) * 60 * 60 * 1000;
/** Sweep cadence. */
const SWEEP_INTERVAL_MS = (Number(process.env.MERMAID_TMUX_REAP_INTERVAL_MIN) || 30) * 60 * 1000;

/** Role/planning sessions that are NEVER reaped, regardless of age or liveness —
 *  a planner/designer mid-flight or the steward/supervisor must never be killed by
 *  hygiene. tmuxBaseName slugs strip non-alphanumerics, so the session slug is the
 *  last '-' segment of `mc-{projectSlug}-{sessionSlug}`. */
const PROTECTED_SESSION_SLUGS = new Set(['planner', 'design', 'steward', 'supervisor']);

/** True if a tmux session name belongs to a protected role/planning session. */
export function isProtectedSession(tmuxName: string): boolean {
  const slug = tmuxName.split('-').pop() ?? '';
  return PROTECTED_SESSION_SLUGS.has(slug);
}

/** Worker POOL-lane slugs eligible for idle-at-prompt reaping. tmuxBaseName strips
 *  the hyphen out of a `<type>-<slot>` lane name, so the slug is `<type><slot>` (e.g.
 *  `backend1`, `ui2`, `general1`); domain lanes (`cad`, `gazebo`) may carry no slot.
 *  The idle path uses a POSITIVE ALLOWLIST (not just the protected denylist): only a
 *  recognized worker lane is ever reaped while alive, so an interactive console or any
 *  unrecognized session the human may be mid-use on is left untouched (age alone is
 *  insufficient — verified 2026-06-10, the age-only filter wrongly killed in-use
 *  planner/design sessions). */
const WORKER_LANE_RE = /^(frontend|backend|api|ui|library|general|cad|gazebo)\d*$/;

/** True if a tmux session name is a reapable worker pool lane (by slug). */
export function isWorkerLaneSession(tmuxName: string): boolean {
  const slug = tmuxName.split('-').pop() ?? '';
  return WORKER_LANE_RE.test(slug);
}

/**
 * Pure DEAD-path reap decision — unit-testable without tmux/ps. Reap iff the session
 * is NOT protected AND old AND has no live claude process AND no TUI chrome.
 * `hasLiveClaude===null` (snapshot unavailable) is treated as ALIVE (fail-safe:
 * never reap on unknown).
 */
export function shouldReapTmux(
  s: { ageMs: number; hasLiveClaude: boolean | null; hasTui: boolean; protected?: boolean },
  maxIdleMs: number = MAX_IDLE_MS,
): boolean {
  if (s.protected) return false; // never reap a planner/steward/supervisor
  if (s.ageMs < maxIdleMs) return false;
  if (s.hasLiveClaude !== false) return false; // alive or unknown → keep
  if (s.hasTui) return false;
  return true;
}

/**
 * Pure IDLE-AT-PROMPT reap decision — distinct from the dead path above. Reap iff the
 * session is a worker lane, NOT protected, old past the idle threshold, has a LIVE
 * claude (so it's genuinely idle-at-prompt, not a dead shell — that's the dead path),
 * and is NOT actively working. `hasLiveClaude!==true` (dead or unknown) → keep here;
 * a dead lane is handled by shouldReapTmux, and unknown is never reaped. The positive
 * `isWorker` allowlist is what keeps this from ever touching planner/design/interactive
 * sessions even if they slip the protected denylist.
 */
export function shouldReapIdleTmux(
  s: { ageMs: number; hasLiveClaude: boolean | null; isWorking: boolean; isWorker: boolean; protected?: boolean },
  idleReapMs: number = IDLE_REAP_MS,
): boolean {
  if (s.protected) return false;          // never reap a protected role
  if (!s.isWorker) return false;          // allowlist: only worker pool lanes
  if (s.ageMs < idleReapMs) return false; // younger than the idle threshold → keep
  if (s.hasLiveClaude !== true) return false; // dead/unknown → not this path
  if (s.isWorking) return false;          // actively working → keep
  return true;
}

interface TmuxSessionInfo {
  name: string;
  createdMs: number;
}

/** List `mc-*` tmux sessions with their creation time (epoch ms). */
async function listMcSessions(): Promise<TmuxSessionInfo[]> {
  try {
    const proc = Bun.spawn(['tmux', 'list-sessions', '-F', '#{session_name}\t#{session_created}'], {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const sessions: TmuxSessionInfo[] = [];
    for (const line of out.split('\n')) {
      const [name, created] = line.split('\t');
      if (!name || !name.startsWith(MC_PREFIX)) continue;
      const createdMs = Number(created) * 1000; // tmux session_created is epoch seconds
      if (Number.isFinite(createdMs)) sessions.push({ name, createdMs });
    }
    return sessions;
  } catch {
    return [];
  }
}

function capturePane(tmux: string): string {
  try {
    const p = Bun.spawnSync(['tmux', 'capture-pane', '-t', tmux, '-p'], { stdout: 'pipe', stderr: 'ignore' });
    return p.stdout?.toString() ?? '';
  } catch {
    return '';
  }
}

async function killOne(tmux: string): Promise<void> {
  try {
    const p = Bun.spawn(['tmux', 'kill-session', '-t', tmux], { stdout: 'ignore', stderr: 'ignore' });
    await p.exited;
  } catch {
    /* best-effort */
  }
}

/** Reap a session AND its paired `vscode-collab-mc-<X>` wrapper together. Killing
 *  only the base leaves the grouped wrapper alive holding the shared pane's live
 *  Claude → zero real procs freed (PAIRED-SESSION GOTCHA). Best-effort on both. */
async function killSession(tmux: string): Promise<void> {
  await Promise.all([killOne(tmux), killOne(pairedWrapperName(tmux))]);
}

/**
 * Run one sweep. Returns the names of sessions reaped. One ps snapshot for the
 * whole pass (cheap); per-session pane-pid + pane-capture for the liveness test.
 */
export async function reapStaleTmux(
  maxIdleMs: number = MAX_IDLE_MS,
  now: number = Date.now(),
  idleReapMs: number = IDLE_REAP_MS,
): Promise<string[]> {
  const sessions = await listMcSessions();
  if (sessions.length === 0) return [];
  const snap = await procSnapshot();
  const reaped: string[] = [];
  for (const s of sessions) {
    if (isProtectedSession(s.name)) continue; // never reap planner/design/steward/supervisor
    const ageMs = now - s.createdMs;
    const isWorker = isWorkerLaneSession(s.name);
    // Cheap age gate before any ps/tmux work. A worker lane can qualify for the
    // SHORTER idle-reap threshold, so gate on the minimum of the two thresholds it
    // could match; a non-worker lane only has the dead-path (long) threshold.
    const minThreshold = isWorker ? Math.min(maxIdleMs, idleReapMs) : maxIdleMs;
    if (ageMs < minThreshold) continue;
    const panePid = await tmuxPanePid(s.name);
    const hasLiveClaude = snap && panePid != null ? claudeAliveInSubtree(panePid, snap) : null;
    const pane = capturePane(s.name);
    const hasTui = isClaudeTuiPresent(pane);
    // DEAD path (dead shell, very old) OR IDLE-AT-PROMPT path (alive worker lane,
    // idle, past the shorter idle threshold). Both reap the base + its paired wrapper.
    const reapDead = shouldReapTmux({ ageMs, hasLiveClaude, hasTui }, maxIdleMs);
    const reapIdle =
      !reapDead &&
      shouldReapIdleTmux(
        { ageMs, hasLiveClaude, isWorking: isActivelyWorking(pane), isWorker },
        idleReapMs,
      );
    if (reapDead || reapIdle) {
      await killSession(s.name);
      reaped.push(s.name);
    }
  }
  if (reaped.length > 0) {
    console.log(`[tmux-reaper] reaped ${reaped.length} stale session(s): ${reaped.join(', ')}`);
  }
  return reaped;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the periodic reaper (idempotent). Runs once shortly after boot, then on
 *  the configured interval. */
export function startTmuxReaper(): void {
  if (timer) return;
  // Defer the first sweep so boot isn't competing with it.
  setTimeout(() => void reapStaleTmux().catch(() => {}), 60_000);
  timer = setInterval(() => void reapStaleTmux().catch(() => {}), SWEEP_INTERVAL_MS);
  console.log(
    `[tmux-reaper] started — sweep every ${Math.round(SWEEP_INTERVAL_MS / 60000)}m, ` +
      `reap non-planning mc-* sessions idle > ${(MAX_IDLE_MS / 86400000).toFixed(1)}d with no live claude, ` +
      `+ idle-at-prompt worker lanes (live but not working) older than ${(IDLE_REAP_MS / 3600000).toFixed(0)}h ` +
      `(base + paired vscode-collab wrapper)`,
  );
}

export function stopTmuxReaper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
