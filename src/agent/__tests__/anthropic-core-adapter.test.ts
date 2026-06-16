import { describe, it, expect } from 'vitest';
import { AnthropicOwnHarness } from '../adapters/grok-own';
import { resolveAnthropicCoreAgent, checkAnthropicCoreConformance } from '../registry';

describe('in-process Anthropic worker (AnthropicOwnHarness)', () => {
  it('is a distinct WorkerAgent with provider id "claude"', () => {
    expect(AnthropicOwnHarness.id).toBe('claude');
  });

  it('passes the same conformance suite as grok (shared detectors)', () => {
    expect(checkAnthropicCoreConformance()).toEqual([]);
  });

  it('resolveAnthropicCoreAgent returns the in-process claude harness (conformance-gated)', () => {
    const a = resolveAnthropicCoreAgent();
    expect(a.id).toBe('claude');
    expect(a).toBe(AnthropicOwnHarness);
  });
});
