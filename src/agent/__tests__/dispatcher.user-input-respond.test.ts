import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentDispatcher } from '../dispatcher.ts';
import { UserInputBridge } from '../user-input-bridge.ts';
import { CommandReceiptsStore } from '../command-receipts.ts';
import type { AgentEvent } from '../contracts.ts';

type CapturedFrame = { type: string; [k: string]: unknown };

function makeFakeWs() {
  const sent: CapturedFrame[] = [];
  return {
    sent,
    ws: {
      data: { subscriptions: new Set<string>() },
      send: (json: string) => {
        sent.push(JSON.parse(json) as CapturedFrame);
      },
    } as any,
  };
}

/**
 * Minimal registry stub: recordAndDispatch appends to a captured array and
 * returns a fake monotonic seq (mirrors real behavior via EventLog stamping).
 */
function makeRegistryStub() {
  const dispatched: AgentEvent[] = [];
  let seq = 0;
  return {
    dispatched,
    registry: {
      recordAndDispatch: (_sessionId: string, event: AgentEvent) => {
        seq += 1;
        dispatched.push({ ...(event as any), seq } as AgentEvent);
        return seq;
      },
    } as any,
  };
}

describe('AgentDispatcher agent_user_input_respond', () => {
  let dir: string;
  let receipts: CommandReceiptsStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'uir-dispatch-'));
    receipts = new CommandReceiptsStore(':memory:');
  });

  afterEach(() => {
    receipts.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('happy path: resolves bridge promise and emits UserInputResolvedEvent', async () => {
    const bridge = new UserInputBridge();
    const { registry, dispatched } = makeRegistryStub();
    const dispatcher = new AgentDispatcher({
      registry,
      wsHandler: {} as any,
      resolvedCwd: dir,
      receipts,
      userInputBridge: bridge,
    });
    const { ws, sent } = makeFakeWs();

    const sessionId = 'sess-ok';
    // Pre-register a pending request on the bridge.
    const handle = bridge.request(sessionId, 'Pick one', 'choice', [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);

    const value = { kind: 'choice' as const, choiceId: 'a' };
    await dispatcher.handle(ws, {
      kind: 'agent_user_input_respond',
      sessionId,
      promptId: handle.promptId,
      value,
      commandId: 'cmd-ok-1',
    });

    // Bridge promise must resolve with the provided value.
    await expect(handle.promise).resolves.toEqual(value);

    // UserInputResolvedEvent must have been dispatched through the registry.
    const resolved = dispatched.filter((e) => e.kind === 'user_input_resolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      kind: 'user_input_resolved',
      sessionId,
      promptId: handle.promptId,
      value,
    });

    // Receipt marked accepted with the returned seq.
    const receipt = receipts.get('cmd-ok-1');
    expect(receipt?.outcome).toBe('accepted');
    expect(receipt?.resultSeq).toBe(1);

    // A command_ack frame was emitted (no error frame).
    const errorFrames = sent.filter((f) => f.type === 'agent_command_error');
    expect(errorFrames).toHaveLength(0);
    const acks = sent.filter((f) => f.type === 'agent_event' && (f as any).event?.kind === 'command_ack');
    expect(acks).toHaveLength(1);
  });

  it('error path: unknown promptId → NO_PENDING_USER_INPUT + receipt rejected', async () => {
    const bridge = new UserInputBridge();
    const { registry, dispatched } = makeRegistryStub();
    const dispatcher = new AgentDispatcher({
      registry,
      wsHandler: {} as any,
      resolvedCwd: dir,
      receipts,
      userInputBridge: bridge,
    });
    const { ws, sent } = makeFakeWs();

    await dispatcher.handle(ws, {
      kind: 'agent_user_input_respond',
      sessionId: 'sess-err',
      promptId: 'does-not-exist',
      value: { kind: 'text', text: 'hi' },
      commandId: 'cmd-err-1',
    });

    // No resolved event dispatched.
    expect(dispatched.filter((e) => e.kind === 'user_input_resolved')).toHaveLength(0);

    // Error frame emitted with NO_PENDING_USER_INPUT.
    const errorFrames = sent.filter((f) => f.type === 'agent_command_error');
    expect(errorFrames).toHaveLength(1);
    expect((errorFrames[0] as any).code).toBe('NO_PENDING_USER_INPUT');
    expect((errorFrames[0] as any).commandId).toBe('cmd-err-1');

    // No command_ack frame.
    const acks = sent.filter((f) => f.type === 'agent_event' && (f as any).event?.kind === 'command_ack');
    expect(acks).toHaveLength(0);

    // Receipt marked rejected.
    const receipt = receipts.get('cmd-err-1');
    expect(receipt?.outcome).toBe('rejected');
  });
});
