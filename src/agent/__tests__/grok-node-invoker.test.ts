/**
 * Unit tests for the Grok headless node primitive (PR-1). Pure functions only.
 */
import { describe, it, expect } from 'bun:test';
import {
  buildGrokArgv,
  parseGrokOutput,
  authModeFromGrokStatus,
  resolveGrokBin,
  _resetGrokBinCache,
  type NodeSpec,
} from '../node-invoker.ts';
import { parseVerdict } from '../../services/leaf-executor.ts';

const base: NodeSpec = { prompt: 'hello', cwd: '/tmp/worktree' };

describe('resolveGrokBin', () => {
  it('honors GROK_BIN override verbatim', () => {
    const prev = process.env.GROK_BIN;
    process.env.GROK_BIN = '/custom/grok';
    _resetGrokBinCache();
    expect(resolveGrokBin()).toBe('/custom/grok');
    if (prev === undefined) delete process.env.GROK_BIN; else process.env.GROK_BIN = prev;
    _resetGrokBinCache();
  });
  it('resolves an ABSOLUTE path (or bare grok if no known install exists)', () => {
    const prev = process.env.GROK_BIN;
    delete process.env.GROK_BIN;
    _resetGrokBinCache();
    const bin = resolveGrokBin();
    // Either an absolute install path (GUI-app PATH-safe) or the bare fallback — never empty.
    expect(bin === 'grok' || bin.startsWith('/')).toBe(true);
    if (prev !== undefined) process.env.GROK_BIN = prev;
    _resetGrokBinCache();
  });
});

describe('buildGrokArgv', () => {
  it('includes headless grok flags and resolves cwd', () => {
    const promptFile = '/tmp/mermaid-node-abc/prompt.txt';
    const argv = buildGrokArgv(base, promptFile);
    expect(argv).toEqual(expect.arrayContaining([
      '--prompt-file', promptFile,
      '--output-format', 'json',
      '--permission-mode', 'bypassPermissions',
      '--cwd', '/tmp/worktree',
      '--no-plan', '--no-subagents', '--no-memory', '--disable-web-search',
    ]));
    expect(argv).not.toContain('hello');
  });

  it('uses streaming-json when transcriptPath is set', () => {
    const argv = buildGrokArgv({ ...base, transcriptPath: '/proj/.collab/t.jsonl' }, '/tmp/p.txt');
    expect(argv).toEqual(expect.arrayContaining(['--output-format', 'streaming-json']));
  });

  it('resolves grok model from stored value and kind hint', () => {
    const argv = buildGrokArgv(
      { ...base, model: 'grok-build', transcriptLabel: 'blueprint' },
      '/tmp/p.txt',
    );
    expect(argv).toEqual(expect.arrayContaining(['-m', 'grok-build']));
  });

  it('maps sonnet + wave label to composer default', () => {
    const argv = buildGrokArgv(
      { ...base, model: 'sonnet', transcriptLabel: 'wimplement:src/a.ts' },
      '/tmp/p.txt',
    );
    expect(argv).toEqual(expect.arrayContaining(['-m', 'grok-composer-2.5-fast']));
  });

  it('pushes optional effort, allowedTools, maxTurns', () => {
    const argv = buildGrokArgv(
      { ...base, effort: 'high', allowedTools: 'Read Edit', maxTurns: 40 },
      '/tmp/p.txt',
    );
    expect(argv).toEqual(expect.arrayContaining(['--effort', 'high']));
    expect(argv).toEqual(expect.arrayContaining(['--allowedTools', 'Read Edit']));
    expect(argv).toEqual(expect.arrayContaining(['--max-turns', '40']));
  });
});

