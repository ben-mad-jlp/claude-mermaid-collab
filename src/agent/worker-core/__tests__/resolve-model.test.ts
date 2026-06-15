import { describe, it, expect } from 'vitest';
import { resolveModel, DEFAULT_MODEL_BY_PROVIDER } from '../resolve-model';

describe('resolveModel', () => {
  it('resolves grok-build to a LanguageModel with the default id', () => {
    const m = resolveModel('grok-build');
    expect(m).toBeDefined();
    expect((m as { modelId?: string }).modelId).toBe('grok-build-0.1');
  });

  it('honors an explicit model id', () => {
    const m = resolveModel('grok-build', 'grok-3-mini');
    expect((m as { modelId?: string }).modelId).toBe('grok-3-mini');
  });

  it('throws a clear not-wired error for claude and codex (SDKs not installed)', () => {
    expect(() => resolveModel('claude')).toThrow(/not wired in-process yet/);
    expect(() => resolveModel('codex')).toThrow(/not wired in-process yet/);
  });

  it('exposes a sane default per provider', () => {
    expect(DEFAULT_MODEL_BY_PROVIDER['grok-build']).toBe('grok-build-0.1');
    expect(DEFAULT_MODEL_BY_PROVIDER.claude).toBeTruthy();
  });
});
