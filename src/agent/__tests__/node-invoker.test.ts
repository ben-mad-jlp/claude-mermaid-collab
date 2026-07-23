/**
 * Unit tests for the headless node primitive (PAW P1). Pure functions only —
 * argv construction, json parse, authMode rule, rate-limit regex. No real spawn
 * (would burn quota); the invokeNode spawn path is covered by the manual test
 * plan in the blueprint §9.
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildNodeArgv,
  authModeFromStatus,
  parseNodeJson,
  RATE_LIMIT_RE,
  CONN_ERR_RE,
  parseCapReset,
  worktreeSpawnEnv,
  startWindowPlan,
  START_WINDOW_MS,
  resolveClaudeBin,
  _resetClaudeBinCache,
  invokeNode,
  classifyTransientFault,
  transientRetryAfterMs,
  AUTH_TRANSIENT_RE,
  STDIN_DELIVERY_RE,
  assertSubscriptionAuth,
  _resetAuthCache,
  _primeAuthCacheForTest,
  mcpConfigFor,
  invokeGrokNode,
  type NodeSpec,
} from '../node-invoker.ts';
import { invokeXaiApiNode } from '../xai-api-invoker.ts';
import { SETTING_SOURCES_ARGS } from '../contracts.ts';

const base: NodeSpec = { prompt: 'hello', cwd: '/tmp/x' };

describe('resolveClaudeBin', () => {
  it('resolves an ABSOLUTE path (or bare claude if no known install exists)', () => {
    _resetClaudeBinCache();
    const bin = resolveClaudeBin();
    expect(bin === 'claude' || bin.startsWith('/')).toBe(true);
    _resetClaudeBinCache();
  });
});

describe('invokeNode spawn retry (transient ENOENT)', () => {
  let originalSpawn: typeof Bun.spawn;
  let originalSpawnSync: typeof Bun.spawnSync;
  let spawnCallCount: number;
  const testCwd = '/tmp/node-invoker-test-retry';

  beforeEach(() => {
    spawnCallCount = 0;
    originalSpawn = Bun.spawn;
    originalSpawnSync = Bun.spawnSync;
    _resetAuthCache();
    // Create test cwd so existsSync check passes
    mkdirSync(testCwd, { recursive: true });
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
    Bun.spawnSync = originalSpawnSync;
    _resetAuthCache();
    // Clean up test directory
    try {
      rmSync(testCwd, { recursive: true, force: true });
    } catch { /* ok if cleanup fails */ }
  });

  it('retries exactly once on transient ENOENT before eventual success', async () => {
    // Pre-seed the auth cache: the auth probe is an ASYNC Bun.spawn now (crit-6), and
    // mocking Bun.spawn below would otherwise feed the probe the node mock.
    _primeAuthCacheForTest('subscription');

    // Mock Bun.spawn: throw ENOENT on first call, return working proc on retry
    (Bun as any).spawn = mock((argv: string[], opts: any) => {
      spawnCallCount++;
      if (spawnCallCount === 1) {
        throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
      }
      // On retry (second call), return a minimal mock proc that succeeds
      const stdout = new ReadableStream<Uint8Array>({
        start(c) {
          const result = JSON.stringify({ result: 'test success', is_error: false });
          c.enqueue(new TextEncoder().encode(result));
          c.close();
        },
      });
      const stderr = new ReadableStream<Uint8Array>({
        start(c) { c.close(); },
      });
      return {
        pid: 99999,
        stdout,
        stderr,
        exited: Promise.resolve(0),
        kill: () => {},
      } as any;
    });

    try {
      const spec: NodeSpec = { prompt: 'test prompt', cwd: testCwd };
      const result = await invokeNode(spec);

      // Verify spawn was called exactly twice (first threw ENOENT, second succeeded)
      expect(spawnCallCount).toBe(2);
      // Verify no spawn-failure message in the result
      if (result.parseError) {
        expect(result.parseError).not.toMatch(/spawn failed/);
      }
    } finally {
      (Bun as any).spawn = originalSpawn;
      (Bun as any).spawnSync = originalSpawnSync;
    }
  });
});

