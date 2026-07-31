/**
 * Adopt a branch (branch name or HEAD worktree ref) as an epic, capturing its commits
 * into a new epic+leaf with the leaf immediately marked accepted (no gate).
 *
 * Flow:
 * 1. Resolve source to a git SHA (rev-parse)
 * 2. Enumerate commits ahead of master (rev-list master..<source>)
 * 3. Create epic + land leaf via createEpicWithLandLeaf + addLeavesToEpic
 * 4. Update targetProject on the leaf if provided
 * 5. Create a git branch at the source SHA (plumbing branch-create, no checkout)
 * 6. Override-accept the leaf (no gate)
 * 7. Return epic id, epic branch name, leaf id, and commit list
 */
import { getTodo, updateTodo, overrideAcceptTodo, type Todo } from './todo-store.js';
import { epicBranchName } from './epic-branch-status.js';
import { createEpicWithLandLeaf, addLeavesToEpic } from '../mcp/workgraph-tools.js';

export interface AdoptBranchAsEpicOpts {
  source: string;
  title: string;
  description?: string;
  home?: string | null;
  servesCriterionIds?: string[];
  targetProject?: string;
}

export interface AdoptBranchAsEpicResult {
  epicId: string;
  epicBranch: string;
  leafId: string;
  commits: string[];
}

