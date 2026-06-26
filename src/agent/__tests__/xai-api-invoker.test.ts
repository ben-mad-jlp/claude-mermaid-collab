import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  assertXaiApiAuth,
  resolveXaiApiAuthMode,
  _resetXaiApiAuthCache,
  invokeXaiApiNode,
  DEFAULT_XAI_API_MODEL,
} from '../xai-api-invoker';

const ORIG = process.env.XAI_API_KEY;

describe('xai-api-invoker auth', () => {
  beforeEach(() => { _resetXaiApiAuthCache(); });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = ORIG;
    _resetXaiApiAuthCache();
  });

  it('resolves api when XAI_API_KEY present', () => {
    process.env.XAI_API_KEY = 'x'.repeat(40);
    expect(resolveXaiApiAuthMode()).toBe('api');
    expect(assertXaiApiAuth()).toBe('api');
  });

  it('resolves unknown + throws when key missing', () => {
    delete process.env.XAI_API_KEY;
    _resetXaiApiAuthCache();
    expect(resolveXaiApiAuthMode()).toBe('unknown');
    expect(() => assertXaiApiAuth()).toThrow(/XAI_API_KEY/);
  });

  it('treats empty/whitespace key as unknown', () => {
    process.env.XAI_API_KEY = '   ';
    _resetXaiApiAuthCache();
    expect(resolveXaiApiAuthMode()).toBe('unknown');
  });

  it('invokeXaiApiNode fails closed (no API call) when unauthenticated', async () => {
    delete process.env.XAI_API_KEY;
    _resetXaiApiAuthCache();
    const res = await invokeXaiApiNode({ prompt: 'review', cwd: process.cwd() });
    expect(res.ok).toBe(false);
    expect(res.authMode).toBe('unknown');
    expect(res.parseError).toMatch(/XAI_API_KEY/);
    expect(res.exitCode).toBe(-1);
  });

  it('default model is the flagship reasoner', () => {
    expect(DEFAULT_XAI_API_MODEL).toBe('grok-4.3');
  });
});
