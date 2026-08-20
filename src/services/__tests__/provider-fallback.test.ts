import { describe, it, expect } from 'bun:test';
import { classifyProviderFallback, classifyTransientReviewFailure } from '../provider-fallback';

describe('classifyProviderFallback', () => {
  it('1. grok-build auth-refusal HALT text is eligible with a grok-auth-refusal reason', () => {
    // Verbatim from src/agent/node-invoker.ts invokeGrokNode auth halt.
    const halt =
      `grok: HALT: node refused — active auth is 'unknown', not grok OIDC. ` +
      `Run 'grok login' and ensure grok is on PATH (or set GROK_BIN).`;
    const decision = classifyProviderFallback('grok-build', {
      ok: false,
      exitCode: -1,
      text: undefined,
      parseError: halt,
      authMode: 'unknown',
    });
    expect(decision.eligible).toBe(true);
    expect(decision.reason).not.toBeNull();
    expect(decision.reason!.startsWith('grok-auth-refusal: ')).toBe(true);
    expect(decision.reason!).toContain('HALT: node refused');
  });

  it('2. grok-api XAI_API_KEY HALT is eligible', () => {
    // Production parseError is xaiParseError-wrapped (xai: prefix) around the
    // literal from src/agent/xai-api-invoker.ts — regex still matches HALT body.
    const halt =
      'xai: HALT: node refused — XAI_API_KEY missing/empty (expected api.x.ai key).';
    const decision = classifyProviderFallback('grok-api', {
      ok: false,
      exitCode: -1,
      text: undefined,
      parseError: halt,
      authMode: 'unknown',
    });
    expect(decision.eligible).toBe(true);
    expect(decision.reason).not.toBeNull();
    expect(decision.reason!.startsWith('grok-auth-refusal: ')).toBe(true);
    expect(decision.reason!).toContain('XAI_API_KEY missing/empty');
  });

  it('3. grok-build empty text is eligible with a grok-empty-text reason', () => {
    const decision = classifyProviderFallback('grok-build', {
      ok: false,
      exitCode: 1,
      text: '',
      parseError: undefined,
      authMode: 'grok',
    });
    expect(decision.eligible).toBe(true);
    expect(decision.reason).toBe('grok-empty-text: node returned no text (exitCode=1)');
  });

  it('4. grok-build node with real text and ok=true is not eligible', () => {
    const decision = classifyProviderFallback('grok-build', {
      ok: true,
      exitCode: 0,
      text: 'implemented the change',
      parseError: undefined,
      authMode: 'grok',
    });
    expect(decision).toEqual({ eligible: false, reason: null });
  });

  it('5. claude provider with empty text is not eligible', () => {
    // Identical shape to case 3 except provider — proves rule 1 dominates rule 3.
    const decision = classifyProviderFallback('claude', {
      ok: false,
      exitCode: 1,
      text: '',
      parseError: undefined,
      authMode: 'subscription',
    });
    expect(decision).toEqual({ eligible: false, reason: null });
  });
});

describe('classifyTransientReviewFailure', () => {
  it('1. grok-api parseError containing resource-exhausted is transient', () => {
    const decision = classifyTransientReviewFailure('grok-api', {
      ok: false,
      exitCode: -1,
      text: undefined,
      parseError: 'xai: RESOURCE_EXHAUSTED: quota exceeded',
      timedOut: false,
      startFailure: undefined,
    });
    expect(decision.transient).toBe(true);
    expect(decision.reason).not.toBeNull();
    expect(decision.reason!.startsWith('grok-transient-review: resource-exhausted: ')).toBe(true);
  });

  it('2. grok-api rate limit exceeded text is transient', () => {
    const decision = classifyTransientReviewFailure('grok-api', {
      ok: false,
      exitCode: -1,
      text: 'error: rate limit exceeded, please retry later',
      parseError: undefined,
      timedOut: false,
      startFailure: undefined,
    });
    expect(decision.transient).toBe(true);
    expect(decision.reason).not.toBeNull();
    expect(decision.reason!.startsWith('grok-transient-review: rate-limit: ')).toBe(true);
  });

  it('3. grok-api timedOut true is transient with a node-timeout reason', () => {
    const decision = classifyTransientReviewFailure('grok-api', {
      ok: false,
      exitCode: -1,
      text: undefined,
      parseError: undefined,
      timedOut: true,
      startFailure: undefined,
    });
    expect(decision.transient).toBe(true);
    expect(decision.reason).toBe('grok-transient-review: node-timeout: ');
  });

  it('4. grok-api ordinary review verdict text is not transient', () => {
    const decision = classifyTransientReviewFailure('grok-api', {
      ok: true,
      exitCode: 0,
      text: 'VERDICT: MET — the change satisfies the criterion.',
      parseError: undefined,
      timedOut: false,
      startFailure: undefined,
    });
    expect(decision).toEqual({ transient: false, reason: null });
  });

  it('5. claude provider carrying resource-exhausted is not transient', () => {
    // Identical shape to case 1 except provider — proves rule 1 dominates rule 3.
    const decision = classifyTransientReviewFailure('claude', {
      ok: false,
      exitCode: -1,
      text: undefined,
      parseError: 'xai: RESOURCE_EXHAUSTED: quota exceeded',
      timedOut: false,
      startFailure: undefined,
    });
    expect(decision).toEqual({ transient: false, reason: null });
  });
});
