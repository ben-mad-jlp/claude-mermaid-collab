import type { NodeProvider } from './node-provider';
import type { NodeResult } from '../agent/node-invoker';

export type ProviderFallbackDecision = { eligible: boolean; reason: string | null };

/** Shared match for grok auth-refusal HALTs emitted on parseError/text. */
const HALT_REFUSED_RE = /HALT: node refused/;

type FallbackResult = Pick<NodeResult, 'ok' | 'exitCode' | 'text' | 'parseError' | 'authMode'>;

/**
 * Pure classifier: whether a grok node result is eligible for provider fallback.
 * Rule order is load-bearing — evaluate top-down and return on first match.
 */
export function classifyProviderFallback(
  provider: NodeProvider,
  res: FallbackResult,
): ProviderFallbackDecision {
  // 1. Claude is never a second-hop candidate.
  if (provider === 'claude') {
    return { eligible: false, reason: null };
  }

  // 2. Grok auth-refusal HALT on parseError or text.
  if (provider === 'grok-build' || provider === 'grok-api') {
    const parseError = res.parseError ?? '';
    const text = res.text ?? '';
    const halt =
      HALT_REFUSED_RE.test(parseError) ? parseError
      : HALT_REFUSED_RE.test(text) ? text
      : null;
    if (halt != null) {
      return { eligible: true, reason: 'grok-auth-refusal: ' + halt.slice(0, 200) };
    }
  }

  // 3. Grok node returned no usable text.
  if (
    (provider === 'grok-build' || provider === 'grok-api') &&
    (res.text == null || res.text.trim() === '')
  ) {
    return {
      eligible: true,
      reason: `grok-empty-text: node returned no text (exitCode=${res.exitCode})`,
    };
  }

  // 4. Otherwise not eligible.
  return { eligible: false, reason: null };
}

export type TransientReviewDetail = 'resource-exhausted' | 'rate-limit' | 'node-timeout';

export type TransientReviewDecision = { transient: boolean; reason: string | null };

type TransientResult = Pick<
  NodeResult,
  'ok' | 'exitCode' | 'text' | 'parseError' | 'timedOut' | 'startFailure'
>;

/** Matcher table for TransientReviewDetail tokens — evaluated in declaration order. */
const TRANSIENT_REVIEW_MATCHERS: Array<[TransientReviewDetail, RegExp]> = [
  ['resource-exhausted', /resource[-_ ]?exhausted/i],
  ['rate-limit', /rate[-_ ]?limit|too many requests|\b429\b/i],
  ['node-timeout', /node[-_ ]?time[d]?[-_ ]?out/i],
];

/**
 * Pure classifier: whether a grok-api/grok-build review failure is transient (worth
 * re-dispatching) rather than a real review-vacuous verdict.
 * Rule order is load-bearing — evaluate top-down and return on first match.
 */
export function classifyTransientReviewFailure(
  provider: NodeProvider,
  res: TransientResult,
): TransientReviewDecision {
  // 1. Claude is never transient, even if its text happens to carry a matched token.
  if (provider === 'claude') {
    return { transient: false, reason: null };
  }

  // 2. A successful result with usable text is a real verdict, not a transient failure.
  if (res.ok === true && (res.text ?? '').trim() !== '') {
    return { transient: false, reason: null };
  }

  // 3. Grok node: classify by timeout or matched token in the failure detail.
  if (provider === 'grok-api' || provider === 'grok-build') {
    const detail = res.parseError ?? res.startFailure?.detail ?? res.text ?? '';
    if (res.timedOut === true) {
      return {
        transient: true,
        reason: `grok-transient-review: node-timeout: ${detail.slice(0, 200)}`,
      };
    }
    for (const [token, re] of TRANSIENT_REVIEW_MATCHERS) {
      if (re.test(detail)) {
        return {
          transient: true,
          reason: `grok-transient-review: ${token}: ${detail.slice(0, 200)}`,
        };
      }
    }
  }

  // 4. Fallthrough — not transient.
  return { transient: false, reason: null };
}
