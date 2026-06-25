/**
 * Unit tests for the Grok headless node primitive (PR-1). Pure functions only.
 */
import { describe, it, expect } from 'bun:test';
import {
  buildGrokArgv,
  parseGrokOutput,
  authModeFromGrokStatus,
  resolveGrokBin,
  type NodeSpec,
} from '../node-invoker.ts';

const base: NodeSpec = { prompt: 'hello', cwd: '/tmp/worktree' };

describe('resolveGrokBin', () => {
  it('defaults to grok', () => {
    const prev = process.env.GROK_BIN;
    delete process.env.GROK_BIN;
    expect(resolveGrokBin()).toBe('grok');
    if (prev) process.env.GROK_BIN = prev;
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
    expect(argv).toEqual(expect.arrayContaining(['-m', 'grok-build-0.1']));
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

  it('parses streaming-json terminal line from end', () => {
    const transcript = [
      JSON.stringify({ type: 'thought', thought: 'thinking' }),
      JSON.stringify({ type: 'text', text: 'partial ' }),
      JSON.stringify({ type: 'text', text: 'answer' }),
      JSON.stringify({ text: 'answer', stopReason: 'EndTurn', sessionId: 's' }),
    ].join('\n');
    const p = parseGrokOutput(transcript);
    expect(p.stopReason).toBe('EndTurn');
    expect(p.text).toBe('answer');
  });

  it('extracts partial text from truncated stream', () => {
    const partial = [
      JSON.stringify({ type: 'text', text: 'work in ' }),
      JSON.stringify({ type: 'text', text: 'progress' }),
    ].join('\n');
    const p = parseGrokOutput(partial);
    expect(p.text).toBe('progress');
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