/** Run git in `gitRoot` ASYNC, returning { code, stdout }. Never throws; never hangs. */
export async function runGit(
  gitRoot: string,
  gitArgs: string[],
): Promise<{ code: number; stdout: string }> {
  try {
    const p = Bun.spawn(['git', ...gitArgs], {
      cwd: gitRoot,
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const [stdout, code] = await Promise.all([
      p.stdout ? new Response(p.stdout).text() : Promise.resolve(''),
      p.exited,
    ]);
    return { code: code ?? 1, stdout };
  } catch {
    return { code: 1, stdout: '' };
  }
}

/**
 * Resolve the repo's trunk branch by probing local refs: `main` first, then
 * `master`, else the literal fallback `'master'`. This mirrors
 * WorktreeManager.detectBaseBranch()'s local-ref preference so a repo whose trunk
 * is `main` (no `master` ref) resolves correctly, while a `master`-trunk repo
 * resolves to `'master'` unchanged (behaviour-preserving). Never throws.
 */
export async function detectBaseTrunk(
  gitRoot: string,
  runGitFn: typeof runGit,
): Promise<string> {
  for (const cand of ['main', 'master']) {
    const r = await runGitFn(gitRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${cand}`]);
    if (r.code === 0 && r.stdout.trim()) return cand;
  }
  return 'master';
}

export interface AdoptBranchAsEpicDeps {
  runGit: typeof runGit;
  /** Injectable trunk resolver (defaults to the real main-then-master probe).
   *  Overridable for testability. */
  detectBase?: (gitRoot: string, runGitFn: typeof runGit) => Promise<string>;
}

export const defaultAdoptBranchAsEpicDeps: AdoptBranchAsEpicDeps = { runGit };

function assertEpicRefWrite(ref: string): void {
  if (!ref.startsWith('collab/epic/')) {
    throw new Error(`adopt_branch_as_epic: refusing non-epic ref write "${ref}"`);
  }
}

async function writeEpicRef(
  deps: AdoptBranchAsEpicDeps,
  gitRoot: string,
  gitArgs: string[],
  refBeingWritten: string,
): Promise<{ code: number; stdout: string }> {
  assertEpicRefWrite(refBeingWritten);
  return deps.runGit(gitRoot, gitArgs);
}

async function refuseIfTrunkSource(
  gitRoot: string,
  source: string,
  sourceSha: string,
  trunk: string,
  deps: AdoptBranchAsEpicDeps,
): Promise<void> {
  if (source === trunk || source === `refs/heads/${trunk}`) {
    throw new Error(
      `adopt_branch_as_epic: refusing source "${source}" — cannot adopt ${trunk} itself; adopt a topic branch, not ${trunk}`,
    );
  }

  const trunkResolve = await deps.runGit(gitRoot, ['rev-parse', '--verify', trunk]);
  if (trunkResolve.code === 0) {
    const trunkSha = trunkResolve.stdout.trim();
    if (trunkSha === sourceSha) {
      throw new Error(
        `adopt_branch_as_epic: refusing source "${source}" — cannot adopt ${trunk} itself; adopt a topic branch, not ${trunk}`,
      );
    }
  }
}

async function refuseIfDirtyMainCheckout(gitRoot: string, deps: AdoptBranchAsEpicDeps): Promise<void> {
  const statusResult = await deps.runGit(gitRoot, ['status', '--porcelain']);
  const dirtyLines = statusResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (dirtyLines.length > 0) {
    const dirtyPaths = dirtyLines.map((line) => {
      const parts = line.split(/\s+/);
      return parts.slice(1).join(' ');
    });
    throw new Error(
      `adopt_branch_as_epic: main checkout at "${gitRoot}" is dirty — commit or stash ${dirtyPaths.join(', ')}, then re-run`,
    );
  }
}

export async function adoptBranchAsEpic(
  project: string,
  session: string,
  opts: AdoptBranchAsEpicOpts,
  deps: AdoptBranchAsEpicDeps = defaultAdoptBranchAsEpicDeps,
): Promise<AdoptBranchAsEpicResult> {
  const gitRoot = opts.targetProject ?? project;

  // Resolve the trunk ONCE (main-then-master probe; 'master' on a master-trunk repo,
  // so all downstream git commands are behaviour-preserving there). Injectable for tests.
  const trunk = await (deps.detectBase ?? detectBaseTrunk)(gitRoot, deps.runGit);

  // 1. Resolve source to SHA
  const revParseResult = await deps.runGit(gitRoot, ['rev-parse', '--verify', opts.source]);
  if (revParseResult.code !== 0) {
    throw new Error(`adopt_branch_as_epic: failed to resolve source "${opts.source}" (git rev-parse failed)`);
  }
  const sourceSha = revParseResult.stdout.trim();
  if (!sourceSha) {
    throw new Error(`adopt_branch_as_epic: source "${opts.source}" resolved to empty SHA`);
  }

  // Guard: refuse the trunk (main OR master) as source
  await refuseIfTrunkSource(gitRoot, opts.source, sourceSha, trunk, deps);

  // Guard: refuse if main checkout is dirty
  await refuseIfDirtyMainCheckout(gitRoot, deps);

  // 2. Enumerate commits ahead of the trunk (oldest first)
  const revListResult = await deps.runGit(gitRoot, [
    'rev-list',
    '--reverse',
    `${trunk}..${sourceSha}`,
  ]);
  if (revListResult.code !== 0) {
    throw new Error(`adopt_branch_as_epic: failed to enumerate commits (git rev-list failed)`);
  }
  const commits = revListResult.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  if (commits.length === 0) {
    throw new Error(`adopt_branch_as_epic: source has no commits ahead of ${trunk}`);
  }

  // 3. Create epic + land leaf via existing helpers
  const { epic } = await createEpicWithLandLeaf(project, session, {
    title: opts.title,
    description: opts.description,
    // homeProvided:true is a deliberate default-to-root-epic choice — adopted stray work
    // is not mission-scoped unless the caller passes `home` explicitly.
    homeProvided: true,
    home: opts.home ?? null,
    servesCriterionIds: opts.servesCriterionIds,
  });

  // 4. If targetProject is set, update it on the epic BEFORE adding leaves,
  // so addLeavesToEpic's targetProject-inherit (workgraph-tools.ts:245) propagates it.
  if (opts.targetProject) {
    await updateTodo(project, epic.id, { targetProject: opts.targetProject });
  }

  // 5. Add one leaf to the epic
  const { createdIds } = await addLeavesToEpic(project, session, epic.id, [
    {
      title: opts.title,
      description: opts.description,
      servesCriterionIds: opts.servesCriterionIds,
    },
  ]);
  const leafId = createdIds[0];

  // 6. Create a branch at the source SHA (plumbing — no checkout, no merge)
  const branch = epicBranchName(epic.id);
  const branchCreateResult = await writeEpicRef(deps, gitRoot, ['branch', branch, sourceSha], branch);
  if (branchCreateResult.code !== 0) {
    throw new Error(
      `adopt_branch_as_epic: failed to create branch "${branch}" at ${sourceSha} (git branch failed)`,
    );
  }

  // 7. Override-accept the leaf (same done+accepted semantics as override_accept_todo)
  await overrideAcceptTodo(project, leafId, 'adopt_branch_as_epic');

  // 8. Return the result
  return {
    epicId: epic.id,
    epicBranch: branch,
    leafId,
    commits,
  };
}
