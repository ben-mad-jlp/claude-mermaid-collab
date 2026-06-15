import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveModel, DEFAULT_MODEL_BY_PROVIDER, anthropicAvailable } from '../resolve-model';
import { _resetConfigCache } from '../../../services/config-service';

beforeEach(() => {
  // Point the config layer at a nonexistent file so the real ~/.mermaid-collab/config.json
  // (which may hold a live ANTHROPIC_API_KEY) doesn't make these env-driven tests flaky.
  process.env.MERMAID_CONFIG_PATH = '/tmp/__wc_test_empty_config__.json';
  delete process.env.ANTHROPIC_API_KEY;
  _resetConfigCache();
});
afterEach(() => {
  delete process.env.MERMAID_CONFIG_PATH;
  delete process.env.ANTHROPIC_API_KEY;
  _resetConfigCache();
});

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

  it('claude: throws when no ANTHROPIC_API_KEY, resolves when present', () => {
    delete process.env.ANTHROPIC_API_KEY;
    _resetConfigCache();
    expect(anthropicAvailable()).toBe(false);
    expect(() => resolveModel('claude')).toThrow(/ANTHROPIC_API_KEY/);

    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    _resetConfigCache();
    expect(anthropicAvailable()).toBe(true);
    const m = resolveModel('claude');
    expect((m as { modelId?: string }).modelId).toBe('claude-sonnet-4-6');
  });

  it('codex stays an explicit not-wired stub', () => {
    expect(() => resolveModel('codex')).toThrow(/not wired in-process yet/);
  });

  it('exposes a sane default per provider', () => {
    expect(DEFAULT_MODEL_BY_PROVIDER['grok-build']).toBe('grok-build-0.1');
    expect(DEFAULT_MODEL_BY_PROVIDER.claude).toBe('claude-sonnet-4-6');
  });
});
