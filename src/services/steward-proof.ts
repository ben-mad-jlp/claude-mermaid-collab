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
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type StewardVerb = 'reset_todo' | 'override_accept_todo';

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
  | { kind: 'override-clean'; artifactPath?: string; artifactSymbol?: string };

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
  /** Override the real git/tsc/grep/fs predicates (tests inject fakes). */
  runners?: Partial<ProofRunners>;
}

export interface ProofRunners {
  /** Count of commits HEAD has that master doesn't — `git rev-list --count HEAD..master` is 0 when not behind. */
  commitsBehindMaster: (project: string) => number;
  tscClean: (project: string) => boolean;
  grepPresent: (project: string, symbol: string) => boolean;
  fileExists: (project: string, relPath: string) => boolean;
}

export interface ProofResult {
  ok: boolean;
  /** Machine reason: 'ok' | 'no-proof' | 'wrong-proof-for-verb' | 'merged-failed' |
   *  'tsc-failed' | 'grep-mismatch' | 'hallucinated-resolve' | 'override-default-defer' |
   *  'override-no-in-tree-artifact' | 'override-error-not-foreign'. */
  reason: string;
}

const realRunners: ProofRunners = {
  commitsBehindMaster(project) {
    const out = execFileSync('git', ['rev-list', '--count', 'HEAD..master'], { cwd: project, encoding: 'utf8' });
    return parseInt(out.trim(), 10) || 0;
  },
  tscClean(project) {
    try {
      execFileSync('npx', ['tsc', '--noEmit'], { cwd: project, encoding: 'utf8', stdio: 'pipe' });
      return true;
    } catch {
      return false;
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
