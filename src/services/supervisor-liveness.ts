/**
 * Server-owned supervisor liveness: heartbeat → auto-spawn → respawn.
 *
 * Just as the Coordinator keeps workers alive per-project, SOMETHING must keep a
 * supervisor alive globally. The OWNER is the always-on server (not the
 * per-project Coordinator: a per-project owner would create N supervisors, and a
 * dead Coordinator couldn't respawn its own watcher — the regress ends at the
 * root server process). On each tick the server checks the supervisor heartbeat
 * (supervisor_identity.updatedAt, kept fresh by the running supervisor — see
 * todo 464c5cef); if there is no fresh heartbeat it claude-launches a supervisor
 * lane, and a stale heartbeat triggers a respawn.
 *
 * SPLIT OF THE SUPERVISOR'S TWO JOBS (locked decision): only the WATCHDOG loop
 * (reconcile/classify idle-vs-asked → nudge or escalate) is auto-spawned; the
 * PLANNING cockpit stays a human-initiated foreground session and is NEVER
 * auto-spawned. We enforce that here by spawning the supervisor with a watchdog
 * context prompt that forbids initiating planning. INVARIANT: the auto-spawned
 * watchdog still ESCALATES decisions to a human via the escalation inbox — it
 * never auto-answers; it only makes the loop resilient so escalations reliably
 * reach the inbox instead of dying with an absent/crashed supervisor.
 */
import {
  getSupervisorIdentity,
  getSupervisorConfig,
  SUPERVISOR_HEARTBEAT_INTERVAL_MS,
  SUPERVISOR_STALE_AFTER_MS,
  type SupervisorIdentity,
} from './supervisor-store.js';
import { SUPERVISOR_PROJECT, SUPERVISOR_SESSION } from '../config.js';

/** The context prompt that turns a spawned supervisor lane into a headless
 *  WATCHDOG: reconcile + escalate only, never plan. Injected via
 *  `--append-system-prompt`. */
export const WATCHDOG_CONTEXT_PROMPT =
  'You are an AUTO-SPAWNED SUPERVISOR WATCHDOG (started by the server because no live supervisor ' +
  'heartbeat was found). Run in headless watchdog mode ONLY: register_supervisor for this session, ' +
  'then on a self-scheduling loop run supervisor_watchdog_scan / supervisor_reconcile, nudge idle ' +
  'supervised sessions with open todos, and ESCALATE any decision to the human via escalation_create ' +
  '(never auto-answer a decision). Do NOT initiate roadmap planning or ask the user to plan — planning ' +
  'is a separate human-initiated session. Keep the supervisor_identity heartbeat fresh while you run.';

/** The skill the watchdog lane invokes once bound. */
export const WATCHDOG_INVOKE_SKILL = '/mermaid-collab:supervisor';

/** After a spawn we must give the new lane time to launch Claude, register, and
 *  emit its first heartbeat before judging it stale again — otherwise every tick
 *  inside that window would spawn another lane. Generous relative to the stale
 *  window (claude cold-start + MCP handshake). */
export const SPAWN_GRACE_MS = 180_000;

export interface SupervisorLivenessDeps {
  now: () => number;
  getIdentity: () => SupervisorIdentity | null;
  getConfig: () => { project: string; session: string };
  staleAfterMs: number;
  /** Launch (or respawn) the supervisor watchdog lane. Best-effort. */
  spawn: (project: string, session: string) => Promise<{ started: boolean; reason?: string }>;
  log?: (msg: string) => void;
}

export interface LivenessState {
  /** A spawn is in flight (await guard so concurrent ticks don't double-spawn). */
  spawning: boolean;
  /** When the last spawn was kicked off, for the grace window. */
  lastSpawnAt: number;
}

export function makeLivenessState(): LivenessState {
  return { spawning: false, lastSpawnAt: 0 };
}

export type LivenessAction = 'healthy' | 'spawn-in-flight' | 'grace' | 'spawned' | 'respawned' | 'spawn-failed';

