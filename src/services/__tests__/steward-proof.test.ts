import { describe, it, expect } from 'vitest';
import { validateStewardProof, isOverrideRateLimited, type ProofContext, type DepView } from '../steward-proof';

/** A context with all real runners stubbed; tests override per-case. */
function ctx(over: Partial<ProofContext> = {}): ProofContext {
  return {
    project: '/p',
    dependsOn: [],
    getDep: () => null,
    changeSetFiles: [],
    runners: {
      commitsBehindMaster: () => 0,
      tscClean: () => true,
      grepPresent: () => false,
      fileExists: () => false,
    },
    ...over,
  };
}
const deps = (map: Record<string, DepView>): Pick<ProofContext, 'dependsOn' | 'getDep'> => ({
  dependsOn: Object.keys(map),
  getDep: (id) => map[id] ?? null,
});

describe('validateStewardProof — the keystone rail (server re-derives, never trusts the LLM)', () => {
  it('absent proof is a hand-back, not a license', () => {
    expect(validateStewardProof('reset_todo', undefined, ctx())).toEqual({ ok: false, reason: 'no-proof' });
  });

  it('reset_todo merged: passes iff HEAD is not behind master', () => {
    expect(validateStewardProof('reset_todo', { kind: 'merged' }, ctx({ runners: { commitsBehindMaster: () => 0 } })).ok).toBe(true);
    expect(validateStewardProof('reset_todo', { kind: 'merged' }, ctx({ runners: { commitsBehindMaster: () => 3 } }))).toEqual({ ok: false, reason: 'merged-failed' });
  });

  it('reset_todo tsc-clean: passes iff tsc exits clean', () => {
    expect(validateStewardProof('reset_todo', { kind: 'tsc-clean' }, ctx({ runners: { tscClean: () => true } })).ok).toBe(true);
    expect(validateStewardProof('reset_todo', { kind: 'tsc-clean' }, ctx({ runners: { tscClean: () => false } }))).toEqual({ ok: false, reason: 'tsc-failed' });
  });

  it('reset_todo grep: re-derived presence must match the claim', () => {
    expect(validateStewardProof('reset_todo', { kind: 'grep', symbol: 'X', present: true }, ctx({ runners: { grepPresent: () => true } })).ok).toBe(true);
    expect(validateStewardProof('reset_todo', { kind: 'grep', symbol: 'X', present: true }, ctx({ runners: { grepPresent: () => false } }))).toEqual({ ok: false, reason: 'grep-mismatch' });
  });

  it('reset_todo dep-done: store-truth — all deps done & not rejected', () => {
    const good = ctx(deps({ d1: { id: 'd1', status: 'done', acceptanceStatus: 'accepted' } }));
    expect(validateStewardProof('reset_todo', { kind: 'dep-done' }, good).ok).toBe(true);
  });

  it('hallucinated-resolve: dep-done proof but the store says a dep is NOT done → rejected', () => {
    const blocked = ctx(deps({ d1: { id: 'd1', status: 'blocked', acceptanceStatus: null } }));
    expect(validateStewardProof('reset_todo', { kind: 'dep-done' }, blocked)).toEqual({ ok: false, reason: 'hallucinated-resolve' });
    const rejected = ctx(deps({ d1: { id: 'd1', status: 'done', acceptanceStatus: 'rejected' } }));
    expect(validateStewardProof('reset_todo', { kind: 'dep-done' }, rejected)).toEqual({ ok: false, reason: 'hallucinated-resolve' });
  });

  it('wrong proof for verb is rejected', () => {
    expect(validateStewardProof('override_accept_todo', { kind: 'merged' } as any, ctx())).toEqual({ ok: false, reason: 'wrong-proof-for-verb' });
  });

  it('override_accept DEFAULTS to DEFER without a foreign-error proof', () => {
    const c = ctx({ runners: { fileExists: () => true }, changeSetFiles: ['a.ts'] });
    expect(validateStewardProof('override_accept_todo', { kind: 'override', artifactPath: 'a.ts', foreignErrorFiles: [] }, c)).toEqual({ ok: false, reason: 'override-default-defer' });
  });

  it('override_accept rejects when the deliverable is not provably in-tree', () => {
    const c = ctx({ runners: { fileExists: () => false, grepPresent: () => false }, changeSetFiles: ['a.ts'] });
    expect(validateStewardProof('override_accept_todo', { kind: 'override', artifactPath: 'missing.ts', foreignErrorFiles: ['other.ts'] }, c)).toEqual({ ok: false, reason: 'override-no-in-tree-artifact' });
  });

  it('override_accept rejects when the gate error is NOT foreign (it is in this change-set)', () => {
    const c = ctx({ runners: { fileExists: () => true }, changeSetFiles: ['mine.ts'] });
    expect(validateStewardProof('override_accept_todo', { kind: 'override', artifactPath: 'mine.ts', foreignErrorFiles: ['mine.ts'] }, c)).toEqual({ ok: false, reason: 'override-error-not-foreign' });
  });

  it('override_accept passes ONLY with dual proof: in-tree artifact AND foreign error', () => {
    const c = ctx({ runners: { fileExists: () => true }, changeSetFiles: ['mine.ts'] });
    expect(validateStewardProof('override_accept_todo', { kind: 'override', artifactPath: 'mine.ts', foreignErrorFiles: ['sibling.ts'] }, c).ok).toBe(true);
  });

  // override-clean (Orch P2): the safe auto-derivable override — artifact present
  // AND tsc clean, NO change-set/foreign-error needed.
  it('override-clean passes when the deliverable is in-tree AND tsc is clean', () => {
    const c = ctx({ runners: { fileExists: () => true, tscClean: () => true } });
    expect(validateStewardProof('override_accept_todo', { kind: 'override-clean', artifactPath: 'a.ts' }, c).ok).toBe(true);
  });

  it('override-clean by symbol re-derives presence via grep', () => {
    const c = ctx({ runners: { grepPresent: () => true, tscClean: () => true } });
    expect(validateStewardProof('override_accept_todo', { kind: 'override-clean', artifactSymbol: 'MyThing' }, c).ok).toBe(true);
  });

  it('override-clean rejects when the deliverable is NOT in-tree', () => {
    const c = ctx({ runners: { fileExists: () => false, grepPresent: () => false, tscClean: () => true } });
    expect(validateStewardProof('override_accept_todo', { kind: 'override-clean', artifactPath: 'missing.ts' }, c)).toEqual({ ok: false, reason: 'override-no-in-tree-artifact' });
  });

  it('override-clean rejects when tsc is DIRTY (the tree is not actually green)', () => {
    const c = ctx({ runners: { fileExists: () => true, tscClean: () => false } });
    expect(validateStewardProof('override_accept_todo', { kind: 'override-clean', artifactPath: 'a.ts' }, c)).toEqual({ ok: false, reason: 'tsc-failed' });
  });
});

