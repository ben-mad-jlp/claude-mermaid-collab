/**
 * explore-request.ts — pure validator for explore node oracle requests.
 *
 * WHY THIS EXISTS. An explore request names a defect via an oracle — raw freeform prose. Before
 * dispatching the explore node to investigate, we MUST reject oracles that cannot possibly yield
 * actionable findings. Three tells fire independently and non-fatally: an oracle with no named
 * anchor (no symbol, file:line, or hash reference) is untargetable; one that only restates scope
 * and target tokens is circular; one with no falsifiable predicate (no assertion the node can
 * test) is purely descriptive. A well-formed oracle MUST have a symbol/reference, must add novel
 * content beyond scope/target, and must make a claim the node can measure. This validator catches
 * vacuous inputs before the explore node is spawned, so human or daemon can see why an oracle was
 * rejected before dispatch time.
 *
 * NEVER THROWS. All failures surface as return fields so callers can decide surfacing. Pure module,
 * no store or MCP imports, designed to be independently buildable and testable.
 */

/**
 * Closed union of vacuity warning codes. Each tells a distinct reason an oracle may be too vague.
 */
export type ExploreVacuityCode = 'no-named-anchor' | 'oracle-subsumed-by-scope' | 'no-falsifiable-predicate';

/**
 * Closed set of English stopwords excluded from token-based subset tests.
 * Kept small and explicit; extended only if a test fixture needs a specific word.
 */
export const EXPLORE_STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'of', 'and', 'it', 'is', 'should', 'when', 'then', 'that',
  'for', 'with', 'this', 'be', 'to', 'in', 'on', 'an', 'will', 'must',
]);

/** Input to the validator: oracle is required, scope and target are optional context. */
export interface ExploreRequestInput {
  oracle: string;
  scope?: string;
  target?: string;
}

/** A single vacuity warning with its code and human-readable detail. */
export interface ExploreVacuityWarning {
  code: ExploreVacuityCode;
  detail: string;
}

/** Result of validation: a refusal string (if oracle is invalid) and zero or more warnings. */
export interface ExploreValidationResult {
  refusal: string | null;
  warnings: ExploreVacuityWarning[];
}

/**
 * Tokenize by lowercasing, splitting on non-alphanumeric characters, and filtering empty strings.
 * Used consistently for all three tells and the stopword subset test.
 */
function tokenize(text: string | undefined): string[] {
  if (!text) return [];
  return text.toLowerCase().split(/[^a-z0-9_.]+/).filter(t => t.length > 0);
}

/**
 * Check for identifier-shaped tokens: dotted notation (a.b.c), camelCase (myVar), or snake_case (my_var).
 * Also matches path:line format (any/path/file:123) and hash/golden references.
 */
function hasNamedAnchor(oracle: string): boolean {
  const lower = oracle.toLowerCase();

  // Check for dotted notation: word.word or word.word.word, etc.
  if (/[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)+/i.test(oracle)) {
    return true;
  }

  // Check for camelCase: lowercase followed by uppercase letter.
  if (/[a-z]+[A-Z][a-zA-Z0-9]*/.test(oracle)) {
    return true;
  }

  // Check for snake_case: lowercase/digit, underscore, lowercase/digit.
  if (/[a-z0-9]+_[a-z0-9_]+/i.test(oracle)) {
    return true;
  }

  // Check for path:line format (any non-whitespace containing / or \ or . followed by : and digits).
  if (/\S+[\\/\.]\S*:\d+/.test(oracle)) {
    return true;
  }

  // Check for hash/golden references: 7+ hex chars or the literal word 'golden'.
  if (/\bgolden\b/i.test(lower) || /\b[0-9a-f]{7,}\b/i.test(oracle)) {
    return true;
  }

  return false;
}

/**
 * Check if oracle's non-stopword tokens are entirely contained in scope+target.
 * Fires when oracle adds no novel tokens beyond the surface it references.
 */
function isSubsumedByScope(oracle: string, scope: string | undefined, target: string | undefined): boolean {
  const oracleTokens = tokenize(oracle).filter(t => !EXPLORE_STOPWORDS.has(t) && !/^\d+$/.test(t));
  if (oracleTokens.length === 0) {
    return false; // Empty oracle is a different failure (refusal); don't fire this tell.
  }

  const surfaceTokens = new Set([
    ...tokenize(scope),
    ...tokenize(target),
  ]);

  return oracleTokens.every(t => surfaceTokens.has(t));
}

/**
 * Closed lexicon of predicate words. Oracle must contain at least one to express a falsifiable claim.
 * Substring match, not token match, to catch multi-word phrases like "at most" and "no more than".
 */
const PREDICATE_LEXICON = [
  'must', 'never', 'always', 'equals', 'equal', 'identical',
  'monotonic', 'idempotent', 'at most', 'no more than', 'within',
];

/**
 * Check if oracle contains none of the predicate lexicon words (substring match, lowercased).
 * Fires when oracle is purely descriptive, not an assertion.
 */
function hasNoFalsifiablePredicate(oracle: string): boolean {
  const lower = oracle.toLowerCase();
  return !PREDICATE_LEXICON.some(pred => lower.includes(pred));
}

/**
 * Validate an explore request oracle. Returns a refusal reason if the oracle is absent/empty,
 * or a list of zero or more vacuity warnings if the oracle is syntactically present.
 * Never throws; all errors are returned as fields.
 */
export function validateExploreRequest(input: ExploreRequestInput): ExploreValidationResult {
  // Refusal: oracle is required and cannot be empty/whitespace.
  const oracle = input.oracle ?? '';
  if (oracle.trim() === '') {
    return {
      refusal: 'oracle is required and cannot be empty',
      warnings: [],
    };
  }

  // All three tells fire independently if oracle is syntactically present.
  const warnings: ExploreVacuityWarning[] = [];

  if (!hasNamedAnchor(oracle)) {
    warnings.push({
      code: 'no-named-anchor',
      detail: 'oracle contains no identifier, path:line, or hash/golden reference',
    });
  }

  if (isSubsumedByScope(oracle, input.scope, input.target)) {
    warnings.push({
      code: 'oracle-subsumed-by-scope',
      detail: 'oracle only restates tokens already present in scope and target',
    });
  }

  if (hasNoFalsifiablePredicate(oracle)) {
    warnings.push({
      code: 'no-falsifiable-predicate',
      detail: 'oracle contains no predicate lexicon word (must, never, always, equals, identical, monotonic, idempotent, at most, no more than, within)',
    });
  }

  return {
    refusal: null,
    warnings,
  };
}
