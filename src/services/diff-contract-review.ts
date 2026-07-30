/**
 * diffContractReview — the decision engine for a parsed DiffContract.
 *
 * Pure/I-O-light standalone leaf module: imports only types from ./diff-contract.
 * NOT wired into any pipeline yet.
 *
 * Runs five mechanical stages (stages 1–3, 5–6) over a base..HEAD diff,
 * emitting DiffContractVerdict entries (mechanical: true), and forwards
 * still-undecided observable/invariant requirements to the LLM ballot.
 */

import type {
  DiffContract,
  DiffContractVerdict,
  DiffRequirement,
  NamedTestRequirement,
  ThresholdRequirement,
} from './diff-contract';
import { parseBallotVerdicts, validateBallotGrounding } from './review-citations';

/** The parsed base..HEAD diff handed to the engine — the change-set file list. */
export interface ParsedDiff {
  /** Repo-relative paths changed base..HEAD (git diff --name-only). */
  changedFiles: string[];
}

/** Injected, I/O-light deps. testsFlipBaseToBranch reuses the leaf-executor.ts:3605 shape
 *  verbatim. readGateMetric/runGrepCount resolve a ThresholdRequirement.metric to a number
 *  (null ⇒ could-not-determine). No command/produce member exists — arbitrary shell is
 *  unrepresentable by construction. */
export interface DiffContractReviewDeps {
  cwd: string;
  baseSha?: string | null;
  testsFlipBaseToBranch: (input: {
    cwd: string; testFiles: string[]; baseSha?: string | null;
  }) => Promise<boolean | null>;
  /** source==='gate-output': read metric from the leaf's gate output → number|null. */
  readGateMetric: (metric: string) => Promise<number | null>;
  /** source==='grep-count': count matches for metric → number|null. */
  runGrepCount: (metric: string) => Promise<number | null>;
}

/** One undecided requirement forwarded to the closed LLM ballot, carrying its declared id. */
export interface BallotRequirement {
  id: string;
  kind: 'observable' | 'invariant';
  description: string;
}

/** The observable/invariant requirements of a contract — the closed LLM ballot's input, keyed by
 *  declared id. The SINGLE source of the ballot's membership: both {@link diffContractReview} (at
 *  grounding time) and the review-node prompt builder (at spawn time) derive the ballot from THIS
 *  filter, so what the reviewer is told to address is exactly what the grader will ground. symbol-
 *  present/named-test/threshold are decided mechanically and are NEVER balloted. */
export function contractBallotRequirements(contract: DiffContract): BallotRequirement[] {
  return contract.requirements
    .filter((r): r is Extract<DiffRequirement, { kind: 'observable' | 'invariant' }> =>
      r.kind === 'observable' || r.kind === 'invariant')
    .map((r) => ({ id: r.id, kind: r.kind, description: r.description }));
}

export interface DiffContractReviewResult {
  /** Mechanical-stage findings (mechanical:true), one entry per triggered breach / decided requirement. */
  verdicts: DiffContractVerdict[];
  /** ONLY the still-undecided observable/invariant requirements, keyed by declared id. */
  ballotInput: BallotRequirement[];
}

