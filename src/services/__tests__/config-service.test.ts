import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getConfig, getSecret, _resetConfigCache, resolveTriageRoute } from '../config-service';

let tmpDir: string;
let configFile: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'config-service-test-'));
  configFile = join(tmpDir, 'config.json');
  process.env.MERMAID_CONFIG_PATH = configFile;
  _resetConfigCache();
});

afterEach(() => {
  delete process.env.MERMAID_CONFIG_PATH;
  _resetConfigCache();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('config-service', () => {
  test('env wins over file value', () => {
    writeFileSync(configFile, JSON.stringify({ FOO: 'fileval' }));
    _resetConfigCache();
    process.env.FOO = 'envval';
    try {
      expect(getConfig('FOO')).toBe('envval');
    } finally {
      delete process.env.FOO;
    }
  });

  test('file fallback when env unset', () => {
    writeFileSync(configFile, JSON.stringify({ BAR: 'fileval' }));
    _resetConfigCache();
    expect(getConfig('BAR')).toBe('fileval');
  });

  test('absent everywhere returns undefined', () => {
    writeFileSync(configFile, JSON.stringify({}));
    _resetConfigCache();
    expect(getConfig('NOPE')).toBeUndefined();
  });

  test('absent everywhere returns fallback', () => {
    writeFileSync(configFile, JSON.stringify({}));
    _resetConfigCache();
    expect(getConfig('NOPE', 'fb')).toBe('fb');
  });

  test('malformed JSON does not throw and returns fallback', () => {
    writeFileSync(configFile, 'not json {{{');
    _resetConfigCache();
    expect(() => getConfig('X', 'fb')).not.toThrow();
    expect(getConfig('X', 'fb')).toBe('fb');
  });

  test('empty-string env falls through to file value', () => {
    writeFileSync(configFile, JSON.stringify({ BAZ: 'fileval' }));
    _resetConfigCache();
    process.env.BAZ = '';
    try {
      expect(getConfig('BAZ')).toBe('fileval');
    } finally {
      delete process.env.BAZ;
    }
  });

  test('non-string file value is ignored and returns fallback', () => {
    writeFileSync(configFile, JSON.stringify({ NUM: 5 }));
    _resetConfigCache();
    expect(getConfig('NUM', 'fb')).toBe('fb');
  });
});

describe('config-service getSecret (config-first, env fallback)', () => {
  test('config.json value wins over a STALE ambient env (the bug)', () => {
    // The Settings UI wrote the good key to config.json; a stale env var of the
    // same name was inherited via the hook respawn. getSecret must prefer config.
    writeFileSync(configFile, JSON.stringify({ XAI_API_KEY: 'good-from-settings' }));
    _resetConfigCache();
    process.env.XAI_API_KEY = 'stale-from-env';
    try {
      expect(getSecret('XAI_API_KEY')).toBe('good-from-settings');
    } finally {
      delete process.env.XAI_API_KEY;
    }
  });

  test('falls back to env when config.json has no value', () => {
    writeFileSync(configFile, JSON.stringify({}));
    _resetConfigCache();
    process.env.SECRET_ONLY_IN_ENV = 'envval';
    try {
      expect(getSecret('SECRET_ONLY_IN_ENV')).toBe('envval');
    } finally {
      delete process.env.SECRET_ONLY_IN_ENV;
    }
  });

  test('empty-string config value falls through to env', () => {
    writeFileSync(configFile, JSON.stringify({ K: '' }));
    _resetConfigCache();
    process.env.K = 'envval';
    try {
      expect(getSecret('K')).toBe('envval');
    } finally {
      delete process.env.K;
    }
  });

  test('absent everywhere returns fallback', () => {
    writeFileSync(configFile, JSON.stringify({}));
    _resetConfigCache();
    expect(getSecret('NOPE', 'fb')).toBe('fb');
    expect(getSecret('NOPE')).toBeUndefined();
  });

  test('non-string config value is ignored and falls through to env', () => {
    writeFileSync(configFile, JSON.stringify({ NUM: 5 }));
    _resetConfigCache();
    process.env.NUM = 'envval';
    try {
      expect(getSecret('NUM')).toBe('envval');
    } finally {
      delete process.env.NUM;
    }
  });
});

describe('resolveTriageRoute (triage tier-role, L4)', () => {
  afterEach(() => {
    delete process.env.WORKER_PROVIDER_TRIAGE;
    delete process.env.WORKER_MODEL_TRIAGE;
    delete process.env.JUDGMENT_PROVIDER;
    delete process.env.JUDGMENT_MODEL;
    _resetConfigCache();
  });

  test('no config → SUBSCRIPTION default (claude / sonnet, no API key)', () => {
    const r = resolveTriageRoute();
    expect(r.provider).toBe('claude');
    expect(r.model).toBe('sonnet');
    expect(r.apiKey).toBe('');
  });

  test('WORKER_PROVIDER_TRIAGE=claude → SUBSCRIPTION claude (not the anthropic API)', () => {
    process.env.WORKER_PROVIDER_TRIAGE = 'claude';
    _resetConfigCache();
    const r = resolveTriageRoute();
    expect(r.provider).toBe('claude');
    expect(r.model).toBe('sonnet');
    expect(r.apiKey).toBe('');
  });

  test('WORKER_PROVIDER_TRIAGE=anthropic still selects the keyed Anthropic API (explicit opt-in)', () => {
    process.env.WORKER_PROVIDER_TRIAGE = 'anthropic';
    _resetConfigCache();
    const r = resolveTriageRoute();
    expect(r.provider).toBe('anthropic');
    expect(r.model).toBe('claude-opus-4-8');
  });

  test('WORKER_PROVIDER_TRIAGE=claude + WORKER_MODEL_TRIAGE pin the model', () => {
    process.env.WORKER_PROVIDER_TRIAGE = 'claude';
    process.env.WORKER_MODEL_TRIAGE = 'opus';
    _resetConfigCache();
    const r = resolveTriageRoute();
    expect(r.provider).toBe('claude');
    expect(r.model).toBe('opus');
  });

  test('a provider with no defaultable model + no explicit model → falls through to the subscription default', () => {
    process.env.WORKER_PROVIDER_TRIAGE = 'codex'; // → openai, which has no default model
    _resetConfigCache();
    const r = resolveTriageRoute();
    expect(r.provider).toBe('claude'); // fell back to the flat (now subscription) default
  });

  test('explicit JUDGMENT_PROVIDER=xai still works (keyed opt-out of subscription)', () => {
    process.env.JUDGMENT_PROVIDER = 'xai';
    _resetConfigCache();
    const r = resolveTriageRoute();
    expect(r.provider).toBe('xai');
    expect(r.model).toBe('grok-build-0.1');
  });
});
