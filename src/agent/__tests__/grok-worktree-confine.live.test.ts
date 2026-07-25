/**
 * LIVE end-to-end proof of grok worktree confinement: installer + hook + REAL grok CLI.
 * Skip-gated so a machine without grok (or without grok auth) stays green — never a silent
 * pass: describe.skipIf reports the skip explicitly in bun's output.
 *
 * Set MERMAID_SKIP_LIVE_GROK=1 to force-skip regardless of local grok install/auth.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  resolveGrokBin,
  assertGrokAuth,
  invokeGrokNode,
  grokConfineHookFile,
  _resetGrokConfineHookCache,
  _resetConfineHookPathCache,
  type NodeResult,
} from '../node-invoker.ts';

const SKIP_ENV = !!process.env.MERMAID_SKIP_LIVE_GROK;
const HAS_GROK = !SKIP_ENV && !!Bun.which(resolveGrokBin());
let authMode: string = 'unknown';
if (HAS_GROK) {
  try {
    authMode = await assertGrokAuth();
  } catch {
    authMode = 'unknown';
  }
}
const LIVE_GROK = HAS_GROK && authMode === 'grok';

const LIVE_TIMEOUT_MS = 120_000;
const MAX_TURNS = 4;
const START_FAIL_RE = /unexpected argument|unrecognized|unknown option|spawn failed|ENOENT/i;

function expectNoStartFail(res: NodeResult): void {
  expect(res.timedOut).not.toBe(true);
  expect(res.unreachable).not.toBe(true);
  expect(res.durationMs).toBeLessThan(LIVE_TIMEOUT_MS);
  expect(START_FAIL_RE.test(res.parseError ?? '')).toBe(false);
}

describe.skipIf(!LIVE_GROK)('live grok worktree confinement (skipped unless LIVE_GROK)', () => {
  let root = '';
  let worktree = '';
  let outside = '';
  let hookPath = '';
  let savedHook: string | null = null;
  const savedResourcesPath = process.env.MERMAID_RESOURCES_PATH;

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'grok-confine-live-')));
    worktree = join(root, 'wt-lane');
    outside = join(root, 'main-checkout');
    mkdirSync(worktree, { recursive: true });
    mkdirSync(outside, { recursive: true });

    hookPath = join(homedir(), '.grok', 'hooks', 'mermaid-worktree-confine.json');
    savedHook = existsSync(hookPath) ? readFileSync(hookPath, 'utf-8') : null;

    // This test proves the hook script IN THIS WORKING TREE, not whatever a previously
    // deployed app bundle left on disk. resolveConfineHookPath() prefers
    // MERMAID_RESOURCES_PATH (packaged-sidecar case) over the from-source path — and a leaf
    // executor's own env inherits that var from the daemon that spawned it, which would
    // otherwise point this test at a stale `.app` bundle's hooks/worktree-confine.mjs.
    delete process.env.MERMAID_RESOURCES_PATH;
    _resetConfineHookPathCache();
    _resetGrokConfineHookCache();
    const installed = grokConfineHookFile();
    expect(installed).toBeTruthy();

    // invokeGrokNode spawns the CLI detached (own process group, node-invoker.ts:1485-1491);
    // the hermetic tripwire preload blocks any detached spawn unless explicitly allowed —
    // this is a REAL grok process, so it must opt in (see node-invoker.test.ts:760).
    process.env.MERMAID_TEST_ALLOW_DETACHED = '1';
  });

  afterAll(() => {
    delete process.env.MERMAID_TEST_ALLOW_DETACHED;
    if (savedResourcesPath !== undefined) process.env.MERMAID_RESOURCES_PATH = savedResourcesPath;
    _resetConfineHookPathCache();
    try {
      if (savedHook !== null) {
        writeFileSync(hookPath, savedHook);
      } else {
        unlinkSync(hookPath);
      }
    } catch {
      /* best-effort restore */
    }
    try {
      _resetGrokConfineHookCache();
    } catch {
      /* best-effort */
    }
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it(
    'refuses a write outside the worktree',
    async () => {
      const res = await invokeGrokNode({
        prompt: `Create a file at the absolute path ${outside}/leak.txt containing the text "leak". If a tool call is denied, stop and reply DENIED.`,
        cwd: worktree,
        maxTurns: MAX_TURNS,
        timeoutMs: LIVE_TIMEOUT_MS,
        skipAutoLedger: true,
        leafId: 'live-confine-1',
      });
      expect(existsSync(join(outside, 'leak.txt'))).toBe(false);
      expectNoStartFail(res);
    },
    180_000,
  );

  it(
    'allows a write inside the worktree',
    async () => {
      const res = await invokeGrokNode({
        prompt: `Create a file at the absolute path ${worktree}/ok.txt containing the text "ok".`,
        cwd: worktree,
        maxTurns: MAX_TURNS,
        timeoutMs: LIVE_TIMEOUT_MS,
        skipAutoLedger: true,
        leafId: 'live-confine-2',
      });
      expect(existsSync(join(worktree, 'ok.txt'))).toBe(true);
      expectNoStartFail(res);
    },
    180_000,
  );
});
