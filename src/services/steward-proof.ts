/**
 * Steward proof gate — the safety core (design-first-class-steward §3/§5/§7,
 * constraint 020b7ab1).
 *
 * The one-line invariant: **a steward acts only when the SERVER can re-derive its
 * verdict from ground truth; absence of proof is a hand-back, never a license for
 * judgment.** This module re-validates a steward-cited proof at ACT time against
 * git / tsc / the store — it NEVER trusts an LLM-asserted boolean. The act-verb
 * handlers (reset_todo / override_accept_todo) call this under a steward epoch and
 * reject + re-route any call whose proof is absent or fails re-derivation.
 *
 * Predicates by verb (design §3 answer/act table):
 *  - reset_todo (STALE blocker):   merged (HEAD..master==0) | tsc-clean | grep symbol.
 *  - reset_todo (NOW-BUILDABLE):   dep-done — all deps done/accepted IN THE STORE (+ leaf).
 *  - override_accept_todo:         DEFAULT DEFER; auto ONLY with dual proof — the
 *                                  deliverable provably in-tree AND the gate failure
 *                                  provably FOREIGN (outside this todo's change-set).
 *
 * Pure/​injectable: the git/tsc/grep/fs predicates are behind `ProofRunners` so the
 * decision logic is unit-testable without a live repo; defaults shell out for real.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectCompileCheck } from './compile-gate.ts';
import { getEpicLandReadiness } from './epic-land-readiness.ts';

export type StewardVerb = 'reset_todo' | 'override_accept_todo' | 'land_epic';

/** Machine-checkable proof a steward cites; the server re-derives each predicate. */
export type StewardProof =
  | { kind: 'merged' }
  | { kind: 'tsc-clean' }
  | { kind: 'grep'; symbol: string; present: boolean }
  | { kind: 'dep-done' }
  | { kind: 'override'; artifactPath?: string; artifactSymbol?: string; foreignErrorFiles: string[] }
  // override-clean (Orch P2): the SAFE auto-derivable override — the deliverable is
  // provably in-tree AND the whole tree compiles (tsc clean). If the tree is green
  // NOW, the gate's original rejection was spurious/stale, so accepting is safe.
  // No change-set needed (unlike `override`), so the daemon can re-derive it fully.
  | { kind: 'override-clean'; artifactPath?: string; artifactSymbol?: string }
  // epic-landable (FBPE P3): an epic's accumulation branch is provably ready to land
  // on master. The server re-derives three predicates from ground truth: (1) every
  // child of `epicId` is done+accepted in the store; (2) `tsc` is clean IN the epic's
  // accumulation worktree; (3) the epic branch dry-merges cleanly into a master
  // checkout. This proof only SURFACES readiness (the land_epic verb is read-only at
  // P3 — it never mutates master), so absence/red proof annotates the card, never acts.
  | { kind: 'epic-landable'; epicId: string; epicBranch: string };

/** Minimal dependency view the gate reads from the store (never from the proof). */
export interface DepView {
  id: string;
  status: string;
  acceptanceStatus: string | null;
}

export interface ProofContext {
  project: string;
  /** dependsOn ids of the todo being acted on. */
  dependsOn: string[];
  /** Resolves a dep id to its CURRENT store row (truth source for dep-done). */
  getDep: (id: string) => DepView | null;
  /** Files this todo touched (its change-set) — used to prove a gate error is foreign. */
  changeSetFiles?: string[];
  /** epic-landable (land_epic) — ids of the epic's direct children. The store-truth
   *  gate requires every one done+accepted (resolved via getDep, mirroring dep-done). */
  epicChildIds?: string[];
  /** epic-landable — cwd of the epic's accumulation worktree; `tsc` runs HERE (the
   *  worktree-cwd seam) rather than against the tracking project root. */
  epicWorktreeCwd?: string;
  /** epic-landable — cwd of a master checkout where the dry-merge is attempted. */
  masterCwd?: string;
  /** Override the real git/tsc/grep/fs predicates (tests inject fakes). */
  runners?: Partial<ProofRunners>;
}

/** All runner predicates may be sync OR async — the REAL runners are async (they spawn
 *  git/tsc, and a sync spawn in the sidecar starves its event loop past the Electron
 *  liveness watchdog: crit-6 of mission 693bbc27); test fakes stay plain sync. */
