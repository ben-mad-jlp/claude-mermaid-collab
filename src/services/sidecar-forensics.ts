import { appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type ExitReason = 'watchdog-unresponsive' | 'unexpected-exit' | 'hot-swap' | 'shutdown';

export const DEFAULT_CRASH_LOOP_N = 3;
export const DEFAULT_CRASH_LOOP_WINDOW_MS = 10 * 60 * 1000;

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

export function buildCrashLoopEscalationPayload(input: {
  project: string;
  session: string;
  count: number;
  windowMs: number;
  respawnCount: number;
  reason: ExitReason;
}): { kind: 'sidecar-crash-loop'; questionText: string } {
  // Build questionText using only project, session, count, windowMs, and reason
  // Never interpolate respawnCount
  const windowSecs = Math.round(input.windowMs / 1000);
  const questionText = `Sidecar crash loop: project=${input.project} session=${input.session} ${input.count} respawns in ${windowSecs}s (reason: ${input.reason})`;

  return {
    kind: 'sidecar-crash-loop',
    questionText,
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
