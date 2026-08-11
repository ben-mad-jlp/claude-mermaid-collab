/**
 * Host-load sampler and summarizer — observe machine saturation (load average vs CPU count)
 * and command invocation frequency (process snapshot).
 *
 * Follows the injectable-runner idiom (GitRunner, src/services/epic-landedness.ts:151-181)
 * and the spawn+kill-timer pattern (procSnapshot, src/services/fleet-status.ts:115-152).
 *
 * Read-only + side-effect-free: samples host state for diagnostics, never mutates or controls.
 */

import os from 'os';

/** Sample of host load and process state at a single point in time. */
export interface HostSample {
  /** Load averages: [1-minute, 5-minute, 15-minute]. */
  loadAvg: [number, number, number];
  /** Number of logical CPUs on the machine. */
  cpuCount: number;
  /** Raw command-line strings from ps (one per row, argv[0] not normalized). */
  commands: string[];
  /** Timestamps (ms epoch) of detected sidecar process starts within a window, or null
   *  if not measured by this sampler (measurement is injected by test/caller). */
  sidecarStarts: number[] | null;
}

/** Injectable host sampler function — must never throw, return null on failure. */
export type HostSampler = () => Promise<HostSample | null>;

/** Summarized host-load state: derived from a sample via summarizeHostLoad. */
export interface HostLoad {
  loadAvg: { one: number; five: number; fifteen: number };
  cpuCount: number;
  /** Process commands bucketed by first whitespace-delimited token (argv[0]),
   *  sorted by count descending. */
  spawners: Array<{ command: string; count: number }>;
  /** Sidecar process restart frequency in the last windowMs. */
  sidecarRestarts: {
    /** Count of restarts in the window, or null if sidecarStarts was null. */
    count: number | null;
    /** Time window width in milliseconds. */
    windowMs: number;
    /** Timestamp (ms epoch) of the most recent restart in the window, or null if none. */
    lastStartAt: number | null;
  };
  /** True if load average (1-minute) exceeds saturation threshold
   *  (loadMultiple * cpuCount), false if below or at threshold exactly, null if
   *  sample was null (indeterminate). */
  saturated: boolean | null;
}

/** Read MERMAID_SATURATION_LOAD_MULTIPLE from env, defaulting to 1.0.
 *  Exported standalone so callers can inject a value without env access. */
export function resolveSaturationLoadMultiple(): number {
  const raw = Number(process.env.MERMAID_SATURATION_LOAD_MULTIPLE);
  return Number.isNaN(raw) ? 1.0 : raw;
}

/** Read machine load (os.loadavg and CPU count) with isolated error handling.
 *
 *  Returns null if either os.loadavg or os.cpus throws, otherwise returns the pair.
 *  Never throws or rejects.
 */
export function readMachineLoad(): { loadAvg: [number, number, number]; cpuCount: number } | null {
  try {
    const loadAvg = os.loadavg() as [number, number, number];
    const cpuCount = os.cpus().length;
    return { loadAvg, cpuCount };
  } catch {
    return null;
  }
}

/** Injectable process-command runner: returns raw ps stdout as a string. */
export type ProcCommandRunner = () => Promise<string>;

/** Sample process commands via ps, with fault isolation.
 *
 *  Owns the Bun.spawn + kill-timer + parse. Wraps the entire body (runner call, spawn,
 *  read, parse) in try/catch. On ANY failure (runner throws/rejects, spawn error, timeout/kill,
 *  non-zero exit, parse error), returns [] — never null, never throws.
 *
 *  Default runner (when runner is omitted) spawns ps with argv ['ps', '-axww', '-o', 'command=']
 *  and resolves to stdout text. The '-axww' flags ensure full command lines without truncation.
 */
export async function sampleProcessCommands(runner?: ProcCommandRunner): Promise<string[]> {
  try {
    // Default runner: spawn ps with -axww (wide output) to avoid truncation.
    const procRunner = runner ?? (async () => {
      const p = Bun.spawn(['ps', '-axww', '-o', 'command='], {
        stdout: 'pipe',
        stderr: 'ignore',
      });
      const killTimer = setTimeout(() => {
        try {
          p.kill();
        } catch {
          // already dead
        }
      }, 10_000);

      try {
        const out = await new Response(p.stdout).text();
        await p.exited;
        return out;
      } finally {
        clearTimeout(killTimer);
      }
    });

    const out = await procRunner();

    // Parse stdout: each line is a bare command (no comma-delimited fields).
    // Trim each line and push if non-empty.
    const commands: string[] = [];
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) {
        commands.push(trimmed);
      }
    }

    return commands;
  } catch {
    return [];
  }
}

