import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentDispatcher } from '../dispatcher.ts';
import { CommandReceiptsStore } from '../command-receipts.ts';
import type { AgentCommand } from '../contracts.ts';

function makeFakeWs() {
  const sent: any[] = [];
  return {
    sent,
    ws: {
      data: { subscriptions: new Set<string>() },
      send: (json: string) => sent.push(JSON.parse(json)),
    } as any,
  };
}

function makeDispatcher(receipts: CommandReceiptsStore) {
  const dispatcher = new AgentDispatcher({
    registry: {} as any,
    wsHandler: {} as any,
    resolvedCwd: '/tmp',
    receipts,
  });
  let dispatchCalls = 0;
  (dispatcher as any).dispatch = async () => {
    dispatchCalls += 1;
  };
  return { dispatcher, getCalls: () => dispatchCalls };
}

describe('receipts middleware: TTL', () => {
  let receipts: CommandReceiptsStore;

  beforeEach(() => {
    receipts = new CommandReceiptsStore(':memory:');
  });

  afterEach(() => {
    receipts.close();
    vi.useRealTimers();
  });

  it('expired receipt is treated as a new command (dispatches again)', async () => {
    // Freeze time at T0 for the first call.
    const t0 = 1_000_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t0);

    const { dispatcher, getCalls } = makeDispatcher(receipts);
    const { ws, sent } = makeFakeWs();
    const cmd: AgentCommand = {
      kind: 'agent_send',
      sessionId: 's1',
      text: 'hello',
      commandId: 'cid-ttl',
    };

    await dispatcher.handle(ws, cmd);
    expect(getCalls()).toBe(1);

    // Advance past TTL (10 minutes = 600_000 ms). Use 11 minutes.
    vi.setSystemTime(t0 + 11 * 60 * 1000);

    await dispatcher.handle(ws, { ...cmd });

    expect(getCalls()).toBe(2);
    const acks = sent.filter((m) => m.event?.kind === 'command_ack');
    expect(acks.length).toBe(2);
  });
});
