import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// CDP_PORT is evaluated at module load time, so each case resets the module
// registry and re-imports config with a fresh process.env.
describe('CDP_PORT config', () => {
  const original = process.env.CDP_PORT;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CDP_PORT;
    else process.env.CDP_PORT = original;
  });

  it('uses the CDP_PORT env var when set', async () => {
    process.env.CDP_PORT = '4444';
    const { CDP_PORT } = await import('../../config.js');
    expect(CDP_PORT).toBe(4444);
  });

  it('defaults to 9333 when CDP_PORT is unset', async () => {
    delete process.env.CDP_PORT;
    const { CDP_PORT } = await import('../../config.js');
    expect(CDP_PORT).toBe(9333);
  });

  it('falls back to 9333 when CDP_PORT is not a number', async () => {
    process.env.CDP_PORT = 'not-a-port';
    const { CDP_PORT } = await import('../../config.js');
    expect(CDP_PORT).toBe(9333);
  });
});
