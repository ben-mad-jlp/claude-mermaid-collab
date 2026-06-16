/**
 * Unit tests for the headless node primitive (PAW P1). Pure functions only —
 * argv construction, json parse, authMode rule, rate-limit regex. No real spawn
 * (would burn quota); the invokeNode spawn path is covered by the manual test
 * plan in the blueprint §9.
 */
import { describe, it, expect } from 'bun:test';
import {
  buildNodeArgv,
  authModeFromStatus,
  parseNodeJson,
  RATE_LIMIT_RE,
  type NodeSpec,
} from '../node-invoker.ts';

const base: NodeSpec = { prompt: 'hello', cwd: '/tmp/x' };

describe('buildNodeArgv', () => {
  it('always headless json, no-session-persistence, bypassPermissions, never --bare', () => {
    const argv = buildNodeArgv(base);
    expect(argv[0]).toBe('claude');
    expect(argv).toContain('-p');
    expect(argv).toEqual(expect.arrayContaining(['--output-format', 'json']));
    expect(argv).toContain('--no-session-persistence');
    expect(argv).toEqual(expect.arrayContaining(['--permission-mode', 'bypassPermissions']));
    expect(argv).not.toContain('--bare');
    // Prompt is NOT a positional — it's fed via stdin (variadic-flag safety).
    expect(argv).not.toContain('hello');
  });

  it('pushes optional flags only when set', () => {
    const argv = buildNodeArgv({ ...base, model: 'sonnet', appendSystemPrompt: 'sys' });
    expect(argv).toEqual(expect.arrayContaining(['--model', 'sonnet']));
    expect(argv).toEqual(expect.arrayContaining(['--append-system-prompt', 'sys']));
    expect(buildNodeArgv({ ...base })).not.toContain('--model');
  });

  it('includes --allowedTools even when empty string (= no tools)', () => {
    const argv = buildNodeArgv({ ...base, allowedTools: '' });
    const i = argv.indexOf('--allowedTools');
    expect(i).toBeGreaterThan(-1);
    expect(argv[i + 1]).toBe('');
  });

  it('honors a permissionMode override', () => {
    const argv = buildNodeArgv({ ...base, permissionMode: 'acceptEdits' });
    expect(argv).toEqual(expect.arrayContaining(['--permission-mode', 'acceptEdits']));
  });
});

describe('authModeFromStatus', () => {
  it('subscription when claude.ai + firstParty + subscriptionType', () => {
    expect(
      authModeFromStatus({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max' }),
    ).toBe('subscription');
  });
  it('api when an api-key credential is reported', () => {
    expect(authModeFromStatus({ loggedIn: true, authMethod: 'apiKey', apiProvider: 'anthropic' })).toBe('api');
  });
  it('not subscription when subscriptionType missing', () => {
    expect(
      authModeFromStatus({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' }),
    ).not.toBe('subscription');
  });
  it('unknown on null / empty', () => {
    expect(authModeFromStatus(null)).toBe('unknown');
    expect(authModeFromStatus({})).toBe('unknown');
  });
});

describe('parseNodeJson', () => {
  it('extracts text, usage, num_turns, cost', () => {
    const out = JSON.stringify({
      result: 'OK',
      is_error: false,
      num_turns: 2,
      total_cost_usd: 0.01,
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const p = parseNodeJson(out);
    expect(p.text).toBe('OK');
    expect(p.isError).toBe(false);
    expect(p.usage?.numTurns).toBe(2);
    expect(p.usage?.costUsd).toBe(0.01);
    expect(p.usage?.inputTokens).toBe(10);
  });
  it('flags is_error', () => {
    expect(parseNodeJson(JSON.stringify({ result: 'x', is_error: true })).isError).toBe(true);
  });
  it('returns parseError + raw text on non-json', () => {
    const p = parseNodeJson('not json');
    expect(p.parseError).toBeDefined();
    expect(p.text).toBe('not json');
  });
  it('surfaces api_error_status (429 vs 500 vs null) — feeds rate-limit detection (4ec5a13c)', () => {
    expect(parseNodeJson(JSON.stringify({ is_error: true, api_error_status: 429 })).apiErrorStatus).toBe(429);
    expect(parseNodeJson(JSON.stringify({ is_error: true, api_error_status: 500 })).apiErrorStatus).toBe(500);
    // success: api_error_status null → undefined (NOT a rate limit)
    expect(parseNodeJson(JSON.stringify({ result: 'OK', is_error: false, api_error_status: null })).apiErrorStatus).toBeUndefined();
  });
});

describe('RATE_LIMIT_RE', () => {
  it('matches common limit signals', () => {
    for (const s of ['429 Too Many Requests', 'rate limit exceeded', 'usage limit reached', 'overloaded', 'quota']) {
      expect(RATE_LIMIT_RE.test(s)).toBe(true);
    }
  });
  it('does not match ordinary output', () => {
    expect(RATE_LIMIT_RE.test('OK done')).toBe(false);
  });
});
