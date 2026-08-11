import { appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Why a sidecar process ended. 'startup-failed' is the supervisor reaping a child
 *  that never came up, before retrying the spawn — distinct from 'unexpected-exit'
 *  (it died on its own) so a crash-loop at BOOT is legible in the forensics log. */
export type ExitReason = 'watchdog-unresponsive' | 'unexpected-exit' | 'hot-swap' | 'shutdown' | 'startup-failed';

export const DEFAULT_CRASH_LOOP_N = 3;
export const DEFAULT_CRASH_LOOP_WINDOW_MS = 10 * 60 * 1000;

export const DEFAULT_SLOW_PROBE_N = 3;
export const DEFAULT_SLOW_PROBE_WINDOW_MS = 10 * 60 * 1000;

export function formatExitForensics(input: {
  ts: number;
  code: number | null;
  signal: string | null;
  uptimeMs: number;
  respawnCount: number;
  reason: ExitReason;
}): string {
  const isoTs = new Date(input.ts).toISOString();
  return `[${isoTs}] sidecar-exit reason=${input.reason} code=${input.code} signal=${input.signal} uptimeMs=${input.uptimeMs} respawnCount=${input.respawnCount}`;
}

export function formatWatchdogKillReason(input: {
  probeLatenciesMs: number[];
  thresholdMs: number;
  unhealthyForMs: number;
}): string {
  const latenciesStr = input.probeLatenciesMs.join(',');
  return `watchdog-kill: unhealthyForMs=${input.unhealthyForMs} >= thresholdMs=${input.thresholdMs} probeLatenciesMs=[${latenciesStr}]`;
}

/** How long `sample` watches the wedged process, and how long we wait for it to finish.
 *  Two seconds is enough to see a stuck stack repeatedly; the timeout is generous because
 *  a saturated box (load 174 was observed) slows the sampler too. */
export const DEFAULT_STACK_SAMPLE_SECONDS = 2;
export const DEFAULT_STACK_SAMPLE_TIMEOUT_MS = 8_000;

/**
 * The command that captures WHAT the sidecar was doing when it stopped answering.
 *
 * The forensics log has always recorded the symptom (probe latencies pinned at the timeout)
 * and never the cause, so every wedge became archaeology: 200 watchdog kills on 2026-08-08
 * left nothing to read but the latencies. `sample` walks a live process's stacks without
 * needing it to respond — the one tool that still works on a blocked event loop.
 *
 * Returns null where no sampler exists, so the caller kills as before rather than hanging.
 */
export function stackSampleCommand(input: {
  pid: number;
  dir: string;
  ts: number;
  seconds?: number;
  platform?: string;
}): { argv: string[]; file: string } | null {
  const platform = input.platform ?? process.platform;
  if (platform !== 'darwin') return null;
  if (!Number.isInteger(input.pid) || input.pid <= 0) return null;

  // Colons are legal on macOS but read as path separators in Finder and break scp.
  const stamp = new Date(input.ts).toISOString().replace(/[:.]/g, '-');
  const file = join(input.dir, `stack-${stamp}-pid${input.pid}.txt`);
  const seconds = input.seconds ?? DEFAULT_STACK_SAMPLE_SECONDS;
  // -mayDie: we are about to signal this process; tell the sampler not to treat its
  // disappearance as an error.
  return { argv: ['sample', String(input.pid), String(seconds), '-mayDie', '-file', file], file };
}

export function formatStackSampleLine(input: {
  ts: number;
  outcome: 'captured' | 'failed' | 'timeout' | 'unsupported';
  file?: string;
  detail?: string;
}): string {
  const isoTs = new Date(input.ts).toISOString();
  const where = input.file ? ` file=${input.file}` : '';
  const detail = input.detail ? ` detail=${input.detail}` : '';
  return `[${isoTs}] stack-sample outcome=${input.outcome}${where}${detail}`;
}

/** Cheap counters worth having beside the stack: a climbing session count is itself a lead. */
export function formatDeathContext(input: {
  ts: number;
  counts: Record<string, number | string | null>;
}): string {
  const isoTs = new Date(input.ts).toISOString();
  const pairs = Object.entries(input.counts)
    .map(([k, v]) => `${k}=${v ?? 'unknown'}`)
    .join(' ');
  return `[${isoTs}] death-context ${pairs}`;
}

/** Resolve the liveness-watchdog threshold (ms) from env, then the machine config map.
 *
 *  WHY BOTH SOURCES: the env var only reaches the supervisor when the app is launched from a
 *  terminal — `open -a` and Finder launches drop it, so on 2026-08-11 the raised threshold
 *  silently reverted to 45s on every relaunch and the land gate's own full-suite run (load 27)
 *  starved the sidecar past it: the gate killed its own server mid-land. The config file is
 *  what actually survives how the app is launched; env stays as the explicit override.
 *
 *  PURE — callers pass the env and the parsed config map, so tests never read the live
 *  ~/.mermaid-collab/config.json (which leaks real machine state into assertions).
 *  Rejects values below 15s: the probe interval is 15s, so anything lower kills on one probe.
 *  Returns null when neither source sets a usable value (caller falls back to its default). */
export function resolveWatchdogThresholdMs(
  env: Record<string, string | undefined>,
  configMap: Record<string, unknown> | null,
): number | null {
  for (const raw of [env.MERMAID_WATCHDOG_THRESHOLD_SECONDS, configMap?.MERMAID_WATCHDOG_THRESHOLD_SECONDS]) {
    if (raw == null || raw === '') continue;
    const secs = Number(raw);
    if (Number.isFinite(secs) && secs >= 15) return secs * 1000;
  }
  return null;
}

export class CrashLoopTripwire {
  private respawnTimes: number[] = [];
  private lastFiredWindowStart: number | null = null;
  private readonly n: number;
  private readonly windowMs: number;

  constructor(n: number = DEFAULT_CRASH_LOOP_N, windowMs: number = DEFAULT_CRASH_LOOP_WINDOW_MS) {
    this.n = n;
    this.windowMs = windowMs;
  }

  recordRespawn(now: number): boolean {
    this.respawnTimes.push(now);
    // Drop entries older than now - windowMs
    this.respawnTimes = this.respawnTimes.filter(t => t > now - this.windowMs);

    // Check if we have n or more respawns in the window
    if (this.respawnTimes.length >= this.n) {
      const windowStart = this.respawnTimes[this.respawnTimes.length - this.n];

      // Fire only if this is a new window (different from lastFiredWindowStart)
      if (this.lastFiredWindowStart !== windowStart) {
        this.lastFiredWindowStart = windowStart;
        return true;
      }
    }

    return false;
  }
}

export class ChronicSlowProbeTripwire {
  private recoveryTimes: number[] = [];
  private lastFiredWindowStart: number | null = null;
  private readonly n: number;
  private readonly windowMs: number;

  constructor(n: number = DEFAULT_SLOW_PROBE_N, windowMs: number = DEFAULT_SLOW_PROBE_WINDOW_MS) {
    this.n = n;
    this.windowMs = windowMs;
  }

  recordRecovery(now: number): boolean {
    this.recoveryTimes.push(now);
    // Drop entries older than now - windowMs
    this.recoveryTimes = this.recoveryTimes.filter(t => t > now - this.windowMs);

    // Check if we have n or more recoveries in the window
    if (this.recoveryTimes.length >= this.n) {
      const windowStart = this.recoveryTimes[this.recoveryTimes.length - this.n];

      // Fire only if this is a new window (different from lastFiredWindowStart)
      if (this.lastFiredWindowStart !== windowStart) {
        this.lastFiredWindowStart = windowStart;
        return true;
      }
    }

    return false;
  }
}

export function buildChronicSlowProbeWarningPayload(input: {
  project: string;
  session: string;
  count: number;
  windowMs: number;
}): { kind: 'sidecar-slow-probes'; questionText: string; project: string; session: string } {
  const windowSecs = Math.round(input.windowMs / 1000);
  const questionText = `Sidecar chronically slow: project=${input.project} session=${input.session} ${input.count} intermittent slow-probe recoveries in ${windowSecs}s`;

  return {
    kind: 'sidecar-slow-probes',
    questionText,
    project: input.project,
    session: input.session,
  };
}

export function buildCrashLoopEscalationPayload(input: {
  project: string;
  session: string;
  count: number;
  windowMs: number;
  respawnCount: number;
  reason: ExitReason;
}): { kind: 'sidecar-crash-loop'; questionText: string; project: string; session: string } {
  // Build questionText using only project, session, count, windowMs, and reason
  // Never interpolate respawnCount
  const windowSecs = Math.round(input.windowMs / 1000);
  const questionText = `Sidecar crash loop: project=${input.project} session=${input.session} ${input.count} respawns in ${windowSecs}s (reason: ${input.reason})`;

  return {
    kind: 'sidecar-crash-loop',
    questionText,
    project: input.project,
    session: input.session,
  };
}

export function appendEscalationIntent(dir: string, payload: unknown): void {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'pending-escalations.jsonl');
  appendFileSync(file, JSON.stringify(payload) + '\n');
}

