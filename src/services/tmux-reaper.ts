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
import { procSnapshot, tmuxPanePid, claudeAliveInSubtree, isClaudeTuiPresent } from './coordinator-live.ts';

/** Only collab-owned sessions (tmuxBaseName prefixes every name with `mc-`). */
const MC_PREFIX = 'mc-';

/** Default idle age before an orphaned session is eligible for reaping. */
const MAX_IDLE_MS = (Number(process.env.MERMAID_TMUX_MAX_IDLE_H) || 6) * 60 * 60 * 1000;
/** Sweep cadence. */
const SWEEP_INTERVAL_MS = (Number(process.env.MERMAID_TMUX_REAP_INTERVAL_MIN) || 30) * 60 * 1000;

/**
 * Pure reap decision — unit-testable without tmux/ps. Reap iff the session is
 * old AND has no live claude process AND no TUI chrome. `hasLiveClaude===null`
 * (snapshot unavailable) is treated as ALIVE (fail-safe: never reap on unknown).
 */
export function shouldReapTmux(
  s: { ageMs: number; hasLiveClaude: boolean | null; hasTui: boolean },
  maxIdleMs: number = MAX_IDLE_MS,
): boolean {
  if (s.ageMs < maxIdleMs) return false;
  if (s.hasLiveClaude !== false) return false; // alive or unknown → keep
  if (s.hasTui) return false;
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

async function killSession(tmux: string): Promise<void> {
  try {
    const p = Bun.spawn(['tmux', 'kill-session', '-t', tmux], { stdout: 'ignore', stderr: 'ignore' });
    await p.exited;
  } catch {
    /* best-effort */
  }
}

/**
 * Run one sweep. Returns the names of sessions reaped. One ps snapshot for the
 * whole pass (cheap); per-session pane-pid + pane-capture for the liveness test.
 */
export async function reapStaleTmux(maxIdleMs: number = MAX_IDLE_MS, now: number = Date.now()): Promise<string[]> {
  const sessions = await listMcSessions();
  if (sessions.length === 0) return [];
  const snap = await procSnapshot();
  const reaped: string[] = [];
  for (const s of sessions) {
    const ageMs = now - s.createdMs;
    if (ageMs < maxIdleMs) continue; // cheap age gate before any ps/tmux work
    const panePid = await tmuxPanePid(s.name);
    const hasLiveClaude = snap && panePid != null ? claudeAliveInSubtree(panePid, snap) : null;
    const hasTui = isClaudeTuiPresent(capturePane(s.name));
    if (shouldReapTmux({ ageMs, hasLiveClaude, hasTui }, maxIdleMs)) {
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
      `reap mc-* sessions idle > ${Math.round(MAX_IDLE_MS / 3600000)}h with no live claude`,
  );
}

export function stopTmuxReaper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
