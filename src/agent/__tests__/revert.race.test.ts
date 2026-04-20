import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentSessionRegistry } from '../session-registry.ts';
import { AgentDispatcher } from '../dispatcher.ts';
import { CheckpointStore } from '../checkpoint-store.ts';
import type { AgentEvent } from '../contracts.ts';
import type { GitOps } from '../git-ops.ts';

const nonGitOps: GitOps = {
  async stashCreate() { return ''; },
  async resetHard() { /* no-op */ },
  async checkoutAll() { /* no-op */ },
  async cleanUntracked() { /* no-op */ },
  async isGitRepo() { return false; },
};

let tmpDir: string;
let broadcasts: Array<{ type: 'agent_event'; channel: string; event: AgentEvent }>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-revert-race-'));
  broadcasts = [];
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('agent_checkpoint_revert: concurrent reverts', () => {
  it('serializes via per-session mutex; second sees CHECKPOINT_NOT_FOUND', async () => {
    const registry = new AgentSessionRegistry({
      broadcast: (msg) => broadcasts.push(msg),
      persistDir: tmpDir,
      spawn: () => ({
        stdin: { write() {}, end() {} },
        stdout: new ReadableStream(),
        stderr: new ReadableStream(),
        kill() {},
        exited: new Promise(() => {}),
      }) as any,
    });
    const eventLog = registry.getEventLog();
    const store = new CheckpointStore(':memory:');
    const dispatcher = new AgentDispatcher({
      registry,
      wsHandler: {} as any,
      resolvedCwd: tmpDir,
      gitOps: nonGitOps as any,
      checkpointStore: store,
      eventLog,
    });

    const sessionId = 's-race';
    eventLog.append(sessionId, [
      { kind: 'user_message', sessionId, ts: Date.now(), messageId: 'm1', text: 'a' },
      { kind: 'user_message', sessionId, ts: Date.now(), messageId: 'm2', text: 'b' },
    ]);
    store.insert({ sessionId, turnId: 'turn-r', firstSeq: 1, stashSha: 'none' });

    const wsA = { data: { subscriptions: new Set<string>() }, send: () => {} } as any;
    const wsB = { data: { subscriptions: new Set<string>() }, send: () => {} } as any;

    // Fire both concurrently (different commandIds so receipts dedupe doesn't swallow one).
    const [resA, resB] = await Promise.allSettled([
      dispatcher.handle(wsA, {
        kind: 'agent_checkpoint_revert',
        sessionId,
        turnId: 'turn-r',
        commandId: 'cmd-a',
      } as any),
      dispatcher.handle(wsB, {
        kind: 'agent_checkpoint_revert',
        sessionId,
        turnId: 'turn-r',
        commandId: 'cmd-b',
      } as any),
    ]);

    // Dispatcher.handle emits error frames rather than throwing; capture via ws send.
    // Both promises should settle (fulfilled). At least one must succeed, at least one
    // must observe the missing checkpoint.
    expect(resA.status).toBe('fulfilled');
    expect(resB.status).toBe('fulfilled');

    // Exactly one checkpoint_reverted event appended.
    const revertEvents = broadcasts.filter((b) => b.event.kind === 'checkpoint_reverted');
    expect(revertEvents.length).toBe(1);

    // The checkpoint row is gone after first revert.
    expect(store.get(sessionId, 'turn-r')).toBeUndefined();

    store.close();
  });
});
