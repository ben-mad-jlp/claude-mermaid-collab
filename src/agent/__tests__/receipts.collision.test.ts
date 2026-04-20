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

describe('receipts middleware: collision', () => {
  let receipts: CommandReceiptsStore;

  beforeEach(() => {
    receipts = new CommandReceiptsStore(':memory:');
  });

  afterEach(() => {
    receipts.close();
  });

  it('same commandId with different payload emits COMMAND_ID_COLLISION', async () => {
    const { dispatcher, getCalls } = makeDispatcher(receipts);
    const { ws, sent } = makeFakeWs();

    const cmdA: AgentCommand = {
      kind: 'agent_send',
      sessionId: 's1',
      text: 'hello',
      commandId: 'cid-42',
    };
    const cmdB: AgentCommand = {
      kind: 'agent_send',
      sessionId: 's1',
      text: 'different text',
      commandId: 'cid-42',
    };

    await dispatcher.handle(ws, cmdA);
    await dispatcher.handle(ws, cmdB);

    expect(getCalls()).toBe(1);
    const errors = sent.filter((m) => m.type === 'agent_command_error');
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe('COMMAND_ID_COLLISION');
    expect(errors[0].commandId).toBe('cid-42');
  });

  it('missing commandId emits MISSING_COMMAND_ID and drops', async () => {
    const { dispatcher, getCalls } = makeDispatcher(receipts);
    const { ws, sent } = makeFakeWs();

    const cmd = { kind: 'agent_send', sessionId: 's1', text: 'hi' } as AgentCommand;
    await dispatcher.handle(ws, cmd);

    expect(getCalls()).toBe(0);
    const errors = sent.filter((m) => m.type === 'agent_command_error');
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe('MISSING_COMMAND_ID');
  });
});
