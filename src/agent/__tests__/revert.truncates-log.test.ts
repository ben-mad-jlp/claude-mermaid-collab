import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentSessionRegistry } from '../session-registry.ts';
import { AgentDispatcher } from '../dispatcher.ts';
import { CheckpointStore } from '../checkpoint-store.ts';
import type { AgentEvent } from '../contracts.ts';
import type { GitOps } from '../git-ops.ts';

// Non-git stub so safety-stash and restore are no-ops.
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-revert-trunc-'));
  broadcasts = [];
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeFakeWs() {
  const sent: unknown[] = [];
  return {
    sent,
    ws: {
      data: { subscriptions: new Set<string>() },
      send: (s: string) => sent.push(JSON.parse(s)),
    } as any,
  };
}

describe('agent_checkpoint_revert: truncates event log', () => {
  it('removes events from firstSeq onward and appends revert event as new tail', async () => {
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

    const sessionId = 's-trunc';
    // Pre-populate 10 events; seqs 1..10.
    const seeds: AgentEvent[] = [];
    for (let i = 0; i < 10; i++) {
      seeds.push({
        kind: 'user_message',
        sessionId,
        ts: Date.now(),
        messageId: `m-${i}`,
        text: `hello ${i}`,
      });
    }
    eventLog.append(sessionId, seeds);
    expect(eventLog.getLastSeq(sessionId)).toBe(10);

    // Checkpoint at seq 5 (turn covers events 5..10).
    store.insert({ sessionId, turnId: 'turn-x', firstSeq: 5, stashSha: 'none' });

    const { ws } = makeFakeWs();
    await dispatcher.handle(ws, {
      kind: 'agent_checkpoint_revert',
      sessionId,
      turnId: 'turn-x',
      commandId: 'cmd-1',
    } as any);

    // After truncation + revert event append, tail is 5 (revert event lives at seq 5).
    expect(eventLog.getLastSeq(sessionId)).toBe(5);

    const remaining: AgentEvent[] = [];
    for await (const ev of eventLog.replay(sessionId, 0)) remaining.push(ev);
    // seqs 1..4 originals + the new revert event at seq 5.
    expect(remaining).toHaveLength(5);
    const tail = remaining[remaining.length - 1] as { kind: string; firstSeq: number; turnId: string };
    expect(tail.kind).toBe('checkpoint_reverted');
    expect(tail.firstSeq).toBe(5);
    expect(tail.turnId).toBe('turn-x');

    // Checkpoint store entry is also gone.
    expect(store.get(sessionId, 'turn-x')).toBeUndefined();

    store.close();
  });
});
