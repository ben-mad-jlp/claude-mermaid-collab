/**
 * Fleet status read-model — "what is each worker doing, on which slot, for how
 * long, and is it healthy?" A single join over the in-progress todos + their
 * claim metadata + live worker liveness (tmux + Claude-PID + pane), so a human
 * (or the Bridge UI / an MCP tool) can SEE the pipeline instead of guessing why
 * it feels slow.
 *
 * Read-only + side-effect-free: it never mutates claims, kills sessions, or
 * escalates — that's the coordinator's job. This only OBSERVES. It reuses the
 * same liveness primitives the watchdog uses (claudeAliveInSubtree /
 * isClaudeTuiPresent / detectPermissionPrompt) so the state it reports matches
 * what the coordinator acts on.
 */
import { listTodos } from './todo-store';
import { tmuxBaseName } from './tmux-naming';
import { claudeAliveInSubtree, isClaudeTuiPresent, detectPermissionPrompt } from './coordinator-live';
import { getStatus } from './session-status-store';

/** Coarse worker state, derived from tmux liveness + Claude PID + pane content. */
export type WorkerState =
  | 'no_tmux' // claim held but the tmux session is gone → reapDeadClaims will reclaim
  | 'dead_shell' // tmux alive but Claude exited (bare shell) → 63a59bd6 escalates
  | 'permission' // Claude alive, blocked on a Claude Code permission prompt
  | 'working' // Claude alive and actively working (spinner / interrupt hint)
  | 'idle' // Claude alive at its prompt, not visibly working (may be a stall)
  | 'unknown'; // liveness couldn't be determined (no pane pid / no ps snapshot)

export interface FleetEntry {
  todoId: string;
  title: string;
  type: string | null;
  /** The pool slot / worker session this todo is claimed under (e.g. backend-1). */
  worker: string;
  /** Tracking project the claim lives in. */
  project: string;
  /** Repo the work targets (may differ from the tracking project). */
  targetProject: string | null;
  claimedBy: string | null;
  /** ms the todo has been in_progress (now - claimedAt), or null if unknown. */
  elapsedMs: number | null;
  /** ms until the claim lease expires (negative ⇒ OVER lease, should be reaped). */
  leaseRemainingMs: number | null;
  overLease: boolean;
  retryCount: number;
  state: WorkerState;
  /**
   * The lane's REAL last-activity timestamp (ms epoch), or null if none is known.
   * This is what the UI card timer reads — it must be a persisted/derived value
   * that is STABLE across repeated polls when the worker hasn't changed, never a
   * render-time `Date.now()`. Derived from the session-status heartbeat (the
   * worker's own status updates) when present, else the claim time (claim age).
   * Null ⇒ the UI shows '—', never a value that grows from render time.
   */
  lastActivity: number | null;
  /** When state is 'permission', the tool the prompt is gating (best-effort). */
  blockedOnTool?: string | null;
}

/**
 * Process-headroom summary — the highest-signal early warning for the
 * fork-EAGAIN wedge: once the uid's live process count approaches
 * `kern.maxprocperuid` (the 6000 cap), new `tmux`/`claude` spawns start failing
 * with EAGAIN and the fleet silently stalls. Surfacing `liveProcs` vs
 * `perUidCap` BEFORE it hits lets a human (or a daemon) back off. All fields are
 * null when their probe couldn't run (no ps / no sysctl / no tmux), never a
 * fabricated value.
 */
export interface HeadroomInfo {
  /** Live processes owned by the current uid (from the same ps snapshot). */
  liveProcs: number | null;
  /** kern.maxprocperuid — the per-uid hard process cap (~6000 on macOS). */
  perUidCap: number | null;
  /** Live `mc-*` tmux sessions (the fleet's worker panes). */
  tmuxSessions: number | null;
  /** Workers alive at their prompt but not visibly working (idle-at-prompt). */
  idleSessions: number;
}

export interface FleetStatus {
  project: string;
  now: number;
  /** Per in-progress todo, newest claim first. */
  entries: FleetEntry[];
  /** Rollup counts for a one-glance health read. */
  summary: {
    inProgress: number;
    working: number;
    idle: number;
    permission: number;
    deadOrGone: number; // dead_shell + no_tmux
    overLease: number;
  };
  /** Process-headroom vs the per-uid cap — surfaces the fork-EAGAIN wedge early. */
  headroom: HeadroomInfo;
}

