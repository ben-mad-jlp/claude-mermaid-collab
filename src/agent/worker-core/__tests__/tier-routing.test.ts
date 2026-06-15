import { describe, it, expect, afterEach } from 'vitest';
import { makeCoordinatorWorkerDeps } from '../coordinator-bridge';
import { _resetConfigCache } from '../../../services/config-service';

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
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
});