describe('classifyTransientFault (crits 8+9 — auth-refresh + stdin-delivery)', () => {
  it('auth: /login prompt in result text on a FAILED run → auth', () => {
    expect(
      classifyTransientFault({ exitCode: 1, isError: true, text: 'Not logged in · Please run /login', stderr: '' }),
    ).toBe('auth');
  });
  it('auth: /login prompt on stderr with nonzero exit → auth', () => {
    expect(
      classifyTransientFault({ exitCode: 1, isError: false, text: undefined, stderr: 'Please run /login' }),
    ).toBe('auth');
  });
  it('NEVER on a successful run that merely mentions the phrase', () => {
    expect(
      classifyTransientFault({ exitCode: 0, isError: false, text: 'The message "Not logged in · Please run /login" appears when…', stderr: '' }),
    ).toBeNull();
  });
  it('NEVER when a structured 429 is present (the real rate-limit path owns it)', () => {
    expect(
      classifyTransientFault({ exitCode: 1, isError: true, apiErrorStatus: 429, text: 'Not logged in · Please run /login', stderr: '' }),
    ).toBeNull();
  });
  it('stdin: "Input must be provided…" stderr on a failed run → stdin', () => {
    expect(
      classifyTransientFault({
        exitCode: 1, isError: false, text: undefined,
        stderr: 'Error: Input must be provided either through stdin or as a prompt argument when using --print',
      }),
    ).toBe('stdin');
  });
  it('stdin: "no stdin data received in 3s" warning → stdin', () => {
    expect(
      classifyTransientFault({ exitCode: 1, isError: false, text: undefined, stderr: 'Warning: no stdin data received in 3s of waiting' }),
    ).toBe('stdin');
  });
  it('plain failure (no signature) → null', () => {
    expect(
      classifyTransientFault({ exitCode: 1, isError: true, text: 'something broke', stderr: 'boom' }),
    ).toBeNull();
  });
  it('regex sanity: signatures match; ordinary output does not', () => {
    expect(AUTH_TRANSIENT_RE.test('Not logged in · Please run /login')).toBe(true);
    expect(AUTH_TRANSIENT_RE.test('all good, committed')).toBe(false);
    expect(STDIN_DELIVERY_RE.test('Warning: no stdin data received in 3s')).toBe(true);
    expect(STDIN_DELIVERY_RE.test('reading stdin as usual')).toBe(false);
  });
  it('transientRetryAfterMs jitters within [5000, 15000]', () => {
    expect(transientRetryAfterMs(() => 0)).toBe(5000);
    expect(transientRetryAfterMs(() => 0.9999)).toBeLessThanOrEqual(15000);
    for (let i = 0; i < 50; i++) {
      const v = transientRetryAfterMs();
      expect(v).toBeGreaterThanOrEqual(5000);
      expect(v).toBeLessThanOrEqual(15000);
    }
  });
});