describe('authModeFromGrokStatus', () => {
  it('returns grok for loggedIn auth status', () => {
    expect(authModeFromGrokStatus({ loggedIn: true })).toBe('grok');
  });

  it('returns grok for valid auth.json snapshot', () => {
    expect(authModeFromGrokStatus({ access_token: 'tok', expires_at: Date.now() + 60_000 })).toBe('grok');
  });

  it('returns unknown for expired token', () => {
    expect(authModeFromGrokStatus({ access_token: 'tok', expires_at: Date.now() - 1 })).toBe('unknown');
  });

  it('returns unknown on null', () => {
    expect(authModeFromGrokStatus(null)).toBe('unknown');
  });

  // The REAL ~/.grok/auth.json schema: token nested under an <issuer>::<client_id> key,
  // token field is `key`, expires_at is an ISO STRING. PR-1 mis-read this as 'unknown' and
  // halted every grok leaf on a logged-in machine.
  it('returns grok for the nested issuer-keyed OIDC auth.json (key + ISO expires_at, future)', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(authModeFromGrokStatus({
      'https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828': {
        key: 'oidc-token', refresh_token: 'r', expires_at: future, oidc_issuer: 'https://auth.x.ai',
      },
    })).toBe('grok');
  });

  it('returns unknown when the nested OIDC record is expired', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(authModeFromGrokStatus({
      'https://auth.x.ai::id': { key: 'oidc-token', expires_at: past },
    })).toBe('unknown');
  });

  it('nested record with no expiry but a token is valid', () => {
    expect(authModeFromGrokStatus({ 'https://auth.x.ai::id': { key: 'tok' } })).toBe('grok');
  });
});

describe('parseGrokOutput', () => {
  it('parses json EndTurn success', () => {
    const out = JSON.stringify({
      text: 'Done.',
      stopReason: 'EndTurn',
      sessionId: 'sess-1',
    });
    const p = parseGrokOutput(out);
    expect(p.stopReason).toBe('EndTurn');
    expect(p.text).toBe('Done.');
    expect(p.parseError).toBeUndefined();
  });

  it('parses Cancelled failure', () => {
    const p = parseGrokOutput(JSON.stringify({ text: '', stopReason: 'Cancelled' }));
    expect(p.stopReason).toBe('Cancelled');
  });

  it('assembles text from the REAL streaming-json: chunked type:"text" data + end terminal', () => {
    // Captured verbatim from `grok --output-format streaming-json`: the reply streams as
    // many {type:"text",data:"…"} chunks; the terminal {type:"end",stopReason} has NO text.
    const transcript = [
      JSON.stringify({ type: 'thought', data: 'The user wants ' }),
      JSON.stringify({ type: 'text', data: 'VER' }),
      JSON.stringify({ type: 'text', data: 'DI' }),
      JSON.stringify({ type: 'text', data: 'CT' }),
      JSON.stringify({ type: 'text', data: ':' }),
      JSON.stringify({ type: 'text', data: ' PASS' }),
      JSON.stringify({ type: 'end', stopReason: 'EndTurn', sessionId: 's', requestId: 'r' }),
    ].join('\n');
    const p = parseGrokOutput(transcript);
    expect(p.stopReason).toBe('EndTurn');
    expect(p.text).toBe('VERDICT: PASS'); // concatenated chunks, thought ignored
    expect(p.parseError).toBeUndefined();
    expect(parseVerdict(p.text)).toBe('pass'); // the verdict is now READABLE (the bug fix)
  });

  it('assembles partial text from a truncated stream (no terminal)', () => {
    const partial = [
      JSON.stringify({ type: 'text', data: 'work in ' }),
      JSON.stringify({ type: 'text', data: 'progress' }),
    ].join('\n');
    const p = parseGrokOutput(partial);
    expect(p.text).toBe('work in progress');
    expect(p.stopReason).toBeUndefined();
    expect(p.parseError).toBeUndefined();
  });

  it('returns parseError on empty stdout', () => {
    const p = parseGrokOutput('');
    expect(p.parseError).toMatch(/no parseable terminal/);
  });

  it('maps usage when present', () => {
    const p = parseGrokOutput(JSON.stringify({
      text: 'ok',
      stopReason: 'EndTurn',
      num_turns: 3,
      total_cost_usd: 0.05,
      usage: { input_tokens: 100, output_tokens: 50 },
    }));
    expect(p.usage?.numTurns).toBe(3);
    expect(p.usage?.costUsd).toBe(0.05);
    expect(p.usage?.inputTokens).toBe(100);
  });
});