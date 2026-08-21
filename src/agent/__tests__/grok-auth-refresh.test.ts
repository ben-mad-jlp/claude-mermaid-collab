/**
 * Grok auth probe: no-spawn read, one-shot refresh, non-memoized negative verdict.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertGrokAuth,
  readGrokAuthStatus,
  authModeFromGrokStatus,
  _setGrokAuthDeps,
  _resetGrokAuthCache,
} from '../node-invoker.ts';

let tmpDir: string;
let authPath: string;
let calls: string[][];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'grok-auth-refresh-'));
  authPath = join(tmpDir, 'auth.json');
  calls = [];
  _resetGrokAuthCache();
  _setGrokAuthDeps({
    spawn: async (argv: string[]) => {
      calls.push(argv);
      writeFileSync(
        authPath,
        JSON.stringify({ access_token: 'tok', expires_at: Date.now() + 60_000 }),
      );
      return { exitCode: 0, stdout: '' };
    },
    authFilePath: () => authPath,
    binPresent: () => true,
  });
});

afterEach(() => {
  _setGrokAuthDeps(null);
  _resetGrokAuthCache();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('grok auth probe', () => {
  it('negative verdict is re-probed, not memoized', async () => {
    writeFileSync(
      authPath,
      JSON.stringify({ access_token: 'tok', expires_at: Date.now() - 60_000 }),
    );
    await expect(assertGrokAuth()).rejects.toThrow();
    writeFileSync(
      authPath,
      JSON.stringify({ access_token: 'tok', expires_at: Date.now() + 60_000 }),
    );
    expect(await assertGrokAuth()).toBe('grok');
  });

  it('an expired record with refresh_token triggers exactly one refresh spawn', async () => {
    writeFileSync(
      authPath,
      JSON.stringify({
        'https://auth.x.ai::id': { key: 'tok', refresh_token: 'r', expires_at: Date.now() - 1 },
      }),
    );
    expect(await assertGrokAuth()).toBe('grok');
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(-2)).toEqual(['auth', 'refresh']);
  });

  it('readGrokAuthStatus resolves from auth.json content alone', async () => {
    writeFileSync(
      authPath,
      JSON.stringify({ access_token: 'tok', expires_at: Date.now() + 60_000 }),
    );
    expect(authModeFromGrokStatus(await readGrokAuthStatus())).toBe('grok');
    expect(calls).toHaveLength(0);
  });

  it('expired snapshot re-probes on the next call', async () => {
    let probeCalls = 0;
    _setGrokAuthDeps({
      spawn: async (argv: string[]) => {
        calls.push(argv);
        writeFileSync(
          authPath,
          JSON.stringify({ access_token: 'tok', expires_at: Date.now() + 60_000 }),
        );
        return { exitCode: 0, stdout: '' };
      },
      authFilePath: () => authPath,
      binPresent: () => {
        probeCalls++;
        return true;
      },
    });
    writeFileSync(
      authPath,
      JSON.stringify({ access_token: 'tok', expires_at: Date.now() - 60_000 }),
    );
    await expect(assertGrokAuth()).rejects.toThrow();
    expect(probeCalls).toBe(1);
    writeFileSync(
      authPath,
      JSON.stringify({ access_token: 'tok', expires_at: Date.now() + 60_000 }),
    );
    expect(await assertGrokAuth()).toBe('grok');
    expect(probeCalls).toBe(2);
  });

  it("a 'grok' verdict is memoized without re-probing", async () => {
    let probeCalls = 0;
    _setGrokAuthDeps({
      spawn: async (argv: string[]) => {
        calls.push(argv);
        writeFileSync(
          authPath,
          JSON.stringify({ access_token: 'tok', expires_at: Date.now() + 60_000 }),
        );
        return { exitCode: 0, stdout: '' };
      },
      authFilePath: () => authPath,
      binPresent: () => {
        probeCalls++;
        return true;
      },
    });
    writeFileSync(
      authPath,
      JSON.stringify({ access_token: 'tok', expires_at: Date.now() + 60_000 }),
    );
    expect(await assertGrokAuth()).toBe('grok');
    expect(probeCalls).toBe(1);
    expect(await assertGrokAuth()).toBe('grok');
    expect(probeCalls).toBe(1);
  });
});
