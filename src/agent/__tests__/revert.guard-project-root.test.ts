import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentSessionRegistry } from '../session-registry.ts';
import { AgentDispatcher } from '../dispatcher.ts';
import { CheckpointStore } from '../checkpoint-store.ts';
import type { AgentEvent } from '../contracts.ts';
import type { GitOps } from '../git-ops.ts';

// gitOps that RECORDS every call + its cwd so we can assert WHERE the destructive
// restore ran (and that it didn't run at all when the guard refuses).
function recordingGitOps() {
  const calls: Array<{ method: string; cwd: string; arg?: string }> = [];
  const ops: GitOps = {
    async stashCreate(cwd) { calls.push({ method: 'stashCreate', cwd }); return 'safety-sha'; },
    async resetHard(cwd, ref) { calls.push({ method: 'resetHard', cwd, arg: ref }); },
    async checkoutAll(cwd, sha) { calls.push({ method: 'checkoutAll', cwd, arg: sha }); },
    async cleanUntracked(cwd) { calls.push({ method: 'cleanUntracked', cwd }); },
    async isGitRepo() { return true; },
  };
  return { calls, ops };
}

const DESTRUCTIVE = new Set(['resetHard', 'checkoutAll', 'cleanUntracked']);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-revert-guard-'));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeFakeWs() {
  const sent: unknown[] = [];
  return {
    sent,
    ws: { data: { subscriptions: new Set<string>() }, send: (s: string) => sent.push(JSON.parse(s)) } as any,
  };
}

function makeRegistry() {
  return new AgentSessionRegistry({
    broadcast: () => {},
    persistDir: tmpDir,
    spawn: () => ({
      stdin: { write() {}, end() {} },
      stdout: new ReadableStream(),
      stderr: new ReadableStream(),
      kill() {},
      exited: new Promise(() => {}),
    }) as any,
  });
}

/** Drive one revert with a real checkpoint (non-sentinel stashSha so the restore
 *  block runs) and return the recorded gitOps calls + sent frames. */
async function runRevert(opts: { resolvedCwd: string; guard?: boolean }) {
  const registry = makeRegistry();
  const eventLog = registry.getEventLog();
  const store = new CheckpointStore(':memory:');
  const { calls, ops } = recordingGitOps();
  const dispatcher = new AgentDispatcher({
    registry,
    wsHandler: {} as any,
    resolvedCwd: opts.resolvedCwd,
    gitOps: ops as any,
    checkpointStore: store,
    eventLog,
    guardProjectRootRevert: opts.guard,
  });

  const sessionId = 's-guard';
  eventLog.append(sessionId, [{ kind: 'user_message', sessionId, ts: Date.now(), messageId: 'm0', text: 'hi' } as AgentEvent]);
  store.insert({ sessionId, turnId: 't0', firstSeq: 1, stashSha: 'real-checkpoint-sha' });

  const { ws, sent } = makeFakeWs();
  await dispatcher.handle(ws, { kind: 'agent_checkpoint_revert', sessionId, turnId: 't0', commandId: 'c0' } as any);
  store.close();
  return { calls, sent };
}

describe('doRevert: shared-project-root guard', () => {
  it('REFUSES the destructive restore when cwd is a shared project root (guard on)', async () => {
    // A plain dir maps to itself via trackingProjectRoot → it IS a shared root.
    const { calls, sent } = await runRevert({ resolvedCwd: tmpDir, guard: true });

    const destructive = calls.filter((c) => DESTRUCTIVE.has(c.method));
    expect(destructive).toHaveLength(0); // nothing touched the main checkout
    expect(JSON.stringify(sent)).toContain('REVERT_REFUSED_SHARED_ROOT');
  });

  it('PROCEEDS (backward-compatible) when the guard flag is off', async () => {
    const { calls } = await runRevert({ resolvedCwd: tmpDir, guard: false });

    const methods = calls.map((c) => c.method);
    expect(methods).toContain('resetHard');
    expect(methods).toContain('cleanUntracked');
    expect(methods).toContain('checkoutAll');
  });

  it('PROCEEDS when cwd is a session WORKTREE (not a shared root), targeting that worktree', async () => {
    // A .collab/agent-sessions/... path resolves to a DIFFERENT tracking root, so it
    // is NOT a shared root — the revert runs there even with the guard on.
    const worktree = path.join(tmpDir, '.collab', 'agent-sessions', 'worktrees', 'lane-1');
    const { calls } = await runRevert({ resolvedCwd: worktree, guard: true });

    const checkout = calls.find((c) => c.method === 'checkoutAll');
    expect(checkout).toBeDefined();
    expect(checkout!.cwd).toBe(worktree); // ran in the worktree, not the shared root
  });
});

describe('AgentSessionRegistry.cwdFor', () => {
  it('returns undefined for an unknown session', () => {
    const registry = makeRegistry();
    expect(registry.cwdFor('nope')).toBeUndefined();
  });
});
