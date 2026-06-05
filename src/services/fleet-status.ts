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
  /** When state is 'permission', the tool the prompt is gating (best-effort). */
  blockedOnTool?: string | null;
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
}

/** Build a pid → {children, comm} snapshot in one `ps` call (cheap, one spawn). */
function procSnapshot(): Map<number, { children: number[]; comm: string }> | null {
  try {
    const out = Bun.spawnSync(['ps', '-axo', 'pid=,ppid=,comm='], { stdout: 'pipe', stderr: 'ignore' }).stdout?.toString() ?? '';
    if (!out.trim()) return null;
    const byPid = new Map<number, { children: number[]; comm: string }>();
    const rows: Array<{ pid: number; ppid: number; comm: string }> = [];
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      const ppid = Number(m[2]);
      rows.push({ pid, ppid, comm: m[3] });
      const ex = byPid.get(pid);
      if (ex) ex.comm = m[3];
      else byPid.set(pid, { children: [], comm: m[3] });
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
    const worker = t.sessionName ?? `worker-${t.id.slice(0, 8)}`;
    const tmux = tmuxBaseName(project, worker);
    const claimedAtMs = t.claimedAt ? Date.parse(t.claimedAt) : null;
    const elapsedMs = claimedAtMs != null && !Number.isNaN(claimedAtMs) ? now - claimedAtMs : null;
    const leaseRemainingMs =
      elapsedMs != null && t.claimLeaseMs != null ? t.claimLeaseMs - elapsedMs : null;

    let state: WorkerState;
    let blockedOnTool: string | null | undefined;
    if (!tmuxAlive(tmux)) {
      state = 'no_tmux';
    } else {
      const panePid = tmuxPanePid(tmux);
      const claudeAlive = snap && panePid != null ? claudeAliveInSubtree(panePid, snap) : null;
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

  return { project, now, entries, summary };
}
