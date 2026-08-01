export const GIT_STATUS_PROBE_TTL_MS = 3000;

export interface GitStatusProbeOpts {
  now?: () => number;
  spawn?: (cmd: string[], opts: any) => any;
  ttlMs?: number;
}

const cache = new Map<string, { value: number; expiresAt: number }>();

export async function modifiedTrackedCount(
  project: string,
  opts: GitStatusProbeOpts = {}
): Promise<number> {
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? GIT_STATUS_PROBE_TTL_MS;
  const spawnFn = opts.spawn ?? Bun.spawn;

  const currentTime = now();

  // Check cache
  const cached = cache.get(project);
  if (cached && currentTime < cached.expiresAt) {
    return cached.value;
  }

  // Spawn git status and count modified tracked files
  let count = 0;
  try {
    const p = spawnFn(['git', '-C', project, 'status', '--porcelain', '--untracked-files=no'], {
      stdout: 'pipe',
      stderr: 'ignore',
    });

    const stdout = await new Response(p.stdout).text();
    count = stdout
      .split('\n')
      .filter((line) => line.trim().length > 0).length;
  } catch {
    count = 0;
  }

  // Store in cache with expiration
  cache.set(project, { value: count, expiresAt: currentTime + ttlMs });

  return count;
}

export function _resetGitStatusProbeCache(): void {
  cache.clear();
}