export function drainEscalationIntents(dir: string, sink: (intent: unknown) => void): void {
  const file = join(dir, 'pending-escalations.jsonl');

  let content: string;
  try {
    content = readFileSync(file, 'utf-8');
  } catch (err: unknown) {
    // Handle ENOENT and other errors gracefully
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw err;
  }

  // Truncate the file BEFORE invoking sink
  writeFileSync(file, '');

  // Split on newlines and process each line
  const lines = content.split('\n');
  for (const line of lines) {
    // Skip blank lines
    if (!line.trim()) {
      continue;
    }

    try {
      const intent = JSON.parse(line);
      sink(intent);
    } catch {
      // Silently skip lines that fail to parse (corrupt tail from partial write)
    }
  }
}

export function parseEscalationIntent(intent: unknown): {
  project: string; session: string; kind: string; questionText: string;
} | null {
  if (
    typeof intent === 'object' &&
    intent !== null &&
    typeof (intent as Record<string, unknown>).project === 'string' &&
    typeof (intent as Record<string, unknown>).session === 'string' &&
    typeof (intent as Record<string, unknown>).kind === 'string' &&
    typeof (intent as Record<string, unknown>).questionText === 'string'
  ) {
    return {
      project: (intent as Record<string, unknown>).project as string,
      session: (intent as Record<string, unknown>).session as string,
      kind: (intent as Record<string, unknown>).kind as string,
      questionText: (intent as Record<string, unknown>).questionText as string,
    };
  }
  return null;
}