/** Default host sampler: reads os.loadavg/os.cpus, then spawns ps for command list.
 *
 *  If readMachineLoad() fails, returns null immediately. Otherwise, even if process-command
 *  sampling fails, returns a non-null sample with empty commands array.
 *  sidecarStarts is always null (not derivable from ps alone in this leaf's scope).
 *
 *  Accepts optional deps param for test injection; zero-argument calls work normally.
 */
export const defaultHostSampler = async (
  deps?: { procRunner?: ProcCommandRunner },
): Promise<HostSample | null> => {
  const load = readMachineLoad();
  if (load === null) {
    return null;
  }

  const commands = await sampleProcessCommands(deps?.procRunner);

  return {
    loadAvg: load.loadAvg,
    cpuCount: load.cpuCount,
    commands,
    sidecarStarts: null, // Not derivable from ps alone.
  };
};

/** Summarize a host sample into load metrics and saturation state.
 *
 *  Pure, synchronous function. Never reads env or wall-clock. All config (loadMultiple, windowMs, now)
 *  must be passed explicitly via opts.
 *
 *  If sample is null, returns safe defaults with saturated: null (indeterminate).
 */
export function summarizeHostLoad(
  sample: HostSample | null,
  opts: { loadMultiple: number; windowMs?: number; now: number },
): HostLoad {
  const windowMs = opts.windowMs ?? 3_600_000; // 1 hour default

  // If sample is null, return safe defaults.
  if (sample === null) {
    return {
      loadAvg: { one: 0, five: 0, fifteen: 0 },
      cpuCount: 0,
      spawners: [],
      sidecarRestarts: { count: null, windowMs, lastStartAt: null },
      saturated: null,
    };
  }

  // Bucket commands by first whitespace-delimited token (argv[0]).
  const spawnerMap = new Map<string, number>();
  for (const cmd of sample.commands) {
    const firstToken = cmd.split(/\s+/)[0];
    spawnerMap.set(firstToken, (spawnerMap.get(firstToken) ?? 0) + 1);
  }

  // Convert to array sorted by count descending.
  const spawners = Array.from(spawnerMap, ([command, count]) => ({ command, count })).sort(
    (a, b) => b.count - a.count,
  );

  // Derive sidecarRestarts from the sample.
  let sidecarRestarts: HostLoad['sidecarRestarts'];
  if (sample.sidecarStarts === null) {
    sidecarRestarts = { count: null, windowMs, lastStartAt: null };
  } else {
    // Filter starts to those within windowMs of now.
    const inWindow = sample.sidecarStarts.filter((t) => opts.now - t <= windowMs);
    const count = inWindow.length;
    const lastStartAt = count > 0 ? Math.max(...inWindow) : null;
    sidecarRestarts = { count, windowMs, lastStartAt };
  }

  // Saturated: true when 1-minute load > (loadMultiple * cpuCount), false when below or at.
  const saturated = sample.loadAvg[0] > opts.loadMultiple * sample.cpuCount;

  return {
    loadAvg: { one: sample.loadAvg[0], five: sample.loadAvg[1], fifteen: sample.loadAvg[2] },
    cpuCount: sample.cpuCount,
    spawners,
    sidecarRestarts,
    saturated,
  };
}

/** Module-level injection seam: the current sampler function. */
let currentSampler: HostSampler = defaultHostSampler;

/** Replace the current host sampler with a custom one (for testing).
 *  Pass null to reset to defaultHostSampler. */
export function setHostSampler(s: HostSampler | null): void {
  currentSampler = s ?? defaultHostSampler;
}

/** Compose sampler + summarizer: fetch a host sample and summarize it.
 *
 *  This is the only call site allowed to read env (via resolveSaturationLoadMultiple)
 *  and wall-clock (Date.now()). The pure summarizer never does.
 */
export async function hostLoad(opts?: { sampler?: HostSampler; windowMs?: number }): Promise<HostLoad> {
  const sampler = opts?.sampler ?? currentSampler;
  const sample = await sampler();
  return summarizeHostLoad(sample, {
    loadMultiple: resolveSaturationLoadMultiple(),
    windowMs: opts?.windowMs,
    now: Date.now(),
  });
}
