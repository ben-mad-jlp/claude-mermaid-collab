import { stat, readdir, realpath as fsRealpath } from 'node:fs/promises';
import * as path from 'node:path';
import { getWorktreeManager } from './coordinator-live.js';
import { listLeafInflight, isLeafInflightLive } from './worker-ledger.js';
import { isRunLive } from './leaf-subprocess-registry.js';
import { getTodo, listTodos } from './todo-store.js';
import { recordSupervisorAudit } from './supervisor-store.js';
import { recordFrictionOnce } from './friction-store.js';
import { getEpicLandRecord } from './epic-land-record-store.js';
import { getStatuses } from './session-status-store.js';
import { CRASH_MS } from './session-runtime.js';

const LEAF_EXEC_PREFIX = 'leaf-exec-';
const REAP_THROTTLE_MS = 5 * 60_000;
/** GC pass throttle — the directory-vs-registration sweep (readdir + git worktree list +
 *  per-dir git status) is heavier than the record-driven reaper above, so it runs on its
 *  own, coarser cadence. This synchronous-ish fs+git scan runs per project and must NOT
 *  fire on the ~30s coordinator tick (it stalls the event loop / HTTP endpoint) — the
 *  30-min gate here is what keeps it off that cadence. Exported + clock-injectable
 *  (see `tickGcLeafWorktrees(opts.now)`) so the throttle is deterministically testable. */
export const WORKTREE_GC_INTERVAL_MS = 30 * 60_000;
/** Grace window: a leaf BETWEEN nodes or in its MERGE/FINALIZE phase has NO leaf_inflight
 *  row (rows are per-node, deleted on node-finish) yet is still live — and the
 *  leaf-executor's own self-merge runs in THIS window. Reaping then yanks the worktree out
 *  from under the merge → the observed "merge-to-epic-failed: no worktree" on a leaf-exec
 *  session. The inflight set alone is a TOCTOU; require the worktree to have been QUIET for
 *  the grace window (its tree is actively written during build + merge) before reaping. */
const REAP_GRACE_MS = 5 * 60_000;
const ORPHAN_WORKTREE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Reclamation floor for isReclaimable's age guard — deliberately DAYS, well past the
 *  5-min merge grace (REAP_GRACE_MS) and past ORPHAN_WORKTREE_MAX_AGE_MS's own 7d, since
 *  isReclaimable is a stricter, standalone safety gate (locked constraint d7f5eb20:
 *  default KEEP, unknown=keep). */
export const WORKTREE_RECLAIM_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
/** A recorded pool-lane session with no heartbeat for this long is DEAD — 2x the
 *  crash-detection threshold (session-runtime.ts CRASH_MS), so a momentary missed
 *  heartbeat can never misread as dead (locked constraint d5b7c9e2: liveness alone
 *  is never sufficient — this is the "≥2× heartbeat" floor). */
export const POOL_LANE_DEAD_MS = 2 * CRASH_MS;

const lastReapMs = new Map<string, number>();

/** Pure reap decision for one leaf-exec worktree. Reap ONLY when the todo is terminal AND
 *  not running a node AND its tree has been QUIET past the grace window. Conservative by
 *  design — every guard can only PREVENT a reap, never force one (a lingering orphan is
 *  cheap; reaping a live leaf's worktree mid-merge is the bug we're closing). */
export function isReapable(opts: {
  isTerminal: boolean;
  inflight: boolean;
  mtimeMs: number | null;
  now: number;
  graceMs?: number;
}): boolean {
  if (!opts.isTerminal) return false;
  if (opts.inflight) return false;
  if (opts.mtimeMs != null && opts.now - opts.mtimeMs < (opts.graceMs ?? REAP_GRACE_MS)) return false;
  return true;
}

/**
 * Safety-net reaper for orphaned leaf-exec worktrees (epoch-death case).
 *
 * Called inside the coordinator's reapOrphanedLeaves tick callback. Throttled to once
 * per REAP_THROTTLE_MS per project so filesystem + git ops don't run every 30 s.
 *
 * Scope: only handles tracking-project === targetProject. Cross-project worktrees
 * (build123d / other repos) are deferred.
 */
