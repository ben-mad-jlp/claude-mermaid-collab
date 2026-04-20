import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-revert-cancel-'));
  broadcasts = [];
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('agent_checkpoint_revert: cancels in-flight child', () => {
  it('calls registry.stop during revert so the child is drained before log truncation', async () => {
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
    const sessionId = 's-cancel';

    // Spy on stop (replaces cancelTurn since revert now fully drains the child).
    const stopSpy = mock(() => {});
    const origStop = registry.stop.bind(registry);
    registry.stop = (sid: string) => {
      stopSpy();
      return origStop(sid);
    };

    const dispatcher = new AgentDispatcher({
      registry,
      wsHandler: {} as any,
      resolvedCwd: tmpDir,
      gitOps: nonGitOps as any,
      checkpointStore: store,
      eventLog,
    });

    // Need a checkpoint entry so revert proceeds past the NOT_FOUND gate.
    eventLog.append(sessionId, [
      { kind: 'user_message', sessionId, ts: Date.now(), messageId: 'm', text: 'x' },
    ]);
    store.insert({ sessionId, turnId: 'turn-c', firstSeq: 1, stashSha: 'none' });

    const ws = {
      data: { subscriptions: new Set<string>() },
      send: () => {},
    } as any;
    await dispatcher.handle(ws, {
      kind: 'agent_checkpoint_revert',
      sessionId,
      turnId: 'turn-c',
      commandId: 'cmd-c',
    } as any);

    expect(stopSpy).toHaveBeenCalled();

    store.close();
  });
});