export interface ProofRunners {
  /** Count of commits the cwd's HEAD is behind `baseRef` — `git rev-list --count HEAD..<baseRef>`
   *  is 0 when not behind. The worktree-cwd seam: cwd and baseRef are BOTH explicit so the
   *  same predicate works in the tracking project (HEAD..master) or any epic/master checkout. */
  commitsBehindMaster: (cwd: string, baseRef?: string) => number | Promise<number>;
  /** `tsc --noEmit` in `cwd`. The worktree-cwd seam: for epic-landable this is the epic's
   *  accumulation worktree, not the tracking project root. */
  tscClean: (cwd: string) => boolean | Promise<boolean>;
  grepPresent: (project: string, symbol: string) => boolean | Promise<boolean>;
  fileExists: (project: string, relPath: string) => boolean | Promise<boolean>;
  /** epic-landable: dry `git merge --no-commit --no-ff <epicBranch>` in an ISOLATED
   *  detached worktree off master HEAD — never in masterCwd directly. masterCwd is used
   *  only to administer the worktree (git -C masterCwd worktree add/remove). True iff
   *  the merge applies cleanly (no conflict). Never commits; master ref + main checkout
   *  are untouched. */
  epicMergeClean: (masterCwd: string, epicBranch: string) => boolean | Promise<boolean>;
  /** epic-landable (G9): blocking land-readiness findings — accepted CODE leaves in the
   *  epic's descendant set with no commit reachable from the epic tip. [] = all present. */
  unlandedLeaves: (project: string, epicId: string) => any[] | Promise<any[]>;
}

export interface ProofResult {
  ok: boolean;
  /** Machine reason: 'ok' | 'no-proof' | 'wrong-proof-for-verb' | 'merged-failed' |
   *  'tsc-failed' | 'grep-mismatch' | 'hallucinated-resolve' | 'override-default-defer' |
   *  'override-no-in-tree-artifact' | 'override-error-not-foreign' |
   *  'epic-children-incomplete' | 'epic-merge-conflict' | 'epic-leaves-unlanded'. */
  reason: string;
  detail?: string;
}

/**
 * Memo for the epic dry-merge trial. The trial (`git worktree add` + merge + remove +
 * prune) is a PURE function of the two commit trees being merged, so it is safe to key
 * on `${masterSha}:${epicBranchSha}` — any real change to either branch changes a sha and
 * misses. Without this memo, every validateStewardProof('land_epic') re-runs the trial;
 * the daemon calls that 3× per epic per reconcile tick (autoLandArmed → surfaceEpicLand →
 * landEpic), so a handful of unlanded mission epics spins up ~a-worktree-per-few-seconds
 * — which pegs the server (worse with leaked worktrees). `compute` reports `cacheable`
 * so a TRANSIENT setup failure (worktree lock) is never cached, only a real clean/conflict.
 */
export const MERGE_CLEAN_TTL_MS = 10 * 60 * 1000;
const mergeCleanCache = new Map<string, { clean: boolean; at: number }>();
/** Test seam: clear the dry-merge memo so the next call recomputes. */
export function _resetMergeCleanCache(): void {
  mergeCleanCache.clear();
}
/** Pure memo wrapper (injectable clock) — unit-testable without a live repo.
 *  resolveKey/compute may be async (the REAL runners spawn git asynchronously). */
export async function memoizedMergeClean(deps: {
  resolveKey: () => string | Promise<string>; // '' → skip the cache entirely (couldn't resolve shas)
  compute: () => { clean: boolean; cacheable: boolean } | Promise<{ clean: boolean; cacheable: boolean }>;
  now?: () => number;
}): Promise<boolean> {
  const now = deps.now ?? Date.now;
  const key = await deps.resolveKey();
  if (key) {
    const hit = mergeCleanCache.get(key);
    if (hit && now() - hit.at < MERGE_CLEAN_TTL_MS) return hit.clean;
  }
  const { clean, cacheable } = await deps.compute();
  if (key && cacheable) mergeCleanCache.set(key, { clean, at: now() });
  return clean;
}

/**
 * Memo for tsc compile checks. A pristine worktree at HEAD X fully determines the tsc
 * input, so ${cwd}:${HEAD} is a safe cache key. But a DIRTY tree (staged, unstaged,
 * untracked) changes tsc input WITHOUT moving HEAD, so dirty trees must NEVER cache.
 * The porcelain-empty guard gates BOTH read and store: a dirty tree yields resolveKey()
 * return '', which skips the cache entirely (mirrors memoizedMergeClean's empty-key path).
 */
