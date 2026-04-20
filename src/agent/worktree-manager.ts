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
  async ensure(sessionId: string): Promise<SessionWorktree> {
    const pending = this.pendingEnsures.get(sessionId);
    if (pending) return pending;
    const p = this._ensureInner(sessionId).finally(() =>
      this.pendingEnsures.delete(sessionId),
    );
    this.pendingEnsures.set(sessionId, p);
    return p;
  }

  private async _ensureInner(sessionId: string): Promise<SessionWorktree> {
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

    // 3. discover baseBranch.
    const baseBranch = await this.detectBaseBranch();

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
