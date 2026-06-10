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

export interface EnsureOpts {
  /** Branch the new worktree off this ref instead of the detected base branch.
   *  Used by the isolation model to branch each worker off the LATEST integration
   *  branch so it sees all prior accepted work. */
  baseBranch?: string;
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

  constructor(private readonly opts: WorktreeManagerOpts) {
    this.spawnFn =
      opts.spawn ?? ((cmd: string[], so: any) => (globalThis as any).Bun.spawn(cmd, so));
    this.now = opts.now ?? Date.now;
  }

  // ---------------------------------------------------------------------------
  // ensure — create or resume a worktree for the session; non-git fallback.
  // ---------------------------------------------------------------------------
  async ensure(sessionId: string, opts?: EnsureOpts): Promise<SessionWorktree> {
    const pending = this.pendingEnsures.get(sessionId);
    if (pending) return pending;
    const p = this._ensureInner(sessionId, opts).finally(() =>
      this.pendingEnsures.delete(sessionId),
    );
    this.pendingEnsures.set(sessionId, p);
    return p;
  }

  private async _ensureInner(sessionId: string, opts?: EnsureOpts): Promise<SessionWorktree> {
    // 1. cached record? verify the dir still exists.
    const cached = await this.readRecord(sessionId);
    if (cached) {
      if (await this.pathExists(cached.path)) {
        return cached;
      }
      // stale record — drop and fall through to re-create.
      await this.deleteRecord(sessionId).catch(() => {});
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

    // Path collision: if a dir already exists at the preferred path, suffix.
    if (await this.pathExists(wtPath)) {
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
    const epicBranch = this.epicBranchName(epicId);
    const res = await this.runGit(
      this.opts.projectRoot,
      ['rev-list', '--count', `${epicBranch}..${baseRef}`],
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
    const epicBranch = this.epicBranchName(epicId);
    const res = await this.runGit(
      this.opts.projectRoot,
      ['rev-list', '--count', `${baseRef}..${epicBranch}`],
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
        ['rev-list', '--count', `${baseRef}..${branch}`],
        QUICK_TIMEOUT_MS,
      ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
      if (res.code !== 0) continue;
      const ahead = parseInt(res.stdout.trim() || '0', 10) || 0;
      if (ahead > 0) out.push({ branch, epicId8: branch.replace(/^collab\/epic\//, ''), ahead });
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

    // The dir may be left dangling from a crashed run — prune + retry once.
    if (result.code !== 0) {
      await this.runGit(
        this.opts.projectRoot,
        ['worktree', 'remove', '--force', wtPath],
        QUICK_TIMEOUT_MS,
      ).catch(() => ({ code: 0, stdout: '', stderr: '' }));
      await this.runGit(this.opts.projectRoot, ['worktree', 'prune'], QUICK_TIMEOUT_MS).catch(
        () => ({ code: 0, stdout: '', stderr: '' }),
      );
      result = await this.runGit(this.opts.projectRoot, addArgs, DEFAULT_STEP_TIMEOUT_MS);
      if (result.code !== 0) {
        throw new Error(
          `git worktree add (epic ${this.epicId8(epicId)}) failed (code ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`,
        );
      }
    }

    return { epicId, branch, path: wtPath };
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
    const rec = await this.readRecord(sessionId);
    if (!rec) throw new Error(`no worktree for session ${sessionId}`);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const onProgress = opts.onProgress;

    const epic = await this.ensureEpic(epicId);
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
      const commitRes = await this.runGit(
        rec.path,
        ['commit', '-m', opts.message],
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
      };
    }

    let mergeSha: string | undefined;
    const mergeShaRes = await this.runGit(epic.path, ['rev-parse', 'HEAD'], QUICK_TIMEOUT_MS);
    if (mergeShaRes.code === 0) mergeSha = mergeShaRes.stdout.trim() || undefined;

    return {
      committed,
      merged: true,
      conflict: false,
      commitSha,
      epicBranch: epic.branch,
      workerBranch: rec.branch,
      mergeSha,
    };
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
    if (!(await this.isGitRepo())) return { landed: false, conflict: false, reason: 'non-git' };
    const baseRef = opts?.baseRef ?? 'master';
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
      const mergeMessage =
        `collab: land epic ${this.epicId8(epicId)} → ${baseRef}\n\n` +
        `Collab-Epic: ${epicId}\nCollab-Land: ${epicBranch}`;
      const mergeRes = await this.runGit(
        wtPath,
        ['merge', '--no-ff', '-m', mergeMessage, epicBranch],
        timeoutMs,
        onProgress,
      );
      if (mergeRes.code !== 0) {
        // Conflict — abort so the checkout is pristine; the master ref is NEVER
        // advanced below, so master stays exactly where it was.
        await this.runGit(wtPath, ['merge', '--abort'], QUICK_TIMEOUT_MS).catch(() => ({
          code: 0,
          stdout: '',
          stderr: '',
        }));
        return { landed: false, conflict: true, reason: 'epic-merge-conflict' };
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