type ProcSnapshot = {
  /** pid → {children, comm} parent/child index (used for Claude liveness walks). */
  byPid: Map<number, { children: number[]; comm: string }>;
  /** Live process count owned by the current uid (for headroom vs the per-uid cap). */
  liveProcsForUid: number | null;
};

/** Build a pid → {children, comm} snapshot in one `ps` call (cheap, one spawn).
 *  The same snapshot also yields the current uid's live-process count, so the
 *  headroom read costs no extra spawn (uid column added to the one ps call). */
function procSnapshot(): ProcSnapshot | null {
  try {
    const out = Bun.spawnSync(['ps', '-axo', 'pid=,ppid=,uid=,comm='], { stdout: 'pipe', stderr: 'ignore' }).stdout?.toString() ?? '';
    if (!out.trim()) return null;
    const myUid = typeof process.getuid === 'function' ? process.getuid() : null;
    let liveProcsForUid = myUid != null ? 0 : null;
    const byPid = new Map<number, { children: number[]; comm: string }>();
    const rows: Array<{ pid: number; ppid: number; comm: string }> = [];
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      const ppid = Number(m[2]);
      const uid = Number(m[3]);
      const comm = m[4];
      rows.push({ pid, ppid, comm });
      if (myUid != null && uid === myUid) liveProcsForUid = (liveProcsForUid ?? 0) + 1;
      const ex = byPid.get(pid);
      if (ex) ex.comm = comm;
      else byPid.set(pid, { children: [], comm });
    }
    for (const r of rows) {
      let parent = byPid.get(r.ppid);
      if (!parent) { parent = { children: [], comm: '' }; byPid.set(r.ppid, parent); }
      parent.children.push(r.pid);
    }
    return { byPid, liveProcsForUid };
  } catch {
    return null;
  }
}

