/**
 * typed-filing-request.ts — pure validators for typed bugfix and feature filings.
 *
 * WHY THIS EXISTS. When a user files a bugfix or feature request, the filing must meet
 * specific structural requirements before it can be adopted as a bucket item. Bugfix filings
 * require an observed failure, evidence anchor, and a fixed-means predicate. Feature filings
 * require a user-visible outcome statement. This validator catches malformed inputs before
 * they are persisted.
 *
 * NEVER THROWS. All failures surface as return fields so callers can decide surfacing. Pure module,
 * no store or MCP imports, designed to be independently buildable and testable.
 *
 * FAIL-CLOSED semantics. Unlike explore validation (where vacuity tells are non-fatal warnings),
 * here every tell is a refusal — the filing is rejected outright.
 */

import { hasNamedAnchor } from './explore-request.js';

/**
 * Closed union of filing rejection codes. Each tells a distinct reason a filing is invalid.
 */
export type TypedFilingWarningCode =
  | 'missing-required-field'
  | 'no-failure-shape'
  | 'no-named-anchor'
  | 'no-falsifiable-predicate'
  | 'no-user-visible-outcome';

/**
 * A single validation failure with its code and human-readable detail.
 */
export interface TypedFilingWarning {
  code: TypedFilingWarningCode;
  detail: string;
}

/**
 * Result of validation: a refusal string (if filing is invalid) and zero or more warnings.
 * Mirrors ExploreValidationResult shape for consistency.
 */
export interface TypedFilingValidationResult {
  refusal: string | null;
  warnings: TypedFilingWarning[];
}

/**
 * Input to bugfix filing: observed failure, evidence, and what was fixed.
 */
export interface BugfixFilingInput {
  observedFailure: string;
  evidence: string;
  fixedMeans: string;
  title?: string;
  description?: string;
}

/**
 * Input to feature filing: what the user can now do or see.
 */
export interface FeatureFilingInput {
  outcome: string;
  title?: string;
  description?: string;
}

/**
 * Closed lexicon of failure-shape words. A bugfix must reference a concrete symptom.
 */
const FAILURE_SHAPE_LEXICON = [
  'error', 'fail', 'failed', 'fails', 'throw', 'throws', 'undefined',
  'null', 'crash', 'hang', 'timeout', 'exception', 'expected', 'actual',
  'instead of', 'nan', 'wrong', 'red',
];

/**
 * Closed lexicon of falsifiable predicates for fixedMeans. A fix must assert something measurable.
 */
const FIXED_MEANS_PREDICATES = [
  'must', 'never', 'always', 'equals', 'equal', 'identical', 'returns',
  'refuses', 'rejects', 'no longer', 'at most', 'no more than', 'within',
  'idempotent', 'monotonic',
];

/**
 * Closed lexicon of user-visible surfaces for feature outcomes.
 */
const SURFACE_LEXICON = [
  'operator', 'user', 'human', 'conductor', 'card', 'panel', 'screen',
  'page', 'view', 'dashboard', 'button', 'badge', 'list', 'report',
  'verb', 'tool', 'cli', 'api',
];

/**
 * Closed lexicon of user-visible action verbs for feature outcomes.
 */
const OUTCOME_VERB_LEXICON = [
  'sees', 'see', 'can', 'shows', 'displays', 'opens', 'lands', 'files',
  'returns', 'surfaces', 'lists', 'renders', 'receives', 'gets',
];

/**
 * Validate a bugfix filing. Returns a refusal if any required field is missing/empty,
 * or if any field fails its semantic check (failure shape, named anchor, predicate).
 * Never throws; all errors are returned as fields.
 */
