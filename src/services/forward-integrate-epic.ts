/**
 * Forward-integrate epic — bring an epic's accumulation branch up to date with trunk.
 *
 * Forward-MERGE only (--no-ff, never rebase). The merge happens in WorktreeManager;
 * this service only surfaces the result. On conflict the merge is ABORTED and the branch
 * is left exactly as it was — conflicted paths are returned for a human to resolve.
 */
import type { WorktreeManager } from '../agent/worktree-manager.ts';
import { getWorktreeManager } from '../services/coordinator-live.ts';
import { getTodo, listTodos } from './todo-store.ts';
import type { GitProbe } from './epic-branch-status.ts';
import { makeGitProbe } from './epic-branch-status.ts';

export interface ForwardIntegrateEpicToolResult {
  ok: boolean;
  epicId: string;          // resolved full id
  epicBranch: string;      // collab/epic/<id8>
  baseRef: string;
  beforeSha: string | null;
  afterSha: string | null;
  advanced: boolean;       // a new --no-ff merge commit was created
  conflict: boolean;
  conflictedPaths?: string[];
  ahead: number | null;    // after the merge, vs baseRef
  behind: number | null;   // after the merge — 0 on success
  skippedReason?: string;
  reason?: string;         // 'epic-not-found' | 'conflict' | skippedReason
}

export interface ForwardIntegrateDeps {
  wm?: WorktreeManager;
  projectRoot?: string;                                  // root the probe reads
  resolveEpicId?: (project: string, id: string) => string | null;
  probe?: GitProbe;
}

export async function forwardIntegrateEpicTool(
  project: string,
  epicIdArg: string,
  opts?: { baseRef?: string; deps?: ForwardIntegrateDeps },
): Promise<ForwardIntegrateEpicToolResult> {
  const baseRef = opts?.baseRef ?? 'master';
  const deps = opts?.deps;

  // Resolve the leading-8 prefix.
  const resolve = deps?.resolveEpicId ?? ((p: string, i: string) => {
    const direct = getTodo(p, i);
    if (direct) return direct.id;
    // Fall back to startsWith scan for short-id resolution.
    const found = listTodos(p, { includeCompleted: true }).find((t) => t.id.startsWith(i));
    return found?.id ?? null;
  });

  const epicId = resolve(project, epicIdArg);
  if (!epicId) {
    return {
      ok: false,
      reason: 'epic-not-found',
      epicId: epicIdArg,
      epicBranch: '',
      baseRef,
      beforeSha: null,
      afterSha: null,
      advanced: false,
      conflict: false,
      ahead: null,
      behind: null,
    };
  }

  const targetProject = deps?.projectRoot ?? getTodo(project, epicId)?.targetProject ?? project;
  const wm = deps?.wm ?? getWorktreeManager(targetProject);

  const epicBranch = wm.epicBranchName(epicId);
  const beforeSha = await wm.epicHeadSha(epicId);

  // The ONLY mutation: delegate to WorktreeManager.forwardIntegrateEpic.
  const res = await wm.forwardIntegrateEpic(epicId, baseRef);

  const afterSha = await wm.epicHeadSha(epicId);

  // On conflict: merge was ABORTED, branch untouched.
  if (res.conflict) {
    return {
      ok: false,
      conflict: true,
      conflictedPaths: res.conflictedPaths ?? [],
      reason: 'conflict',
      advanced: false,
      beforeSha,
      afterSha,
      ahead: null,
      behind: null,
      epicId,
      epicBranch,
      baseRef,
    };
  }

  // On success or skip: gather ahead/behind via the git probe.
  const p = deps?.probe ?? makeGitProbe(targetProject);
  const probe = p(epicBranch, baseRef);

  return {
    ok: res.integrated && !res.skippedReason,
    advanced: res.advanced,
    conflict: false,
    ahead: probe.ahead,
    behind: probe.behind,
    beforeSha,
    afterSha,
    skippedReason: res.skippedReason,
    reason: res.skippedReason,
    epicId,
    epicBranch,
    baseRef,
  };
}