export const TSC_CLEAN_TTL_MS = 10 * 60 * 1000;
const tscCleanCache = new Map<string, { pass: boolean; at: number }>();
/** Test seam: clear the tsc-compile memo so the next call recomputes. */
export function _resetTscCleanCache(): void {
  tscCleanCache.clear();
}
/** Pure memo wrapper (injectable clock) — unit-testable without a live repo.
 *  resolveKey/compute may be async (the REAL runners spawn git/tsc asynchronously). */
export async function memoizedTscClean(deps: {
  resolveKey: () => string | Promise<string>; // '' → skip the cache entirely (dirty tree or rev-parse failed)
  compute: () => { pass: boolean; cacheable: boolean } | Promise<{ pass: boolean; cacheable: boolean }>;
  now?: () => number;
}): Promise<boolean> {
  const now = deps.now ?? Date.now;
  const key = await deps.resolveKey();
  if (key) {
    const hit = tscCleanCache.get(key);
    if (hit && now() - hit.at < TSC_CLEAN_TTL_MS) return hit.pass;
  }
  const { pass, cacheable } = await deps.compute();
  if (key && cacheable) tscCleanCache.set(key, { pass, at: now() });
  return pass;
}

/** Async execFile: resolves { code, stdout } — code 0 = success. NEVER a *Sync spawn:
 *  every realRunners predicate executes in the sidecar process (land / steward-proof
 *  paths), and a sync tsc or merge trial held its event loop for the full run. */
function execAsync(
  bin: string,
  args: string[],
  opts: { cwd?: string } = {},
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolvePromise) => {
    try {
      execFile(bin, args, { cwd: opts.cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if (err) {
          const code = typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1;
          resolvePromise({ code: code || 1, stdout: stdout ?? '' });
        } else {
          resolvePromise({ code: 0, stdout: stdout ?? '' });
        }
      });
    } catch {
      resolvePromise({ code: 1, stdout: '' });
    }
  });
}

