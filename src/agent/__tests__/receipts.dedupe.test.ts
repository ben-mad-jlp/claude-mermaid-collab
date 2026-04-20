import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  const fakeRegistry = {} as any;
  const fakeWsHandler = {} as any;
  const dispatcher = new AgentDispatcher({
    registry: fakeRegistry,
    wsHandler: fakeWsHandler,
    resolvedCwd: '/tmp',
    receipts,
  });
  // Stub the private dispatch to count invocations without needing a real registry.
  let dispatchCalls = 0;
  (dispatcher as any).dispatch = async (_ws: any, _cmd: AgentCommand) => {
    dispatchCalls += 1;
  };
  return { dispatcher, getCalls: () => dispatchCalls };
}

describe('receipts middleware: dedupe', () => {
  let receipts: CommandReceiptsStore;

  beforeEach(() => {
    receipts = new CommandReceiptsStore(':memory:');
  });

  afterEach(() => {
    receipts.close();
  });

  it('same commandId twice dispatches once and replays command_ack', async () => {
    const { dispatcher, getCalls } = makeDispatcher(receipts);
    const { ws, sent } = makeFakeWs();
    const cmd: AgentCommand = {
      kind: 'agent_send',
      sessionId: 's1',
      text: 'hello',
      commandId: 'cid-1',
    };

    await dispatcher.handle(ws, cmd);
    await dispatcher.handle(ws, { ...cmd });

    expect(getCalls()).toBe(1);
    const acks = sent.filter((m) => m.event?.kind === 'command_ack');
    expect(acks.length).toBe(2);
    for (const a of acks) {
      expect(a.event.commandId).toBe('cid-1');
      expect(a.event.resultSeq).toBe(0);
    }
  });
});
