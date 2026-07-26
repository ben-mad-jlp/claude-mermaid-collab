/**
 * Rescue refs for orphaned leaf commits.
 *
 * When an epic branch is deleted, any leaf commit that never reached the base branch
 * becomes unreachable and dies at the next `git gc`. This module plants a durable
 * `refs/collab/rescue/<leafId8>` ref for every such sha BEFORE the branch ref is
 * destroyed, preserving the commit for later recovery.
 *
 * The git probe is injected (default: async `git` runner via Bun.spawn — never spawnSync)
 * so the assembly logic — descendant walk, reachability check, ref creation — is
 * hermetically testable without a repo. Rescue is advisory: all git failures are
 * captured in `errors`, never rethrown — a failed rescue must not block teardown.
 */
import type { Todo } from './todo-store';
import { listTodos } from './todo-store';
import { epicId8, epicBranchName } from './epic-branch-status';

const GIT_PROBE_TIMEOUT_MS = 15_000;

/** Run git in `cwd` ASYNC, returning { code, stdout }. Never throws; never hangs
 *  (timeout kill). Async spawn (Bun.spawn + await exited) — never spawnSync. */
async function runGit(cwd: string, gitArgs: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const p = Bun.spawn(['git', ...gitArgs], {
      cwd,
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const killTimer = setTimeout(() => { try { p.kill(); } catch { /* already gone */ } }, GIT_PROBE_TIMEOUT_MS);
    try {
      const [stdout, code] = await Promise.all([
        p.stdout ? new Response(p.stdout).text() : Promise.resolve(''),
        p.exited,
      ]);
      return { code: code ?? 1, stdout };
    } finally {
      clearTimeout(killTimer);
    }
  } catch {
    return { code: 1, stdout: '' };
  }
}

export interface RescuedCommit {
  leafId: string;
  sha: string;
  ref: string;
}

export interface RescueReport {
  project: string;
  epicId: string;
  branch: string;
  rescued: RescuedCommit[];
  errors: string[];
}

export type RescueGitRunner = (args: string[]) => Promise<{ code: number; stdout: string }>;

/**
 * Pure assembly: rescue orphaned leaf commits before branch deletion.
 *
 * For each leaf in `todos` (transitive descendants of `epicId`, excluding dropped),
 * find unreachable commits tagged with `Collab-Todo: <leafId>` and plant
 * `refs/collab/rescue/<leafId8>` to preserve them.
 *
 * Never throws; all failures are captured in the returned `errors` array.
 */
export async function rescueOrphanedLeafCommits(
  project: string,
  epicId: string,
  todos: Todo[],
  opts?: { runner?: RescueGitRunner; baseRef?: string; branch?: string },
): Promise<RescueReport> {
  const runner = opts?.runner ?? ((args: string[]) => runGit(project, args));
  const baseRef = opts?.baseRef ?? 'master';
  const branch = opts?.branch ?? epicBranchName(epicId);
  const errors: string[] = [];
  const rescued: RescuedCommit[] = [];

  try {
    // Resolve base ref; fall back to main if master doesn't exist.
    let baseRefResolved = baseRef;
    const masterProbe = await runner(['rev-parse', '--verify', '--quiet', `refs/heads/${baseRef}`]);
    if (masterProbe.code !== 0) {
      const mainProbe = await runner(['rev-parse', '--verify', '--quiet', 'refs/heads/main']);
      if (mainProbe.code !== 0) {
        errors.push(`base ref ${baseRef} not found, and main does not exist either`);
        return { project, epicId, branch, rescued, errors };
      }
      baseRefResolved = 'main';
    }

    // Build descendants: transitive children of epic, cycle-safe, excluding dropped.
    const childrenOf = new Map<string, Todo[]>();
    for (const t of todos) {
      if (t.parentId) {
        const arr = childrenOf.get(t.parentId) ?? [];
        arr.push(t);
        childrenOf.set(t.parentId, arr);
      }
    }

    const descendantsOf = (epic: Todo): Todo[] => {
      const result: Todo[] = [];
      const stack = [...(childrenOf.get(epic.id) ?? [])];
      const seen = new Set<string>();
      while (stack.length) {
        const node = stack.pop()!;
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        result.push(node);
        stack.push(...(childrenOf.get(node.id) ?? []));
      }
      return result;
    };

    const epic = todos.find((t) => t.id === epicId);
    let leafIds: Map<string, Todo> | null = null;
    if (epic) {
      leafIds = new Map();
      for (const desc of descendantsOf(epic)) {
        if (desc.status !== 'dropped') {
          leafIds.set(desc.id, desc);
        }
      }
    }

    // Fallback: if no epic or no descendants, scan the branch for Collab-Todo trailers.
    if (!leafIds || leafIds.size === 0) {
      const logRes = await runner(['log', '--format=%H%x1f%B', branch]);
      if (logRes.code === 0) {
        const commits = logRes.stdout.split('\n');
        leafIds = new Map();
        for (const commit of commits) {
          if (!commit) continue;
          const [sha, body] = commit.split('\x1f');
          if (!sha || !body) continue;
          const match = body.match(/Collab-Todo:\s*([a-zA-Z0-9-]+)/);
          if (match) {
            const id = match[1];
            if (!leafIds.has(id)) {
              leafIds.set(id, { id } as Todo);
            }
          }
        }
      }
    }

    if (!leafIds) leafIds = new Map();

    // Per leaf: find unreachable commits and create rescue refs.
    for (const [leafId, leaf] of leafIds) {
      const id8 = epicId8(leafId);

      // Find commits with this leaf's trailer on the branch.
      const logRes = await runner([
        'log',
        '--format=%H',
        '--fixed-strings',
        `--grep=Collab-Todo: ${leafId}`,
        `refs/heads/${branch}`,
      ]);

      if (logRes.code !== 0 || !logRes.stdout.trim()) {
        continue; // No commits for this leaf on the branch.
      }

      const shas = logRes.stdout
        .trim()
        .split('\n')
        .filter((s) => s.length > 0);

      for (let i = 0; i < shas.length; i++) {
        const sha = shas[i];

        // Check reachability: `git merge-base --is-ancestor <sha> <baseRef>`
        const isAncestorRes = await runner([
          'merge-base',
          '--is-ancestor',
          sha,
          `refs/heads/${baseRefResolved}`,
        ]);

        if (isAncestorRes.code === 0) {
          // Sha is already reachable from base — no rescue needed.
          continue;
        }

        // Sha is unreachable — create a rescue ref.
        const refName =
          i === 0
            ? `refs/collab/rescue/${id8}` // First (newest) sha gets clean ref name.
            : `refs/collab/rescue/${id8}-${sha.slice(0, 7)}`; // Additional shas get sha suffix.

        const updateRes = await runner(['update-ref', refName, sha]);
        if (updateRes.code === 0) {
          rescued.push({ leafId, sha, ref: refName });
        } else {
          errors.push(`failed to create rescue ref ${refName} for ${leafId}: exit ${updateRes.code}`);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`rescue exception: ${msg}`);
  }

  return { project, epicId, branch, rescued, errors };
}

/**
 * DB-backed wrapper: list all todos (including completed), then delegate to
 * `rescueOrphanedLeafCommits`.
 */
export async function rescueOrphanedLeafCommitsForEpic(
  project: string,
  epicId: string,
  opts?: { runner?: RescueGitRunner; baseRef?: string; branch?: string },
): Promise<RescueReport> {
  const todos = listTodos(project, { includeCompleted: true });
  return rescueOrphanedLeafCommits(project, epicId, todos, opts);
}

/**
 * Resolve epic by leading-8 id prefix from a `collab/epic/<id8>` branch name,
 * match the epic todo, and delegate. Fallback: if no epic todo matches, use
 * branch-wide `Collab-Todo:` trailer scan (pure fallback, no epic id).
 */
export async function rescueOrphanedLeafCommitsForBranch(
  project: string,
  branch: string,
  opts?: { runner?: RescueGitRunner; baseRef?: string },
): Promise<RescueReport> {
  // Extract <id8> from collab/epic/<id8>.
  const match = branch.match(/^collab\/epic\/(.+)$/);
  if (!match) {
    return { project, epicId: '', branch, rescued: [], errors: ['invalid branch name for rescue'] };
  }

  const id8 = match[1];
  const todos = listTodos(project, { includeCompleted: true });
  const epic = todos.find((t) => t.id.startsWith(id8));

  if (!epic) {
    // Fallback: orphan branch, scan for trailers.
    return rescueOrphanedLeafCommits(project, '', todos, { ...opts, branch });
  }

  return rescueOrphanedLeafCommits(project, epic.id, todos, { ...opts, branch });
}