export async function reapOrphanedLeafWorktrees(project: string): Promise<number> {
  const now = Date.now();
  if ((now - (lastReapMs.get(project) ?? 0)) < REAP_THROTTLE_MS) return 0;
  lastReapMs.set(project, now);

  const wm = getWorktreeManager(project);
  let records;
  try {
    records = await wm.list();
  } catch {
    return 0;
  }

  const leafRecords = records.filter((r) => r.sessionId.startsWith(LEAF_EXEC_PREFIX));
  if (leafRecords.length === 0) return 0;

  // Build the live-inflight set once (all projects share the same DB).
  const inflight = new Set(listLeafInflight().map((r) => r.leafId));

  let reaped = 0;
  for (const rec of leafRecords) {
    // Session key is 'leaf-exec-<id8>' or 'leaf-exec-<id8>-<suffix>' on collision.
    // id8 is always the first 8 hex chars after the prefix.
    const id8 = rec.sessionId.slice(LEAF_EXEC_PREFIX.length, LEAF_EXEC_PREFIX.length + 8);
    if (id8.length < 8) continue;

    const todo = getTodo(project, id8);
    if (!todo) continue; // can't verify terminal status — skip (conservative)

    const isTerminal = todo.status === 'done' || todo.status === 'dropped';
    // mtime tracks the LAST write to the worktree tree (build edits + git merge ops). A
    // missing path → null (let wm.remove no-op below if it races).
    let mtimeMs: number | null = null;
    try { mtimeMs = (await stat(rec.path)).mtimeMs; } catch { mtimeMs = null; }

    if (!isReapable({ isTerminal, inflight: inflight.has(todo.id), mtimeMs, now })) continue;

    try {
      await wm.remove(rec.sessionId);
      reaped++;
      console.log(
        `[worktree-reaper] reaped orphaned worktree ${rec.sessionId} (${rec.path}), ` +
        `todo=${todo.id.slice(0, 8)} status=${todo.status}`,
      );
    } catch {
      // best-effort; wm.remove already handles "not a working tree" gracefully
    }
  }

  return reaped;
}

const lastGcMs = new Map<string, number>();

export interface GcReport {
  removed: string[];            // worktree paths deleted
  refused: Array<{ path: string; reason: string; sample: string[] }>;
  quarantined: Array<{ path: string; trashDir: string }>;
  prunedRegistrations: number;  // reserved for a future direct prune count (always 0 today —
                                 // `removePath` itself prunes as part of each removal)
  scanned: number;
}

const GC_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'out']);

/** Bounded walk (depth ≤ 3, skipping build/vcs noise) returning FILE paths relative to
 *  `root`. Mirrors the shape of WorktreeManager's private findPackageJsonDirs — this is
 *  its file-listing sibling, used ONLY to answer "does this dangling checkout carry any
 *  file the main checkout doesn't have at the same path" (the uncommitted-work guard). */
async function listFilesBounded(root: string, relDir = '', depth = 3): Promise<string[]> {
  const abs = path.join(root, relDir);
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const relPath = path.join(relDir, e.name);
    if (e.isDirectory()) {
      if (GC_SKIP_DIRS.has(e.name) || depth <= 0) continue;
      out.push(...(await listFilesBounded(root, relPath, depth - 1)));
    } else if (e.isFile()) {
      out.push(relPath);
    }
  }
  return out;
}

/** Resolve a leaf-exec dir's 8-char id prefix to its todo. `getTodo` is an EXACT-id
 *  lookup, so try it first (cheap, covers a full-id caller), then fall back to a
 *  startsWith scan over listTodos (short-id convention: leaf/epic short ids are the
 *  LEADING 8 hex of the full id everywhere). Needed because the leaf-exec-* dir name
 *  only ever carries the 8-char prefix, never the full todo id. */
