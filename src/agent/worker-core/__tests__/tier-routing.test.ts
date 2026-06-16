import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCoordinatorWorkerDeps } from '../coordinator-bridge';
import { _resetConfigCache } from '../../../services/config-service';

const TIER_KEYS = [
  'WORKER_PROVIDER_SIZEGATE', 'WORKER_PROVIDER_RESEARCH', 'WORKER_PROVIDER_IMPLEMENT',
  'WORKER_PROVIDER_VERIFY', 'WORKER_PROVIDER_REVIEW',
  'WORKER_MODEL_SIZEGATE', 'WORKER_MODEL_RESEARCH', 'WORKER_MODEL_IMPLEMENT',
  'WORKER_MODEL_VERIFY', 'WORKER_MODEL_REVIEW',
];

function clearTierEnv() {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.XAI_API_KEY;
  for (const k of TIER_KEYS) delete process.env[k];
}

beforeEach(() => {
  // Empty config layer so a real configured key can't leak into these tests.
  process.env.MERMAID_CONFIG_PATH = '/tmp/__wc_test_empty_config__.json';
  clearTierEnv();
  _resetConfigCache();
});
afterEach(() => {
  delete process.env.MERMAID_CONFIG_PATH;
  clearTierEnv();
  _resetConfigCache();
});

const modelId = (m: unknown) => (m as { modelId?: string }).modelId;

describe('coordinator-bridge tier routing', () => {
  it('routes JUDGMENT phases → claude and IMPLEMENT → grok when a key is configured', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    _resetConfigCache();
    const deps = makeCoordinatorWorkerDeps('/p', 'todo1', { provider: 'grok-build' });
    expect(modelId(deps.resolveModel('research'))).toBe('claude-sonnet-4-6');
    expect(modelId(deps.resolveModel('verify'))).toBe('claude-sonnet-4-6');
    expect(modelId(deps.resolveModel('review'))).toBe('claude-sonnet-4-6');
    expect(modelId(deps.resolveModel('implement'))).toBe('grok-build-0.1'); // cheap volume stays grok
  });

  it('falls back to the base provider for ALL phases when no key (never hard-fails)', () => {
    delete process.env.ANTHROPIC_API_KEY;
    _resetConfigCache();
    const deps = makeCoordinatorWorkerDeps('/p', 'todo1', { provider: 'grok-build' });
    expect(modelId(deps.resolveModel('research'))).toBe('grok-build-0.1');
    expect(modelId(deps.resolveModel('verify'))).toBe('grok-build-0.1');
    expect(modelId(deps.resolveModel('implement'))).toBe('grok-build-0.1');
  });

  // The tier fix: a CLAUDE-pinned run must NOT burn claude on bulk implementation —
  // implement routes to the cheap grok-build regardless of the pin, while judgment
  // phases stay on claude.
  it('claude-pinned run: judgment → claude, implement → grok (pin does not win implement)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.XAI_API_KEY = 'xai-test';
    _resetConfigCache();
    const deps = makeCoordinatorWorkerDeps('/p', 'todo1', { provider: 'claude' });
    expect(modelId(deps.resolveModel('research'))).toBe('claude-sonnet-4-6');
    expect(modelId(deps.resolveModel('review'))).toBe('claude-sonnet-4-6');
    expect(modelId(deps.resolveModel('implement'))).toBe('grok-build-0.1'); // NOT claude
  });

  it('claude-pinned run with NO xai key: implement falls back to the base (claude)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    delete process.env.XAI_API_KEY; // grok not configured → implement falls back to base
    _resetConfigCache();
    const deps = makeCoordinatorWorkerDeps('/p', 'todo1', { provider: 'claude' });
    expect(modelId(deps.resolveModel('implement'))).toBe('claude-sonnet-4-6');
  });
});

describe('config-driven tier overrides (#3)', () => {
  it('WORKER_PROVIDER_<PHASE> override wins over the default tier when available', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.XAI_API_KEY = 'xai-test';
    // Override the default: run verify on grok, implement on claude (inverting the defaults).
    process.env.WORKER_PROVIDER_VERIFY = 'grok-build';
    process.env.WORKER_PROVIDER_IMPLEMENT = 'claude';
    _resetConfigCache();
    const deps = makeCoordinatorWorkerDeps('/p', 'todo1', { provider: 'grok-build' });
    expect(modelId(deps.resolveModel('verify'))).toBe('grok-build-0.1'); // was claude by default
    expect(modelId(deps.resolveModel('implement'))).toBe('claude-sonnet-4-6'); // was grok by default
    expect(modelId(deps.resolveModel('research'))).toBe('claude-sonnet-4-6'); // unset → default tier
  });

  it('WORKER_MODEL_<PHASE> pins the model on the overridden provider', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.WORKER_PROVIDER_REVIEW = 'claude';
    process.env.WORKER_MODEL_REVIEW = 'claude-opus-4-8';
    _resetConfigCache();
    const deps = makeCoordinatorWorkerDeps('/p', 'todo1', { provider: 'grok-build' });
    expect(modelId(deps.resolveModel('review'))).toBe('claude-opus-4-8');
  });

  it('an override whose provider has no key is ignored → default tier (never hard-fails)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.XAI_API_KEY = 'xai-test';
    process.env.WORKER_PROVIDER_IMPLEMENT = 'codex'; // unwired/keyless → ignored
    _resetConfigCache();
    const deps = makeCoordinatorWorkerDeps('/p', 'todo1', { provider: 'claude' });
    // Falls through to the default tier: implement → grok-build (NOT codex, NOT the base claude).
    expect(modelId(deps.resolveModel('implement'))).toBe('grok-build-0.1');
  });

  it('an unknown provider string in the override is ignored → default tier', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.XAI_API_KEY = 'xai-test';
    process.env.WORKER_PROVIDER_RESEARCH = 'gpt-9-ultra'; // not a known ProviderId
    _resetConfigCache();
    const deps = makeCoordinatorWorkerDeps('/p', 'todo1', { provider: 'grok-build' });
    expect(modelId(deps.resolveModel('research'))).toBe('claude-sonnet-4-6'); // default judgment tier
  });

  it('describeRoute surfaces provider + model + source (default vs override) for visibility', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.XAI_API_KEY = 'xai-test';
    process.env.WORKER_PROVIDER_REVIEW = 'claude';
    process.env.WORKER_MODEL_REVIEW = 'claude-opus-4-8';
    _resetConfigCache();
    const deps = makeCoordinatorWorkerDeps('/p', 'todo1', { provider: 'grok-build' });
    expect(deps.describeRoute!('implement')).toEqual({ provider: 'grok-build', model: 'grok-build-0.1', source: 'default' });
    expect(deps.describeRoute!('research')).toEqual({ provider: 'claude', model: 'claude-sonnet-4-6', source: 'default' });
    expect(deps.describeRoute!('review')).toEqual({ provider: 'claude', model: 'claude-opus-4-8', source: 'override' });
  });
});
