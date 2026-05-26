import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// config.HOST / MERMAID_AUTH_TOKEN are evaluated at module load, so each case
// resets the module registry and re-imports with a fresh process.env.
describe('config bind host + auth token', () => {
  const orig = {
    MERMAID_BIND_HOST: process.env.MERMAID_BIND_HOST,
    HOST: process.env.HOST,
    MERMAID_AUTH_TOKEN: process.env.MERMAID_AUTH_TOKEN,
  };

  beforeEach(() => vi.resetModules());

  afterEach(() => {
    for (const k of ['MERMAID_BIND_HOST', 'HOST', 'MERMAID_AUTH_TOKEN'] as const) {
      if (orig[k] === undefined) delete process.env[k];
      else process.env[k] = orig[k];
    }
  });

  it('defaults HOST to 127.0.0.1 when neither MERMAID_BIND_HOST nor HOST is set', async () => {
    delete process.env.MERMAID_BIND_HOST;
    delete process.env.HOST;
    const { config } = await import('../config.js');
    expect(config.HOST).toBe('127.0.0.1');
  });

  it('uses HOST when MERMAID_BIND_HOST is unset', async () => {
    delete process.env.MERMAID_BIND_HOST;
    process.env.HOST = '0.0.0.0';
    const { config } = await import('../config.js');
    expect(config.HOST).toBe('0.0.0.0');
  });

  it('MERMAID_BIND_HOST overrides HOST', async () => {
    process.env.MERMAID_BIND_HOST = '192.168.1.5';
    process.env.HOST = '0.0.0.0';
    const { config } = await import('../config.js');
    expect(config.HOST).toBe('192.168.1.5');
  });

  it('MERMAID_AUTH_TOKEN defaults to empty string', async () => {
    delete process.env.MERMAID_AUTH_TOKEN;
    const { MERMAID_AUTH_TOKEN } = await import('../config.js');
    expect(MERMAID_AUTH_TOKEN).toBe('');
  });

  it('MERMAID_AUTH_TOKEN uses the env value when set', async () => {
    process.env.MERMAID_AUTH_TOKEN = 's3cret';
    const { MERMAID_AUTH_TOKEN } = await import('../config.js');
    expect(MERMAID_AUTH_TOKEN).toBe('s3cret');
  });
});
