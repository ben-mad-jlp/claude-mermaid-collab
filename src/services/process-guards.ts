/**
 * process-guards — keep the long-lived collab server ALIVE when detached async
 * work throws.
 *
 * The Orchestrator daemon (and other fire-and-forget work) runs passes that
 * spawn subprocesses and schedule promises the tick loop does NOT await. The
 * per-pass try/catch in orchestrator-live.ts only covers the AWAITED chain — a
 * rejection from a detached promise, or an unhandled error event from a spawned
 * child, surfaces at the PROCESS level. With no `unhandledRejection` /
 * `uncaughtException` listener, the Bun/Node default terminates the process —
 * so one bad daemon tick takes down the whole server and every client attached
 * to it (observed: a remote build server died minutes after boot when a daemon
 * tick's subprocess spawn failed).
 *
 * A server is meant to survive that. These guards LOG richly and KEEP RUNNING.
 *
 * TRADEOFF (uncaughtException): conventional wisdom says exit after an uncaught
 * exception because process state may be corrupt. We deliberately choose
 * survival here: this is a local-first dev-tool server whose failures are
 * overwhelmingly isolated daemon/spawn hiccups, and dying silently is strictly
 * worse for the operator than a logged, recoverable warning. Truly fatal
 * conditions (OOM) bypass this path anyway. Revisit if a hot rejection loop
 * proves state corruption is real in practice.
 */

export interface ProcessGuardStats {
  unhandledRejections: number;
  uncaughtExceptions: number;
  lastError: { kind: 'unhandledRejection' | 'uncaughtException'; message: string; at: string } | null;
}

let unhandledRejections = 0;
let uncaughtExceptions = 0;
let lastError: ProcessGuardStats['lastError'] = null;
let installed = false;

function errText(reason: unknown): string {
  if (reason instanceof Error) return reason.stack || `${reason.name}: ${reason.message}`;
  return typeof reason === 'string' ? reason : (() => { try { return JSON.stringify(reason); } catch { return String(reason); } })();
}

/** Snapshot for observability (surfaced in /api/health). */
export function getProcessGuardStats(): ProcessGuardStats {
  return { unhandledRejections, uncaughtExceptions, lastError };
}

/** Reset counters — test hook only. */
export function _resetProcessGuardStats(): void {
  unhandledRejections = 0;
  uncaughtExceptions = 0;
  lastError = null;
}

/**
 * The listener bodies, exported so they can be unit-tested without actually
 * registering process-level handlers (which would leak across the test runner).
 * `nowIso` is injectable because Date.now()/new Date() are awkward in tests.
 */
export function handleUnhandledRejection(reason: unknown, nowIso: string = new Date().toISOString()): void {
  unhandledRejections++;
  const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : errText(reason);
  lastError = { kind: 'unhandledRejection', message, at: nowIso };
  console.error(`⚠️  [process-guard] unhandledRejection — server stays up: ${errText(reason)}`);
}

export function handleUncaughtException(err: unknown, nowIso: string = new Date().toISOString()): void {
  uncaughtExceptions++;
  const message = err instanceof Error ? `${err.name}: ${err.message}` : errText(err);
  lastError = { kind: 'uncaughtException', message, at: nowIso };
  console.error(`⚠️  [process-guard] uncaughtException — server stays up: ${errText(err)}`);
}

/**
 * Install the process-level safety net. Idempotent. Call once at server start,
 * BEFORE the Orchestrator daemon starts, so a first-tick failure is caught.
 */
export function installProcessGuards(): void {
  if (installed) return;
  installed = true;
  process.on('unhandledRejection', (reason) => handleUnhandledRejection(reason));
  process.on('uncaughtException', (err) => handleUncaughtException(err));
}