export const realRunners: ProofRunners = {
  async commitsBehindMaster(cwd, baseRef = 'master') {
    const r = await execAsync('git', ['rev-list', '--count', `HEAD..${baseRef}`], { cwd });
    if (r.code !== 0) throw new Error(`git rev-list failed (exit ${r.code})`);
    return parseInt(r.stdout.trim(), 10) || 0;
  },
  tscClean(cwd) {
    // MEMOIZED on (cwd, HEAD): a pristine tree at HEAD X fully determines tsc input, so
    // ${cwd}:${HEAD} is a safe key. A dirty tree (staged/unstaged/untracked) changes
    // input WITHOUT moving HEAD, so it must never cache — resolveKey returns '' for
    // dirty/untracked/failed-to-resolve, which gates BOTH read and store.
    return memoizedTscClean({
      resolveKey: async () => {
        const dirtyR = await execAsync('git', ['-C', cwd, 'status', '--porcelain']);
        if (dirtyR.code !== 0) return ''; // no repo / git failed → run uncached (behavior unchanged)
        if (dirtyR.stdout.trim()) return ''; // dirty/untracked → run uncached (gate BOTH read and store)
        const headR = await execAsync('git', ['-C', cwd, 'rev-parse', 'HEAD']);
        const head = headR.code === 0 ? headR.stdout.trim() : '';
        return head ? `${cwd}:${head}` : '';
      },
      compute: async () => {
        // Language-aware: tsc for TS, dotnet build for .NET, and TRUE (no compile blocker)
        // for languages with no static compile step (e.g. Python) — running tsc there is a
        // false-fail. The land still rests on the other proofs (merge-clean, children-done).
        const check = detectCompileCheck(cwd);
        if (!check) return { pass: true, cacheable: true };
        const [bin, ...args] = check.cmd.split(' ');
        const r = await execAsync(bin, args, { cwd });
        return { pass: r.code === 0, cacheable: true };
      },
    });
  },
  epicMergeClean(masterCwd, epicBranch) {
    // MEMOIZED on (masterSha, epicBranchSha): the trial below is a pure function of the
    // two commit trees, so identical shas always merge to the same result. The cheap
    // rev-parse keys the memo; the expensive worktree trial only runs on a real change.
    return memoizedMergeClean({
      resolveKey: async () => {
        const mR = await execAsync('git', ['-C', masterCwd, 'rev-parse', 'master']);
        const eR = await execAsync('git', ['-C', masterCwd, 'rev-parse', epicBranch]);
        const m = mR.code === 0 ? mR.stdout.trim() : '';
        const e = eR.code === 0 ? eR.stdout.trim() : '';
        return m && e ? `${m}:${e}` : ''; // rev-parse failed → run the trial uncached (safe-refuse semantics unchanged)
      },
      compute: async () => {
        // Isolated trial: create a detached worktree pinned at master HEAD and run the
        // dry merge THERE — never in the main checkout (masterCwd). Mirrors the
        // __land-master__ lifecycle (worktree-manager.landEpicToMaster). Setup failure
        // is treated as not-clean (safe-refuse) AND NOT cached (transient).
        const trial = join(tmpdir(), `collab-land-trial-${process.pid}-${process.hrtime.bigint()}`);
        const sh = (args: string[], cwd: string) => execAsync('git', ['-C', cwd, ...args], { cwd });
        const teardown = async () => {
          await execAsync('git', ['-C', masterCwd, 'worktree', 'remove', '--force', trial]); // best-effort
          await execAsync('git', ['-C', masterCwd, 'worktree', 'prune']); // best-effort
        };
        // Detached worktree off master HEAD (do NOT check out the `master` branch — it is
        // live in the main tree; `git worktree add master` would fail "already checked out").
        const add = await execAsync('git', ['-C', masterCwd, 'worktree', 'add', '--detach', trial, 'master']);
        if (add.code !== 0) {
          await teardown(); // path may have been partially created
          return { clean: false, cacheable: false }; // setup failure is TRANSIENT — never cache it
        }
        try {
          const merge = await sh(['merge', '--no-commit', '--no-ff', epicBranch], trial);
          // Abort either way to leave the trial pristine before teardown.
          await sh(['merge', '--abort'], trial); // best-effort (nothing to abort on fast-forward)
          // clean (or already-up-to-date) vs genuine conflict — deterministic for these two shas.
          return { clean: merge.code === 0, cacheable: true };
        } finally {
          await teardown();
        }
      },
    });
  },
  async grepPresent(project, symbol) {
    const r = await execAsync('git', ['grep', '-q', '--fixed-strings', symbol], { cwd: project });
    return r.code === 0;
  },
  fileExists(project, relPath) {
    return existsSync(join(project, relPath));
  },
  async unlandedLeaves(project: string, epicId: string) {
    try {
      return (await getEpicLandReadiness(project, epicId)).findings;
    } catch {
      return [];
    }
  },
};

/** True iff `file` is NOT in the todo's change-set (i.e. the gate error is a sibling lane's). */
function isForeign(file: string, changeSet: string[]): boolean {
  return !changeSet.some((c) => c === file || c.endsWith(file) || file.endsWith(c));
}

/**
 * Re-validate a steward proof for a verb against ground truth. Returns
 * { ok:false, reason } whenever the proof is missing, wrong for the verb, or
 * fails server re-derivation — the handler then rejects the act and re-routes the
 * escalation to a human.
 */
