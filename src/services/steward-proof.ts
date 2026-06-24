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
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

export interface ProofRunners {
  /** Count of commits the cwd's HEAD is behind `baseRef` — `git rev-list --count HEAD..<baseRef>`
   *  is 0 when not behind. The worktree-cwd seam: cwd and baseRef are BOTH explicit so the
   *  same predicate works in the tracking project (HEAD..master) or any epic/master checkout. */
  commitsBehindMaster: (cwd: string, baseRef?: string) => number;
  /** `tsc --noEmit` in `cwd`. The worktree-cwd seam: for epic-landable this is the epic's
   *  accumulation worktree, not the tracking project root. */
  tscClean: (cwd: string) => boolean;
  grepPresent: (project: string, symbol: string) => boolean;
  fileExists: (project: string, relPath: string) => boolean;
  /** epic-landable: dry `git merge --no-commit --no-ff <epicBranch>` in an ISOLATED
   *  detached worktree off master HEAD — never in masterCwd directly. masterCwd is used
   *  only to administer the worktree (git -C masterCwd worktree add/remove). True iff
   *  the merge applies cleanly (no conflict). Never commits; master ref + main checkout
   *  are untouched. */
  epicMergeClean: (masterCwd: string, epicBranch: string) => boolean;
}

export interface ProofResult {
  ok: boolean;
  /** Machine reason: 'ok' | 'no-proof' | 'wrong-proof-for-verb' | 'merged-failed' |
   *  'tsc-failed' | 'grep-mismatch' | 'hallucinated-resolve' | 'override-default-defer' |
   *  'override-no-in-tree-artifact' | 'override-error-not-foreign' |
   *  'epic-children-incomplete' | 'epic-merge-conflict'. */
  reason: string;
}

const realRunners: ProofRunners = {
  commitsBehindMaster(cwd, baseRef = 'master') {
    const out = execFileSync('git', ['rev-list', '--count', `HEAD..${baseRef}`], { cwd, encoding: 'utf8' });
    return parseInt(out.trim(), 10) || 0;
  },
  tscClean(cwd) {
    try {
      execFileSync('npx', ['tsc', '--noEmit'], { cwd, encoding: 'utf8', stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  },
  epicMergeClean(masterCwd, epicBranch) {
    // Isolated trial: create a detached worktree pinned at master HEAD and run the
    // dry merge THERE — never in the main checkout (masterCwd). Mirrors the
    // __land-master__ lifecycle (worktree-manager.landEpicToMaster). Setup failure
    // is treated as not-clean (safe-refuse).
    const trial = join(tmpdir(), `collab-land-trial-${process.pid}-${process.hrtime.bigint()}`);
    const sh = (args: string[], cwd: string) =>
      execFileSync('git', ['-C', cwd, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
    const teardown = () => {
      try { execFileSync('git', ['-C', masterCwd, 'worktree', 'remove', '--force', trial], { stdio: 'pipe' }); } catch { /* gone */ }
      try { execFileSync('git', ['-C', masterCwd, 'worktree', 'prune'], { stdio: 'pipe' }); } catch { /* best-effort */ }
    };
    try {
      // Detached worktree off master HEAD (do NOT check out the `master` branch — it is
      // live in the main tree; `git worktree add master` would fail "already checked out").
      execFileSync('git', ['-C', masterCwd, 'worktree', 'add', '--detach', trial, 'master'], { stdio: 'pipe' });
    } catch {
      teardown(); // path may have been partially created
      return false; // cannot set up an isolated trial → refuse (do not fall back to masterCwd)
    }
    try {
      sh(['merge', '--no-commit', '--no-ff', epicBranch], trial);
      // Clean (or already-up-to-date). Abort to leave the trial pristine before teardown.
      try { sh(['merge', '--abort'], trial); } catch { /* nothing to abort */ }
      return true;
    } catch {
      try { sh(['merge', '--abort'], trial); } catch { /* nothing to abort */ }
      return false; // conflict
    } finally {
      teardown();
    }
  },
  grepPresent(project, symbol) {
    try {
      execFileSync('git', ['grep', '-q', '--fixed-strings', symbol], { cwd: project, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  },
  fileExists(project, relPath) {
    return existsSync(join(project, relPath));
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
export function validateStewardProof(
  verb: StewardVerb,
  proof: StewardProof | undefined,
  ctx: ProofContext,
): ProofResult {
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
    if (!r.tscClean(ctx.epicWorktreeCwd ?? ctx.project)) return { ok: false, reason: 'tsc-failed' };
    // (3) The epic branch dry-merges cleanly into a master checkout (no commit, aborted).
    if (!r.epicMergeClean(ctx.masterCwd ?? ctx.project, proof.epicBranch)) {
      return { ok: false, reason: 'epic-merge-conflict' };
    }
    return { ok: true, reason: 'ok' };
  }

  if (verb === 'reset_todo') {
    switch (proof.kind) {
      case 'merged':
        return r.commitsBehindMaster(ctx.project) === 0
          ? { ok: true, reason: 'ok' }
          : { ok: false, reason: 'merged-failed' };
      case 'tsc-clean':
        return r.tscClean(ctx.project) ? { ok: true, reason: 'ok' } : { ok: false, reason: 'tsc-failed' };
      case 'grep': {
        const present = r.grepPresent(ctx.project, proof.symbol);
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
      (proof.artifactPath ? r.fileExists(ctx.project, proof.artifactPath) : false) ||
      (proof.artifactSymbol ? r.grepPresent(ctx.project, proof.artifactSymbol) : false);
    if (!present) return { ok: false, reason: 'override-no-in-tree-artifact' };
    return r.tscClean(ctx.project) ? { ok: true, reason: 'ok' } : { ok: false, reason: 'tsc-failed' };
  }

  // override_accept_todo — DEFAULT DEFER; auto only with DUAL proof.
  if (proof.kind !== 'override') return { ok: false, reason: 'wrong-proof-for-verb' };
  // (a) in-tree artifact proof: the deliverable provably exists.
  const hasArtifact =
    (proof.artifactPath ? r.fileExists(ctx.project, proof.artifactPath) : false) ||
    (proof.artifactSymbol ? r.grepPresent(ctx.project, proof.artifactSymbol) : false);
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
