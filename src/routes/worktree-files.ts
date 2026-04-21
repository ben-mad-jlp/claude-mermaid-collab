import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function defaultLookupWorktreePath(sessionId: string | null): string | null {
  if (!sessionId) return null;
  const worktreesDir = join(process.cwd(), '.collab', 'agent-sessions', 'worktrees');
  if (!existsSync(worktreesDir)) return null;
  try {
    for (const f of readdirSync(worktreesDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const rec = JSON.parse(readFileSync(join(worktreesDir, f), 'utf-8'));
        if (rec.sessionId === sessionId && typeof rec.path === 'string') return rec.path;
      } catch {}
    }
  } catch {}
  return null;
}

// Lightweight ignore list; keep the walker fast and bounded.
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '.collab',
  '.chromedev-director',
  '.claude',
]);

function walk(root: string, limit: number): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length && out.length < limit) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith('.') && name !== '.env.example') {
        // Allow hidden dotfiles at project root only when explicitly referenced
        // via a prefix query; but avoid descending into heavy hidden dirs.
        if (IGNORE_DIRS.has(name)) continue;
      }
      if (IGNORE_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile()) {
        out.push(relative(root, full));
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

export interface WorktreeFilesOptions {
  lookupWorktreePath?: (sessionId: string | null) => string | null;
  defaultRoot?: string;
  limit?: number;
  maxResults?: number;
}

export function createWorktreeFilesHandler(options: WorktreeFilesOptions = {}) {
  const lookup = options.lookupWorktreePath ?? defaultLookupWorktreePath;
  const defaultRoot = options.defaultRoot ?? process.cwd();
  const walkLimit = options.limit ?? 5000;
  const maxResults = options.maxResults ?? 50;
  return async function handleWorktreeFilesAPI(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const sessionId = url.searchParams.get('sessionId');
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const root = lookup(sessionId) ?? defaultRoot;
      if (!existsSync(root)) {
        return new Response(JSON.stringify({ files: [] }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const all = walk(root, walkLimit);
      const filtered = q
        ? all.filter((p) => p.toLowerCase().includes(q))
        : all;
      // Rank: shorter paths first, then basename matches, then alpha.
      filtered.sort((a, b) => {
        if (q) {
          const aBase = a.slice(a.lastIndexOf('/') + 1).toLowerCase();
          const bBase = b.slice(b.lastIndexOf('/') + 1).toLowerCase();
          const aStart = aBase.startsWith(q) ? 0 : 1;
          const bStart = bBase.startsWith(q) ? 0 : 1;
          if (aStart !== bStart) return aStart - bStart;
        }
        if (a.length !== b.length) return a.length - b.length;
        return a.localeCompare(b);
      });
      const trimmed = filtered.slice(0, maxResults);
      return new Response(JSON.stringify({ files: trimmed }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  };
}

export const handleWorktreeFilesAPI = createWorktreeFilesHandler();
