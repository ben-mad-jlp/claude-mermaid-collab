import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import type { WorktreeInfo, NonGitFallback, SessionWorktree } from './contracts';

export interface WorktreeManagerOpts {
  projectRoot: string; // absolute path to the project (git) root
  baseDir: string; // where worktrees live, e.g. path.join(persistDir, 'worktrees')
  persistDir: string; // base dir for manager metadata JSON
  /** Optional injectable spawn — defaults to Bun.spawn, matches child-manager convention. */
  spawn?: (cmd: string[], opts: any) => any;
  /** Optional clock for deterministic tests. */
  now?: () => number;
}

export interface PRResult {
  branch: string;
  commitSha?: string;
  prUrl?: string;
  pushed: boolean;
  dirtyBefore: boolean;
}

export interface CommitPushPROpts {
  title: string;
  body?: string;
  draft?: boolean;
  onProgress?: (channel: 'stdout' | 'stderr', chunk: string) => void;
  timeoutMs?: number;
}

/** The synthetic catch-all epic — the Inbox epic. Any accepted work whose todo has
 *  no `[EPIC]` ancestor accumulates on this ONE epic's branch (`collab/epic/inbox`),
 *  branched off master like any other epic. (FBPE P5 retired the legacy
 *  `collab/integration` trunk and its `ensureIntegration`/`commitAndMergeToIntegration`
 *  wrappers — the Inbox-epic branch is now the universal default, so callers use the
 *  epic-parametrized methods directly with this id.) */
export const INBOX_EPIC_ID = 'inbox';

/** A per-epic accumulation worktree (FBPE P1 — replaces IntegrationWorktree).
 *  Accepted worker branches merge BACK into `branch`; the branch is the
 *  accumulated result of the epic's wave. */
export interface EpicWorktree {
  epicId: string;
  branch: string;
  path: string; // absolute path to the epic worktree dir
}

export interface MergeBackResult {
  /** A new commit was created in the worker's worktree (false → nothing to commit). */
  committed: boolean;
  /** The worker branch merged cleanly into the epic branch. */
  merged: boolean;
  /** Merge hit a conflict (epic branch left untouched — aborted). Caller escalates. */
  conflict: boolean;
  commitSha?: string;
  /** The epic accumulation branch the worker merged into (collab/epic/<id8>). */
  epicBranch: string;
  workerBranch?: string;
  /** The --no-ff merge commit sha created on the epic branch (merged === true). */
  mergeSha?: string;
  /** BP0 INVARIANT: the todo's work is VERIFIABLY present on the epic branch after
   *  this call — i.e. a commit carrying its `Collab-Todo: <id>` trailer is reachable
   *  from collab/epic/<id8>. FALSE on the two stranding modes the acceptance gate
   *  must reject: (a) PHANTOM — a clean worktree with no commit anywhere (the merge
   *  was a no-op "Already up to date"), and (b) a lane whose commits never reached
   *  the epic branch. Only meaningful when `opts.todoId` was supplied (else true on a
   *  clean merge, preserving legacy callers). Gating acceptance on this is what
   *  guarantees `accepted` ⇒ work-on-epic-branch. */
  integrated: boolean;
}

export interface CommitMergeOpts {
  message: string;
  /** Optional todo id → emitted as a `Collab-Todo` trailer on the epic merge commit. */
  todoId?: string;
  onProgress?: (channel: 'stdout' | 'stderr', chunk: string) => void;
  timeoutMs?: number;
}

export interface LandOpts {
  /** Branch to land onto (default 'master'). */
  baseRef?: string;
  onProgress?: (channel: 'stdout' | 'stderr', chunk: string) => void;
  timeoutMs?: number;
  /** When set, append an `Allow-Dirty: <paths>` trailer to the land commit message
   *  (the operator overrode the clean-tree guard for this land). */
  allowDirtyPaths?: string[];
}

/** Result of forward-integrating trunk INTO an epic accumulation branch (38d87ab3).
 *  Keeps the build-time base in sync with the claim-time reachability union (71cebee3)
 *  so a lane never forks from a stale epic tip that's missing trunk work it depends on. */
export interface ForwardIntegrateResult {
  /** The epic branch already contained trunk (nothing to do) OR trunk merged cleanly in. */
  integrated: boolean;
  /** Trunk was actually merged (a new --no-ff merge commit was created on the epic branch). */
  advanced: boolean;
  /** The forward-merge hit a conflict — the epic branch is UNTOUCHED (aborted). Caller escalates. */
  conflict: boolean;
  /** Skipped without merging: not-a-git-repo, missing branch, or a dirty epic worktree. */
  skippedReason?: string;
  /** Files left in conflict (conflict === true) — for the escalation message. */
  conflictedPaths?: string[];
}

/** Result of landing an epic's accumulation branch onto master (FBPE P4). */
export interface LandResult {
  /** The epic branch merged into master and the master ref was advanced. */
  landed: boolean;
  /** The merge hit a conflict — master is UNTOUCHED (merge aborted, ref not advanced). */
  conflict: boolean;
  /** The new master sha after the --no-ff land merge (landed === true). */
  masterSha?: string;
  /** Machine reason on a non-landed outcome (e.g. 'epic-merge-conflict', 'non-git'). */
  reason?: string;
}

/** Result of checking whether an epic's accumulation branch has drifted behind trunk.
 *  Pure-read staleness detector: reports trunk commits not yet integrated and/or
 *  overlapping file changes since the epic fork point. Never mutates. */
export interface StalenessResult {
  stale: boolean;
  commitsAhead: number;          // trunk commits the epic has NOT integrated
  maxAhead: number;              // the threshold N actually used
  trunkSha: string;              // resolved trunk tip ('' if unresolved)
  epicSha: string;               // epic branch tip ('' if branch missing)
  mergeBase: string;             // '' if no merge-base / branch missing
  overlap: string[];             // files touched on BOTH sides since mergeBase
  reason: 'fresh' | 'ahead-exceeds-max' | 'file-overlap';
}

export interface EnsureOpts {
  /** Branch the new worktree off this ref instead of the detected base branch.
   *  Used by the isolation model to branch each worker off the LATEST integration
   *  branch so it sees all prior accepted work. */
  baseBranch?: string;
  /** Force a brand-NEW worktree+branch even when a cached record still points at
   *  an existing dir. Under the isolation model a lane worktree is per-TODO: a
   *  cached worktree from a prior run carries its old branch (and any unrelated
   *  accumulated commits), so reusing it strands the new todo's work on the wrong
   *  branch. When true, tear down the cached worktree+branch (best-effort) and
   *  fall through to create a fresh one. Defaults false (legacy resume behaviour). */
  fresh?: boolean;
}

interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

const DEFAULT_STEP_TIMEOUT_MS = 5 * 60_000;
const QUICK_TIMEOUT_MS = 30_000;

