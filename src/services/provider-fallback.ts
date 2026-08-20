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