export function validateBugfixFiling(input: BugfixFilingInput): TypedFilingValidationResult {
  // Check observedFailure: required, non-empty, and contains a failure-shaped term.
  const observedFailure = input.observedFailure ?? '';
  if (observedFailure.trim() === '') {
    return {
      refusal: 'missing-required-field: observedFailure is required and cannot be empty',
      warnings: [],
    };
  }

  const lower = observedFailure.toLowerCase();
  const hasFailureShape = FAILURE_SHAPE_LEXICON.some((word) => lower.includes(word));
  if (!hasFailureShape) {
    return {
      refusal:
        'no-failure-shape: observedFailure must describe a concrete symptom (error, fail, throw, crash, hang, timeout, etc.)',
      warnings: [],
    };
  }

  // Check evidence: required, non-empty, and contains a named anchor.
  const evidence = input.evidence ?? '';
  if (evidence.trim() === '') {
    return {
      refusal: 'missing-required-field: evidence is required and cannot be empty',
      warnings: [],
    };
  }

  if (!hasNamedAnchor(evidence)) {
    return {
      refusal:
        'no-named-anchor: evidence must contain an identifier, path:line, or hash/golden reference to ground the finding',
      warnings: [],
    };
  }

  // Check fixedMeans: required, non-empty, and contains a falsifiable predicate.
  const fixedMeans = input.fixedMeans ?? '';
  if (fixedMeans.trim() === '') {
    return {
      refusal: 'missing-required-field: fixedMeans is required and cannot be empty',
      warnings: [],
    };
  }

  const lowerMeans = fixedMeans.toLowerCase();
  const hasPredicate = FIXED_MEANS_PREDICATES.some((pred) => lowerMeans.includes(pred));
  if (!hasPredicate) {
    return {
      refusal:
        'no-falsifiable-predicate: fixedMeans must contain a measurable assertion (must, never, always, equals, identical, returns, etc.)',
      warnings: [],
    };
  }

  return {
    refusal: null,
    warnings: [],
  };
}

/**
 * Validate a feature filing. Returns a refusal if outcome is missing/empty, or if
 * it lacks both a user-visible subject AND a user-visible action verb.
 * Never throws; all errors are returned as fields.
 */
export function validateFeatureFiling(input: FeatureFilingInput): TypedFilingValidationResult {
  // Check outcome: required and non-empty.
  const outcome = input.outcome ?? '';
  if (outcome.trim() === '') {
    return {
      refusal: 'missing-required-field: outcome is required and cannot be empty',
      warnings: [],
    };
  }

  // Check for user-visible subject: either a named anchor OR a surface term.
  const lowerOutcome = outcome.toLowerCase();
  const hasAnchor = hasNamedAnchor(outcome);
  const hasSurface = SURFACE_LEXICON.some((surf) => lowerOutcome.includes(surf));
  const hasSubject = hasAnchor || hasSurface;

  // Check for user-visible action verb.
  const hasVerb = OUTCOME_VERB_LEXICON.some((verb) => lowerOutcome.includes(verb));

  if (!hasSubject || !hasVerb) {
    return {
      refusal:
        'no-user-visible-outcome: outcome must name a user-visible surface (operator, user, card, panel, screen, etc.) and an action (sees, shows, displays, lands, files, etc.)',
      warnings: [],
    };
  }

  return {
    refusal: null,
    warnings: [],
  };
}

/**
 * Error class thrown when bugfix filing validation fails.
 * Carries code 'bugfix-filing-refused' for HTTP surface wiring.
 */
export class BugfixFilingRefusedError extends Error {
  readonly code = 'bugfix-filing-refused';

  constructor(refusal: string) {
    super(`file_bugfix: ${refusal}`);
    this.name = 'BugfixFilingRefusedError';
  }
}

/**
 * Error class thrown when feature filing validation fails.
 * Carries code 'feature-filing-refused' for HTTP surface wiring.
 */
export class FeatureFilingRefusedError extends Error {
  readonly code = 'feature-filing-refused';

  constructor(refusal: string) {
    super(`file_feature: ${refusal}`);
    this.name = 'FeatureFilingRefusedError';
  }
}