export class WorktreeManager {
  private pendingEnsures = new Map<string, Promise<SessionWorktree>>();
  private readonly spawnFn: (cmd: string[], opts: any) => any;
  private readonly now: () => number;
  // Per-project worktree mutex. Git's worktree admin (.git/worktrees + the global
  // `worktree prune`) is a SHARED per-repo resource that is NOT safe under concurrent
  // add/remove/prune/merge-in-epic-worktree. Two leaves on the same epic running these
  // concurrently could `prune` a sibling's still-live leaf-exec worktree → every
  // subsequent node spawn ENOENTs (cwd gone) → churn + forced retry (todo 6bc2dc36).
  // One WorktreeManager exists per projectRoot (memoised in getWorktreeManager), so an
  // instance-level serial queue serialises all worktree mutations for the repo.
  private worktreeLock: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: WorktreeManagerOpts) {
    this.spawnFn =
      opts.spawn ?? ((cmd: string[], so: any) => (globalThis as any).Bun.spawn(cmd, so));
    this.now = opts.now ?? Date.now;
  }

  /** Serialise a worktree-mutating section behind the per-project lock. A prior section
   *  failing never blocks the queue (the chain swallows errors); the caller still sees
   *  this section's own result/error. */
  private withWorktreeLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.worktreeLock.then(fn, fn);
    this.worktreeLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // ---------------------------------------------------------------------------
  // ensure — create or resume a worktree for the session; non-git fallback.
  // ---------------------------------------------------------------------------
  async ensure(sessionId: string, opts?: EnsureOpts): Promise<SessionWorktree> {
    const pending = this.pendingEnsures.get(sessionId);
    if (pending) return pending;
    // Serialise the worktree add/remove/prune behind the per-project lock (6bc2dc36).
    const p = this.withWorktreeLock(() => this._ensureInner(sessionId, opts)).finally(() =>
      this.pendingEnsures.delete(sessionId),
    );
    this.pendingEnsures.set(sessionId, p);
    return p;
  }

  private async _ensureInner(sessionId: string, opts?: EnsureOpts): Promise<SessionWorktree> {
    // 1. cached record? verify the dir still exists.
    const cached = await this.readRecord(sessionId);
    let priorBranch: string | undefined;
    if (cached) {
      if (await this.pathExists(cached.path)) {
        if (!opts?.fresh) return cached;
        priorBranch = cached.branch;
        // DEFECT 1 — under isolation a lane worktree is per-todo. A cached worktree
        // from a prior run carries its OLD branch (and any commits accumulated
        // across earlier todos), so reusing it strands the new todo on the wrong
        // branch. With `fresh`, tear down the cached worktree+branch (best-effort)
        // and fall through to create a brand-new one off the requested base.
        await this.runGit(
          this.opts.projectRoot,
          ['worktree', 'remove', '--force', cached.path],
          QUICK_TIMEOUT_MS,
        ).catch(() => ({ code: 0, stdout: '', stderr: '' }));
        if (cached.branch) {
          await this.runGit(
            this.opts.projectRoot,
            ['branch', '-D', cached.branch],
            QUICK_TIMEOUT_MS,
          ).catch(() => ({ code: 0, stdout: '', stderr: '' }));
        }
        await this.deleteRecord(sessionId).catch(() => {});
      } else {
        // stale record — drop and fall through to re-create.
        await this.deleteRecord(sessionId).catch(() => {});
      }
    }

    // 2. projectRoot a git repo?
    if (!(await this.isGitRepo())) {
      return {
        kind: 'non_git',
        sessionId,
        path: this.opts.projectRoot,
      } satisfies NonGitFallback;
    }

    // 3. discover baseBranch (or use the caller's override — e.g. the integration
    //    branch under the isolation model).
    const baseBranch = opts?.baseBranch ?? (await this.detectBaseBranch());

    // 4. pick a branch + path, handling collisions.
    const slug = this.slug(sessionId);
    const stamp = this.timestamp();
    let branch = `collab/${slug}-${stamp}`;
    let wtPath = path.join(this.opts.baseDir, slug);

    // Path or branch-ref collision: if a dir already exists at the preferred path,
    // OR a branch with the preferred name already exists (the per-minute stamp can
    // repeat — notably under `fresh`, where we just deleted the prior same-named
    // branch and would otherwise re-create an identical one), suffix to stay unique.
    const branchRefExists = async (b: string): Promise<boolean> =>
      (
        await this.runGit(
          this.opts.projectRoot,
          ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`],
          QUICK_TIMEOUT_MS,
        ).catch(() => ({ code: 1, stdout: '', stderr: '' }))
      ).code === 0;
    // Under `fresh` we just deleted `priorBranch`; if the per-minute stamp would
    // regenerate that exact name, force a suffix so the new lane branch is provably
    // DISTINCT from the torn-down one (never silently reuse the stale identity).
    const collidesWithPrior = priorBranch !== undefined && branch === priorBranch;
    if ((await this.pathExists(wtPath)) || (await branchRefExists(branch)) || collidesWithPrior) {
      const suffix = randomBytes(2).toString('hex');
      wtPath = path.join(this.opts.baseDir, `${slug}-${suffix}`);
      branch = `${branch}-${suffix}`;
    }

    await fs.mkdir(this.opts.baseDir, { recursive: true });

    // 5. first try.
    let result = await this.runGit(
      this.opts.projectRoot,
      ['worktree', 'add', '-b', branch, wtPath, baseBranch],
      DEFAULT_STEP_TIMEOUT_MS,
    );

    // 6. on failure, try `worktree remove --force` then retry once.
    if (result.code !== 0) {
      await this.runGit(
        this.opts.projectRoot,
        ['worktree', 'remove', '--force', wtPath],
        QUICK_TIMEOUT_MS,
      ).catch(() => ({ code: 0, stdout: '', stderr: '' }));

      // Branch may also have been left dangling — try deleting it (ignore errors).
      await this.runGit(
        this.opts.projectRoot,
        ['branch', '-D', branch],
        QUICK_TIMEOUT_MS,
      ).catch(() => ({ code: 0, stdout: '', stderr: '' }));

      // Second attempt: if path still conflicts, append a fresh random suffix.
      if (await this.pathExists(wtPath)) {
        const suffix = randomBytes(2).toString('hex');
        wtPath = path.join(this.opts.baseDir, `${slug}-${suffix}`);
        branch = `collab/${slug}-${stamp}-${suffix}`;
      }

      result = await this.runGit(
        this.opts.projectRoot,
        ['worktree', 'add', '-b', branch, wtPath, baseBranch],
        DEFAULT_STEP_TIMEOUT_MS,
      );

      if (result.code !== 0) {
        throw new Error(
          `git worktree add failed (code ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`,
        );
      }
    }

    // Provisioning (decision c4a8bf40): isolate SOURCE, share DEPENDENCIES. A git
    // worktree starts WITHOUT node_modules (gitignored) → JS/Bun workers die at a
    // bare shell. Symlink the main repo's node_modules into the worktree for every
    // dir that has a package.json (root + nested, e.g. ui/) so deps resolve
    // instantly with zero disk. Best-effort: a link failure must not fail worktree
    // creation (the worker can still run; deps just won't resolve for that dir).
    await this.linkNodeModules(wtPath).catch(() => {});

    const info: WorktreeInfo = {
      sessionId,
      path: wtPath,
      branch,
      baseBranch,
      createdAt: this.now(),
    };

    await this.writeRecord(info);
    return info;
  }

  // ---------------------------------------------------------------------------
  // linkNodeModules — symlink the main repo's node_modules into a fresh worktree
  // for every package.json dir (root + nested). AUTO-DETECT: no manifest needed.
  // ---------------------------------------------------------------------------
  private async linkNodeModules(worktreePath: string): Promise<void> {
    const pkgDirs = await this.findPackageJsonDirs(worktreePath);
    const linkedRels: string[] = [];
    for (const rel of pkgDirs) {
      const srcNM = path.join(this.opts.projectRoot, rel, 'node_modules');
      const dstNM = path.join(worktreePath, rel, 'node_modules');
      // Only link where the MAIN repo actually has deps installed for that dir,
      // and skip if the worktree dir already has a node_modules (real or symlink).
      if (!(await this.pathExists(srcNM))) continue;
      if (await this.lpathExists(dstNM)) continue;
      try {
        await fs.symlink(srcNM, dstNM, 'dir');
        linkedRels.push(rel);
      } catch {
        // best-effort per dir — one missing/failed link shouldn't abort the rest
      }
    }
    // Belt-and-suspenders: regardless of what the repo .gitignore matches, write
    // every symlinked node_modules path into THIS worktree's git exclude so a
    // worker can never `git add` it. A node_modules SYMLINK staged + merged to
    // master once corrupted the main repo (ELOOP self-referential symlink); see
    // the [COORD] worktree-isolation hardening. This is independent of the
    // `node_modules/` vs `node_modules` (trailing-slash) ignore semantics.
    await this.excludeNodeModules(worktreePath, linkedRels).catch(() => {});
  }

  /** Append `/<rel>/node_modules` anchored patterns to the worktree's git
   *  exclude file (`.git/info/exclude`, resolved via `rev-parse --git-path` so
   *  it works for a linked worktree). Anchored + no trailing slash → matches the
   *  node_modules SYMLINK as well as a real directory. Idempotent: existing
   *  entries are not duplicated. */
  private async excludeNodeModules(worktreePath: string, rels: string[]): Promise<void> {
    if (rels.length === 0) return;
    const res = await this.runGit(
      worktreePath,
      ['rev-parse', '--git-path', 'info/exclude'],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (res.code !== 0 || !res.stdout.trim()) return;
    const rawPath = res.stdout.trim();
    const excludePath = path.isAbsolute(rawPath) ? rawPath : path.join(worktreePath, rawPath);

    const patterns = rels.map((rel) => {
      const p = rel ? `${rel.split(path.sep).join('/')}/node_modules` : 'node_modules';
      return `/${p}`;
    });

    let existing = '';
    try {
      existing = await fs.readFile(excludePath, 'utf8');
    } catch {
      // file may not exist yet — we'll create it
    }
    const present = new Set(existing.split('\n').map((l) => l.trim()));
    const toAdd = patterns.filter((p) => !present.has(p));
    if (toAdd.length === 0) return;

    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    const block = `${prefix}# node_modules symlinks (worktree isolation — never stage)\n${toAdd.join('\n')}\n`;
    await fs.mkdir(path.dirname(excludePath), { recursive: true });
    await fs.appendFile(excludePath, block, 'utf8');
  }

  // ---------------------------------------------------------------------------
  // findPackageJsonDirs — bounded walk returning dirs (relative to root) that
  // contain a package.json. Skips node_modules/.git/build output + dotdirs.
  // ---------------------------------------------------------------------------
  private async findPackageJsonDirs(root: string): Promise<string[]> {
    const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'out']);
    const out: string[] = [];
    const walk = async (relDir: string, depth: number): Promise<void> => {
      const abs = path.join(root, relDir);
      let entries: any[];
      try {
        entries = await fs.readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      if (entries.some((e: any) => e.isFile() && e.name === 'package.json')) {
        out.push(relDir);
      }
      if (depth <= 0) return;
      for (const e of entries) {
        if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) {
          await walk(path.join(relDir, e.name), depth - 1);
        }
      }
    };
    await walk('', 3);
    return out;
  }

  /** Like pathExists but uses lstat so an existing SYMLINK (even a dangling one)
   *  counts as present — we must not clobber/duplicate an existing node_modules. */
  private async lpathExists(p: string): Promise<boolean> {
    try {
      await fs.lstat(p);
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // remove — delete worktree + metadata. Idempotent.
  // ---------------------------------------------------------------------------
  async remove(sessionId: string): Promise<void> {
    // Serialise behind the per-project worktree lock (6bc2dc36) — a `worktree remove`
    // racing a sibling's add/prune is exactly the corruption this guards.
    return this.withWorktreeLock(() => this._removeInner(sessionId));
  }

  private async _removeInner(sessionId: string): Promise<void> {
    const rec = await this.readRecord(sessionId);
    if (!rec) return;
    const res = await this.runGit(
      this.opts.projectRoot,
      ['worktree', 'remove', '--force', rec.path],
      QUICK_TIMEOUT_MS,
    ).catch((err) => ({
      code: 1,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
    }));
    if (res.code !== 0) {
      const stderr = res.stderr.toLowerCase();
      const benign =
        stderr.includes('not a working tree') ||
        stderr.includes('is not a working tree') ||
        stderr.includes('no such file') ||
        stderr.includes('does not exist');
      if (!benign) {
        // Best-effort: try `fs.rm` of the dir so metadata stays consistent.
        await fs.rm(rec.path, { recursive: true, force: true }).catch(() => {});
      }
    }
    await this.deleteRecord(sessionId);
  }

  // ---------------------------------------------------------------------------
  // isDirty — `git status --porcelain` non-empty? false for non-git fallback.
  // ---------------------------------------------------------------------------
  async isDirty(sessionId: string): Promise<boolean> {
    const rec = await this.readRecord(sessionId);
    if (!rec) return false;
    if (!(await this.pathExists(rec.path))) return false;
    const res = await this.runGit(
      rec.path,
      ['status', '--porcelain'],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (res.code !== 0) return false;
    return res.stdout.trim().length > 0;
  }

  // ---------------------------------------------------------------------------
  // currentBranch — HEAD branch inside the worktree, or null if detached/none.
  // ---------------------------------------------------------------------------
  async currentBranch(sessionId: string): Promise<string | null> {
    const rec = await this.readRecord(sessionId);
    if (!rec) return null;
    if (!(await this.pathExists(rec.path))) return null;
    const res = await this.runGit(
      rec.path,
      ['symbolic-ref', '--short', 'HEAD'],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (res.code !== 0) return null;
    const branch = res.stdout.trim();
    return branch.length > 0 ? branch : null;
  }

  // ---------------------------------------------------------------------------
  // existingPath — the absolute worktree dir for a session if (and only if) it
  // already exists on disk; null otherwise. Read-only: never creates a worktree
  // (unlike ensure). Used by the completion gate to scope the change-set to this
  // lane's OWN worktree instead of the shared tree (todo b78fd3f6).
  // ---------------------------------------------------------------------------
  async existingPath(sessionId: string): Promise<string | null> {
    const rec = await this.readRecord(sessionId);
    if (!rec) return null;
    return (await this.pathExists(rec.path)) ? rec.path : null;
  }

  // ---------------------------------------------------------------------------
  // changeSet — files this lane's worktree touched: committed work (diff
  // baseRef..HEAD) UNION uncommitted edits (status --porcelain). Mirrors the
  // completion gate's lane-local change-set (gate-runner fetchLaneChangeSet) so
  // the WAVES tsc gate can scope a project-wide failure the same way, and the
  // executor can detect a no-op wimplement. Mid-leaf the edits are uncommitted
  // (HEAD still at the epic tip) so `status` carries them; the baseRef diff covers
  // any committed work. Returns null when no worktree exists or BOTH git reads
  // fail (→ caller fails closed / unscoped); an empty-but-readable result is a
  // real empty change-set, not an error.
  // ---------------------------------------------------------------------------
  async changeSet(sessionId: string, baseRef?: string): Promise<string[] | null> {
    const rec = await this.readRecord(sessionId);
    if (!rec || !(await this.pathExists(rec.path))) return null;
    const set = new Set<string>();
    let read = false;
    if (baseRef) {
      const d = await this.runGit(
        rec.path,
        ['diff', '--name-only', `${baseRef}..HEAD`],
        QUICK_TIMEOUT_MS,
      ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
      if (d.code === 0) {
        read = true;
        for (const line of d.stdout.split('\n')) {
          const p = line.trim();
          if (p) set.add(p);
        }
      }
    }
    const s = await this.runGit(
      rec.path,
      ['status', '--porcelain'],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (s.code === 0) {
      read = true;
      for (const line of s.stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Porcelain: "XY <path>" or rename "XY <old> -> <new>". Strip the 2-char
        // status + leading space; take the post-arrow path for renames.
        let p = line.slice(3).trim();
        const arrow = p.indexOf(' -> ');
        if (arrow !== -1) p = p.slice(arrow + 4).trim();
        // Strip surrounding quotes git adds for paths with special chars.
        if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
        if (p) set.add(p);
      }
    }
    return read ? [...set] : null;
  }

  // ---------------------------------------------------------------------------
  // list — enumerate all persisted worktree records.
  // ---------------------------------------------------------------------------
  async list(): Promise<WorktreeInfo[]> {
    const dir = this.recordsDir();
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch (err: any) {
      if (err?.code === 'ENOENT') return [];
      throw err;
    }
    const out: WorktreeInfo[] = [];
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(dir, name), 'utf8');
        const parsed = JSON.parse(raw) as WorktreeInfo;
        if (
          parsed &&
          typeof parsed.sessionId === 'string' &&
          typeof parsed.path === 'string' &&
          typeof parsed.branch === 'string'
        ) {
          out.push(parsed);
        }
      } catch {
        // skip malformed records
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // commitPushPR — add/commit/push/pr pipeline. Spawns with cwd=worktreePath.
  // ---------------------------------------------------------------------------
  async commitPushPR(sessionId: string, opts: CommitPushPROpts): Promise<PRResult> {
    const rec = await this.readRecord(sessionId);
    if (!rec) {
      throw new Error(`no worktree for session ${sessionId}`);
    }
    const timeoutMs = opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const onProgress = opts.onProgress;

    const dirtyRes = await this.runGit(
      rec.path,
      ['status', '--porcelain'],
      QUICK_TIMEOUT_MS,
      onProgress,
    );
    if (dirtyRes.code !== 0) {
      throw new Error(`git status failed: ${dirtyRes.stderr.trim()}`);
    }
    const dirtyBefore = dirtyRes.stdout.trim().length > 0;

    // Also check for unpushed commits: `git log @{u}..HEAD` — if no upstream,
    // treat the branch as entirely unpushed.
    const revListRes = await this.runGit(
      rec.path,
      ['rev-list', '--count', '@{u}..HEAD'],
      QUICK_TIMEOUT_MS,
      onProgress,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    const unpushedCommits = revListRes.code === 0
      ? parseInt(revListRes.stdout.trim() || '0', 10) || 0
      : Number.POSITIVE_INFINITY; // no upstream → assume unpushed

    if (!dirtyBefore && unpushedCommits === 0) {
      throw new Error('nothing to commit');
    }

    let commitSha: string | undefined;

    if (dirtyBefore) {
      const addRes = await this.runGit(
        rec.path,
        ['add', '-A'],
        timeoutMs,
        onProgress,
      );
      if (addRes.code !== 0) {
        throw new Error(`git add failed: ${addRes.stderr.trim()}`);
      }
      const message = opts.body ? `${opts.title}\n\n${opts.body}` : opts.title;
      const commitRes = await this.runGit(
        rec.path,
        ['commit', '-m', message],
        timeoutMs,
        onProgress,
      );
      if (commitRes.code !== 0) {
        throw new Error(`git commit failed: ${commitRes.stderr.trim() || commitRes.stdout.trim()}`);
      }
      const shaRes = await this.runGit(
        rec.path,
        ['rev-parse', 'HEAD'],
        QUICK_TIMEOUT_MS,
        onProgress,
      );
      if (shaRes.code === 0) commitSha = shaRes.stdout.trim() || undefined;
    }

    const pushRes = await this.runGit(
      rec.path,
      ['push', '-u', 'origin', rec.branch],
      timeoutMs,
      onProgress,
    );
    if (pushRes.code !== 0) {
      throw new Error(`git push failed: ${pushRes.stderr.trim() || pushRes.stdout.trim()}`);
    }

    let prUrl: string | undefined;
    if (await this.ghAvailable()) {
      const ghArgs = [
        'pr',
        'create',
        '--title',
        opts.title,
        '--body',
        opts.body ?? '',
        '--base',
        rec.baseBranch,
      ];
      if (opts.draft) ghArgs.push('--draft');
      const ghRes = await this.runCmd('gh', rec.path, ghArgs, timeoutMs, onProgress).catch(
        (err) => ({
          code: 1,
          stdout: '',
          stderr: err instanceof Error ? err.message : String(err),
        }),
      );
      if (ghRes.code === 0) {
        // gh prints the PR URL on stdout, usually the last non-empty line.
        const lines = ghRes.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
        const urlLine = [...lines].reverse().find((l) => /^https?:\/\//.test(l));
        if (urlLine) prUrl = urlLine;
      }
      // gh failure is swallowed: we keep the push success and return no prUrl.
    }

    return {
      branch: rec.branch,
      commitSha,
      prUrl,
      pushed: true,
      dirtyBefore,
    };
  }

  // ---------------------------------------------------------------------------
  // epicBranchName — the accumulation branch for an epic: collab/epic/<id8>.
  // Reuses the slug / first-8 id convention (Inbox-epic id 'inbox' → collab/epic/inbox).
  // ---------------------------------------------------------------------------
  epicBranchName(epicId: string): string {
    return `collab/epic/${this.epicId8(epicId)}`;
  }

  /** First-8 slug of an epic id — the branch/path token. Mirrors `slug()` then
   *  truncates to 8 (a UUID → its 8-char prefix; the sentinel 'inbox' → 'inbox'). */
  private epicId8(epicId: string): string {
    const cleaned = epicId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return (cleaned.length > 0 ? cleaned : 'epic').slice(0, 8);
  }

  // ---------------------------------------------------------------------------
  // epicBehindBase — staleness flag (FBPE P5). How many commits `baseRef` (master)
  // carries that the epic's accumulation branch does NOT, i.e. how far behind master
  // the epic base has drifted: `git rev-list --count <epicBranch>..<baseRef>`.
  // FLAG ONLY — we NEVER auto-rebase an epic branch (it carries --no-ff worker merge
  // history a rebase would mangle). Returns 0 when the branch is missing or current.
  // ---------------------------------------------------------------------------
  async epicBehindBase(epicId: string, baseRef: string = 'master'): Promise<number> {
    if (!(await this.isGitRepo())) return 0;
    const trunk = await this.resolveBase(baseRef); // main vs master — a `main` repo has no master
    const epicBranch = this.epicBranchName(epicId);
    const res = await this.runGit(
      this.opts.projectRoot,
      ['rev-list', '--count', `${epicBranch}..${trunk}`],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (res.code !== 0) return 0;
    return parseInt(res.stdout.trim() || '0', 10) || 0;
  }

  // ---------------------------------------------------------------------------
  // epicAheadOfMaster — the UNLANDED-WORK count: how many commits the epic's
  // accumulation branch carries that `baseRef` (master) does NOT, i.e. accepted,
  // gate-green work that has not yet been landed onto master:
  // `git rev-list --count <baseRef>..<epicBranch>`. The inverse of epicBehindBase.
  // Returns 0 when the branch is missing or fully landed. This is the durable
  // truth-vs-reported drift signal (design-epic-landing P1) — derived from git,
  // NOT from land-card existence, so an ORPHANED epic (commits ahead, no card)
  // still surfaces. Never throws.
  // ---------------------------------------------------------------------------
  async epicAheadOfMaster(epicId: string, baseRef: string = 'master'): Promise<number> {
    if (!(await this.isGitRepo())) return 0;
    const trunk = await this.resolveBase(baseRef); // main vs master — a `main` repo has no master
    const epicBranch = this.epicBranchName(epicId);
    const res = await this.runGit(
      this.opts.projectRoot,
      ['rev-list', '--count', `${trunk}..${epicBranch}`],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (res.code !== 0) return 0;
    return parseInt(res.stdout.trim() || '0', 10) || 0;
  }

  // ---------------------------------------------------------------------------
  // epicBuildBaseStaleness — pure-read staleness detector for epic build base.
  // Reports whether an epic's accumulation branch has drifted behind trunk:
  // counts trunk commits not yet integrated (`<epic>..<trunk>`) and detects
  // overlapping file changes since the fork point. No merge, no land, no mutation.
  // Mirrors the never-throw discipline of epicBehindBase / epicAheadOfMaster.
  // ---------------------------------------------------------------------------
  async epicBuildBaseStaleness(
    epicId: string,
    baseRef: string = 'master',
    opts: { maxAhead?: number } = {},
  ): Promise<StalenessResult> {
    const N = opts.maxAhead ?? (Number(process.env.MERMAID_LAND_STALE_MAX_AHEAD) || 20);
    const fresh: StalenessResult = {
      stale: false,
      commitsAhead: 0,
      maxAhead: N,
      trunkSha: '',
      epicSha: '',
      mergeBase: '',
      overlap: [],
      reason: 'fresh',
    };

    if (!(await this.isGitRepo())) return fresh;

    const trunk = await this.resolveBase(baseRef);
    const epicBranch = this.epicBranchName(epicId);

    // Epic branch existence: capture epicSha if present.
    const epicRev = await this.runGit(
      this.opts.projectRoot,
      ['rev-parse', '--verify', '--quiet', `refs/heads/${epicBranch}`],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (epicRev.code !== 0 || !epicRev.stdout.trim()) return fresh;
    const epicSha = epicRev.stdout.trim();

    // Trunk sha (best-effort).
    const trunkRev = await this.runGit(
      this.opts.projectRoot,
      ['rev-parse', '--verify', '--quiet', `refs/heads/${trunk}`],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (trunkRev.code !== 0 || !trunkRev.stdout.trim()) return fresh;
    const trunkSha = trunkRev.stdout.trim();

    // Merge base.
    const mb = await this.runGit(
      this.opts.projectRoot,
      ['merge-base', epicBranch, trunk],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (mb.code !== 0 || !mb.stdout.trim()) return fresh;
    const mergeBase = mb.stdout.trim();

    // Trunk commits not yet in epic: <epic>..<trunk>
    const aheadRes = await this.runGit(
      this.opts.projectRoot,
      ['rev-list', '--count', `${epicBranch}..${trunk}`],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    const commitsAhead = parseInt(aheadRes.stdout.trim() || '0', 10) || 0;

    // Changed files on each side since mergeBase.
    const trunkFilesRes = await this.runGit(
      this.opts.projectRoot,
      ['diff', '--name-only', `${mergeBase}..${trunk}`],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    const trunkChangedFiles = trunkFilesRes.stdout
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);

    const epicFilesRes = await this.runGit(
      this.opts.projectRoot,
      ['diff', '--name-only', `${mergeBase}..${epicBranch}`],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    const epicChangedFiles = epicFilesRes.stdout
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);

    const epicSet = new Set(epicChangedFiles);
    const overlap = trunkChangedFiles.filter((f) => epicSet.has(f));

    const overlapHit = overlap.length > 0;
    const aheadHit = commitsAhead > N;
    const stale = commitsAhead > 0 && (aheadHit || overlapHit);
    const reason: StalenessResult['reason'] =
      !stale ? 'fresh' : overlapHit ? 'file-overlap' : 'ahead-exceeds-max';

    return {
      stale,
      commitsAhead,
      maxAhead: N,
      trunkSha,
      epicSha,
      mergeBase,
      overlap,
      reason,
    };
  }

  /** Count the commits a LANE worktree's HEAD carries beyond its epic's
   *  accumulation branch: `git -C <worktree> rev-list --count <epicBranch>..HEAD`.
   *  Used by the completion re-verify (PAW P1) to corroborate a worker's
   *  'accepted' actually produced committed work — combined with isDirty() (which
   *  catches uncommitted edits not yet merged back), a clean tree with 0 ahead is
   *  a hallucinated completion. Returns 0 off a non-git repo, a missing worktree,
   *  or on error. Never throws. */
  async laneCommitsAheadOfEpic(sessionId: string, epicId: string): Promise<number> {
    if (!(await this.isGitRepo())) return 0;
    const wtPath = await this.existingPath(sessionId);
    if (!wtPath) return 0;
    const epicBranch = this.epicBranchName(epicId);
    const res = await this.runGit(
      wtPath,
      ['rev-list', '--count', `${epicBranch}..HEAD`],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (res.code !== 0) return 0;
    return parseInt(res.stdout.trim() || '0', 10) || 0;
  }

  /** Enumerate every `collab/epic/*` accumulation branch that is AHEAD of master
   *  (carries unlanded commits), with its commit count. Pure git read (no merge,
   *  no land) — the deterministic detector behind the Bridge's unlanded-epic
   *  readout (design-epic-landing P1). Returns [] off a non-git repo or on error. */
  async listUnlandedEpics(baseRef: string = 'master'): Promise<Array<{ branch: string; epicId8: string; ahead: number }>> {
    if (!(await this.isGitRepo())) return [];
    const trunk = await this.resolveBase(baseRef); // main vs master — a `main` repo has no master
    const list = await this.runGit(
      this.opts.projectRoot,
      ['branch', '--list', 'collab/epic/*', '--format=%(refname:short)'],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (list.code !== 0) return [];
    const branches = list.stdout.split('\n').map((b) => b.trim()).filter(Boolean);
    const out: Array<{ branch: string; epicId8: string; ahead: number }> = [];
    for (const branch of branches) {
      const res = await this.runGit(
        this.opts.projectRoot,
        ['rev-list', '--count', `${trunk}..${branch}`],
        QUICK_TIMEOUT_MS,
      ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
      if (res.code !== 0) continue;
      const ahead = parseInt(res.stdout.trim() || '0', 10) || 0;
      if (ahead > 0) out.push({ branch, epicId8: branch.replace(/^collab\/epic\//, ''), ahead });
    }
    return out;
  }

  /** Enumerate LINKED worktrees (excludes the main repo) that look abandoned:
   *  their branch ref is gone / git marks them prunable, or their HEAD commit is older
   *  than maxAgeMs. Pure git read — no prune, no removal. [] off non-git / on error. */
  async listStaleWorktrees(
    opts: { maxAgeMs?: number } = {},
  ): Promise<Array<{ path: string; branch: string | null; reason: 'branch-gone' | 'prunable' | 'stale'; ageMs: number }>> {
    if (!(await this.isGitRepo())) return [];
    const maxAgeMs = opts.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
    const list = await this.runGit(
      this.opts.projectRoot,
      ['worktree', 'list', '--porcelain'],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (list.code !== 0) return [];
    const out: Array<{ path: string; branch: string | null; reason: 'branch-gone' | 'prunable' | 'stale'; ageMs: number }> = [];
    // Porcelain: blank-line-separated blocks of `key value` lines.
    const blocks = list.stdout.split('\n\n');
    for (const block of blocks) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      let wtPath = '';
      let branch: string | null = null;
      let prunable = false;
      for (const ln of lines) {
        if (ln.startsWith('worktree ')) wtPath = ln.slice('worktree '.length);
        else if (ln.startsWith('branch ')) branch = ln.slice('branch '.length).replace(/^refs\/heads\//, '');
        else if (ln === 'prunable' || ln.startsWith('prunable ')) prunable = true;
      }
      if (!wtPath) continue;
      if (path.resolve(wtPath) === path.resolve(this.opts.projectRoot)) continue; // skip main worktree
      // branch-gone: a named branch that no longer resolves.
      let branchGone = false;
      if (branch) {
        const ok =
          (
            await this.runGit(
              this.opts.projectRoot,
              ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
              QUICK_TIMEOUT_MS,
            ).catch(() => ({ code: 1, stdout: '', stderr: '' }))
          ).code === 0;
        branchGone = !ok;
      }
      // age: HEAD commit time inside the worktree.
      let ageMs = 0;
      const ct = await this.runGit(
        wtPath,
        ['log', '-1', '--format=%ct'],
        QUICK_TIMEOUT_MS,
      ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
      if (ct.code === 0 && ct.stdout.trim()) ageMs = this.now() - parseInt(ct.stdout.trim(), 10) * 1000;
      const reason: 'branch-gone' | 'prunable' | 'stale' | null = branchGone
        ? 'branch-gone'
        : prunable
          ? 'prunable'
          : ageMs > maxAgeMs
            ? 'stale'
            : null;
      if (reason) out.push({ path: wtPath, branch, reason, ageMs });
    }
    return out;
  }

  /** Resolve a base ref to branch a NEW epic off: the requested ref when it
   *  exists, else the detected base branch. Lets a caller request a specific base
   *  (e.g. master) yet fall back to the detected default branch on a fresh repo. */
  private async resolveBase(baseRef: string): Promise<string> {
    const exists =
      (
        await this.runGit(
          this.opts.projectRoot,
          ['rev-parse', '--verify', '--quiet', `refs/heads/${baseRef}`],
          QUICK_TIMEOUT_MS,
        ).catch(() => ({ code: 1, stdout: '', stderr: '' }))
      ).code === 0;
    return exists ? baseRef : this.detectBaseBranch();
  }

  // ---------------------------------------------------------------------------
  // ensureEpic — create/resume an epic's accumulation branch + its dedicated
  // worktree (FBPE P1). The epic worktree is where
  // accepted worker branches are merged back; the branch is the accumulated result
  // of the epic's wave. Returns null for the non-git fallback.
  // ---------------------------------------------------------------------------
  async ensureEpic(
    epicId: string,
    _project?: string,
    baseRef: string = 'master',
  ): Promise<EpicWorktree | null> {
    // Serialise behind the per-project worktree lock (6bc2dc36). Internal callers that
    // already hold the lock (forwardIntegrateEpic, commitAndMergeToEpic) call
    // `_ensureEpicInner` directly to avoid self-deadlock.
    return this.withWorktreeLock(() => this._ensureEpicInner(epicId, _project, baseRef));
  }

  private async _ensureEpicInner(
    epicId: string,
    _project?: string,
    baseRef: string = 'master',
  ): Promise<EpicWorktree | null> {
    if (!(await this.isGitRepo())) return null;
    const branch = this.epicBranchName(epicId);
    const wtPath = path.join(this.opts.baseDir, `__epic-${this.epicId8(epicId)}__`);

    // Already materialised? A linked worktree has a `.git` file at its root.
    if (await this.pathExists(path.join(wtPath, '.git'))) {
      return { epicId, branch, path: wtPath };
    }

    await fs.mkdir(this.opts.baseDir, { recursive: true });

    const branchExists =
      (
        await this.runGit(
          this.opts.projectRoot,
          ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
          QUICK_TIMEOUT_MS,
        ).catch(() => ({ code: 1, stdout: '', stderr: '' }))
      ).code === 0;

    const addArgs = branchExists
      ? ['worktree', 'add', wtPath, branch]
      : ['worktree', 'add', '-b', branch, wtPath, await this.resolveBase(baseRef)];

    let result = await this.runGit(this.opts.projectRoot, addArgs, DEFAULT_STEP_TIMEOUT_MS);

    // Retry once. Two distinct failure modes:
    //  (a) a dir left dangling from a crashed run → prune + retry.
    //  (b) COLD-START RACE: on the first wave of a brand-NEW epic, N workers each saw
    //      "branch doesn't exist" and ran `add -b` concurrently — one wins, the rest
    //      fail with "branch already exists" (observed live on the Zen epic). Re-resolve:
    //      if a sibling already MATERIALISED the worktree, return it; if it created the
    //      BRANCH but not the worktree, attach the existing branch (no -b).
    if (result.code !== 0) {
      // (b) sibling already materialised the worktree → just use it.
      if (await this.pathExists(path.join(wtPath, '.git'))) {
        return { epicId, branch, path: wtPath };
      }
      await this.runGit(
        this.opts.projectRoot,
        ['worktree', 'remove', '--force', wtPath],
        QUICK_TIMEOUT_MS,
      ).catch(() => ({ code: 0, stdout: '', stderr: '' }));
      await this.runGit(this.opts.projectRoot, ['worktree', 'prune'], QUICK_TIMEOUT_MS).catch(
        () => ({ code: 0, stdout: '', stderr: '' }),
      );
      // Re-resolve branch existence (a sibling may have created it since our first check)
      // and pick the matching add form — attach an existing branch, never re-`-b` it.
      const branchNowExists =
        (
          await this.runGit(
            this.opts.projectRoot,
            ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
            QUICK_TIMEOUT_MS,
          ).catch(() => ({ code: 1, stdout: '', stderr: '' }))
        ).code === 0;
      const retryArgs = branchNowExists ? ['worktree', 'add', wtPath, branch] : addArgs;
      result = await this.runGit(this.opts.projectRoot, retryArgs, DEFAULT_STEP_TIMEOUT_MS);
      if (result.code !== 0) {
        // Final fallback: if the worktree exists now (a sibling won the retry race too), use it.
        if (await this.pathExists(path.join(wtPath, '.git'))) {
          return { epicId, branch, path: wtPath };
        }
        throw new Error(
          `git worktree add (epic ${this.epicId8(epicId)}) failed (code ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`,
        );
      }
    }

    return { epicId, branch, path: wtPath };
  }

  // ---------------------------------------------------------------------------
  // forwardIntegrateEpic — bring an epic accumulation branch UP TO DATE with trunk
  // BEFORE a lane forks its build worktree off the epic tip (todo 38d87ab3).
  //
  // WHY: claim-time reachability (71cebee3) admits a foundation reachable from the
  // epic branch tip OR trunk (the union). But the worker lane forks from the epic
  // branch tip ALONE. If the epic branch is behind trunk, a cross-epic foundation
  // that landed to trunk AFTER this epic branched passes the claim gate (via the
  // trunk arm) yet is ABSENT from the lane's actual base → a build-time miss. This
  // makes the build-time base agree with the claim-time union.
  //
  // We FORWARD-MERGE (git merge --no-ff trunk into the epic branch), never rebase —
  // the epic branch carries --no-ff worker-merge provenance a rebase would mangle
  // (same reason flagRebaseNeeded is FLAG-ONLY). Conflict-safe: a conflict aborts and
  // leaves the epic branch UNTOUCHED so the caller can escalate and fall back to the
  // current tip (no worse than today's behaviour); it NEVER corrupts the epic branch.
  // A dirty epic worktree is skipped (we never merge into uncommitted state).
  // ---------------------------------------------------------------------------
  async forwardIntegrateEpic(
    epicId: string,
    baseRef: string = 'master',
    opts?: { timeoutMs?: number; onProgress?: (channel: 'stdout' | 'stderr', chunk: string) => void },
  ): Promise<ForwardIntegrateResult> {
    // Serialise behind the per-project worktree lock (6bc2dc36) — two leaves on the same
    // epic merging trunk into the SHARED epic worktree concurrently was the original
    // corruption trigger.
    return this.withWorktreeLock(() => this._forwardIntegrateEpicInner(epicId, baseRef, opts));
  }

  private async _forwardIntegrateEpicInner(
    epicId: string,
    baseRef: string = 'master',
    opts?: { timeoutMs?: number; onProgress?: (channel: 'stdout' | 'stderr', chunk: string) => void },
  ): Promise<ForwardIntegrateResult> {
    if (!(await this.isGitRepo())) return { integrated: false, advanced: false, conflict: false, skippedReason: 'non-git' };
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const onProgress = opts?.onProgress;
    const epicBranch = this.epicBranchName(epicId);
    const trunk = await this.resolveBase(baseRef);

    // The epic worktree must exist (it is where the merge runs). _ensureEpicInner is
    // idempotent — a fresh epic branched off trunk is already up to date. (Inner: we
    // already hold the lock.)
    const epic = await this._ensureEpicInner(epicId, undefined, baseRef);
    if (!epic) return { integrated: false, advanced: false, conflict: false, skippedReason: 'non-git' };

    // Resolve trunk's tip. Missing trunk → nothing to integrate.
    const trunkShaRes = await this.runGit(
      this.opts.projectRoot,
      ['rev-parse', '--verify', '--quiet', `refs/heads/${trunk}`],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (trunkShaRes.code !== 0 || !trunkShaRes.stdout.trim()) {
      return { integrated: false, advanced: false, conflict: false, skippedReason: `trunk-missing:${trunk}` };
    }
    const trunkSha = trunkShaRes.stdout.trim();

    // Already up to date? trunk is an ancestor of the epic tip → no-op.
    const ancestor = await this.runGit(
      epic.path,
      ['merge-base', '--is-ancestor', trunkSha, epicBranch],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (ancestor.code === 0) return { integrated: true, advanced: false, conflict: false };

    // Never merge into a dirty epic worktree — skip and let the caller proceed on
    // the current tip rather than risk an unclean merge.
    const dirtyRes = await this.runGit(epic.path, ['status', '--porcelain'], QUICK_TIMEOUT_MS, onProgress)
      .catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (dirtyRes.code !== 0) return { integrated: false, advanced: false, conflict: false, skippedReason: 'epic-status-failed' };
    if (dirtyRes.stdout.trim() !== '') return { integrated: false, advanced: false, conflict: false, skippedReason: 'epic-worktree-dirty' };

    // Forward-merge trunk INTO the epic branch (--no-ff preserves provenance).
    const mergeMessage =
      `collab: forward-integrate ${trunk} into epic ${this.epicId8(epicId)}\n\n` +
      `Collab-Epic: ${epicId}\nCollab-Forward-Integrate: ${trunk}`;
    const mergeRes = await this.runGit(
      epic.path,
      ['merge', '--no-ff', '-m', mergeMessage, trunkSha],
      timeoutMs,
      onProgress,
    );
    if (mergeRes.code !== 0) {
      const conflictedRes = await this.runGit(
        epic.path,
        ['diff', '--name-only', '--diff-filter=U'],
        QUICK_TIMEOUT_MS,
      ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
      const conflictedPaths = conflictedRes.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      // Abort → epic branch untouched. Caller escalates + builds on the current tip.
      await this.runGit(epic.path, ['merge', '--abort'], QUICK_TIMEOUT_MS).catch(() => ({ code: 0, stdout: '', stderr: '' }));
      return { integrated: false, advanced: false, conflict: true, conflictedPaths };
    }
    return { integrated: true, advanced: true, conflict: false };
  }

  /** SHA at the tip of the epic accumulation branch — the base a leaf's blueprint is
   *  authored against. null if not a git repo or the branch doesn't exist yet. Used
   *  by the resume decision (leaf-phase-checkpoint-design) to detect a moved base so
   *  a stale blueprint is never reused. */
  async epicHeadSha(epicId: string): Promise<string | null> {
    try {
      if (!(await this.isGitRepo())) return null;
      const branch = this.epicBranchName(epicId);
      const r = await this.runGit(
        this.opts.projectRoot,
        ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
        QUICK_TIMEOUT_MS,
      ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
      const sha = r.stdout.trim();
      return r.code === 0 && sha ? sha : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // commitAndMergeToEpic — on `accepted`, commit the worker's worktree and merge
  // its branch into the epic's accumulation branch (FBPE P1). A merge conflict
  // leaves the epic branch UNTOUCHED
  // (aborted) and is reported so the caller can escalate — never corrupt the epic.
  // The --no-ff merge commit carries Collab-Epic (+ optional Collab-Todo) trailers.
  // ---------------------------------------------------------------------------
  async commitAndMergeToEpic(
    sessionId: string,
    epicId: string,
    opts: CommitMergeOpts,
  ): Promise<MergeBackResult> {
    // Serialise behind the per-project worktree lock (6bc2dc36) — merging a lane branch
    // into the SHARED epic worktree must not race a sibling's merge/add/prune.
    return this.withWorktreeLock(() => this._commitAndMergeToEpicInner(sessionId, epicId, opts));
  }

  private async _commitAndMergeToEpicInner(
    sessionId: string,
    epicId: string,
    opts: CommitMergeOpts,
  ): Promise<MergeBackResult> {
    const rec = await this.readRecord(sessionId);
    if (!rec) throw new Error(`no worktree for session ${sessionId}`);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const onProgress = opts.onProgress;

    const epic = await this._ensureEpicInner(epicId);
    if (!epic) throw new Error('cannot resolve epic worktree (non-git project)');

    // 1. Commit the worker's working tree (if dirty). Uncommitted work would
    //    otherwise not be visible to the merge.
    let committed = false;
    let commitSha: string | undefined;
    const dirty = await this.runGit(
      rec.path,
      ['status', '--porcelain'],
      QUICK_TIMEOUT_MS,
      onProgress,
    );
    if (dirty.code === 0 && dirty.stdout.trim().length > 0) {
      const addRes = await this.runGit(rec.path, ['add', '-A'], timeoutMs, onProgress);
      if (addRes.code !== 0) throw new Error(`git add failed: ${addRes.stderr.trim()}`);
      // Stamp the WORKER commit itself with a `Collab-Todo: <id>` trailer (not just
      // the epic merge commit). This is what makes per-todo integration verifiable
      // even when a single keep-warm lane carried several todos' commits: an earlier
      // todo's merge may have already pulled a later todo's worker commit onto the
      // epic branch ("Already up to date" on the later merge), so a HEAD-advance
      // check would FALSE-strand it. A reachable trailer on the todo's own commit
      // does not. (BP0 stranding fix.)
      const commitMessage = opts.todoId
        ? `${opts.message}\n\nCollab-Todo: ${opts.todoId}`
        : opts.message;
      const commitRes = await this.runGit(
        rec.path,
        ['commit', '-m', commitMessage],
        timeoutMs,
        onProgress,
      );
      if (commitRes.code !== 0) {
        throw new Error(
          `git commit failed: ${commitRes.stderr.trim() || commitRes.stdout.trim()}`,
        );
      }
      committed = true;
      const shaRes = await this.runGit(rec.path, ['rev-parse', 'HEAD'], QUICK_TIMEOUT_MS);
      if (shaRes.code === 0) commitSha = shaRes.stdout.trim() || undefined;
    }

    // 2. Merge the worker branch into the epic branch (in the epic worktree).
    //    --no-ff keeps each accepted todo a distinct merge commit; trailers tag
    //    the merge with its epic (+ todo) for traceability.
    const trailers = [`Collab-Epic: ${epicId}`];
    if (opts.todoId) trailers.push(`Collab-Todo: ${opts.todoId}`);
    const mergeMessage = `${opts.message}\n\n${trailers.join('\n')}`;
    const mergeRes = await this.runGit(
      epic.path,
      ['merge', '--no-ff', '-m', mergeMessage, rec.branch],
      timeoutMs,
      onProgress,
    );
    if (mergeRes.code !== 0) {
      // Conflict (or other failure) — abort so the epic branch stays clean.
      await this.runGit(epic.path, ['merge', '--abort'], QUICK_TIMEOUT_MS).catch(() => ({
        code: 0,
        stdout: '',
        stderr: '',
      }));
      return {
        committed,
        merged: false,
        conflict: true,
        commitSha,
        epicBranch: epic.branch,
        workerBranch: rec.branch,
        integrated: false,
      };
    }

    let mergeSha: string | undefined;
    const mergeShaRes = await this.runGit(epic.path, ['rev-parse', 'HEAD'], QUICK_TIMEOUT_MS);
    if (mergeShaRes.code === 0) mergeSha = mergeShaRes.stdout.trim() || undefined;

    // BP0 verification: confirm the todo's work actually reached the epic branch.
    // A merge that succeeds with code 0 can still integrate NOTHING (a clean
    // worktree + a branch with no commits ahead → "Already up to date", no merge
    // commit, no work) — the phantom-accept mode. When a todoId is supplied we
    // require its `Collab-Todo` trailer to be reachable from the epic branch; with
    // no todoId we keep the legacy contract (a clean merge counts as integrated).
    const integrated = opts.todoId
      ? await this.todoOnEpicBranch(epicId, opts.todoId)
      : true;

    return {
      committed,
      merged: true,
      conflict: false,
      commitSha,
      epicBranch: epic.branch,
      workerBranch: rec.branch,
      mergeSha,
      integrated,
    };
  }

  // ---------------------------------------------------------------------------
  // todoOnEpicBranch — BP0 integration probe. Is a commit carrying the
  // `Collab-Todo: <todoId>` trailer reachable from the epic's accumulation branch?
  // True ⇒ the todo's work landed on collab/epic/<id8> (its own worker commit
  // and/or its --no-ff merge commit both carry the trailer). False ⇒ the work is
  // STRANDED (never merged) or PHANTOM (no commit was ever made). Read-only; runs
  // in the shared project repo where every branch ref lives. Non-git → false.
  // ---------------------------------------------------------------------------
  async todoOnEpicBranch(epicId: string, todoId: string): Promise<boolean> {
    if (!(await this.isGitRepo())) return false;
    const epicBranch = this.epicBranchName(epicId);
    const res = await this.runGit(
      this.opts.projectRoot,
      ['log', '--format=%H', '-1', `--grep=Collab-Todo: ${todoId}`, `refs/heads/${epicBranch}`],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    return res.code === 0 && res.stdout.trim().length > 0;
  }

  // ---------------------------------------------------------------------------
  // resolveIntegrationRef — the project's INTEGRATION branch (the configured
  // default branch onto which epics land). Resolution order, most-authoritative
  // first:
  //   1. an explicit hint (caller-supplied, e.g. a configured baseRef),
  //   2. `origin/HEAD`'s symbolic target (the remote's default branch),
  //   3. a local `main`/`master` branch (in that order) if it exists,
  //   4. fall back to the literal 'master'.
  // Each candidate is verified to actually exist before being returned, so the
  // ancestor gate never compares against a phantom ref. Returns null only when
  // the repo is non-git (the caller's fail-safe trigger). Never throws.
  // ---------------------------------------------------------------------------
  async resolveIntegrationRef(hint?: string): Promise<string | null> {
    if (!(await this.isGitRepo())) return null;
    const exists = async (ref: string): Promise<boolean> => {
      const r = await this.runGit(
        this.opts.projectRoot,
        ['rev-parse', '--verify', '--quiet', ref],
        QUICK_TIMEOUT_MS,
      ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
      return r.code === 0 && r.stdout.trim().length > 0;
    };
    // 1. explicit hint (local branch ref).
    if (hint && hint.trim()) {
      const h = hint.trim();
      if (await exists(`refs/heads/${h}`)) return h;
      if (await exists(h)) return h;
    }
    // 2. LOCAL main / master — preferred over the remote default because this is a
    // local-first product and the daemon LANDS locally (landEpicToMaster operates on
    // the local branch). Resolving integration to a REMOTE ref (origin/HEAD) diverges
    // from where work is actually integrated: a leaf merged to local `main` but not
    // pushed reads as "not reachable from origin/main" → its accept loops (OI-1) and
    // its dependents silently strand (bp1). It also defends against a misconfigured
    // origin/HEAD pointing at a stale feature branch (observed on build123d:
    // origin/HEAD → phase3-selectors-live-rules while work lives on main). The
    // reachability check and the land must agree on the SAME local ref.
    for (const cand of ['main', 'master']) {
      if (await exists(`refs/heads/${cand}`)) return cand;
    }
    // 3. origin/HEAD symbolic target → e.g. "origin/main" (remote-integration setups
    // with no local default checked out).
    const sym = await this.runGit(
      this.opts.projectRoot,
      ['symbolic-ref', '--short', '--quiet', 'refs/remotes/origin/HEAD'],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (sym.code === 0 && sym.stdout.trim()) {
      const remoteRef = sym.stdout.trim(); // "origin/main"
      if (await exists(`refs/remotes/${remoteRef}`)) return remoteRef;
    }
    // 4. literal fallback (matches the rest of the codebase's default).
    return 'master';
  }

  // ---------------------------------------------------------------------------
  // commitOnIntegration — ACCEPT-TIME ANCESTOR GATE (OI-1). Is the todo's
  // change-set commit reachable from (an ancestor of) the integration ref? A
  // leaf may only be `accepted` if its work can actually ship — i.e. it is either
  //   (a) directly an ancestor of the integration ref, OR
  //   (b) on its epic's accumulation branch which is itself fully reachable from
  //       integration (the epic already landed).
  // We locate the todo's commit by its `Collab-Todo: <todoId>` trailer (the same
  // marker todoOnEpicBranch uses), searching the epic branch first then all refs,
  // and test `git merge-base --is-ancestor <commit> <integrationRef>`.
  // Returns:
  //   true   → reachable from integration (safe to accept),
  //   false  → NOT reachable (stranded — caller must NOT accept),
  //   null   → indeterminate (non-git, no integration ref, or no commit found):
  //            the caller's FAIL-SAFE — fall back to today's behaviour.
  // Read-only; never throws.
  // ---------------------------------------------------------------------------
  async commitOnIntegration(
    epicId: string,
    todoId: string,
    integrationRef?: string,
  ): Promise<boolean | null> {
    if (!(await this.isGitRepo())) return null;
    const intRef = integrationRef ?? (await this.resolveIntegrationRef());
    if (!intRef) return null;

    // Find the todo's commit via its trailer. Prefer the epic branch (the merge
    // commit carries the trailer), else fall back to a scan across all refs so a
    // commit reachable from integration but already pruned off its epic branch
    // still resolves.
    const epicBranch = this.epicBranchName(epicId);
    const findOn = async (ref: string): Promise<string | null> => {
      const res = await this.runGit(
        this.opts.projectRoot,
        ['log', '--format=%H', '-1', `--grep=Collab-Todo: ${todoId}`, ref],
        QUICK_TIMEOUT_MS,
      ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
      if (res.code === 0 && res.stdout.trim()) return res.stdout.trim();
      return null;
    };
    let commit = await findOn(`refs/heads/${epicBranch}`).catch(() => null);
    if (!commit) commit = await findOn('--all').catch(() => null);
    if (!commit) return null; // no commit carries the trailer → indeterminate.

    const anc = await this.runGit(
      this.opts.projectRoot,
      ['merge-base', '--is-ancestor', commit, intRef],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 2, stdout: '', stderr: '' }));
    // exit 0 → ancestor (reachable); exit 1 → not an ancestor; other → error.
    if (anc.code === 0) return true;
    if (anc.code === 1) return false;
    return null; // git error → indeterminate (fail-safe).
  }

  /** Uncommitted/untracked paths in the main checkout — the clean-tree guard for LAND.
   *  Empty array === clean. Read-only; never throws. */
  async dirtyPaths(): Promise<string[]> {
    if (!(await this.isGitRepo())) return [];
    const res = await this.runGit(this.opts.projectRoot, ['status', '--porcelain'], QUICK_TIMEOUT_MS)
      .catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (res.code !== 0) return [];
    return res.stdout.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // landEpicToMaster — the land click (FBPE P4). Merge an epic's accumulation
  // branch (collab/epic/<id8>) onto master with a single --no-ff merge, then
  // advance the master branch ref to the result. A conflict ABORTS the merge and
  // leaves master entirely untouched (ref never advanced) → { conflict: true }.
  //
  // The merge runs in a DETACHED master checkout (a throwaway `__land-master__`
  // worktree pinned at master's tip) so it never needs to check out the `master`
  // branch itself — that branch is typically live in the project's main working
  // tree, and `git worktree add <master>` would fail "already checked out". The
  // master branch ref is then advanced via a compare-and-swap `update-ref` on the
  // pre-land sha (the per-project land mutex serialises lands; the CAS is a second
  // backstop against a racing ref move). The land worktree is always torn down.
  // ---------------------------------------------------------------------------
  async landEpicToMaster(epicId: string, opts?: LandOpts): Promise<LandResult> {
    // Serialise behind the per-project worktree lock (6bc2dc36) — the land's throwaway
    // worktree add/remove + the global `worktree prune` in its finally must not race a
    // concurrent leaf's worktree ops. (No re-entrancy: this method calls runGit directly.)
    return this.withWorktreeLock(() => this._landEpicToMasterInner(epicId, opts));
  }

  private async _landEpicToMasterInner(epicId: string, opts?: LandOpts): Promise<LandResult> {
    if (!(await this.isGitRepo())) return { landed: false, conflict: false, reason: 'non-git' };
    // Resolve the real trunk (main vs master): a `main`-default repo (e.g. build123d) has no
    // `master`, so a literal default landed NOTHING (`base-ref-missing:master`) and epics
    // stranded ahead forever. resolveBase falls back to detectBaseBranch when the ref is absent.
    const baseRef = await this.resolveBase(opts?.baseRef ?? 'master');
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const onProgress = opts?.onProgress;
    const epicBranch = this.epicBranchName(epicId);

    // The epic branch must exist to land.
    const branchOk =
      (
        await this.runGit(
          this.opts.projectRoot,
          ['rev-parse', '--verify', '--quiet', `refs/heads/${epicBranch}`],
          QUICK_TIMEOUT_MS,
        ).catch(() => ({ code: 1, stdout: '', stderr: '' }))
      ).code === 0;
    if (!branchOk) return { landed: false, conflict: false, reason: `epic-branch-missing:${epicBranch}` };

    // Capture master's pre-land sha for the compare-and-swap ref advance.
    const baseShaRes = await this.runGit(
      this.opts.projectRoot,
      ['rev-parse', '--verify', `refs/heads/${baseRef}`],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (baseShaRes.code !== 0) return { landed: false, conflict: false, reason: `base-ref-missing:${baseRef}` };
    const oldBaseSha = baseShaRes.stdout.trim();

    const wtPath = path.join(this.opts.baseDir, '__land-master__');
    await fs.mkdir(this.opts.baseDir, { recursive: true });
    // Clear any stale land worktree from a crashed run before adding.
    await this.runGit(this.opts.projectRoot, ['worktree', 'remove', '--force', wtPath], QUICK_TIMEOUT_MS).catch(
      () => ({ code: 0, stdout: '', stderr: '' }),
    );
    await this.runGit(this.opts.projectRoot, ['worktree', 'prune'], QUICK_TIMEOUT_MS).catch(() => ({
      code: 0,
      stdout: '',
      stderr: '',
    }));

    const addRes = await this.runGit(
      this.opts.projectRoot,
      ['worktree', 'add', '--detach', wtPath, oldBaseSha],
      timeoutMs,
      onProgress,
    );
    if (addRes.code !== 0) {
      return {
        landed: false,
        conflict: false,
        reason: `land-worktree-add-failed: ${addRes.stderr.trim() || addRes.stdout.trim()}`,
      };
    }

    try {
      let mergeMessage =
        `collab: land epic ${this.epicId8(epicId)} → ${baseRef}\n\n` +
        `Collab-Epic: ${epicId}\nCollab-Land: ${epicBranch}`;
      if (opts?.allowDirtyPaths && opts.allowDirtyPaths.length > 0) {
        mergeMessage += `\nAllow-Dirty: ${opts.allowDirtyPaths.join(', ')}`;
      }
      const mergeRes = await this.runGit(
        wtPath,
        ['merge', '--no-ff', '-m', mergeMessage, epicBranch],
        timeoutMs,
        onProgress,
      );
      if (mergeRes.code !== 0) {
        // A conflict confined to (auto-generated) LOCKFILES is the most common land
        // blocker when an epic touched dependencies — and it's spurious: regenerating
        // resolves it. Auto-resolve by taking the EPIC side ('theirs' in this merge —
        // its deps are the intended new state) and completing the merge. Any NON-lockfile
        // conflict aborts untouched (master never advances).
        const conflictedRes = await this.runGit(
          wtPath,
          ['diff', '--name-only', '--diff-filter=U'],
          QUICK_TIMEOUT_MS,
        ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
        const conflicted = conflictedRes.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
        const isLockfile = (f: string) =>
          /(^|\/)(bun\.lock|bun\.lockb|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(f);
        const lockfileOnly = conflicted.length > 0 && conflicted.every(isLockfile);

        const abortAndFail = async (reason: string): Promise<LandResult> => {
          await this.runGit(wtPath, ['merge', '--abort'], QUICK_TIMEOUT_MS).catch(() => ({ code: 0, stdout: '', stderr: '' }));
          return { landed: false, conflict: true, reason };
        };

        if (!lockfileOnly) return await abortAndFail('epic-merge-conflict');

        onProgress?.('stdout', `land: auto-resolving lockfile-only conflict (epic side): ${conflicted.join(', ')}\n`);
        for (const f of conflicted) {
          const co = await this.runGit(wtPath, ['checkout', '--theirs', '--', f], QUICK_TIMEOUT_MS)
            .catch(() => ({ code: 1, stdout: '', stderr: '' }));
          const add = await this.runGit(wtPath, ['add', '--', f], QUICK_TIMEOUT_MS)
            .catch(() => ({ code: 1, stdout: '', stderr: '' }));
          if (co.code !== 0 || add.code !== 0) return await abortAndFail('epic-merge-conflict:lockfile-resolve-failed');
        }
        // Complete the in-progress merge with the resolved lockfiles.
        const commitRes = await this.runGit(wtPath, ['commit', '--no-edit'], timeoutMs, onProgress)
          .catch(() => ({ code: 1, stdout: '', stderr: '' }));
        if (commitRes.code !== 0) return await abortAndFail('epic-merge-conflict:lockfile-commit-failed');
        // Fall through to the sha + ref-advance below — the merge is now complete.
      }

      const shaRes = await this.runGit(wtPath, ['rev-parse', 'HEAD'], QUICK_TIMEOUT_MS);
      const masterSha = shaRes.code === 0 ? shaRes.stdout.trim() : '';
      if (!masterSha) return { landed: false, conflict: false, reason: 'merge-sha-unresolved' };

      // Advance master to the merge result — CAS on the pre-land sha. `update-ref`
      // works whether or not `master` is checked out elsewhere.
      const updateRes = await this.runGit(
        this.opts.projectRoot,
        ['update-ref', `refs/heads/${baseRef}`, masterSha, oldBaseSha],
        QUICK_TIMEOUT_MS,
      );
      if (updateRes.code !== 0) {
        return { landed: false, conflict: false, reason: `base-ref-cas-failed: ${updateRes.stderr.trim()}` };
      }
      return { landed: true, conflict: false, masterSha };
    } finally {
      // Always tear down the throwaway detached land worktree.
      await this.runGit(this.opts.projectRoot, ['worktree', 'remove', '--force', wtPath], QUICK_TIMEOUT_MS).catch(
        () => ({ code: 0, stdout: '', stderr: '' }),
      );
      await this.runGit(this.opts.projectRoot, ['worktree', 'prune'], QUICK_TIMEOUT_MS).catch(() => ({
        code: 0,
        stdout: '',
        stderr: '',
      }));
    }
  }

  // ---------------------------------------------------------------------------
  // removeEpic — tear down an epic's accumulation worktree + branch after a
  // successful land (FBPE P4). Idempotent + best-effort: a missing worktree or
  // branch is fine. Gated by the caller on land success — never call this on a
  // conflict (the branch must survive for the human to rebase + re-land).
  // ---------------------------------------------------------------------------
  async removeEpic(epicId: string, _project?: string): Promise<void> {
    return this.withWorktreeLock(() => this._removeEpicInner(epicId));
  }

  private async _removeEpicInner(epicId: string): Promise<void> {
    if (!(await this.isGitRepo())) return;
    const branch = this.epicBranchName(epicId);
    const wtPath = path.join(this.opts.baseDir, `__epic-${this.epicId8(epicId)}__`);
    await this.runGit(this.opts.projectRoot, ['worktree', 'remove', '--force', wtPath], QUICK_TIMEOUT_MS).catch(
      () => ({ code: 0, stdout: '', stderr: '' }),
    );
    await this.runGit(this.opts.projectRoot, ['worktree', 'prune'], QUICK_TIMEOUT_MS).catch(() => ({
      code: 0,
      stdout: '',
      stderr: '',
    }));
    // The epic branch is now merged into master — delete it unconditionally (-D);
    // a missing branch is swallowed so the call stays idempotent.
    await this.runGit(this.opts.projectRoot, ['branch', '-D', branch], QUICK_TIMEOUT_MS).catch(() => ({
      code: 0,
      stdout: '',
      stderr: '',
    }));
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private recordsDir(): string {
    return path.join(this.opts.persistDir, 'worktrees');
  }

  private recordPath(sessionId: string): string {
    return path.join(this.recordsDir(), `${this.slug(sessionId)}.json`);
  }

  private async readRecord(sessionId: string): Promise<WorktreeInfo | null> {
    try {
      const raw = await fs.readFile(this.recordPath(sessionId), 'utf8');
      return JSON.parse(raw) as WorktreeInfo;
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null;
      return null;
    }
  }

  private async writeRecord(info: WorktreeInfo): Promise<void> {
    await fs.mkdir(this.recordsDir(), { recursive: true });
    await fs.writeFile(this.recordPath(info.sessionId), JSON.stringify(info, null, 2), 'utf8');
  }

  private async deleteRecord(sessionId: string): Promise<void> {
    try {
      await fs.unlink(this.recordPath(sessionId));
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        // ignore — record is gone either way
      }
    }
  }

  /** Public is-this-a-git-repo probe — callers (e.g. the BP0 stranded-accept
   *  sweep) must skip non-git projects rather than mistake "no branch" for
   *  "stranded work". */
  async isGitRepoPublic(): Promise<boolean> {
    return this.isGitRepo();
  }

  private async isGitRepo(): Promise<boolean> {
    const res = await this.runGit(
      this.opts.projectRoot,
      ['rev-parse', '--git-dir'],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    return res.code === 0;
  }

  private async ghAvailable(): Promise<boolean> {
    const which = await this.runCmd('gh', this.opts.projectRoot, ['--version'], QUICK_TIMEOUT_MS).catch(
      () => ({ code: 1, stdout: '', stderr: '' }),
    );
    if (which.code !== 0) return false;
    const auth = await this.runCmd(
      'gh',
      this.opts.projectRoot,
      ['auth', 'status'],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    return auth.code === 0;
  }

  private async detectBaseBranch(): Promise<string> {
    const sym = await this.runGit(
      this.opts.projectRoot,
      ['symbolic-ref', '--short', 'HEAD'],
      QUICK_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (sym.code === 0 && sym.stdout.trim()) return sym.stdout.trim();
    const rev = await this.runGit(
      this.opts.projectRoot,
      ['rev-parse', 'HEAD'],
      QUICK_TIMEOUT_MS,
    );
    if (rev.code !== 0) {
      throw new Error(`cannot determine base branch: ${rev.stderr.trim()}`);
    }
    return rev.stdout.trim();
  }

  private slug(sessionId: string): string {
    const cleaned = sessionId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return cleaned.length > 0 ? cleaned.slice(0, 48) : 'session';
  }

  private timestamp(): string {
    const d = new Date(this.now());
    const pad = (n: number) => n.toString().padStart(2, '0');
    return (
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
      `-${pad(d.getHours())}${pad(d.getMinutes())}`
    );
  }

  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  private runGit(
    cwd: string,
    args: string[],
    timeoutMs?: number,
    onProgress?: CommitPushPROpts['onProgress'],
  ): Promise<SpawnResult> {
    return this.runCmd('git', cwd, ['-C', cwd, ...args], timeoutMs, onProgress);
  }

  private async runCmd(
    bin: string,
    cwd: string,
    args: string[],
    timeoutMs?: number,
    onProgress?: CommitPushPROpts['onProgress'],
  ): Promise<SpawnResult> {
    const effectiveTimeout = timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    let proc: any;
    try {
      proc = this.spawnFn([bin, ...args], {
        cwd,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
      });
    } catch (err) {
      return {
        code: 127,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
      };
    }

    let killed = false;
    const killTimer = setTimeout(() => {
      killed = true;
      try {
        proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      const hardKill = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 2000);
      (hardKill as any).unref?.();
    }, effectiveTimeout);
    (killTimer as any).unref?.();

    const stdoutP = readStream(proc.stdout, (chunk) => onProgress?.('stdout', chunk));
    const stderrP = readStream(proc.stderr, (chunk) => onProgress?.('stderr', chunk));

    const exitPromise: Promise<number | null> =
      proc.exited ?? new Promise((resolve) => proc.on?.('exit', (c: number | null) => resolve(c)));

    const code = (await exitPromise) ?? 0;
    clearTimeout(killTimer);
    const [stdout, stderr] = await Promise.all([stdoutP, stderrP]);

    return {
      code: killed ? 124 : code,
      stdout,
      stderr,
      timedOut: killed || undefined,
    };
  }
}

async function readStream(
  stream: ReadableStream<Uint8Array> | undefined | null,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  if (!stream) return '';
  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let acc = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      acc += chunk;
      if (onChunk && chunk) onChunk(chunk);
    }
  } catch {
    /* swallow — process likely exited */
  }
  return acc;
}
