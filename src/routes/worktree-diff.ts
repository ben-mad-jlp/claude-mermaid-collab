import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function run(cmd: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

function defaultLookupWorktreePath(sessionId: string): string | null {
  const worktreesDir = join(process.cwd(), '.collab', 'agent-sessions', 'worktrees');
  if (!existsSync(worktreesDir)) return null;
  for (const f of readdirSync(worktreesDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const rec = JSON.parse(readFileSync(join(worktreesDir, f), 'utf-8'));
      if (rec.sessionId === sessionId && typeof rec.path === 'string') return rec.path;
    } catch {}
  }
  return null;
}

export interface WorktreeDiffOptions {
  lookupWorktreePath?: (sessionId: string) => string | null;
}

function parsePorcelain(output: string): Array<{ path: string; status: string }> {
  // porcelain=v1 -z: each entry `XY SP path NUL`, rename R/copy C has two NUL-delimited paths.
  const entries: Array<{ path: string; status: string }> = [];
  const bytes = output.split('\0');
  let i = 0;
  while (i < bytes.length) {
    const token = bytes[i];
    if (!token) { i++; continue; }
    if (token.length < 3) { i++; continue; }
    const XY = token.slice(0, 2);
    const path = token.slice(3);
    let status = 'M';
    if (XY === '??') status = '??';
    else if (XY[0] === 'A' || XY[1] === 'A') status = 'A';
    else if (XY[0] === 'D' || XY[1] === 'D') status = 'D';
    else if (XY[0] === 'R' || XY[1] === 'R') status = 'R';
    else if (XY[0] === 'C' || XY[1] === 'C') status = 'R';
    else status = 'M';
    entries.push({ path, status });
    if (XY[0] === 'R' || XY[0] === 'C') i += 2; else i += 1;
  }
  return entries;
}

export function createWorktreeDiffHandler(options: WorktreeDiffOptions = {}) {
  const lookup = options.lookupWorktreePath ?? defaultLookupWorktreePath;
  return async function handleWorktreeDiffAPI(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) return jsonError('Missing required query parameter: sessionId', 400);
      const worktreePath = lookup(sessionId);
      if (!worktreePath) return new Response('[]', { headers: { 'Content-Type': 'application/json' } });

      const statusRes = await run(['git', 'status', '--porcelain=v1', '-z'], worktreePath);
      if (statusRes.code !== 0) return jsonError(statusRes.stderr || 'git status failed', 500);
      const entries = parsePorcelain(statusRes.stdout);

      const results: Array<{ path: string; status: string; patch: string }> = [];
      for (const { path, status } of entries) {
        let patch = '';
        if (status === '??') {
          const r = await run(['git', 'diff', '--no-color', '--no-index', '/dev/null', path], worktreePath);
          patch = r.stdout;
        } else {
          const r = await run(['git', 'diff', '--no-color', 'HEAD', '--', path], worktreePath);
          patch = r.stdout;
        }
        results.push({ path, status, patch });
      }
      return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      console.error('[Worktree Diff] Error:', err);
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  };
}

export const handleWorktreeDiffAPI = createWorktreeDiffHandler();