const normPath = (p: string): string => p.replace(/^\.\//, '').replace(/\\/g, '/').trim();

export async function diffContractReview(
  contract: DiffContract,
  diff: ParsedDiff,
  deps: DiffContractReviewDeps,
): Promise<DiffContractReviewResult> {
  const verdicts: DiffContractVerdict[] = [];
  const changed = new Set(diff.changedFiles.map(normPath));
  const declared = new Set([...contract.filesToCreate, ...contract.filesToEdit].map(normPath));
  const outOfScope = new Set(contract.outOfScope.map(normPath));

  // Stage 1 — SCOPE-BREACH: a diff file not in declared touchpoints.
  for (const f of changed) {
    if (!declared.has(f)) {
      verdicts.push({
        stage: 'scope-breach', subject: { kind: 'file', path: f },
        decision: 'breach', mechanical: true,
        reason: `changed file "${f}" is not in the declared filesToCreate/filesToEdit touchpoints`,
      });
    }
  }

  // Stage 2 — ABSENCE: a declared touchpoint file absent from the diff.
  for (const f of declared) {
    if (!changed.has(f)) {
      verdicts.push({
        stage: 'absence', subject: { kind: 'file', path: f },
        decision: 'unmet', mechanical: true,
        reason: `declared touchpoint "${f}" is absent from the base..HEAD diff`,
      });
    }
  }

  // Stage 3 — OUT-OF-SCOPE: a diff change touching a declared outOfScope entry.
  for (const f of changed) {
    if (outOfScope.has(f)) {
      verdicts.push({
        stage: 'out-of-scope', subject: { kind: 'file', path: f },
        decision: 'breach', mechanical: true,
        reason: `changed file "${f}" touches a declared outOfScope entry`,
      });
    }
  }

  // Stage 5 — named-test: decide each NamedTestRequirement via testsFlipBaseToBranch.
  // ONLY a positive true ⇒ met; false ⇒ unmet; null/throw ⇒ not-applicable. NEVER throws.
  for (const r of contract.requirements) {
    if (r.kind !== 'named-test') continue;
    let flipped: boolean | null;
    try {
      flipped = await deps.testsFlipBaseToBranch({
        cwd: deps.cwd, testFiles: [r.testFile], baseSha: deps.baseSha,
      });
    } catch {
      flipped = null;
    }
    const decision = flipped === true ? 'met' : flipped === false ? 'unmet' : 'not-applicable';
    verdicts.push({
      stage: 'named-test', subject: { kind: 'requirement', id: r.id },
      decision, mechanical: true,
      reason: flipped === true
        ? `test "${r.testName}" (${r.testFile}) flips base→branch`
        : flipped === false
          ? `test "${r.testName}" (${r.testFile}) does not flip base→branch`
          : `test "${r.testName}" (${r.testFile}) could not be determined`,
    });
  }

  // Stage 6 — threshold: decide each ThresholdRequirement via source 'gate-output'|'grep-count'.
  for (const r of contract.requirements) {
    if (r.kind !== 'threshold') continue;
    let actual: number | null;
    try {
      actual = r.source === 'gate-output'
        ? await deps.readGateMetric(r.metric)
        : await deps.runGrepCount(r.metric);
    } catch {
      actual = null;
    }
    if (actual === null) {
      verdicts.push({
        stage: 'threshold', subject: { kind: 'requirement', id: r.id },
        decision: 'not-applicable', mechanical: true,
        reason: `threshold metric "${r.metric}" (${r.source}) could not be determined`,
      });
      continue;
    }
    const ok = r.comparison === 'gte' ? actual >= r.value
      : r.comparison === 'lte' ? actual <= r.value
      : actual === r.value;
    verdicts.push({
      stage: 'threshold', subject: { kind: 'requirement', id: r.id },
      decision: ok ? 'met' : 'unmet', mechanical: true,
      reason: `${r.metric} (${r.source}) = ${actual} ${r.comparison} ${r.value} ⇒ ${ok ? 'met' : 'unmet'}`,
    });
  }

  // Ballot input — ONLY undecided observable/invariant requirements (symbol-present excluded:
  // it is the separate SOFT stage 4; named-test/threshold already decided above). Derived via the
  // shared filter so the reviewer's ballot instruction and this grader read the SAME membership.
  const ballotInput = contractBallotRequirements(contract);

  return { verdicts, ballotInput };
}

/** The status of a typed per-requirement-id grounding, shaped to slot in for the prose
 *  {@link import('./review-citations').ReviewGrounding} at the review-node call sites:
 *   'ok'      — no ballot verdict cites an undeclared id, every 'met' ballot verdict resolves a
 *               real citation, and every observable/invariant requirement the LLM was handed is
 *               addressed by a declared verdict.
 *   'vacuous' — the review cites a requirement id NOT in the declared contract (fabricated), a
 *               'met' verdict resolves no citation, OR the review omits a verdict for a ballot
 *               (observable/invariant) requirement it was handed — the typed analog of a vacuous
 *               prose PASS.
 *   'abstain' — the change-set was unreadable (null) — we cannot ground, so we do not pretend to
 *               (matches the prose gate's abstain: caller treats it as today's no-park behaviour). */
export interface ContractGroundingResult {
  status: 'ok' | 'vacuous' | 'abstain';
  reasons: string[];
  /** The mechanical-stage verdicts (mechanical:true) from {@link diffContractReview}. */
  verdicts: DiffContractVerdict[];
  /** The observable/invariant requirements forwarded to the LLM ballot. */
  ballotInput: BallotRequirement[];
}

/**
 * TYPED per-requirement-id grounding — the Phase-3 review-node substitute for the prose
 * `validateReviewGrounding`, gated ON only when a valid typed contract is present.
 *
 * It composes the two shipped-but-dormant primitives into one production path:
 *  1. {@link diffContractReview} runs the mechanical stages (deciding symbol-present/named-test/
 *     threshold WITHOUT the LLM) and forwards the still-undecided observable/invariant
 *     requirements as the closed ballot.
 *  2. {@link parseBallotVerdicts} extracts the reviewer's per-id verdicts from the review text and
 *     {@link validateBallotGrounding} grounds them against the DECLARED requirement ids: an
 *     undeclared/fabricated id ⇒ 'vacuous'; a 'met' verdict citing nothing that resolves ⇒
 *     'vacuous'.
 *  3. Finally, an observable/invariant ballot requirement the LLM did NOT address at all is an
 *     uncited gap ⇒ 'vacuous' (a typed vacuous PASS).
 *
 * FAIL-SAFE: a null change-set → 'abstain' (parity with the prose gate). Never throws — any dep
 * throw inside diffContractReview is already swallowed to 'not-applicable'.
 */
export async function groundReviewViaContract(
  reviewText: string,
  contract: DiffContract,
  diff: ParsedDiff | null,
  deps: DiffContractReviewDeps,
): Promise<ContractGroundingResult> {
  if (diff === null) {
    return { status: 'abstain', reasons: ['typed-review-grounding: change-set unreadable'], verdicts: [], ballotInput: [] };
  }
  const { verdicts, ballotInput } = await diffContractReview(contract, diff, deps);
  const declaredIds = contract.requirements.map((r) => r.id);
  const ballotVerdicts = parseBallotVerdicts(reviewText);

  // Closed-ballot grounding: reject fabricated ids and uncited 'met' verdicts (constraint 3bfda28e).
  const ballot = validateBallotGrounding(ballotVerdicts, declaredIds, diff.changedFiles);
  if (ballot.status !== 'ok') {
    return { status: ballot.status, reasons: ballot.reasons.map((r) => `typed-review-grounding: ${r}`), verdicts, ballotInput };
  }

  // Every observable/invariant requirement the LLM was handed must be ADDRESSED by a verdict.
  const addressed = new Set(ballotVerdicts.map((v) => v.id));
  const uncited = ballotInput.filter((r) => !addressed.has(r.id)).map((r) => r.id);
  if (uncited.length > 0) {
    return {
      status: 'vacuous',
      reasons: [`typed-review-grounding: review does not address observable/invariant requirement id(s): ${uncited.join(', ')}`],
      verdicts, ballotInput,
    };
  }

  return { status: 'ok', reasons: [], verdicts, ballotInput };
}