export async function validateStewardProof(
  verb: StewardVerb,
  proof: StewardProof | undefined,
  ctx: ProofContext,
): Promise<ProofResult> {
  if (!proof) return { ok: false, reason: 'no-proof' };
  const r: ProofRunners = { ...realRunners, ...ctx.runners };

  // land_epic (FBPE P3): re-derive epic-landability from ground truth. Read-only —
  // a green verdict only SURFACES the epic as ready-to-land; it never mutates master.
  if (verb === 'land_epic') {
    if (proof.kind !== 'epic-landable') return { ok: false, reason: 'wrong-proof-for-verb' };
    // (1) Store truth — every child of the epic done AND not rejected (mirrors dep-done).
    for (const childId of ctx.epicChildIds ?? []) {
      const child = ctx.getDep(childId);
      if (!child || child.status !== 'done' || child.acceptanceStatus === 'rejected') {
        return { ok: false, reason: 'epic-children-incomplete' };
      }
    }
    // (2) tsc clean IN the epic's accumulation worktree (the worktree-cwd seam).
    if (!(await r.tscClean(ctx.epicWorktreeCwd ?? ctx.project))) return { ok: false, reason: 'tsc-failed' };
    // (3) The epic branch dry-merges cleanly into a master checkout (no commit, aborted).
    if (!(await r.epicMergeClean(ctx.masterCwd ?? ctx.project, proof.epicBranch))) {
      return { ok: false, reason: 'epic-merge-conflict' };
    }
    // (4) G9 — PRESENCE: every accepted CODE leaf beneath the epic has a commit reachable
    // from the epic tip. Complements the correctness gate; presence != correctness.
    const unlanded = await r.unlandedLeaves(ctx.project, proof.epicId);
    if (unlanded.length > 0) {
      return {
        ok: false,
        reason: 'epic-leaves-unlanded',
        detail: unlanded.map((f: any) => `${f.todoId.slice(0, 8)} ${f.kind}: ${f.title}`).join('; '),
      };
    }
    return { ok: true, reason: 'ok' };
  }

  if (verb === 'reset_todo') {
    switch (proof.kind) {
      case 'merged':
        return (await r.commitsBehindMaster(ctx.project)) === 0
          ? { ok: true, reason: 'ok' }
          : { ok: false, reason: 'merged-failed' };
      case 'tsc-clean':
        return (await r.tscClean(ctx.project)) ? { ok: true, reason: 'ok' } : { ok: false, reason: 'tsc-failed' };
      case 'grep': {
        const present = await r.grepPresent(ctx.project, proof.symbol);
        return present === proof.present ? { ok: true, reason: 'ok' } : { ok: false, reason: 'grep-mismatch' };
      }
      case 'dep-done': {
        // Store-truth, not asserted: every dep must be done AND not rejected.
        for (const depId of ctx.dependsOn) {
          const dep = ctx.getDep(depId);
          if (!dep || dep.status !== 'done' || dep.acceptanceStatus === 'rejected') {
            return { ok: false, reason: 'hallucinated-resolve' };
          }
        }
        return { ok: true, reason: 'ok' };
      }
      default:
        return { ok: false, reason: 'wrong-proof-for-verb' };
    }
  }

  // override-clean: the SAFE auto-derivable override (Orch P2). Passes iff the
  // deliverable is provably in-tree AND `tsc` is clean — a green tree means the
  // original gate rejection was spurious. No foreign-error / change-set needed.
  if (proof.kind === 'override-clean') {
    const present =
      (proof.artifactPath ? await r.fileExists(ctx.project, proof.artifactPath) : false) ||
      (proof.artifactSymbol ? await r.grepPresent(ctx.project, proof.artifactSymbol) : false);
    if (!present) return { ok: false, reason: 'override-no-in-tree-artifact' };
    return (await r.tscClean(ctx.project)) ? { ok: true, reason: 'ok' } : { ok: false, reason: 'tsc-failed' };
  }

  // override_accept_todo — DEFAULT DEFER; auto only with DUAL proof.
  if (proof.kind !== 'override') return { ok: false, reason: 'wrong-proof-for-verb' };
  // (a) in-tree artifact proof: the deliverable provably exists.
  const hasArtifact =
    (proof.artifactPath ? await r.fileExists(ctx.project, proof.artifactPath) : false) ||
    (proof.artifactSymbol ? await r.grepPresent(ctx.project, proof.artifactSymbol) : false);
  if (!hasArtifact) return { ok: false, reason: 'override-no-in-tree-artifact' };
  // (b) foreign-error proof: the gate failure is OUTSIDE this todo's change-set.
  const changeSet = ctx.changeSetFiles ?? [];
  if (proof.foreignErrorFiles.length === 0) return { ok: false, reason: 'override-default-defer' };
  const allForeign = proof.foreignErrorFiles.every((f) => isForeign(f, changeSet));
  if (!allForeign) return { ok: false, reason: 'override-error-not-foreign' };
  return { ok: true, reason: 'ok' };
}

/**
 * Rate-limit guard for override_accept (design §7 rail 2 — the scary verb).
 * Given the timestamps of recent steward_override audit entries, returns true if
 * acting again now would exceed `capPerHour` within the trailing window.
 */
export function isOverrideRateLimited(
  recentOverrideTs: number[],
  now: number,
  capPerHour: number,
  windowMs = 3_600_000,
): boolean {
  const inWindow = recentOverrideTs.filter((t) => now - t < windowMs).length;
  return inWindow >= capPerHour;
}