describe('invokeNode transient-fault classification (crits 8+9, mocked spawn)', () => {
  let originalSpawn: typeof Bun.spawn;
  let originalSpawnSync: typeof Bun.spawnSync;
  const testCwd = '/tmp/node-invoker-test-transient';

  // Pre-seed the auth cache: the auth probe is an ASYNC Bun.spawn now (crit-6), and
  // the per-test Bun.spawn node mocks would otherwise be consumed by the probe.
  const mockAuthOk = () => {
    _primeAuthCacheForTest('subscription');
  };

  const makeProc = (stdoutStr: string, stderrStr: string, exitCode: number) => {
    const stdout = new ReadableStream<Uint8Array>({
      start(c) { if (stdoutStr) c.enqueue(new TextEncoder().encode(stdoutStr)); c.close(); },
    });
    const stderr = new ReadableStream<Uint8Array>({
      start(c) { if (stderrStr) c.enqueue(new TextEncoder().encode(stderrStr)); c.close(); },
    });
    return { pid: 99998, stdout, stderr, exited: Promise.resolve(exitCode), kill: () => {} } as any;
  };

  beforeEach(() => {
    originalSpawn = Bun.spawn;
    originalSpawnSync = Bun.spawnSync;
    _resetAuthCache();
    mkdirSync(testCwd, { recursive: true });
    mockAuthOk();
  });

  afterEach(() => {
    (Bun as any).spawn = originalSpawn;
    (Bun as any).spawnSync = originalSpawnSync;
    _resetAuthCache();
    try { rmSync(testCwd, { recursive: true, force: true }); } catch { /* ok */ }
  });

  const spec: NodeSpec = { prompt: 'test prompt', cwd: testCwd, skipAutoLedger: true };

  it('crit-8: failed run with "Not logged in · Please run /login" result → transient pause, retryAfterMs in [5000,15000]', async () => {
    const out = JSON.stringify({ result: 'Not logged in · Please run /login', is_error: true });
    (Bun as any).spawn = mock(() => makeProc(out, '', 1));
    const res = await invokeNode(spec);
    expect(res.ok).toBe(false);
    expect(res.rateLimited).toBe(true);
    expect(res.unreachable).toBe(true);
    expect(res.faultKind).toBe('auth');
    expect(res.retryAfterMs).toBeGreaterThanOrEqual(5000);
    expect(res.retryAfterMs).toBeLessThanOrEqual(15000);
    // capReset carries the same short delay so the headless-breaker reopens fast.
    expect(res.capReset).toBeGreaterThan(Date.now() + 4000);
  });

  it('crit-8 narrowness: SUCCESSFUL run whose text mentions the phrase → NOT transient', async () => {
    const out = JSON.stringify({ result: 'Docs: the CLI prints "Not logged in · Please run /login" when…', is_error: false });
    (Bun as any).spawn = mock(() => makeProc(out, '', 0));
    const res = await invokeNode(spec);
    expect(res.ok).toBe(true);
    expect(res.rateLimited).toBe(false);
    expect(res.faultKind).toBeUndefined();
    expect(res.retryAfterMs).toBeUndefined();
  });

  it('crit-9: stdin-delivery stderr on a failed run → ONE in-process respawn retry, then transient pause', async () => {
    let calls = 0;
    (Bun as any).spawn = mock(() => {
      calls++;
      return makeProc('', 'Error: Input must be provided either through stdin or as a prompt argument when using --print', 1);
    });
    const res = await invokeNode(spec);
    expect(calls).toBe(2); // first spawn + exactly one in-process retry
    expect(res.ok).toBe(false);
    expect(res.rateLimited).toBe(true);
    expect(res.unreachable).toBe(true);
    expect(res.faultKind).toBe('stdin');
    expect(res.retryAfterMs).toBeGreaterThanOrEqual(5000);
    expect(res.retryAfterMs).toBeLessThanOrEqual(15000);
  });

  it('crit-9: stdin fault then a HEALTHY retry → the retry result wins (ok, no pause)', async () => {
    let calls = 0;
    (Bun as any).spawn = mock(() => {
      calls++;
      if (calls === 1) return makeProc('', 'Warning: no stdin data received in 3s of waiting', 1);
      return makeProc(JSON.stringify({ result: 'done', is_error: false }), '', 0);
    });
    const res = await invokeNode(spec);
    expect(calls).toBe(2);
    expect(res.ok).toBe(true);
    expect(res.rateLimited).toBe(false);
    expect(res.faultKind).toBeUndefined();
  });

  it('no regression: a plain failure (no auth/stdin signature) stays a normal failure', async () => {
    let calls = 0;
    (Bun as any).spawn = mock(() => {
      calls++;
      return makeProc(JSON.stringify({ result: 'tests failed', is_error: true }), 'exit status 1', 1);
    });
    const res = await invokeNode(spec);
    expect(calls).toBe(1); // no respawn retry for a plain failure
    expect(res.ok).toBe(false);
    expect(res.rateLimited).toBe(false);
    expect(res.unreachable).toBe(false);
    expect(res.faultKind).toBeUndefined();
    expect(res.retryAfterMs).toBeUndefined();
  });
});

describe('worktreeSpawnEnv (E3 git isolation)', () => {
  it('strips GIT_DIR/GIT_WORK_TREE and ceilings discovery at the worktree parent', () => {
    const env = worktreeSpawnEnv('/repo/.claude/worktrees/wt-1', {
      PATH: '/usr/bin',
      GIT_DIR: '/repo/.git',
      GIT_WORK_TREE: '/repo',
    } as NodeJS.ProcessEnv);
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_WORK_TREE).toBeUndefined();
    expect(env.GIT_CEILING_DIRECTORIES).toBe('/repo/.claude/worktrees');
    expect(env.PATH).toBe('/usr/bin'); // other env preserved
  });

  it('does not mutate the base env', () => {
    const baseEnv = { GIT_DIR: '/repo/.git' } as NodeJS.ProcessEnv;
    worktreeSpawnEnv('/repo/wt', baseEnv);
    expect(baseEnv.GIT_DIR).toBe('/repo/.git');
  });
});

