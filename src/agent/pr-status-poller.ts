export interface PRStatus {
  number: number;
  url: string;
  statusCheckRollup?: unknown;
  reviews?: unknown;
}

export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type SpawnFn = (cmd: string[], opts: { cwd: string }) => Promise<SpawnResult>;

const defaultSpawn: SpawnFn = async (cmd, opts) => {
  try {
    const proc = Bun.spawn(cmd, { cwd: opts.cwd, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return { code, stdout, stderr };
  } catch (err) {
    return { code: 127, stdout: '', stderr: err instanceof Error ? err.message : 'spawn failed' };
  }
};

export interface PRStatusPollerOptions {
  sessionId: string;
  worktreePath: string;
  onUpdate: (status: PRStatus) => void;
  intervalMs?: number;
  spawn?: SpawnFn;
}

export interface PRStatusPollerHandle {
  stop: () => void;
}

export function startPRStatusPoller(opts: PRStatusPollerOptions): PRStatusPollerHandle {
  const { worktreePath, onUpdate, intervalMs = 30000 } = opts;
  const spawnFn = opts.spawn ?? defaultSpawn;
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const res = await spawnFn(
        ['gh', 'pr', 'view', '--json', 'number,url,statusCheckRollup,reviews'],
        { cwd: worktreePath }
      );
      if (stopped) return;
      if (res.code !== 0) return;
      try {
        const parsed = JSON.parse(res.stdout);
        if (parsed && typeof parsed.number === 'number') {
          onUpdate(parsed as PRStatus);
        }
      } catch {}
    } finally {
      running = false;
    }
  };

  // Fire immediately
  void tick();
  const handle = setInterval(tick, intervalMs);
  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}
