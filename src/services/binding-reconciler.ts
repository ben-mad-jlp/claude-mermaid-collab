/**
 * BindingReconciler — derives Claude-session bindings from durable facts on a
 * clock + at boot, so a session stays reachable for its whole life with no
 * manual re-binding.
 *
 * WHY THIS EXISTS (design-session-binding, sibling of decision 9cd01858
 * reconciliation-first comms). A binding used to be a fact PUSHED once — the
 * `/collab` skill ran `echo $PPID` → `register_claude_session`. That's one-shot,
 * and the in-memory pid→session map is WIPED on every server restart (deploy).
 * The binding FILE survives on disk, but nothing rehydrated the map on boot —
 * so after a deploy a session read as unregistered (dark dot, no notifications)
 * until someone re-ran `/collab`. That "sessions get lost after a while" is the
 * verified #1 cause.
 *
 * The fix: stop trusting the one-shot push. Continuously OBSERVE the binding from
 * the most durable thing present — rehydrate from existing /tmp binding files
 * (re-assert the in-memory map + re-watch). Idempotent and purely ADDITIVE — it
 * runs alongside the existing register path and never removes state (dead-pane
 * GC stays the BindingSweeper's job).
 *
 * (A second pass used to derive fresh worker-lane bindings from the supervised
 * registry ∩ live tmux, via `registerLaneClaudeSession`. Worker lanes run
 * in-process now — no tmux pane to derive from — so that pass was removed with
 * the tmux/terminal stack, Phase 4.)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const BINDING_PREFIX = '.mermaid-collab-binding-';

const API_PORT = parseInt(process.env.PORT || '9002', 10);
const API_HOST = process.env.HOST || 'localhost';
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

/** Default reconcile cadence. The binding-file rehydrate (pass A) is the part
 *  that matters for a deploy; a ~20s tick relights every session well inside the
 *  window a human would notice a dark dot, at negligible cost. */
export const DEFAULT_RECONCILE_MS = 20_000;

interface BindingFile {
  claudeSessionId: string;
  project: string;
  session: string;
  claudePid?: string | number;
}

/** Injectable seams so tickOnce is unit-testable with no /tmp / process tree /
 *  HTTP server. Defaults wire the real implementations. */
export interface BindingReconcilerDeps {
  /** Read + parse the /tmp binding files (project, session, claudeSessionId, claudePid). */
  readBindingFiles: () => BindingFile[];
  /** Is this PID still alive? (process.kill(pid, 0) without ESRCH.) */
  pidAlive: (pid: number) => boolean;
  /** Re-assert the in-memory pid→session map (covers the post-deploy wipe). */
  registerPid: (pid: number, session: string) => void;
  /** POST /api/claude-session/register → server re-watches + rebroadcasts. */
  postRegister: (project: string, session: string, claudeSessionId: string) => Promise<boolean>;
  /** Structured progress line (optional). */
  log?: (msg: string) => void;
}

function defaultReadBindingFiles(): BindingFile[] {
  let names: string[];
  try {
    names = fs.readdirSync('/tmp');
  } catch {
    return [];
  }
  const out: BindingFile[] = [];
  for (const name of names) {
    if (!name.startsWith(BINDING_PREFIX) || !name.endsWith('.json')) continue;
    try {
      const raw = fs.readFileSync(path.join('/tmp', name), 'utf-8');
      const data = JSON.parse(raw) as Partial<BindingFile>;
      if (
        data &&
        typeof data.claudeSessionId === 'string' &&
        UUID_RE.test(data.claudeSessionId) &&
        typeof data.project === 'string' && data.project &&
        typeof data.session === 'string' && data.session
      ) {
        out.push({
          claudeSessionId: data.claudeSessionId,
          project: data.project,
          session: data.session,
          claudePid: data.claudePid,
        });
      }
    } catch {
      // Skip unreadable / malformed files; the sweeper handles cleanup.
    }
  }
  return out;
}

function defaultPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but isn't ours — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function defaultRegisterPid(pid: number, session: string): void {
  import('./cdp-session.js').then((m) => m.registerPidSession(pid, session)).catch(() => {});
}