/**
 * One liveness decision. Pure-ish: all I/O is via injected deps so the
 * spawn/respawn/skip logic is unit-testable with a fake clock + fake spawn.
 */
export async function supervisorLivenessTick(
  deps: SupervisorLivenessDeps,
  state: LivenessState,
): Promise<{ action: LivenessAction; reason?: string }> {
  // Guard 1: a spawn is already running — never overlap.
  if (state.spawning) return { action: 'spawn-in-flight' };

  const now = deps.now();

  // Guard 2: within the post-spawn grace window — give the new lane time to come
  // up and start heartbeating before we judge it again.
  if (state.lastSpawnAt > 0 && now - state.lastSpawnAt < SPAWN_GRACE_MS) {
    return { action: 'grace' };
  }

  const id = deps.getIdentity();
  const isFresh = id != null && now - id.updatedAt <= deps.staleAfterMs;
  if (isFresh) return { action: 'healthy' };

  // Absent (never registered) → spawn; stale (registered but heartbeat old) →
  // respawn. Both take the same launch path.
  const wasAbsent = id == null;
  state.spawning = true;
  try {
    const cfg = deps.getConfig();
    const r = await deps.spawn(cfg.project, cfg.session);
    state.lastSpawnAt = deps.now();
    if (!r.started) {
      deps.log?.(`[supervisor-liveness] spawn failed: ${r.reason ?? 'unknown'}`);
      return { action: 'spawn-failed', reason: r.reason };
    }
    const action: LivenessAction = wasAbsent ? 'spawned' : 'respawned';
    deps.log?.(`[supervisor-liveness] ${action} supervisor watchdog for ${cfg.project} (${cfg.session})`);
    return { action };
  } finally {
    state.spawning = false;
  }
}

function defaultGetConfig(): { project: string; session: string } {
  const cfg = getSupervisorConfig();
  return {
    project: cfg?.supervisorProject ?? SUPERVISOR_PROJECT,
    session: cfg?.supervisorSession ?? SUPERVISOR_SESSION,
  };
}

async function defaultSpawn(project: string, session: string): Promise<{ started: boolean; reason?: string }> {
  // Lazy import so this module stays light and the heavy tmux/launch layer only
  // loads when an actual spawn is needed.
  const { ensureSession, runTodoInSession } = await import('./claude-launch.js');
  const ensured = await ensureSession({ project, session, contextPrompt: WATCHDOG_CONTEXT_PROMPT });
  if (!ensured.ready) return { started: false, reason: ensured.reason };
  const run = await runTodoInSession({ session, invokeSkill: WATCHDOG_INVOKE_SKILL, tmux: ensured.tmux });
  return { started: true, reason: run.sent ? undefined : run.reason };
}

function realDeps(): SupervisorLivenessDeps {
  return {
    now: () => Date.now(),
    getIdentity: getSupervisorIdentity,
    getConfig: defaultGetConfig,
    staleAfterMs: SUPERVISOR_STALE_AFTER_MS,
    spawn: defaultSpawn,
    log: (m) => console.log(m),
  };
}

let timer: ReturnType<typeof setInterval> | null = null;
const moduleState = makeLivenessState();

/** Start the server-owned supervisor liveness loop. Idempotent: returns false if
 *  already running. The interval defaults to the heartbeat cadence so a death is
 *  noticed within ~one stale window. */
export function startSupervisorLiveness(intervalMs: number = SUPERVISOR_HEARTBEAT_INTERVAL_MS): boolean {
  if (timer) return false;
  const deps = realDeps();
  const t = setInterval(() => {
    void supervisorLivenessTick(deps, moduleState).catch(() => { /* never let a tick kill the loop */ });
  }, intervalMs);
  (t as { unref?: () => void }).unref?.();
  timer = t;
  return true;
}

export function stopSupervisorLiveness(): boolean {
  if (!timer) return false;
  clearInterval(timer);
  timer = null;
  // Reset state so a later start re-evaluates immediately.
  moduleState.spawning = false;
  moduleState.lastSpawnAt = 0;
  return true;
}

export function isSupervisorLivenessRunning(): boolean {
  return timer != null;
}
