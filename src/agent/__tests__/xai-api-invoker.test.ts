import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertXaiApiAuth,
  resolveXaiApiAuthMode,
  _resetXaiApiAuthCache,
  invokeXaiApiNode,
  DEFAULT_XAI_API_MODEL,
} from '../xai-api-invoker';
import { _resetConfigCache } from '../../services/config-service';

const ORIG = process.env.XAI_API_KEY;
const ORIG_CONFIG_PATH = process.env.MERMAID_CONFIG_PATH;

describe('xai-api-invoker auth', () => {
  let tmpDir: string;

  beforeEach(() => {
    // resolveXaiApiAuthMode now reads getSecret('XAI_API_KEY') (config.json-first,
    // env fallback) — point MERMAID_CONFIG_PATH at an empty temp dir so these tests
    // exercise the env-fallback path in isolation from the real ~/.mermaid-collab/config.json.
    tmpDir = mkdtempSync(join(tmpdir(), 'xai-api-invoker-test-'));
    process.env.MERMAID_CONFIG_PATH = join(tmpDir, 'config.json');
    _resetConfigCache();
    _resetXaiApiAuthCache();
  });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = ORIG;
    if (ORIG_CONFIG_PATH === undefined) delete process.env.MERMAID_CONFIG_PATH;
    else process.env.MERMAID_CONFIG_PATH = ORIG_CONFIG_PATH;
    _resetConfigCache();
    _resetXaiApiAuthCache();
    rmSync(tmpDir, { recursive: true, force: true });
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