/** Per-uid hard process cap (`kern.maxprocperuid`, ~6000 on macOS). null if unreadable. */
function perUidProcCap(): number | null {
  try {
    const out = Bun.spawnSync(['sysctl', '-n', 'kern.maxprocperuid'], { stdout: 'pipe', stderr: 'ignore' }).stdout?.toString().trim() ?? '';
    const n = Number(out);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Count live `mc-*` tmux sessions (the fleet's worker panes). null if tmux can't be queried. */
function mcTmuxSessionCount(): number | null {
  try {
    const p = Bun.spawnSync(['tmux', 'ls', '-F', '#{session_name}'], { stdout: 'pipe', stderr: 'ignore' });
    // No tmux server running ⇒ no sessions. tmux exits non-zero with "no server"
    // on stderr; treat a clean "nothing" as zero, an actual spawn failure as null.
    if (p.exitCode !== 0) return 0;
    const names = (p.stdout?.toString() ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    return names.filter((n) => n.startsWith('mc-')).length;
  } catch {
    return null;
  }
}

function tmuxAlive(tmux: string): boolean {
  try {
    return Bun.spawnSync(['tmux', 'has-session', '-t', tmux], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
  } catch {
    return true; // uncertain → assume alive (don't mislabel as gone)
  }
}

function tmuxPanePid(tmux: string): number | null {
  try {
    const p = Bun.spawnSync(['tmux', 'list-panes', '-t', tmux, '-F', '#{pane_pid}'], { stdout: 'pipe', stderr: 'ignore' });
    const first = (p.stdout?.toString() ?? '').split('\n').map((l) => l.trim()).filter(Boolean)[0];
    const n = Number(first);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function capturePane(tmux: string): string {
  try {
    return Bun.spawnSync(['tmux', 'capture-pane', '-t', tmux, '-p'], { stdout: 'pipe', stderr: 'ignore' }).stdout?.toString() ?? '';
  } catch {
    return '';
  }
}

/** Same active-work signal the stall detector uses. */
function isActivelyWorking(pane: string): boolean {
  return /\(\d+(?:m\s*\d+)?s\s*·/.test(pane) || /esc to interrupt/i.test(pane);
}

/** Snapshot the live fleet for a project: every in-progress todo with its worker,
 *  elapsed time, lease headroom, and derived health state. */
export function getFleetStatus(project: string, now: number = Date.now()): FleetStatus {
  const snap = procSnapshot();
  const entries: FleetEntry[] = [];
  for (const t of listTodos(project, { status: 'in_progress' })) {
    // Epics/containers have no worker — skip rows that were never claimed.
    if (!t.claimedAt && !t.sessionName && !t.claimedBy) continue;
    // The worker's identity is its persisted pool lane (e.g. `backend-3`). Without
    // it there is no attachable tmux: a fabricated `worker-<id8>` name derives a
    // session that doesn't exist, and the UI card's create-terminal would spawn an
    // empty shell under the wrong name instead of attaching. Skip such rows — the
    // Coordinator persists sessionName when it commits the lane, so a real worker
    // always carries one.
    const worker = t.sessionName;
    if (!worker) continue;
    const tmux = tmuxBaseName(project, worker);
    const claimedAtMs = t.claimedAt ? Date.parse(t.claimedAt) : null;
    const claimedAtValid = claimedAtMs != null && !Number.isNaN(claimedAtMs) ? claimedAtMs : null;
    const elapsedMs = claimedAtValid != null ? now - claimedAtValid : null;
    // REAL last-activity for the card timer: the lane's own session-status
    // heartbeat (updated as the worker reports status — a true per-lane activity
    // signal), falling back to claim age. Both are persisted/stable across polls,
    // so the timer reflects real activity and never resets in lockstep on the 2s
    // poll. Null only when neither exists → UI renders '—', never render-time.
    const heartbeatMs = getStatus(project, worker)?.updatedAt ?? null;
    const lastActivity = heartbeatMs ?? claimedAtValid;
    const leaseRemainingMs =
      elapsedMs != null && t.claimLeaseMs != null ? t.claimLeaseMs - elapsedMs : null;

    let state: WorkerState;
    let blockedOnTool: string | null | undefined;
    if (!tmuxAlive(tmux)) {
      state = 'no_tmux';
    } else {
      const panePid = tmuxPanePid(tmux);
      const claudeAlive = snap && panePid != null ? claudeAliveInSubtree(panePid, snap.byPid) : null;
      const pane = capturePane(tmux);
      if (claudeAlive === false && !isClaudeTuiPresent(pane)) {
        state = 'dead_shell';
      } else if (claudeAlive === null) {
        state = 'unknown';
      } else {
        const perm = detectPermissionPrompt(pane);
        if (perm.isPermission) { state = 'permission'; blockedOnTool = perm.tool; }
        else if (isActivelyWorking(pane)) state = 'working';
        else state = 'idle';
      }
    }

    entries.push({
      todoId: t.id,
      title: t.title ?? t.id,
      type: t.type ?? null,
      worker,
      project,
      targetProject: (t as { targetProject?: string | null }).targetProject ?? null,
      claimedBy: t.claimedBy ?? null,
      elapsedMs,
      leaseRemainingMs,
      overLease: leaseRemainingMs != null && leaseRemainingMs < 0,
      retryCount: t.retryCount ?? 0,
      state,
      lastActivity,
      ...(blockedOnTool !== undefined ? { blockedOnTool } : {}),
    });
  }

  entries.sort((a, b) => (b.elapsedMs ?? 0) - (a.elapsedMs ?? 0));

  const summary = {
    inProgress: entries.length,
    working: entries.filter((e) => e.state === 'working').length,
    idle: entries.filter((e) => e.state === 'idle').length,
    permission: entries.filter((e) => e.state === 'permission').length,
    deadOrGone: entries.filter((e) => e.state === 'dead_shell' || e.state === 'no_tmux').length,
    overLease: entries.filter((e) => e.overLease).length,
  };

  const headroom: HeadroomInfo = {
    liveProcs: snap?.liveProcsForUid ?? null,
    perUidCap: perUidProcCap(),
    tmuxSessions: mcTmuxSessionCount(),
    idleSessions: summary.idle,
  };

  return { project, now, entries, summary, headroom };
}