describe('buildNodeArgv', () => {
  it('always headless stream-json (+verbose, for the transcript), no-session-persistence, bypassPermissions, never --bare', () => {
    const argv = buildNodeArgv(base);
    expect(argv[0]).toBe('claude');
    expect(argv).toContain('-p');
    // stream-json so the full transcript is captured; the final result line is the
    // same object json-format gave (parseNodeJson reads it).
    expect(argv).toEqual(expect.arrayContaining(['--output-format', 'stream-json']));
    expect(argv).toContain('--verbose');
    expect(argv).toContain('--no-session-persistence');
    expect(argv).toEqual(expect.arrayContaining(['--permission-mode', 'bypassPermissions']));
    expect(argv).not.toContain('--bare');
    // Prompt is NOT a positional — it's fed via stdin (variadic-flag safety).
    expect(argv).not.toContain('hello');
  });

  it('always loads project,local settings only — never the user ~/.claude hooks (headless has no tty; a SessionStart cosmetic tty hook would hang the node 600s)', () => {
    const argv = buildNodeArgv(base);
    const i = argv.indexOf('--setting-sources');
    expect(i).toBeGreaterThan(-1);
    expect(argv[i + 1]).toBe('project,local');
  });

  it('F1: sources the setting-sources flag from the SHARED constant (both spawn paths reuse it, so they cannot drift)', () => {
    // The headless node path (this argv) and the interactive child path (child-manager.ts)
    // both spread SETTING_SOURCES_ARGS. Assert the argv contains the shared constant's exact
    // elements CONTIGUOUSLY — a proof the flag came from the shared source, not a re-typed
    // literal that could silently drift back to loading ~/.claude hooks (bug a8935a16).
    const argv = buildNodeArgv(base);
    const i = argv.indexOf(SETTING_SOURCES_ARGS[0]);
    expect(i).toBeGreaterThan(-1);
    expect(argv.slice(i, i + SETTING_SOURCES_ARGS.length)).toEqual([...SETTING_SOURCES_ARGS]);
    expect([...SETTING_SOURCES_ARGS]).toEqual(['--setting-sources', 'project,local']);
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

  it('adds --strict-mcp-config (no --mcp-config) when strictMcpConfig is set → no MCP loaded', () => {
    const argv = buildNodeArgv({ ...base, strictMcpConfig: true });
    expect(argv).toContain('--strict-mcp-config');
    expect(argv).not.toContain('--mcp-config'); // strict + none = zero MCP servers
  });

  it('omits --strict-mcp-config by default (MCP-using nodes keep .mcp.json)', () => {
    expect(buildNodeArgv({ ...base })).not.toContain('--strict-mcp-config');
    expect(buildNodeArgv({ ...base, strictMcpConfig: false })).not.toContain('--strict-mcp-config');
  });

  it('passes --effort only when set', () => {
    expect(buildNodeArgv({ ...base, effort: 'high' })).toEqual(expect.arrayContaining(['--effort', 'high']));
    expect(buildNodeArgv({ ...base })).not.toContain('--effort');
  });

  it('adds --strict-mcp-config + --mcp-config <path> contiguously when mcpConfig is set', () => {
    const argv = buildNodeArgv({ ...base, mcpConfig: '/tmp/x.json' });
    expect(argv).toContain('--strict-mcp-config');
    const i = argv.indexOf('--mcp-config');
    expect(i).toBeGreaterThan(-1);
    expect(argv[i + 1]).toBe('/tmp/x.json');
  });

  it('forces --strict-mcp-config when mcpConfig is set even if strictMcpConfig is explicitly false', () => {
    const argv = buildNodeArgv({ ...base, strictMcpConfig: false, mcpConfig: '/tmp/x.json' });
    expect(argv).toContain('--strict-mcp-config');
  });
});

describe('mcpConfigFor', () => {
  it('writes a JSON file naming the given port and memoizes the path', () => {
    const path1 = mcpConfigFor(9111);
    expect(existsSync(path1)).toBe(true);
    const body = JSON.parse(readFileSync(path1, 'utf-8'));
    expect(body).toEqual({ mcpServers: { mermaid: { type: 'http', url: 'http://127.0.0.1:9111/mcp' } } });
    const path2 = mcpConfigFor(9111);
    expect(path2).toBe(path1);
  });
});

describe('mcp-bearing lane guards', () => {
  it('invokeGrokNode refuses an mcp__-bearing allowedTools', async () => {
    await expect(
      invokeGrokNode({ ...base, allowedTools: 'Read mcp__mermaid__file_to_bucket' }),
    ).rejects.toThrow(/mcp__/);
  });

  it('invokeXaiApiNode refuses an mcp__-bearing allowedTools', async () => {
    await expect(
      invokeXaiApiNode({ ...base, allowedTools: 'Read mcp__mermaid__file_to_bucket' }),
    ).rejects.toThrow(/mcp__/);
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
  it('extracts the result from a stream-json (JSONL) transcript — the final type:result line', () => {
    const transcript = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'DONE', num_turns: 3, total_cost_usd: 0.02, usage: { input_tokens: 7, output_tokens: 9 } }),
    ].join('\n');
    const p = parseNodeJson(transcript);
    expect(p.text).toBe('DONE');
    expect(p.isError).toBe(false);
    expect(p.usage?.numTurns).toBe(3);
    expect(p.usage?.inputTokens).toBe(7);
  });
  it('stream-json: surfaces is_error + api_error_status from the result line', () => {
    const transcript = [
      JSON.stringify({ type: 'assistant', message: { content: [] } }),
      JSON.stringify({ type: 'result', subtype: 'error', is_error: true, api_error_status: 429 }),
    ].join('\n');
    const p = parseNodeJson(transcript);
    expect(p.isError).toBe(true);
    expect(p.apiErrorStatus).toBe(429);
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

describe('CONN_ERR_RE (network-outage signatures)', () => {
  it('matches connection/DNS/TLS failures', () => {
    for (const s of [
      'getaddrinfo ENOTFOUND api.anthropic.com',
      'connect ECONNREFUSED 127.0.0.1:443',
      'request to https://api.anthropic.com failed, reason: ETIMEDOUT',
      'fetch failed',
      'Connection error',
      'EAI_AGAIN',
      'socket hang up',
    ]) {
      expect(CONN_ERR_RE.test(s)).toBe(true);
    }
  });
  it('does not match ordinary output or a model error', () => {
    expect(CONN_ERR_RE.test('OK done')).toBe(false);
    expect(CONN_ERR_RE.test('the function returned an error value')).toBe(false);
  });
});

describe('parseCapReset (subscription session-limit reset time)', () => {
  // The real message captured from a live 429 (2026-06-18).
  const MSG = "You've hit your session limit · resets 8:50pm (America/Chicago)";
  const hhmm = (epoch: number, tz: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(epoch));

  it('parses the reset into the next epoch at that wall-clock in the stated timezone', () => {
    const now = Date.UTC(2026, 5, 18, 12, 0, 0); // noon UTC — well before 8:50pm Chicago
    const r = parseCapReset(MSG, '', now);
    expect(typeof r).toBe('number');
    expect(r!).toBeGreaterThan(now);
    expect(hhmm(r!, 'America/Chicago')).toBe('20:50');
    expect(r! - now).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('rolls to tomorrow when that wall-clock already passed today', () => {
    // 03:00 UTC Jun 19 == ~22:00 Chicago Jun 18 (CDT) — past 20:50, so next 20:50 is Jun 19.
    const now = Date.UTC(2026, 5, 19, 3, 0, 0);
    const r = parseCapReset(MSG, '', now);
    expect(r!).toBeGreaterThan(now);
    expect(hhmm(r!, 'America/Chicago')).toBe('20:50');
  });

  it('reads the reset out of a full stream-json result line', () => {
    const stdout = `{"type":"result","is_error":true,"api_error_status":429,"result":"${MSG}"}`;
    const now = Date.UTC(2026, 5, 18, 12, 0, 0);
    expect(hhmm(parseCapReset(stdout, '', now)!, 'America/Chicago')).toBe('20:50');
  });

  it('handles 12-hour edges (12:00am → 00:00, 12:30pm → 12:30)', () => {
    const now = Date.UTC(2026, 5, 18, 6, 0, 0);
    expect(hhmm(parseCapReset('resets 12:00am (America/Chicago)', '', now)!, 'America/Chicago')).toBe('00:00');
    expect(hhmm(parseCapReset('resets 12:30pm (America/Chicago)', '', now)!, 'America/Chicago')).toBe('12:30');
  });

  it('returns undefined when no reset message is present (→ daemon backoff)', () => {
    expect(parseCapReset('all good, no limit', '', Date.UTC(2026, 5, 18, 12, 0, 0))).toBeUndefined();
  });

  it('returns undefined for an unknown timezone (fail-safe → backoff)', () => {
    expect(parseCapReset('resets 8:50pm (Not/AZone)', '', Date.UTC(2026, 5, 18, 12, 0, 0))).toBeUndefined();
  });
});

describe('startWindowPlan (two-phase wall-clock: start window + work cap)', () => {
  it('cap ≤ start window → single timer with the full cap (historical behavior)', () => {
    expect(startWindowPlan(600_000, 600_000)).toEqual({ firstDelayMs: 600_000, twoPhase: false, remainderMs: 0 });
    expect(startWindowPlan(300_000, 600_000)).toEqual({ firstDelayMs: 300_000, twoPhase: false, remainderMs: 0 });
  });
  it('cap > start window → two-phase: 10-min zero-output stall check, then the remainder', () => {
    expect(startWindowPlan(1_800_000, 600_000)).toEqual({ firstDelayMs: 600_000, twoPhase: true, remainderMs: 1_200_000 });
  });
  it('F4: default start window is 60s — the DEFAULT 600s cap now arms a 60s startup deadline', () => {
    // Lowered from 600s (bug a8935a16): the old value only bit caps LONGER than 600s, so a
    // hook-hung node at the default 600s cap still burned the full 10 minutes. At 60s, the
    // default cap (600s > 60s) goes two-phase → a startup stall dies in ~a minute.
    expect(START_WINDOW_MS).toBe(60_000);
    expect(startWindowPlan(600_000)).toEqual({ firstDelayMs: 60_000, twoPhase: true, remainderMs: 540_000 });
    expect(startWindowPlan(1_800_000).firstDelayMs).toBe(60_000);
  });
});

describe('F4: generic startup deadline (fake-binary SessionStart hang → fast start-failure)', () => {
  let originalSpawnSync: typeof Bun.spawnSync;
  let stubDir: string;
  let stubPath: string;
  const testCwd = '/tmp/node-invoker-f4-hang';

  beforeEach(() => {
    originalSpawnSync = Bun.spawnSync;
    _resetAuthCache();
    _resetClaudeBinCache();
    mkdirSync(testCwd, { recursive: true });
    // A stub `claude` that emits NOTHING to stdout then hangs — exactly what an inherited
    // SessionStart hook blocked on /dev/tty does before the CLI ever prints its init line.
    stubDir = mkdtempSync(join(tmpdir(), 'claude-stub-'));
    stubPath = join(stubDir, 'claude-hang');
    writeFileSync(stubPath, '#!/bin/sh\n# emit nothing, then hang well past the (short, injected) start window\nsleep 30\n', { mode: 0o755 });
    chmodSync(stubPath, 0o755);
    // Auth pre-flight: pre-seed the cache (the probe is an ASYNC Bun.spawn now, crit-6)
    // so invokeNode proceeds straight to the real node spawn of the hanging stub.
    _primeAuthCacheForTest('subscription');
    process.env.CLAUDE_BIN = stubPath;
  });

  afterEach(() => {
    (Bun as any).spawnSync = originalSpawnSync;
    delete process.env.CLAUDE_BIN;
    _resetAuthCache();
    _resetClaudeBinCache();
    try { rmSync(stubDir, { recursive: true, force: true }); } catch { /* ok */ }
    try { rmSync(testCwd, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it('a hanging fake binary trips the start-window kill in ~sub-second (not the 30s work cap)', async () => {
    const start = Date.now();
    // Long WORK cap (30s), but a SHORT injected start window (250ms): a healthy node emits
    // its init line in ms, so a zero-stdout node is killed at the window, NOT the cap.
    const res = await invokeNode({ prompt: 'hello', cwd: testCwd, timeoutMs: 30_000, startWindowMs: 250 });
    const elapsed = Date.now() - start;

    expect(res.timedOut).toBe(true);
    expect(res.ok).toBe(false);
    // The parseError names the START WINDOW (start failure), not the 30s work cap.
    expect(res.parseError).toContain('start window');
    expect(res.parseError).toContain('250ms');
    // Zero tokens (never ran) — the executor's isNodeStartFailure classifies this fast.
    const u = res.usage;
    expect(((u?.inputTokens ?? 0) + (u?.outputTokens ?? 0) + (u?.cacheReadTokens ?? 0))).toBe(0);
    // FAST: seconds, not the 30s cap and nowhere near 4×600s.
    expect(elapsed).toBeLessThan(10_000);
  });
});