function findLeafTodoByShortId(project: string, id8: string) {
  const direct = getTodo(project, id8);
  if (direct) return direct;
  return listTodos(project, { includeCompleted: true }).find((t) => t.id.startsWith(id8)) ?? null;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Minimal read-only git runner for the GC pass — never mutates, so it does NOT go
 *  through WorktreeManager's mutation lock. stderr is discarded; a non-zero exit yields
 *  an empty stdout. */
async function gcGitRead(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
      cwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const [stdout, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    return { code: code ?? 0, stdout };
  } catch {
    return { code: 1, stdout: '' };
  }
}

/** Parse `git worktree list --porcelain` into per-worktree metadata keyed by the dir's
 *  BASENAME (git prints OS-resolved paths — e.g. /private/tmp on macOS — so a basename key
 *  is the only reliable join back to a dir under baseDir; basenames are unique there). */
async function listRegisteredWorktreeMeta(
  projectRoot: string,
): Promise<Map<string, { branch: string | null; locked: boolean }>> {
  const out = new Map<string, { branch: string | null; locked: boolean }>();
  const res = await gcGitRead(projectRoot, ['worktree', 'list', '--porcelain']);
  if (res.code !== 0) return out;
  for (const block of res.stdout.split('\n\n')) {
    let base = '';
    let branch: string | null = null;
    let locked = false;
    for (const raw of block.split('\n')) {
      const ln = raw.trim();
      if (ln.startsWith('worktree ')) base = path.basename(ln.slice('worktree '.length));
      else if (ln.startsWith('branch ')) branch = ln.slice('branch '.length).replace(/^refs\/heads\//, '');
      else if (ln === 'locked' || ln.startsWith('locked ')) locked = true;
    }
    if (base) out.set(base, { branch, locked });
  }
  return out;
}

/** Age in ms of a worktree's HEAD commit (now − committer time). null when git can't read
 *  it (dangling / no commits) — caller treats null as "unknown" ⇒ flag, never remove. */
async function headCommitAgeMs(dir: string, now: number): Promise<number | null> {
  const res = await gcGitRead(dir, ['log', '-1', '--format=%ct']);
  if (res.code !== 0 || !res.stdout.trim()) return null;
  const ct = parseInt(res.stdout.trim(), 10);
  if (!Number.isFinite(ct)) return null;
  return now - ct * 1000;
}

/** `__epic-<id8>__` → id8, else null. */
function epicWorktreeId8(name: string): string | null {
  const m = /^__epic-(.+)__$/.exec(name);
  return m ? m[1] : null;
}

/** Resolve trunk's base ref for the `merge-base --is-ancestor` check: `master` if the
 *  branch exists in `projectRoot`, else `main` (mirrors WorktreeManager's private
 *  resolveBase/detectBaseBranch fallback — not reachable from here, so duplicated as a
 *  small local helper rather than assuming `master` always exists). */
async function resolveTrunkRef(projectRoot: string): Promise<string> {
  const res = await gcGitRead(projectRoot, ['rev-parse', '--verify', '--quiet', 'refs/heads/master']);
  return res.code === 0 && res.stdout.trim() ? 'master' : 'main';
}

/** Best-effort: is any live process's cwd (or an open fd) under `dir`? Shells out to
 *  `lsof +D <dir>` — bounded to the dir subtree, avoids a full-system scan. ANY error
 *  (lsof missing, spawn failure, non-zero exit with no parseable output) is UNKNOWN →
 *  returns true (treat as "has a live cwd", i.e. NOT reclaimable) — locked constraint
 *  d7f5eb20 requires unknown=keep, so this helper is deliberately fail-closed in the
 *  unsafe direction (true = block reclamation). */
async function hasLiveProcessUnder(dir: string): Promise<boolean> {
  try {
    const proc = (globalThis as any).Bun.spawn(['lsof', '+D', dir], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const [stdout] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    // `+D` recurses the whole subtree, so a permission-denied entry ELSEWHERE under dir
    // can make lsof exit non-zero even when it DID find and print a live match — the
    // exit code alone is not trustworthy. Key off stdout content instead: any printed
    // line (beyond the header) means a live process was found under dir.
    return stdout.trim().length > 0;
  } catch {
    return true;
  }
}

/** True if `dir`'s .git carries any in-progress operation marker (rebase, merge,
 *  cherry-pick, revert, bisect) or a worktree-local stash. Any of these mean the
 *  checkout is mid-operation and must never be reclaimed. Uses `gcGitRead` for the
 *  stash check (read-only, no lock) and direct fs.stat/readdir for the marker files —
 *  a worktree's `.git` is itself a FILE pointing at `gitdir: <real path>` for a linked
 *  worktree, so this resolves that indirection via `git rev-parse --git-dir`. */
async function hasInProgressGitState(dir: string): Promise<boolean> {
  const gitDirRes = await gcGitRead(dir, ['rev-parse', '--git-dir']);
  if (gitDirRes.code !== 0 || !gitDirRes.stdout.trim()) return true; // unknown → fail closed
  const gitDir = path.isAbsolute(gitDirRes.stdout.trim())
    ? gitDirRes.stdout.trim()
    : path.join(dir, gitDirRes.stdout.trim());

  const markers = [
    'rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD',
    'REVERT_HEAD', 'BISECT_LOG', 'sequencer',
  ];
  for (const m of markers) {
    if (await pathExists(path.join(gitDir, m))) return true;
  }

  const stashRes = await gcGitRead(dir, ['stash', 'list']);
  if (stashRes.code !== 0) return true; // unknown → fail closed
  if (stashRes.stdout.trim().length > 0) return true;

  return false;
}

export interface ReclaimabilityInput {
  /** Absolute, POSSIBLY-symlinked worktree dir path as read from the directory scan. */
  dir: string;
  /** Absolute baseDir worktrees live under (for realpath-resolved identity check). */
  baseDir: string;
  /** Leaf todo id this worktree belongs to, if resolvable (null → unknown-owner, still
   *  gated by the other checks; caller decides whether to flag separately). */
  leafTodoId: string | null;
  now: number;
}

/**
 * Shared guard body for (a)-(e),(g) of the reclamation-safety predicate — every guard
 * EXCEPT (f) the age floor. Resolves realpath identity first (g), then live-claim (c),
 * lock (b), in-progress git state (e), live process cwd (d), and clean tree (a). ANY
 * check throwing / erroring / returning "unknown" resolves that guard to FALSE (not
 * reclaimable) — locked constraint d7f5eb20: default KEEP, unknown=keep.
 *
 * Returns the resolved realDir on success (so callers needing it, e.g. for the age
 * check in `isReclaimable`, don't re-resolve realpath), or null on any guard failure.
 */
async function checkReclaimGuardsExceptAge(
  input: Omit<ReclaimabilityInput, 'now'>,
): Promise<string | null> {
  const { dir, baseDir, leafTodoId } = input;

  // (g) realpath identity — resolve symlinks before any path-based comparison.
  let realDir: string;
  let realBase: string;
  try {
    realDir = await fsRealpath(dir);
    realBase = await fsRealpath(baseDir);
  } catch {
    return null; // dir vanished or unreadable → unknown → keep
  }
  const rel = path.relative(realBase, realDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;

  // (c) no live claim / inflight run.
  if (leafTodoId) {
    if (isLeafInflightLive(leafTodoId)) return null;
    if (listLeafInflight().some((r) => r.leafId === leafTodoId)) return null;
  }

  // (b) not git-locked.
  const lockRes = await gcGitRead(realDir, ['rev-parse', '--git-dir']);
  if (lockRes.code !== 0 || !lockRes.stdout.trim()) return null;
  const gitDirForLock = path.isAbsolute(lockRes.stdout.trim())
    ? lockRes.stdout.trim()
    : path.join(realDir, lockRes.stdout.trim());
  if (await pathExists(path.join(gitDirForLock, 'locked'))) return null;

  // (e) no in-progress git state.
  if (await hasInProgressGitState(realDir)) return null;

  // (d) no live process cwd under the dir.
  if (await hasLiveProcessUnder(realDir)) return null;

  // (a) clean — tracked changes, then untracked-but-unique-to-checkout.
  const statusRes = await gcGitRead(realDir, ['status', '--porcelain']);
  if (statusRes.code !== 0) return null; // unusable checkout → unknown → keep
  const lines = statusRes.stdout.split('\n').filter((l) => l.length > 0);
  const tracked = lines.filter((l) => !l.startsWith('??'));
  if (tracked.length > 0) return null;

  return realDir;
}

/**
 * Reclamation-safety predicate (crit_2e65940d_1 gate). Returns TRUE only if EVERY guard
 * independently passes:
 *   (a) clean          — no tracked changes, no untracked file unique to this checkout
 *   (b) not git-locked  — no `.git/worktrees/<name>/locked` marker
 *   (c) no live claim   — not in listLeafInflight() / isLeafInflightLive()
 *   (d) no live cwd     — hasLiveProcessUnder() is false
 *   (e) no in-progress git state — hasInProgressGitState() is false
 *   (f) very old        — BOTH mtime and atime older than WORKTREE_RECLAIM_MIN_AGE_MS
 *   (g) realpath-resolved identity — realpath(dir) must resolve to a path actually
 *       under realpath(baseDir) (guards a symlink escape before any of the above matter)
 *
 * ANY check throwing / erroring / returning "unknown" resolves that guard to FALSE
 * (not reclaimable) — locked constraint d7f5eb20: default KEEP, unknown=keep. This
 * function only ever REFUSES reclamation; it never removes or moves anything.
 */
export async function isReclaimable(input: ReclaimabilityInput): Promise<boolean> {
  const { now } = input;
  const realDir = await checkReclaimGuardsExceptAge(input);
  if (realDir == null) return false;

  // (f) very old — both mtime and atime.
  let st;
  try {
    st = await stat(realDir);
  } catch {
    return false;
  }
  if (now - st.mtimeMs < WORKTREE_RECLAIM_MIN_AGE_MS) return false;
  if (now - st.atimeMs < WORKTREE_RECLAIM_MIN_AGE_MS) return false;

  return true;
}

/**
 * Same guards as `isReclaimable` MINUS (f) the age floor — for the record-verified
 * catch-up path (a just-landed epic worktree is, by definition, recent; its safety
 * proof is the durable land-record match, not age). Never fakes a `now` value to
 * dodge WORKTREE_RECLAIM_MIN_AGE_MS — that would be fragile and couple to the
 * constant's exact value; this instead skips the age check entirely.
 */
export async function isReclaimableIgnoringAge(
  input: Omit<ReclaimabilityInput, 'now'>,
): Promise<boolean> {
  return (await checkReclaimGuardsExceptAge(input)) != null;
}

/**
 * Directory-driven GC pass for leaf-exec-* worktrees (kill-the-running-build epic,
 * HALF 2). `reapOrphanedLeafWorktrees` above is record-driven (`wm.list()`, which reads
 * the SAME dir the worktree records live in) — a dir whose record was already deleted
 * (e.g. `_removeInner`'s best-effort fs.rm fallback) is invisible to it forever. This
 * pass instead scans the DIRECTORY and reconciles it against what git has registered,
 * so it can drain orphans the record-driven reaper can never see.
 *
 * Conservative by construction: every guard can only REFUSE a removal (a live leaf, an
 * unknown todo, uncommitted tracked changes, or an untracked file with no counterpart in
 * the main checkout), never force one. `dryRun` skips the actual `removePath` call but
 * still computes the full report.
 *
 * Extended to handle a second candidate class: non-`leaf-exec-*` worktrees under
 * baseDir (abandoned interactive-session *lane* checkouts and *terminal-epic* accumulation
 * worktrees). An orphan that is provably safe — old, pristine, unlocked, unowned, not a
 * live epic — is removed; anything dirty / locked / unclassifiable is flagged only
 * (a friction note + a report.refused entry) and left untouched.
 */
export async function gcLeafWorktrees(
  project: string,
  opts?: { dryRun?: boolean; orphanMaxAgeMs?: number },
): Promise<GcReport> {
  const wm = getWorktreeManager(project);
  const report: GcReport = { removed: [], refused: [], quarantined: [], prunedRegistrations: 0, scanned: 0 };

  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(wm.baseDir(), { withFileTypes: true });
  } catch {
    return report;
  }

  const now = Date.now();
  const orphanMaxAgeMs = opts?.orphanMaxAgeMs ?? ORPHAN_WORKTREE_MAX_AGE_MS;

  // Pre-compute the two reconcile inputs once: what git knows about + what the durable
  // wm records own. The reaper treats "a durable record claims this path" ⇒ bound ⇒
  // refuse to remove — this is deliberately over-cautious because the only queryable
  // ownership signal is a persisted record (the in-memory AgentSessionRegistry is
  // unreachable here). A live session ALWAYS has a record; a record-gone orphan is
  // fair game for GC.
  const registered = await listRegisteredWorktreeMeta(project);
  const worktreeRecords = await wm.list();
  const recordsByBasename = new Map(worktreeRecords.map((r) => [path.basename(r.path), r]));
  const recordBasenames = new Set(recordsByBasename.keys());

  const flagOrphan = async (
    dir: string,
    reason: string,
    sample: string[] = [],
  ): Promise<void> => {
    report.refused.push({ path: dir, reason, sample });
    const detail = `orphan non-leaf worktree left in place: ${dir}`;
    // Atomic record-if-absent (crit 2e65940d_2): the reaper REFUSES these orphans, so the
    // same dir is re-seen every pass. recordFrictionOnce's INSERT...WHERE NOT EXISTS is ONE
    // SQL statement — no separate check-then-act window a second (possibly cross-process)
    // caller can race into. Fixes the check-then-act gap left by the prior
    // hasFrictionNote+recordFriction pair (951629c9), which raced across overlapping/
    // cross-process passes.
    await recordFrictionOnce(project, { layer: 'operational', retryReason: reason, detail }).catch(() => {});
  };

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(wm.baseDir(), entry.name);

    if (entry.name.startsWith(LEAF_EXEC_PREFIX)) {
      // ── Candidate class 1: leaf-exec-* worktree (existing path, unchanged) ────────
      report.scanned += 1;
      const id8 = entry.name.slice(LEAF_EXEC_PREFIX.length, LEAF_EXEC_PREFIX.length + 8);

      const todo = id8.length === 8 ? findLeafTodoByShortId(project, id8) : null;
      if (!todo) {
        report.refused.push({ path: dir, reason: 'unknown-todo', sample: [] });
        continue;
      }
      if (todo.status !== 'done' && todo.status !== 'dropped') continue; // live leaf — skip silently

      if (isLeafInflightLive(todo.id) || isRunLive(todo.id)) continue; // executor still running

      // Grace window — mirrors isReapable's merge-race guard: a leaf just finished its
      // self-merge may still be settling on disk.
      let mtimeMs: number | null = null;
      try { mtimeMs = (await stat(dir)).mtimeMs; } catch { mtimeMs = null; }
      if (mtimeMs != null && now - mtimeMs < REAP_GRACE_MS) continue;

      const status = await wm.statusAt(dir);
      if (status === null) {
        // Dangling (unregistered) checkout — git itself is unusable here. Nothing
        // COMMITTED is at risk (the branch, if any, still lives in the main repo); the
        // only risk is a file that exists ONLY in this dir. Bounded-walk compare against
        // the main checkout.
        const files = await listFilesBounded(dir);
        const unique: string[] = [];
        for (const f of files) {
          if (!(await pathExists(path.join(project, f)))) unique.push(f);
        }
        if (unique.length > 0) {
          report.refused.push({ path: dir, reason: 'dangling-with-unique-files', sample: unique.slice(0, 5) });
          continue;
        }
      } else {
        const tracked = status.filter((l) => !l.startsWith('??'));
        if (tracked.length > 0) {
          report.refused.push({
            path: dir,
            reason: 'uncommitted-tracked-changes',
            sample: tracked.slice(0, 5).map((l) => l.slice(3)),
          });
          continue;
        }
        const untracked = status.filter((l) => l.startsWith('??')).map((l) => l.slice(3));
        const uniqueUntracked: string[] = [];
        for (const f of untracked) {
          if (!(await pathExists(path.join(project, f)))) uniqueUntracked.push(f);
        }
        if (uniqueUntracked.length > 0) {
          report.refused.push({ path: dir, reason: 'untracked-unique-files', sample: uniqueUntracked.slice(0, 5) });
          continue;
        }
      }

      if (!opts?.dryRun) {
        try {
          await wm.removePath(dir);
          console.log(`[worktree-gc] removed orphaned worktree dir ${dir} (todo=${todo.id.slice(0, 8)} status=${todo.status})`);
        } catch {
          report.refused.push({ path: dir, reason: 'remove-failed', sample: [] });
          continue;
        }
      }
      report.removed.push(dir);
      continue;
    }

    // ── Candidate class 2: orphan non-leaf / lane worktree ──────────────────────────
    report.scanned += 1;

    // 1. Live epic — silent skip.
    const epicId8 = epicWorktreeId8(entry.name);
    let epicTodo: ReturnType<typeof findLeafTodoByShortId> = null;
    if (epicId8) {
      epicTodo = findLeafTodoByShortId(project, epicId8);
      if (epicTodo && epicTodo.status !== 'done' && epicTodo.status !== 'dropped') continue;
    }

    // 1.5 Terminal epic WITH a durable land-record — record-verified fast path,
    // bypasses the 7-day age floor (constraint a383bc2c/a68bef56: never trust
    // branch existence/`--merged`; the durable record is the only proof).
    if (epicTodo) {
      const landRecord = getEpicLandRecord(project, epicTodo.id);
      if (landRecord) {
        const status = await wm.statusAt(dir);
        const clean = status !== null && status.length === 0;
        const headRes = await gcGitRead(dir, ['rev-parse', 'HEAD']);
        const headSha = headRes.code === 0 ? headRes.stdout.trim() : null;
        const headMatches = headSha != null && headSha === landRecord.epicTipSha;

        if (clean && headMatches) {
          const trunkRef = await resolveTrunkRef(project);
          const ancestorRes = await gcGitRead(dir, ['merge-base', '--is-ancestor', 'HEAD', trunkRef]);
          const isAncestor = ancestorRes.code === 0;

          if (isAncestor) {
            const reclaimable = await isReclaimableIgnoringAge({ dir, baseDir: wm.baseDir(), leafTodoId: null });
            if (reclaimable) {
              if (!opts?.dryRun) {
                try {
                  const { trashDir } = await wm.quarantineMove(dir, 'landed-epic-reclaimed');
                  report.quarantined.push({ path: dir, trashDir });
                  console.log(`[worktree-gc] quarantined landed epic worktree ${dir} -> ${trashDir}`);
                } catch {
                  report.refused.push({ path: dir, reason: 'quarantine-failed', sample: [] });
                  continue;
                }
              } else {
                report.quarantined.push({ path: dir, trashDir: '(dry-run)' });
              }
              continue;
            }
          }
        }
      }
    }

    // 2. Bound (owned by a session) — normally a silent skip, UNLESS the recorded
    // session is provably DEAD (no heartbeat for >= POOL_LANE_DEAD_MS, i.e. >= 2x
    // CRASH_MS) AND the full isReclaimable() envelope passes (incl. the 7-day age
    // floor — this path, unlike the landed-epic fast path above, keeps the floor:
    // a pool lane has no durable land-record to substitute as a safety proof).
    // Dead-pool-lane reclamation (mission d1cfea69 crit 3).
    if (recordBasenames.has(entry.name)) {
      const record = recordsByBasename.get(entry.name)!;
      const statusRow = getStatuses(project).find((s) => s.session === record.sessionId);
      const sessionDeadMs = statusRow == null ? Infinity : now - statusRow.updatedAt;
      if (sessionDeadMs >= POOL_LANE_DEAD_MS) {
        const reclaimable = await isReclaimable({ dir, baseDir: wm.baseDir(), leafTodoId: null, now });
        if (reclaimable) {
          if (!opts?.dryRun) {
            try {
              const { trashDir } = await wm.quarantineMove(dir, 'dead-pool-lane-reclaimed');
              report.quarantined.push({ path: dir, trashDir });
              console.log(
                `[worktree-gc] quarantined dead pool-lane worktree ${dir} -> ${trashDir} (session=${record.sessionId})`,
              );
            } catch {
              report.refused.push({ path: dir, reason: 'quarantine-failed', sample: [] });
            }
            continue;
          }
          report.quarantined.push({ path: dir, trashDir: '(dry-run)' });
          continue;
        }
      }
      continue;
    }

    // 3. Unregistered / unusable — FLAG.
    const meta = registered.get(entry.name);
    if (!meta) {
      await flagOrphan(dir, 'orphan-unregistered');
      continue;
    }

    // 4. Locked — FLAG (must precede any removal).
    if (meta.locked) {
      await flagOrphan(dir, 'orphan-locked');
      continue;
    }

    // 5. Too young — silent skip.
    const ageMs = await headCommitAgeMs(dir, now);
    if (ageMs === null) {
      await flagOrphan(dir, 'orphan-unknown-head');
      continue;
    }
    if (ageMs <= orphanMaxAgeMs) continue;

    // 6. Recently touched (merge-race quiet window) — silent skip.
    let mtimeMs: number | null = null;
    try { mtimeMs = (await stat(dir)).mtimeMs; } catch { mtimeMs = null; }
    if (mtimeMs != null && now - mtimeMs < REAP_GRACE_MS) continue;

    // 7. Dirty / not-a-worktree — FLAG.
    const status = await wm.statusAt(dir);
    if (status === null) {
      await flagOrphan(dir, 'orphan-unusable');
      continue;
    }
    if (status.length > 0) {
      await flagOrphan(dir, 'orphan-dirty', status.slice(0, 5).map((l) => l.slice(3)));
      continue;
    }

    // 8. Reclaim check — everything above (registered, unlocked, aged past
    //    orphanMaxAgeMs, quiet past REAP_GRACE_MS, git-clean) is a NECESSARY but not
    //    SUFFICIENT condition; isReclaimable() re-checks independently (live-cwd,
    //    in-progress git state, the stricter WORKTREE_RECLAIM_MIN_AGE_MS floor) before any
    //    data moves. A dir that fails isReclaimable here is flagged, never removed.
    const reclaimable = await isReclaimable({ dir, baseDir: wm.baseDir(), leafTodoId: null, now });
    if (!reclaimable) {
      await flagOrphan(dir, 'orphan-not-reclaimable');
      continue;
    }

    if (!opts?.dryRun) {
      try {
        const { trashDir } = await wm.quarantineMove(dir, 'orphan-reclaimed');
        report.quarantined.push({ path: dir, trashDir });
        console.log(`[worktree-gc] quarantined orphan non-leaf worktree ${dir} -> ${trashDir}`);
      } catch {
        report.refused.push({ path: dir, reason: 'quarantine-failed', sample: [] });
        continue;
      }
    } else {
      report.quarantined.push({ path: dir, trashDir: '(dry-run)' });
    }
  }

  console.log(
    `[worktree-gc] scanned=${report.scanned} removed=${report.removed.length} ` +
    `refused=${report.refused.length} pruned=${report.prunedRegistrations}`,
  );
  try {
    recordSupervisorAudit({
      kind: 'reconcile',
      project,
      session: '',
      detail: JSON.stringify({ source: 'worktree-gc', ...report }),
    });
  } catch { /* telemetry best-effort */ }

  return report;
}

/** Throttled entry point (WORKTREE_GC_INTERVAL_MS/project) for the coordinator tick.
 *  Fire-and-forget — mirrors `reapOrphanedLeafWorktrees`'s own throttle-and-call shape.
 *  `opts.now` injects the clock and `opts.gc` the underlying work so the throttle is
 *  unit-testable without real time or a real fs+git scan. */
export async function tickGcLeafWorktrees(
  project: string,
  opts: { now?: number; gc?: (project: string) => Promise<GcReport> } = {},
): Promise<GcReport | null> {
  const now = opts.now ?? Date.now();
  if ((now - (lastGcMs.get(project) ?? 0)) < WORKTREE_GC_INTERVAL_MS) return null;
  lastGcMs.set(project, now);
  return (opts.gc ?? gcLeafWorktrees)(project);
}

const lastTrashSweepMs = new Map<string, number>();
const TRASH_SWEEP_THROTTLE_MS = 60 * 60_000; // hourly

/** Hard-deletes `.collab/.trash/<ts>/*` entries older than WorktreeManager's
 *  WORKTREE_TRASH_TTL_MS. Throttled per project; fire-and-forget from the coordinator
 *  tick, same shape as tickGcLeafWorktrees. */
export async function tickSweepWorktreeTrash(project: string): Promise<string[] | null> {
  const now = Date.now();
  if ((now - (lastTrashSweepMs.get(project) ?? 0)) < TRASH_SWEEP_THROTTLE_MS) return null;
  lastTrashSweepMs.set(project, now);
  const wm = getWorktreeManager(project);
  const removed = await wm.sweepTrash(now);
  if (removed.length > 0) {
    console.log(`[worktree-gc] swept ${removed.length} expired trash entr${removed.length === 1 ? 'y' : 'ies'}`);
  }
  return removed;
}
