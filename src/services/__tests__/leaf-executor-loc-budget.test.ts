import { describe, it, expect } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';
import * as leafExecutor from '../leaf-executor';

describe('leaf-executor LOC budget', () => {
  // Ratchet re-pinned 3913 → 3915: the poisoned-checkout guard wiring (defaultRunGit +
  // the runBaseGate probe/restore deps at the makeLeafExecutorDeps call site) added 12
  // lines of necessary production wiring. Raise this ONLY with a diff that justifies it.
  //
  // Re-pinned 3915 → 3988: typed-contract gating (Phase 2 + Phase 3), flag-gated OFF so the
  // default path is byte-identical. The +73 is wiring around ALREADY-EXTRACTED modules — the
  // `typedContractGating` dep + its makeLeafExecutorDeps reader, the hoisted `leafContract`
  // var, a record-only advisory branch (Phase 2), and a `groundReview` closure (Phase 3) that
  // merely delegates to diff-contract-review's `groundReviewViaContract` or the existing
  // `validateReviewGrounding`. The heavy logic lives in diff-contract-review.ts /
  // review-citations.ts, not here. Comments are ~40% of the delta (this file's house style).
  //
  // Re-pinned 3988 → 3997: the typed-review REQ:<id> ballot (bug 6559ce96) — a 6th optional
  // `ballotRequirements` param on the buildSpec closure + a `reviewBallot` derivation at the
  // review call site (gated on typedContractGating + leafContract, byte-identical off-path),
  // delegating to diff-contract-review's `contractBallotRequirements`. +9 lines of call-site
  // wiring; the ballot-block logic lives in leaf-prompts.ts. (This ratchet is a floating
  // tripwire, not a real ceiling — down-only redesign filed as bug 0e494237.)
  it('leaf-executor.ts should be ≤ 3997 lines', () => {
    const leafExecutorPath = path.join(__dirname, '../leaf-executor.ts');
    const content = fs.readFileSync(leafExecutorPath, 'utf-8');
    const lineCount = content.split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(3997);
  });

  it('should re-export all required functions', () => {
    expect(typeof leafExecutor.buildNodePrompt).toBe('function');
    expect(typeof leafExecutor.buildReviewPrompt).toBe('function');
    expect(typeof leafExecutor.buildVerifyPrompt).toBe('function');
    expect(typeof leafExecutor.parseVerdict).toBe('function');
    expect(typeof leafExecutor.parseVerifyGate).toBe('function');
    expect(typeof leafExecutor.parseSizeManifest).toBe('function');
    expect(typeof leafExecutor.joinReviewReports).toBe('function');
    expect(typeof leafExecutor.isCacheableBaseGateStatus).toBe('function');
    expect(typeof leafExecutor.resolveBaseGreen).toBe('function');
    expect(typeof leafExecutor.escalateLegacyGateResidual).toBe('function');
    expect(typeof leafExecutor.formatGateErrorReason).toBe('function');
  });
});