describe('land_epic epic-landable (FBPE P3 — read-only land surface)', () => {
  const landProof = { kind: 'epic-landable' as const, epicId: 'epic-123', epicBranch: 'collab/epic/epic-123' };
  /** ctx for an epic with the given children, plus stubbed worktree-cwd seam runners. */
  function epicCtx(children: Record<string, DepView>, runnerOver: Partial<ProofContext['runners']> = {}): ProofContext {
    return {
      project: '/p',
      dependsOn: [],
      getDep: (id) => children[id] ?? null,
      epicChildIds: Object.keys(children),
      epicWorktreeCwd: '/p/__epic__',
      masterCwd: '/p',
      runners: { tscClean: () => true, epicMergeClean: () => true, ...runnerOver },
    };
  }
  const allDone = { c1: { id: 'c1', status: 'done', acceptanceStatus: 'accepted' } as DepView, c2: { id: 'c2', status: 'done', acceptanceStatus: null } as DepView };

  it('passes when every child is done+accepted, tsc clean in the epic worktree, and the dry-merge into master is clean', () => {
    expect(validateStewardProof('land_epic', landProof, epicCtx(allDone))).toEqual({ ok: true, reason: 'ok' });
  });

  it('wrong-proof-for-verb when the cited proof is not epic-landable', () => {
    expect(validateStewardProof('land_epic', { kind: 'tsc-clean' } as any, epicCtx(allDone)))
      .toEqual({ ok: false, reason: 'wrong-proof-for-verb' });
  });

  it('epic-children-incomplete when any child is not done or is rejected (store-truth, never asserted)', () => {
    const openChild = { c1: { id: 'c1', status: 'in_progress', acceptanceStatus: null } as DepView };
    expect(validateStewardProof('land_epic', landProof, epicCtx(openChild)))
      .toEqual({ ok: false, reason: 'epic-children-incomplete' });
    const rejectedChild = { c1: { id: 'c1', status: 'done', acceptanceStatus: 'rejected' } as DepView };
    expect(validateStewardProof('land_epic', landProof, epicCtx(rejectedChild)))
      .toEqual({ ok: false, reason: 'epic-children-incomplete' });
  });

  it('tsc-failed when tsc is dirty IN the epic worktree (the worktree-cwd seam is exercised)', () => {
    let tscCwd: string | undefined;
    const c = epicCtx(allDone, { tscClean: (cwd) => { tscCwd = cwd; return false; } });
    expect(validateStewardProof('land_epic', landProof, c)).toEqual({ ok: false, reason: 'tsc-failed' });
    expect(tscCwd).toBe('/p/__epic__'); // tsc ran in the epic worktree, not the project root
  });

  it('epic-merge-conflict when the epic branch does not dry-merge cleanly into the master checkout', () => {
    let mergeArgs: [string, string] | undefined;
    const c = epicCtx(allDone, { epicMergeClean: (masterCwd, branch) => { mergeArgs = [masterCwd, branch]; return false; } });
    expect(validateStewardProof('land_epic', landProof, c)).toEqual({ ok: false, reason: 'epic-merge-conflict' });
    expect(mergeArgs).toEqual(['/p', 'collab/epic/epic-123']); // dry-merge ran in the master checkout
  });
});

describe('isOverrideRateLimited (the scary-verb cap)', () => {
  const now = 10_000_000;
  it('false under the cap, true at/over it', () => {
    expect(isOverrideRateLimited([now - 1000], now, 2)).toBe(false);
    expect(isOverrideRateLimited([now - 1000, now - 2000], now, 2)).toBe(true);
  });
  it('only counts overrides within the trailing hour', () => {
    expect(isOverrideRateLimited([now - 4_000_000, now - 5_000_000], now, 2)).toBe(false); // both outside 1h
  });
});