async function defaultPostRegister(project: string, session: string, claudeSessionId: string): Promise<boolean> {
  try {
    const url = new URL('/api/claude-session/register', API_BASE_URL);
    url.searchParams.set('project', project);
    url.searchParams.set('session', session);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claudeSessionId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const realDeps: BindingReconcilerDeps = {
  readBindingFiles: defaultReadBindingFiles,
  pidAlive: defaultPidAlive,
  registerPid: defaultRegisterPid,
  postRegister: defaultPostRegister,
};

export interface ReconcileResult {
  /** Bindings re-asserted from a live binding file. */
  rehydrated: number;
  /** Binding files skipped because their PID is dead (left for the sweeper). */
  deadSkipped: number;
}

/**
 * One reconcile pass. Idempotent + additive: re-asserts bindings for live
 * sessions, never removes state. Safe to run concurrently with the existing
 * register paths.
 */
export async function tickOnce(
  deps: BindingReconcilerDeps = realDeps,
  announced: Set<string> = new Set<string>(),
): Promise<ReconcileResult> {
  const result: ReconcileResult = { rehydrated: 0, deadSkipped: 0 };

  // claudeSessionIds seen ALIVE this pass, used to GC `announced` so a dead or
  // relaunched session re-announces cleanly.
  const liveSessionIds = new Set<string>();

  // Rehydrate from durable binding files -- relights everything after a deploy
  // that wiped the in-memory map.
  for (const b of deps.readBindingFiles()) {
    const pid = b.claudePid == null ? NaN : Number(b.claudePid);
    if (!Number.isInteger(pid) || pid <= 0 || !deps.pidAlive(pid)) {
      result.deadSkipped += 1;
      continue;
    }
    liveSessionIds.add(b.claudeSessionId);
    // Always re-assert the in-memory routing map (cheap, idempotent; the thing a
    // deploy wiped). This does NOT broadcast.
    deps.registerPid(pid, b.session);
    // Broadcast `claude_session_registered` ONLY the first time we see this
    // session this process-life. Re-broadcasting pins the UI status to 'active'
    // every tick (useWatchEvents.ts), stomping real waiting/idle status.
    if (announced.has(b.claudeSessionId)) continue;
    const ok = await deps.postRegister(b.project, b.session, b.claudeSessionId);
    if (ok) {
      announced.add(b.claudeSessionId);
      result.rehydrated += 1;
    }
  }

  // GC: drop announced entries whose session is no longer live, so a relaunch (or
  // a /clear that mints a new UUID) re-announces cleanly next time it appears.
  for (const id of [...announced]) {
    if (!liveSessionIds.has(id)) announced.delete(id);
  }

  if (deps.log && result.rehydrated) {
    deps.log(`[binding-reconciler] rehydrated=${result.rehydrated} deadSkipped=${result.deadSkipped}`);
  }
  return result;
}

export class BindingReconciler {
  private _interval: ReturnType<typeof setInterval> | null = null;
  private readonly deps: BindingReconcilerDeps;
  private readonly intervalMs: number;
  /** Persisted across ticks: claudeSessionIds already announced this process-life.
   *  Empty at boot, so every live session re-announces ONCE (the relight); then
   *  steady-state ticks re-assert routing silently without re-broadcasting. */
  private readonly announced = new Set<string>();

  constructor(opts: { deps?: BindingReconcilerDeps; intervalMs?: number } = {}) {
    this.deps = opts.deps ?? realDeps;
    this.intervalMs = opts.intervalMs ?? DEFAULT_RECONCILE_MS;
  }

  /** Run an immediate pass (relight on boot) then tick on an interval. The timer
   *  is unref'd so it never holds the process open. */
  start(): void {
    void tickOnce(this.deps, this.announced).catch((e) => console.error('[binding-reconciler] boot tick failed:', e));
    this._interval = setInterval(
      () => void tickOnce(this.deps, this.announced).catch((e) => console.error('[binding-reconciler] tick failed:', e)),
      this.intervalMs,
    );
    if (typeof this._interval.unref === 'function') this._interval.unref();
  }

  stop(): void {
    if (this._interval !== null) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }
}
