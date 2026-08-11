/**
 * hotpath-profiler.ts — name the code that is holding the event loop, with JS stacks.
 *
 * WHY THIS EXISTS. 2026-08-11: the sidecar was watchdog-killed 11+ times, always 6-9 minutes
 * into its life. Native `sample` stacks showed sqlite3_step and posix_spawn on the main thread
 * — but the calling frames are JIT-compiled JS with no symbols, so THREE successive diagnoses
 * named plausible-but-wrong culprits (a listMissions N+1, worktree count, the stale-scan spawn
 * loop). Each was a real inefficiency; none was the pin. The missing instrument is a JS-side
 * attribution: WHO issues the queries and spawns during a hot window.
 *
 * WHAT IT DOES. Monkeypatches bun:sqlite's Database.prototype (query/prepare/run/exec) and
 * Bun.spawn/spawnSync at module load — the prototype, so every connection is covered no matter
 * where it was opened. Counts calls per 10s window; samples a JS stack for 1-in-8 calls (cheap
 * enough to leave on). When a window is HOT (queries or spawns over threshold) it appends the
 * window's counts and top stacks to ~/.mermaid-collab/hotpath.jsonl. Quiet windows cost two
 * counter increments and write nothing.
 *
 * This is a diagnostic that ships: the file is bounded (rotates at ~5MB) and the overhead is
 * negligible, so it stays on and the NEXT wedge names itself instead of starting an archaeology
 * session.
 */
import { Database } from 'bun:sqlite';
import { appendFileSync, statSync, renameSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOTPATH_WINDOW_MS = 10_000;
/** A quiet server does tens of queries per window; the wedge does thousands. */
export const HOTPATH_QUERY_THRESHOLD = 400;
export const HOTPATH_SPAWN_THRESHOLD = 15;
const STACK_SAMPLE_EVERY = 8;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

const LOG_PATH = join(homedir(), '.mermaid-collab', 'hotpath.jsonl');

type Window = {
  startedAt: number;
  queries: number;
  spawns: number;
  /** stack -> count, sampled */
  stacks: Map<string, number>;
  /** sql prefix -> count */
  sql: Map<string, number>;
  /** spawned argv[0..1] -> count */
  cmds: Map<string, number>;
};

let win: Window = fresh();
let installed = false;

function fresh(): Window {
  return { startedAt: Date.now(), queries: 0, spawns: 0, stacks: new Map(), sql: new Map(), cmds: new Map() };
}

function bump(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

/** Trimmed JS stack: drop the profiler's own frames, keep the next 6, strip absolute prefixes. */
function jsStack(): string {
  const raw = new Error().stack ?? '';
  return raw
    .split('\n')
    .slice(3, 9)
    .map((l) => l.trim().replace(/\(.*?(src|node_modules|\$bunfs)\//, '($1/'))
    .join(' <- ');
}

function top(m: Map<string, number>, n: number): Array<{ k: string; n: number }> {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => ({ k, n: c }));
}

function record(kind: 'query' | 'spawn', detail: string): void {
  const now = Date.now();
  if (now - win.startedAt >= HOTPATH_WINDOW_MS) {
    flush();
    win = fresh();
  }
  if (kind === 'query') {
    win.queries++;
    bump(win.sql, detail);
  } else {
    win.spawns++;
    bump(win.cmds, detail);
  }
  // Sample stacks only once traffic is already suspicious — a quiet window never pays for
  // Error().stack at all, and a hot one samples the calls that made it hot.
  const suspicious = win.queries > HOTPATH_QUERY_THRESHOLD / 2 || win.spawns > HOTPATH_SPAWN_THRESHOLD / 2;
  if (suspicious && (win.queries + win.spawns) % STACK_SAMPLE_EVERY === 0) {
    bump(win.stacks, `[${kind}] ${jsStack()}`);
  }
}

function flush(): void {
  if (win.queries < HOTPATH_QUERY_THRESHOLD && win.spawns < HOTPATH_SPAWN_THRESHOLD) return;
  try {
    mkdirSync(join(homedir(), '.mermaid-collab'), { recursive: true });
    try {
      if (statSync(LOG_PATH).size > MAX_LOG_BYTES) renameSync(LOG_PATH, `${LOG_PATH}.1`);
    } catch { /* first write */ }
    appendFileSync(
      LOG_PATH,
      JSON.stringify({
        at: new Date(win.startedAt).toISOString(),
        windowMs: HOTPATH_WINDOW_MS,
        queries: win.queries,
        spawns: win.spawns,
        topSql: top(win.sql, 5),
        topCmds: top(win.cmds, 5),
        topStacks: top(win.stacks, 6),
      }) + '\n',
    );
  } catch { /* the profiler must never be the problem */ }
}

/** Idempotent. Wraps the PROTOTYPE so every Database connection is covered. */
export function installHotpathProfiler(): void {
  if (installed) return;
  installed = true;

  const proto = Database.prototype as unknown as Record<string, (...a: never[]) => unknown>;
  for (const method of ['query', 'prepare', 'run', 'exec']) {
    const orig = proto[method];
    if (typeof orig !== 'function') continue;
    proto[method] = function (this: Database, ...args: never[]) {
      const sql = typeof args[0] === 'string' ? (args[0] as string).replace(/\s+/g, ' ').slice(0, 90) : `<${method}>`;
      record('query', sql);
      return orig.apply(this, args);
    };
  }

  const origSpawn = Bun.spawn.bind(Bun);
  const origSpawnSync = Bun.spawnSync.bind(Bun);
  (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = ((...args: Parameters<typeof Bun.spawn>) => {
    const cmd = Array.isArray(args[0]) ? (args[0] as string[]).slice(0, 2).join(' ') : String((args[0] as { cmd?: string[] })?.cmd?.slice(0, 2).join(' ') ?? 'spawn');
    record('spawn', cmd);
    return origSpawn(...args);
  }) as typeof Bun.spawn;
  (Bun as unknown as { spawnSync: typeof Bun.spawnSync }).spawnSync = ((...args: Parameters<typeof Bun.spawnSync>) => {
    const cmd = Array.isArray(args[0]) ? (args[0] as string[]).slice(0, 2).join(' ') : 'spawnSync';
    record('spawn', cmd);
    return origSpawnSync(...args);
  }) as typeof Bun.spawnSync;
}
