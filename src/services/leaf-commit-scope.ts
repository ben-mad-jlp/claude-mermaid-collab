import { execFileSync } from 'node:child_process';
import { listUntrackedPaths as listUntrackedPathsStaging } from './stage-untracked';

const CHUNK_SIZE = 500;

export interface ScopeInput {
  /** (a) declared scope: blueprint files ∪ parsed "Implement ONLY this file: X". May be empty. */
  declaredFiles: string[];
  /** (b) untracked non-ignored paths present at leaf START (from listUntrackedPaths at snapshot time). */
  untrackedAtStart: string[];
}

export interface ScopeDecision {
  stage: string[]; // what to `git add --`
  outOfScope: string[]; // dirty/i-t-a but NOT staged — warn + ledger
  incident: boolean; // declaredFiles non-empty AND nothing in scope is dirty/created
}

export interface ScopedCommitResult {
  commits: Array<{ sha: string; paths: string[]; boundary?: string }>;
  outOfScope: string[];
}

/** Parse "Implement ONLY this file: <path>" from a description. Matches one line, trimmed. */
export function parseDeclaredScope(description: string | null | undefined): string[] {
  if (!description || typeof description !== 'string') return [];
  const match = description.match(/^Implement ONLY this file:\s*(.+)$/m);
  if (!match || !match[1]) return [];
  return [match[1].trim()].filter(Boolean);
}

/** Normalize repo-relative paths: strip leading ./, deduplicate. */
function normalizePaths(paths: string[]): string[] {
  const normalized = new Set(
    paths.map((p) => {
      let clean = p.trim();
      if (clean.startsWith('./')) clean = clean.slice(2);
      return clean;
    })
  );
  return Array.from(normalized);
}

/** Get dirty/deleted/i-t-a-added tracked paths. Handles unborn HEAD. */
export function trackedDirtyPaths(cwd: string): string[] {
  try {
    // Try the normal case first: diff against HEAD.
    const res = execFileSync('git', ['-C', cwd, 'diff', '--name-only', '-z', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return res.split('\0').filter((p) => p.length > 0);
  } catch {
    // Unborn HEAD (no commits yet) — fall back to worktree + cached diffs.
    try {
      const wt = execFileSync('git', ['-C', cwd, 'diff', '--name-only', '-z'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const cached = execFileSync('git', ['-C', cwd, 'diff', '--cached', '--name-only', '-z'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const wtPaths = wt.split('\0').filter((p) => p.length > 0);
      const cachedPaths = cached.split('\0').filter((p) => p.length > 0);
      return Array.from(new Set([...wtPaths, ...cachedPaths]));
    } catch {
      return [];
    }
  }
}

/** Re-export listUntrackedPaths from stage-untracked. */
export function listUntrackedPaths(cwd: string): string[] {
  return listUntrackedPathsStaging(cwd);
}

/** Compute what should be staged and what is out-of-scope. */
export function computeCommitScope(cwd: string, input: ScopeInput): ScopeDecision {
  const createdNow = listUntrackedPaths(cwd).filter((p) => !input.untrackedAtStart.includes(p));
  const trackedDirty = trackedDirtyPaths(cwd);
  const declared = normalizePaths(input.declaredFiles);

  if (declared.length === 0) {
    // Legacy/report leaves: tracked edits + own new files. Pre-existing untracked junk excluded.
    return {
      stage: Array.from(new Set([...trackedDirty, ...createdNow])),
      outOfScope: [],
      incident: false,
    };
  }

  // Declared scope: only in-scope changes stage, BUT created files always ship (requirement b).
  const inScope = trackedDirty.filter((p) => declared.some((d) => p === d || p.startsWith(d + '/')));
  const stage = Array.from(new Set([...inScope, ...createdNow]));
  const allDirty = new Set([...trackedDirty, ...listUntrackedPaths(cwd)]);
  const outOfScope = Array.from(allDirty).filter((p) => !stage.includes(p));
  const incident = stage.length === 0;

  return { stage, outOfScope, incident };
}

/** Group paths by boundary prefix. Paths not matching any boundary go into '' key. */
function groupByBoundary(
  paths: string[],
  boundaries?: string[]
): Map<string, string[]> {
  if (!boundaries || boundaries.length === 0) {
    return new Map([['', paths]]);
  }

  const groups = new Map<string, string[]>();
  for (const boundary of boundaries) {
    groups.set(boundary, []);
  }
  groups.set('', []);

  for (const path of paths) {
    let found = false;
    for (const boundary of boundaries) {
      if (path === boundary.replace(/\/$/, '') || path.startsWith(boundary)) {
        groups.get(boundary)!.push(path);
        found = true;
        break;
      }
    }
    if (!found) {
      groups.get('')!.push(path);
    }
  }

  return groups;
}

/** Stage, reset out-of-scope i-t-a entries, and commit (optionally per boundary). */
export async function stageAndCommitScoped(
  run: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>,
  opts: {
    stage: string[];
    outOfScope: string[];
    message: string;
    trailer?: string;
    boundaries?: string[];
  },
): Promise<ScopedCommitResult> {
  const commits: Array<{ sha: string; paths: string[]; boundary?: string }> = [];

  if (opts.stage.length === 0) {
    // Nothing to commit — return empty result.
    return { commits, outOfScope: opts.outOfScope };
  }

  // Group staged files by boundary.
  const groups = groupByBoundary(opts.stage, opts.boundaries);
  const groupOrder = Array.from(groups.keys()).filter((k) => groups.get(k)!.length > 0);
  const hasMultiple = groupOrder.length > 1;

  // Per boundary group: stage, reset out-of-scope, commit.
  for (const boundary of groupOrder) {
    const paths = groups.get(boundary)!;

    // Stage this boundary's files in chunks.
    for (let i = 0; i < paths.length; i += CHUNK_SIZE) {
      const chunk = paths.slice(i, i + CHUNK_SIZE);
      const res = await run(['add', '-A', '--', ...chunk]);
      if (res.code !== 0) {
        throw new Error(`git add failed: ${res.stderr.trim()}`);
      }
    }

    // Reset out-of-scope i-t-a entries (non-fatal if errors).
    if (opts.outOfScope.length > 0) {
      for (let i = 0; i < opts.outOfScope.length; i += CHUNK_SIZE) {
        const chunk = opts.outOfScope.slice(i, i + CHUNK_SIZE);
        try {
          await run(['reset', '-q', '--', ...chunk]);
        } catch {
          // Non-fatal: unborn HEAD or other issues.
        }
      }
    }

    // Commit this boundary group.
    const messageForBoundary =
      boundary && hasMultiple ? `${opts.message} (${boundary})` : opts.message;
    const body = opts.trailer ? `\n\n${opts.trailer}` : '';
    const fullMessage = messageForBoundary + body;

    const res = await run(['commit', '-m', fullMessage]);
    if (res.code !== 0) {
      throw new Error(`git commit failed: ${res.stderr.trim() || res.stdout.trim()}`);
    }

    const shaRes = await run(['rev-parse', 'HEAD']);
    if (shaRes.code === 0) {
      const sha = shaRes.stdout.trim();
      if (sha) {
        commits.push({ sha, paths, boundary: boundary || undefined });
      }
    }
  }

  return { commits, outOfScope: opts.outOfScope };
}
