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
import { mux, argvLs, argvPsUidComm } from './session-mux/index.ts';
import { getGrokHarnessForInspection } from '../agent/registry';
import { listLeafInflight } from './worker-ledger';
import { getStatus } from './session-status-store';
import type { ProviderId } from '../agent/worker-agent';
import { DEFAULT_PROVIDER_ID } from '../agent/worker-agent';

/** Coarse worker state. P7: daemon workers are HEADLESS leaf-executor lanes (in-process
 *  `claude -p`, no tmux), so liveness is the `leaf_inflight` signal — a row per leaf
 *  actively running a node — NOT a tmux pane. The tmux-derived states (no_tmux/
 *  dead_shell/permission) are retained in the union for back-compat but no longer
 *  produced for the worker fleet now that the tmux worker lane is retired. */
export type WorkerState =
  | 'no_tmux' // legacy (tmux worker lane retired) — no longer produced
  | 'dead_shell' // legacy (tmux worker lane retired) — no longer produced
  | 'permission' // legacy (tmux worker lane retired) — no longer produced
  | 'working' // actively running a node (leaf_inflight row present, or grok harness alive)
  | 'idle' // claimed lane with no in-flight node right now (between nodes / not executing)
  | 'unknown'; // liveness couldn't be determined

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
  /** When the worker claimed this todo (ms epoch), or null if unknown. STABLE
   *  across polls and across daemon heartbeats — the anchor for a card's
   *  "time-on-task" timer, which must NOT reset when the daemon pings every lane. */
  claimedAt: number | null;
  /** ms the todo has been in_progress (now - claimedAt), or null if unknown. */
  elapsedMs: number | null;
  /** ms until the claim lease expires (negative ⇒ OVER lease, should be reaped). */
  leaseRemainingMs: number | null;
  overLease: boolean;
  retryCount: number;
  state: WorkerState;
  /** When state is 'working' on a headless leaf lane, the node it is running
   *  (blueprint | implement | review | research | fix | …) from leaf_inflight. */
  leafNode?: string | null;
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
  /** The provider this lane was dispatched with (PAW P3). DORMANT: always
   *  'claude' until a provider is manually pinned. Surfaced so the watch card can
   *  show the lane's provider. Derived from the session-status provider pin,
   *  defaulting to 'claude'. */
  provider: ProviderId;
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
    const out = Bun.spawnSync(mux.cmd(argvPsUidComm()), { stdout: 'pipe', stderr: 'ignore' }).stdout?.toString() ?? '';
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
    const p = Bun.spawnSync(mux.cmd(argvLs('#{session_name}')), { stdout: 'pipe', stderr: 'ignore' });
    // No tmux server running ⇒ no sessions. tmux exits non-zero with "no server"
    // on stderr; treat a clean "nothing" as zero, an actual spawn failure as null.
    if (p.exitCode !== 0) return 0;
    const names = (p.stdout?.toString() ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    return names.filter((n) => n.startsWith('mc-')).length;
  } catch {
    return null;
  }
}

/** Snapshot the live fleet for a project: every in-progress todo with its worker,
 *  elapsed time, lease headroom, and derived health state. */
export function getFleetStatus(project: string, now: number = Date.now()): FleetStatus {
  const snap = procSnapshot();
  // P7: liveness for headless leaf-executor lanes — a row per leaf currently running a
  // node (keyed by leafId === todoId). One query for the whole pass.
  const inflightByLeaf = new Map(listLeafInflight({ project }).map((r) => [r.leafId, r]));
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
    const claimedAtMs = t.claimedAt ? Date.parse(t.claimedAt) : null;
    const claimedAtValid = claimedAtMs != null && !Number.isNaN(claimedAtMs) ? claimedAtMs : null;
    const elapsedMs = claimedAtValid != null ? now - claimedAtValid : null;
    // REAL last-activity for the card timer: the lane's own session-status
    // heartbeat (updated as the worker reports status — a true per-lane activity
    // signal), falling back to claim age. Both are persisted/stable across polls,
    // so the timer reflects real activity and never resets in lockstep on the 2s
    // poll. Null only when neither exists → UI renders '—', never render-time.
    const statusRow = getStatus(project, worker);
    const heartbeatMs = statusRow?.updatedAt ?? null;
    const lastActivity = heartbeatMs ?? claimedAtValid;
    // PAW P3: the lane's provider (DORMANT → 'claude'). The session-status pin is
    // the durable surface; fall back to the default provider when unpinned.
    const provider: ProviderId = statusRow?.provider ?? DEFAULT_PROVIDER_ID;
    const leaseRemainingMs =
      elapsedMs != null && t.claimLeaseMs != null ? t.claimLeaseMs - elapsedMs : null;

    // LANE LIVENESS (P7): every daemon worker lane is now IN-PROCESS — a headless
    // leaf-executor lane (claude -p) or, for a grok-pinned lane, the GrokOwnHarness
    // loop. Neither has a tmux pane to scrape, so liveness comes from the in-process
    // signals: leaf_inflight (a row while a leaf runs a node) and the grok harness.
    // A lane actively running a node → 'working' (surface the node); otherwise 'idle'
    // (between nodes / not currently executing — a genuinely dead lane ages out via
    // the orphan reaper, not this read-model).
    let state: WorkerState;
    let leafNode: string | null | undefined;
    const inflight = inflightByLeaf.get(t.id);
    if (inflight) {
      state = 'working';
      leafNode = inflight.nodeKind ?? null;
    } else if (provider === 'grok-build') {
      state = getGrokHarnessForInspection().isAlive(worker) ? 'working' : 'idle';
    } else {
      state = 'idle';
    }

    entries.push({
      todoId: t.id,
      title: t.title ?? t.id,
      type: t.type ?? null,
      worker,
      project,
      targetProject: (t as { targetProject?: string | null }).targetProject ?? null,
      claimedBy: t.claimedBy ?? null,
      claimedAt: claimedAtValid,
      elapsedMs,
      leaseRemainingMs,
      overLease: leaseRemainingMs != null && leaseRemainingMs < 0,
      retryCount: t.retryCount ?? 0,
      state,
      lastActivity,
      provider,
      ...(leafNode !== undefined ? { leafNode } : {}),
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
